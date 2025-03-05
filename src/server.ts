// src/server.ts
import cookie from "@fastify/cookie";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { CONFIG } from "./config";
import { getHelmetConfig } from "./config/helmet";
import { swaggerOptions, swaggerUiOptions } from "./config/swagger";
import authPlugin from "./middlewares/auth";
import rbacPlugin from "./middlewares/rbac";
import dbPlugin from "./plugins/mongodb";
import modifierRoutes from "./routes/v1";
import { Logger } from "./services/logger.service";
import { TokenCleanupService } from "./services/token-cleanup.service";
import { handleError } from "./utils/error-handler";
import { CartCleanupService } from "./services/cart-cleanup.service";

export async function buildServer(): Promise<FastifyInstance> {
	// Create Fastify instance with logger disabled
	const server = Fastify({
		logger: false,
	}).withTypeProvider<TypeBoxTypeProvider>();

	server.setSchemaErrorFormatter(function (errors, _dataVar) {
		// Create more user-friendly messages based on error types
		const errorMessage =
			errors.map((error) => {
				if (
					error.keyword === "pattern" &&
					error.params?.field === "userId"
				) {
					return "Invalid user ID format";
				}
				if (
					error.keyword === "type" &&
					error.params?.field === "userId"
				) {
					return "User ID must be a string";
				}
				if (
					error.keyword === "required" &&
					error.params?.missingProperty === "userId"
				) {
					return "User ID is required";
				}
				// Default to the original message if no specific mapping
				return error.message;
			})[0] || "Validation error";

		const err = new Error(errorMessage);
		Object.assign(err, {
			success: false,
			error: "INVALID_FORMAT",
			message: errorMessage,
			code: 400,
		});

		return err;
	});

	try {
		if (CONFIG.ENABLE_SECURITY_HEADERS) {
			await server.register(import("@fastify/helmet"), getHelmetConfig());
			// Add Permissions-Policy header separately
			server.addHook("onRequest", (_request, reply, done) => {
				reply.header(
					"Permissions-Policy",
					"accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), cross-origin-isolated=(), display-capture=(), document-domain=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(), geolocation=(), gyroscope=(), keyboard-map=(), magnetometer=(), microphone=(), midi=(), navigation-override=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(), usb=(), web-share=(), xr-spatial-tracking=(), clipboard-read=(), clipboard-write=(), gamepad=(), speaker-selection=(), conversion-measurement=(), focus-without-user-activation=(), hid=(), idle-detection=(), interest-cohort=(), serial=(), trust-token-redemption=(), window-placement=(), vertical-scroll=()"
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
		await server.register(authPlugin);
		await server.register(rbacPlugin);

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

		const cartCleanup = CartCleanupService.getInstance();
		await cartCleanup.start();

		// Register shutdown hook
		server.addHook("onClose", async (_instance) => {
			// Stop token cleanup service
			await tokenCleanup.stop();

			// Stop cart cleanup service
			await cartCleanup.stop();

			// Log shutdown
			Logger.info("Shutting down cleanup services", "Server");
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

		server.setErrorHandler(function (error, _request, reply) {
			// Handle validation errors from TypeBox/Fastify validation
			if (error.validation) {
				return reply.status(400).send({
					success: false,
					error: "VALIDATION_ERROR",
					message: error.message,
					code: 400,
				});
			}

			// Handle other errors
			const formattedError = handleError(error);
			return reply.status(formattedError.code).send(formattedError);
		});

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
		await server.register(modifierRoutes, { prefix: "/api/v1" });

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
