// src/schemas/items/index.ts
import { Type } from '@sinclair/typebox';
import { CURRENCY_CONSTANTS } from '../../constants/currency.constants';
import { ResponseWrapper, Timestamps } from '../common';

// Constants
const MAX_BULK_ITEMS = 20;

// Item sort fields
export type ItemSortField =
    | 'effectivePrice'
    | 'ratings.average'
    | 'numberOfSales'
    | 'createdAt';

// Base schemas for specifications and variants
export const ItemSpecificationSchema = Type.Record(
    Type.String(),
    Type.Union([
        Type.String(),
        Type.Number(),
        Type.Boolean(),
        Type.Array(Type.String()),
    ]),
    {
        description: 'Dynamic specifications for different item types',
        examples: [
            {
                size: 'XL',
                color: 'Blue',
                material: 'Cotton',
                measurements: ['Length: 70cm', 'Width: 50cm'],
            },
        ],
    },
);

export const VariantSchema = Type.Object(
    {
        sku: Type.String({
            description: 'Stock Keeping Unit',
            examples: ['SHIRT-BLU-XL'],
        }),
        specifications: Type.Optional(ItemSpecificationSchema),
        price: Type.Number({
            minimum: CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
            maximum: CURRENCY_CONSTANTS.ITEM.MAX_PRICE,
            description: 'Price in VND (integer)',
            examples: [249000], // 249,000 VND
        }),
        stockQuantity: Type.Number({
            minimum: 0,
            description: 'Current stock quantity',
            examples: [100],
        }),
        lowStockThreshold: Type.Optional(
            Type.Number({
                minimum: 0,
                description: 'Threshold for low stock alerts',
                examples: [10],
            }),
        ),
    },
    {
        description: 'Product variant details with VND pricing',
    },
);

export const RatingSchema = Type.Object(
    {
        average: Type.Number({
            minimum: 0,
            maximum: 5,
            description: 'Average rating',
            examples: [4.5],
        }),
        count: Type.Number({
            minimum: 0,
            description: 'Total number of ratings',
            examples: [120],
        }),
        reviewCount: Type.Number({
            minimum: 0,
            description: 'Total number of written reviews',
            examples: [50],
        }),
    },
    {
        description: 'Item rating information',
    },
);

export const DiscountSchema = Type.Object(
    {
        percentage: Type.Number({
            minimum: 0,
            maximum: 100,
            description: 'Discount percentage',
            examples: [20],
        }),
        startDate: Type.String({
            format: 'date-time',
            description: 'Discount start date',
        }),
        endDate: Type.String({
            format: 'date-time',
            description: 'Discount end date',
        }),
        active: Type.Boolean({
            description: 'Whether the discount is currently active',
            default: true,
        }),
    },
    {
        description: 'Discount information for VND prices',
    },
);

// Define schema for Cloudinary image data
export const ImageDataSchema = Type.Object(
    {
        url: Type.String({
            format: 'uri',
            description: 'Image URL',
            examples: [
                'https://res.cloudinary.com/djf6nbycc/image/upload/v1/sample.jpg',
            ],
        }),
        publicId: Type.Optional(
            Type.String({
                description: 'Cloudinary public ID for image management',
                examples: ['folder/sample'],
            }),
        ),
    },
    {
        description: 'Image data with Cloudinary metadata',
    },
);

const ItemBaseSchema = Type.Object({
    name: Type.String({
        minLength: 1,
        description: 'Item name',
        examples: ['Premium Cotton T-Shirt'],
    }),
    description: Type.String({
        minLength: 1,
        description: 'Item description',
        examples: ['High-quality cotton t-shirt with premium finish'],
    }),
    images: Type.Array(ImageDataSchema, {
        description:
            'Array of image data objects with URLs and optional Cloudinary metadata',
        examples: [
            [
                {
                    url: 'https://res.cloudinary.com/djf6nbycc/image/upload/v1/tshirt-1.jpg',
                    publicId: 'products/tshirt-1',
                },
            ],
        ],
    }),
    tags: Type.Array(
        Type.String({
            description: 'Item categories and tags',
            examples: ['clothing', 't-shirt', 'premium'],
        }),
    ),
    variants: Type.Array(VariantSchema),
    supplier: Type.String({
        pattern: '^[0-9a-fA-F]{24}$',
        description: 'Supplier MongoDB ObjectId',
    }),
    ratings: RatingSchema,
    numberOfSales: Type.Number({
        minimum: 0,
        description: 'Total number of sales',
        examples: [500],
    }),
    status: Type.Union(
        [
            Type.Literal('active'),
            Type.Literal('discontinued'),
            Type.Literal('draft'),
        ],
        {
            default: 'draft',
            description: 'Item status',
        },
    ),
    discount: Type.Optional(DiscountSchema),
});

export const ItemSchema = Type.Intersect(
    [
        Type.Object({
            _id: Type.String({
                pattern: '^[0-9a-fA-F]{24}$',
                description: 'MongoDB ObjectId',
            }),
        }),
        ItemBaseSchema,
        Type.Object(Timestamps),
    ],
    {
        description: 'Complete item information with system fields',
    },
);

