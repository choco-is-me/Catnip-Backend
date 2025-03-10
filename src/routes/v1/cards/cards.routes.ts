// src/routes/v1/users/cards.routes.ts
import { Static } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';
import {
    CardDeleteResponseSchema,
    CardResponseSchema,
    CardsResponseSchema,
    CreateCardBody,
    PaginationQuery,
    UpdateDefaultCardResponseSchema,
} from '../../../schemas';
import { CardsHandler } from './handlers/cards.handler';

export default async function cardRoutes(fastify: FastifyInstance) {
    const handler = new CardsHandler();

    // Add card route
    fastify.post<{
        Body: Static<typeof CreateCardBody>;
    }>(
        '/',
        {
            schema: {
                tags: ['Cards'],
                description:
                    "Add a new payment card to authenticated user's account",
                summary: 'Add new card',
                body: CreateCardBody,
                response: {
                    201: CardResponseSchema,
                    400: {
                        description: 'Validation or format error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'CARD_VALIDATION_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid card number format',
                            },
                            code: { type: 'number', example: 400 },
                        },
                    },
                    401: {
                        description: 'Authentication error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'AUTHENTICATION_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid or expired token',
                            },
                            code: { type: 'number', example: 401 },
                        },
                    },
                    409: {
                        description: 'Duplicate card error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'DUPLICATE_ERROR',
                            },
                            message: {
                                type: 'string',
                                example:
                                    'This card is already registered to your account',
                            },
                            code: { type: 'number', example: 409 },
                        },
                    },
                    500: {
                        description: 'Server error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INTERNAL_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'An unexpected error occurred',
                            },
                            code: { type: 'number', example: 500 },
                        },
                    },
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.addCard,
    );

    // Get user's cards route
    fastify.get<{
        Querystring: Static<typeof PaginationQuery>;
    }>(
        '/',
        {
            schema: {
                tags: ['Cards'],
                description:
                    'Get all payment cards associated with authenticated user',
                summary: "List user's cards",
                querystring: PaginationQuery,
                response: {
                    200: CardsResponseSchema,
                    400: {
                        description: 'Invalid parameters',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INVALID_FORMAT',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid pagination parameters',
                            },
                            code: { type: 'number', example: 400 },
                        },
                    },
                    401: {
                        description: 'Authentication error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'AUTHENTICATION_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid or expired token',
                            },
                            code: { type: 'number', example: 401 },
                        },
                    },
                    500: {
                        description: 'Server error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INTERNAL_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'An unexpected error occurred',
                            },
                            code: { type: 'number', example: 500 },
                        },
                    },
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.getCards,
    );

    // Delete card route
    fastify.delete<{
        Params: { cardId: string };
    }>(
        '/:cardId',
        {
            schema: {
                tags: ['Cards'],
                description:
                    "Delete a specific payment card from authenticated user's account",
                summary: 'Delete card',
                params: {
                    type: 'object',
                    properties: {
                        cardId: {
                            type: 'string',
                            pattern: '^[0-9a-fA-F]{24}$',
                            description: 'Card MongoDB ObjectId',
                        },
                    },
                    required: ['cardId'],
                },
                response: {
                    200: CardDeleteResponseSchema,
                    400: {
                        description: 'Invalid parameters',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INVALID_FORMAT',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid card ID format',
                            },
                            code: { type: 'number', example: 400 },
                        },
                    },
                    401: {
                        description: 'Authentication error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'AUTHENTICATION_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid or expired token',
                            },
                            code: { type: 'number', example: 401 },
                        },
                    },
                    404: {
                        description: 'Card not found',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: { type: 'string', example: 'NOT_FOUND' },
                            message: {
                                type: 'string',
                                example: 'Card not found or already deleted',
                            },
                            code: { type: 'number', example: 404 },
                        },
                    },
                    500: {
                        description: 'Server error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INTERNAL_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'An unexpected error occurred',
                            },
                            code: { type: 'number', example: 500 },
                        },
                    },
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.deleteCard,
    );

    // Set default card route
    fastify.patch<{
        Params: { cardId: string };
    }>(
        '/:cardId/default',
        {
            schema: {
                tags: ['Cards'],
                description:
                    'Set a card as the default payment method for authenticated user',
                summary: 'Update default card',
                params: {
                    type: 'object',
                    properties: {
                        cardId: {
                            type: 'string',
                            pattern: '^[0-9a-fA-F]{24}$',
                            description: 'Card MongoDB ObjectId',
                        },
                    },
                    required: ['cardId'],
                },
                response: {
                    200: UpdateDefaultCardResponseSchema,
                    400: {
                        description: 'Invalid parameters',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INVALID_FORMAT',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid card ID format',
                            },
                            code: { type: 'number', example: 400 },
                        },
                    },
                    401: {
                        description: 'Authentication error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'AUTHENTICATION_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid or expired token',
                            },
                            code: { type: 'number', example: 401 },
                        },
                    },
                    404: {
                        description: 'Card not found',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: { type: 'string', example: 'NOT_FOUND' },
                            message: {
                                type: 'string',
                                example: 'Card not found',
                            },
                            code: { type: 'number', example: 404 },
                        },
                    },
                    500: {
                        description: 'Server error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INTERNAL_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'An unexpected error occurred',
                            },
                            code: { type: 'number', example: 500 },
                        },
                    },
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.setDefaultCard,
    );
}
