// src/routes/v1/users/auth.routes.ts
import { FastifyInstance } from "fastify";
import {
	CreateUserBody,
	ErrorResponseSchema,
	LoginRequestBody,
	LoginResponseSchema,
	LogoutResponseSchema,
	RefreshTokenResponseSchema,
	Static,
	UserResponseSchema,
} from "../../../schemas";
import { AuthHandler } from "./handlers/auth.handler";

export default async function authRoutes(fastify: FastifyInstance) {
	const handler = new AuthHandler();

	fastify.setErrorHandler(function (error, _request, reply) {
		if (error.validation) {
			return reply.status(400).send({
				success: false,
				error: "Validation Error",
				message: error.message,
				code: 400,
			});
		}
		return reply.status(500).send({
			success: false,
			error: "Internal Server Error",
			message: error.message,
			code: 500,
		});
	});

	fastify.post(
		"/refresh-token",
		{
			schema: {
				tags: ["Auth"],
				description: "Refresh access token using refresh token",
				response: {
					200: RefreshTokenResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			config: {
				rateLimit: {
					max: 50,
					timeWindow: "15 minute",
				},
			},
		},
		handler.refreshToken
	);

	fastify.post<{ Body: Static<typeof LoginRequestBody> }>(
		"/login",
		{
			schema: {
				tags: ["Auth"],
				description: "User login",
				body: LoginRequestBody,
				response: {
					200: LoginResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
			config: {
				rateLimit: {
					max: 50,
					timeWindow: "15 minute",
				},
			},
		},
		handler.login
	);

	fastify.post<{ Body: Static<typeof CreateUserBody> }>(
		"/register",
		{
			schema: {
				tags: ["Auth"],
				description: "Create a new user account",
				body: CreateUserBody,
				response: {
					201: UserResponseSchema,
					400: ErrorResponseSchema,
					409: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		handler.register
	);

	fastify.post(
		"/logout",
		{
			onRequest: [fastify.authenticate],
			schema: {
				tags: ["Auth"],
				description: "Logout user",
				response: {
					200: LogoutResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		handler.logout
	);
}
