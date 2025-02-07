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
	createBusinessError,
	createError,
	createSecurityError,
	ErrorTypes,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";

export class UserHandler {
	async getProfile(
		request: FastifyRequest<{ Params: Static<typeof ParamsWithUserId> }>,
		reply: FastifyReply
	) {
		const { userId } = request.params;
		Logger.debug(`Fetching profile for user: ${userId}`, "ProfileHandler");

		if (!mongoose.Types.ObjectId.isValid(userId)) {
			throw createError(
				400,
				ErrorTypes.INVALID_FORMAT,
				"Invalid user ID format"
			);
		}

		try {
			const user = await User.findById(userId).select("-password").lean();
			if (!user) {
				throw createError(404, ErrorTypes.NOT_FOUND, "User not found");
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
			throw createError(
				500,
				ErrorTypes.DATABASE_ERROR,
				"Error retrieving user profile"
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
			const { userId } = request.params;
			Logger.debug(
				`Starting profile update for user: ${userId}`,
				"ProfileHandler"
			);

			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw createError(
					400,
					ErrorTypes.INVALID_FORMAT,
					"Invalid user ID format"
				);
			}

			const updateFields = Object.keys(request.body);
			if (updateFields.length === 0) {
				throw createBusinessError("No fields provided for update");
			}

			// Remove email check since email updates are not allowed
			const updatedUser = await User.findByIdAndUpdate(
				userId,
				{ $set: request.body },
				{ new: true, session, select: "-password", runValidators: true }
			);

			if (!updatedUser) {
				throw createError(404, ErrorTypes.NOT_FOUND, "User not found");
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
		}, "ProfileHandler");
	}

	async deleteProfile(
		request: FastifyRequest<{ Params: Static<typeof ParamsWithUserId> }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { userId } = request.params;
			Logger.debug(
				`Starting profile deletion for user: ${userId}`,
				"ProfileHandler"
			);

			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw createError(
					400,
					ErrorTypes.INVALID_FORMAT,
					"Invalid user ID format"
				);
			}

			const user = await User.findById(userId)
				.select("email")
				.session(session);
			if (!user) {
				throw createError(404, ErrorTypes.NOT_FOUND, "User not found");
			}

			const hasActiveSubscriptions = false;
			if (hasActiveSubscriptions) {
				throw createSecurityError(
					"Cannot delete profile with active subscriptions"
				);
			}

			try {
				await Card.deleteMany({ userId }).session(session);
				const deleteResult = await User.findByIdAndDelete(
					userId
				).session(session);

				if (!deleteResult) {
					throw createError(
						404,
						ErrorTypes.NOT_FOUND,
						"User not found during deletion"
					);
				}

				Logger.info(
					`User profile deleted: ${userId}`,
					"ProfileHandler"
				);
				return reply.code(200).send({
					success: true,
					data: { message: "User account deleted successfully" },
				});
			} catch (error) {
				throw createError(
					500,
					ErrorTypes.DATABASE_ERROR,
					"Error during profile deletion"
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
			const { userId } = request.params;
			const { newPassword } = request.body;

			Logger.debug(
				`Starting password change for user: ${userId}`,
				"ProfileHandler"
			);

			if (!mongoose.Types.ObjectId.isValid(userId)) {
				throw createError(
					400,
					ErrorTypes.INVALID_FORMAT,
					"Invalid user ID format"
				);
			}

			const user = await User.findById(userId).session(session);
			if (!user) {
				throw createError(404, ErrorTypes.NOT_FOUND, "User not found");
			}

			try {
				user.password = newPassword;
				await user.save({ session });

				await TokenFamily.updateMany(
					{ familyId: { $exists: true } },
					{ reuseDetected: true }
				).session(session);

				Logger.info(
					`Password changed for user: ${userId}`,
					"ProfileHandler"
				);
				return reply.code(200).send({
					success: true,
					data: { message: "Password changed successfully" },
				});
			} catch (error) {
				throw createError(
					500,
					ErrorTypes.DATABASE_ERROR,
					"Error changing password"
				);
			}
		}, "ProfileHandler");
	}
}
