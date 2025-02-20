// src/schemas/items/index.ts
import { Type } from "@sinclair/typebox";
import { ResponseWrapper, Timestamps } from "../common";
import { CURRENCY_CONSTANTS } from "../../constants/currency.constants";

// Constants
const MAX_BULK_ITEMS = 20;

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
		description: "Dynamic specifications for different item types",
		examples: [
			{
				size: "XL",
				color: "Blue",
				material: "Cotton",
				measurements: ["Length: 70cm", "Width: 50cm"],
			},
		],
	}
);

export const VariantSchema = Type.Object(
	{
		sku: Type.String({
			description: "Stock Keeping Unit",
			examples: ["SHIRT-BLU-XL"],
		}),
		specifications: ItemSpecificationSchema,
		price: Type.Number({
			minimum: CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
			maximum: CURRENCY_CONSTANTS.ITEM.MAX_PRICE,
			description: "Price in VND (integer)",
			examples: [249000], // 249,000 VND
		}),
		stockQuantity: Type.Number({
			minimum: 0,
			description: "Current stock quantity",
			examples: [100],
		}),
		lowStockThreshold: Type.Optional(
			Type.Number({
				minimum: 0,
				description: "Threshold for low stock alerts",
				examples: [10],
			})
		),
	},
	{
		description: "Product variant details with VND pricing",
	}
);

// Item sort fields
export type ItemSortField =
	| "effectivePrice"
	| "ratings.average"
	| "numberOfSales"
	| "createdAt";

// Rating schema
export const RatingSchema = Type.Object(
	{
		average: Type.Number({
			minimum: 0,
			maximum: 5,
			description: "Average rating",
			examples: [4.5],
		}),
		count: Type.Number({
			minimum: 0,
			description: "Total number of ratings",
			examples: [120],
		}),
		reviewCount: Type.Number({
			minimum: 0,
			description: "Total number of written reviews",
			examples: [50],
		}),
	},
	{
		description: "Item rating information",
	}
);

// Discount schema
export const DiscountSchema = Type.Object(
	{
		percentage: Type.Number({
			minimum: 0,
			maximum: 100,
			description: "Discount percentage",
			examples: [20],
		}),
		startDate: Type.String({
			format: "date-time",
			description: "Discount start date",
		}),
		endDate: Type.String({
			format: "date-time",
			description: "Discount end date",
		}),
		active: Type.Boolean({
			description: "Whether the discount is currently active",
			default: true,
		}),
	},
	{
		description: "Discount information for VND prices",
	}
);

// Base item fields
const ItemBaseSchema = Type.Object({
	name: Type.String({
		minLength: 1,
		description: "Item name",
		examples: ["Premium Cotton T-Shirt"],
	}),
	description: Type.String({
		minLength: 1,
		description: "Item description",
		examples: ["High-quality cotton t-shirt with premium finish"],
	}),
	basePrice: Type.Number({
		minimum: CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
		maximum: CURRENCY_CONSTANTS.ITEM.MAX_PRICE,
		description: "Base price in VND (integer)",
		examples: [199000], // 199,000 VND
	}),
	images: Type.Array(
		Type.String({
			format: "uri",
			description: "Image URL",
			examples: ["https://example.com/images/tshirt-1.jpg"],
		})
	),
	tags: Type.Array(
		Type.String({
			description: "Item categories and tags",
			examples: ["clothing", "t-shirt", "premium"],
		})
	),
	variants: Type.Array(VariantSchema),
	supplier: Type.String({
		pattern: "^[0-9a-fA-F]{24}$",
		description: "Supplier MongoDB ObjectId",
	}),
	ratings: RatingSchema,
	numberOfSales: Type.Number({
		minimum: 0,
		description: "Total number of sales",
		examples: [500],
	}),
	status: Type.Union(
		[
			Type.Literal("active"),
			Type.Literal("discontinued"),
			Type.Literal("draft"),
		],
		{
			default: "draft",
			description: "Item status",
		}
	),
	discount: Type.Optional(DiscountSchema),
});

// Complete item schema with system fields
export const ItemSchema = Type.Intersect(
	[
		Type.Object({
			_id: Type.String({
				pattern: "^[0-9a-fA-F]{24}$",
				description: "MongoDB ObjectId",
			}),
		}),
		ItemBaseSchema,
		Type.Object(Timestamps),
	],
	{
		description: "Complete item information with system fields",
	}
);

