// src/services/cart.service.ts
import mongoose from "mongoose";
import { CURRENCY_CONSTANTS } from "../constants/currency.constants";
import { Cart, ICart, ICartItem } from "../models/Cart";
import { Item, IItem } from "../models/Item";
import { Logger } from "../services/logger.service";
import { createBusinessError } from "../utils/error-handler";
import { withTransaction } from "../utils/transaction.utils";

enum StockStatus {
	IN_STOCK = "IN_STOCK",
	LOW_STOCK = "LOW_STOCK",
	OUT_OF_STOCK = "OUT_OF_STOCK",
	DISCONTINUED = "DISCONTINUED",
	UNKNOWN = "UNKNOWN",
}

interface StockChange {
	status: StockStatus;
	previousQuantity: number;
	currentQuantity: number;
	requestedQuantity: number;
	adjustedQuantity?: number;
	message?: string;
}

export default class CartService {
	/**
	 * Get or create a cart for a user with transaction support
	 */
	static async getOrCreateCart(
		userId: string,
		session?: mongoose.ClientSession
	): Promise<ICart> {
		// If no session is provided, handle it internally
		if (!session) {
			return withTransaction(async (s) => {
				return this.getOrCreateCart(userId, s);
			}, "CartService");
		}

		const userObjectId = new mongoose.Types.ObjectId(userId);

		let cart = await Cart.findOne({ userId: userObjectId }).session(
			session
		);

		if (!cart) {
			// Create a new cart for the user
			cart = new Cart({
				userId: userObjectId,
				items: [],
			});
			await cart.save({ session });
			Logger.debug(`Created new cart for user: ${userId}`, "CartService");
		} else if (cart.isExpired()) {
			// If cart exists but is expired, refresh it
			cart.refreshExpiry();
			await cart.save({ session });
			Logger.debug(
				`Refreshed expired cart for user: ${userId}`,
				"CartService"
			);
		}

		return cart;
	}

	/**
	 * Add an item to the cart
	 */
	static async addItemToCart(
		userId: string,
		itemId: string,
		variantSku: string,
		quantity: number,
		session?: mongoose.ClientSession
	): Promise<ICart> {
		if (!session) {
			return withTransaction(async (s) => {
				return this.addItemToCart(
					userId,
					itemId,
					variantSku,
					quantity,
					s
				);
			}, "CartService");
		}

		const cart = await this.getOrCreateCart(userId, session);

		// Validate item and variant
		const item = await this.validateItemAndVariant(itemId, variantSku);
		const variant = this.getVariant(item, variantSku);

		// Check quantity
		if (quantity <= 0) {
			throw createBusinessError("Quantity must be greater than 0");
		}

		// Check stock
		if (variant.stockQuantity < quantity) {
			throw createBusinessError(
				`Only ${variant.stockQuantity} items in stock`
			);
		}

		// Check if this would exceed max cart items
		if (
			cart.items.length >= CURRENCY_CONSTANTS.CART.MAX_ITEMS &&
			!cart.getItem(itemId, variantSku)
		) {
			throw createBusinessError(
				`Cannot add more items. Maximum cart size is ${CURRENCY_CONSTANTS.CART.MAX_ITEMS}`
			);
		}

		// Check if item is already in cart
		const existingItem = cart.getItem(itemId, variantSku);

		if (existingItem) {
			// Update quantity of existing item
			existingItem.quantity += quantity;
			existingItem.updatedAt = new Date();

			// Check if the new quantity exceeds stock
			if (existingItem.quantity > variant.stockQuantity) {
				throw createBusinessError(
					`Cannot add ${quantity} more items. Only ${variant.stockQuantity} in stock`
				);
			}
		} else {
			// Add new item to cart
			cart.items.push({
				itemId: new mongoose.Types.ObjectId(itemId),
				variantSku,
				quantity,
				addedAt: new Date(),
				updatedAt: new Date(),
			});
		}

		// Save cart with session
		await cart.save({ session });

		Logger.debug(
			`Added item ${itemId} (${variantSku}) to cart for user: ${userId}`,
			"CartService"
		);

		return cart;
	}

