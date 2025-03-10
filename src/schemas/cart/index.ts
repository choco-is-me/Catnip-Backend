// src/schemas/cart/index.ts
import { Type } from '@sinclair/typebox';
import { ResponseWrapper } from '../common';

const StockStatusEnum = Type.Union([
    Type.Literal('IN_STOCK'),
    Type.Literal('LOW_STOCK'),
    Type.Literal('OUT_OF_STOCK'),
    Type.Literal('DISCONTINUED'),
    Type.Literal('VARIANT_UNAVAILABLE'),
    Type.Literal('ITEM_UNAVAILABLE'),
    Type.Literal('PRICE_CHANGED'),
    Type.Literal('UNKNOWN'),
]);

// Enhanced severity enum for documentation
const SeverityEnum = Type.Union([
    Type.Literal('info'),
    Type.Literal('warning'),
    Type.Literal('error'),
]);

// Cart item schema for responses
const CartItemSchema = Type.Object({
    itemId: Type.String({
        pattern: '^[0-9a-fA-F]{24}$',
        description: 'Item MongoDB ObjectId',
    }),
    variantSku: Type.String({
        description: 'SKU of the chosen variant',
    }),
    quantity: Type.Number({
        minimum: 1,
        description: 'Quantity of the item',
    }),
    addedAt: Type.String({
        format: 'date-time',
        description: 'When the item was added to the cart',
    }),
    updatedAt: Type.String({
        format: 'date-time',
        description: 'When the cart item was last updated',
    }),
});

// Cart schema for responses
export const CartSchema = Type.Object({
    _id: Type.String({
        pattern: '^[0-9a-fA-F]{24}$',
        description: 'MongoDB ObjectId',
    }),
    userId: Type.String({
        pattern: '^[0-9a-fA-F]{24}$',
        description: 'User MongoDB ObjectId',
    }),
    items: Type.Array(CartItemSchema),
    lastActivity: Type.String({
        format: 'date-time',
        description: 'Last activity time',
    }),
    expires: Type.String({
        format: 'date-time',
        description: 'When the cart expires',
    }),
    createdAt: Type.String({
        format: 'date-time',
    }),
    updatedAt: Type.String({
        format: 'date-time',
    }),
});

// Request schemas
export const AddToCartBody = Type.Object({
    itemId: Type.String({
        pattern: '^[0-9a-fA-F]{24}$',
        description: 'Item MongoDB ObjectId',
    }),
    variantSku: Type.String({
        description: 'SKU of the variant to add',
    }),
    quantity: Type.Number({
        minimum: 1,
        default: 1,
        description: 'Quantity to add',
    }),
});

export const BulkAddToCartBody = Type.Object({
    items: Type.Array(
        Type.Object({
            itemId: Type.String({
                pattern: '^[0-9a-fA-F]{24}$',
                description: 'Item MongoDB ObjectId',
            }),
            variantSku: Type.String({
                description: 'SKU of the variant to add',
            }),
            quantity: Type.Number({
                minimum: 1,
                default: 1,
                description: 'Quantity to add',
            }),
        }),
        {
            minItems: 1,
            description: 'Array of items to add to cart',
        },
    ),
});

export const UpdateCartItemBody = Type.Object({
    quantity: Type.Number({
        minimum: 0,
        description: 'New quantity (0 to remove item)',
    }),
});

export const ChangeVariantBody = Type.Object({
    newVariantSku: Type.String({
        description: 'SKU of the new variant',
    }),
});

// Response schemas
export const CartResponseSchema = ResponseWrapper(
    Type.Object({
        cart: CartSchema,
    }),
);

export const BulkAddToCartResponseSchema = ResponseWrapper(
    Type.Object({
        cart: CartSchema,
        results: Type.Array(
            Type.Object({
                success: Type.Boolean(),
                itemId: Type.String(),
                variantSku: Type.String(),
                message: Type.Optional(Type.String()),
            }),
        ),
    }),
);

// Cart sync response includes detailed item info
export const CartSyncResponseSchema = ResponseWrapper(
    Type.Object({
        cart: CartSchema,
        totals: Type.Object({
            subtotal: Type.Number(),
            totalItems: Type.Number(),
            totalQuantity: Type.Number(),
            isOrderBelowMinimum: Type.Optional(Type.Boolean()),
            isOrderAboveMaximum: Type.Optional(Type.Boolean()),
            minimumOrderValue: Type.Optional(Type.Number()),
            maximumOrderValue: Type.Optional(Type.Number()),
            orderMessage: Type.Optional(Type.String()),
            shortfall: Type.Optional(Type.Number()),
            excess: Type.Optional(Type.Number()),
        }),
        itemDetails: Type.Array(
            Type.Object({
                item: Type.Object({
                    _id: Type.String(),
                    name: Type.String(),
                    images: Type.Optional(Type.Array(Type.String())),
                    description: Type.Optional(Type.String()),
                    status: Type.Optional(Type.String()),
                }),
                variant: Type.Object({
                    sku: Type.String(),
                    specifications: Type.Optional(
                        Type.Record(Type.String(), Type.Any()),
                    ),
                    price: Type.Optional(Type.Number()),
                    stockQuantity: Type.Optional(Type.Number()),
                    effectivePrice: Type.Optional(Type.Number()),
                    discountPercentage: Type.Optional(Type.Number()),
                }),
                quantity: Type.Number(),
                itemTotal: Type.Number(),
                isAvailable: Type.Boolean(),
                hasChanged: Type.Boolean(),
                stockStatus: Type.Optional(StockStatusEnum),
                stockIssue: Type.Optional(Type.String()),
                quantityAdjusted: Type.Optional(Type.Boolean()),
                suggestedQuantity: Type.Optional(Type.Number()),
                severity: Type.Optional(SeverityEnum),
                actionRequired: Type.Optional(Type.Boolean()),
                recommendation: Type.Optional(Type.String()),
                priceChanged: Type.Optional(Type.Boolean()),
                previousPrice: Type.Optional(Type.Number()),
                currentPrice: Type.Optional(Type.Number()),
            }),
        ),
        stockIssues: Type.Optional(
            Type.Array(
                Type.Object({
                    itemId: Type.String(),
                    variantSku: Type.String(),
                    issue: Type.String(),
                    severity: Type.Optional(SeverityEnum),
                    actionRequired: Type.Optional(Type.Boolean()),
                    recommendation: Type.Optional(Type.String()),
                }),
            ),
        ),
    }),
);
