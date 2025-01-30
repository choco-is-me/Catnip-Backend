// src/routes/v1/users/index.ts
import { FastifyInstance } from "fastify";
import authRoutes from "./auth/auth.routes";
import cardRoutes from "./cards/cards.routes";
import userRoutes from "./users/user.routes";
import itemRoutes from "./items/items.routes";
import supplierRoutes from "./suppliers/suppliers.routes";
import publicItemRoutes from "./items/public.items.routes";

export default async function modifierRoutes(fastify: FastifyInstance) {
	// Public routes (no authentication required)
	await fastify.register(authRoutes, { prefix: "/auth" });
	await fastify.register(publicItemRoutes, { prefix: "/public/items" });

	// User routes (requires user role)
	await fastify.register(userRoutes, {
		prefix: "/users",
		routeConfig: fastify.protectedRoute(["user", "admin"]),
	});
	await fastify.register(cardRoutes, {
		prefix: "/cards",
		routeConfig: fastify.protectedRoute(["user", "admin"]),
	});

	// Admin routes (requires admin role)
	await fastify.register(itemRoutes, {
		prefix: "/items",
		routeConfig: fastify.protectedRoute(["admin"]),
	});
	await fastify.register(supplierRoutes, {
		prefix: "/suppliers",
		routeConfig: fastify.protectedRoute(["admin"]),
	});
}
