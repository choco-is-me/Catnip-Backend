// src/routes/v1/auth.ts
import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import JWTService from "../../services/jwt.service";

const refreshTokenSchema = Type.Object({
	refreshToken: Type.String(),
});

export default async function authRoutes(fastify: FastifyInstance) {
	fastify.post(
		"/refresh-token",
		{
			schema: {
				tags: ["Auth"],
				description: "Refresh access token using refresh token",
				body: refreshTokenSchema,
				response: {
					200: Type.Object({
						success: Type.Boolean(),
						data: Type.Object({
							accessToken: Type.String(),
							refreshToken: Type.String(),
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
				const { refreshToken } = request.body as {
					refreshToken: string;
				};
				const tokens = JWTService.rotateTokens(refreshToken);

				return {
					success: true,
					data: tokens,
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
