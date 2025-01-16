import { Type } from "@sinclair/typebox";
import { UserSchema } from "../users";
import { ResponseWrapper } from "../common";

export const LoginRequestBody = Type.Object({
	email: Type.String({ format: "email" }),
	password: Type.String(),
});

export const LoginResponseSchema = ResponseWrapper(
	Type.Object({
		user: UserSchema,
		tokens: Type.Object({
			accessToken: Type.String(),
			refreshToken: Type.Optional(Type.String()),
		}),
	})
);

export const LogoutResponseSchema = Type.Object({
	success: Type.Boolean(),
	message: Type.String(),
});