	/**
	 * Bulk add items to the cart
	 */
	static async bulkAddToCart(
		userId: string,
		items: Array<{ itemId: string; variantSku: string; quantity: number }>
	): Promise<{
		cart: ICart;
		results: Array<{
			success: boolean;
			itemId: string;
			variantSku: string;
			message?: string;
		}>;
	}> {
		// Get the user's cart
		const cart = await this.getOrCreateCart(userId);

		// Track results for each item
		const results: Array<{
			success: boolean;
			itemId: string;
			variantSku: string;
			message?: string;
		}> = [];

		// Check if adding these would exceed max cart items
		const newUniqueItemCount = items.filter(
			(newItem) =>
				!cart.items.some(
					(existingItem) =>
						existingItem.itemId.toString() === newItem.itemId &&
						existingItem.variantSku === newItem.variantSku
				)
		).length;

		if (
			cart.items.length + newUniqueItemCount >
			CURRENCY_CONSTANTS.CART.MAX_ITEMS
		) {
			throw createBusinessError(
				`Cannot add these items. Maximum cart size is ${CURRENCY_CONSTANTS.CART.MAX_ITEMS}`
			);
		}

		// Process each item
		for (const item of items) {
			try {
				// Validate item and variant
				const dbItem = await this.validateItemAndVariant(
					item.itemId,
					item.variantSku
				);
				const variant = this.getVariant(dbItem, item.variantSku);

				// Check quantity
				if (item.quantity <= 0) {
					results.push({
						success: false,
						itemId: item.itemId,
						variantSku: item.variantSku,
						message: "Quantity must be greater than 0",
					});
					continue;
				}

				// Check stock
				if (variant.stockQuantity < item.quantity) {
					results.push({
						success: false,
						itemId: item.itemId,
						variantSku: item.variantSku,
						message: `Only ${variant.stockQuantity} items in stock`,
					});
					continue;
				}

				// Check if item is already in cart
				const existingItemIndex = cart.items.findIndex(
					(cartItem) =>
						cartItem.itemId.toString() === item.itemId &&
						cartItem.variantSku === item.variantSku
				);

				if (existingItemIndex >= 0) {
					// Update quantity of existing item
					cart.items[existingItemIndex].quantity += item.quantity;
					cart.items[existingItemIndex].updatedAt = new Date();

					// Check if the new quantity exceeds stock
					if (
						cart.items[existingItemIndex].quantity >
						variant.stockQuantity
					) {
						results.push({
							success: false,
							itemId: item.itemId,
							variantSku: item.variantSku,
							message: `Cannot add ${item.quantity} more items. Only ${variant.stockQuantity} in stock`,
						});
						// Revert the quantity change
						cart.items[existingItemIndex].quantity -= item.quantity;
						continue;
					}
				} else {
					// Add new item to cart
					cart.items.push({
						itemId: new mongoose.Types.ObjectId(item.itemId),
						variantSku: item.variantSku,
						quantity: item.quantity,
						addedAt: new Date(),
						updatedAt: new Date(),
					});
				}

				results.push({
					success: true,
					itemId: item.itemId,
					variantSku: item.variantSku,
				});
			} catch (error) {
				results.push({
					success: false,
					itemId: item.itemId,
					variantSku: item.variantSku,
					message:
						error instanceof Error
							? error.message
							: "Unknown error",
				});
			}
		}

		// Save cart if any item was successfully added
		if (results.some((result) => result.success)) {
			await cart.save();
			Logger.debug(
				`Bulk added items to cart for user: ${userId}`,
				"CartService"
			);
		}

		return { cart, results };
	}

