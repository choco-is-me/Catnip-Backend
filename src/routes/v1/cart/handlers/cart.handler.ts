// src/routes/v1/carts/handlers/carts.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Cart } from "../../../../models/Cart";
import { Item } from "../../../../models/Item";
import {
	AddToCartBody,
	CartItemParams,
	UpdateCartItemBody,
} from "../../../../schemas/cart";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
} from "../../../../utils/error-handler";
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
				cart = new Cart({ userId, items: [] });
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

			Logger.debug(
				`Adding item ${itemId} to cart for user ${userId}`,
				"CartHandler"
			);

			// Validate item exists and get its details
			const item = await Item.findById(itemId).session(session);
			if (!item) {
				throw CommonErrors.itemNotFound();
			}

			// Validate item status
			if (item.status !== "active") {
				throw createBusinessError("Item is not available for purchase");
			}

			// Find the variant
			const variant = item.variants.find((v) => v.sku === variantSku);
			if (!variant) {
				throw createBusinessError("Item variant not found");
			}

			// Check stock
			if (variant.stockQuantity < quantity) {
				throw createBusinessError(
					`Only ${variant.stockQuantity} items available in stock`
				);
			}

			// Get or create cart
			const cart = await this.getOrCreateCart(userId, session);

			// Check if item already exists in cart
			const existingItemIndex = cart.items.findIndex(
				(i) =>
					i.itemId.toString() === itemId &&
					i.variantSku === variantSku
			);

			if (existingItemIndex !== -1) {
				const newQuantity =
					cart.items[existingItemIndex].quantity + quantity;
				if (newQuantity > variant.stockQuantity) {
					throw createBusinessError(
						`Cannot add more items. Only ${variant.stockQuantity} available in stock`
					);
				}
				cart.items[existingItemIndex].quantity = newQuantity;
			} else {
				// Calculate effective price considering discounts
				const basePrice = variant.price;
				let effectivePrice = basePrice;

				if (item.discount && item.discount.active) {
					const now = new Date();
					if (
						now >= item.discount.startDate &&
						now <= item.discount.endDate
					) {
						effectivePrice =
							basePrice * (1 - item.discount.percentage / 100);
					}
				}

				// Add new item to cart
				cart.items.push({
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

			await cart.save({ session });

			Logger.info(
				`Item ${itemId} added to cart for user ${userId}`,
				"CartHandler"
			);

			return reply.code(200).send({
				success: true,
				data: {
					cart,
					addedItem:
						cart.items[
							existingItemIndex !== -1
								? existingItemIndex
								: cart.items.length - 1
						],
				},
			});
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
			const { quantity } = request.body;

			Logger.debug(
				`Updating quantity for item ${itemId} in cart for user ${userId}`,
				"CartHandler"
			);

			// Get cart
			const cart = await Cart.findOne({ userId }).session(session);
			if (!cart) {
				throw CommonErrors.cartNotFound();
			}

			// Find item in cart
			const itemIndex = cart.items.findIndex(
				(i) =>
					i.itemId.toString() === itemId &&
					i.variantSku === variantSku
			);

			if (itemIndex === -1) {
				throw createBusinessError("Item not found in cart");
			}

			// Validate stock
			if (!(await cart.validateStock(itemId, variantSku, quantity))) {
				throw createBusinessError(
					"Requested quantity exceeds available stock"
				);
			}

			// Update quantity
			cart.items[itemIndex].quantity = quantity;
			await cart.save({ session });

			Logger.info(
				`Updated quantity for item ${itemId} in cart for user ${userId}`,
				"CartHandler"
			);

			return reply.send({
				success: true,
				data: {
					cart,
					updatedItem: cart.items[itemIndex],
				},
			});
		}, "CartHandler");
	}

	// Remove item from cart
	async removeFromCart(
		request: FastifyRequest<{
			Params: Static<typeof CartItemParams>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const userId = request.user!.userId;
			const { itemId, variantSku } = request.params;

			Logger.debug(
				`Removing item ${itemId} from cart for user ${userId}`,
				"CartHandler"
			);

			const cart = await Cart.findOne({ userId }).session(session);
			if (!cart) {
				throw CommonErrors.cartNotFound();
			}

			const itemIndex = cart.items.findIndex(
				(i) =>
					i.itemId.toString() === itemId &&
					i.variantSku === variantSku
			);

			if (itemIndex === -1) {
				throw createBusinessError("Item not found in cart");
			}

			// Remove item
			cart.items.splice(itemIndex, 1);
			await cart.save({ session });

			Logger.info(
				`Removed item ${itemId} from cart for user ${userId}`,
				"CartHandler"
			);

			return reply.send({
				success: true,
				data: {
					cart,
					removedItem: { itemId, variantSku },
				},
			});
		}, "CartHandler");
	}

	// Get cart contents
	async getCart(request: FastifyRequest, reply: FastifyReply) {
		try {
			const userId = request.user!.userId;
			Logger.debug(`Retrieving cart for user ${userId}`, "CartHandler");

			const cart = await this.getOrCreateCart(userId);
			await cart.updatePrices(); // Ensure prices are up to date

			return reply.send({
				success: true,
				data: { cart },
			});
		} catch (error) {
			Logger.error(error as Error, "CartHandler");
			throw error;
		}
	}

	// Clear cart
	async clearCart(request: FastifyRequest, reply: FastifyReply) {
		return withTransaction(async (session) => {
			const userId = request.user!.userId;
			Logger.debug(`Clearing cart for user ${userId}`, "CartHandler");

			const cart = await Cart.findOne({ userId }).session(session);
			if (!cart) {
				throw CommonErrors.cartNotFound();
			}

			const itemCount = cart.items.length;
			cart.items = [];
			await cart.save({ session });

			Logger.info(`Cleared cart for user ${userId}`, "CartHandler");

			return reply.send({
				success: true,
				data: {
					message: "Cart cleared successfully",
					itemCount,
				},
			});
		}, "CartHandler");
	}
}
