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
	ErrorTypes,
	sendError,
} from "../../../../utils/error-handler";

export class AuthHandler {
	// Private helper methods
	private static async validateLoginCredentials(
		email: string,
		password: string
	) {
		const user = await User.findOne({
			email: { $regex: new RegExp(`^${email}$`, "i") },
		});

		if (!user || !(await user.comparePassword(password))) {
			await new Promise((resolve) => setTimeout(resolve, 1000)); // Prevent timing attacks
			Logger.warn(`Failed login attempt for email: ${email}`, "Login");
			throw new Error("Invalid credentials");
		}

		return user;
	}

	private static setRefreshTokenCookie(
		reply: FastifyReply,
		refreshToken: string
	) {
		reply.setCookie("refreshToken", refreshToken, {
			httpOnly: true,
			secure: CONFIG.COOKIE_SECURE,
			sameSite: "strict",
			path: "/api/v1/auth/refresh-token",
			maxAge: CONFIG.COOKIE_MAX_AGE,
			domain: CONFIG.COOKIE_DOMAIN,
			partitioned: true,
		});
	}

	private static clearRefreshTokenCookie(reply: FastifyReply) {
		reply.clearCookie("refreshToken", {
			httpOnly: true,
			secure: CONFIG.COOKIE_SECURE,
			sameSite: "strict",
			path: "/api/v1/auth/refresh-token",
			domain: CONFIG.COOKIE_DOMAIN,
			partitioned: true,
		});
	}

	private static formatUserResponse(user: any) {
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
	}

	// Handler methods
	async refreshToken(request: FastifyRequest, reply: FastifyReply) {
		try {
			const refreshToken = request.cookies.refreshToken;
			if (!refreshToken) {
				return sendError(reply, CommonErrors.noToken());
			}

			// Use async verifyToken
			await JWTService.verifyToken(refreshToken, true);
			const tokens = await JWTService.rotateTokens(refreshToken);
			AuthHandler.setRefreshTokenCookie(reply, tokens.refreshToken);

			return reply.code(200).send({
				success: true,
				data: {
					tokens: {
						accessToken: tokens.accessToken,
					},
				},
			});
		} catch (error) {
			Logger.error(error as Error, "RefreshToken");

			if (error instanceof Error) {
				if (
					error.message === "Failed to rotate tokens" ||
					error.message === "Token has expired" ||
					error.message === "Token has been invalidated" ||
					error.message === "Invalid token type" ||
					error.message === "Refresh token exceeded maximum lifetime"
				) {
					return sendError(reply, CommonErrors.invalidToken());
				}
			}

			return sendError(reply, error as Error);
		}
	}

	async login(
		request: FastifyRequest<{ Body: Static<typeof LoginRequestBody> }>,
		reply: FastifyReply
	) {
		try {
			const { email, password } = request.body;

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
					"Login"
				);
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						`Missing required fields: ${missingFields.join(", ")}`
					)
				);
			}

			// Validate email format
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!emailRegex.test(email)) {
				Logger.warn(
					`Login attempt with invalid email format: ${email}`,
					"Login"
				);
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						"Invalid email format"
					)
				);
			}

			const user = await AuthHandler.validateLoginCredentials(
				email,
				password
			);
			const tokens = await JWTService.generateTokens(user._id.toString());

			AuthHandler.setRefreshTokenCookie(reply, tokens.refreshToken);
			Logger.info(`User logged in successfully: ${user._id}`, "Login");

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
			if (
				error instanceof Error &&
				error.message === "Invalid credentials"
			) {
				return sendError(reply, CommonErrors.invalidCredentials());
			}

			Logger.error(error as Error, "Login");
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
				`Registration attempt for email: ${request.body.email}`,
				"Register"
			);

			const existingUser = await User.findOne({
				email: request.body.email.toLowerCase(),
			}).session(session);

			if (existingUser) {
				await session.abortTransaction();
				Logger.warn(
					`Registration failed - email already exists: ${request.body.email}`,
					"Register"
				);
				return sendError(reply, CommonErrors.emailExists());
			}

			const user = new User({
				...request.body,
				email: request.body.email.toLowerCase(),
			});

			await user.save({ session });
			await session.commitTransaction();

			Logger.info(
				`User registered successfully: ${user._id}`,
				"Register"
			);
			return reply.code(201).send({
				success: true,
				data: {
					user: AuthHandler.formatUserResponse(user),
				},
			});
		} catch (error) {
			await session.abortTransaction();
			Logger.error(error as Error, "Register");

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
		} finally {
			session.endSession();
		}
	}

	async logout(request: FastifyRequest, reply: FastifyReply) {
		try {
			if (!request.user) {
				Logger.warn("Logout attempt without user in request", "Logout");
				return sendError(reply, CommonErrors.invalidToken());
			}

			const authHeader = request.headers.authorization;
			if (!authHeader?.startsWith("Bearer ")) {
				Logger.warn("Logout attempt without Bearer token", "Logout");
				return sendError(reply, CommonErrors.noToken());
			}

			const token = authHeader.split(" ")[1];
			let accessTokenInvalidated = false;
			let refreshTokenInvalidated = false;

			// Invalidate access token
			try {
				const decodedToken = await JWTService.verifyToken(token, false);
				if (decodedToken.jti) {
					// Calculate token expiry time (matches the JWT expiry)
					const expiryTime = Date.now() + 5 * 60 * 1000; // 5 minutes in milliseconds
					await JWTService.invalidateToken(
						decodedToken.jti,
						expiryTime
					);
					accessTokenInvalidated = true;
					Logger.debug(
						`Access token invalidated: ${decodedToken.jti}`,
						"Logout"
					);
				}
			} catch (accessError) {
				Logger.warn(
					`Access token verification failed: ${
						(accessError as Error).message
					}`,
					"Logout"
				);
			}

			// Invalidate refresh token if present
			const refreshToken = request.cookies.refreshToken;
			if (refreshToken) {
				try {
					const decodedRefresh = await JWTService.verifyToken(
						refreshToken,
						true
					);
					if (decodedRefresh.jti) {
						// Calculate token expiry time (matches the JWT expiry)
						const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
						await JWTService.invalidateToken(
							decodedRefresh.jti,
							expiryTime
						);
						refreshTokenInvalidated = true;
						Logger.debug(
							`Refresh token invalidated: ${decodedRefresh.jti}`,
							"Logout"
						);
					}
				} catch (refreshError) {
					Logger.warn(
						`Refresh token verification failed: ${
							(refreshError as Error).message
						}`,
						"Logout"
					);
				}
			}

			// Clear the refresh token cookie regardless of token invalidation status
			AuthHandler.clearRefreshTokenCookie(reply);

			// Log the overall logout result
			if (accessTokenInvalidated || refreshTokenInvalidated) {
				Logger.info(
					`User ${request.user.userId} logged out successfully. Access token invalidated: ${accessTokenInvalidated}, Refresh token invalidated: ${refreshTokenInvalidated}`,
					"Logout"
				);
			} else {
				Logger.warn(
					`User ${request.user.userId} logged out but no tokens were invalidated`,
					"Logout"
				);
			}

			return reply.code(200).send({
				success: true,
				data: {
					message: "Logged out successfully",
				},
			});
		} catch (error) {
			Logger.error(error as Error, "Logout");
			return sendError(reply, error as Error);
		}
	}
}