	/**
	 * Update item quantity in the cart
	 */
	static async updateItemQuantity(
		userId: string,
		itemId: string,
		variantSku: string,
		quantity: number
	): Promise<ICart> {
		const cart = await this.getOrCreateCart(userId);

		// Find the item in the cart
		const existingItemIndex = cart.items.findIndex(
			(item) =>
				item.itemId.toString() === itemId &&
				item.variantSku === variantSku
		);

		if (existingItemIndex === -1) {
			throw createBusinessError("Item not found in cart");
		}

		// Validate item still exists and check stock
		const item = await this.validateItemAndVariant(itemId, variantSku);
		const variant = this.getVariant(item, variantSku);

		if (quantity <= 0) {
			// Remove the item if quantity is 0 or negative
			cart.items.splice(existingItemIndex, 1);
		} else {
			// Check stock
			if (variant.stockQuantity < quantity) {
				throw createBusinessError(
					`Cannot update quantity. Only ${variant.stockQuantity} items in stock`
				);
			}

			// Update quantity
			cart.items[existingItemIndex].quantity = quantity;
			cart.items[existingItemIndex].updatedAt = new Date();
		}

		// Save cart
		await cart.save();
		Logger.debug(
			`Updated quantity for item ${itemId} (${variantSku}) in cart for user: ${userId}`,
			"CartService"
		);

		return cart;
	}

	/**
	 * Change item variant in the cart
	 */
	static async changeVariant(
		userId: string,
		itemId: string,
		currentVariantSku: string,
		newVariantSku: string
	): Promise<ICart> {
		const cart = await this.getOrCreateCart(userId);

		// Find the item in the cart
		const existingItemIndex = cart.items.findIndex(
			(item) =>
				item.itemId.toString() === itemId &&
				item.variantSku === currentVariantSku
		);

		if (existingItemIndex === -1) {
			throw createBusinessError("Item not found in cart");
		}

		const currentQuantity = cart.items[existingItemIndex].quantity;

		// Validate item and new variant
		const item = await this.validateItemAndVariant(itemId, newVariantSku);
		const variant = this.getVariant(item, newVariantSku);

		// Check stock for new variant
		if (variant.stockQuantity < currentQuantity) {
			throw createBusinessError(
				`Cannot change variant. Only ${variant.stockQuantity} items in stock for new variant`
			);
		}

		// Check if the new variant is already in the cart
		const newVariantIndex = cart.items.findIndex(
			(item) =>
				item.itemId.toString() === itemId &&
				item.variantSku === newVariantSku
		);

		if (newVariantIndex !== -1) {
			// Combine quantities
			cart.items[newVariantIndex].quantity += currentQuantity;

			// Remove the old item
			cart.items.splice(existingItemIndex, 1);

			// Check combined quantity against stock
			if (cart.items[newVariantIndex].quantity > variant.stockQuantity) {
				throw createBusinessError(
					`Cannot change variant. Combined quantity would exceed stock`
				);
			}

			cart.items[newVariantIndex].updatedAt = new Date();
		} else {
			// Just update the variant SKU
			cart.items[existingItemIndex].variantSku = newVariantSku;
			cart.items[existingItemIndex].updatedAt = new Date();
		}

		// Save cart
		await cart.save();
		Logger.debug(
			`Changed variant from ${currentVariantSku} to ${newVariantSku} for item ${itemId} in cart for user: ${userId}`,
			"CartService"
		);

		return cart;
	}

	/**
	 * Remove an item from the cart
	 */
	static async removeItem(
		userId: string,
		itemId: string,
		variantSku: string
	): Promise<ICart> {
		const cart = await this.getOrCreateCart(userId);

		// Find the item in the cart
		const existingItemIndex = cart.items.findIndex(
			(item) =>
				item.itemId.toString() === itemId &&
				item.variantSku === variantSku
		);

		if (existingItemIndex === -1) {
			throw createBusinessError("Item not found in cart");
		}

		// Remove the item
		cart.items.splice(existingItemIndex, 1);

		// Save cart
		await cart.save();

		Logger.debug(
			`Removed item ${itemId} (${variantSku}) from cart for user: ${userId}`,
			"CartService"
		);

		return cart;
	}

	/**
	 * Clear the cart
	 */
	static async clearCart(userId: string): Promise<ICart> {
		const cart = await this.getOrCreateCart(userId);

		// Clear all items
		cart.items = [];

		// Save cart
		await cart.save();
		Logger.debug(`Cleared cart for user: ${userId}`, "CartService");

		return cart;
	}

