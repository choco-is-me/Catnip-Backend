import { Static, Type } from "@sinclair/typebox";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Error } from "mongoose";
import { Card } from "../../models/Card";
import { User, IUser } from "../../models/User";
import JWTService from "../../services/jwt.service";
// Response schemas for Swagger
const UserResponseSchema = Type.Object({
	success: Type.Boolean(),
	data: Type.Object({
		user: Type.Object({
			_id: Type.String(),
			email: Type.String(),
			firstName: Type.String(),
			lastName: Type.String(),
			company: Type.Optional(Type.String()),
			address: Type.Object({
				street: Type.String(),
				city: Type.String(),
				province: Type.String(),
				zipCode: Type.String(),
			}),
			phoneNumber: Type.String(),
			createdAt: Type.String(),
			updatedAt: Type.String(),
		}),
	}),
});

const ErrorResponseSchema = Type.Object({
	success: Type.Boolean(),
	code: Type.Optional(Type.Number()),
	error: Type.String(),
	message: Type.String(),
});

// Parameter types
const ParamsWithUserId = Type.Object({
	userId: Type.String(),
});

const ParamsWithUserIdAndCardId = Type.Object({
	userId: Type.String(),
	cardId: Type.String(),
});

// Request body types
const CreateUserBody = Type.Object({
	email: Type.String({ format: "email" }),
	password: Type.String({ minLength: 8 }),
	firstName: Type.String(),
	lastName: Type.String(),
	company: Type.Optional(Type.String()),
	address: Type.Object({
		street: Type.String(),
		city: Type.String(),
		province: Type.String(),
		zipCode: Type.String(),
	}),
	phoneNumber: Type.String(),
});

const UpdateUserBody = Type.Object({
	firstName: Type.Optional(Type.String()),
	lastName: Type.Optional(Type.String()),
	company: Type.Optional(Type.String()),
	address: Type.Optional(
		Type.Object({
			street: Type.String(),
			city: Type.String(),
			province: Type.String(),
			zipCode: Type.String(),
		})
	),
	phoneNumber: Type.Optional(Type.String()),
});

const CreateCardBody = Type.Object({
	cardNumber: Type.String(),
	expirationDate: Type.String(),
	nameOnCard: Type.String(),
	isDefault: Type.Optional(Type.Boolean()),
});

// Type definitions
type UserParams = Static<typeof ParamsWithUserId>;
type UserAndCardParams = Static<typeof ParamsWithUserIdAndCardId>;
type CreateUserRequest = Static<typeof CreateUserBody>;
type UpdateUserRequest = Static<typeof UpdateUserBody>;
type CreateCardRequest = Static<typeof CreateCardBody>;