// Item query parameters
export const ItemQueryParams = Type.Object({
    page: Type.Optional(
        Type.Number({
            minimum: 1,
            default: 1,
            description: 'Page number for pagination',
            examples: [1, 2, 3],
        }),
    ),
    limit: Type.Optional(
        Type.Number({
            minimum: 1,
            maximum: 100,
            default: 10,
            description: 'Number of items per page',
            examples: [10, 20, 50],
        }),
    ),
    search: Type.Optional(
        Type.String({
            description: 'Search term to filter items',
            examples: ['cotton shirt', 'blue jeans'],
        }),
    ),
    tags: Type.Optional(
        Type.Union(
            [
                Type.String({
                    description: 'Single tag to filter items',
                    examples: ['clothing', 'electronics'],
                }),
                Type.Array(
                    Type.String({
                        description: 'Multiple tags to filter items',
                        examples: ['clothing', 'premium'],
                    }),
                ),
            ],
            {
                description: 'Filter items by one or more tags',
                examples: ['clothing', ['clothing', 'premium']],
            },
        ),
    ),
    minPrice: Type.Optional(
        Type.Number({
            minimum: 0,
            description:
                'Minimum effective price filter. Filters items based on their lowest active variant price, considering any active discounts.',
            examples: [100000], // 100,000 VND
        }),
    ),
    maxPrice: Type.Optional(
        Type.Number({
            minimum: 0,
            description:
                'Maximum effective price filter. Filters items based on their lowest active variant price, considering any active discounts.',
            examples: [500000], // 500,000 VND
        }),
    ),
    status: Type.Optional(
        Type.Union(
            [
                Type.Literal('active'),
                Type.Literal('discontinued'),
                Type.Literal('draft'),
            ],
            {
                description: 'Filter items by their status',
                examples: ['active', 'discontinued', 'draft'],
            },
        ),
    ),
    supplier: Type.Optional(
        Type.String({
            pattern: '^[0-9a-fA-F]{24}$',
            description: 'Filter items by supplier ID',
            examples: ['507f1f77bcf86cd799439011'],
        }),
    ),
    minRating: Type.Optional(
        Type.Number({
            minimum: 0,
            maximum: 5,
            description: 'Filter items by minimum rating',
            examples: [3, 4, 4.5],
        }),
    ),
    inStock: Type.Optional(
        Type.Boolean({
            description: 'Filter items by stock availability',
            examples: [true, false],
        }),
    ),
    sortBy: Type.Optional(
        Type.Union(
            [
                Type.Literal('effectivePrice'),
                Type.Literal('ratings.average'),
                Type.Literal('numberOfSales'),
                Type.Literal('createdAt'),
            ],
            {
                description: `Field to sort items by:
			  - effectivePrice: Sort by lowest active variant price (with discounts)
			  - ratings.average: Sort by average rating
			  - numberOfSales: Sort by total sales
			  - createdAt: Sort by creation date`,
                examples: ['effectivePrice'],
            },
        ),
    ),
    sortOrder: Type.Optional(
        Type.Union([Type.Literal('asc'), Type.Literal('desc')], {
            description: 'Sort order direction',
            examples: ['asc', 'desc'],
        }),
    ),
});

// Request body schemas
const BulkItemValidation = Type.Intersect([
    ItemBaseSchema,
    Type.Object({
        variants: Type.Array(VariantSchema, {
            uniqueItems: true,
            minItems: 1,
        }),
    }),
]);
export const BulkCreateItemBody = Type.Object({
    items: Type.Array(BulkItemValidation, {
        minItems: 1,
        maxItems: MAX_BULK_ITEMS,
        description: `Array of items to create (1-${MAX_BULK_ITEMS} items). Use this endpoint for both single and multiple item creation.`,
    }),
});

export const BulkItemUpdateBody = Type.Object({
    items: Type.Array(
        Type.Object({
            itemId: Type.String({
                pattern: '^[0-9a-fA-F]{24}$',
                description: 'MongoDB ObjectId of the item to update',
            }),
            // Partial update fields
            update: Type.Optional(Type.Partial(ItemBaseSchema)),
            // Variant updates
            variants: Type.Optional(
                Type.Object({
                    add: Type.Optional(Type.Array(VariantSchema)),
                    remove: Type.Optional(
                        Type.Array(
                            Type.String({ description: 'SKU to remove' }),
                        ),
                    ),
                    update: Type.Optional(
                        Type.Array(
                            Type.Object({
                                sku: Type.String(),
                                price: Type.Optional(Type.Number()),
                                stockQuantity: Type.Optional(Type.Number()),
                                specifications: Type.Optional(
                                    ItemSpecificationSchema,
                                ),
                                lowStockThreshold: Type.Optional(Type.Number()),
                            }),
                        ),
                    ),
                }),
            ),
            // Discount settings
            discount: Type.Optional(
                Type.Object({
                    percentage: Type.Number({
                        minimum: 0,
                        maximum: 100,
                        description: 'Discount percentage',
                    }),
                    startDate: Type.String({ format: 'date-time' }),
                    endDate: Type.String({ format: 'date-time' }),
                    active: Type.Boolean(),
                }),
            ),
        }),
    ),
});

