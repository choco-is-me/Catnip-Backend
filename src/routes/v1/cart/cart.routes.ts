// src/routes/v1/carts/carts.routes.ts
import { Static } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	AddToCartBody,
	AddToCartResponse,
	CartItemParams,
	ClearCartResponse,
	GetCartResponse,
	RemoveFromCartResponse,
	UpdateCartItemBody,
	UpdateCartResponse,
} from "../../../schemas/cart";
import { ErrorResponseSchema } from "../../../schemas/common";
import { CartHandler } from "./handlers/cart.handler";

export default async function cartRoutes(fastify: FastifyInstance) {
	const handler = new CartHandler();

	// Get cart contents
	fastify.get(
		"/",
		{
			schema: {
				tags: ["Cart"],
				description: "Get current user's cart contents",
				summary: "Get cart",
				response: {
					200: GetCartResponse,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.getCart
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
				summary: "Add to cart",
				body: AddToCartBody,
				response: {
					200: AddToCartResponse,
					400: {
						description: "Validation error or insufficient stock",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "BUSINESS_ERROR",
							},
							message: {
								type: "string",
								example: "Insufficient stock available",
							},
							code: { type: "number", example: 400 },
						},
					},
					401: ErrorResponseSchema,
					404: {
						description: "Item not found",
						properties: {
							success: { type: "boolean", example: false },
							error: { type: "string", example: "NOT_FOUND" },
							message: {
								type: "string",
								example: "Item not found",
							},
							code: { type: "number", example: 404 },
						},
					},
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.addToCart
	);

	// Update cart item quantity
	fastify.patch<{
		Params: Static<typeof CartItemParams>;
		Body: Static<typeof UpdateCartItemBody>;
	}>(
		"/items/:itemId/:variantSku",
		{
			schema: {
				tags: ["Cart"],
				description: "Update quantity of an item in the cart",
				summary: "Update cart item",
				params: CartItemParams,
				body: UpdateCartItemBody,
				response: {
					200: UpdateCartResponse,
					400: {
						description: "Validation error or insufficient stock",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "BUSINESS_ERROR",
							},
							message: {
								type: "string",
								example:
									"Requested quantity exceeds available stock",
							},
							code: { type: "number", example: 400 },
						},
					},
					401: ErrorResponseSchema,
					404: {
						description: "Cart or item not found",
						properties: {
							success: { type: "boolean", example: false },
							error: { type: "string", example: "NOT_FOUND" },
							message: {
								type: "string",
								example: "Item not found in cart",
							},
							code: { type: "number", example: 404 },
						},
					},
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.updateCartItem
	);

	// Remove item from cart
	fastify.delete<{
		Params: Static<typeof CartItemParams>;
	}>(
		"/items/:itemId/:variantSku",
		{
			schema: {
				tags: ["Cart"],
				description: "Remove an item from the cart",
				summary: "Remove from cart",
				params: CartItemParams,
				response: {
					200: RemoveFromCartResponse,
					401: ErrorResponseSchema,
					404: {
						description: "Cart or item not found",
						properties: {
							success: { type: "boolean", example: false },
							error: { type: "string", example: "NOT_FOUND" },
							message: {
								type: "string",
								example: "Item not found in cart",
							},
							code: { type: "number", example: 404 },
						},
					},
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.removeFromCart
	);

	// Clear cart
	fastify.delete(
		"/",
		{
			schema: {
				tags: ["Cart"],
				description: "Remove all items from the cart",
				summary: "Clear cart",
				response: {
					200: ClearCartResponse,
					401: ErrorResponseSchema,
					404: {
						description: "Cart not found",
						properties: {
							success: { type: "boolean", example: false },
							error: { type: "string", example: "NOT_FOUND" },
							message: {
								type: "string",
								example: "Cart not found",
							},
							code: { type: "number", example: 404 },
						},
					},
					500: ErrorResponseSchema,
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
		},
		handler.clearCart
	);
}
