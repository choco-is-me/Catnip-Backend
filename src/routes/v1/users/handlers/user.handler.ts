// src/routes/v1/users/handlers/user.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Card } from "../../../../models/Card";
import { TokenFamily } from "../../../../models/Token";
import { User } from "../../../../models/User";
import {
	ChangePasswordBody,
	UpdateUserBody,
} from "../../../../schemas/users/index";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
	createError,
	ErrorTypes,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";

export class UserHandler {
	async getProfile(request: FastifyRequest, reply: FastifyReply) {
		try {
			const userId = request.user!.userId;
			Logger.debug(`Fetching profile for user: ${userId}`, "UserHandler");

			const user = await User.findById(userId).select("-password").lean();
			if (!user) {
				throw CommonErrors.userNotFound();
			}

			Logger.info(`Profile retrieved for user: ${userId}`, "UserHandler");

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
			Logger.error(error as Error, "UserHandler");

			if (error instanceof mongoose.Error) {
				throw CommonErrors.databaseError("profile retrieval");
			}

			throw error;
		}
	}

	async updateProfile(
		request: FastifyRequest<{
			Body: Static<typeof UpdateUserBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			try {
				const userId = request.user!.userId;
				Logger.debug(
					`Starting profile update for user: ${userId}`,
					"UserHandler"
				);

				const updateFields = Object.keys(request.body);
				if (updateFields.length === 0) {
					throw createBusinessError("No fields provided for update");
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
					throw CommonErrors.userNotFound();
				}

				Logger.info(
					`Profile updated for user: ${userId}`,
					"UserHandler"
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
				Logger.error(error as Error, "UserHandler");

				if (error instanceof mongoose.Error.ValidationError) {
					throw createError(
						400,
						ErrorTypes.VALIDATION_ERROR,
						Object.values(error.errors)
							.map((err) => err.message)
							.join(", ")
					);
				}

				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("profile update");
				}

				throw error;
			}
		}, "UserHandler");
	}

	async deleteProfile(request: FastifyRequest, reply: FastifyReply) {
		return withTransaction(async (session) => {
			try {
				const userId = request.user!.userId;
				Logger.debug(
					`Starting profile deletion for user: ${userId}`,
					"UserHandler"
				);

				// First check if user exists and get their role
				const user = await User.findById(userId)
					.select("email role")
					.session(session);

				if (!user) {
					throw CommonErrors.userNotFound();
				}

				// Prevent deletion of admin user
				if (user.role === "admin") {
					throw createError(
						403,
						ErrorTypes.FORBIDDEN,
						"Admin accounts cannot be deleted"
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
						"UserHandler"
					);

					return reply.code(200).send({
						success: true,
						data: {
							message: "User account deleted successfully",
							email: user.email,
						},
					});
				} catch (error) {
					Logger.error(error as Error, "UserHandler");
					throw new Error("Error during deletion process");
				}
			} catch (error) {
				Logger.error(error as Error, "UserHandler");

				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("profile deletion");
				}

				throw error;
			}
		}, "UserHandler");
	}

	async changePassword(
		request: FastifyRequest<{
			Body: Static<typeof ChangePasswordBody>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			try {
				const userId = request.user!.userId;
				const { currentPassword, newPassword } = request.body;

				Logger.debug(
					`Starting password change for user: ${userId}`,
					"UserHandler"
				);

				// Get user with current password
				const user = await User.findById(userId).session(session);
				if (!user) {
					throw CommonErrors.userNotFound();
				}

				// Verify current password
				const isCurrentPasswordValid = await user.comparePassword(
					currentPassword
				);
				if (!isCurrentPasswordValid) {
					throw createError(
						401,
						ErrorTypes.INVALID_CREDENTIALS,
						"Current password is incorrect"
					);
				}

				// Check if new password is same as current
				const isSamePassword = await user.comparePassword(newPassword);
				if (isSamePassword) {
					throw createBusinessError(
						"New password must be different from current password"
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
						"UserHandler"
					);

					return reply.code(200).send({
						success: true,
						data: {
							message: "Password changed successfully",
							requiresRelogin: true,
						},
					});
				} catch (error) {
					if (error instanceof mongoose.Error.ValidationError) {
						throw createError(
							400,
							ErrorTypes.VALIDATION_ERROR,
							"Password validation failed: " +
								Object.values(error.errors)
									.map((err) => err.message)
									.join(", ")
						);
					}
					throw error;
				}
			} catch (error) {
				Logger.error(error as Error, "UserHandler");

				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("password change");
				}

				throw error;
			}
		}, "UserHandler");
	}
}
