// src/routes/v1/cart/cart.routes.ts
import { Static } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	AddToCartBody,
	BulkAddToCartBody,
	BulkAddToCartResponseSchema,
	CartResponseSchema,
	CartSyncResponseSchema,
	ChangeVariantBody,
	UpdateCartItemBody,
} from "../../../schemas/cart";
import { ErrorResponseSchema } from "../../../schemas/common";
import { CartHandler } from "./handlers/cart.handler";

export default async function cartRoutes(fastify: FastifyInstance) {
	const handler = new CartHandler();

	// Get user's cart
	fastify.get(
		"/",
		{
			schema: {
				tags: ["Cart"],
				description: "Get the authenticated user's cart",
				response: {
					200: CartResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.getCart
	);

	// Sync cart with current item data
	fastify.get(
		"/sync",
		{
			schema: {
				tags: ["Cart"],
				description:
					"Synchronize cart with latest item data and calculate totals",
				response: {
					200: CartSyncResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.syncCart
	);

	// Add item to cart
	fastify.post<{
		Body: Static<typeof AddToCartBody>;
	}>(
		"/items",
		{
			schema: {
				tags: ["Cart"],
				description: "Add an item to the cart",
				body: AddToCartBody,
				response: {
					200: CartResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.addToCart
	);

	// Bulk add items to cart
	fastify.post<{
		Body: Static<typeof BulkAddToCartBody>;
	}>(
		"/items/bulk",
		{
			schema: {
				tags: ["Cart"],
				description: "Add multiple items to the cart in one operation",
				body: BulkAddToCartBody,
				response: {
					200: BulkAddToCartResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.bulkAddToCart
	);

	// Update cart item quantity
	fastify.patch<{
		Params: { itemId: string; variantSku: string };
		Body: Static<typeof UpdateCartItemBody>;
	}>(
		"/items/:itemId/:variantSku",
		{
			schema: {
				tags: ["Cart"],
				description: "Update the quantity of an item in the cart",
				params: {
					type: "object",
					properties: {
						itemId: {
							type: "string",
							pattern: "^[0-9a-fA-F]{24}$",
							description: "Item MongoDB ObjectId",
						},
						variantSku: {
							type: "string",
							description: "SKU of the variant",
						},
					},
					required: ["itemId", "variantSku"],
				},
				body: UpdateCartItemBody,
				response: {
					200: CartResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.updateCartItem
	);

	// Change variant of cart item
	fastify.patch<{
		Params: { itemId: string; variantSku: string };
		Body: Static<typeof ChangeVariantBody>;
	}>(
		"/items/:itemId/:variantSku/variant",
		{
			schema: {
				tags: ["Cart"],
				description: "Change the variant of an item in the cart",
				params: {
					type: "object",
					properties: {
						itemId: {
							type: "string",
							pattern: "^[0-9a-fA-F]{24}$",
							description: "Item MongoDB ObjectId",
						},
						variantSku: {
							type: "string",
							description: "Current SKU of the variant",
						},
					},
					required: ["itemId", "variantSku"],
				},
				body: ChangeVariantBody,
				response: {
					200: CartResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.changeVariant
	);

	// Remove item from cart
	fastify.delete<{
		Params: { itemId: string; variantSku: string };
	}>(
		"/items/:itemId/:variantSku",
		{
			schema: {
				tags: ["Cart"],
				description: "Remove an item from the cart",
				params: {
					type: "object",
					properties: {
						itemId: {
							type: "string",
							pattern: "^[0-9a-fA-F]{24}$",
							description: "Item MongoDB ObjectId",
						},
						variantSku: {
							type: "string",
							description: "SKU of the variant",
						},
					},
					required: ["itemId", "variantSku"],
				},
				response: {
					200: CartResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.removeItem
	);

	// Clear cart
	fastify.delete(
		"/",
		{
			schema: {
				tags: ["Cart"],
				description: "Clear all items from the cart",
				response: {
					200: CartResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.clearCart
	);
}
