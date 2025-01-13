import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { RouteGenericInterface } from "fastify/types/route";

export default fp(async (fastify) => {
	fastify.decorate(
		"checkOwnership",
		async (
			request: FastifyRequest<RouteGenericInterface>,
			reply: FastifyReply
		) => {
			if (!request.params || typeof request.params !== "object") {
				reply.code(400).send({
					success: false,
					error: "Bad Request",
					message: "Invalid request parameters",
				});
				return false;
			}

			const requestedUserId = (request.params as { userId?: string })
				.userId;
			const authenticatedUserId = request.user?.userId;

			if (
				!requestedUserId ||
				!authenticatedUserId ||
				requestedUserId !== authenticatedUserId
			) {
				reply.code(403).send({
					success: false,
					error: "Forbidden",
					message:
						"You do not have permission to access this resource",
				});
				return false;
			}
			return true;
		}
	);
});
