import { Type } from "@sinclair/typebox";
import { UserSchema } from "../users";
import { ResponseWrapper } from "../common";

// Request schemas
export const LoginRequestBody = Type.Object({
	email: Type.String({ format: "email" }),
	password: Type.String(),
});

// Response schemas
export const TokensSchema = Type.Object({
	accessToken: Type.String(),
	refreshToken: Type.Optional(Type.String()),
});

export const LoginResponseSchema = ResponseWrapper(
	Type.Object({
		user: UserSchema,
		tokens: TokensSchema,
	})
);

export const RefreshTokenRequestBody = Type.Object({
	refreshToken: Type.String(),
});

export const RefreshTokenResponseSchema = ResponseWrapper(
	Type.Object({
		tokens: TokensSchema,
	})
);

export const LogoutResponseSchema = ResponseWrapper(
	Type.Object({
		message: Type.Literal("Logged out successfully"),
	})
);
