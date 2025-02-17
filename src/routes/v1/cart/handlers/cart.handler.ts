// src/routes/v1/users/handlers/cart.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose, { Types } from "mongoose";
import { CART_CONSTANTS } from "../../../../constants/cart.constants";
import { Cart, ICartItem } from "../../../../models/Cart";
import { Item } from "../../../../models/Item";
import {
	AddToCartBody,
	CartItemParams,
	UpdateCartItemBody,
	CartOperationBody,
} from "../../../../schemas/cart";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
	createError,
	ErrorTypes,
} from "../../../../utils/error-handler";
import {
	OptimisticLocking,
	OptimisticLockingError,
} from "../../../../utils/optimistic-locking.utils";
import { withTransaction } from "../../../../utils/transaction.utils";

export class CartHandler {
	// Helper method to get or create cart
	private async getOrCreateCart(
		userId: string,
		session?: mongoose.ClientSession
	) {
		try {
			let cart = await Cart.findOne({ userId }).session(session || null);

			if (!cart) {
				cart = new Cart({
					userId,
					items: [],
					currency: CART_CONSTANTS.CURRENCY,
				});
				if (session) {
					await cart.save({ session });
				} else {
					await cart.save();
				}
				Logger.debug(
					`Created new cart for user ${userId}`,
					"CartHandler"
				);
			}

			return cart;
		} catch (error) {
			Logger.error(error as Error, "CartHandler");
			throw CommonErrors.databaseError("cart retrieval/creation");
		}
	}

	// Helper method to generate status summary
	private generateStatusSummary(cart: any) {
		const statusCounts = cart.items.reduce(
			(acc: Record<string, number>, item: ICartItem) => {
				acc[item.status] = (acc[item.status] || 0) + 1;
				return acc;
			},
			{
				active: 0,
				discontinued: 0,
				outOfStock: 0,
				removed: 0,
			}
		);

		return {
			...statusCounts,
			hasDiscontinuedItems: statusCounts.discontinued > 0,
			hasOutOfStockItems: statusCounts.outOfStock > 0,
		};
	}

	// Helper method to get items by status
	private getItemsByStatus(cart: any, status: string) {
		return cart.items.filter((item: ICartItem) => item.status === status);
	}

	// Get cart contents
	async getCart(request: FastifyRequest, reply: FastifyReply) {
		try {
			const userId = request.user!.userId;
			Logger.debug(`Retrieving cart for user ${userId}`, "CartHandler");

			const cart = await this.getOrCreateCart(userId);
			await cart.updatePrices(); // Ensure prices are up to date

			// Generate status summary and get problematic items
			const statusSummary = this.generateStatusSummary(cart);
			const response: any = {
				cart,
				statusSummary,
			};

			// Only include discontinued/outOfStock items if they exist
			if (statusSummary.hasDiscontinuedItems) {
				response.discontinuedItems = this.getItemsByStatus(
					cart,
					"discontinued"
				);
			}

			if (statusSummary.hasOutOfStockItems) {
				response.outOfStockItems = this.getItemsByStatus(
					cart,
					"outOfStock"
				);
			}

			return reply.send({
				success: true,
				data: response,
			});
		} catch (error) {
			Logger.error(error as Error, "CartHandler");
			throw error;
		}
	}

