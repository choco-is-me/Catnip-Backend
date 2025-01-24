import { SwaggerOptions } from "@fastify/swagger";
import { FastifySwaggerUiOptions } from "@fastify/swagger-ui";
import { CONFIG } from "./index";

export const swaggerOptions: SwaggerOptions = {
	openapi: {
		info: {
			title: "Catnip API Documentation",
			description: `
### API Documentation for Catnip Application

This API provides endpoints for user authentication, profile management, and payment card operations.

### Authentication
- Uses JWT Bearer token authentication
- Access tokens expire in 5 minutes
- Refresh tokens are provided for token renewal
      `,
			version: "1.0.0",
			contact: {
				name: "API Support",
				email: "chocoisme.spacecat@gmail.com",
				url: "https://api.catnip.com/support",
			},
			license: {
				name: "MIT",
				url: "https://opensource.org/licenses/MIT",
			},
			termsOfService: "https://api.catnip.com/terms",
		},
		externalDocs: {
			description: "Find more info here",
			url: "https://api.catnip.com/docs",
		},
		servers: [
			{
				url: `http://${
					CONFIG.HOST === "0.0.0.0" ? "localhost" : CONFIG.HOST
				}:${CONFIG.PORT}`,
				description: "Development Server",
			},
			{
				url: "https://api.catnip.com",
				description: "Production Server",
			},
			{
				url: "https://staging.catnip.com",
				description: "Staging Server",
			},
		],
		tags: [
			{
				name: "Auth",
				description: "Authentication operations",
				externalDocs: {
					url: "https://api.catnip.com/docs/auth",
					description: "Auth Documentation",
				},
			},
			{
				name: "Users",
				description: "User profile management",
				externalDocs: {
					url: "https://api.catnip.com/docs/users",
					description: "Users Documentation",
				},
			},
			{
				name: "Cards",
				description: "Payment card operations",
				externalDocs: {
					url: "https://api.catnip.com/docs/cards",
					description: "Cards Documentation",
				},
			},
		],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "JWT",
					description:
						"JWT token for authentication. Prefix with 'Bearer '",
				},
				apiKey: {
					type: "apiKey",
					name: "x-api-key",
					in: "header",
					description:
						"API key for service-to-service authentication",
				},
				OAuth2: {
					type: "oauth2",
					flows: {
						authorizationCode: {
							authorizationUrl:
								"https://auth.catnip.com/oauth/authorize",
							tokenUrl: "https://auth.catnip.com/oauth/token",
							refreshUrl: "https://auth.catnip.com/oauth/refresh",
							scopes: {
								"user:read": "Read user profile",
								"user:write": "Update user profile",
								"cards:read": "View payment cards",
								"cards:write": "Manage payment cards",
							},
						},
					},
				},
			},
			responses: {
				UnauthorizedError: {
					description: "Authentication failed",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: {
										type: "boolean",
										example: false,
									},
									error: {
										type: "string",
										example: "UNAUTHORIZED",
									},
									message: {
										type: "string",
										example: "Invalid or expired token",
									},
									code: { type: "integer", example: 401 },
								},
							},
						},
					},
				},
				RateLimitError: {
					description: "Too many requests",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: {
										type: "boolean",
										example: false,
									},
									error: {
										type: "string",
										example: "RATE_LIMIT_EXCEEDED",
									},
									message: {
										type: "string",
										example:
											"Too many requests, please try again in 60 seconds",
									},
									code: { type: "integer", example: 429 },
								},
							},
						},
					},
				},
			},
		},
		security: [{ bearerAuth: [] }],
	},
};

export const swaggerUiOptions: FastifySwaggerUiOptions = {
	routePrefix: "/documentation",
	uiConfig: {
		docExpansion: "list",
		deepLinking: true,
		displayRequestDuration: true,
		filter: true,
		tryItOutEnabled: true,
		persistAuthorization: true,
	},
	theme: {
		title: "Catnip API Documentation",
	},
	staticCSP: true,
	transformStaticCSP: (header) => header,
};
