import { FastifyReply } from "fastify";
import { JwtPayload } from "jsonwebtoken";

declare module "fastify" {
	interface FastifyInstance {
		authenticate: (
			request: FastifyRequest,
			reply: FastifyReply
		) => Promise<void>;
		checkOwnership: (
			request: FastifyRequest,
			reply: FastifyReply
		) => Promise<boolean>;
	}

	interface FastifyRequest {
		user?: JwtPayload & {
			userId: string;
			jti: string;
		};
	}
}
