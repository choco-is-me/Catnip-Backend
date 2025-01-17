// src/routes/v1/users/auth.routes.ts
import { FastifyInstance } from "fastify";
import { AuthHandler } from "./handlers/auth.handler";
import {
	LoginRequestBody,
	LoginResponseSchema,
	LogoutResponseSchema,
	CreateUserBody,
	UserResponseSchema,
	ErrorResponseSchema,
	Static,
	RefreshTokenResponseSchema,
} from "../../../schemas";

export default async function authRoutes(fastify: FastifyInstance) {
	const handler = new AuthHandler();

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
		},
		handler.refreshToken.bind(handler)
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
