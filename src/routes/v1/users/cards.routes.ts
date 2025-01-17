// src/routes/v1/users/cards.routes.ts
import { Static, Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	CardResponseSchema,
	CardsResponseSchema,
	CreateCardBody,
	ErrorResponseSchema,
	PaginationQuery,
	ParamsWithUserId,
	ParamsWithUserIdAndCardId,
	ResponseWrapper,
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
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Cards"],
				description: "Add a new card to user account",
				params: ParamsWithUserId,
				body: CreateCardBody,
				response: {
					201: CardResponseSchema,
					400: ErrorResponseSchema,
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const hasPermission = await fastify.checkOwnership(request, reply);
			if (!hasPermission) return;
			return handler.addCard(request, reply);
		}
	);

	// Get user's cards route
	fastify.get<{
		Params: Static<typeof ParamsWithUserId>;
		Querystring: Static<typeof PaginationQuery>;
	}>(
		"/:userId/cards",
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Cards"],
				description: "Get all cards associated with a user",
				params: ParamsWithUserId,
				querystring: PaginationQuery,
				response: {
					200: CardsResponseSchema,
					400: ErrorResponseSchema,
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const hasPermission = await fastify.checkOwnership(request, reply);
			if (!hasPermission) return;
			return handler.getCards(request, reply);
		}
	);

	// Delete card route
	fastify.delete<{
		Params: Static<typeof ParamsWithUserIdAndCardId>;
	}>(
		"/:userId/cards/:cardId",
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Cards"],
				description: "Delete a specific card from user account",
				params: ParamsWithUserIdAndCardId,
				response: {
					200: ResponseWrapper(
						Type.Object({
							message: Type.Literal("Card deleted successfully"),
						})
					),
					400: ErrorResponseSchema,
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const hasPermission = await fastify.checkOwnership(request, reply);
			if (!hasPermission) return;
			return handler.deleteCard(request, reply);
		}
	);
}
