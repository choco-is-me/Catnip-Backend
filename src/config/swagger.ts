// src/config/swagger.ts
import { SwaggerOptions } from "@fastify/swagger";
import { FastifySwaggerUiOptions } from "@fastify/swagger-ui";
import { CONFIG } from "./index";

export const swaggerOptions: SwaggerOptions = {
	openapi: {
		info: {
			title: "Catnip API Documentation",
			description: `
### API Documentation for Catnip Application

This API provides endpoints for user authentication, profile management, payment cards, items, and supplier operations.

### Authentication and Authorization
- Uses JWT Bearer token authentication
- Access tokens expire in 5 minutes
- Refresh tokens are provided for token renewal
- Role-based access control (RBAC) is implemented

### Role Types
1. Public (No authentication required)
   - Authentication endpoints (login, register)
   - Public item viewing endpoints

2. User Role
   - Profile management
   - Payment card management
   - Can only access their own resources

3. Admin Role
   - Full access to all endpoints
   - Item management (create, update, delete)
   - Supplier management
   - Access to all user resources

### Access Control Notes
- Users can only access their own profile and cards
- Admin has access to all resources
- Public endpoints don't require authentication
- Invalid role access attempts will return a 403 Forbidden error
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
		],
		tags: [
			{
				name: "Auth",
				description: "Authentication operations (Public Access)",
				externalDocs: {
					url: "https://api.catnip.com/docs/auth",
					description: "Auth Documentation",
				},
			},
			{
				name: "Public Items",
				description:
					"Public item viewing operations (No authentication required)",
				externalDocs: {
					url: "https://api.catnip.com/docs/public-items",
					description: "Public Items Documentation",
				},
			},
			{
				name: "Users",
				description: "User profile management (User & Admin Access)",
				externalDocs: {
					url: "https://api.catnip.com/docs/users",
					description: "Users Documentation",
				},
			},
			{
				name: "Cards",
				description: "Payment card operations (User & Admin Access)",
				externalDocs: {
					url: "https://api.catnip.com/docs/cards",
					description: "Cards Documentation",
				},
			},
			{
				name: "Items",
				description: "Item management operations (Admin Only)",
				externalDocs: {
					url: "https://api.catnip.com/docs/items",
					description: "Items Documentation",
				},
			},
			{
				name: "Suppliers",
				description: "Supplier management operations (Admin Only)",
				externalDocs: {
					url: "https://api.catnip.com/docs/suppliers",
					description: "Suppliers Documentation",
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
				ForbiddenError: {
					description: "Permission denied",
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
										example: "FORBIDDEN",
									},
									message: {
										type: "string",
										example:
											"Insufficient permissions for this operation",
									},
									code: { type: "integer", example: 403 },
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
		security: [{ bearerAuth: [] }], // Default security requirement
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
