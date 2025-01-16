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
	ResponseWrapper,
	UpdateUserBody,
	UserResponseSchema,
} from "../../schemas";

export default async function userRoutes(fastify: FastifyInstance) {
	// Global error handler for this plugin
	fastify.setErrorHandler((error, request, reply) => {
		const standardError = handleError(error);
		return reply.code(standardError.code).send(standardError);
	});

	const authenticateHook = async (
		request: FastifyRequest,
		reply: FastifyReply
	) => {
		return fastify.authenticate(request, reply);
	};

	fastify.post<{ Body: Static<typeof LoginRequestBody> }>(
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
					return reply.code(400).send({
						success: false,
						error: "Validation Error",
						message:
							!email && !password
								? "Email and password are required"
								: !email
								? "Email is required"
								: "Password is required",
						code: 400,
					});
				}

				const user = await User.findOne({
					email: { $regex: new RegExp(`^${email}$`, "i") },
				});

				if (!user || !(await user.comparePassword(password))) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					return reply.code(401).send({
						success: false,
						error: "Authentication Failed",
						message: "Invalid email or password",
						code: 401,
					});
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

				return reply.code(200).send({
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
							createdAt: user.createdAt.toISOString(), // Add timestamps
							updatedAt: user.updatedAt.toISOString(), // Add timestamps
						},
						tokens: {
							accessToken: tokens.accessToken,
						},
					},
				});
			} catch (err) {
				throw err;
			}
		}
	);

	// Register Route
	fastify.post<{ Body: Static<typeof CreateUserBody> }>(
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
					return reply.code(409).send({
						success: false,
						error: "Duplicate Error",
						message: "Email already registered",
						code: 409,
					});
				}

				const user = new User(request.body);
				await user.save();

				return reply.code(201).send({
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
				});
			} catch (err) {
				throw err;
			}
		}
	);

	/**Protected Routes */

	// Log out user
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
					return reply.code(401).send({
						success: false,
						error: "Authentication Failed",
						message: "Invalid token",
						code: 401,
					});
				}

				const authHeader = request.headers.authorization;
				if (!authHeader?.startsWith("Bearer ")) {
					return reply.code(401).send({
						success: false,
						error: "Authentication Failed",
						message: "No token provided",
						code: 401,
					});
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

				return reply.code(200).send({
					success: true,
					data: {
						message: "Logged out successfully",
					},
				});
			} catch (err) {
				throw err;
			}
		}
	);

	// Get User Profile
	fastify.get<{ Params: Static<typeof ParamsWithUserId> }>(
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
					return reply.code(404).send({
						success: false,
						error: "Not Found",
						message: "User not found",
						code: 404,
					});
				}

				return reply.code(200).send({
					success: true,
					data: {
						user: {
							...user.toObject(),
							createdAt: user.createdAt.toISOString(),
							updatedAt: user.updatedAt.toISOString(),
						},
					},
				});
			} catch (err) {
				throw err;
			}
		}
	);

	// Update User Profile
	fastify.put<{
		Params: Static<typeof ParamsWithUserId>;
		Body: Static<typeof UpdateUserBody>;
	}>(
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
					return reply.code(404).send({
						success: false,
						error: "Not Found",
						message: "User not found",
						code: 404,
					});
				}

				await session.commitTransaction();
				return reply.code(200).send({
					success: true,
					data: {
						user: {
							...user.toObject(),
							createdAt: user.createdAt.toISOString(),
							updatedAt: user.updatedAt.toISOString(),
						},
					},
				});
			} catch (err) {
				await session.abortTransaction();
				throw err;
			} finally {
				session.endSession();
			}
		}
	);

	// Delete User Account Route
	fastify.delete<{ Params: Static<typeof ParamsWithUserId> }>(
		"/users/:userId",
		{
			onRequest: [authenticateHook],
			schema: {
				tags: ["Users"],
				description: "Delete user account",
				params: ParamsWithUserId,
				response: {
					200: ResponseWrapper(
						Type.Object({
							message: Type.String(),
						})
					),
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

				// Delete associated data
				await Card.deleteMany({ userId }).session(session);
				const user = await User.findByIdAndDelete(userId).session(
					session
				);

				if (!user) {
					await session.abortTransaction();
					return reply.code(404).send({
						success: false,
						error: "Not Found",
						message: "User not found",
						code: 404,
					});
				}

				await session.commitTransaction();
				return reply.code(200).send({
					success: true,
					data: {
						message: "User account deleted successfully",
					},
				});
			} catch (err) {
				await session.abortTransaction();
				throw err;
			} finally {
				session.endSession();
			}
		}
	);

	// Add card route
	fastify.post<{
		Params: Static<typeof ParamsWithUserId>;
		Body: Static<typeof CreateCardBody>;
	}>(
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
		async (request, reply) => {
			const session = await mongoose.startSession();
			session.startTransaction();

			try {
				const { userId } = request.params;
				const cardData = {
					...request.body,
					cardNumber: request.body.cardNumber.trim(),
					nameOnCard: request.body.nameOnCard.trim().toUpperCase(),
				};

				const user = await User.findById(userId).session(session);
				if (!user) {
					await session.abortTransaction();
					return reply.code(404).send({
						success: false,
						error: "Not Found",
						message: "User not found",
						code: 404,
					});
				}

				const newCard = new Card({
					...cardData,
					userId,
					nameOnCard: cardData.nameOnCard.trim().toUpperCase(),
					cardNumber: cardData.cardNumber.trim(),
				});

				await newCard.save({ session });

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

				const cardResponse = newCard.toObject();
				return reply.code(201).send({
					success: true,
					data: {
						card: {
							...cardResponse,
							createdAt: newCard.createdAt.toISOString(),
							updatedAt: newCard.updatedAt.toISOString(),
						},
					},
				});
			} catch (err) {
				await session.abortTransaction();
				throw err;
			} finally {
				session.endSession();
			}
		}
	);

	// Get user's cards route
	fastify.get<{
		Params: Static<typeof ParamsWithUserId>;
		Querystring: Static<typeof PaginationQuery>;
	}>(
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
		async (request, reply) => {
			try {
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

				// Format the timestamps for each card
				const formattedCards = cards.map((card) => ({
					...card,
					createdAt: card.createdAt.toISOString(),
					updatedAt: card.updatedAt.toISOString(),
				}));

				return reply.code(200).send({
					success: true,
					data: {
						cards: formattedCards,
						total,
						page,
						totalPages: Math.ceil(total / limit),
					},
				});
			} catch (err) {
				throw err;
			}
		}
	);

	// Delete card route
	fastify.delete<{
		Params: Static<typeof ParamsWithUserIdAndCardId>;
	}>(
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

				const { userId, cardId } = request.params;

				// Find the card to check if it exists and if it was default
				const card = await Card.findOne({
					_id: cardId,
					userId,
				}).session(session);

				if (!card) {
					await session.abortTransaction();
					return reply.code(404).send({
						success: false,
						error: "Not Found",
						message: "Card not found",
						code: 404,
					});
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
				return reply.code(200).send({
					success: true,
					data: {
						message: "Card deleted successfully",
					},
				});
			} catch (err) {
				await session.abortTransaction();
				throw err;
			} finally {
				session.endSession();
			}
		}
	);
}
