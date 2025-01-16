import { Type } from "@sinclair/typebox";
import { AddressSchema, ResponseWrapper } from "../common";

// User object schema (without sensitive data)
export const UserSchema = Type.Object({
	_id: Type.String(),
	email: Type.String(),
	firstName: Type.String(),
	lastName: Type.String(),
	company: Type.Optional(Type.String()),
	address: AddressSchema,
	phoneNumber: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
});

// User response wrapped in standard response format
export const UserResponseSchema = ResponseWrapper(
	Type.Object({
		user: UserSchema,
	})
);

// Parameters
export const ParamsWithUserId = Type.Object({
	userId: Type.String(),
});

// Request Bodies
export const CreateUserBody = Type.Object({
	email: Type.String({ format: "email" }),
	password: Type.String({ minLength: 8 }),
	firstName: Type.String(),
	lastName: Type.String(),
	company: Type.Optional(Type.String()),
	address: AddressSchema,
	phoneNumber: Type.String(),
});

export const UpdateUserBody = Type.Object({
	firstName: Type.Optional(Type.String()),
	lastName: Type.Optional(Type.String()),
	company: Type.Optional(Type.String()),
	address: Type.Optional(AddressSchema),
	phoneNumber: Type.Optional(Type.String()),
});