	/**
	 * Sync cart with current item data using aggregation pipeline
	 */
	static async syncCart(
		userId: string,
		forceSync: boolean = false
	): Promise<{
		cart: ICart;
		totals: {
			subtotal: number;
			totalItems: number;
			totalQuantity: number;
			isOrderBelowMinimum?: boolean;
			isOrderAboveMaximum?: boolean;
			minimumOrderValue?: number;
			maximumOrderValue?: number;
			orderMessage?: string;
		};
		itemDetails: Array<any>;
	}> {
		// Start with transaction for consistency
		return withTransaction(async (session) => {
			const cart = await this.getOrCreateCart(userId, session);

			// Return empty data for empty cart
			if (cart.items.length === 0) {
				return {
					cart,
					totals: { subtotal: 0, totalItems: 0, totalQuantity: 0 },
					itemDetails: [],
				};
			}

			// Check if we have a recent sync and if we're not forcing a sync
			const now = new Date().getTime();
			const SYNC_CACHE_TTL = 60000; // 1 minute in milliseconds
			if (
				!forceSync &&
				cart.lastSyncedAt &&
				cart.syncData &&
				now - cart.lastSyncedAt.getTime() < SYNC_CACHE_TTL
			) {
				Logger.debug(
					`Using cached sync data for user: ${userId}`,
					"CartService"
				);
				return cart.syncData;
			}

			// Get all item IDs in the cart
			const itemIds = Array.from(
				new Set(
					cart.items.map(
						(item) =>
							new mongoose.Types.ObjectId(item.itemId.toString())
					)
				)
			);

			// Use aggregation to get all items with their variants in one query
			const itemsData = await Item.aggregate([
				{
					$match: { _id: { $in: itemIds } },
				},
				{
					$project: {
						_id: 1,
						name: 1,
						images: 1,
						description: 1,
						status: 1,
						variants: 1,
						discount: 1,
					},
				},
			]).session(session);

			// Create a map for faster lookups
			const itemsMap = new Map();
			itemsData.forEach((item) => {
				itemsMap.set(item._id.toString(), item);
			});

			let subtotal = 0;
			const itemDetails: Array<any> = [];
			const updatedCartItems: ICartItem[] = [];

			// Process each cart item
			for (const cartItem of cart.items) {
				const itemId = cartItem.itemId.toString();
				const item = itemsMap.get(itemId);

				// Find the variant
				const variant = item?.variants.find(
					(v: any) => v.sku === cartItem.variantSku
				);

				// Get detailed stock information
				const stockInfo = this.getStockStatus(
					item as IItem,
					variant,
					cartItem.quantity
				);

				// Calculate current price with discounts
				let currentPrice = 0;
				let discountPercentage = 0;

				if (variant) {
					currentPrice = variant.price;

					if (item && item.discount?.active) {
						const now = new Date();
						if (
							now >= item.discount.startDate &&
							now <= item.discount.endDate
						) {
							discountPercentage = item.discount.percentage;
							currentPrice = Math.round(
								currentPrice * (1 - discountPercentage / 100)
							);
						}
					}
				}

				// Determine if item is available for purchase
				const isAvailable =
					stockInfo.status === StockStatus.IN_STOCK ||
					stockInfo.status === StockStatus.LOW_STOCK;

				// Add to subtotal if available
				const itemTotal = isAvailable
					? currentPrice *
					  Math.min(cartItem.quantity, stockInfo.currentQuantity)
					: 0;

				if (isAvailable) {
					subtotal += itemTotal;
				}

				// Add item to details with enhanced stock information
				itemDetails.push({
					item: {
						_id: item?._id || cartItem.itemId,
						name: item?.name || "Item no longer available",
						images: item?.images,
						description: item?.description,
						status: item?.status,
					},
					variant: variant
						? {
								sku: variant.sku,
								specifications: variant.specifications,
								price: variant.price,
								stockQuantity: variant.stockQuantity,
								effectivePrice: currentPrice,
								discountPercentage,
						  }
						: { sku: cartItem.variantSku },
					quantity: cartItem.quantity,
					itemTotal: isAvailable ? itemTotal : 0,
					isAvailable,
					hasChanged:
						stockInfo.status !== StockStatus.IN_STOCK ||
						stockInfo.previousQuantity !==
							stockInfo.currentQuantity,
					stockStatus: stockInfo.status,
					stockIssue: stockInfo.message,
					quantityAdjusted:
						stockInfo.adjustedQuantity !== undefined &&
						stockInfo.adjustedQuantity !==
							stockInfo.requestedQuantity,
					suggestedQuantity: stockInfo.adjustedQuantity,
				});

				// Keep the item in the cart with possibly adjusted quantity
				updatedCartItems.push({
					...cartItem,
					// If stock is less than quantity, don't update the cart item yet
					// This allows user to see the issue and decide what to do
				});
			}

			// Calculate totals
			const totalItems = updatedCartItems.length;
			const totalQuantity = updatedCartItems.reduce(
				(sum, item) => sum + item.quantity,
				0
			);

			// Validate order value
			const orderValueStatus = this.validateOrderValue(subtotal);

			const result = {
				cart,
				totals: {
					subtotal,
					totalItems,
					totalQuantity,
					isOrderBelowMinimum: orderValueStatus.belowMinimum,
					isOrderAboveMaximum: orderValueStatus.aboveMaximum,
					minimumOrderValue: CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE,
					maximumOrderValue: CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE,
					orderMessage: orderValueStatus.message,
				},
				itemDetails,
			};

			// Cache the sync result
			cart.lastSyncedAt = new Date();
			cart.syncData = result;
			await cart.save({ session });

			Logger.debug(`Synced cart for user: ${userId}`, "CartService");

			return result;
		}, "CartService");
	}

