// src/services/cart.service.ts
import mongoose from 'mongoose';
import {
    CURRENCY_CONSTANTS,
    formatVNDPrice,
} from '../constants/currency.constants';
import { Cart, ICart, ICartItem } from '../models/Cart';
import { IItem, Item } from '../models/Item';
import { Logger } from '../services/logger.service';
import { CartItemDetail, CartSyncResponse } from '../types/cart.types';
import { createBusinessError } from '../utils/error-handler';
import { withTransaction } from '../utils/transaction.utils';

enum StockStatus {
    IN_STOCK = 'IN_STOCK',
    LOW_STOCK = 'LOW_STOCK',
    OUT_OF_STOCK = 'OUT_OF_STOCK',
    DISCONTINUED = 'DISCONTINUED',
    VARIANT_UNAVAILABLE = 'VARIANT_UNAVAILABLE',
    ITEM_UNAVAILABLE = 'ITEM_UNAVAILABLE',
    PRICE_CHANGED = 'PRICE_CHANGED',
    UNKNOWN = 'UNKNOWN',
}

interface StockChange {
    status: StockStatus;
    previousQuantity: number;
    currentQuantity: number;
    requestedQuantity: number;
    adjustedQuantity?: number;
    message?: string;
    severity: 'info' | 'warning' | 'error';
    actionRequired: boolean;
    recommendation?: string;
    previousPrice?: number;
    currentPrice?: number;
    priceChanged?: boolean;
}

