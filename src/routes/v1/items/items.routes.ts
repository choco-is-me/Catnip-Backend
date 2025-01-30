// src/routes/v1/items/items.routes.ts
import { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
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
			description: "Create a new item",
			body: CreateItemBody,
			response: {
				201: ItemResponseSchema,
				400: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.createItem.bind(handler),
	});

	// Update item (admin only)
	fastify.put("/:itemId", {
		schema: {
			tags: ["Items"],
			description: "Update item by ID",
			params: Type.Object({
				itemId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			body: UpdateItemBody,
			response: {
				200: ItemResponseSchema,
				400: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.updateItem.bind(handler),
	});

	// Delete item (admin only)
	fastify.delete("/:itemId", {
		schema: {
			tags: ["Items"],
			description: "Delete item by ID",
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
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.deleteItem.bind(handler),
	});

	// Update stock (admin only)
	fastify.patch("/:itemId/stock", {
		schema: {
			tags: ["Items"],
			description: "Update item stock",
			params: Type.Object({
				itemId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			body: UpdateStockBody,
			response: {
				200: StockUpdateResponseSchema,
				400: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.updateStock.bind(handler),
	});
}
