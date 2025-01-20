// src/routes/v1/users/handlers/auth.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { CONFIG } from "../../../../config";
import { User } from "../../../../models/User";
import { CreateUserBody, LoginRequestBody } from "../../../../schemas";
import JWTService from "../../../../services/jwt.service";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createError,
	createSecurityError,
	createBusinessError,
	ErrorTypes,
	sendError,
} from "../../../../utils/error-handler";

export class AuthHandler {
	// Private helper methods
	private static async validateLoginCredentials(
		email: string,
		password: string
	) {
		try {
			Logger.debug(
				`Attempting to validate credentials for email: ${email}`,
				"Auth"
			);

			const user = await User.findOne({
				email: { $regex: new RegExp(`^${email}$`, "i") },
			});

			if (!user || !(await user.comparePassword(password))) {
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Prevent timing attacks
				Logger.warn(`Failed login attempt for email: ${email}`, "Auth");
				return null;
			}

			Logger.debug(
				`Credentials validated successfully for user: ${user._id}`,
				"Auth"
			);
			return user;
		} catch (error) {
			if (error instanceof mongoose.Error.ValidationError) {
				throw createError(
					400,
					ErrorTypes.VALIDATION_ERROR,
					Object.values(error.errors)
						.map((err) => err.message)
						.join(", ")
				);
			}
			Logger.error(error as Error, "Auth");
			throw CommonErrors.databaseError("credential validation");
		}
	}

	private static setRefreshTokenCookie(
		reply: FastifyReply,
		refreshToken: string
	) {
		try {
			reply.setCookie("refreshToken", refreshToken, {
				httpOnly: true,
				secure: CONFIG.COOKIE_SECURE,
				sameSite: "strict",
				path: "/api/v1/auth/refresh-token",
				maxAge: CONFIG.COOKIE_MAX_AGE,
				domain: CONFIG.COOKIE_DOMAIN,
				partitioned: true,
			});
			Logger.debug("Refresh token cookie set successfully", "Auth");
		} catch (error) {
			Logger.error(error as Error, "Auth");
			throw createError(
				500,
				ErrorTypes.COOKIE_ERROR,
				"Failed to set refresh token cookie"
			);
		}
	}

	private static clearRefreshTokenCookie(reply: FastifyReply) {
		try {
			reply.clearCookie("refreshToken", {
				httpOnly: true,
				secure: CONFIG.COOKIE_SECURE,
				sameSite: "strict",
				path: "/api/v1/auth/refresh-token",
				maxAge: CONFIG.COOKIE_MAX_AGE,
				domain: CONFIG.COOKIE_DOMAIN,
				partitioned: true,
			});
			Logger.debug("Refresh token cookie cleared successfully", "Auth");
		} catch (error) {
			Logger.error(error as Error, "Auth");
			throw createError(
				500,
				ErrorTypes.COOKIE_ERROR,
				"Failed to clear refresh token cookie"
			);
		}
	}

	private static formatUserResponse(user: any) {
		try {
			return {
				_id: user._id,
				email: user.email,
				firstName: user.firstName,
				lastName: user.lastName,
				company: user.company,
				address: user.address,
				phoneNumber: user.phoneNumber,
				createdAt: user.createdAt.toISOString(),
				updatedAt: user.updatedAt.toISOString(),
			};
		} catch (error) {
			Logger.error(error as Error, "Auth");
			throw createError(
				500,
				ErrorTypes.INTERNAL_ERROR,
				"Failed to format user response"
			);
		}
	}

