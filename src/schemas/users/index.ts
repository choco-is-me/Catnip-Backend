import { Type } from "@sinclair/typebox";
import { AddressSchema, ResponseWrapper, Timestamps } from "../common";

// Base user fields without sensitive data
const UserBaseSchema = Type.Object({
	email: Type.String({ format: "email" }),
	firstName: Type.String({ minLength: 1 }),
	lastName: Type.String({ minLength: 1 }),
	company: Type.Optional(Type.String()),
	address: AddressSchema,
	phoneNumber: Type.String({
		pattern: "^[+]?[(]?[0-9]{3}[)]?[-s.]?[0-9]{3}[-s.]?[0-9]{4,6}$",
	}),
});

// Complete user schema including system fields
export const UserSchema = Type.Intersect([
	Type.Object({
		_id: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "MongoDB ObjectId",
		}),
	}),
	UserBaseSchema,
	Type.Object(Timestamps),
]);

// Parameters schemas
export const ParamsWithUserId = Type.Object({
	userId: Type.String({
		// MongoDB ObjectId is a 24-character hex string
		pattern: "^[0-9a-fA-F]{24}$",
		description: "MongoDB ObjectId",
	}),
});

// Request body schemas
export const CreateUserBody = Type.Intersect([
	UserBaseSchema,
	Type.Object({
		password: Type.String({
			minLength: 8,
			pattern:
				"^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$",
		}),
	}),
]);

export const UpdateUserBody = Type.Partial(UserBaseSchema);

// Response schemas
export const UserResponseSchema = ResponseWrapper(
	Type.Object({
		user: UserSchema,
	})
);

export const UsersResponseSchema = ResponseWrapper(
	Type.Object({
		users: Type.Array(UserSchema),
		total: Type.Integer(),
		page: Type.Integer(),
		totalPages: Type.Integer(),
	})
);

export const DeleteResponseSchema = ResponseWrapper(
	Type.Object({
		message: Type.String(),
	})
);
