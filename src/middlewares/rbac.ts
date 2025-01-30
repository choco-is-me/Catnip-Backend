// src/middlewares/rbac.ts
import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { UserRole } from "../models/User";
import { Logger } from "../services/logger.service";
import { CommonErrors, sendError } from "../utils/error-handler";

declare module "fastify" {
	interface FastifyInstance {
		verifyRoles: (
			roles: UserRole[]
		) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

		protectedRoute: (roles: UserRole[]) => {
			onRequest: ((
				request: FastifyRequest,
				reply: FastifyReply
			) => Promise<void>)[];
		};
	}
}

export default fp(async (fastify) => {
	const verifyRoles = (roles: UserRole[]) => {
		return async (request: FastifyRequest, reply: FastifyReply) => {
			try {
				// Check if user exists in request (set by authenticate middleware)
				if (!request.user) {
					Logger.warn(
						"Role verification attempted without user",
						"RBAC"
					);
					return sendError(reply, CommonErrors.noToken());
				}

				// Get user role from JWT payload
				const userRole = request.user.role as UserRole;
				if (!userRole) {
					Logger.warn("User has no role defined", "RBAC");
					return sendError(
						reply,
						CommonErrors.insufficientRole("any")
					); // User has no role at all
				}

				// Admin has access to everything
				if (userRole === "admin") {
					return;
				}

				// Check if user's role is in the allowed roles
				if (!roles.includes(userRole)) {
					Logger.warn(
						`User with role ${userRole} attempted to access route restricted to ${roles.join(
							", "
						)}`,
						"RBAC"
					);
					return sendError(
						reply,
						CommonErrors.insufficientRole(roles.join(" or "))
					); // Show which roles are required
				}

				Logger.debug(
					`Role verification successful for user with role ${userRole}`,
					"RBAC"
				);
			} catch (error) {
				Logger.error(error as Error, "RBAC");
				return sendError(
					reply,
					CommonErrors.insufficientRole("appropriate")
				); // Generic fallback
			}
		};
	};

	const protectedRoute = (roles: UserRole[]) => ({
		onRequest: [fastify.authenticate, verifyRoles(roles)],
	});

	fastify.decorate("verifyRoles", verifyRoles);
	fastify.decorate("protectedRoute", protectedRoute);
});