// Bulk Creation Schemas
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
			"Bulk item creation response (handles both single and multiple items)",
		examples: [
			{
				success: true,
				data: {
					items: [
						{
							_id: "507f1f77bcf86cd799439011",
							name: "Premium Cotton T-Shirt",
							description:
								"High-quality cotton t-shirt with premium finish",
							basePrice: 199000,
							images: ["https://example.com/images/tshirt-1.jpg"],
							tags: ["clothing", "t-shirt", "premium"],
							variants: [
								{
									sku: "SHIRT-BLU-XL",
									specifications: {
										size: "XL",
										color: "Blue",
										material: "Cotton",
									},
									price: 249000,
									stockQuantity: 100,
								},
							],
							supplier: "507f1f77bcf86cd799439012",
							ratings: {
								average: 4.5,
								count: 120,
								reviewCount: 50,
							},
							numberOfSales: 500,
							status: "active",
							createdAt: "2023-01-01T00:00:00.000Z",
							updatedAt: "2023-01-01T00:00:00.000Z",
						},
					],
					summary: {
						totalItems: 1,
						message: "Successfully created 1 item",
					},
				},
			},
		],
	}
);

// Request/Response schemas
export const UpdateItemBody = Type.Partial(ItemBaseSchema);

export const UpdateStockBody = Type.Object({
	variantSku: Type.String({
		description: "SKU of the variant to update",
		examples: ["SHIRT-BLU-XL"],
	}),
	quantity: Type.Number({
		description: "Quantity to add (positive) or remove (negative)",
		examples: [10],
	}),
});

// Item filters for listing
export const ItemQueryParams = Type.Object({
	page: Type.Optional(
		Type.Number({
			minimum: 1,
			default: 1,
			description: "Page number for pagination",
			examples: [1, 2, 3],
		})
	),
	limit: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: 100,
			default: 10,
			description: "Number of items per page",
			examples: [10, 20, 50],
		})
	),
	search: Type.Optional(
		Type.String({
			description: "Search term to filter items",
			examples: ["cotton shirt", "blue jeans"],
		})
	),
	tags: Type.Optional(
		Type.Union(
			[
				Type.String({
					description: "Single tag to filter items",
					examples: ["clothing", "electronics"],
				}),
				Type.Array(
					Type.String({
						description: "Multiple tags to filter items",
						examples: ["clothing", "premium"],
					})
				),
			],
			{
				description: "Filter items by one or more tags",
				examples: ["clothing", ["clothing", "premium"]],
			}
		)
	),
	minPrice: Type.Optional(
		Type.Number({
			minimum: 0,
			description: "Minimum price filter",
			examples: [100000],
		})
	),
	maxPrice: Type.Optional(
		Type.Number({
			minimum: 0,
			description: "Maximum price filter",
			examples: [500000],
		})
	),
	status: Type.Optional(
		Type.Union(
			[
				Type.Literal("active"),
				Type.Literal("discontinued"),
				Type.Literal("draft"),
			],
			{
				description: "Filter items by their status",
				examples: ["active", "discontinued", "draft"],
			}
		)
	),
	supplier: Type.Optional(
		Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "Filter items by supplier ID",
			examples: ["507f1f77bcf86cd799439011"],
		})
	),
	minRating: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 5,
			description: "Filter items by minimum rating",
			examples: [3, 4, 4.5],
		})
	),
	inStock: Type.Optional(
		Type.Boolean({
			description: "Filter items by stock availability",
			examples: [true, false],
		})
	),
	sortBy: Type.Optional(
		Type.Union(
			[
				Type.Literal("effectivePrice"),
				Type.Literal("ratings.average"),
				Type.Literal("numberOfSales"),
				Type.Literal("createdAt"),
			],
			{
				description: "Field to sort the results by",
				examples: [
					"effectivePrice",
					"ratings.average",
					"numberOfSales",
					"createdAt",
				],
			}
		)
	),
	sortOrder: Type.Optional(
		Type.Union([Type.Literal("asc"), Type.Literal("desc")], {
			description: "Sort order direction",
			examples: ["asc", "desc"],
		})
	),
});

// Response schemas
export const SingleItemResponseSchema = ResponseWrapper(
	Type.Object({
		item: ItemSchema,
	})
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
	})
);

export const StockUpdateResponseSchema = ResponseWrapper(
	Type.Object({
		item: Type.Pick(ItemSchema, ["_id", "variants"]),
		stockUpdate: Type.Object({
			variantSku: Type.String(),
			newQuantity: Type.Number(),
			adjustment: Type.Number(),
		}),
	})
);
