// src/schemas/cards/index.ts
import { Type } from "@sinclair/typebox";
import { ResponseWrapper, Timestamps } from "../common";

// Card Network type
const CardNetworkEnum = Type.Union(
	[Type.Literal("visa"), Type.Literal("mastercard")],
	{
		description: "Supported card networks",
		examples: ["visa"],
	}
);

// Base schema for card data
const CardBaseSchema = Type.Object({
	cardNumber: Type.String({
		pattern:
			"^(?:4[0-9]{15}|5[1-5][0-9]{14}|2(22[1-9][0-9]{12}|2[3-9][0-9]{13}|[3-6][0-9]{14}|7[0-1][0-9]{13}|720[0-9]{12}))$",
		description:
			"Card number (Visa: 16 digits starting with 4, Mastercard: 16 digits starting with 51-55 or 2221-2720)",
		examples: ["4532015112830366"],
	}),
	expirationDate: Type.String({
		pattern: "^(0[1-9]|1[0-2])/[0-9]{2}$",
		description: "Card expiration date (MM/YY)",
		examples: ["12/25"],
	}),
	nameOnCard: Type.String({
		minLength: 1,
		maxLength: 50,
		pattern: "^[A-Z\\s]+$",
		description: "Cardholder name as appears on card (uppercase)",
		examples: ["JOHN A DOE"],
	}),
	network: Type.Optional(CardNetworkEnum),
	isDefault: Type.Optional(
		Type.Boolean({
			description: "Whether this is the default payment method",
			default: false,
		})
	),
});

// Example data for documentation
const cardExample = {
	_id: "507f1f77bcf86cd799439012",
	cardNumber: "****1111", // Masked for security
	expirationDate: "12/25",
	nameOnCard: "JOHN DOE",
	network: "visa",
	isDefault: true,
	createdAt: "2023-01-01T00:00:00.000Z",
	updatedAt: "2023-01-01T00:00:00.000Z",
};

const paginationExample = {
	total: 5,
	page: 1,
	totalPages: 1,
	hasNext: false,
	hasPrev: false,
	limit: 10,
};

// Complete card schema with system fields
export const CardSchema = Type.Intersect(
	[
		Type.Object({
			_id: Type.String({
				pattern: "^[0-9a-fA-F]{24}$",
				description: "MongoDB ObjectId",
			}),
		}),
		CardBaseSchema,
		Type.Object(Timestamps),
	],
	{
		examples: [cardExample],
		description:
			"Card information with network support (Visa/Mastercard only)",
	}
);

// Card ID parameter schema
export const CardIdParam = Type.Object({
	cardId: Type.String({
		pattern: "^[0-9a-fA-F]{24}$",
		description: "Card MongoDB ObjectId",
	}),
});

// Request body schemas
export const CreateCardBody = CardBaseSchema;
export const UpdateCardBody = Type.Partial(CardBaseSchema);

// Response schemas with enhanced examples
export const CardResponseSchema = ResponseWrapper(
	Type.Object({
		card: CardSchema,
	}),
	{
		description: "Card details response",
		examples: [
			{
				success: true,
				data: {
					card: cardExample,
				},
			},
		],
	}
);

// Enhanced pagination schema
export const CardPagination = Type.Object({
	total: Type.Integer({
		description: "Total number of cards",
		examples: [5],
	}),
	page: Type.Integer({
		description: "Current page number",
		examples: [1],
	}),
	totalPages: Type.Integer({
		description: "Total number of pages",
		examples: [1],
	}),
	hasNext: Type.Boolean({
		description: "Whether there are more pages after the current page",
		examples: [false],
	}),
	hasPrev: Type.Boolean({
		description: "Whether there are pages before the current page",
		examples: [false],
	}),
	limit: Type.Integer({
		description: "Number of items per page",
		examples: [10],
	}),
});

export const CardsResponseSchema = ResponseWrapper(
	Type.Object({
		cards: Type.Array(CardSchema),
		pagination: CardPagination,
	}),
	{
		description: "List of cards response with pagination",
		examples: [
			{
				success: true,
				data: {
					cards: [cardExample],
					pagination: paginationExample,
				},
			},
		],
	}
);

// Enhanced delete card response
export const CardDeleteResponseSchema = ResponseWrapper(
	Type.Object({
		message: Type.String({
			description: "Success message",
			examples: ["Card deleted successfully"],
		}),
		cardInfo: Type.Object({
			wasDefault: Type.Boolean({
				description:
					"Whether the deleted card was the default payment method",
				examples: [true],
			}),
			network: CardNetworkEnum,
			lastFour: Type.String({
				description: "Last four digits of the deleted card",
				examples: ["1111"],
			}),
		}),
		remainingCards: Type.Object({
			count: Type.Integer({
				description: "Number of remaining cards",
				examples: [2],
			}),
			hasDefault: Type.Boolean({
				description:
					"Whether there is a default card among remaining cards",
				examples: [true],
			}),
		}),
	})
);

// Example for default card update response
const defaultCardUpdateExample = {
	success: true as const,
	data: {
		message: "Default card updated successfully",
		updatedCard: {
			_id: "507f1f77bcf86cd799439012",
			cardNumber: "****1111",
			expirationDate: "12/25",
			nameOnCard: "JOHN DOE",
			network: "visa",
			isDefault: true,
			createdAt: "2023-01-01T00:00:00.000Z",
			updatedAt: "2023-01-01T00:00:00.000Z",
		},
		previousDefault: {
			_id: "507f1f77bcf86cd799439013",
			cardNumber: "****2222",
			expirationDate: "11/24",
			nameOnCard: "JOHN DOE",
			network: "mastercard",
			isDefault: false,
			createdAt: "2023-01-01T00:00:00.000Z",
			updatedAt: "2023-01-01T00:00:00.000Z",
		},
	},
};

// Update default card response
export const UpdateDefaultCardResponseSchema = ResponseWrapper(
	Type.Object({
		message: Type.String({
			description: "Success message",
			examples: ["Default card updated successfully"],
		}),
		updatedCard: CardSchema,
		previousDefault: Type.Optional(CardSchema),
	}),
	{
		description: "Response for updating default card status",
		examples: [defaultCardUpdateExample],
	}
);
