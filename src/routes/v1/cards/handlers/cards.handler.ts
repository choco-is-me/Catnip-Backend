// src/routes/v1/users/handlers/cards.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Card, CardNetwork } from "../../../../models/Card";
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
	createBusinessError,
	createError,
	ErrorTypes,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";

export class CardsHandler {
	private static readonly MAX_CARDS_PER_USER: number = 5;

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
			throw CommonErrors.databaseError("duplicate card check");
		}
	}

	private static validateCardData(cardData: Static<typeof CreateCardBody>): {
		isValid: boolean;
		network: CardNetwork | null;
	} {
		const currentYear = new Date().getFullYear() % 100;
		const currentMonth = new Date().getMonth() + 1;
		const [expMonth, expYear] = cardData.expirationDate
			.split("/")
			.map(Number);

		// Validate expiration date
		if (!expMonth || !expYear || expMonth < 1 || expMonth > 12) {
			throw CommonErrors.expiredCard();
		}

		if (
			expYear < currentYear ||
			(expYear === currentYear && expMonth < currentMonth)
		) {
			throw CommonErrors.expiredCard();
		}

		// Clean card number
		const cleanCardNumber = cardData.cardNumber.replace(/\D/g, "");

		// Detect card network
		const network = Card.detectCardNetwork(cleanCardNumber);
		if (!network) {
			throw CommonErrors.invalidCardNetwork();
		}

		// Validate name format
		if (!/^[A-Za-z\s]+$/.test(cardData.nameOnCard)) {
			throw createError(
				400,
				ErrorTypes.CARD_FORMAT_ERROR,
				"Name on card can only contain letters and spaces"
			);
		}

		// Validate Luhn algorithm
		const isValidLuhn = this.validateCardNumberLuhn(cleanCardNumber);
		if (!isValidLuhn) {
			throw CommonErrors.invalidLuhnCheck();
		}

		return { isValid: true, network };
	}

	private static validateCardNumberLuhn(cardNumber: string): boolean {
		// Check if card number length is valid
		if (cardNumber.length < 13 || cardNumber.length > 19) {
			return false;
		}

		let sum = 0;
		let isEven = false;

		for (let i = cardNumber.length - 1; i >= 0; i--) {
			let digit = parseInt(cardNumber.charAt(i));

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

	// Helper methods for business rule validation
	private async checkRecurringPayments(
		cardId: string,
		session: mongoose.ClientSession
	): Promise<boolean> {
		// Implement your recurring payments check logic here
		// This is a placeholder that always returns false
		return false;
	}

	private async checkPendingTransactions(
		cardId: string,
		session: mongoose.ClientSession
	): Promise<boolean> {
		// Implement your pending transactions check logic here
		// This is a placeholder that always returns false
		return false;
	}

	async addCard(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserId>;
			Body: Static<typeof CreateCardBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { userId } = request.params;
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw CommonErrors.invalidFormat("user ID");
			}

			const cardData = {
				...request.body,
				cardNumber: request.body.cardNumber.replace(/\s+/g, ""),
				nameOnCard: request.body.nameOnCard.trim().toUpperCase(),
			};

			Logger.debug(
				`Starting card creation for user: ${userId}`,
				"CardsHandler"
			);

			// Validate user existence
			const user = await User.findById(userId).session(session);
			if (!user) {
				Logger.warn(
					`Attempted to add card for non-existent user: ${userId}`,
					"CardsHandler"
				);
				throw CommonErrors.userNotFound();
			}

			// Check user's card limit
			const cardCount = await Card.countDocuments({ userId }).session(
				session
			);
			if (cardCount >= CardsHandler.MAX_CARDS_PER_USER) {
				throw CommonErrors.cardLimitExceeded(
					CardsHandler.MAX_CARDS_PER_USER
				);
			}

			// Validate card data and detect network
			const { isValid, network } =
				CardsHandler.validateCardData(cardData);
			if (!isValid || !network) {
				throw CommonErrors.invalidCardFormat(network || "unknown");
			}

			// Check for duplicate card
			const { isDuplicate, existingUserId } =
				await CardsHandler.checkForDuplicateCard(
					cardData.cardNumber,
					session
				);

			if (isDuplicate) {
				if (existingUserId && existingUserId !== userId) {
					Logger.warn(
						`Attempt to add card registered to another user. Requesting user: ${userId}, Card owner: ${existingUserId}`,
						"CardsHandler"
					);
					throw CommonErrors.cardSecurityError();
				}
				throw CommonErrors.duplicateCard();
			}

			// Create and save new card with network information
			const newCard = new Card({
				...cardData,
				userId,
				network,
			});

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
		}, "CardsHandler");
	}

	async getCards(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserId>;
			Querystring: Static<typeof PaginationQuery>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { userId } = request.params;
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw CommonErrors.invalidFormat("user ID");
			}

			Logger.debug(
				`Starting card retrieval for user: ${userId}`,
				"CardsHandler"
			);

			// Destructure and validate query parameters
			const {
				page = 1,
				limit = 10,
				sortBy = "createdAt",
				order = "desc",
			} = request.query;

			// Enhanced pagination validation
			const validatedPage = Math.max(1, Math.floor(Number(page)));
			const validatedLimit = Math.min(
				100,
				Math.max(1, Math.floor(Number(limit)))
			);

			if (validatedPage !== page || validatedLimit !== limit) {
				throw createError(
					400,
					ErrorTypes.INVALID_FORMAT,
					"Invalid pagination parameters. Page must be ≥ 1, limit must be between 1 and 100"
				);
			}

			// Validate sort parameters with specific error messages
			const allowedSortFields = [
				"createdAt",
				"updatedAt",
				"nameOnCard",
				"network",
			] as const;
			if (
				!allowedSortFields.includes(
					sortBy as (typeof allowedSortFields)[number]
				)
			) {
				throw createError(
					400,
					ErrorTypes.INVALID_FORMAT,
					`Invalid sort field. Allowed fields: ${allowedSortFields.join(
						", "
					)}`
				);
			}

			// Check user existence with session
			const user = await User.findById(userId)
				.select("_id")
				.session(session)
				.lean();

			if (!user) {
				throw CommonErrors.userNotFound();
			}

			try {
				// Get cards with pagination and sorting
				const [cards, total] = await Promise.all([
					Card.find({ userId })
						.sort({ [sortBy]: order === "desc" ? -1 : 1 })
						.skip((validatedPage - 1) * validatedLimit)
						.limit(validatedLimit)
						.session(session)
						.lean(),
					Card.countDocuments({ userId }).session(session),
				]);

				const totalPages = Math.ceil(total / validatedLimit);

				// Validate requested page number against total pages
				if (validatedPage > totalPages && total > 0) {
					throw createError(
						400,
						ErrorTypes.INVALID_FORMAT,
						`Page ${validatedPage} exceeds available pages (${totalPages})`
					);
				}

				// Mask sensitive card information for response
				const maskedCards = cards.map((card) => ({
					...card,
					cardNumber: `****${card.cardNumber.slice(-4)}`, // Only show last 4 digits
					expirationDate: card.expirationDate,
					nameOnCard: card.nameOnCard,
					network: card.network,
					isDefault: card.isDefault,
					_id: card._id,
					userId: card.userId,
					createdAt: card.createdAt.toISOString(),
					updatedAt: card.updatedAt.toISOString(),
				}));

				Logger.info(
					`Retrieved ${cards.length} cards for user ${userId} (page ${validatedPage} of ${totalPages})`,
					"CardsHandler"
				);

				return reply.code(200).send({
					success: true,
					data: {
						cards: maskedCards,
						pagination: {
							total,
							page: validatedPage,
							totalPages,
							hasNext: validatedPage < totalPages,
							hasPrev: validatedPage > 1,
							limit: validatedLimit,
						},
					},
				});
			} catch (error) {
				Logger.error(error as Error, "CardsHandler");
				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("card retrieval");
				}
				throw error;
			}
		}, "CardsHandler");
	}

	async deleteCard(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserIdAndCardId>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { userId, cardId } = request.params;

			Logger.debug(
				`Starting card deletion process for user ${userId}, card ${cardId}`,
				"CardsHandler"
			);

			// Enhanced ID validation
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw CommonErrors.invalidFormat("user ID");
			}
			if (!mongoose.Types.ObjectId.isValid(cardId)) {
				throw CommonErrors.invalidFormat("card ID");
			}

			try {
				// Check user existence with select optimization
				const user = await User.findById(userId)
					.select("_id role")
					.session(session)
					.lean();

				if (!user) {
					throw CommonErrors.userNotFound();
				}

				// Find the card with ownership validation
				const card = await Card.findOne({
					_id: cardId,
				})
					.session(session)
					.lean();

				if (!card) {
					throw CommonErrors.cardNotFound();
				}

				// Validate card ownership
				if (card.userId.toString() !== userId) {
					Logger.warn(
						`Unauthorized card deletion attempt - User ${userId} attempted to delete card ${cardId} owned by ${card.userId}`,
						"CardsHandler"
					);
					throw createError(
						403,
						ErrorTypes.CARD_SECURITY_ERROR,
						"You do not have permission to delete this card"
					);
				}

				// Check for specific business rules
				const hasActiveRecurringPayments =
					await this.checkRecurringPayments(cardId, session);
				if (hasActiveRecurringPayments) {
					throw createBusinessError(
						"Cannot delete card with active recurring payments. Please cancel all recurring payments first."
					);
				}

				const hasPendingTransactions =
					await this.checkPendingTransactions(cardId, session);
				if (hasPendingTransactions) {
					throw createBusinessError(
						"Cannot delete card with pending transactions. Please wait for all transactions to complete."
					);
				}

				// Delete the card with ownership check
				const deleteResult = await Card.deleteOne({
					_id: cardId,
					userId, // Double-check ownership
				}).session(session);

				if (deleteResult.deletedCount === 0) {
					throw createError(
						404,
						ErrorTypes.NOT_FOUND,
						"Card not found or already deleted"
					);
				}

				// Handle default card reassignment if this was the default card
				if (card.isDefault) {
					const anotherCard = await Card.findOne({
						userId,
						_id: { $ne: cardId }, // Exclude the deleted card
					})
						.sort({ createdAt: -1 })
						.session(session);

					if (anotherCard) {
						await Card.findByIdAndUpdate(
							anotherCard._id,
							{
								isDefault: true,
								$currentDate: { updatedAt: true },
							},
							{
								session,
								new: true,
								runValidators: true,
							}
						);
						Logger.debug(
							`New default card set: ${anotherCard._id}`,
							"CardsHandler"
						);
					}
				}

				// Get remaining cards info
				const [remainingCount, remainingCards] = await Promise.all([
					Card.countDocuments({ userId }).session(session),
					Card.find({ userId })
						.select("_id isDefault")
						.sort({ createdAt: -1 })
						.limit(1)
						.session(session)
						.lean(),
				]);

				Logger.info(
					`Card ${cardId} deleted successfully for user ${userId}. Remaining cards: ${remainingCount}`,
					"CardsHandler"
				);

				// Return comprehensive response
				return reply.code(200).send({
					success: true,
					data: {
						message: "Card deleted successfully",
						cardInfo: {
							wasDefault: card.isDefault,
							network: card.network,
							lastFour: card.cardNumber.slice(-4),
						},
						remainingCards: {
							count: remainingCount,
							hasDefault: remainingCards.some((c) => c.isDefault),
						},
					},
				});
			} catch (error) {
				// Log the full error for debugging but send a safe response
				Logger.error(error as Error, "CardsHandler");

				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("card deletion");
				}
				throw error;
			}
		}, "CardsHandler");
	}

	async setDefaultCard(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserIdAndCardId>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { userId, cardId } = request.params;

			Logger.debug(
				`Starting default card update process for user ${userId}, card ${cardId}`,
				"CardsHandler"
			);

			// Validate IDs format
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw CommonErrors.invalidFormat("user ID");
			}
			if (!mongoose.Types.ObjectId.isValid(cardId)) {
				throw CommonErrors.invalidFormat("card ID");
			}

			try {
				// Find the card to be set as default
				const newDefaultCard = await Card.findOne({
					_id: cardId,
					userId,
				}).session(session);

				if (!newDefaultCard) {
					throw CommonErrors.cardNotFound();
				}

				// Check if card is already default
				if (newDefaultCard.isDefault) {
					throw createBusinessError(
						"This card is already set as default"
					);
				}

				// Find current default card
				const currentDefaultCard = await Card.findOne({
					userId,
					isDefault: true,
				}).session(session);

				if (!currentDefaultCard) {
					Logger.warn(
						`No default card found for user ${userId} during default card update`,
						"CardsHandler"
					);
				}

				// Update both cards in parallel
				const [updatedCard, previousDefault] = await Promise.all([
					// Set new default card
					Card.findByIdAndUpdate(
						cardId,
						{
							isDefault: true,
							$currentDate: { updatedAt: true },
						},
						{
							new: true,
							session,
							runValidators: true,
						}
					),
					// Update previous default card if it exists
					currentDefaultCard
						? Card.findByIdAndUpdate(
								currentDefaultCard._id,
								{
									isDefault: false,
									$currentDate: { updatedAt: true },
								},
								{
									new: true,
									session,
									runValidators: true,
								}
						  )
						: null,
				]);

				if (!updatedCard) {
					throw CommonErrors.cardNotFound();
				}

				Logger.info(
					`Default card updated successfully for user ${userId}. New default: ${cardId}`,
					"CardsHandler"
				);

				// Prepare response with masked card numbers
				const formatCardForResponse = (card: any) => ({
					...card.toObject(),
					cardNumber: `****${card.cardNumber.slice(-4)}`,
					createdAt: card.createdAt.toISOString(),
					updatedAt: card.updatedAt.toISOString(),
				});

				return reply.code(200).send({
					success: true,
					data: {
						message: "Default card updated successfully",
						updatedCard: formatCardForResponse(updatedCard),
						previousDefault: previousDefault
							? formatCardForResponse(previousDefault)
							: null,
					},
				});
			} catch (error) {
				Logger.error(error as Error, "CardsHandler");

				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("default card update");
				}
				throw error;
			}
		}, "CardsHandler");
	}
}
