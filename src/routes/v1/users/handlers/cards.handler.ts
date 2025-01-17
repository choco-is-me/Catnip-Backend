// src/routes/v1/users/handlers/cards.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Card } from "../../../../models/Card";
import { User } from "../../../../models/User";
import {
	CreateCardBody,
	PaginationQuery,
	ParamsWithUserId,
	ParamsWithUserIdAndCardId,
} from "../../../../schemas";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createError,
	ErrorTypes,
	sendError,
} from "../../../../utils/error-handler";

export class CardsHandler {
	async addCard(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserId>;
			Body: Static<typeof CreateCardBody>;
		}>,
		reply: FastifyReply
	) {
		const session = await mongoose.startSession();
		session.startTransaction();

		try {
			const { userId } = request.params;
			const cardData = {
				...request.body,
				cardNumber: request.body.cardNumber.trim(),
				nameOnCard: request.body.nameOnCard.trim().toUpperCase(),
			};

			Logger.debug(`Adding new card for user: ${userId}`, "AddCard");

			const user = await User.findById(userId).session(session);
			if (!user) {
				await session.abortTransaction();
				Logger.warn(`User not found: ${userId}`, "AddCard");
				return sendError(reply, CommonErrors.userNotFound());
			}

			const newCard = new Card({
				...cardData,
				userId,
				nameOnCard: cardData.nameOnCard.trim().toUpperCase(),
				cardNumber: cardData.cardNumber.trim(),
			});

			await newCard.save({ session });

			if (cardData.isDefault) {
				Logger.debug(
					`Updating other cards as non-default for user: ${userId}`,
					"AddCard"
				);
				await Card.updateMany(
					{
						userId,
						_id: { $ne: newCard._id },
						isDefault: true,
					},
					{ isDefault: false }
				).session(session);
			}

			await session.commitTransaction();
			Logger.info(
				`Card added successfully for user: ${userId}`,
				"AddCard"
			);

			const cardResponse = newCard.toObject();
			return reply.code(201).send({
				success: true,
				data: {
					card: {
						...cardResponse,
						createdAt: newCard.createdAt.toISOString(),
						updatedAt: newCard.updatedAt.toISOString(),
					},
				},
			});
		} catch (error) {
			await session.abortTransaction();
			Logger.error(error as Error, "AddCard");
			return sendError(reply, error as Error);
		} finally {
			session.endSession();
		}
	}

	async getCards(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserId>;
			Querystring: Static<typeof PaginationQuery>;
		}>,
		reply: FastifyReply
	) {
		try {
			const { userId } = request.params;
			const {
				page = 1,
				limit = 10,
				sortBy = "createdAt",
				order = "desc",
			} = request.query;

			Logger.debug(
				`Fetching cards for user: ${userId} (page: ${page}, limit: ${limit})`,
				"GetCards"
			);

			// Check if user has any cards
			const cardCount = await Card.countDocuments({ userId });
			if (cardCount === 0) {
				Logger.info(`No cards found for user: ${userId}`, "GetCards");
				return reply.code(200).send({
					success: true,
					data: {
						cards: [],
						total: 0,
						page: 1,
						totalPages: 0,
					},
				});
			}

			const totalPages = Math.ceil(cardCount / limit);
			if (page > totalPages) {
				Logger.warn(
					`Requested page ${page} exceeds total pages ${totalPages}`,
					"GetCards"
				);
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						`Page ${page} exceeds available pages (${totalPages})`
					)
				);
			}

			const [cards, total] = await Promise.all([
				Card.find({ userId })
					.sort({ [sortBy]: order === "desc" ? -1 : 1 })
					.skip((page - 1) * limit)
					.limit(limit)
					.lean(),
				Card.countDocuments({ userId }),
			]);

			const formattedCards = cards.map((card) => ({
				...card,
				createdAt: card.createdAt.toISOString(),
				updatedAt: card.updatedAt.toISOString(),
			}));

			Logger.info(
				`Successfully retrieved ${cards.length} cards for user: ${userId}`,
				"GetCards"
			);

			return reply.code(200).send({
				success: true,
				data: {
					cards: formattedCards,
					total,
					page,
					totalPages: Math.ceil(total / limit),
				},
			});
		} catch (error) {
			Logger.error(error as Error, "GetCards");
			return sendError(reply, error as Error);
		}
	}

	async deleteCard(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserIdAndCardId>;
		}>,
		reply: FastifyReply
	) {
		const session = await mongoose.startSession();
		session.startTransaction();

		try {
			const { userId, cardId } = request.params;
			Logger.debug(
				`Attempting to delete card ${cardId} for user ${userId}`,
				"DeleteCard"
			);

			const card = await Card.findOne({
				_id: cardId,
				userId,
			}).session(session);

			if (!card) {
				await session.abortTransaction();
				Logger.warn(`Card not found: ${cardId}`, "DeleteCard");
				return sendError(reply, CommonErrors.cardNotFound());
			}

			await Card.deleteOne({
				_id: cardId,
				userId,
			}).session(session);

			if (card.isDefault) {
				Logger.debug(
					"Updating default card after deletion",
					"DeleteCard"
				);
				const anotherCard = await Card.findOne({ userId })
					.sort({ createdAt: -1 })
					.session(session);

				if (anotherCard) {
					await Card.findByIdAndUpdate(
						anotherCard._id,
						{ isDefault: true },
						{ session }
					);
				}
			}

			await session.commitTransaction();
			Logger.info(`Card ${cardId} deleted successfully`, "DeleteCard");

			return reply.code(200).send({
				success: true,
				data: {
					message: "Card deleted successfully",
				},
			});
		} catch (error) {
			await session.abortTransaction();
			Logger.error(error as Error, "DeleteCard");
			return sendError(reply, error as Error);
		} finally {
			session.endSession();
		}
	}
}
