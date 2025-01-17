// src/schemas/common/index.ts
import { TSchema, Type } from "@sinclair/typebox";

// Define common schema types
export const Timestamps = {
	createdAt: Type.String({ format: "date-time" }),
	updatedAt: Type.String({ format: "date-time" }),
};

// Common error response schema with better typing
export const ErrorResponseSchema = Type.Object({
	success: Type.Literal(false),
	code: Type.Integer({ minimum: 400, maximum: 599 }),
	error: Type.String(),
	message: Type.String(),
});

// Enhanced address schema with better validation
export const AddressSchema = Type.Object({
	street: Type.String({ minLength: 1 }),
	city: Type.String({ minLength: 1 }),
	province: Type.String({ minLength: 1 }),
	zipCode: Type.String({ pattern: "^[0-9]{5}(-[0-9]{4})?$" }),
});

// Generic response wrapper with better typing
export const ResponseWrapper = <T extends TSchema>(dataSchema: T) =>
	Type.Object({
		success: Type.Literal(true),
		data: dataSchema,
	});

// Common query parameters
export const PaginationQuery = Type.Object({
	page: Type.Optional(Type.Integer({ minimum: 1 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	sortBy: Type.Optional(Type.String()),
	order: Type.Optional(
		Type.Union([Type.Literal("asc"), Type.Literal("desc")])
	),
});
