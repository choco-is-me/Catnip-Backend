// src/routes/v1/suppliers/suppliers.routes.ts
import { Type } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';
import {
    CreateSupplierBody,
    ErrorResponseSchema,
    SupplierQueryParams,
    SupplierResponseSchema,
    SuppliersResponseSchema,
    UpdateSupplierBody,
} from '../../../schemas';
import { SupplierHandler } from './handlers/suppliers.handler';

export default async function supplierRoutes(fastify: FastifyInstance) {
    const handler = new SupplierHandler();

    // Create supplier (admin only)
    fastify.post('/', {
        schema: {
            tags: ['Suppliers'],
            description: 'Create a new supplier (Admin only)',
            body: CreateSupplierBody,
            response: {
                201: SupplierResponseSchema,
                400: ErrorResponseSchema,
                401: ErrorResponseSchema,
                403: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        ...fastify.protectedRoute(['admin']),
        handler: handler.createSupplier,
    });

    // Get supplier by ID (admin only)
    fastify.get('/:supplierId', {
        schema: {
            tags: ['Suppliers'],
            description: 'Get supplier by ID (Admin only)',
            params: Type.Object({
                supplierId: Type.String({ pattern: '^[0-9a-fA-F]{24}$' }),
            }),
            response: {
                200: SupplierResponseSchema,
                401: ErrorResponseSchema,
                403: ErrorResponseSchema,
                404: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        ...fastify.protectedRoute(['admin']),
        handler: handler.getSupplier,
    });

    // Update supplier (admin only)
    fastify.put('/:supplierId', {
        schema: {
            tags: ['Suppliers'],
            description: 'Update supplier by ID (Admin only)',
            params: Type.Object({
                supplierId: Type.String({ pattern: '^[0-9a-fA-F]{24}$' }),
            }),
            body: UpdateSupplierBody,
            response: {
                200: SupplierResponseSchema,
                400: ErrorResponseSchema,
                401: ErrorResponseSchema,
                403: ErrorResponseSchema,
                404: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        ...fastify.protectedRoute(['admin']),
        handler: handler.updateSupplier,
    });

    // Delete supplier (admin only)
    fastify.delete('/:supplierId', {
        schema: {
            tags: ['Suppliers'],
            description: 'Delete supplier by ID (Admin only)',
            params: Type.Object({
                supplierId: Type.String({ pattern: '^[0-9a-fA-F]{24}$' }),
            }),
            response: {
                200: Type.Object({
                    success: Type.Literal(true),
                    data: Type.Object({
                        message: Type.String(),
                        supplier: Type.Optional(Type.Object({})),
                    }),
                }),
                401: ErrorResponseSchema,
                403: ErrorResponseSchema,
                404: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        ...fastify.protectedRoute(['admin']),
        handler: handler.deleteSupplier,
    });

    // List suppliers (admin only)
    fastify.get('/', {
        schema: {
            tags: ['Suppliers'],
            description:
                'List suppliers with filters and pagination (Admin only)',
            querystring: SupplierQueryParams,
            response: {
                200: SuppliersResponseSchema,
                400: ErrorResponseSchema,
                401: ErrorResponseSchema,
                403: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        ...fastify.protectedRoute(['admin']),
        handler: handler.listSuppliers,
    });

    // Get supplier statistics (admin only)
    fastify.get('/:supplierId/stats', {
        schema: {
            tags: ['Suppliers'],
            description: 'Get supplier statistics (Admin only)',
            params: Type.Object({
                supplierId: Type.String({ pattern: '^[0-9a-fA-F]{24}$' }),
            }),
            response: {
                200: Type.Object({
                    success: Type.Literal(true),
                    data: Type.Object({
                        totalItems: Type.Number(),
                        activeItems: Type.Number(),
                        rating: Type.Number(),
                        contractStatus: Type.Union([
                            Type.Literal('active'),
                            Type.Literal('expired'),
                        ]),
                    }),
                }),
                401: ErrorResponseSchema,
                403: ErrorResponseSchema,
                404: ErrorResponseSchema,
                500: ErrorResponseSchema,
            },
        },
        ...fastify.protectedRoute(['admin']),
        handler: handler.getSupplierStats,
    });
}
