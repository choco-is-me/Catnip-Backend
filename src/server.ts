import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { CONFIG } from "./config";
import { swaggerOptions, swaggerUiOptions } from "./config/swagger";
import dbPlugin from "./plugins/mongodb";
import userRoutes from "./routes/v1/users";

export async function buildServer(): Promise<FastifyInstance> {
	const server = Fastify({
		logger: {
			level: CONFIG.LOG_LEVEL,
		},
	}).withTypeProvider<TypeBoxTypeProvider>();

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
