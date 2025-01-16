import { Type } from "@sinclair/typebox";
import { ResponseWrapper } from "../common";
import { ParamsWithUserId } from "../users";

export const CardSchema = Type.Object({
	_id: Type.String(),
	cardNumber: Type.String(),
	expirationDate: Type.String(),
	nameOnCard: Type.String(),
	isDefault: Type.Boolean(),
	userId: Type.String(),
	createdAt: Type.String(),
	updatedAt: Type.String(),
});

export const ParamsWithUserIdAndCardId = Type.Object({
	...ParamsWithUserId.properties,
	cardId: Type.String(),
});

export const CreateCardBody = Type.Object({
	cardNumber: Type.String(),
	expirationDate: Type.String(),
	nameOnCard: Type.String(),
	isDefault: Type.Optional(Type.Boolean()),
});

export const CardResponseSchema = ResponseWrapper(
	Type.Object({
		card: CardSchema,
	})
);

export const CardsResponseSchema = ResponseWrapper(
	Type.Object({
		cards: Type.Array(CardSchema),
	})
);
