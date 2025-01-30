// src/middlewares/checkOwnership.ts
import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { RouteGenericInterface } from "fastify/types/route";
import { Logger } from "../services/logger.service";
import {
	CommonErrors,
	createError,
	ErrorTypes,
	sendError,
} from "../utils/error-handler";

export default fp(async (fastify) => {
	fastify.decorate(
		"checkOwnership",
		async (
			request: FastifyRequest<RouteGenericInterface>,
			reply: FastifyReply
		) => {
			if (!request.params || typeof request.params !== "object") {
				Logger.warn(
					`Invalid request parameters: ${JSON.stringify(
						request.params
					)}`,
					"CheckOwnership"
				);
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						"Invalid request parameters"
					)
				);
			}

			const requestedUserId = (request.params as { userId?: string })
				.userId;
			const authenticatedUserId = request.user?.userId;
			const userRole = request.user?.role;

			Logger.debug(
				`Checking ownership - Requested: ${requestedUserId}, Authenticated: ${authenticatedUserId}, Role: ${userRole}`,
				"CheckOwnership"
			);

			if (!requestedUserId || !authenticatedUserId) {
				Logger.warn(
					`Missing user ID - Requested: ${requestedUserId}, Authenticated: ${authenticatedUserId}`,
					"CheckOwnership"
				);
				return sendError(reply, CommonErrors.forbidden());
			}

			// Allow admins to access any user's data
			if (userRole === "admin") {
				Logger.debug(
					`Admin access granted for user ${authenticatedUserId} to resource ${requestedUserId}`,
					"CheckOwnership"
				);
				return true;
			}

			// For regular users, check if they're accessing their own data
			if (requestedUserId !== authenticatedUserId) {
				Logger.warn(
					`Unauthorized access attempt - User ${authenticatedUserId} attempted to access resources of ${requestedUserId}`,
					"CheckOwnership"
				);
				return sendError(reply, CommonErrors.forbidden());
			}

			Logger.debug(
				`Ownership verified for user ${authenticatedUserId}`,
				"CheckOwnership"
			);
			return true;
		}
	);
});
