// src/schemas/carts/index.ts
import { Type } from "@sinclair/typebox";
import { ResponseWrapper } from "../common";

// Base schemas for cart items
const CartItemBaseSchema = Type.Object(
	{
		itemId: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "MongoDB ObjectId of the item",
			examples: ["507f1f77bcf86cd799439011"],
		}),
		variantSku: Type.String({
			description: "SKU of the selected variant",
			examples: ["SHIRT-BLU-XL"],
		}),
		quantity: Type.Number({
			minimum: 1,
			description: "Quantity of items",
			examples: [2],
		}),
	},
	{
		description: "Base cart item information for adding/updating items",
	}
);

// Response schemas for cart items
const CartItemResponseSchema = Type.Object(
	{
		itemId: Type.String({
			description: "MongoDB ObjectId of the item",
			examples: ["507f1f77bcf86cd799439011"],
		}),
		variantSku: Type.String({
			description: "SKU of the selected variant",
			examples: ["SHIRT-BLU-XL"],
		}),
		quantity: Type.Number({
			description: "Quantity of items",
			examples: [2],
		}),
		name: Type.String({
			description: "Name of the item",
			examples: ["Premium Cotton T-Shirt"],
		}),
		priceAtAdd: Type.Number({
			description: "Original price when item was added",
			examples: [29.99],
		}),
		currentPrice: Type.Number({
			description: "Current price of the item",
			examples: [29.99],
		}),
		effectivePrice: Type.Number({
			description: "Price after applying discounts",
			examples: [23.99],
		}),
		specifications: Type.Record(
			Type.String(),
			Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
			{
				description: "Variant specifications",
				examples: [{ size: "XL", color: "Blue", material: "Cotton" }],
			}
		),
		status: Type.Union(
			[
				Type.Literal("active"),
				Type.Literal("discontinued"),
				Type.Literal("outOfStock"),
				Type.Literal("removed"),
			],
			{
				description: "Status of the item in cart",
				examples: ["active"],
			}
		),
	},
	{
		description:
			"Detailed cart item information including prices and status",
	}
);

// Full cart response schema
const CartResponseSchema = Type.Object(
	{
		_id: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "Cart MongoDB ObjectId",
		}),
		userId: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "User MongoDB ObjectId",
		}),
		items: Type.Array(CartItemResponseSchema),
		itemCount: Type.Number({
			description: "Total number of items in cart",
			examples: [3],
		}),
		totalOriginalPrice: Type.Number({
			description: "Total price without discounts",
			examples: [89.97],
		}),
		totalEffectivePrice: Type.Number({
			description: "Total price after discounts",
			examples: [71.97],
		}),
		lastPriceUpdate: Type.String({
			format: "date-time",
			description: "Timestamp of last price update",
		}),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
	},
	{
		description: "Complete cart information with totals",
	}
);

// Example data for documentation
const cartExample = {
	_id: "507f1f77bcf86cd799439011",
	userId: "507f1f77bcf86cd799439012",
	items: [
		{
			itemId: "507f1f77bcf86cd799439013",
			variantSku: "SHIRT-BLU-XL",
			quantity: 2,
			name: "Premium Cotton T-Shirt",
			priceAtAdd: 29.99,
			currentPrice: 29.99,
			effectivePrice: 23.99,
			specifications: {
				size: "XL",
				color: "Blue",
				material: "Cotton",
			},
			status: "active",
		},
	],
	itemCount: 2,
	totalOriginalPrice: 59.98,
	totalEffectivePrice: 47.98,
	lastPriceUpdate: "2024-02-14T12:00:00.000Z",
	createdAt: "2024-02-14T10:00:00.000Z",
	updatedAt: "2024-02-14T12:00:00.000Z",
};

// Request/Response Schema Exports
export const AddToCartBody = CartItemBaseSchema;

export const UpdateCartItemBody = Type.Object({
	quantity: Type.Number({
		minimum: 1,
		description: "New quantity for the item",
		examples: [3],
	}),
});

export const GetCartResponse = ResponseWrapper(
	Type.Object({
		cart: CartResponseSchema,
	}),
	{
		description: "Get cart contents response",
		examples: [
			{
				success: true,
				data: {
					cart: cartExample,
				},
			},
		],
	}
);

export const AddToCartResponse = ResponseWrapper(
	Type.Object({
		cart: CartResponseSchema,
		addedItem: CartItemResponseSchema,
	}),
	{
		description: "Add to cart response",
		examples: [
			{
				success: true,
				data: {
					cart: cartExample,
					addedItem: cartExample.items[0],
				},
			},
		],
	}
);

export const UpdateCartResponse = ResponseWrapper(
	Type.Object({
		cart: CartResponseSchema,
		updatedItem: CartItemResponseSchema,
	}),
	{
		description: "Update cart item response",
		examples: [
			{
				success: true,
				data: {
					cart: cartExample,
					updatedItem: cartExample.items[0],
				},
			},
		],
	}
);

export const RemoveFromCartResponse = ResponseWrapper(
	Type.Object({
		cart: CartResponseSchema,
		removedItem: Type.Object({
			itemId: Type.String(),
			variantSku: Type.String(),
		}),
	}),
	{
		description: "Remove from cart response",
		examples: [
			{
				success: true,
				data: {
					cart: cartExample,
					removedItem: {
						itemId: "507f1f77bcf86cd799439013",
						variantSku: "SHIRT-BLU-XL",
					},
				},
			},
		],
	}
);

export const ClearCartResponse = ResponseWrapper(
	Type.Object({
		message: Type.String({
			description: "Success message",
			examples: ["Cart cleared successfully"],
		}),
		itemCount: Type.Number({
			description: "Number of items removed",
			examples: [5],
		}),
	}),
	{
		description: "Clear cart response",
		examples: [
			{
				success: true,
				data: {
					message: "Cart cleared successfully",
					itemCount: 5,
				},
			},
		],
	}
);

// Parameters
export const CartItemParams = Type.Object({
	itemId: Type.String({
		pattern: "^[0-9a-fA-F]{24}$",
		description: "Item MongoDB ObjectId",
	}),
	variantSku: Type.String({
		description: "Variant SKU to remove",
	}),
});