	async refreshToken(request: FastifyRequest, reply: FastifyReply) {
		try {
			Logger.debug("Processing refresh token request", "Auth");

			const refreshToken = request.cookies.refreshToken;
			if (!refreshToken) {
				Logger.warn("Refresh token missing from request", "Auth");
				return sendError(
					reply,
					CommonErrors.cookieMissing("refreshToken")
				);
			}

			try {
				const tokens = await JWTService.rotateTokens(
					refreshToken,
					request
				);
				AuthHandler.setRefreshTokenCookie(reply, tokens.refreshToken);

				Logger.info("Tokens refreshed successfully", "Auth");
				return reply.code(200).send({
					success: true,
					data: {
						tokens: {
							accessToken: tokens.accessToken,
						},
					},
				});
			} catch (error) {
				if (error instanceof Error) {
					AuthHandler.clearRefreshTokenCookie(reply);

					switch (error.message) {
						case "Token fingerprint mismatch":
							return sendError(
								reply,
								CommonErrors.fingerprintMismatch()
							);
						case "Token has expired":
							return sendError(
								reply,
								CommonErrors.tokenExpired()
							);
						case "Token has been invalidated":
							return sendError(
								reply,
								CommonErrors.tokenRevoked()
							);
						case "Invalid token type":
							return sendError(
								reply,
								CommonErrors.invalidTokenType()
							);
						case "Token family has been compromised":
							return sendError(
								reply,
								createSecurityError("Token reuse detected")
							);
						case "Refresh token exceeded maximum lifetime":
						case "Invalid token family":
							return sendError(
								reply,
								CommonErrors.sessionExpired()
							);
						default:
							return sendError(
								reply,
								CommonErrors.invalidToken()
							);
					}
				}
				return sendError(reply, error as Error);
			}
		} catch (error) {
			Logger.error(error as Error, "Auth");
			return sendError(reply, error as Error);
		}
	}

