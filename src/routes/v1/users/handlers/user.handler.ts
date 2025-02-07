// src/routes/v1/users/handlers/profile.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Card } from "../../../../models/Card";
import { TokenFamily } from "../../../../models/Token";
import { User } from "../../../../models/User";
import {
	ChangePasswordBody,
	ParamsWithUserId,
	UpdateUserBody,
} from "../../../../schemas";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
	createError,
	ErrorTypes,
	sendError,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";

export class UserHandler {
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

			// Double check MongoDB ObjectId format even though schema validates it
			if (!mongoose.Types.ObjectId.isValid(userId)) {
				return sendError(reply, CommonErrors.invalidFormat("user ID"));
			}

			const user = await User.findById(userId).select("-password").lean();

			if (!user) {
				return sendError(reply, CommonErrors.userNotFound());
			}

			Logger.info(
				`Profile retrieved for user: ${userId}`,
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
		} catch (error) {
			Logger.error(error as Error, "ProfileHandler");

			// Handle specific database errors
			if (error instanceof mongoose.Error) {
				return sendError(
					reply,
					CommonErrors.databaseError("profile retrieval")
				);
			}

			// Handle other unexpected errors
			return sendError(
				reply,
				createError(
					500,
					ErrorTypes.INTERNAL_ERROR,
					"Error retrieving user profile"
				)
			);
		}
	}

	async updateProfile(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserId>;
			Body: Static<typeof UpdateUserBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			try {
				const { userId } = request.params;
				Logger.debug(
					`Starting profile update for user: ${userId}`,
					"ProfileHandler"
				);

				if (!mongoose.Types.ObjectId.isValid(userId)) {
					return sendError(
						reply,
						CommonErrors.invalidFormat("user ID")
					);
				}

				const updateFields = Object.keys(request.body);
				if (updateFields.length === 0) {
					return sendError(
						reply,
						createBusinessError("No fields provided for update")
					);
				}

				// Check if update contains forbidden fields
				if (
					updateFields.includes("email") ||
					updateFields.includes("role")
				) {
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.INVALID_FORMAT,
							"Email and role cannot be modified"
						)
					);
				}

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
					return sendError(reply, CommonErrors.userNotFound());
				}

				Logger.info(
					`Profile updated for user: ${userId}`,
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
			} catch (error) {
				Logger.error(error as Error, "ProfileHandler");

				// Handle Mongoose validation errors
				if (error instanceof mongoose.Error.ValidationError) {
					return sendError(
						reply,
						createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							Object.values(error.errors)
								.map((err) => err.message)
								.join(", ")
						)
					);
				}

				// Handle other database errors
				if (error instanceof mongoose.Error) {
					return sendError(
						reply,
						CommonErrors.databaseError("profile update")
					);
				}

				return sendError(
					reply,
					createError(
						500,
						ErrorTypes.INTERNAL_ERROR,
						"Error updating user profile"
					)
				);
			}
		}, "ProfileHandler");
	}

	async deleteProfile(
		request: FastifyRequest<{ Params: Static<typeof ParamsWithUserId> }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			try {
				const { userId } = request.params;
				Logger.debug(
					`Starting profile deletion for user: ${userId}`,
					"ProfileHandler"
				);

				if (!mongoose.Types.ObjectId.isValid(userId)) {
					return sendError(
						reply,
						CommonErrors.invalidFormat("user ID")
					);
				}

				// First check if user exists and get their role
				const user = await User.findById(userId)
					.select("email role")
					.session(session);

				if (!user) {
					return sendError(reply, CommonErrors.userNotFound());
				}

				// Prevent deletion of admin user
				if (user.role === "admin") {
					return sendError(
						reply,
						createError(
							403,
							ErrorTypes.FORBIDDEN,
							"Admin accounts cannot be deleted"
						)
					);
				}

				// Check for any dependencies before deletion
				// Example: Check for active orders, subscriptions, etc.
				const hasActiveDependencies = false; // Replace with actual check
				if (hasActiveDependencies) {
					return sendError(
						reply,
						createBusinessError(
							"Cannot delete profile with active dependencies"
						)
					);
				}

				try {
					// Delete associated data first
					await Promise.all([
						// Delete user's cards
						Card.deleteMany({ userId }).session(session),
						// Delete user's sessions
						TokenFamily.deleteMany({ userId }).session(session),
						// Add other associated data deletions here
					]);

					// Finally delete the user
					const deleteResult = await User.findByIdAndDelete(
						userId
					).session(session);

					if (!deleteResult) {
						throw new Error("User not found during deletion");
					}

					Logger.info(
						`User profile deleted: ${userId}`,
						"ProfileHandler"
					);

					return reply.code(200).send({
						success: true,
						data: {
							message: "User account deleted successfully",
							email: user.email, // Return email for audit purposes
						},
					});
				} catch (error) {
					Logger.error(error as Error, "ProfileHandler");
					throw new Error("Error during deletion process");
				}
			} catch (error) {
				Logger.error(error as Error, "ProfileHandler");

				if (error instanceof mongoose.Error) {
					return sendError(
						reply,
						CommonErrors.databaseError("profile deletion")
					);
				}

				return sendError(
					reply,
					createError(
						500,
						ErrorTypes.INTERNAL_ERROR,
						"Error during profile deletion"
					)
				);
			}
		}, "ProfileHandler");
	}

	async changePassword(
		request: FastifyRequest<{
			Params: Static<typeof ParamsWithUserId>;
			Body: Static<typeof ChangePasswordBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			try {
				const { userId } = request.params;
				const { newPassword } = request.body;

				Logger.debug(
					`Starting password change for user: ${userId}`,
					"ProfileHandler"
				);

				if (!mongoose.Types.ObjectId.isValid(userId)) {
					return sendError(
						reply,
						CommonErrors.invalidFormat("user ID")
					);
				}

				// Get user with current password
				const user = await User.findById(userId).session(session);
				if (!user) {
					return sendError(reply, CommonErrors.userNotFound());
				}

				// Check if new password is same as current
				const isSamePassword = await user.comparePassword(newPassword);
				if (isSamePassword) {
					return sendError(
						reply,
						createBusinessError(
							"New password must be different from current password"
						)
					);
				}

				try {
					// Update password
					user.password = newPassword;
					await user.save({ session });

					// Invalidate all existing sessions for security
					await TokenFamily.updateMany(
						{ userId },
						{ reuseDetected: true },
						{ session }
					);

					Logger.info(
						`Password changed successfully for user: ${userId}`,
						"ProfileHandler"
					);

					return reply.code(200).send({
						success: true,
						data: {
							message: "Password changed successfully",
							// Optionally inform user that they'll be logged out of other devices
							requiresRelogin: true,
						},
					});
				} catch (error) {
					if (error instanceof mongoose.Error.ValidationError) {
						return sendError(
							reply,
							createError(
								400,
								ErrorTypes.VALIDATION_ERROR,
								"Password validation failed: " +
									Object.values(error.errors)
										.map((err) => err.message)
										.join(", ")
							)
						);
					}
					throw error; // Let outer catch block handle other errors
				}
			} catch (error) {
				Logger.error(error as Error, "ProfileHandler");

				if (error instanceof mongoose.Error) {
					return sendError(
						reply,
						CommonErrors.databaseError("password change")
					);
				}

				return sendError(
					reply,
					createError(
						500,
						ErrorTypes.INTERNAL_ERROR,
						"Error changing password"
					)
				);
			}
		}, "ProfileHandler");
	}
}
