// src/schemas/suppliers/index.ts
import { Type } from "@sinclair/typebox";
import { ResponseWrapper, Timestamps } from "../common";

// Contact Person Schema
export const ContactPersonSchema = Type.Object(
	{
		name: Type.String({
			minLength: 1,
			description: "Contact person's full name",
			examples: ["John Doe"],
		}),
		position: Type.String({
			minLength: 1,
			description: "Contact person's position",
			examples: ["Sales Manager"],
		}),
		email: Type.String({
			format: "email",
			description: "Contact person's email",
			examples: ["john.doe@supplier.com"],
		}),
		phone: Type.String({
			pattern: "^[+]?[(]?[0-9]{3}[)]?[-s.]?[0-9]{3}[-s.]?[0-9]{4,6}$",
			description: "Contact person's phone number",
			examples: ["+1-234-567-8900"],
		}),
	},
	{
		description: "Contact person information",
	}
);

// Payment Information Schema
export const PaymentInfoSchema = Type.Object(
	{
		bankName: Type.String({
			minLength: 1,
			description: "Bank name",
			examples: ["Bank of America"],
		}),
		accountNumber: Type.String({
			minLength: 1,
			description: "Bank account number",
			examples: ["1234567890"],
		}),
		accountHolder: Type.String({
			minLength: 1,
			description: "Account holder name",
			examples: ["Supplier Corp LLC"],
		}),
		swiftCode: Type.Optional(
			Type.String({
				description: "SWIFT/BIC code for international transfers",
				examples: ["BOFAUS3N"],
			})
		),
	},
	{
		description: "Payment information",
	}
);

// Address Schema
export const SupplierAddressSchema = Type.Object(
	{
		street: Type.String({
			minLength: 1,
			description: "Street address",
			examples: ["123 Business Street"],
		}),
		city: Type.String({
			minLength: 1,
			description: "City",
			examples: ["Los Angeles"],
		}),
		state: Type.String({
			minLength: 1,
			description: "State/Province",
			examples: ["California"],
		}),
		country: Type.String({
			minLength: 1,
			description: "Country",
			examples: ["United States"],
		}),
		postalCode: Type.String({
			minLength: 1,
			description: "Postal/ZIP code",
			examples: ["90001"],
		}),
	},
	{
		description: "Supplier address information",
	}
);

// Base Supplier Schema
const SupplierBaseSchema = Type.Object({
	name: Type.String({
		minLength: 1,
		description: "Supplier company name",
		examples: ["Supplier Corp LLC"],
	}),
	code: Type.String({
		pattern: "^[A-Z0-9]{3,10}$",
		description: "Unique supplier code",
		examples: ["SUP001"],
	}),
	description: Type.Optional(
		Type.String({
			description: "Supplier description",
			examples: ["Leading manufacturer of premium clothing"],
		})
	),
	contactPersons: Type.Array(ContactPersonSchema),
	address: SupplierAddressSchema,
	paymentInfo: Type.Array(PaymentInfoSchema),
	email: Type.String({
		format: "email",
		description: "Primary business email",
		examples: ["contact@supplier.com"],
	}),
	phone: Type.String({
		pattern: "^[+]?[(]?[0-9]{3}[)]?[-s.]?[0-9]{3}[-s.]?[0-9]{4,6}$",
		description: "Primary business phone",
		examples: ["+1-234-567-8900"],
	}),
	website: Type.Optional(
		Type.String({
			format: "uri",
			description: "Company website",
			examples: ["https://supplier.com"],
		})
	),
	status: Type.Union(
		[
			Type.Literal("active"),
			Type.Literal("inactive"),
			Type.Literal("blacklisted"),
		],
		{
			default: "active",
			description: "Supplier status",
		}
	),
	rating: Type.Number({
		minimum: 0,
		maximum: 5,
		default: 0,
		description: "Supplier rating",
		examples: [4.5],
	}),
	tags: Type.Array(
		Type.String({
			description: "Business categories and tags",
			examples: ["clothing", "wholesale", "premium"],
		})
	),
	contractStartDate: Type.String({
		format: "date-time",
		description: "Contract start date",
	}),
	contractEndDate: Type.Optional(
		Type.String({
			format: "date-time",
			description: "Contract end date",
		})
	),
	minimumOrderValue: Type.Optional(
		Type.Number({
			minimum: 0,
			description: "Minimum order value",
			examples: [1000],
		})
	),
	leadTime: Type.Number({
		minimum: 0,
		description: "Lead time in days",
		examples: [7],
	}),
	paymentTerms: Type.String({
		minLength: 1,
		description: "Payment terms",
		examples: ["Net 30"],
	}),
	notes: Type.Optional(
		Type.String({
			description: "Additional notes",
			examples: ["Preferred supplier for premium products"],
		})
	),
});

// Complete Supplier Schema
export const SupplierSchema = Type.Intersect(
	[
		Type.Object({
			_id: Type.String({
				pattern: "^[0-9a-fA-F]{24}$",
				description: "MongoDB ObjectId",
			}),
		}),
		SupplierBaseSchema,
		Type.Object(Timestamps),
	],
	{
		description: "Complete supplier information with system fields",
	}
);

// Query Parameters
export const SupplierQueryParams = Type.Object({
	page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
	limit: Type.Optional(
		Type.Number({ minimum: 1, maximum: 100, default: 10 })
	),
	search: Type.Optional(Type.String()),
	status: Type.Optional(
		Type.Union([
			Type.Literal("active"),
			Type.Literal("inactive"),
			Type.Literal("blacklisted"),
		])
	),
	tags: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
	minRating: Type.Optional(Type.Number({ minimum: 0, maximum: 5 })),
	country: Type.Optional(Type.String()),
	sortBy: Type.Optional(
		Type.Union([
			Type.Literal("name"),
			Type.Literal("rating"),
			Type.Literal("leadTime"),
			Type.Literal("createdAt"),
		])
	),
	sortOrder: Type.Optional(
		Type.Union([Type.Literal("asc"), Type.Literal("desc")])
	),
});

// Request/Response Schemas
export const CreateSupplierBody = SupplierBaseSchema;
export const UpdateSupplierBody = Type.Partial(SupplierBaseSchema);

export const SupplierResponseSchema = ResponseWrapper(
	Type.Object({
		supplier: SupplierSchema,
	})
);

export const SuppliersResponseSchema = ResponseWrapper(
	Type.Object({
		suppliers: Type.Array(SupplierSchema),
		pagination: Type.Object({
			total: Type.Number(),
			page: Type.Number(),
			totalPages: Type.Number(),
			hasNext: Type.Boolean(),
			hasPrev: Type.Boolean(),
		}),
	})
);
