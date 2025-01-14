import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { CONFIG } from "./config";
import { swaggerOptions, swaggerUiOptions } from "./config/swagger";
import authPlugin from "./middlewares/auth";
import checkOwnershipPlugin from "./middlewares/checkOwnership";
import dbPlugin from "./plugins/mongodb";
import authRoutes from "./routes/v1/auth";
import userRoutes from "./routes/v1/users";
import cookie from "@fastify/cookie";

export async function buildServer(): Promise<FastifyInstance> {
	const server = Fastify({
		logger: {
			level: CONFIG.LOG_LEVEL,
		},
	}).withTypeProvider<TypeBoxTypeProvider>();

	// Register the cookie plugin
	await server.register(cookie, {
		secret: CONFIG.COOKIE_SECRET,
		hook: "onRequest",
	});

	// Register the ownership middleware
	await server.register(checkOwnershipPlugin);

	// Register the authentication middleware
	await server.register(authPlugin);

	// Register the auth routes
	await server.register(authRoutes, { prefix: "/api/v1/auth" });

	// Add Swagger documentation
	await server.register(fastifySwagger, swaggerOptions);
	await server.register(fastifySwaggerUi, swaggerUiOptions);

	// Register plugins
	await server.register(import("@fastify/cors"), {
		origin: CONFIG.CORS_ORIGIN,
	});

	// Add rate limiting
	await server.register(import("@fastify/rate-limit"), {
		max: 5,
		timeWindow: "1 minute",
		errorResponseBuilder: function (_, context) {
			return {
				success: false,
				error: "Rate Limit Exceeded",
				message: `Rate limit exceeded, please try again in ${context.after}`,
				code: 429,
			};
		},
	});

	// Register MongoDB plugin
	await server.register(dbPlugin);

	// Add a test route that checks MongoDB connection
	server.get("/health", async () => {
		const dbStatus =
			mongoose.connection.readyState === 1 ? "connected" : "disconnected";
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			database: {
				status: dbStatus,
				host: mongoose.connection.host,
				name: mongoose.connection.name,
			},
		};
	});

	// Register
	await server.register(userRoutes, { prefix: "/api/v1" });

	return server;
}

async function startServer() {
	try {
		const server = await buildServer();
		await server.listen({
			port: CONFIG.PORT,
			host: CONFIG.HOST,
		});
	} catch (err) {
		console.error(err);
		process.exit(1);
	}
}

if (require.main === module) {
	startServer();
}