	/**
	 * Helper to validate an item and variant existence
	 */
	private static async validateItemAndVariant(
		itemId: string,
		variantSku: string
	): Promise<IItem> {
		if (!mongoose.Types.ObjectId.isValid(itemId)) {
			throw createBusinessError("Invalid item ID format");
		}

		const item = await Item.findById(itemId);

		if (!item) {
			throw createBusinessError("Item not found");
		}

		if (item.status !== "active") {
			throw createBusinessError("Item is not active");
		}

		const variant = item.variants.find((v) => v.sku === variantSku);

		if (!variant) {
			throw createBusinessError(
				`Variant with SKU ${variantSku} not found for this item`
			);
		}

		return item;
	}

	/**
	 * Helper to get a variant from an item
	 */
	private static getVariant(item: IItem, variantSku: string): any {
		const variant = item.variants.find((v) => v.sku === variantSku);

		if (!variant) {
			throw createBusinessError(
				`Variant with SKU ${variantSku} not found for this item`
			);
		}

		return variant;
	}

	/**
	 * Validates if an order value meets minimum and maximum requirements
	 */
	static validateOrderValue(subtotal: number): {
		isValid: boolean;
		belowMinimum: boolean;
		aboveMaximum: boolean;
		message?: string;
	} {
		// Check minimum order value
		if (subtotal < CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE) {
			return {
				isValid: false,
				belowMinimum: true,
				aboveMaximum: false,
				message: CURRENCY_CONSTANTS.ERRORS.MIN_ORDER(
					CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE
				),
			};
		}

		// Check maximum order value
		if (subtotal > CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE) {
			return {
				isValid: false,
				belowMinimum: false,
				aboveMaximum: true,
				message: CURRENCY_CONSTANTS.ERRORS.MAX_ORDER(
					CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE
				),
			};
		}

		// Order value is valid
		return {
			isValid: true,
			belowMinimum: false,
			aboveMaximum: false,
		};
	}

