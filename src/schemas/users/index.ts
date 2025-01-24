// src/schemas/users/index.ts
import { Type } from "@sinclair/typebox";
import { AddressSchema, ResponseWrapper, Timestamps } from "../common";

// Base user fields without sensitive data
const UserBaseSchema = Type.Object({
	email: Type.String({
		format: "email",
		description: "User's email address, must be unique",
		examples: ["john.doe@example.com"],
	}),
	firstName: Type.String({
		minLength: 1,
		description: "User's first name",
		examples: ["John"],
	}),
	lastName: Type.String({
		minLength: 1,
		description: "User's last name",
		examples: ["Doe"],
	}),
	company: Type.Optional(
		Type.String({
			description: "User's company name if applicable",
			examples: ["Acme Corp"],
		})
	),
	address: AddressSchema,
	phoneNumber: Type.String({
		pattern: "^[+]?[(]?[0-9]{3}[)]?[-s.]?[0-9]{3}[-s.]?[0-9]{4,6}$",
		description: "Phone number in international format",
		examples: ["+1-234-567-8900", "(123) 456-7890"],
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
			description:
				"Password must contain at least 8 characters, including one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)",
		}),
	}),
]);

export const ChangePasswordBody = Type.Object({
	newPassword: Type.String({
		minLength: 8,
		pattern:
			"^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$",
		description:
			"Password must contain at least 8 characters, including one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)",
	}),
});

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

export const ChangePasswordResponseSchema = ResponseWrapper(
	Type.Object({
		message: Type.Literal("Password changed successfully"),
	})
);
