import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt, { JwtPayload } from "jsonwebtoken";
import { CONFIG } from "../config";

declare module "fastify" {
	interface FastifyInstance {
		authenticate: (
			request: FastifyRequest,
			reply: FastifyReply
		) => Promise<void>;
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

				// Verify token and check algorithm
				const decoded = jwt.verify(token, CONFIG.JWT_SECRET, {
					algorithms: ["HS256"],
				}) as JwtPayload & {
					userId: string;
					jti: string;
				};

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
