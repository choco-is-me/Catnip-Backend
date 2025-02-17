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
		version: Type.Optional(
			Type.Number({
				description: "Cart version for optimistic locking",
			})
		),
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

const CartStatusSummarySchema = Type.Object(
	{
		active: Type.Number({
			description: "Number of active items",
			examples: [3],
		}),
		discontinued: Type.Number({
			description: "Number of discontinued items",
			examples: [1],
		}),
		outOfStock: Type.Number({
			description: "Number of out of stock items",
			examples: [0],
		}),
		removed: Type.Number({
			description: "Number of removed items",
			examples: [0],
		}),
		hasDiscontinuedItems: Type.Boolean({
			description: "Whether cart contains discontinued items",
			examples: [true],
		}),
		hasOutOfStockItems: Type.Boolean({
			description: "Whether cart contains out of stock items",
			examples: [false],
		}),
	},
	{
		description: "Summary of cart item statuses",
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
			priceAtAdd: 299000,
			currentPrice: 299000,
			effectivePrice: 239000,
			specifications: {
				size: "XL",
				color: "Blue",
				material: "Cotton",
			},
			status: "active",
		},
		{
			itemId: "507f1f77bcf86cd799439014",
			variantSku: "PANT-BLK-L",
			quantity: 1,
			name: "Classic Black Pants",
			priceAtAdd: 399000,
			currentPrice: 399000,
			effectivePrice: 399000,
			specifications: {
				size: "L",
				color: "Black",
				material: "Cotton",
			},
			status: "discontinued",
		},
	],
	itemCount: 1, // Only counts active items
	totalOriginalPrice: 299000,
	totalEffectivePrice: 239000,
	lastPriceUpdate: "2024-02-14T12:00:00.000Z",
	createdAt: "2024-02-14T10:00:00.000Z",
	updatedAt: "2024-02-14T12:00:00.000Z",
	version: 1,
	statusSummary: {
		active: 1,
		discontinued: 1,
		outOfStock: 0,
		removed: 0,
		hasDiscontinuedItems: true,
		hasOutOfStockItems: false,
	},
	discontinuedItems: [
		{
			itemId: "507f1f77bcf86cd799439014",
			variantSku: "PANT-BLK-L",
			quantity: 1,
			name: "Classic Black Pants",
			// ... other item details
			status: "discontinued",
		},
	],
};

export const CartOperationBody = Type.Object({
	version: Type.Optional(
		Type.Number({
			description: "Cart version for optimistic locking",
		})
	),
});

// Request/Response Schema Exports
export const AddToCartBody = CartItemBaseSchema;

export const UpdateCartItemBody = Type.Object({
	quantity: Type.Number({
		minimum: 1,
		description: "New quantity for the item",
		examples: [3],
	}),
	version: Type.Optional(
		Type.Number({
			description: "Cart version for optimistic locking",
		})
	),
});

export const GetCartResponse = ResponseWrapper(
	Type.Object({
		cart: CartResponseSchema,
		statusSummary: CartStatusSummarySchema,
		discontinuedItems: Type.Optional(Type.Array(CartItemResponseSchema)),
		outOfStockItems: Type.Optional(Type.Array(CartItemResponseSchema)),
	}),
	{
		description: "Get cart contents response with status information",
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
		statusSummary: CartStatusSummarySchema,
		discontinuedItems: Type.Optional(Type.Array(CartItemResponseSchema)),
		outOfStockItems: Type.Optional(Type.Array(CartItemResponseSchema)),
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
			status: Type.String(),
			name: Type.String(),
			quantity: Type.Number(),
		}),
		statusSummary: CartStatusSummarySchema,
		cartStatus: Type.Object({
			wasLastActiveItem: Type.Boolean({
				description:
					"Whether this was the last active item in the cart",
				examples: [false],
			}),
			remainingActiveItems: Type.Number({
				description: "Number of remaining active items",
				examples: [2],
			}),
		}),
		discontinuedItems: Type.Optional(Type.Array(CartItemResponseSchema)),
		outOfStockItems: Type.Optional(Type.Array(CartItemResponseSchema)),
		version: Type.Number(),
	}),
	{
		description: "Remove from cart response",
		examples: [
			{
				success: true,
				data: {
					cart: {
						// ... cart example data
					},
					removedItem: {
						itemId: "507f1f77bcf86cd799439013",
						variantSku: "SHIRT-BLU-XL",
						status: "active",
						name: "Premium Cotton T-Shirt",
						quantity: 2,
					},
					statusSummary: {
						active: 2,
						discontinued: 1,
						outOfStock: 0,
						removed: 0,
						hasDiscontinuedItems: true,
						hasOutOfStockItems: false,
					},
					cartStatus: {
						wasLastActiveItem: false,
						remainingActiveItems: 2,
					},
					discontinuedItems: [
						// ... discontinued items
					],
					version: 5,
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
		cart: CartResponseSchema,
		clearanceReport: Type.Object({
			itemCounts: Type.Object({
				total: Type.Number({
					description: "Total number of items cleared",
					examples: [5],
				}),
				active: Type.Number({
					description: "Number of active items cleared",
					examples: [3],
				}),
				discontinued: Type.Number({
					description: "Number of discontinued items cleared",
					examples: [1],
				}),
				outOfStock: Type.Number({
					description: "Number of out-of-stock items cleared",
					examples: [1],
				}),
			}),
			previousStatus: CartStatusSummarySchema,
			clearedItems: Type.Object({
				active: Type.Array(CartItemResponseSchema),
				discontinued: Type.Array(CartItemResponseSchema),
				outOfStock: Type.Array(CartItemResponseSchema),
			}),
			totalValues: Type.Object({
				originalPrice: Type.Number({
					description: "Total original price of cleared active items",
					examples: [1500000],
				}),
				effectivePrice: Type.Number({
					description:
						"Total effective price of cleared active items",
					examples: [1350000],
				}),
			}),
		}),
		version: Type.Number({
			description: "New cart version after clearing",
			examples: [6],
		}),
	}),
	{
		description: "Clear cart response",
		examples: [
			{
				success: true,
				data: {
					message: "Cart cleared successfully",
					cart: {
						// Empty cart data
						_id: "507f1f77bcf86cd799439011",
						userId: "507f1f77bcf86cd799439012",
						items: [],
						itemCount: 0,
						totalOriginalPrice: 0,
						totalEffectivePrice: 0,
						lastPriceUpdate: "2024-02-17T12:00:00.000Z",
						version: 6,
					},
					clearanceReport: {
						itemCounts: {
							total: 5,
							active: 3,
							discontinued: 1,
							outOfStock: 1,
						},
						previousStatus: {
							active: 3,
							discontinued: 1,
							outOfStock: 1,
							removed: 0,
							hasDiscontinuedItems: true,
							hasOutOfStockItems: true,
						},
						clearedItems: {
							active: [
								// Example of cleared active items
								{
									itemId: "507f1f77bcf86cd799439013",
									variantSku: "SHIRT-BLU-XL",
									quantity: 2,
									name: "Premium Cotton T-Shirt",
									status: "active",
									// ... other item details
								},
							],
							discontinued: [
								// Example of cleared discontinued items
							],
							outOfStock: [
								// Example of cleared out-of-stock items
							],
						},
						totalValues: {
							originalPrice: 1500000,
							effectivePrice: 1350000,
						},
					},
					version: 6,
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
