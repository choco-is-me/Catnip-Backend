// src/routes/v1/users/handlers/profile.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Card } from "../../../../models/Card";
import { User } from "../../../../models/User";
import { ParamsWithUserId, UpdateUserBody } from "../../../../schemas";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createError,
	ErrorTypes,
	sendError,
} from "../../../../utils/error-handler";

export class ProfileHandler {
	async getProfile(
		request: FastifyRequest<{ Params: Static<typeof ParamsWithUserId> }>,
		reply: FastifyReply
	) {
		try {
			const { userId } = request.params;
			Logger.debug(
				`Fetching profile for user: ${userId}`,
				"ProfileHandler"
			);

			// Validate userId format first
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				Logger.warn(
					`Invalid user ID format: ${userId}`,
					"ProfileHandler"
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

			try {
				const user = await User.findById(userId)
					.select("-password") // Explicitly exclude password
					.lean();

				if (!user) {
					Logger.warn(`User not found: ${userId}`, "ProfileHandler");
					return sendError(reply, CommonErrors.userNotFound());
				}

				// Log successful retrieval with minimal user info for privacy
				Logger.info(
					`Profile retrieved successfully for user: ${userId} (${user.email})`,
					"ProfileHandler"
				);

				// Log detailed fields retrieval in debug mode
				Logger.debug(
					`Retrieved fields for user ${userId}: ${Object.keys(
						user
					).join(", ")}`,
					"ProfileHandler"
				);

				return reply.code(200).send({
					success: true,
					data: {
						user: {
							...user,
							createdAt: user.createdAt.toISOString(),
							updatedAt: user.updatedAt.toISOString(),
						},
					},
				});
			} catch (findError) {
				if (findError instanceof mongoose.Error) {
					Logger.error(
						new Error(`MongoDB query failed: ${findError.message}`),
						"ProfileHandler"
					);

					// Log stack trace in debug mode
					if (findError.stack) {
						Logger.debug(
							`Stack trace: ${findError.stack}`,
							"ProfileHandler"
						);
					}

					// Handle specific MongoDB errors
					if (findError instanceof mongoose.Error.CastError) {
						return sendError(
							reply,
							createError(
								400,
								ErrorTypes.VALIDATION_ERROR,
								"Invalid user ID format"
							)
						);
					}
				}
				throw findError;
			}
		} catch (error) {
			// Handle any uncaught errors
			if (error instanceof mongoose.Error) {
				Logger.error(
					new Error(`Unhandled MongoDB error: ${error.message}`),
					"ProfileHandler"
				);
				if (error.stack) {
					Logger.debug(
						`Stack trace: ${error.stack}`,
						"ProfileHandler"
					);
				}

				// Log specific MongoDB error types
				if (error.name === "MongoServerError") {
					Logger.error(
						new Error(`MongoDB server error: ${error.message}`),
						"ProfileHandler"
					);
				}
			} else {
				Logger.error(error as Error, "ProfileHandler");
			}

			return sendError(reply, error as Error);
		}
	}

	async updateProfile(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserId>;
			Body: Static<typeof UpdateUserBody>;
		}>,
		reply: FastifyReply
	) {
		const session = await mongoose.startSession();
		session.startTransaction();

		try {
			const { userId } = request.params;
			Logger.debug(
				`Starting profile update transaction for user: ${userId}`,
				"ProfileHandler"
			);

			// Validate userId format first
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				await session.abortTransaction();
				Logger.warn(
					`Invalid user ID format: ${userId}`,
					"ProfileHandler"
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

			// Log update request details (excluding sensitive data)
			const updateFields = Object.keys(request.body);
			Logger.debug(
				`Update requested for fields: ${updateFields.join(", ")}`,
				"ProfileHandler"
			);

			// Check for email update and verify uniqueness if needed
			if (request.body.email) {
				try {
					const existingUser = await User.findOne({
						email: request.body.email,
						_id: { $ne: userId },
					}).session(session);

					if (existingUser) {
						await session.abortTransaction();
						Logger.warn(
							`Email update failed: ${request.body.email} already in use`,
							"ProfileHandler"
						);
						return sendError(reply, CommonErrors.emailExists());
					}
				} catch (emailError) {
					Logger.error(
						new Error(
							`Email verification failed: ${
								(emailError as Error).message
							}`
						),
						"ProfileHandler"
					);
					throw emailError;
				}
			}

			try {
				// Attempt to update user
				const updatedUser = await User.findByIdAndUpdate(
					userId,
					{ $set: request.body },
					{
						new: true,
						session,
						select: "-password",
						runValidators: true,
					}
				);

				if (!updatedUser) {
					await session.abortTransaction();
					Logger.warn(
						`User not found for update: ${userId}`,
						"ProfileHandler"
					);
					return sendError(reply, CommonErrors.userNotFound());
				}

				// Log successful update
				Logger.debug(
					`Updated fields for user ${userId}: ${updateFields.join(
						", "
					)}`,
					"ProfileHandler"
				);

				await session.commitTransaction();
				Logger.info(
					`Profile updated successfully for user: ${userId}`,
					"ProfileHandler"
				);

				return reply.code(200).send({
					success: true,
					data: {
						user: {
							...updatedUser.toObject(),
							createdAt: updatedUser.createdAt.toISOString(),
							updatedAt: updatedUser.updatedAt.toISOString(),
						},
					},
				});
			} catch (updateError) {
				await session.abortTransaction();

				if (updateError instanceof mongoose.Error.ValidationError) {
					Logger.warn(
						`Validation error during update for user ${userId}: ${updateError.message}`,
						"ProfileHandler"
					);
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							Object.values(updateError.errors)
								.map((err) => err.message)
								.join(", ")
						)
					);
				}

				throw updateError;
			}
		} catch (error) {
			await session.abortTransaction();

			// Handle MongoDB-specific errors
			if (error instanceof mongoose.Error) {
				Logger.error(
					new Error(`MongoDB operation failed: ${error.message}`),
					"ProfileHandler"
				);
				if (error.stack) {
					Logger.debug(
						`Stack trace: ${error.stack}`,
						"ProfileHandler"
					);
				}

				// Handle specific MongoDB errors
				if (
					error.name === "MongoServerError" &&
					(error as any).code === 11000
				) {
					Logger.error(
						new Error(
							`Duplicate key error: ${JSON.stringify(
								(error as any).keyValue
							)}`
						),
						"ProfileHandler"
					);
					return sendError(reply, CommonErrors.emailExists());
				}
			} else {
				Logger.error(error as Error, "ProfileHandler");
			}

			return sendError(reply, error as Error);
		} finally {
			session.endSession();
			Logger.debug("MongoDB session ended", "ProfileHandler");
		}
	}

	async deleteProfile(
		request: FastifyRequest<{ Params: Static<typeof ParamsWithUserId> }>,
		reply: FastifyReply
	) {
		const session = await mongoose.startSession();
		session.startTransaction();

		try {
			const { userId } = request.params;
			Logger.debug(
				`Starting profile deletion transaction for user: ${userId}`,
				"ProfileHandler"
			);

			// Validate userId format first
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				await session.abortTransaction();
				Logger.warn(
					`Invalid user ID format: ${userId}`,
					"ProfileHandler"
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

			// First check if user exists and get their data for logging
			let user;
			try {
				user = await User.findById(userId)
					.select("email")
					.session(session);

				if (!user) {
					await session.abortTransaction();
					Logger.warn(
						`Attempt to delete non-existent user: ${userId}`,
						"ProfileHandler"
					);
					return sendError(reply, CommonErrors.userNotFound());
				}

				Logger.info(
					`Starting deletion process for user: ${userId} (${user.email})`,
					"ProfileHandler"
				);
			} catch (findError) {
				await session.abortTransaction();
				Logger.error(
					new Error(
						`Error finding user: ${(findError as Error).message}`
					),
					"ProfileHandler"
				);
				throw findError;
			}

			// Delete associated data with proper error handling
			try {
				Logger.debug(
					`Deleting associated cards for user: ${userId}`,
					"ProfileHandler"
				);
				const cardsDeleteResult = await Card.deleteMany({
					userId,
				}).session(session);

				Logger.debug(
					`Deleted ${cardsDeleteResult.deletedCount} cards for user: ${userId}`,
					"ProfileHandler"
				);
			} catch (cardsError) {
				await session.abortTransaction();
				Logger.error(
					new Error(
						`Error deleting user's cards: ${
							(cardsError as Error).message
						}`
					),
					"ProfileHandler"
				);
				throw cardsError;
			}

			// Delete user account
			try {
				Logger.debug(
					`Deleting user account: ${userId}`,
					"ProfileHandler"
				);
				const deleteResult = await User.findByIdAndDelete(
					userId
				).session(session);

				if (!deleteResult) {
					await session.abortTransaction();
					Logger.error(
						new Error(
							`User ${userId} not found during final deletion`
						),
						"ProfileHandler"
					);
					return sendError(reply, CommonErrors.userNotFound());
				}
			} catch (userDeleteError) {
				await session.abortTransaction();
				Logger.error(
					new Error(
						`Error deleting user account: ${
							(userDeleteError as Error).message
						}`
					),
					"ProfileHandler"
				);
				throw userDeleteError;
			}

			// If we reached here, commit the transaction
			await session.commitTransaction();
			Logger.info(
				`User profile and associated data deleted successfully: ${userId}`,
				"ProfileHandler"
			);

			// Invalidate any active sessions/tokens here if implemented
			// You might want to add token invalidation logic here

			return reply.code(200).send({
				success: true,
				data: {
					message: "User account deleted successfully",
				},
			});
		} catch (error) {
			await session.abortTransaction();

			// Handle MongoDB-specific errors
			if (error instanceof mongoose.Error) {
				Logger.error(
					new Error(`MongoDB operation failed: ${error.message}`),
					"ProfileHandler"
				);
				if (error.stack) {
					Logger.debug(
						`Stack trace: ${error.stack}`,
						"ProfileHandler"
					);
				}

				// Handle specific MongoDB errors
				if (error instanceof mongoose.Error.CastError) {
					Logger.error(
						new Error(`Invalid MongoDB ID format: ${error.value}`),
						"ProfileHandler"
					);
				} else if (error.name === "MongoServerError") {
					Logger.error(
						new Error(`MongoDB server error: ${error.message}`),
						"ProfileHandler"
					);
				}
			} else {
				Logger.error(error as Error, "ProfileHandler");
			}

			return sendError(reply, error as Error);
		} finally {
			session.endSession();
			Logger.debug("MongoDB session ended", "ProfileHandler");
		}
	}
}
