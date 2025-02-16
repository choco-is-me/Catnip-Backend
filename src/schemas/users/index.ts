// src/schemas/users/user.schema.ts
import { Type } from "@sinclair/typebox";
import { AddressSchema, ResponseWrapper, Timestamps } from "../common";

// Define Role enum
export const UserRoleEnum = Type.Union(
	[Type.Literal("user"), Type.Literal("admin")],
	{
		description: "User role type",
		examples: ["user"],
	}
);

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
	role: UserRoleEnum,
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

// Request body schemas
export const CreateUserBody = Type.Intersect([
	Type.Omit(UserBaseSchema, ["role"]), // Remove role from registration - it's always 'user'
	Type.Object({
		password: Type.String({
			minLength: 8,
			pattern:
				"^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$",
			description:
				"Password must contain at least 8 characters, including one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)",
			examples: ["StrongP@ss123"],
		}),
	}),
]);

export const ChangePasswordBody = Type.Object({
	currentPassword: Type.String({
		minLength: 8,
		description: "Current password for verification",
		examples: ["OldP@ss123"],
	}),
	newPassword: Type.String({
		minLength: 8,
		pattern:
			"^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$",
		description:
			"Password must contain at least 8 characters, including one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)",
		examples: ["NewP@ss123"],
	}),
});

// For updates, allow updating everything except role and email
export const UpdateUserBody = Type.Partial(
	Type.Omit(UserBaseSchema, ["role", "email"])
);

// Response schemas with examples
const userExample = {
	_id: "507f1f77bcf86cd799439011",
	email: "john.doe@example.com",
	firstName: "John",
	lastName: "Doe",
	role: "user",
	address: {
		street: "123 Main St",
		city: "New York",
		province: "NY",
		zipCode: "10001",
	},
	phoneNumber: "+1234567890",
	createdAt: "2023-01-01T00:00:00.000Z",
	updatedAt: "2023-01-01T00:00:00.000Z",
};

export const UserResponseSchema = ResponseWrapper(
	Type.Object({
		user: UserSchema,
	}),
	{
		description: "User profile response",
		examples: [
			{
				success: true,
				data: { user: userExample },
			},
		],
	}
);

export const DeleteResponseSchema = ResponseWrapper(
	Type.Object({
		message: Type.String({
			description: "Success message",
			examples: ["User account deleted successfully"],
		}),
		email: Type.String({
			format: "email",
			description: "Email of the deleted account",
			examples: ["john.doe@example.com"],
		}),
	})
);

export const ChangePasswordResponseSchema = ResponseWrapper(
	Type.Object({
		message: Type.Literal("Password changed successfully"),
		requiresRelogin: Type.Boolean({
			description: "Indicates if the user needs to login again",
			examples: [true],
		}),
	})
);
