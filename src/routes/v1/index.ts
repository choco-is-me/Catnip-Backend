// src/routes/v1/users/index.ts
import { FastifyInstance } from "fastify";
import authRoutes from "./auth/auth.routes";
import cardRoutes from "./cards/cards.routes";
import userRoutes from "./users/user.routes";

export default async function modifierRoutes(fastify: FastifyInstance) {
	// Register all user-related routes
	await fastify.register(authRoutes, { prefix: "/auth" });
	await fastify.register(userRoutes, { prefix: "/users" });
	await fastify.register(cardRoutes, { prefix: "/cards" });
}
