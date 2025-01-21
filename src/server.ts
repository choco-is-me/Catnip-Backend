// src/schemas/index.ts
import cookie from "@fastify/cookie";
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
import userRoutes from "./routes/v1/users";
import { Logger } from "./services/logger.service";
import { getHelmetConfig } from "./config/helmet";
import { TokenCleanupService } from "./services/token-cleanup.service";

export async function buildServer(): Promise<FastifyInstance> {
	// Create Fastify instance with logger disabled
	const server = Fastify({
		logger: false,
	}).withTypeProvider<TypeBoxTypeProvider>();

	try {
		if (CONFIG.ENABLE_SECURITY_HEADERS) {
			await server.register(import("@fastify/helmet"), getHelmetConfig());
			// Add Permissions-Policy header separately
			server.addHook("onRequest", (_request, reply, done) => {
				reply.header(
					"Permissions-Policy",
					"accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
				);
				done();
			});
		}

		// Register core plugins
		await server.register(cookie, {
			secret: CONFIG.COOKIE_SECRET,
			hook: "onRequest",
		});

		// Register middleware
		await server.register(checkOwnershipPlugin);
		await server.register(authPlugin);

		// Register API documentation
		await server.register(fastifySwagger, swaggerOptions);
		await server.register(fastifySwaggerUi, swaggerUiOptions);

		// Register CORS
		await server.register(import("@fastify/cors"), {
			origin: CONFIG.CORS_ORIGIN,
		});

		// Register rate limiting
		await server.register(import("@fastify/rate-limit"), {
			max: 100,
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

		// Register database plugin
		await server.register(dbPlugin);

		// Start token cleanup service
		const tokenCleanup = TokenCleanupService.getInstance();
		await tokenCleanup.start();

		// Register shutdown hook
		server.addHook("onClose", async (_instance) => {
			// Stop token cleanup service
			await tokenCleanup.stop();

			// Log shutdown
			Logger.info("Shutting down token cleanup service", "Server");
		});

		// Add request logging hook if in debug mode
		if (CONFIG.LOG_LEVEL === "debug") {
			server.addHook("onResponse", (request, reply, done) => {
				Logger.debug(
					`${request.method} ${request.url} - ${reply.statusCode}`,
					"Request"
				);
				done();
			});
		}

		// Root route
		server.get("/", async () => {
			return {
				success: true,
				data: {
					name: "Catnip API",
					version: "1.0.0",
					description: "API for Catnip Application",
					documentation: "/documentation",
					health: "/health",
				},
			};
		});

		// Health check route
		server.get("/health", async () => {
			const dbStatus =
				mongoose.connection.readyState === 1
					? "connected"
					: "disconnected";
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

		// Register all API routes
		await server.register(userRoutes, { prefix: "/api/v1" });

		return server;
	} catch (err) {
		Logger.error(err as Error, "ServerBuild");
		throw err;
	}
}

// Start server function
async function startServer() {
	try {
		const server = await buildServer();

		await server.listen({
			port: CONFIG.PORT,
			host: CONFIG.HOST,
		});

		const displayHost =
			CONFIG.HOST === "0.0.0.0" ? "localhost" : CONFIG.HOST;
		Logger.info(
			`🚀 Server running at http://${displayHost}:${CONFIG.PORT}`
		);
		Logger.info(
			`📚 Documentation available at http://${displayHost}:${CONFIG.PORT}/documentation`
		);
	} catch (err) {
		Logger.error(err as Error, "StartServer");
		process.exit(1);
	}
}

// Only start the server if this file is run directly
if (require.main === module) {
	startServer();
}

export default buildServer;
