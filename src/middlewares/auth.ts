// src/middlewares/auth.ts
import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { JwtPayload } from "jsonwebtoken";
import { UserRole } from "../models/User";
import JWTService from "../services/jwt.service";
import { Logger } from "../services/logger.service";
import { CommonErrors, sendError } from "../utils/error-handler";

// Remove the declare module section since it's now in fastify.d.ts

export default fp(async (fastify) => {
	fastify.decorate(
		"authenticate",
		async (request: FastifyRequest, reply: FastifyReply) => {
			try {
				const authHeader = request.headers.authorization;

				if (!authHeader || !authHeader.startsWith("Bearer ")) {
					Logger.warn(
						"Authentication attempt without valid token",
						"Auth"
					);
					return sendError(reply, CommonErrors.noToken());
				}

				const token = authHeader.split(" ")[1];

				try {
					// Explicitly specify this is not a refresh token
					const decoded = await JWTService.verifyToken(token, false);

					if (!decoded.jti) {
						Logger.warn("Token missing JTI", "Auth");
						return sendError(reply, CommonErrors.invalidToken());
					}

					if (decoded.type !== "access") {
						Logger.warn(
							"Invalid token type used for authentication",
							"Auth"
						);
						return sendError(
							reply,
							CommonErrors.invalidTokenType()
						);
					}

					// Ensure all required properties are attached to request.user
					request.user = {
						...decoded,
						userId: decoded.userId,
						jti: decoded.jti,
						role: decoded.role as UserRole,
					};

					Logger.debug(
						`User ${decoded.userId} authenticated successfully with role ${decoded.role}`,
						"Auth"
					);
				} catch (error) {
					if (error instanceof Error) {
						switch (error.message) {
							case "TOKEN_EXPIRED":
								return sendError(
									reply,
									CommonErrors.tokenExpired()
								);
							case "TOKEN_INVALIDATED":
								return sendError(
									reply,
									CommonErrors.tokenRevoked()
								);
							case "INVALID_TOKEN_TYPE":
								return sendError(
									reply,
									CommonErrors.invalidTokenType()
								);
							case "TOKEN_FAMILY_COMPROMISED":
								return sendError(
									reply,
									CommonErrors.suspiciousActivity()
								);
							case "INVALID_TOKEN_SUBJECT":
								return sendError(
									reply,
									CommonErrors.invalidToken()
								);
							case "JWT_SECRETS_NOT_CONFIGURED":
								Logger.error(
									new Error("JWT secrets not configured"),
									"Auth"
								);
								return sendError(
									reply,
									CommonErrors.configError("JWT service")
								);
							default:
								return sendError(
									reply,
									CommonErrors.invalidToken()
								);
						}
					}
					return sendError(reply, CommonErrors.invalidToken());
				}
			} catch (err) {
				Logger.error(err as Error, "Auth");
				return sendError(reply, CommonErrors.invalidToken());
			}
		}
	);
});
