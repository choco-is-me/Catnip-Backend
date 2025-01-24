// src/schemas/cards/index.ts
import { Type } from "@sinclair/typebox";
import { ResponseWrapper, Timestamps } from "../common";
import { ParamsWithUserId } from "../users";

const CardBaseSchema = Type.Object({
	cardNumber: Type.String({
		pattern: "^[0-9]{16}$",
		description: "16-digit card number, stored encrypted",
		examples: ["4111111111111111"],
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
	isDefault: Type.Optional(
		Type.Boolean({
			description: "Whether this is the default payment method",
			default: false,
		})
	),
});

const cardExample = {
	_id: "507f1f77bcf86cd799439012",
	userId: "507f1f77bcf86cd799439011",
	cardNumber: "4111111111111111",
	expirationDate: "12/25",
	nameOnCard: "JOHN DOE",
	isDefault: true,
	createdAt: "2023-01-01T00:00:00.000Z",
	updatedAt: "2023-01-01T00:00:00.000Z",
};

export const CardSchema = Type.Intersect(
	[
		Type.Object({
			_id: Type.String({
				pattern: "^[0-9a-fA-F]{24}$",
				description: "MongoDB ObjectId",
			}),
			userId: Type.String({
				pattern: "^[0-9a-fA-F]{24}$",
				description: "Owner's user ID",
			}),
		}),
		CardBaseSchema,
		Type.Object(Timestamps),
	],
	{
		examples: [cardExample],
	}
);

export const ParamsWithUserIdAndCardId = Type.Intersect([
	ParamsWithUserId,
	Type.Object({
		cardId: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "Card MongoDB ObjectId",
		}),
	}),
]);

export const CreateCardBody = CardBaseSchema;

export const UpdateCardBody = Type.Partial(CardBaseSchema);

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

export const CardsResponseSchema = ResponseWrapper(
	Type.Object({
		cards: Type.Array(CardSchema),
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
	}),
	{
		description: "List of cards response",
		examples: [
			{
				success: true,
				data: {
					cards: [cardExample],
					total: 5,
					page: 1,
					totalPages: 1,
				},
			},
		],
	}
);
