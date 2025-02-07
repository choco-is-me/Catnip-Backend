// src/schemas/items/index.ts
import { Type } from "@sinclair/typebox";
import { ResponseWrapper, Timestamps } from "../common";

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
			minimum: 0,
			description: "Price for this specific variant",
			examples: [29.99],
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
		description: "Product variant details",
	}
);

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
		description: "Discount information",
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
		minimum: 0,
		description: "Base price before any variants or discounts",
		examples: [24.99],
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

// Request/Response schemas
export const CreateItemBody = ItemBaseSchema;
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
	page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
	limit: Type.Optional(
		Type.Number({ minimum: 1, maximum: 100, default: 10 })
	),
	search: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
	minPrice: Type.Optional(Type.Number({ minimum: 0 })),
	maxPrice: Type.Optional(Type.Number({ minimum: 0 })),
	status: Type.Optional(
		Type.Union([
			Type.Literal("active"),
			Type.Literal("discontinued"),
			Type.Literal("draft"),
		])
	),
	supplier: Type.Optional(Type.String({ pattern: "^[0-9a-fA-F]{24}$" })),
	minRating: Type.Optional(Type.Number({ minimum: 0, maximum: 5 })),
	inStock: Type.Optional(Type.Boolean()),
	sortBy: Type.Optional(
		Type.Union([
			Type.Literal("price"),
			Type.Literal("ratings.average"),
			Type.Literal("numberOfSales"),
			Type.Literal("createdAt"),
		])
	),
	sortOrder: Type.Optional(
		Type.Union([Type.Literal("asc"), Type.Literal("desc")])
	),
});

// Response schemas
export const ItemResponseSchema = ResponseWrapper(
	Type.Object({
		item: ItemSchema,
	})
);

export const ItemsResponseSchema = ResponseWrapper(
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
