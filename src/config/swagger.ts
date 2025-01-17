// src/config/swagger.ts
import { SwaggerOptions } from "@fastify/swagger";

export const swaggerOptions: SwaggerOptions = {
	swagger: {
		info: {
			title: "Space Cat API Documentation",
			description: "API documentation for Space Cat App Backend",
			version: "1.0.0",
		},
		externalDocs: {
			url: "https://swagger.io",
			description: "Find more info here",
		},
		host: "localhost:3000",
		schemes: ["http", "https"],
		consumes: ["application/json"],
		produces: ["application/json"],
		tags: [
			{ name: "Users", description: "User related end-points" },
			{ name: "Cards", description: "Card related end-points" },
		],
		securityDefinitions: {
			apiKey: {
				type: "apiKey",
				name: "Authorization",
				in: "header",
			},
		},
	},
};

export const swaggerUiOptions = {
	routePrefix: "/documentation",
	exposeRoute: true,
	swagger: {
		info: {
			title: "Space Cat API Documentation",
			description: "API documentation for Space Cat App Backend",
			version: "1.0.0",
		},
	},
};
