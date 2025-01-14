// src/routes/v1/auth.ts
import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import { CONFIG } from "../../config";
import JWTService from "../../services/jwt.service";

export default async function authRoutes(fastify: FastifyInstance) {
	fastify.post(
		"/refresh-token",
		{
			schema: {
				tags: ["Auth"],
				description: "Refresh access token using refresh token",
				response: {
					200: Type.Object({
						success: Type.Boolean(),
						data: Type.Object({
							accessToken: Type.String(),
						}),
					}),
					401: Type.Object({
						success: Type.Boolean(),
						error: Type.String(),
						message: Type.String(),
					}),
				},
			},
		},
		async (request, reply) => {
			try {
				// Get refresh token from cookie instead of body
				const refreshToken = request.cookies.refreshToken;

				if (!refreshToken) {
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "No refresh token provided",
					};
				}

				const tokens = JWTService.rotateTokens(refreshToken);

				// Set the new refresh token in cookie
				reply.setCookie("refreshToken", tokens.refreshToken, {
					httpOnly: true,
					secure: CONFIG.COOKIE_SECURE,
					sameSite: "strict",
					path: "/api/v1/auth/refresh-token",
					maxAge: CONFIG.COOKIE_MAX_AGE,
					domain: CONFIG.COOKIE_DOMAIN,
					partitioned: true,
				});

				// Only return the access token in response
				return {
					success: true,
					data: {
						accessToken: tokens.accessToken,
					},
				};
			} catch (error) {
				reply.code(401);
				return {
					success: false,
					error: "Authentication Failed",
					message: "Invalid refresh token",
				};
			}
		}
	);
}
