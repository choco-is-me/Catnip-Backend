// src/routes/v1/items/items.routes.ts
import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	CreateItemBody,
	ErrorResponseSchema,
	ItemResponseSchema,
	StockUpdateResponseSchema,
	UpdateItemBody,
	UpdateStockBody,
} from "../../../schemas";
import { ItemHandler } from "./handlers/items.handler";

export default async function itemRoutes(fastify: FastifyInstance) {
	const handler = new ItemHandler();

	// Create item (admin only)
	fastify.post("/", {
		schema: {
			tags: ["Items"],
			description: "Create a new item (Admin only)",
			body: CreateItemBody,
			response: {
				201: ItemResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		...fastify.protectedRoute(["admin"]),
		handler: handler.createItem,
	});

	// Update item (admin only)
	fastify.put("/:itemId", {
		schema: {
			tags: ["Items"],
			description: "Update item by ID (Admin only)",
			params: Type.Object({
				itemId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			body: UpdateItemBody,
			response: {
				200: ItemResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		...fastify.protectedRoute(["admin"]),
		handler: handler.updateItem,
	});

	// Delete item (admin only)
	fastify.delete("/:itemId", {
		schema: {
			tags: ["Items"],
			description: "Delete item by ID (Admin only)",
			params: Type.Object({
				itemId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			response: {
				200: Type.Object({
					success: Type.Literal(true),
					data: Type.Object({
						message: Type.String(),
					}),
				}),
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		...fastify.protectedRoute(["admin"]),
		handler: handler.deleteItem,
	});

	// Update stock (admin only)
	fastify.patch("/:itemId/stock", {
		schema: {
			tags: ["Items"],
			description: "Update item stock (Admin only)",
			params: Type.Object({
				itemId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			body: UpdateStockBody,
			response: {
				200: StockUpdateResponseSchema,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		...fastify.protectedRoute(["admin"]),
		handler: handler.updateStock,
	});
}
