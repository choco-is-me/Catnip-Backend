// src/routes/v1/users/profile.routes.ts
import { Static } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	DeleteResponseSchema,
	ErrorResponseSchema,
	ParamsWithUserId,
	UpdateUserBody,
	UserResponseSchema,
} from "../../../schemas";
import { ProfileHandler } from "./handlers/profile.handler";

export default async function profileRoutes(fastify: FastifyInstance) {
	const handler = new ProfileHandler();

	fastify.get<{ Params: Static<typeof ParamsWithUserId> }>(
		"/:userId",
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Users"],
				description: "Get user profile by ID",
				params: ParamsWithUserId,
				response: {
					200: UserResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const hasPermission = await fastify.checkOwnership(request, reply);
			if (!hasPermission) return;
			return handler.getProfile(request, reply);
		}
	);

	fastify.put<{
		Params: Static<typeof ParamsWithUserId>;
		Body: Static<typeof UpdateUserBody>;
	}>(
		"/:userId",
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Users"],
				description: "Update user profile",
				params: ParamsWithUserId,
				body: UpdateUserBody,
				response: {
					200: UserResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const hasPermission = await fastify.checkOwnership(request, reply);
			if (!hasPermission) return;
			return handler.updateProfile(request, reply);
		}
	);

	fastify.delete<{ Params: Static<typeof ParamsWithUserId> }>(
		"/:userId",
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Users"],
				description: "Delete user account",
				params: ParamsWithUserId,
				response: {
					200: DeleteResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const hasPermission = await fastify.checkOwnership(request, reply);
			if (!hasPermission) return;
			return handler.deleteProfile(request, reply);
		}
	);
}
