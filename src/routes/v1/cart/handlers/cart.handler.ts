// src/routes/v1/cart/handlers/cart.handler.ts
import { Static } from '@sinclair/typebox';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
    AddToCartBody,
    BulkAddToCartBody,
    ChangeVariantBody,
    UpdateCartItemBody,
} from '../../../../schemas/cart';
import CartService from '../../../../services/cart.service';
import { Logger } from '../../../../services/logger.service';
import { withTransaction } from '../../../../utils/transaction.utils';

export class CartHandler {
    async getCart(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.user!.userId;
            Logger.debug(`Fetching cart for user: ${userId}`, 'CartHandler');

            const cart = await CartService.getOrCreateCart(userId);

            return reply.send({
                success: true,
                data: {
                    cart,
                },
            });
        } catch (error) {
            Logger.error(error as Error, 'CartHandler');
            throw error;
        }
    }

    async syncCart(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.user!.userId;
            Logger.debug(`Syncing cart for user: ${userId}`, 'CartHandler');

            const result = await CartService.syncCart(userId);

            return reply.send({
                success: true,
                data: result,
            });
        } catch (error) {
            Logger.error(error as Error, 'CartHandler');
            throw error;
        }
    }

    async addToCart(
        request: FastifyRequest<{
            Body: Static<typeof AddToCartBody>;
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const userId = request.user!.userId;
                const { itemId, variantSku, quantity } = request.body;

                Logger.debug(
                    `Adding item ${itemId} (${variantSku}) to cart for user: ${userId}`,
                    'CartHandler',
                );

                const cart = await CartService.addItemToCart(
                    userId,
                    itemId,
                    variantSku,
                    quantity,
                );

                return reply.send({
                    success: true,
                    data: {
                        cart,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'CartHandler');
                throw error;
            }
        }, 'CartHandler');
    }

    async bulkAddToCart(
        request: FastifyRequest<{
            Body: Static<typeof BulkAddToCartBody>;
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const userId = request.user!.userId;
                const { items } = request.body;

                Logger.debug(
                    `Bulk adding ${items.length} items to cart for user: ${userId}`,
                    'CartHandler',
                );

                const result = await CartService.bulkAddToCart(userId, items);

                return reply.send({
                    success: true,
                    data: result,
                });
            } catch (error) {
                Logger.error(error as Error, 'CartHandler');
                throw error;
            }
        }, 'CartHandler');
    }

    async updateCartItem(
        request: FastifyRequest<{
            Params: { itemId: string; variantSku: string };
            Body: Static<typeof UpdateCartItemBody>;
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const userId = request.user!.userId;
                const { itemId, variantSku } = request.params;
                const { quantity } = request.body;

                Logger.debug(
                    `Updating quantity for item ${itemId} (${variantSku}) in cart for user: ${userId}`,
                    'CartHandler',
                );

                const cart = await CartService.updateItemQuantity(
                    userId,
                    itemId,
                    variantSku,
                    quantity,
                );

                return reply.send({
                    success: true,
                    data: {
                        cart,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'CartHandler');
                throw error;
            }
        }, 'CartHandler');
    }

    async changeVariant(
        request: FastifyRequest<{
            Params: { itemId: string; variantSku: string };
            Body: Static<typeof ChangeVariantBody>;
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const userId = request.user!.userId;
                const { itemId, variantSku } = request.params;
                const { newVariantSku } = request.body;

                Logger.debug(
                    `Changing variant from ${variantSku} to ${newVariantSku} for item ${itemId} in cart for user: ${userId}`,
                    'CartHandler',
                );

                const cart = await CartService.changeVariant(
                    userId,
                    itemId,
                    variantSku,
                    newVariantSku,
                );

                return reply.send({
                    success: true,
                    data: {
                        cart,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'CartHandler');
                throw error;
            }
        }, 'CartHandler');
    }

    async removeItem(
        request: FastifyRequest<{
            Params: { itemId: string; variantSku: string };
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const userId = request.user!.userId;
                const { itemId, variantSku } = request.params;

                Logger.debug(
                    `Removing item ${itemId} (${variantSku}) from cart for user: ${userId}`,
                    'CartHandler',
                );

                const cart = await CartService.removeItem(
                    userId,
                    itemId,
                    variantSku,
                );

                return reply.send({
                    success: true,
                    data: {
                        cart,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'CartHandler');
                throw error;
            }
        }, 'CartHandler');
    }

    async clearCart(request: FastifyRequest, reply: FastifyReply) {
        return withTransaction(async (session) => {
            try {
                const userId = request.user!.userId;
                Logger.debug(
                    `Clearing cart for user: ${userId}`,
                    'CartHandler',
                );

                const cart = await CartService.clearCart(userId);

                return reply.send({
                    success: true,
                    data: {
                        cart,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'CartHandler');
                throw error;
            }
        }, 'CartHandler');
    }
}
