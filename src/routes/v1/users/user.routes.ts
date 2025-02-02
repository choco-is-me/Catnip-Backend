// src/routes/v1/users/user.routes.ts
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
import { UserHandler } from "./handlers/user.handler";

export default async function userRoutes(fastify: FastifyInstance) {
	const handler = new UserHandler();

	// Get user profile
	fastify.get<{ Params: Static<typeof ParamsWithUserId> }>(
		"/:userId",
		{
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
			...fastify.protectedRoute(["user", "admin"]),
			preHandler: async (request, reply) => {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;
			},
		},
		handler.getProfile
	);

	// Update profile
	fastify.put<{
		Params: Static<typeof ParamsWithUserId>;
		Body: Static<typeof UpdateUserBody>;
	}>(
		"/:userId",
		{
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
			...fastify.protectedRoute(["user", "admin"]),
			preHandler: async (request, reply) => {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;
			},
		},
		handler.updateProfile
	);

	// Delete profile
	fastify.delete<{ Params: Static<typeof ParamsWithUserId> }>(
		"/:userId",
		{
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
			...fastify.protectedRoute(["user", "admin"]),
			preHandler: async (request, reply) => {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;
			},
		},
		handler.deleteProfile
	);

	// Change password
	fastify.put<{
		Params: Static<typeof ParamsWithUserId>;
		Body: Static<typeof ChangePasswordBody>;
	}>(
		"/:userId/password",
		{
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
			...fastify.protectedRoute(["user", "admin"]),
			preHandler: async (request, reply) => {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;
			},
		},
		handler.changePassword
	);
}
