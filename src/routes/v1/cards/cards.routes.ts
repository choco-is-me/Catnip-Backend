// src/routes/v1/users/cards.routes.ts
import { Static } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	CardDeleteResponseSchema,
	CardResponseSchema,
	CardsResponseSchema,
	CreateCardBody,
	PaginationQuery,
	ParamsWithUserId,
	ParamsWithUserIdAndCardId,
} from "../../../schemas";
import { CardsHandler } from "./handlers/cards.handler";

export default async function cardRoutes(fastify: FastifyInstance) {
	const handler = new CardsHandler();

	// Add card route
	fastify.post<{
		Params: Static<typeof ParamsWithUserId>;
		Body: Static<typeof CreateCardBody>;
	}>(
		"/:userId/cards",
		{
			schema: {
				tags: ["Cards"],
				description: "Add a new payment card to user account",
				summary: "Add new card",
				params: ParamsWithUserId,
				body: CreateCardBody,
				response: {
					201: CardResponseSchema,
					400: {
						description: "Validation or format error",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "CARD_VALIDATION_ERROR",
							},
							message: {
								type: "string",
								example: "Invalid card number format",
							},
							code: { type: "number", example: 400 },
						},
					},
					403: {
						description: "Card security error",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "CARD_SECURITY_ERROR",
							},
							message: {
								type: "string",
								example:
									"This card is registered to another account",
							},
							code: { type: "number", example: 403 },
						},
					},
					409: {
						description: "Duplicate card error",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "DUPLICATE_ERROR",
							},
							message: {
								type: "string",
								example:
									"This card is already registered to your account",
							},
							code: { type: "number", example: 409 },
						},
					},
					500: {
						description: "Server error",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "INTERNAL_ERROR",
							},
							message: {
								type: "string",
								example: "An unexpected error occurred",
							},
							code: { type: "number", example: 500 },
						},
					},
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
			preHandler: async (request, reply) => {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;
			},
		},
		handler.addCard
	);

	// Get user's cards route with enhanced documentation
	fastify.get<{
		Params: Static<typeof ParamsWithUserId>;
		Querystring: Static<typeof PaginationQuery>;
	}>(
		"/:userId/cards",
		{
			schema: {
				tags: ["Cards"],
				description: "Get all payment cards associated with a user",
				summary: "List user's cards",
				params: ParamsWithUserId,
				querystring: PaginationQuery,
				response: {
					200: CardsResponseSchema,
					400: {
						description: "Invalid parameters",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "INVALID_FORMAT",
							},
							message: {
								type: "string",
								example: "Invalid pagination parameters",
							},
							code: { type: "number", example: 400 },
						},
					},
					404: {
						description: "User not found",
						properties: {
							success: { type: "boolean", example: false },
							error: { type: "string", example: "NOT_FOUND" },
							message: {
								type: "string",
								example: "User not found",
							},
							code: { type: "number", example: 404 },
						},
					},
					500: {
						description: "Server error",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "INTERNAL_ERROR",
							},
							message: {
								type: "string",
								example: "An unexpected error occurred",
							},
							code: { type: "number", example: 500 },
						},
					},
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
			preHandler: async (request, reply) => {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;
			},
		},
		handler.getCards
	);

	// Delete card route with enhanced documentation
	fastify.delete<{
		Params: Static<typeof ParamsWithUserIdAndCardId>;
	}>(
		"/:userId/cards/:cardId",
		{
			schema: {
				tags: ["Cards"],
				description: "Delete a specific payment card from user account",
				summary: "Delete card",
				params: ParamsWithUserIdAndCardId,
				response: {
					200: CardDeleteResponseSchema,
					400: {
						description: "Invalid parameters",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "INVALID_FORMAT",
							},
							message: {
								type: "string",
								example: "Invalid card ID format",
							},
							code: { type: "number", example: 400 },
						},
					},
					403: {
						description: "Permission error",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "CARD_SECURITY_ERROR",
							},
							message: {
								type: "string",
								example:
									"You do not have permission to delete this card",
							},
							code: { type: "number", example: 403 },
						},
					},
					404: {
						description: "Card not found",
						properties: {
							success: { type: "boolean", example: false },
							error: { type: "string", example: "NOT_FOUND" },
							message: {
								type: "string",
								example: "Card not found or already deleted",
							},
							code: { type: "number", example: 404 },
						},
					},
					422: {
						description: "Business rule violation",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "BUSINESS_ERROR",
							},
							message: {
								type: "string",
								example:
									"Cannot delete card with active recurring payments",
							},
							code: { type: "number", example: 422 },
						},
					},
					500: {
						description: "Server error",
						properties: {
							success: { type: "boolean", example: false },
							error: {
								type: "string",
								example: "INTERNAL_ERROR",
							},
							message: {
								type: "string",
								example: "An unexpected error occurred",
							},
							code: { type: "number", example: 500 },
						},
					},
				},
			},
			...fastify.protectedRoute(["user", "admin"]),
			preHandler: async (request, reply) => {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;
			},
		},
		handler.deleteCard
	);
}