export const UpdateStockBody = Type.Object({
    variantSku: Type.String({
        description: 'SKU of the variant to update',
        examples: ['SHIRT-BLU-XL'],
    }),
    quantity: Type.Number({
        description: 'Quantity to add (positive) or remove (negative)',
        examples: [10],
    }),
});

// Response schemas
export const SingleItemResponseSchema = ResponseWrapper(
    Type.Object({
        item: ItemSchema,
    }),
);

export const PaginatedItemsResponseSchema = ResponseWrapper(
    Type.Object({
        items: Type.Array(ItemSchema),
        pagination: Type.Object({
            total: Type.Number(),
            page: Type.Number(),
            totalPages: Type.Number(),
            hasNext: Type.Boolean(),
            hasPrev: Type.Boolean(),
        }),
    }),
);

export const BulkCreateItemResponse = ResponseWrapper(
    Type.Object({
        items: Type.Array(ItemSchema),
        summary: Type.Object({
            totalItems: Type.Number(),
            message: Type.String(),
        }),
    }),
    {
        description:
            'Bulk item creation response (handles both single and multiple items)',
        examples: [
            {
                success: true,
                data: {
                    items: [
                        {
                            _id: '507f1f77bcf86cd799439011',
                            name: 'Premium Cotton T-Shirt',
                            description:
                                'High-quality cotton t-shirt with premium finish',
                            images: [
                                {
                                    url: 'https://res.cloudinary.com/djf6nbycc/image/upload/v1/tshirt-1.jpg',
                                    publicId: 'products/tshirt-1',
                                },
                            ],
                            tags: ['clothing', 't-shirt', 'premium'],
                            variants: [
                                {
                                    sku: 'SHIRT-BLU-XL',
                                    specifications: {
                                        size: 'XL',
                                        color: 'Blue',
                                        material: 'Cotton',
                                    },
                                    price: 249000,
                                    stockQuantity: 100,
                                },
                            ],
                            supplier: '507f1f77bcf86cd799439012',
                            ratings: {
                                average: 4.5,
                                count: 120,
                                reviewCount: 50,
                            },
                            numberOfSales: 500,
                            status: 'active',
                            createdAt: '2023-01-01T00:00:00.000Z',
                            updatedAt: '2023-01-01T00:00:00.000Z',
                        },
                    ],
                    summary: {
                        totalItems: 1,
                        message: 'Successfully created 1 item',
                    },
                },
            },
        ],
    },
);

export const BulkItemUpdateResponse = ResponseWrapper(
    Type.Object({
        items: Type.Array(ItemSchema),
        summary: Type.Object({
            total: Type.Number(),
            updated: Type.Number(),
            skipped: Type.Number(),
            message: Type.String(),
            errors: Type.Optional(
                Type.Array(
                    Type.Object({
                        itemId: Type.String(),
                        reason: Type.String(),
                    }),
                ),
            ),
        }),
    }),
    {
        description: 'Bulk item update response',
        examples: [
            {
                success: true,
                data: {
                    items: [
                        {
                            _id: '507f1f77bcf86cd799439011',
                            name: 'Updated Item Name',
                            description: 'Updated description',
                            images: [
                                {
                                    url: 'https://res.cloudinary.com/djf6nbycc/image/upload/v1/updated-item.jpg',
                                    publicId: 'products/updated-item',
                                },
                            ],
                            variants: [
                                {
                                    sku: 'ITEM-001',
                                    specifications: {
                                        size: 'XL',
                                        color: 'Blue',
                                    },
                                    price: 249000,
                                    stockQuantity: 100,
                                },
                            ],
                            discount: {
                                percentage: 10,
                                startDate: '2024-03-01T00:00:00.000Z',
                                endDate: '2024-03-31T23:59:59.999Z',
                                active: true,
                            },
                            status: 'active',
                            createdAt: '2024-02-24T00:00:00.000Z',
                            updatedAt: '2024-02-24T00:00:00.000Z',
                        },
                    ],
                    summary: {
                        total: 2,
                        updated: 1,
                        skipped: 1,
                        message: 'Successfully updated 1 item, skipped 1 item',
                        errors: [
                            {
                                itemId: '507f1f77bcf86cd799439012',
                                reason: 'SKU validation failed: SKU "ITEM-001" already used in item "Updated Item Name"',
                            },
                        ],
                    },
                },
            },
        ],
    },
);

export const StockUpdateResponseSchema = ResponseWrapper(
    Type.Object({
        item: Type.Pick(ItemSchema, ['_id', 'variants']),
        stockUpdate: Type.Object({
            variantSku: Type.String(),
            newQuantity: Type.Number(),
            adjustment: Type.Number(),
        }),
    }),
);
