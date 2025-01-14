import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { JwtPayload } from "jsonwebtoken";
import JWTService from "../services/jwt.service";

declare module "fastify" {
	interface FastifyInstance {
		authenticate: (
			request: FastifyRequest,
			reply: FastifyReply
		) => Promise<void>;
	}
	// Add this to ensure request.user has the correct type
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
					throw new Error("No token provided");
				}

				const token = authHeader.split(" ")[1];

				// Use JWTService to verify token and assert the type
				const decoded = JWTService.verifyToken(token) as JwtPayload & {
					userId: string;
					jti: string;
				};

				// Ensure jti exists
				if (!decoded.jti) {
					throw new Error("Invalid token format");
				}

				// Add user info to request
				request.user = decoded;
			} catch (err) {
				reply.code(401).send({
					success: false,
					error: "Authentication Failed",
					message: "Invalid or expired token",
				});
			}
		}
	);
});
