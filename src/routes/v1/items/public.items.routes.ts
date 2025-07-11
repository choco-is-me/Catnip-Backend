// src/routes/v1/items/public.items.routes.ts
import { Type } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';
import {
    ErrorResponseSchema,
    ItemQueryParams,
    PaginatedItemsResponseSchema,
    SingleItemResponseSchema,
} from '../../../schemas';
import { ItemHandler } from './handlers/items.handler';

export default async function publicItemRoutes(fastify: FastifyInstance) {
    const handler = new ItemHandler();

    // Get item by ID (public access)
    fastify.get('/:itemId', {
        schema: {
            tags: ['Public Items'],
            description: 'Get item by ID (Public Access)',
            params: Type.Object({
                itemId: Type.String({ pattern: '^[0-9a-fA-F]{24}$' }),
            }),
            response: {
                200: SingleItemResponseSchema,
                404: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        handler: handler.getItem,
    });

    // List items with filters (public access)
    fastify.get('/', {
        schema: {
            tags: ['Public Items'],
            description: 'List items with filters (Public Access)',
            querystring: ItemQueryParams,
            response: {
                200: PaginatedItemsResponseSchema,
                400: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        handler: handler.listItems,
    });
}
