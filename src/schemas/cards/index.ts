// src/schemas/cards/index.ts
import { Type } from "@sinclair/typebox";
import { ResponseWrapper, Timestamps } from "../common";
import { ParamsWithUserId } from "../users";

// Base card fields
const CardBaseSchema = Type.Object({
	cardNumber: Type.String({
		pattern: "^[0-9]{16}$",
	}),
	expirationDate: Type.String({
		pattern: "^(0[1-9]|1[0-2])/[0-9]{2}$",
	}),
	nameOnCard: Type.String({
		minLength: 1,
	}),
	isDefault: Type.Optional(Type.Boolean()),
});

// Complete card schema including system fields
export const CardSchema = Type.Intersect([
	Type.Object({
		_id: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "MongoDB ObjectId",
		}),
		userId: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "MongoDB ObjectId",
		}),
	}),
	CardBaseSchema,
	Type.Object(Timestamps),
]);

// Parameters
export const ParamsWithUserIdAndCardId = Type.Intersect([
	ParamsWithUserId,
	Type.Object({
		cardId: Type.String({
			pattern: "^[0-9a-fA-F]{24}$",
			description: "MongoDB ObjectId",
		}),
	}),
]);

// Request schemas
export const CreateCardBody = CardBaseSchema;

export const UpdateCardBody = Type.Partial(CardBaseSchema);

// Response schemas
export const CardResponseSchema = ResponseWrapper(
	Type.Object({
		card: CardSchema,
	})
);

export const CardsResponseSchema = ResponseWrapper(
	Type.Object({
		cards: Type.Array(CardSchema),
		total: Type.Integer(),
	})
);
