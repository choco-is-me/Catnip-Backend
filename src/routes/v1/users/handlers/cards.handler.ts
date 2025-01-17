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
	// Private helper methods
	private static async checkForDuplicateCard(
		cardNumber: string,
		session?: mongoose.ClientSession
	): Promise<{ isDuplicate: boolean; existingUserId?: string }> {
		try {
			const existingCard = await Card.findOne({}).session(
				session || null
			);

			if (existingCard) {
				// The cardNumber will be automatically decrypted due to the getter in the schema
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
			throw new Error("Failed to check for duplicate card");
		}
	}

	private static validateCardData(
		cardData: Static<typeof CreateCardBody>
	): void {
		// Additional card validation logic
		const currentYear = new Date().getFullYear() % 100; // Get last 2 digits of year
		const currentMonth = new Date().getMonth() + 1; // Get current month (1-12)

		const [expMonth, expYear] = cardData.expirationDate
			.split("/")
			.map(Number);

		if (
			expYear < currentYear ||
			(expYear === currentYear && expMonth < currentMonth)
		) {
			throw new Error("Card has expired");
		}

		// Luhn algorithm for card number validation
		const isValidCardNumber = CardsHandler.validateCardNumberLuhn(
			cardData.cardNumber
		);
		if (!isValidCardNumber) {
			throw new Error("Invalid card number");
		}
	}

	private static validateCardNumberLuhn(cardNumber: string): boolean {
		const cleanNumber = cardNumber.replace(/\D/g, "");
		let sum = 0;
		let isEven = false;

		// Loop through values starting from the right
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
			const cardData = {
				...request.body,
				cardNumber: request.body.cardNumber.replace(/\s+/g, ""), // Remove all spaces
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

			// Validate card data format and expiration
			try {
				CardsHandler.validateCardData(cardData);
			} catch (validationError) {
				await session.abortTransaction();
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						(validationError as Error).message
					)
				);
			}

			// Check for duplicate card
			const { isDuplicate, existingUserId } =
				await CardsHandler.checkForDuplicateCard(
					cardData.cardNumber,
					session
				);

			if (isDuplicate) {
				await session.abortTransaction();

				// If the card is already registered to another user
				if (existingUserId && existingUserId !== userId) {
					Logger.warn(
						`Attempt to add card already registered to another user. Requesting user: ${userId}, Card owner: ${existingUserId}`,
						"CardsHandler"
					);
					return sendError(
						reply,
						createError(
							409,
							ErrorTypes.DUPLICATE_ERROR,
							"This card is already registered to another account"
						)
					);
				}

				// If the user is trying to add the same card to their own account
				Logger.warn(
					`Attempt to add duplicate card by user: ${userId}`,
					"CardsHandler"
				);
				return sendError(
					reply,
					createError(
						409,
						ErrorTypes.DUPLICATE_ERROR,
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
			} catch (saveError) {
				Logger.error(saveError as Error, "CardsHandler");
				if ((saveError as Error).name === "ValidationError") {
					await session.abortTransaction();
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							"Invalid card data"
						)
					);
				}
				throw saveError;
			}

			// Handle default card status
			if (cardData.isDefault) {
				Logger.debug(
					`Updating default status for user's cards: ${userId}`,
					"CardsHandler"
				);
				try {
					await Card.updateMany(
						{
							userId,
							_id: { $ne: newCard._id },
							isDefault: true,
						},
						{ isDefault: false }
					).session(session);
				} catch (updateError) {
					Logger.error(
						new Error(
							`Failed to update default card status: ${
								(updateError as Error).message
							}`
						),
						"CardsHandler"
					);
					throw updateError;
				}
			}

			await session.commitTransaction();
			Logger.info(
				`Card added successfully for user ${userId}: ${newCard._id}`,
				"CardsHandler"
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

			// Handle MongoDB-specific errors
			if (error instanceof mongoose.Error) {
				Logger.error(
					new Error(`MongoDB operation failed: ${error.message}`),
					"CardsHandler"
				);
				if (error.stack) {
					Logger.debug(`Stack trace: ${error.stack}`, "CardsHandler");
				}

				if (error instanceof mongoose.Error.CastError) {
					Logger.error(
						new Error(`Invalid MongoDB ID format: ${error.value}`),
						"CardsHandler"
					);
				} else if (
					error.name === "MongoServerError" &&
					(error as any).code === 11000
				) {
					Logger.error(
						new Error(
							`Duplicate key error: ${JSON.stringify(
								(error as any).keyValue
							)}`
						),
						"CardsHandler"
					);
				}
			}

			Logger.error(error as Error, "CardsHandler");
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
			const {
				page = 1,
				limit = 10,
				sortBy = "createdAt",
				order = "desc",
			} = request.query;

			Logger.debug(
				`Fetching cards for user ${userId} (page: ${page}, limit: ${limit}, sortBy: ${sortBy}, order: ${order})`,
				"CardsHandler"
			);

			try {
				// Validate user existence first
				const userExists = await User.exists({ _id: userId });
				if (!userExists) {
					Logger.warn(
						`Attempted to fetch cards for non-existent user: ${userId}`,
						"CardsHandler"
					);
					return sendError(reply, CommonErrors.userNotFound());
				}
			} catch (userError) {
				if (userError instanceof mongoose.Error.CastError) {
					Logger.error(
						new Error(`Invalid user ID format: ${userId}`),
						"CardsHandler"
					);
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							"Invalid user ID format"
						)
					);
				}
				throw userError;
			}

			// Check if user has any cards
			let cardCount;
			try {
				cardCount = await Card.countDocuments({ userId });
				Logger.debug(
					`Found ${cardCount} cards for user ${userId}`,
					"CardsHandler"
				);
			} catch (countError) {
				Logger.error(
					new Error(
						`Error counting cards: ${(countError as Error).message}`
					),
					"CardsHandler"
				);
				throw countError;
			}

			if (cardCount === 0) {
				Logger.info(
					`No cards found for user: ${userId}`,
					"CardsHandler"
				);
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
					`Requested page ${page} exceeds total pages ${totalPages} for user ${userId}`,
					"CardsHandler"
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

			// Validate sortBy field
			const allowedSortFields = ["createdAt", "updatedAt", "nameOnCard"];
			if (!allowedSortFields.includes(sortBy)) {
				Logger.warn(
					`Invalid sort field attempted: ${sortBy}`,
					"CardsHandler"
				);
				return sendError(
					reply,
					createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						`Invalid sort field. Allowed fields: ${allowedSortFields.join(
							", "
						)}`
					)
				);
			}

			try {
				const [cards, total] = await Promise.all([
					Card.find({ userId })
						.sort({ [sortBy]: order === "desc" ? -1 : 1 })
						.skip((page - 1) * limit)
						.limit(limit)
						.lean(),
					Card.countDocuments({ userId }),
				]);

				Logger.debug(
					`Successfully retrieved ${cards.length} cards for user ${userId}`,
					"CardsHandler"
				);

				const formattedCards = cards.map((card) => ({
					...card,
					createdAt: card.createdAt.toISOString(),
					updatedAt: card.updatedAt.toISOString(),
				}));

				Logger.info(
					`Cards retrieved successfully for user ${userId} (page ${page} of ${totalPages})`,
					"CardsHandler"
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
			} catch (queryError) {
				if (queryError instanceof mongoose.Error) {
					Logger.error(
						new Error(
							`MongoDB query failed: ${queryError.message}`
						),
						"CardsHandler"
					);
					if (queryError.stack) {
						Logger.debug(
							`Stack trace: ${queryError.stack}`,
							"CardsHandler"
						);
					}
				} else {
					Logger.error(queryError as Error, "CardsHandler");
				}
				throw queryError;
			}
		} catch (error) {
			// Handle any uncaught errors
			if (error instanceof mongoose.Error) {
				Logger.error(
					new Error(`Unhandled MongoDB error: ${error.message}`),
					"CardsHandler"
				);
				if (error.stack) {
					Logger.debug(`Stack trace: ${error.stack}`, "CardsHandler");
				}
			} else {
				Logger.error(error as Error, "CardsHandler");
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
			Logger.debug(
				`Starting card deletion transaction for user ${userId}, card ${cardId}`,
				"CardsHandler"
			);

			// First validate user existence
			try {
				const userExists = await User.exists({ _id: userId }).session(
					session
				);
				if (!userExists) {
					await session.abortTransaction();
					Logger.warn(
						`Attempted to delete card for non-existent user: ${userId}`,
						"CardsHandler"
					);
					return sendError(reply, CommonErrors.userNotFound());
				}
			} catch (userError) {
				await session.abortTransaction();
				if (userError instanceof mongoose.Error.CastError) {
					Logger.error(
						new Error(`Invalid user ID format: ${userId}`),
						"CardsHandler"
					);
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							"Invalid user ID format"
						)
					);
				}
				throw userError;
			}

			// Then find the card
			let card;
			try {
				card = await Card.findOne({
					_id: cardId,
					userId,
				}).session(session);

				if (!card) {
					await session.abortTransaction();
					Logger.warn(
						`Card not found - ID: ${cardId}, User: ${userId}`,
						"CardsHandler"
					);
					return sendError(reply, CommonErrors.cardNotFound());
				}
			} catch (findError) {
				await session.abortTransaction();
				if (findError instanceof mongoose.Error.CastError) {
					Logger.error(
						new Error(`Invalid card ID format: ${cardId}`),
						"CardsHandler"
					);
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							"Invalid card ID format"
						)
					);
				}
				throw findError;
			}

			// Delete the card
			try {
				Logger.debug(`Deleting card ${cardId}`, "CardsHandler");
				await Card.deleteOne({
					_id: cardId,
					userId,
				}).session(session);
			} catch (deleteError) {
				Logger.error(
					new Error(
						`Failed to delete card: ${
							(deleteError as Error).message
						}`
					),
					"CardsHandler"
				);
				throw deleteError;
			}

			// If this was the default card, set another card as default
			if (card.isDefault) {
				try {
					Logger.debug(
						`Deleted card was default, finding new default card for user ${userId}`,
						"CardsHandler"
					);
					const anotherCard = await Card.findOne({ userId })
						.sort({ createdAt: -1 })
						.session(session);

					if (anotherCard) {
						Logger.debug(
							`Setting card ${anotherCard._id} as new default`,
							"CardsHandler"
						);
						await Card.findByIdAndUpdate(
							anotherCard._id,
							{ isDefault: true },
							{ session }
						);
					} else {
						Logger.debug(
							`No other cards found for user ${userId} to set as default`,
							"CardsHandler"
						);
					}
				} catch (updateError) {
					Logger.error(
						new Error(
							`Failed to update default card: ${
								(updateError as Error).message
							}`
						),
						"CardsHandler"
					);
					throw updateError;
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

			// Handle MongoDB-specific errors
			if (error instanceof mongoose.Error) {
				Logger.error(
					new Error(`MongoDB operation failed: ${error.message}`),
					"CardsHandler"
				);
				if (error.stack) {
					Logger.debug(`Stack trace: ${error.stack}`, "CardsHandler");
				}

				if (error.name === "MongoServerError") {
					Logger.error(
						new Error(`MongoDB server error: ${error.message}`),
						"CardsHandler"
					);
				}
			} else {
				Logger.error(error as Error, "CardsHandler");
			}

			return sendError(reply, error as Error);
		} finally {
			session.endSession();
			Logger.debug("MongoDB session ended", "CardsHandler");
		}
	}
}
