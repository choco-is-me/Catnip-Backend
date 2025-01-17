// src/middlewares/auth.ts
import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { JwtPayload } from "jsonwebtoken";
import JWTService from "../services/jwt.service";
import { Logger } from "../services/logger.service";
import { CommonErrors, sendError } from "../utils/error-handler";

declare module "fastify" {
	interface FastifyInstance {
		authenticate: (
			request: FastifyRequest,
			reply: FastifyReply
		) => Promise<void>;
	}
	interface FastifyRequest {
		user?: JwtPayload & { userId: string; jti: string };
	}
}

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
					const decoded = await JWTService.verifyToken(token);

					if (!decoded.jti) {
						Logger.warn("Token missing JTI", "Auth");
						return sendError(reply, CommonErrors.invalidToken());
					}

					request.user = decoded as JwtPayload & {
						userId: string;
						jti: string;
					};

					Logger.debug(
						`User ${decoded.userId} authenticated successfully`,
						"Auth"
					);
				} catch (error) {
					if (error instanceof Error) {
						if (error.message === "Token has expired") {
							return sendError(reply, {
								success: false,
								error: "Token Expired",
								message:
									"Your session has expired. Please log in again.",
								code: 401,
							});
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
