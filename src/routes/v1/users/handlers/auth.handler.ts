// src/routes/v1/users/handlers/auth.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
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
	async refreshToken(request: FastifyRequest, reply: FastifyReply) {
		try {
			const refreshToken = request.cookies.refreshToken;

			if (!refreshToken) {
				return sendError(reply, CommonErrors.noToken());
			}

			const tokens = JWTService.rotateTokens(refreshToken);

			// Set the new refresh token in cookie
			reply.setCookie("refreshToken", tokens.refreshToken, {
				httpOnly: true,
				secure: CONFIG.COOKIE_SECURE,
				sameSite: "strict",
				path: "/api/v1/auth/refresh-token",
				maxAge: CONFIG.COOKIE_MAX_AGE,
				domain: CONFIG.COOKIE_DOMAIN,
				partitioned: true,
			});

			// Return the new access token
			return reply.code(200).send({
				success: true,
				data: {
					tokens: {
						accessToken: tokens.accessToken,
					},
				},
			});
		} catch (error) {
			// Log the error for debugging
			Logger.error(error as Error, "RefreshToken");

			if (
				error instanceof Error &&
				error.message === "Failed to rotate tokens"
			) {
				return sendError(reply, CommonErrors.invalidToken());
			}

			// For unexpected errors, use the default error handler
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
				Logger.warn("Login attempt with missing credentials", "Login");
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						!email && !password
							? "Email and password are required"
							: !email
							? "Email is required"
							: "Password is required"
					)
				);
			}

			const user = await User.findOne({
				email: { $regex: new RegExp(`^${email}$`, "i") },
			});

			if (!user || !(await user.comparePassword(password))) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				Logger.warn(
					`Failed login attempt for email: ${email}`,
					"Login"
				);
				return sendError(reply, CommonErrors.invalidCredentials());
			}

			const tokens = JWTService.generateTokens(user._id.toString());
			Logger.info(`User logged in successfully: ${user._id}`, "Login");

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
						createdAt: user.createdAt.toISOString(),
						updatedAt: user.updatedAt.toISOString(),
					},
					tokens: {
						accessToken: tokens.accessToken,
					},
				},
			});
		} catch (error) {
			Logger.error(error as Error, "Login");
			return sendError(reply, error as Error);
		}
	}

	async register(
		request: FastifyRequest<{ Body: Static<typeof CreateUserBody> }>,
		reply: FastifyReply
	) {
		try {
			Logger.debug(
				`Registration attempt for email: ${request.body.email}`,
				"Register"
			);

			const existingUser = await User.findOne({
				email: request.body.email,
			});

			if (existingUser) {
				Logger.warn(
					`Registration failed - email already exists: ${request.body.email}`,
					"Register"
				);
				return sendError(reply, CommonErrors.emailExists());
			}

			const user = new User(request.body);
			await user.save();

			Logger.info(
				`User registered successfully: ${user._id}`,
				"Register"
			);
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
		} catch (error) {
			Logger.error(error as Error, "Register");
			return sendError(reply, error as Error);
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
			Logger.debug(
				`Attempting to invalidate token for user: ${request.user.userId}`,
				"Logout"
			);

			try {
				const decodedToken = JWTService.verifyToken(token);
				if (decodedToken.jti) {
					JWTService.invalidateToken(decodedToken.jti);
					Logger.debug(
						`Token invalidated: ${decodedToken.jti}`,
						"Logout"
					);
				}
			} catch (tokenError) {
				Logger.warn("Error verifying token during logout", "Logout");
				// Continue with logout even if token verification fails
			}

			// Clear refresh token cookie
			Logger.debug("Clearing refresh token cookie", "Logout");
			reply.clearCookie("refreshToken", {
				httpOnly: true,
				secure: CONFIG.COOKIE_SECURE,
				sameSite: "strict",
				path: "/api/v1/auth/refresh-token",
				domain: CONFIG.COOKIE_DOMAIN,
				partitioned: true,
			});

			Logger.info(
				`User logged out successfully: ${request.user.userId}`,
				"Logout"
			);
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
