import { JwtPayload } from "jsonwebtoken";
import { FastifyRequest, FastifyReply } from "fastify";

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