	// Add item to cart
	async addToCart(
		request: FastifyRequest<{
			Body: Static<typeof AddToCartBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const userId = request.user!.userId;
			const { itemId, variantSku, quantity } = request.body;
			const { version } = request.body; // Optional version from client

			Logger.debug(
				`Adding item ${itemId} to cart for user ${userId}`,
				"CartHandler"
			);

			// Get or create cart first to get current version
			const cart = await this.getOrCreateCart(userId, session);

			// If client provided version, validate it
			if (version !== undefined && version !== cart.version) {
				throw createError(
					409,
					ErrorTypes.RESOURCE_CONFLICT,
					"Cart was modified. Please refresh and try again."
				);
			}

			try {
				return await OptimisticLocking.executeWithLock(
					Cart,
					cart._id instanceof Types.ObjectId
						? cart._id.toString()
						: (cart._id as string),
					cart.version,
					async (lockedCart) => {
						// Validate item exists and get its details
						const item = await Item.findById(itemId).session(
							session
						);
						if (!item) {
							throw CommonErrors.itemNotFound();
						}

						// Check item status first
						if (item.status === "discontinued") {
							throw createBusinessError(
								"This item has been discontinued and cannot be added to cart"
							);
						}

						if (item.status !== "active") {
							throw createBusinessError(
								"This item is not available for purchase"
							);
						}

						// Find the variant
						const variant = item.variants.find(
							(v) => v.sku === variantSku
						);
						if (!variant) {
							throw createBusinessError("Item variant not found");
						}

						// Check stock
						if (variant.stockQuantity < quantity) {
							throw createBusinessError(
								`Only ${variant.stockQuantity} items available in stock`
							);
						}

						// Check if item already exists in cart
						const existingItemIndex = lockedCart.items.findIndex(
							(i) =>
								i.itemId.toString() === itemId &&
								i.variantSku === variantSku
						);

						if (existingItemIndex !== -1) {
							const newQuantity =
								lockedCart.items[existingItemIndex].quantity +
								quantity;
							if (newQuantity > variant.stockQuantity) {
								throw createBusinessError(
									`Cannot add more items. Only ${variant.stockQuantity} available in stock`
								);
							}
							lockedCart.items[existingItemIndex].quantity =
								newQuantity;
						} else {
							// Calculate effective price considering discounts
							const basePrice = Math.round(variant.price);
							let effectivePrice = basePrice;

							if (item.discount?.active) {
								const now = new Date();
								if (
									now >= item.discount.startDate &&
									now <= item.discount.endDate
								) {
									effectivePrice = Math.round(
										basePrice *
											(1 - item.discount.percentage / 100)
									);
								}
							}

							// Add new item to cart
							lockedCart.items.push({
								itemId: new mongoose.Types.ObjectId(itemId),
								variantSku,
								quantity,
								priceAtAdd: basePrice,
								currentPrice: basePrice,
								effectivePrice,
								specifications: variant.specifications,
								name: item.name,
								status: "active",
							});
						}

						await lockedCart.save({ session });

						// Generate status summary for response
						const statusSummary =
							this.generateStatusSummary(lockedCart);
						const response: any = {
							cart: lockedCart,
							addedItem:
								lockedCart.items[
									existingItemIndex !== -1
										? existingItemIndex
										: lockedCart.items.length - 1
								],
							statusSummary,
							version: lockedCart.version,
						};

						// Include discontinued/outOfStock items if any
						if (statusSummary.hasDiscontinuedItems) {
							response.discontinuedItems = this.getItemsByStatus(
								lockedCart,
								"discontinued"
							);
						}

						if (statusSummary.hasOutOfStockItems) {
							response.outOfStockItems = this.getItemsByStatus(
								lockedCart,
								"outOfStock"
							);
						}

						Logger.info(
							`Item ${itemId} added to cart for user ${userId}`,
							"CartHandler"
						);

						return reply.code(200).send({
							success: true,
							data: response,
						});
					}
				);
			} catch (error) {
				if (error instanceof OptimisticLockingError) {
					Logger.warn(
						`Concurrency conflict while adding item to cart for user ${userId}`,
						"CartHandler"
					);
					throw createError(
						409,
						ErrorTypes.RESOURCE_CONFLICT,
						"Cart was modified by another operation. Please try again."
					);
				}
				throw error;
			}
		}, "CartHandler");
	}

	// Update cart item quantity
	async updateCartItem(
		request: FastifyRequest<{
			Params: Static<typeof CartItemParams>;
			Body: Static<typeof UpdateCartItemBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const userId = request.user!.userId;
			const { itemId, variantSku } = request.params;
			const { quantity, version } = request.body;

			Logger.debug(
				`Updating quantity for item ${itemId} in cart for user ${userId}`,
				"CartHandler"
			);

			// Get cart and validate existence
			const cart = await Cart.findOne({ userId }).session(session);
			if (!cart) {
				throw CommonErrors.cartNotFound();
			}

			// If client provided version, validate it
			if (version !== undefined && version !== cart.version) {
				throw createError(
					409,
					ErrorTypes.RESOURCE_CONFLICT,
					"Cart was modified. Please refresh and try again."
				);
			}

			try {
				return await OptimisticLocking.executeWithLock(
					Cart,
					cart._id instanceof Types.ObjectId
						? cart._id.toString()
						: (cart._id as string),
					cart.version,
					async (lockedCart) => {
						// Find item in cart
						const itemIndex = lockedCart.items.findIndex(
							(i) =>
								i.itemId.toString() === itemId &&
								i.variantSku === variantSku
						);

						if (itemIndex === -1) {
							throw createBusinessError("Item not found in cart");
						}

						// Get current item status and details
						const cartItem = lockedCart.items[itemIndex];
						const item = await Item.findById(itemId).session(
							session
						);

						if (!item) {
							throw CommonErrors.itemNotFound();
						}

						// Check if item has been discontinued since it was added
						if (
							item.status === "discontinued" &&
							cartItem.status !== "discontinued"
						) {
							throw createBusinessError(
								"This item has been discontinued and cannot be updated"
							);
						}

						// Find variant and validate stock
						const variant = item.variants.find(
							(v) => v.sku === variantSku
						);
						if (!variant) {
							throw createBusinessError(
								"Item variant no longer available"
							);
						}

						// Validate stock availability
						if (variant.stockQuantity < quantity) {
							// Update item status to outOfStock if necessary
							cartItem.status = "outOfStock";
							throw createBusinessError(
								`Cannot update quantity. Only ${variant.stockQuantity} items available in stock`
							);
						}

						// Update quantity and recalculate prices
						cartItem.quantity = quantity;

						// Update prices if item is active
						if (cartItem.status === "active") {
							const basePrice = Math.round(variant.price);
							cartItem.currentPrice = basePrice;

							// Apply discounts if available and valid
							if (item.discount?.active) {
								const now = new Date();
								if (
									now >= item.discount.startDate &&
									now <= item.discount.endDate
								) {
									cartItem.effectivePrice = Math.round(
										basePrice *
											(1 - item.discount.percentage / 100)
									);
								} else {
									cartItem.effectivePrice = basePrice;
								}
							} else {
								cartItem.effectivePrice = basePrice;
							}
						}

						// Force version increment and update
						await lockedCart.save({ session });

						// Generate status summary for response
						const statusSummary =
							this.generateStatusSummary(lockedCart);
						const response: any = {
							cart: lockedCart,
							updatedItem: cartItem,
							statusSummary,
							version: lockedCart.version,
						};

						// Include discontinued/outOfStock items if any
						if (statusSummary.hasDiscontinuedItems) {
							response.discontinuedItems = this.getItemsByStatus(
								lockedCart,
								"discontinued"
							);
						}

						if (statusSummary.hasOutOfStockItems) {
							response.outOfStockItems = this.getItemsByStatus(
								lockedCart,
								"outOfStock"
							);
						}

						Logger.info(
							`Updated quantity for item ${itemId} in cart for user ${userId}`,
							"CartHandler"
						);

						return reply.send({
							success: true,
							data: response,
						});
					}
				);
			} catch (error) {
				if (error instanceof OptimisticLockingError) {
					Logger.warn(
						`Concurrency conflict while updating cart item for user ${userId}`,
						"CartHandler"
					);
					throw createError(
						409,
						ErrorTypes.RESOURCE_CONFLICT,
						"Cart was modified by another operation. Please try again."
					);
				}
				throw error;
			}
		}, "CartHandler");
	}

	// Remove item from cart
	async removeFromCart(
		request: FastifyRequest<{
			Params: Static<typeof CartItemParams>;
			Body: Static<typeof CartOperationBody>; // Optional version in body
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const userId = request.user!.userId;
			const { itemId, variantSku } = request.params;
			const { version } = request.body || {};

			Logger.debug(
				`Removing item ${itemId} from cart for user ${userId}`,
				"CartHandler"
			);

			const cart = await Cart.findOne({ userId }).session(session);
			if (!cart) {
				throw CommonErrors.cartNotFound();
			}

			// If client provided version, validate it
			if (version !== undefined && version !== cart.version) {
				throw createError(
					409,
					ErrorTypes.RESOURCE_CONFLICT,
					"Cart was modified. Please refresh and try again."
				);
			}

			try {
				return await OptimisticLocking.executeWithLock(
					Cart,
					cart._id instanceof Types.ObjectId
						? cart._id.toString()
						: (cart._id as string),
					cart.version,
					async (lockedCart) => {
						const itemIndex = lockedCart.items.findIndex(
							(i) =>
								i.itemId.toString() === itemId &&
								i.variantSku === variantSku
						);

						if (itemIndex === -1) {
							throw createBusinessError("Item not found in cart");
						}

						// Store item details before removal for response
						const removedItem = {
							...lockedCart.items[itemIndex], // Spread operator will create a plain object copy
							itemId, // Ensure itemId is included
							variantSku, // Ensure variantSku is included
						};

						// Check if we're removing the last active item
						const activeItemsBeforeRemoval =
							lockedCart.items.filter(
								(item) => item.status === "active"
							).length;

						const isRemovingActiveItem =
							lockedCart.items[itemIndex].status === "active";
						const willBeEmpty =
							isRemovingActiveItem &&
							activeItemsBeforeRemoval === 1;

						// Remove the item
						lockedCart.items.splice(itemIndex, 1);

						// Generate response before save
						const statusSummary =
							this.generateStatusSummary(lockedCart);
						const response: any = {
							cart: lockedCart,
							removedItem,
							statusSummary,
							version: lockedCart.version,
							cartStatus: {
								wasLastActiveItem: willBeEmpty,
								remainingActiveItems:
									activeItemsBeforeRemoval -
									(isRemovingActiveItem ? 1 : 0),
							},
						};

						// Include discontinued/outOfStock items if any
						if (statusSummary.hasDiscontinuedItems) {
							response.discontinuedItems = this.getItemsByStatus(
								lockedCart,
								"discontinued"
							);
						}

						if (statusSummary.hasOutOfStockItems) {
							response.outOfStockItems = this.getItemsByStatus(
								lockedCart,
								"outOfStock"
							);
						}

						// Save the updated cart
						await lockedCart.save({ session });

						Logger.info(
							`Removed item ${itemId} from cart for user ${userId}`,
							"CartHandler"
						);

						return reply.send({
							success: true,
							data: response,
						});
					}
				);
			} catch (error) {
				if (error instanceof OptimisticLockingError) {
					Logger.warn(
						`Concurrency conflict while removing item from cart for user ${userId}`,
						"CartHandler"
					);
					throw createError(
						409,
						ErrorTypes.RESOURCE_CONFLICT,
						"Cart was modified by another operation. Please try again."
					);
				}
				throw error;
			}
		}, "CartHandler");
	}

	// Clear cart
	async clearCart(
		request: FastifyRequest<{
			Body: Static<typeof CartOperationBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const userId = request.user!.userId;
			const { version } = request.body || {};

			Logger.debug(`Clearing cart for user ${userId}`, "CartHandler");

			const cart = await Cart.findOne({ userId }).session(session);
			if (!cart) {
				throw CommonErrors.cartNotFound();
			}

			// If client provided version, validate it
			if (version !== undefined && version !== cart.version) {
				throw createError(
					409,
					ErrorTypes.RESOURCE_CONFLICT,
					"Cart was modified. Please refresh and try again."
				);
			}

			try {
				return await OptimisticLocking.executeWithLock(
					Cart,
					cart._id instanceof Types.ObjectId
						? cart._id.toString()
						: (cart._id as string),
					cart.version,
					async (lockedCart) => {
						// Store status summary before clearing
						const previousStatus =
							this.generateStatusSummary(lockedCart);

						// Store items by status before clearing
						const clearedItems = {
							active: this.getItemsByStatus(lockedCart, "active"),
							discontinued: this.getItemsByStatus(
								lockedCart,
								"discontinued"
							),
							outOfStock: this.getItemsByStatus(
								lockedCart,
								"outOfStock"
							),
						};

						// Calculate totals before clearing
						const totalValues = lockedCart.items.reduce(
							(acc, item) => {
								if (item.status === "active") {
									acc.originalPrice +=
										item.currentPrice * item.quantity;
									acc.effectivePrice +=
										item.effectivePrice * item.quantity;
								}
								return acc;
							},
							{ originalPrice: 0, effectivePrice: 0 }
						);

						// Get counts for different types
						const itemCounts = {
							total: lockedCart.items.length,
							active: clearedItems.active.length,
							discontinued: clearedItems.discontinued.length,
							outOfStock: clearedItems.outOfStock.length,
						};

						// Clear the cart
						lockedCart.items = [];
						await lockedCart.save({ session });

						Logger.info(
							`Cleared cart for user ${userId}`,
							"CartHandler"
						);

						return reply.send({
							success: true,
							data: {
								message: "Cart cleared successfully",
								cart: lockedCart,
								clearanceReport: {
									itemCounts,
									previousStatus,
									clearedItems,
									totalValues: {
										originalPrice:
											totalValues.originalPrice,
										effectivePrice:
											totalValues.effectivePrice,
									},
								},
								version: lockedCart.version,
							},
						});
					}
				);
			} catch (error) {
				if (error instanceof OptimisticLockingError) {
					Logger.warn(
						`Concurrency conflict while clearing cart for user ${userId}`,
						"CartHandler"
					);
					throw createError(
						409,
						ErrorTypes.RESOURCE_CONFLICT,
						"Cart was modified by another operation. Please try again."
					);
				}
				throw error;
			}
		}, "CartHandler");
	}
}
