// src/routes/v1/users/index.ts
import { FastifyInstance } from "fastify";
import authRoutes from "./auth.routes";
import cardRoutes from "./cards.routes";
import profileRoutes from "./profile.routes";

export default async function userRoutes(fastify: FastifyInstance) {
	// Register all user-related routes
	await fastify.register(authRoutes, { prefix: "/auth" });
	await fastify.register(profileRoutes, { prefix: "/users" });
	await fastify.register(cardRoutes, { prefix: "/cards" });
}
