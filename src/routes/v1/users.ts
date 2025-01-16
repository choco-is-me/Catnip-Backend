import { Static, Type } from "@sinclair/typebox";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { CONFIG } from "../../config";
import { Card } from "../../models/Card";
import { User } from "../../models/User";
import JWTService from "../../services/jwt.service";
import { handleError } from "../../utils/error-handler";

import {
	CardResponseSchema,
	CardsResponseSchema,
	CreateCardBody,
	CreateUserBody,
	ErrorResponseSchema,
	LoginRequestBody,
	LoginResponseSchema,
	LogoutResponseSchema,
	PaginationQuery,
	ParamsWithUserId,
	ParamsWithUserIdAndCardId,

	// Common schemas
	ResponseWrapper,
	UpdateUserBody,
	UserResponseSchema,
} from "../../schemas";

// Type definitions
type UserParams = Static<typeof ParamsWithUserId>;
type UserAndCardParams = Static<typeof ParamsWithUserIdAndCardId>;
type CreateUserRequest = Static<typeof CreateUserBody>;
type UpdateUserRequest = Static<typeof UpdateUserBody>;
type CreateCardRequest = Static<typeof CreateCardBody>;
type LoginRequest = Static<typeof LoginRequestBody>;

export default async function userRoutes(fastify: FastifyInstance) {
	const authenticateHook = async (
		request: FastifyRequest,
		reply: FastifyReply
	) => {
		return fastify.authenticate(request, reply);
	};

	// Login Route
	fastify.post<{ Body: LoginRequest }>(
		"/users/login",
		{
			schema: {
				tags: ["Auth"],
				description: "User login",
				body: LoginRequestBody,
				response: {
					200: LoginResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			try {
				const { email, password } = request.body;

				if (!email || !password) {
					reply.code(400);
					return {
						success: false,
						error: "Validation Error",
						message:
							!email && !password
								? "Email and password are required"
								: !email
								? "Email is required"
								: "Password is required",
						code: 400,
					};
				}

				const user = await User.findOne({
					email: { $regex: new RegExp(`^${email}$`, "i") },
				});

				if (!user || !(await user.comparePassword(password))) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "Invalid email or password",
						code: 401,
					};
				}

				const tokens = JWTService.generateTokens(user._id.toString());

				reply.setCookie("refreshToken", tokens.refreshToken, {
					httpOnly: true,
					secure: CONFIG.COOKIE_SECURE,
					sameSite: "strict",
					path: "/api/v1/auth/refresh-token",
					maxAge: CONFIG.COOKIE_MAX_AGE,
					domain: CONFIG.COOKIE_DOMAIN,
					partitioned: true,
				});

				return {
					success: true,
					data: {
						user: {
							_id: user._id,
							email: user.email,
							firstName: user.firstName,
							lastName: user.lastName,
							company: user.company,
							address: user.address,
							phoneNumber: user.phoneNumber,
						},
						tokens: {
							accessToken: tokens.accessToken,
						},
					},
				};
			} catch (err) {
				const error = handleError(err);
				reply.code(error.code || 500);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code || 500,
				};
			}
		}
	);

	// Register Route
	fastify.post<{ Body: CreateUserRequest }>(
		"/users/register",
		{
			schema: {
				tags: ["Auth"],
				description: "Create a new user account",
				body: CreateUserBody,
				response: {
					201: UserResponseSchema,
					400: ErrorResponseSchema,
					409: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			try {
				const existingUser = await User.findOne({
					email: request.body.email,
				});
				if (existingUser) {
					reply.code(409);
					return {
						success: false,
						error: "Duplicate Error",
						message: "Email already registered",
						code: 409,
					};
				}

				const user = new User(request.body);
				await user.save();

				reply.code(201);
				return {
					success: true,
					data: {
						user: {
							_id: user._id,
							email: user.email,
							firstName: user.firstName,
							lastName: user.lastName,
							company: user.company,
							address: user.address,
							phoneNumber: user.phoneNumber,
							createdAt: user.createdAt,
							updatedAt: user.updatedAt,
						},
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

	// Protected Routes
	fastify.post(
		"/users/logout",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Auth"],
				description: "Logout user",
				response: {
					200: LogoutResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			try {
				if (!request.user) {
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "Invalid token",
						code: 401,
					};
				}

				const authHeader = request.headers.authorization;
				if (!authHeader?.startsWith("Bearer ")) {
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "No token provided",
						code: 401,
					};
				}

				const token = authHeader.split(" ")[1];
				const decodedToken = JWTService.verifyToken(token);

				if (decodedToken.jti) {
					JWTService.invalidateToken(decodedToken.jti);
				}

				reply.clearCookie("refreshToken", {
					httpOnly: true,
					secure: CONFIG.COOKIE_SECURE,
					sameSite: "strict",
					path: "/api/v1/auth/refresh-token",
					domain: CONFIG.COOKIE_DOMAIN,
					partitioned: true,
				});

				return {
					success: true,
					data: {
						message: "Logged out successfully",
					},
				};
			} catch (err) {
				const error = handleError(err);
				reply.code(error.code || 500);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Get User Profile
	fastify.get<{ Params: UserParams }>(
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
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			try {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) return;

				const user = await User.findById(request.params.userId).select(
					"-password"
				);
				if (!user) {
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "User not found",
						code: 404,
					};
				}

				return { success: true, data: { user } };
			} catch (err) {
				const error = handleError(err);
				reply.code(error.code || 500);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			}
		}
	);

	// Update User Profile
	fastify.put<{ Params: UserParams; Body: UpdateUserRequest }>(
		"/users/:userId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Users"],
				description: "Update user profile",
				params: ParamsWithUserId,
				body: UpdateUserBody,
				response: {
					200: UserResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await mongoose.startSession();
			session.startTransaction();

			try {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) {
					await session.abortTransaction();
					return;
				}

				const user = await User.findByIdAndUpdate(
					request.params.userId,
					{ $set: request.body },
					{ new: true, session }
				).select("-password");

				if (!user) {
					await session.abortTransaction();
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "User not found",
						code: 404,
					};
				}

				await session.commitTransaction();
				return { success: true, data: { user } };
			} catch (err) {
				await session.abortTransaction();
				const error = handleError(err);
				reply.code(error.code || 500);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			} finally {
				session.endSession();
			}
		}
	);

	// Delete User Account
	fastify.delete<{ Params: UserParams }>(
		"/users/:userId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Users"],
				description: "Delete user account",
				params: ParamsWithUserId,
				response: {
					200: LogoutResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await mongoose.startSession();
			session.startTransaction();

			try {
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) {
					await session.abortTransaction();
					return;
				}

				const { userId } = request.params;

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
						code: 404,
					};
				}

				const authHeader = request.headers.authorization;
				if (authHeader?.startsWith("Bearer ")) {
					const token = authHeader.split(" ")[1];
					const decodedToken = JWTService.verifyToken(token);
					if (decodedToken.jti) {
						JWTService.invalidateToken(decodedToken.jti);
					}
				}

				reply.clearCookie("refreshToken", {
					httpOnly: true,
					secure: CONFIG.COOKIE_SECURE,
					sameSite: "strict",
					path: "/api/v1/auth/refresh-token",
					domain: CONFIG.COOKIE_DOMAIN,
					partitioned: true,
				});

				await session.commitTransaction();
				return {
					success: true,
					data: {
						message: "User account deleted successfully",
					},
				};
			} catch (err) {
				await session.abortTransaction();
				const error = handleError(err);
				reply.code(error.code || 500);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			} finally {
				session.endSession();
			}
		}
	);

	// Add card route
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
					201: CardResponseSchema,
					400: ErrorResponseSchema,
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (
			request: FastifyRequest<{
				Params: Static<typeof ParamsWithUserId>;
				Body: Static<typeof CreateCardBody>;
			}>,
			reply
		) => {
			const session = await mongoose.startSession();
			session.startTransaction();

			try {
				const { userId } = request.params;
				const cardData = request.body;

				// Check if user exists
				const user = await User.findById(userId).session(session);
				if (!user) {
					await session.abortTransaction();
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "User not found",
						code: 404,
					};
				}

				// Create new card with sanitized data
				const newCard = new Card({
					...cardData,
					userId,
					nameOnCard: cardData.nameOnCard.trim().toUpperCase(),
					cardNumber: cardData.cardNumber.trim(),
				});

				await newCard.save({ session });

				// Update default status of other cards if needed
				if (cardData.isDefault) {
					await Card.updateMany(
						{
							userId,
							_id: { $ne: newCard._id },
							isDefault: true,
						},
						{ isDefault: false }
					).session(session);
				}

				await session.commitTransaction();
				reply.code(201);
				return {
					success: true,
					data: {
						card: {
							...newCard.toObject(),
							createdAt: newCard.createdAt.toISOString(),
							updatedAt: newCard.updatedAt.toISOString(),
						},
					},
				};
			} catch (err) {
				await session.abortTransaction();
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			} finally {
				session.endSession();
			}
		}
	);

	// Get user's cards route
	fastify.get(
		"/users/:userId/cards",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Cards"],
				description: "Get all cards associated with a user",
				params: ParamsWithUserId,
				querystring: PaginationQuery,
				response: {
					200: CardsResponseSchema,
					400: ErrorResponseSchema,
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (
			request: FastifyRequest<{
				Params: Static<typeof ParamsWithUserId>;
				Querystring: Static<typeof PaginationQuery>;
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
				const {
					page = 1,
					limit = 10,
					sortBy = "createdAt",
					order = "desc",
				} = request.query;

				const [cards, total] = await Promise.all([
					Card.find({ userId })
						.sort({ [sortBy]: order === "desc" ? -1 : 1 })
						.skip((page - 1) * limit)
						.limit(limit)
						.lean(),
					Card.countDocuments({ userId }),
				]);

				return {
					success: true,
					data: {
						cards,
						total,
						page,
						totalPages: Math.ceil(total / limit),
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

	// Delete card route
	fastify.delete(
		"/users/:userId/cards/:cardId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Cards"],
				description: "Delete a specific card from user account",
				params: ParamsWithUserIdAndCardId,
				response: {
					200: ResponseWrapper(
						Type.Object({
							message: Type.Literal("Card deleted successfully"),
						})
					),
					400: ErrorResponseSchema,
					404: ErrorResponseSchema,
					429: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (
			request: FastifyRequest<{
				Params: Static<typeof ParamsWithUserIdAndCardId>;
			}>,
			reply
		) => {
			const session = await mongoose.startSession();
			session.startTransaction();

			try {
				// Check ownership before proceeding
				const hasPermission = await fastify.checkOwnership(
					request,
					reply
				);
				if (!hasPermission) {
					await session.abortTransaction();
					return;
				}

				const { userId, cardId } = request.params;

				// Find the card to check if it exists and if it was default
				const card = await Card.findOne({
					_id: cardId,
					userId,
				}).session(session);

				if (!card) {
					await session.abortTransaction();
					reply.code(404);
					return {
						success: false,
						error: "Not Found",
						message: "Card not found",
						code: 404,
					};
				}

				// Delete the card
				await Card.deleteOne({
					_id: cardId,
					userId,
				}).session(session);

				// If this was a default card, set another card as default
				if (card.isDefault) {
					const anotherCard = await Card.findOne({ userId })
						.sort({ createdAt: -1 })
						.session(session);

					if (anotherCard) {
						await Card.findByIdAndUpdate(
							anotherCard._id,
							{ isDefault: true },
							{ session }
						);
					}
				}

				await session.commitTransaction();
				return {
					success: true,
					data: {
						message: "Card deleted successfully",
					},
				};
			} catch (err) {
				await session.abortTransaction();
				const error = handleError(err);
				reply.code(error.code || 400);
				return {
					success: false,
					error: error.error,
					message: error.message,
					code: error.code,
				};
			} finally {
				session.endSession();
			}
		}
	);
}