export default class CartService {
    /**
     * Get or create a cart for a user with transaction support
     */
    static async getOrCreateCart(
        userId: string,
        session?: mongoose.ClientSession,
    ): Promise<ICart> {
        // If no session is provided, handle it internally
        if (!session) {
            return withTransaction(async (s) => {
                return this.getOrCreateCart(userId, s);
            }, 'CartService');
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);

        let cart = await Cart.findOne({ userId: userObjectId }).session(
            session,
        );

        if (!cart) {
            // Create a new cart for the user
            cart = new Cart({
                userId: userObjectId,
                items: [],
            });
            await cart.save({ session });
            Logger.debug(`Created new cart for user: ${userId}`, 'CartService');
        } else if (cart.isExpired()) {
            // If cart exists but is expired, refresh it
            cart.refreshExpiry();
            await cart.save({ session });
            Logger.debug(
                `Refreshed expired cart for user: ${userId}`,
                'CartService',
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
        session?: mongoose.ClientSession,
    ): Promise<ICart> {
        if (!session) {
            return withTransaction(async (s) => {
                return this.addItemToCart(
                    userId,
                    itemId,
                    variantSku,
                    quantity,
                    s,
                );
            }, 'CartService');
        }

        const cart = await this.getOrCreateCart(userId, session);

        // Validate item and variant
        const item = await this.validateItemAndVariant(itemId, variantSku);
        const variant = this.getVariant(item, variantSku);

        // Check quantity
        if (quantity <= 0) {
            throw createBusinessError('Quantity must be greater than 0');
        }

        // Check stock
        if (variant.stockQuantity < quantity) {
            throw createBusinessError(
                `Only ${variant.stockQuantity} items in stock`,
            );
        }

        // Check if this would exceed max cart items
        if (
            cart.items.length >= CURRENCY_CONSTANTS.CART.MAX_ITEMS &&
            !cart.getItem(itemId, variantSku)
        ) {
            throw createBusinessError(
                `Cannot add more items. Maximum cart size is ${CURRENCY_CONSTANTS.CART.MAX_ITEMS}`,
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
                    `Cannot add ${quantity} more items. Only ${variant.stockQuantity} in stock`,
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
            'CartService',
        );

        return cart;
    }

    /**
     * Bulk add items to the cart
     */
    static async bulkAddToCart(
        userId: string,
        items: Array<{ itemId: string; variantSku: string; quantity: number }>,
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
                        existingItem.variantSku === newItem.variantSku,
                ),
        ).length;

        if (
            cart.items.length + newUniqueItemCount >
            CURRENCY_CONSTANTS.CART.MAX_ITEMS
        ) {
            throw createBusinessError(
                `Cannot add these items. Maximum cart size is ${CURRENCY_CONSTANTS.CART.MAX_ITEMS}`,
            );
        }

        // Process each item
        for (const item of items) {
            try {
                // Validate item and variant
                const dbItem = await this.validateItemAndVariant(
                    item.itemId,
                    item.variantSku,
                );
                const variant = this.getVariant(dbItem, item.variantSku);

                // Check quantity
                if (item.quantity <= 0) {
                    results.push({
                        success: false,
                        itemId: item.itemId,
                        variantSku: item.variantSku,
                        message: 'Quantity must be greater than 0',
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
                        cartItem.variantSku === item.variantSku,
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
                // Improved error handling
                let errorMessage = 'Unknown error';

                // Handle business errors
                if (error && typeof error === 'object') {
                    if (
                        'message' in error &&
                        typeof error.message === 'string'
                    ) {
                        errorMessage = error.message;
                    } else if (
                        'error' in error &&
                        typeof error.error === 'string'
                    ) {
                        errorMessage = error.error;
                    }
                }

                results.push({
                    success: false,
                    itemId: item.itemId,
                    variantSku: item.variantSku,
                    message: errorMessage,
                });
            }
        }

        // Save cart if any item was successfully added
        if (results.some((result) => result.success)) {
            await cart.save();
            Logger.debug(
                `Bulk added items to cart for user: ${userId}`,
                'CartService',
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
        quantity: number,
    ): Promise<ICart> {
        const cart = await this.getOrCreateCart(userId);

        // Find the item in the cart
        const existingItem = cart.items.find(
            (item) =>
                item.itemId.toString() === itemId &&
                item.variantSku === variantSku,
        );

        if (!existingItem) {
            // Check if the item exists in cart but with different variant
            const itemExists = cart.items.some(
                (item) => item.itemId.toString() === itemId,
            );

            if (itemExists) {
                throw createBusinessError(
                    `Variant ${variantSku} not found in cart for this item`,
                );
            } else {
                throw createBusinessError('Item not found in cart');
            }
        }

        // Validate item still exists and check stock
        const item = await this.validateItemAndVariant(itemId, variantSku);
        const variant = this.getVariant(item, variantSku);

        if (quantity <= 0) {
            // Remove the item if quantity is 0 or negative
            cart.items = cart.items.filter(
                (item) =>
                    !(
                        item.itemId.toString() === itemId &&
                        item.variantSku === variantSku
                    ),
            );
        } else {
            // Check stock
            if (variant.stockQuantity < quantity) {
                throw createBusinessError(
                    `Cannot update quantity. Only ${variant.stockQuantity} items in stock`,
                );
            }

            // Update quantity
            existingItem.quantity = quantity;
            existingItem.updatedAt = new Date();
        }

        // Save cart
        await cart.save();
        Logger.debug(
            `Updated quantity for item ${itemId} (${variantSku}) in cart for user: ${userId}`,
            'CartService',
        );

        return cart;
    }

    /**
     * Change item variant in the cart with an optimized approach using a single update operation
     */
    static async changeVariant(
        userId: string,
        itemId: string,
        currentVariantSku: string,
        newVariantSku: string,
    ): Promise<ICart> {
        return withTransaction(async (session) => {
            const cart = await this.getOrCreateCart(userId, session);

            // Validate current variant exists in cart
            const existingItem = cart.items.find(
                (item) =>
                    item.itemId.toString() === itemId &&
                    item.variantSku === currentVariantSku,
            );

            if (!existingItem) {
                // Check if the item exists in cart but with different variant
                const existingVariants = cart.items
                    .filter((item) => item.itemId.toString() === itemId)
                    .map((item) => item.variantSku);

                if (existingVariants.length > 0) {
                    throw createBusinessError(
                        `Variant ${currentVariantSku} not found in cart for this item. Available variants: ${existingVariants.join(
                            ', ',
                        )}`,
                    );
                } else {
                    throw createBusinessError('Item not found in cart');
                }
            }

            // Get current quantity before any changes
            const currentQuantity = existingItem.quantity;

            // Validate item and new variant
            const item = await this.validateItemAndVariant(
                itemId,
                newVariantSku,
            );
            const variant = this.getVariant(item, newVariantSku);

            // Check stock for new variant
            if (variant.stockQuantity < currentQuantity) {
                throw createBusinessError(
                    `Cannot change variant. Only ${variant.stockQuantity} items in stock for new variant`,
                );
            }

            // Check if the new variant is already in the cart
            const newVariantIndex = cart.items.findIndex(
                (item) =>
                    item.itemId.toString() === itemId &&
                    item.variantSku === newVariantSku,
            );

            // Use a single update operation with atomic modifications
            if (newVariantIndex !== -1) {
                // Case: New variant already exists in cart - combine quantities with a single update

                // First, calculate the new total quantity
                const newTotalQuantity =
                    cart.items[newVariantIndex].quantity + currentQuantity;

                // Check if the combined quantity exceeds stock
                if (newTotalQuantity > variant.stockQuantity) {
                    throw createBusinessError(
                        `Cannot change variant. Combined quantity (${newTotalQuantity}) would exceed available stock (${variant.stockQuantity})`,
                    );
                }

                // Update the existing entry with new variant
                cart.items[newVariantIndex].quantity = newTotalQuantity;
                cart.items[newVariantIndex].updatedAt = new Date();

                // Remove the old variant in a single operation
                cart.items = cart.items.filter(
                    (item) =>
                        !(
                            item.itemId.toString() === itemId &&
                            item.variantSku === currentVariantSku
                        ),
                );

                Logger.debug(
                    `Combined quantities for item ${itemId}, changing variant from ${currentVariantSku} to existing ${newVariantSku}`,
                    'CartService',
                );
            } else {
                // Case: New variant doesn't exist - modify existing entry in place

                // Update the current item entry with new variant details
                existingItem.variantSku = newVariantSku;
                existingItem.updatedAt = new Date();

                Logger.debug(
                    `Changed variant from ${currentVariantSku} to ${newVariantSku} for item ${itemId}`,
                    'CartService',
                );
            }

            // Save cart
            await cart.save({ session });

            return cart;
        }, 'CartService');
    }

    /**
     * Remove an item from the cart
     */
    static async removeItem(
        userId: string,
        itemId: string,
        variantSku: string,
    ): Promise<ICart> {
        const cart = await this.getOrCreateCart(userId);

        // Find the item in the cart
        const existingItem = cart.items.find(
            (item) =>
                item.itemId.toString() === itemId &&
                item.variantSku === variantSku,
        );

        if (!existingItem) {
            // Check if the item exists in cart but with different variant
            const itemExists = cart.items.some(
                (item) => item.itemId.toString() === itemId,
            );

            if (itemExists) {
                throw createBusinessError(
                    `Variant ${variantSku} not found in cart for this item`,
                );
            } else {
                throw createBusinessError('Item not found in cart');
            }
        }

        // Remove the item
        cart.items = cart.items.filter(
            (item) =>
                !(
                    item.itemId.toString() === itemId &&
                    item.variantSku === variantSku
                ),
        );

        // Save cart
        await cart.save();

        Logger.debug(
            `Removed item ${itemId} (${variantSku}) from cart for user: ${userId}`,
            'CartService',
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
        Logger.debug(`Cleared cart for user: ${userId}`, 'CartService');

        return cart;
    }

    /**
     * Sync cart with current item data using aggregation pipeline
     */
    // Optimized syncCart method for CartService
    static async syncCart(
        userId: string,
        forceSync: boolean = false,
        itemIds?: string[],
    ): Promise<CartSyncResponse> {
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

            // Check cache invalidation flag with proper null check
            const cacheValid =
                cart.lastSyncedAt != null &&
                cart.syncData != null &&
                now - cart.lastSyncedAt.getTime() < SYNC_CACHE_TTL &&
                !forceSync;

            // If specific itemIds are provided, we need to check if they're in the cached data
            if (cacheValid && itemIds && itemIds.length > 0 && cart.syncData) {
                const cachedItemIds = new Set(
                    cart.syncData.itemDetails.map((detail: CartItemDetail) =>
                        detail.item._id.toString(),
                    ),
                );
                const allItemsInCache = itemIds.every((id) =>
                    cachedItemIds.has(id),
                );

                // If all requested items are in cache, we can use the cached data
                if (allItemsInCache) {
                    Logger.debug(
                        `Using cached sync data for user: ${userId} (partial sync)`,
                        'CartService',
                    );

                    // If we only need specific items, filter the cache
                    if (itemIds.length < cachedItemIds.size) {
                        const filteredDetails =
                            cart.syncData.itemDetails.filter(
                                (detail: CartItemDetail) =>
                                    itemIds.includes(
                                        detail.item._id.toString(),
                                    ),
                            );

                        // Return filtered data with same totals
                        return {
                            cart,
                            totals: cart.syncData.totals,
                            itemDetails: filteredDetails,
                            stockIssues: cart.syncData.stockIssues,
                        };
                    }

                    return {
                        cart,
                        totals: cart.syncData.totals,
                        itemDetails: cart.syncData.itemDetails,
                        stockIssues: cart.syncData.stockIssues,
                    };
                }
            } else if (cacheValid && cart.syncData) {
                Logger.debug(
                    `Using cached sync data for user: ${userId}`,
                    'CartService',
                );
                return {
                    cart,
                    totals: cart.syncData.totals,
                    itemDetails: cart.syncData.itemDetails,
                    stockIssues: cart.syncData.stockIssues,
                };
            }

            // Get all item IDs in the cart or use the provided ones
            const cartItemIds = cart.items.map((item) =>
                item.itemId.toString(),
            );
            const targetItemIds = itemIds || cartItemIds;

            // Create ObjectId references for lookup
            const itemIdsToFetch = Array.from(
                new Set(
                    targetItemIds.map((id) => new mongoose.Types.ObjectId(id)),
                ),
            );

            // Use lean queries and specific projections to reduce data transfer
            const itemsData = await Item.aggregate([
                {
                    $match: { _id: { $in: itemIdsToFetch } },
                },
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        images: { $slice: ['$images', 1] }, // Only get first image
                        variants: 1,
                        discount: 1,
                        status: 1,
                    },
                },
            ]).session(session);

            // Create a map for faster lookups
            const itemsMap = new Map();
            itemsData.forEach((item) => {
                itemsMap.set(item._id.toString(), item);
            });

            let subtotal = 0;
            const itemDetails: CartItemDetail[] = [];
            const updatedCartItems: ICartItem[] = [];
            const stockIssues: Array<{
                itemId: string;
                variantSku: string;
                issue: string;
                severity?: 'info' | 'warning' | 'error';
                actionRequired?: boolean;
                recommendation?: string;
            }> = [];

            // Process each cart item
            for (const cartItem of cart.items) {
                const itemId = cartItem.itemId.toString();

                // Skip items not in our target list if we're doing a partial sync
                if (!targetItemIds.includes(itemId)) {
                    continue;
                }

                const item = itemsMap.get(itemId);

                // Find the variant
                const variant = item?.variants.find(
                    (v: any) => v.sku === cartItem.variantSku,
                );

                // Get detailed stock information
                const stockInfo = this.getStockStatus(
                    item as IItem,
                    variant,
                    cartItem.quantity,
                );

                // Calculate current price with discounts - with NaN protection
                let currentPrice = 0;
                let discountPercentage = 0;

                if (variant && typeof variant.price === 'number') {
                    currentPrice = variant.price;

                    if (item && item.discount?.active) {
                        const now = new Date();
                        if (
                            now >= item.discount.startDate &&
                            now <= item.discount.endDate &&
                            typeof item.discount.percentage === 'number'
                        ) {
                            discountPercentage = item.discount.percentage;
                            currentPrice = Math.round(
                                currentPrice * (1 - discountPercentage / 100),
                            );
                        }
                    }
                }

                // Determine if item is available for purchase
                const isAvailable =
                    stockInfo.status === StockStatus.IN_STOCK ||
                    stockInfo.status === StockStatus.LOW_STOCK;

                // Track stock issues
                if (
                    !isAvailable ||
                    stockInfo.currentQuantity < cartItem.quantity
                ) {
                    stockIssues.push({
                        itemId,
                        variantSku: cartItem.variantSku,
                        issue: stockInfo.message || 'Stock issue detected',
                        severity: stockInfo.severity,
                        actionRequired: stockInfo.actionRequired || false,
                        recommendation: stockInfo.recommendation,
                    });
                }

                // Add to subtotal if available - with NaN protection
                const itemTotal =
                    isAvailable &&
                    !isNaN(currentPrice) &&
                    !isNaN(stockInfo.currentQuantity)
                        ? currentPrice *
                          Math.min(cartItem.quantity, stockInfo.currentQuantity)
                        : 0;

                if (isAvailable && !isNaN(itemTotal)) {
                    subtotal += itemTotal;
                }

                // Add item to details with enhanced stock information
                itemDetails.push({
                    item: {
                        _id: item?._id || cartItem.itemId,
                        name: item?.name || 'Item no longer available',
                        images: item?.images,
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
                    itemTotal: isAvailable && !isNaN(itemTotal) ? itemTotal : 0,
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
                });
            }

            // Calculate totals - with NaN protection
            const totalItems = !isNaN(updatedCartItems.length)
                ? updatedCartItems.length
                : 0;
            const totalQuantity = !isNaN(
                updatedCartItems.reduce(
                    (sum, item) =>
                        sum + (isNaN(item.quantity) ? 0 : item.quantity),
                    0,
                ),
            )
                ? updatedCartItems.reduce(
                      (sum, item) =>
                          sum + (isNaN(item.quantity) ? 0 : item.quantity),
                      0,
                  )
                : 0;

            // Validate order value
            const orderValueStatus = this.validateOrderValue(
                !isNaN(subtotal) ? subtotal : 0,
            );

            // Create syncData object WITH NaN PROTECTION
            const syncData = {
                totals: {
                    subtotal: isNaN(subtotal) ? 0 : subtotal,
                    totalItems: isNaN(totalItems) ? 0 : totalItems,
                    totalQuantity: isNaN(totalQuantity) ? 0 : totalQuantity,
                    isOrderBelowMinimum: orderValueStatus.belowMinimum || false,
                    isOrderAboveMaximum: orderValueStatus.aboveMaximum || false,
                    minimumOrderValue: CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE,
                    maximumOrderValue: CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE,
                    orderMessage: orderValueStatus.message || '',
                    // Use nullish coalescing to provide a default value
                    shortfall: orderValueStatus.shortfall ?? 0,
                    excess: orderValueStatus.excess ?? 0,
                },
                itemDetails,
                stockIssues: stockIssues.length > 0 ? stockIssues : undefined,
            };

            // Cache the sync result (without circular reference)
            cart.lastSyncedAt = new Date();
            cart.syncData = syncData;
            await cart.save({ session });

            Logger.debug(`Synced cart for user: ${userId}`, 'CartService');

            // Return complete result with the cart included
            return {
                cart,
                ...syncData,
            };
        }, 'CartService');
    }

    /**
     * Helper to validate an item and variant existence
     */
    private static async validateItemAndVariant(
        itemId: string,
        variantSku: string,
    ): Promise<IItem> {
        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            throw createBusinessError('Invalid item ID format');
        }

        const item = await Item.findById(itemId);

        if (!item) {
            throw createBusinessError('Item not found');
        }

        if (item.status !== 'active') {
            throw createBusinessError('Item is not active');
        }

        const variant = item.variants.find((v) => v.sku === variantSku);

        if (!variant) {
            throw createBusinessError(
                `Variant with SKU ${variantSku} not found for this item`,
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
                `Variant with SKU ${variantSku} not found for this item`,
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
        shortfall?: number;
        excess?: number;
    } {
        // Check minimum order value
        if (subtotal < CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE) {
            const shortfall =
                CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE - subtotal;
            return {
                isValid: false,
                belowMinimum: true,
                aboveMaximum: false,
                message: `Your order total is ${formatVNDPrice(
                    subtotal,
                )}, which is below our minimum order value. Please add items worth at least ${formatVNDPrice(
                    shortfall,
                )} more to proceed.`,
                shortfall,
            };
        }

        // Check maximum order value
        if (subtotal > CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE) {
            const excess = subtotal - CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE;
            return {
                isValid: false,
                belowMinimum: false,
                aboveMaximum: true,
                message: `Your order total exceeds our maximum order value of ${formatVNDPrice(
                    CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE,
                )}. Please reduce your order by at least ${formatVNDPrice(
                    excess,
                )}.`,
                excess,
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
        variantSku?: string,
    ): Promise<void> {
        return withTransaction(async (session) => {
            const query: any = {};

            if (variantSku) {
                // If variant is specified, only invalidate carts with that specific variant
                query['items.itemId'] = new mongoose.Types.ObjectId(itemId);
                query['items.variantSku'] = variantSku;
            } else {
                // Otherwise invalidate all carts containing the item
                query['items.itemId'] = new mongoose.Types.ObjectId(itemId);
            }

            // Set lastSyncedAt to null for affected carts to force resync
            const updateResult = await Cart.updateMany(
                query,
                { $set: { lastSyncedAt: null } },
                { session },
            );

            Logger.debug(
                `Invalidated cache for ${
                    updateResult.modifiedCount
                } carts containing item ${itemId}${
                    variantSku ? ` (variant: ${variantSku})` : ''
                }`,
                'CartService',
            );
        }, 'CartService');
    }

    /**
     * Gets the available items from a cart (in stock and active)
     * and calculates if the order can be placed
     */
    static async getOrderableItems(userId: string): Promise<{
        availableItems: CartItemDetail[];
        unavailableItems: CartItemDetail[];
        subtotal: number;
        orderValueStatus: {
            isValid: boolean;
            belowMinimum: boolean;
            aboveMaximum: boolean;
            message?: string;
            shortfall?: number;
            excess?: number;
        };
    }> {
        // Sync the cart first to get current data
        const syncResult = await this.syncCart(userId, true);

        // Split items into available and unavailable with proper null checks
        const availableItems = syncResult.itemDetails.filter(
            (detail) =>
                detail.isAvailable &&
                // Check if stockQuantity exists and is sufficient
                detail.variant.stockQuantity !== undefined &&
                detail.variant.stockQuantity >= detail.quantity,
        );

        const unavailableItems = syncResult.itemDetails.filter(
            (detail) =>
                !detail.isAvailable ||
                // Check if stockQuantity is undefined or insufficient
                detail.variant.stockQuantity === undefined ||
                detail.variant.stockQuantity < detail.quantity,
        );

        // Calculate subtotal of available items
        const subtotal = availableItems.reduce(
            (sum, item) => sum + item.itemTotal,
            0,
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

    // Helper method to calculate effective price with discounts
    private static calculateEffectivePrice(item: IItem, variant: any): number {
        if (!variant) return 0;

        let currentPrice = variant.price;

        if (item && item.discount?.active) {
            const now = new Date();
            if (
                now >= item.discount.startDate &&
                now <= item.discount.endDate
            ) {
                currentPrice = Math.round(
                    currentPrice * (1 - item.discount.percentage / 100),
                );
            }
        }

        return currentPrice;
    }

    // Helper method to get stock status for an item and variant
    private static getStockStatus(
        item: IItem,
        variant: any,
        requestedQuantity: number,
        previousPrice?: number,
    ): StockChange {
        // Item not found or discontinued
        if (!item) {
            return {
                status: StockStatus.ITEM_UNAVAILABLE,
                previousQuantity: 0,
                currentQuantity: 0,
                requestedQuantity,
                message: 'Item is no longer available in our catalog',
                severity: 'error',
                actionRequired: true,
                recommendation: 'Please remove this item from your cart',
            };
        }

        if (item.status !== 'active') {
            return {
                status: StockStatus.DISCONTINUED,
                previousQuantity: 0,
                currentQuantity: 0,
                requestedQuantity,
                message: `This item is no longer available (Status: ${item.status})`,
                severity: 'error',
                actionRequired: true,
                recommendation:
                    'This item has been discontinued. Please remove it from your cart.',
            };
        }

        // Variant not found
        if (!variant) {
            return {
                status: StockStatus.VARIANT_UNAVAILABLE,
                previousQuantity: 0,
                currentQuantity: 0,
                requestedQuantity,
                message: 'This variant is no longer available',
                severity: 'error',
                actionRequired: true,
                recommendation:
                    'This product variant is no longer offered. Please select a different variant or remove this item.',
            };
        }

        // Check for price changes if previous price is provided
        if (previousPrice !== undefined) {
            const currentPrice = this.calculateEffectivePrice(item, variant);
            const priceChanged = previousPrice !== currentPrice;

            if (priceChanged) {
                // Return price change information along with stock info
                const priceDifference = currentPrice - previousPrice;
                const percentChange = (
                    (priceDifference / previousPrice) *
                    100
                ).toFixed(1);
                const direction =
                    priceDifference > 0 ? 'increased' : 'decreased';

                return {
                    status: StockStatus.PRICE_CHANGED,
                    previousQuantity: requestedQuantity,
                    currentQuantity: variant.stockQuantity,
                    requestedQuantity,
                    message: `Price has ${direction} by ${Math.abs(
                        priceDifference,
                    ).toLocaleString()} VND (${Math.abs(
                        parseFloat(percentChange),
                    )}%)`,
                    severity: 'info',
                    actionRequired: false,
                    recommendation:
                        'Please review the updated price before proceeding',
                    previousPrice,
                    currentPrice,
                    priceChanged: true,
                };
            }
        }

        // Out of stock
        if (variant.stockQuantity === 0) {
            return {
                status: StockStatus.OUT_OF_STOCK,
                previousQuantity: variant.stockQuantity,
                currentQuantity: 0,
                requestedQuantity,
                adjustedQuantity: 0,
                message: 'This item is currently out of stock',
                severity: 'error',
                actionRequired: true,
                recommendation: 'Please remove this item or save it for later',
            };
        }

        // Quantity requested exceeds available stock
        if (variant.stockQuantity < requestedQuantity) {
            return {
                status: StockStatus.LOW_STOCK,
                previousQuantity: requestedQuantity,
                currentQuantity: variant.stockQuantity,
                requestedQuantity,
                adjustedQuantity: variant.stockQuantity,
                message: `Only ${variant.stockQuantity} items available (you requested ${requestedQuantity})`,
                severity: 'warning',
                actionRequired: true,
                recommendation: `Please reduce quantity to ${variant.stockQuantity} or fewer units`,
            };
        }

        // Low stock warning
        if (
            variant.lowStockThreshold &&
            variant.stockQuantity <= variant.lowStockThreshold
        ) {
            return {
                status: StockStatus.LOW_STOCK,
                previousQuantity: requestedQuantity,
                currentQuantity: variant.stockQuantity,
                requestedQuantity,
                message: `Only ${variant.stockQuantity} items left in stock`,
                severity: 'warning',
                actionRequired: false,
                recommendation: 'Consider completing your purchase soon',
            };
        }

        // Normal in-stock status
        return {
            status: StockStatus.IN_STOCK,
            previousQuantity: requestedQuantity,
            currentQuantity: variant.stockQuantity,
            requestedQuantity,
            severity: 'info',
            actionRequired: false,
        };
    }
}
