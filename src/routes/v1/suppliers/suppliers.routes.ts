// src/routes/v1/suppliers/suppliers.routes.ts
import { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import {
	CreateSupplierBody,
	ErrorResponseSchema,
	SupplierQueryParams,
	SupplierResponseSchema,
	SuppliersResponseSchema,
	UpdateSupplierBody,
} from "../../../schemas";
import { SupplierHandler } from "./handlers/suppliers.handler";

export default async function supplierRoutes(fastify: FastifyInstance) {
	const handler = new SupplierHandler();

	// Create supplier
	fastify.post("/", {
		schema: {
			tags: ["Suppliers"],
			description: "Create a new supplier",
			body: CreateSupplierBody,
			response: {
				201: SupplierResponseSchema,
				400: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.createSupplier.bind(handler),
	});

	// Get supplier by ID
	fastify.get("/:supplierId", {
		schema: {
			tags: ["Suppliers"],
			description: "Get supplier by ID",
			params: Type.Object({
				supplierId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			response: {
				200: SupplierResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.getSupplier.bind(handler),
	});

	// Update supplier
	fastify.put("/:supplierId", {
		schema: {
			tags: ["Suppliers"],
			description: "Update supplier by ID",
			params: Type.Object({
				supplierId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			body: UpdateSupplierBody,
			response: {
				200: SupplierResponseSchema,
				400: ErrorResponseSchema,
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.updateSupplier.bind(handler),
	});

	// Delete supplier
	fastify.delete("/:supplierId", {
		schema: {
			tags: ["Suppliers"],
			description: "Delete supplier by ID",
			params: Type.Object({
				supplierId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			response: {
				200: Type.Object({
					success: Type.Literal(true),
					data: Type.Object({
						message: Type.String(),
						supplier: Type.Optional(Type.Object({})),
					}),
				}),
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.deleteSupplier.bind(handler),
	});

	// List suppliers
	fastify.get("/", {
		schema: {
			tags: ["Suppliers"],
			description: "List suppliers with filters and pagination",
			querystring: SupplierQueryParams,
			response: {
				200: SuppliersResponseSchema,
				400: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.listSuppliers.bind(handler),
	});

	// Get supplier statistics
	fastify.get("/:supplierId/stats", {
		schema: {
			tags: ["Suppliers"],
			description: "Get supplier statistics",
			params: Type.Object({
				supplierId: Type.String({ pattern: "^[0-9a-fA-F]{24}$" }),
			}),
			response: {
				200: Type.Object({
					success: Type.Literal(true),
					data: Type.Object({
						totalItems: Type.Number(),
						activeItems: Type.Number(),
						rating: Type.Number(),
						contractStatus: Type.Union([
							Type.Literal("active"),
							Type.Literal("expired"),
						]),
					}),
				}),
				404: ErrorResponseSchema,
				500: ErrorResponseSchema,
			},
		},
		handler: handler.getSupplierStats.bind(handler),
	});
}
