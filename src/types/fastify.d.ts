// src/types/fastify.d.ts
import "fastify";
import { JwtPayload } from "jsonwebtoken";
import { UserRole } from "../models/User";

declare module "fastify" {
	interface FastifyInstance {
		authenticate: (
			request: FastifyRequest,
			reply: FastifyReply
		) => Promise<void>;
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

	interface FastifyRequest {
		user?: JwtPayload & {
			userId: string;
			jti: string;
			role: UserRole;
		};
	}
}
