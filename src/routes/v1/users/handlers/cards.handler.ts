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
	createBusinessError,
	createSecurityError,
	ErrorTypes,
	sendError,
} from "../../../../utils/error-handler";

export class CardsHandler {
	private static async checkForDuplicateCard(
		cardNumber: string,
		session?: mongoose.ClientSession
	): Promise<{ isDuplicate: boolean; existingUserId?: string }> {
		try {
			const existingCard = await Card.findOne({}).session(
				session || null
			);

			if (existingCard) {
				if (existingCard.cardNumber === cardNumber) {
					return {
						isDuplicate: true,
						existingUserId: existingCard.userId.toString(),
					};
				}
			}

			return { isDuplicate: false };
		} catch (error) {
			Logger.error(error as Error, "CheckDuplicateCard");
			throw createError(
				500,
				ErrorTypes.DATABASE_ERROR,
				"Failed to check for duplicate card"
			);
		}
	}

	private static validateCardData(
		cardData: Static<typeof CreateCardBody>
	): void {
		const currentYear = new Date().getFullYear() % 100;
		const currentMonth = new Date().getMonth() + 1;
		const [expMonth, expYear] = cardData.expirationDate
			.split("/")
			.map(Number);

		// Validate expiration date
		if (!expMonth || !expYear || expMonth < 1 || expMonth > 12) {
			throw createError(
				400,
				ErrorTypes.INVALID_FORMAT,
				"Invalid expiration date format"
			);
		}

		if (
			expYear < currentYear ||
			(expYear === currentYear && expMonth < currentMonth)
		) {
			throw createBusinessError("Card has expired");
		}

		// Validate card number format and checksum
		if (!this.validateCardNumberLuhn(cardData.cardNumber)) {
			throw createError(
				400,
				ErrorTypes.VALIDATION_ERROR,
				"Invalid card number"
			);
		}

		// Validate name format
		if (!/^[A-Za-z\s]+$/.test(cardData.nameOnCard)) {
			throw createError(
				400,
				ErrorTypes.INVALID_FORMAT,
				"Name on card can only contain letters and spaces"
			);
		}
	}

