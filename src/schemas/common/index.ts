// src/schemas/common/index.ts
import { TSchema, Type } from '@sinclair/typebox';

// Define common schema types
export const Timestamps = {
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
};

// Common error response schema with better typing
export const ErrorResponseSchema = Type.Object({
    success: Type.Literal(false),
    code: Type.Integer({
        minimum: 400,
        maximum: 599,
        description: 'HTTP status code',
    }),
    error: Type.String({
        description: 'Error type identifier',
        examples: ['VALIDATION_ERROR', 'NOT_FOUND', 'UNAUTHORIZED'],
    }),
    message: Type.String({
        description: 'Human-readable error message',
        examples: [
            'Invalid card number format',
            'User not found',
            'Token has expired',
        ],
    }),
    details: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

// Enhanced address schema with better validation
export const AddressSchema = Type.Object(
    {
        street: Type.String({ minLength: 1, examples: ['123 Main St'] }),
        city: Type.String({ minLength: 1, examples: ['New York'] }),
        province: Type.String({ minLength: 1, examples: ['NY'] }),
        zipCode: Type.String({
            pattern: '^[0-9]{5}(-[0-9]{4})?$',
            examples: ['10001'],
        }),
    },
    {
        description: 'Physical address',
        examples: [
            {
                street: '123 Main St',
                city: 'New York',
                province: 'NY',
                zipCode: '10001',
            },
        ],
    },
);

// Generic response wrapper with better typing
export const ResponseWrapper = <T extends TSchema>(
    dataSchema: T,
    options: {
        description?: string;
        examples?: Array<{
            success: true;
            data: any;
        }>;
    } = {},
) =>
    Type.Object(
        {
            success: Type.Literal(true),
            data: dataSchema,
        },
        {
            description: options.description,
            examples: options.examples,
        },
    );

// Common query parameters
export const PaginationQuery = Type.Object(
    {
        page: Type.Optional(
            Type.Integer({
                minimum: 1,
                description: 'Page number',
                default: 1,
                examples: [1],
            }),
        ),
        limit: Type.Optional(
            Type.Integer({
                minimum: 1,
                maximum: 100,
                description: 'Items per page',
                default: 10,
                examples: [10],
            }),
        ),
        sortBy: Type.Optional(
            Type.String({
                description: 'Field to sort by',
                examples: ['createdAt'],
            }),
        ),
        order: Type.Optional(
            Type.Union([Type.Literal('asc'), Type.Literal('desc')], {
                description: 'Sort order',
                examples: ['desc'],
            }),
        ),
    },
    {
        description: 'Pagination and sorting parameters',
    },
);