	/**
	 * Invalidate cart cache for all carts containing a specific item
	 * Call this method whenever an item's price, stock, or discount changes
	 */
	static async invalidateCartCacheForItem(
		itemId: string,
		variantSku?: string
	): Promise<void> {
		return withTransaction(async (session) => {
			const query: any = {};

			if (variantSku) {
				// If variant is specified, only invalidate carts with that specific variant
				query["items.itemId"] = new mongoose.Types.ObjectId(itemId);
				query["items.variantSku"] = variantSku;
			} else {
				// Otherwise invalidate all carts containing the item
				query["items.itemId"] = new mongoose.Types.ObjectId(itemId);
			}

			// Set lastSyncedAt to null for affected carts to force resync
			const updateResult = await Cart.updateMany(
				query,
				{ $set: { lastSyncedAt: null } },
				{ session }
			);

			Logger.debug(
				`Invalidated cache for ${
					updateResult.modifiedCount
				} carts containing item ${itemId}${
					variantSku ? ` (variant: ${variantSku})` : ""
				}`,
				"CartService"
			);
		}, "CartService");
	}

	/**
	 * Gets the available items from a cart (in stock and active)
	 * and calculates if the order can be placed
	 */
	static async getOrderableItems(userId: string): Promise<{
		availableItems: Array<any>;
		unavailableItems: Array<any>;
		subtotal: number;
		orderValueStatus: {
			isValid: boolean;
			belowMinimum: boolean;
			aboveMaximum: boolean;
			message?: string;
		};
	}> {
		// Sync the cart first to get current data
		const syncResult = await this.syncCart(userId, true);

		// Split items into available and unavailable
		const availableItems = syncResult.itemDetails.filter(
			(detail) =>
				detail.isAvailable &&
				detail.variant.stockQuantity >= detail.quantity
		);

		const unavailableItems = syncResult.itemDetails.filter(
			(detail) =>
				!detail.isAvailable ||
				detail.variant.stockQuantity < detail.quantity
		);

		// Calculate subtotal of available items
		const subtotal = availableItems.reduce(
			(sum, item) => sum + item.itemTotal,
			0
		);

		// Validate the order value
		const orderValueStatus = this.validateOrderValue(subtotal);

		return {
			availableItems,
			unavailableItems,
			subtotal,
			orderValueStatus,
		};
	}

	// Add this helper method to get item stock status
	private static getStockStatus(
		item: IItem,
		variant: any,
		requestedQuantity: number
	): StockChange {
		if (!item || item.status !== "active") {
			return {
				status: StockStatus.DISCONTINUED,
				previousQuantity: 0,
				currentQuantity: 0,
				requestedQuantity,
				message: "Item is no longer available",
			};
		}

		if (!variant) {
			return {
				status: StockStatus.UNKNOWN,
				previousQuantity: 0,
				currentQuantity: 0,
				requestedQuantity,
				message: "Variant is no longer available",
			};
		}

		if (variant.stockQuantity === 0) {
			return {
				status: StockStatus.OUT_OF_STOCK,
				previousQuantity: variant.stockQuantity,
				currentQuantity: 0,
				requestedQuantity,
				adjustedQuantity: 0,
				message: "Item is out of stock",
			};
		}

		if (variant.stockQuantity < requestedQuantity) {
			return {
				status: StockStatus.LOW_STOCK,
				previousQuantity: requestedQuantity,
				currentQuantity: variant.stockQuantity,
				requestedQuantity,
				adjustedQuantity: variant.stockQuantity,
				message: `Only ${variant.stockQuantity} items available`,
			};
		}

		// Check if the variant has a low stock threshold
		if (
			variant.lowStockThreshold &&
			variant.stockQuantity <= variant.lowStockThreshold
		) {
			return {
				status: StockStatus.LOW_STOCK,
				previousQuantity: requestedQuantity,
				currentQuantity: variant.stockQuantity,
				requestedQuantity,
				message: `Only ${variant.stockQuantity} items left`,
			};
		}

		return {
			status: StockStatus.IN_STOCK,
			previousQuantity: requestedQuantity,
			currentQuantity: variant.stockQuantity,
			requestedQuantity,
		};
	}
}