export default async function userRoutes(fastify: FastifyInstance) {
	// Create reusable auth hook
	const authenticateHook = async (
		request: FastifyRequest,
		reply: FastifyReply
	) => {
		return fastify.authenticate(request, reply);
	};

	// Login Route
	fastify.post(
		"/users/login",
		{
			schema: {
				tags: ["Auth"],
				description: "User login",
				body: Type.Object({
					email: Type.String({ format: "email" }),
					password: Type.String(),
				}),
				response: {
					200: Type.Object({
						success: Type.Boolean(),
						data: Type.Object({
							user: Type.Object({
								_id: Type.String(),
								email: Type.String(),
								firstName: Type.String(),
								lastName: Type.String(),
							}),
							tokens: Type.Object({
								accessToken: Type.String(),
								refreshToken: Type.String(),
							}),
						}),
					}),
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (
			request: FastifyRequest<{
				Body: { email: string; password: string };
			}>,
			reply
		) => {
			try {
				const { email, password } = request.body;
				const user = await User.findOne({ email });

				if (!user || !(await user.comparePassword(password))) {
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "Invalid email or password",
					};
				}

				const tokens = JWTService.generateTokens(user._id.toString());

				return {
					success: true,
					data: {
						user: {
							_id: user._id,
							email: user.email,
							firstName: user.firstName,
							lastName: user.lastName,
						},
						tokens,
					},
				};
			} catch (err) {
				const error = handleError(err);
				reply.code(error.code || 500);
				return {
					success: false,
					error: error.error,
					message: error.message,
				};
			}
		}
	);

	// Register user
	fastify.post(
		"/users/register",
		{
			schema: {
				tags: ["Auth"],
				description: "Create a new user account",
				body: CreateUserBody,
				response: {
					201: Type.Object({
						success: Type.Boolean(),
						data: Type.Object({
							user: Type.Object({
								_id: Type.String(),
								email: Type.String(),
								firstName: Type.String(),
								lastName: Type.String(),
							}),
							tokens: Type.Object({
								accessToken: Type.String(),
								refreshToken: Type.String(),
							}),
						}),
					}),
					400: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest<{ Body: CreateUserRequest }>, reply) => {
			try {
				const userData = request.body;

				// Check if user exists
				const existingUser = await User.findOne({
					email: userData.email,
				});
				if (existingUser) {
					reply.code(409);
					return {
						success: false,
						error: "Duplicate Error",
						message: "Email already registered",
					};
				}

				const user = new User(userData);
				await user.save();

				// Generate tokens for auto-login after registration
				const tokens = JWTService.generateTokens(user._id.toString());

				reply.code(201);
				return {
					success: true,
					data: {
						user: {
							_id: user._id,
							email: user.email,
							firstName: user.firstName,
							lastName: user.lastName,
						},
						tokens,
					},
				};
			} catch (err) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Protected Routes (Require Authentication)

	// Logout
	fastify.post(
		"/users/logout",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Auth"],
				description: "Logout user",
				response: {
					200: Type.Object({
						success: Type.Boolean(),
						message: Type.String(),
					}),
					401: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest, reply) => {
			try {
				if (!request.user || !request.user.jti) {
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "Invalid token",
					};
				}

				JWTService.invalidateToken(request.user.jti);
				return {
					success: true,
					message: "Logged out successfully",
				};
			} catch (err) {
				const error = handleError(err);
				reply.code(error.code || 500);
				return {
					success: false,
					error: error.error,
					message: error.message,
				};
			}
		}
	);

	// Get user profile
	fastify.get(
		"/users/:userId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Users"],
				description: "Get user profile by ID",
				params: ParamsWithUserId,
				response: {
					200: UserResponseSchema,
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest<{ Params: UserParams }>, reply) => {
			try {
				// Check ownership before proceeding
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;

				const { userId } = request.params;
				const user = await User.findById(userId).select("-password");

				if (!user) {
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "User not found",
					};
				}

				return { success: true, data: { user } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Update user profile
	fastify.put(
		"/users/:userId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Users"],
				description: "Update user profile information",
				params: ParamsWithUserId,
				body: UpdateUserBody,
				response: {
					200: UserResponseSchema,
					404: ErrorResponseSchema,
					400: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (
			request: FastifyRequest<{
				Params: UserParams;
				Body: UpdateUserRequest;
			}>,
			reply
		) => {
			try {
				// Check ownership before proceeding
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;

				const { userId } = request.params;
				const updateData = request.body;

				const user = await User.findByIdAndUpdate(
					userId,
					{ $set: updateData },
					{ new: true }
				).select("-password");

				if (!user) {
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "User not found",
					};
				}

				return { success: true, data: { user } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Delete user account
	fastify.delete(
		"/users/:userId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Users"],
				description: "Delete user account and all associated data",
				params: ParamsWithUserId,
				response: {
					200: Type.Object({
						success: Type.Boolean(),
						message: Type.String(),
					}),
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest<{ Params: UserParams }>, reply) => {
			try {
				// Check ownership before proceeding
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;

				const { userId } = request.params;
				const session = await User.startSession();
				session.startTransaction();

				try {
					await Card.deleteMany({ userId }).session(session);
					const user = await User.findByIdAndDelete(userId).session(
						session
					);

					if (!user) {
						await session.abortTransaction();
						reply.code(404);
						return {
							success: false,
							error: "Not Found",
							message: "User not found",
						};
					}

					await session.commitTransaction();
					return {
						success: true,
						message:
							"User account and all associated data have been deleted successfully",
					};
				} catch (error) {
					await session.abortTransaction();
					throw error;
				} finally {
					session.endSession();
				}
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Add card
	fastify.post(
		"/users/:userId/cards",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Cards"],
				description: "Add a new card to user account",
				params: ParamsWithUserId,
				body: CreateCardBody,
				response: {
					201: Type.Object({
						success: Type.Boolean(),
						data: Type.Object({
							card: Type.Object({
								_id: Type.String(),
								cardNumber: Type.String(),
								expirationDate: Type.String(),
								nameOnCard: Type.String(),
								isDefault: Type.Boolean(),
								userId: Type.String(),
								createdAt: Type.String(),
								updatedAt: Type.String(),
							}),
						}),
					}),
					404: ErrorResponseSchema,
					400: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (
			request: FastifyRequest<{
				Params: UserParams;
				Body: CreateCardRequest;
			}>,
			reply
		) => {
			try {
				// Check ownership before proceeding
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;

				const { userId } = request.params;
				const cardData = request.body;

				const user = await User.findById(userId);
				if (!user) {
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "User not found",
					};
				}

				const newCard = new Card({
					...cardData,
					userId,
				});
				await newCard.save();
				reply.code(201);
				return { success: true, data: { card: newCard } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Get user's cards
	fastify.get(
		"/users/:userId/cards",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Cards"],
				description: "Get all cards associated with a user",
				params: ParamsWithUserId,
				response: {
					200: Type.Object({
						success: Type.Boolean(),
						data: Type.Object({
							cards: Type.Array(
								Type.Object({
									_id: Type.String(),
									cardNumber: Type.String(),
									expirationDate: Type.String(),
									nameOnCard: Type.String(),
									isDefault: Type.Boolean(),
									userId: Type.String(),
									createdAt: Type.String(),
									updatedAt: Type.String(),
								})
							),
						}),
					}),
					400: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest<{ Params: UserParams }>, reply) => {
			try {
				// Check ownership before proceeding
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;

				const { userId } = request.params;
				const cards = await Card.find({ userId });
				return { success: true, data: { cards } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Delete card
	fastify.delete(
		"/users/:userId/cards/:cardId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Cards"],
				description: "Delete a specific card from user account",
				params: ParamsWithUserIdAndCardId,
				response: {
					200: Type.Object({
						success: Type.Boolean(),
						message: Type.String(),
					}),
					404: ErrorResponseSchema,
					400: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (
			request: FastifyRequest<{ Params: UserAndCardParams }>,
			reply
		) => {
			try {
				// Check ownership before proceeding
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;

				const { userId, cardId } = request.params;
				const card = await Card.findOneAndDelete({
					_id: cardId,
					userId,
				});

				if (!card) {
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "Card not found",
					};
				}

				return {
					success: true,
					message: "Card deleted successfully",
				};
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);
}

// Updated error handling interface and function
interface ApiError {
	code?: number;
	error: string;
	message: string;
}

const handleError = (error: unknown): ApiError => {
	if (error instanceof Error.ValidationError) {
		return {
			code: 400,
			error: "Validation Error",
			message: error.message,
		};
	}

	if (error instanceof Error.CastError) {
		return {
			code: 400,
			error: "Invalid Format",
			message: "Invalid ID format",
		};
	}

	if (error instanceof Error) {
		return {
			code: 500,
			error: "Server Error",
			message: error.message,
		};
	}

	return {
		code: 500,
		error: "Unknown Error",
		message: "An unexpected error occurred",
	};
};
