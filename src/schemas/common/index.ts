import { Type, TSchema } from "@sinclair/typebox";

// Common error response schema used across all endpoints
export const ErrorResponseSchema = Type.Object({
	success: Type.Boolean(),
	code: Type.Optional(Type.Number()),
	error: Type.String(),
	message: Type.String(),
});

// Common address schema used in user-related schemas
export const AddressSchema = Type.Object({
	street: Type.String(),
	city: Type.String(),
	province: Type.String(),
	zipCode: Type.String(),
});

// Base response wrapper schema with proper type constraint
export const ResponseWrapper = <T extends TSchema>(dataSchema: T) =>
	Type.Object({
		success: Type.Boolean(),
		data: dataSchema,
	});