	async login(
		request: FastifyRequest<{ Body: Static<typeof LoginRequestBody> }>,
		reply: FastifyReply
	) {
		try {
			Logger.debug("Processing login request", "Auth");
			const { email, password } = request.body;

			// Validate required fields
			if (!email || !password) {
				const missingFields =
					!email && !password
						? ["email", "password"]
						: !email
						? ["email"]
						: ["password"];
				Logger.warn(
					`Login attempt with missing fields: ${missingFields.join(
						", "
					)}`,
					"Auth"
				);
				return sendError(
					reply,
					CommonErrors.missingFields(missingFields)
				);
			}

			// Validate email format
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!emailRegex.test(email)) {
				Logger.warn(
					`Login attempt with invalid email format: ${email}`,
					"Auth"
				);
				return sendError(reply, CommonErrors.invalidFormat("email"));
			}

			const user = await AuthHandler.validateLoginCredentials(
				email,
				password
			);
			if (!user) {
				return sendError(reply, CommonErrors.invalidCredentials());
			}

			// Generate tokens with fingerprinting
			const tokens = await JWTService.generateTokens(
				user._id.toString(),
				request
			);
			AuthHandler.setRefreshTokenCookie(reply, tokens.refreshToken);

			Logger.info(`User logged in successfully: ${user._id}`, "Auth");

			return reply.code(200).send({
				success: true,
				data: {
					user: AuthHandler.formatUserResponse(user),
					tokens: {
						accessToken: tokens.accessToken,
					},
				},
			});
		} catch (error) {
			Logger.error(error as Error, "Auth");

			if (error instanceof mongoose.Error.ValidationError) {
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						Object.values(error.errors)
							.map((err) => err.message)
							.join(", ")
					)
				);
			}

			return sendError(reply, error as Error);
		}
	}

	async register(
		request: FastifyRequest<{ Body: Static<typeof CreateUserBody> }>,
		reply: FastifyReply
	) {
		const session = await mongoose.startSession();
		session.startTransaction();

		try {
			Logger.debug(
				`Starting registration process for email: ${request.body.email}`,
				"Auth"
			);

			// Check for existing user
			const existingUser = await User.findOne({
				email: request.body.email.toLowerCase(),
			}).session(session);

			if (existingUser) {
				await session.abortTransaction();
				Logger.warn(
					`Registration failed - email already exists: ${request.body.email}`,
					"Auth"
				);
				return sendError(reply, CommonErrors.emailExists());
			}

			// Create new user
			const user = new User({
				...request.body,
				email: request.body.email.toLowerCase(),
			});

			await user.save({ session });
			await session.commitTransaction();

			Logger.info(`User registered successfully: ${user._id}`, "Auth");
			return reply.code(201).send({
				success: true,
				data: {
					user: AuthHandler.formatUserResponse(user),
				},
			});
		} catch (error) {
			await session.abortTransaction();
			Logger.error(error as Error, "Auth");

			if (error instanceof mongoose.Error.ValidationError) {
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						Object.values(error.errors)
							.map((err) => err.message)
							.join(", ")
					)
				);
			}

			if (error instanceof mongoose.Error) {
				if (
					error.name === "MongoServerError" &&
					(error as any).code === 11000
				) {
					return sendError(reply, CommonErrors.emailExists());
				}
				return sendError(
					reply,
					CommonErrors.databaseError("user registration")
				);
			}

			return sendError(reply, error as Error);
		} finally {
			session.endSession();
			Logger.debug("Registration session ended", "Auth");
		}
	}

	async logout(request: FastifyRequest, reply: FastifyReply) {
		try {
			Logger.debug("Processing logout request", "Auth");

			if (!request.user) {
				Logger.warn("Logout attempt without user in request", "Auth");
				return sendError(reply, CommonErrors.sessionInvalid());
			}

			const authHeader = request.headers.authorization;
			if (!authHeader?.startsWith("Bearer ")) {
				Logger.warn("Logout attempt without Bearer token", "Auth");
				return sendError(
					reply,
					createSecurityError("Invalid authentication header")
				);
			}

			const token = authHeader.split(" ")[1];
			let accessTokenInvalidated = false;
			let refreshTokenInvalidated = false;

			// Invalidate access token
			try {
				const decodedToken = await JWTService.verifyToken(token, false);
				if (decodedToken.jti) {
					const expiryTime = Date.now() + 5 * 60 * 1000; // 5 minutes
					await JWTService.invalidateToken(
						decodedToken.jti,
						expiryTime,
						decodedToken.familyId
					);
					accessTokenInvalidated = true;
					Logger.debug(
						`Access token invalidated: ${decodedToken.jti}`,
						"Auth"
					);
				}
			} catch (accessError) {
				Logger.warn(
					`Access token verification failed: ${
						(accessError as Error).message
					}`,
					"Auth"
				);
			}

			// Invalidate refresh token
			const refreshToken = request.cookies.refreshToken;
			if (refreshToken) {
				try {
					const decodedRefresh = await JWTService.verifyToken(
						refreshToken,
						true
					);
					if (decodedRefresh.jti) {
						const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
						await JWTService.invalidateToken(
							decodedRefresh.jti,
							expiryTime,
							decodedRefresh.familyId
						);
						refreshTokenInvalidated = true;
						Logger.debug(
							`Refresh token invalidated: ${decodedRefresh.jti}`,
							"Auth"
						);
					}
				} catch (refreshError) {
					Logger.warn(
						`Refresh token verification failed: ${
							(refreshError as Error).message
						}`,
						"Auth"
					);
				}
			}

			AuthHandler.clearRefreshTokenCookie(reply);

			if (!accessTokenInvalidated && !refreshTokenInvalidated) {
				return sendError(
					reply,
					createBusinessError("No active tokens to invalidate")
				);
			}

			Logger.info(
				`User ${request.user.userId} logged out successfully. Access token invalidated: ${accessTokenInvalidated}, Refresh token invalidated: ${refreshTokenInvalidated}`,
				"Auth"
			);

			return reply.code(200).send({
				success: true,
				data: {
					message: "Logged out successfully",
				},
			});
		} catch (error) {
			Logger.error(error as Error, "Auth");
			return sendError(reply, error as Error);
		}
	}
}
