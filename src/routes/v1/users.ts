import { Static, Type } from "@sinclair/typebox";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import mongoose, { Error } from "mongoose";
import { CONFIG } from "../../config";
import { Card } from "../../models/Card";
import { User } from "../../models/User";
import JWTService from "../../services/jwt.service";
import { handleError } from "../../utils/error-handler";

import {
	CardResponseSchema,
	CardsResponseSchema,
	// Card schemas
	CreateCardBody,
	// User schemas
	CreateUserBody,
	// Common schemas
	ErrorResponseSchema,
	// Auth schemas
	LoginRequestBody,
	LoginResponseSchema,
	ParamsWithUserId,
	ParamsWithUserIdAndCardId,
	UpdateUserBody,
	UserResponseSchema,
} from "../../schemas";

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
		async (
			request: FastifyRequest<{
				Body: Static<typeof LoginRequestBody>;
			}>,
			reply
		) => {
			try {
				const { email, password } = request.body;

				// 1. Input validation with improved error messages
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

				// 2. Find user with case-insensitive email search
				const user = await User.findOne({
					email: { $regex: new RegExp(`^${email}$`, "i") },
				});

				// 3. Use timing-safe comparison for security
				if (!user || !(await user.comparePassword(password))) {
					// Add a small delay to prevent timing attacks
					await new Promise((resolve) => setTimeout(resolve, 1000));
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "Invalid email or password",
						code: 401,
					};
				}

				// 4. Generate tokens with better error handling
				let tokens;
				try {
					tokens = JWTService.generateTokens(user._id.toString());
				} catch (tokenError) {
					console.error("Token Generation Error:", tokenError);
					reply.code(500);
					return {
						success: false,
						error: "Authentication Error",
						message: "Failed to generate authentication tokens",
						code: 500,
					};
				}

				// 5. Set refresh token in HTTP-only cookie
				reply.setCookie("refreshToken", tokens.refreshToken, {
					httpOnly: true,
					secure: CONFIG.COOKIE_SECURE,
					sameSite: "strict",
					path: "/api/v1/auth/refresh-token",
					maxAge: CONFIG.COOKIE_MAX_AGE,
					domain: CONFIG.COOKIE_DOMAIN,
					partitioned: true, // Add CHIPS support for enhanced privacy
				});

				// 6. Send successful response with user data and access token
				return {
					success: true,
					data: {
						user: {
							_id: user._id,
							email: user.email,
							firstName: user.firstName,
							lastName: user.lastName,
							company: user.company,
							address: {
								street: user.address.street,
								city: user.address.city,
								province: user.address.province,
								zipCode: user.address.zipCode,
							},
							phoneNumber: user.phoneNumber,
						},
						tokens: {
							accessToken: tokens.accessToken,
							// Don't send refresh token in response body for security
							// It's already set in HTTP-only cookie
							refreshToken: undefined,
						},
					},
				};
			} catch (err) {
				// 7. Enhanced error handling with logging
				const error = handleError(err);
				console.error("Login Error:", {
					timestamp: new Date().toISOString(),
					error: error.message,
					email: request.body.email, // Log attempted email for monitoring
				});

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

	// Register user
	fastify.post(
		"/users/register",
		{
			schema: {
				tags: ["Auth"],
				description: "Create a new user account",
				body: CreateUserBody,
				response: {
					201: UserResponseSchema,
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
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest, reply) => {
			try {
				// Check if user exists in request (set by authenticateHook)
				if (!request.user) {
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "Invalid token",
					};
				}

				// Extract token from Authorization header
				const authHeader = request.headers.authorization;
				if (!authHeader || !authHeader.startsWith("Bearer ")) {
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "No token provided",
					};
				}

				const token = authHeader.split(" ")[1];

				try {
					// Verify and decode the token to get the jti
					const decodedToken = JWTService.verifyToken(token);

					if (!decodedToken.jti) {
						reply.code(401);
						return {
							success: false,
							error: "Authentication Failed",
							message: "Invalid token format",
						};
					}

					// Invalidate the token
					JWTService.invalidateToken(decodedToken.jti);

					// Clear the refresh token cookie
					reply.clearCookie("refreshToken", {
						httpOnly: true,
						secure: CONFIG.COOKIE_SECURE,
						sameSite: "strict",
						path: "/api/v1/auth/refresh-token",
						domain: CONFIG.COOKIE_DOMAIN,
						partitioned: true, // Keep CHIPS support
					});

					return {
						success: true,
						message: "Logged out successfully",
					};
				} catch (tokenError) {
					console.error("Token Verification Error:", tokenError);
					reply.code(401);
					return {
						success: false,
						error: "Authentication Failed",
						message: "Invalid or expired token",
					};
				}
			} catch (err) {
				console.error("Logout Error:", err);
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

				const { userId } = request.params;
				const updateData = request.body;

				const user = await User.findByIdAndUpdate(
					userId,
					{ $set: updateData },
					{ new: true, session }
				).select("-password");

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
				return { success: true, data: { user } };
			} catch (err: unknown) {
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
					// Extract token for invalidation
					const authHeader = request.headers.authorization;
					if (!authHeader || !authHeader.startsWith("Bearer ")) {
						throw new Error("No token provided");
					}
					const token = authHeader.split(" ")[1];

					// Delete associated data
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

					reply.clearCookie("refreshToken", {
						httpOnly: true,
						secure: CONFIG.COOKIE_SECURE,
						sameSite: "strict",
						path: "/api/v1/auth/refresh-token",
						domain: CONFIG.COOKIE_DOMAIN,
						partitioned: true, // Keep CHIPS support
					});

					// Verify and invalidate the token
					try {
						const decodedToken = JWTService.verifyToken(token);
						if (decodedToken.jti) {
							JWTService.invalidateToken(decodedToken.jti);
						}
					} catch (tokenError) {
						console.error("Token Invalidation Error:", tokenError);
						// Continue with account deletion even if token invalidation fails
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
					201: CardResponseSchema,
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
			const session = await mongoose.startSession();
			session.startTransaction();

			try {
				const { userId } = request.params;
				const cardData = request.body;

				const user = await User.findById(userId).session(session);
				if (!user) {
					await session.abortTransaction();
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
				await newCard.save({ session });

				// If this is a default card, update other cards
				if (cardData.isDefault) {
					await Card.updateMany(
						{ userId, _id: { $ne: newCard._id } },
						{ isDefault: false }
					).session(session);
				}

				await session.commitTransaction();
				reply.code(201);
				return { success: true, data: { card: newCard } };
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
					200: CardsResponseSchema,
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

				// Find the card first to check if it was default
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
					};
				}

				// Delete the card
				await Card.deleteOne({
					_id: cardId,
					userId,
				}).session(session);

				// If this was a default card, set another card as default if available
				if (card.isDefault) {
					const anotherCard = await Card.findOne({ userId }).session(
						session
					);
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
					message: "Card deleted successfully",
				};
			} catch (err: unknown) {
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
