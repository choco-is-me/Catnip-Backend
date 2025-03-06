// src/routes/v1/items/items.routes.ts
import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	BulkCreateItemBody,
	BulkCreateItemResponse,
	BulkItemUpdateBody,
	BulkItemUpdateResponse,
	ErrorResponseSchema,
	StockUpdateResponseSchema,
	UpdateStockBody,
} from "../../../schemas";
import { ItemHandler } from "./handlers/items.handler";

export default async function itemRoutes(fastify: FastifyInstance) {
	const handler = new ItemHandler();

	// Create multiple items in bulk (admin only)
	fastify.post("/bulk", {
		schema: {
			tags: ["Items"],
			description: "Create multiple items in bulk (Admin only)",
			body: BulkCreateItemBody,
			response: {
				201: BulkCreateItemResponse,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		...fastify.protectedRoute(["admin"]),
		handler: handler.createItemsBulk,
	});

	// Bulk update items (admin only)
	fastify.put("/bulk-update", {
		schema: {
			tags: ["Items"],
			description: "Bulk update multiple items (Admin only)",
			body: BulkItemUpdateBody,
			response: {
				200: BulkItemUpdateResponse,
				400: ErrorResponseSchema,
				401: ErrorResponseSchema,
				403: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		...fastify.protectedRoute(["admin"]),
		handler: handler.bulkUpdateItems,
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