	private static validateCardNumberLuhn(cardNumber: string): boolean {
		const cleanNumber = cardNumber.replace(/\D/g, "");

		// Check if card number is too short or too long
		if (cleanNumber.length < 13 || cleanNumber.length > 19) {
			return false;
		}

		let sum = 0;
		let isEven = false;

		for (let i = cleanNumber.length - 1; i >= 0; i--) {
			let digit = parseInt(cleanNumber.charAt(i));

			if (isEven) {
				digit *= 2;
				if (digit > 9) {
					digit -= 9;
				}
			}

			sum += digit;
			isEven = !isEven;
		}

		return sum % 10 === 0;
	}

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
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				await session.abortTransaction();
				return sendError(reply, CommonErrors.invalidFormat("user ID"));
			}

			const cardData = {
				...request.body,
				cardNumber: request.body.cardNumber.replace(/\s+/g, ""),
				nameOnCard: request.body.nameOnCard.trim().toUpperCase(),
			};

			Logger.debug(
				`Starting card creation transaction for user: ${userId}`,
				"CardsHandler"
			);

			// Validate user existence
			const user = await User.findById(userId).session(session);
			if (!user) {
				await session.abortTransaction();
				Logger.warn(
					`Attempted to add card for non-existent user: ${userId}`,
					"CardsHandler"
				);
				return sendError(reply, CommonErrors.userNotFound());
			}

			// Check user's card limit
			const cardCount = await Card.countDocuments({ userId }).session(
				session
			);
			const MAX_CARDS_PER_USER = 5; // Configure this based on your requirements
			if (cardCount >= MAX_CARDS_PER_USER) {
				await session.abortTransaction();
				return sendError(
					reply,
					createBusinessError(
						`Maximum card limit (${MAX_CARDS_PER_USER}) reached`
					)
				);
			}

			// Validate card data
			try {
				CardsHandler.validateCardData(cardData);
			} catch (validationError) {
				await session.abortTransaction();
				return sendError(reply, validationError as Error);
			}

			// Check for duplicate card
			const { isDuplicate, existingUserId } =
				await CardsHandler.checkForDuplicateCard(
					cardData.cardNumber,
					session
				);

			if (isDuplicate) {
				await session.abortTransaction();
				if (existingUserId && existingUserId !== userId) {
					Logger.warn(
						`Attempt to add card registered to another user. Requesting user: ${userId}, Card owner: ${existingUserId}`,
						"CardsHandler"
					);
					return sendError(
						reply,
						createSecurityError(
							"This card is registered to another account"
						)
					);
				}
				return sendError(
					reply,
					createBusinessError(
						"This card is already registered to your account"
					)
				);
			}

			// Create and save new card
			const newCard = new Card({
				...cardData,
				userId,
			});

			try {
				await newCard.save({ session });
				Logger.debug(
					`Card saved successfully: ${newCard._id}`,
					"CardsHandler"
				);

				// Handle default card status
				if (cardData.isDefault) {
					await Card.updateMany(
						{
							userId,
							_id: { $ne: newCard._id },
							isDefault: true,
						},
						{ isDefault: false },
						{ session }
					);
				}

				await session.commitTransaction();
				Logger.info(
					`Card added successfully for user ${userId}: ${newCard._id}`,
					"CardsHandler"
				);

				return reply.code(201).send({
					success: true,
					data: {
						card: {
							...newCard.toObject(),
							createdAt: newCard.createdAt.toISOString(),
							updatedAt: newCard.updatedAt.toISOString(),
						},
					},
				});
			} catch (saveError) {
				await session.abortTransaction();
				if (saveError instanceof mongoose.Error.ValidationError) {
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							Object.values(saveError.errors)
								.map((err) => err.message)
								.join(", ")
						)
					);
				}
				throw saveError;
			}
		} catch (error) {
			await session.abortTransaction();

			if (error instanceof mongoose.Error) {
				if (error instanceof mongoose.Error.CastError) {
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.INVALID_FORMAT,
							`Invalid format for ${error.path}`
						)
					);
				}

				return sendError(
					reply,
					CommonErrors.databaseError("card creation")
				);
			}

			return sendError(reply, error as Error);
		} finally {
			session.endSession();
			Logger.debug("MongoDB session ended", "CardsHandler");
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
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				return sendError(reply, CommonErrors.invalidFormat("user ID"));
			}

			const {
				page = 1,
				limit = 10,
				sortBy = "createdAt",
				order = "desc",
			} = request.query;

			// Validate pagination parameters
			if (page < 1 || limit < 1 || limit > 100) {
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.INVALID_FORMAT,
						"Invalid pagination parameters"
					)
				);
			}

			// Validate sort parameters
			const allowedSortFields = ["createdAt", "updatedAt", "nameOnCard"];
			if (!allowedSortFields.includes(sortBy)) {
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.INVALID_FORMAT,
						`Invalid sort field. Allowed fields: ${allowedSortFields.join(
							", "
						)}`
					)
				);
			}

			// Check user existence
			const userExists = await User.exists({ _id: userId });
			if (!userExists) {
				return sendError(reply, CommonErrors.userNotFound());
			}

			const [cards, total] = await Promise.all([
				Card.find({ userId })
					.sort({ [sortBy]: order === "desc" ? -1 : 1 })
					.skip((page - 1) * limit)
					.limit(limit)
					.lean(),
				Card.countDocuments({ userId }),
			]);

			const totalPages = Math.ceil(total / limit);

			// Validate requested page number
			if (page > totalPages && total > 0) {
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.INVALID_FORMAT,
						`Page ${page} exceeds available pages (${totalPages})`
					)
				);
			}

			Logger.info(
				`Retrieved ${cards.length} cards for user ${userId} (page ${page} of ${totalPages})`,
				"CardsHandler"
			);

			return reply.code(200).send({
				success: true,
				data: {
					cards: cards.map((card) => ({
						...card,
						createdAt: card.createdAt.toISOString(),
						updatedAt: card.updatedAt.toISOString(),
					})),
					total,
					page,
					totalPages,
				},
			});
		} catch (error) {
			if (error instanceof mongoose.Error) {
				return sendError(
					reply,
					CommonErrors.databaseError("card retrieval")
				);
			}
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

			// Validate IDs
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				await session.abortTransaction();
				return sendError(reply, CommonErrors.invalidFormat("user ID"));
			}
			if (!mongoose.Types.ObjectId.isValid(cardId)) {
				await session.abortTransaction();
				return sendError(reply, CommonErrors.invalidFormat("card ID"));
			}

			// Check user existence
			const userExists = await User.exists({ _id: userId }).session(
				session
			);
			if (!userExists) {
				await session.abortTransaction();
				return sendError(reply, CommonErrors.userNotFound());
			}

			// Find the card
			const card = await Card.findOne({ _id: cardId, userId }).session(
				session
			);
			if (!card) {
				await session.abortTransaction();
				return sendError(reply, CommonErrors.cardNotFound());
			}

			// Check if card has pending transactions
			const hasPendingTransactions = false; // Implement based on your business logic
			if (hasPendingTransactions) {
				await session.abortTransaction();
				return sendError(
					reply,
					createBusinessError(
						"Cannot delete card with pending transactions"
					)
				);
			}

			// Delete the card
			await Card.deleteOne({ _id: cardId, userId }).session(session);

			// Handle default card reassignment if necessary
			if (card.isDefault) {
				const anotherCard = await Card.findOne({ userId })
					.sort({ createdAt: -1 })
					.session(session);

				if (anotherCard) {
					await Card.findByIdAndUpdate(
						anotherCard._id,
						{ isDefault: true },
						{ session }
					);
					Logger.debug(
						`New default card set: ${anotherCard._id}`,
						"CardsHandler"
					);
				}
			}

			await session.commitTransaction();
			Logger.info(
				`Card ${cardId} deleted successfully for user ${userId}`,
				"CardsHandler"
			);

			return reply.code(200).send({
				success: true,
				data: {
					message: "Card deleted successfully",
				},
			});
		} catch (error) {
			await session.abortTransaction();

			if (error instanceof mongoose.Error) {
				if (error instanceof mongoose.Error.CastError) {
					return sendError(
						reply,
						CommonErrors.invalidFormat(error.path)
					);
				}
				return sendError(
					reply,
					CommonErrors.databaseError("card deletion")
				);
			}

			return sendError(reply, error as Error);
		} finally {
			session.endSession();
			Logger.debug("MongoDB session ended", "CardsHandler");
		}
	}
}
