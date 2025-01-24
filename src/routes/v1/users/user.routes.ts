// src/routes/v1/users/profile.routes.ts
import { Static } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import {
	ChangePasswordBody,
	ChangePasswordResponseSchema,
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

	fastify.put<{
		Params: Static<typeof ParamsWithUserId>;
		Body: Static<typeof ChangePasswordBody>;
	}>(
		"/:userId/password",
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Users"],
				description:
					"Change user password (requires prior email verification)",
				params: ParamsWithUserId,
				body: ChangePasswordBody,
				response: {
					200: ChangePasswordResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const hasPermission = await fastify.checkOwnership(request, reply);
			if (!hasPermission) return;
			return handler.changePassword(request, reply);
		}
	);
}
