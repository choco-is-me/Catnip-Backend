// src/routes/v1/users/handlers/profile.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Card } from "../../../../models/Card";
import { User } from "../../../../models/User";
import { ParamsWithUserId, UpdateUserBody } from "../../../../schemas";
import { Logger } from "../../../../services/logger.service";
import { CommonErrors, sendError } from "../../../../utils/error-handler";

export class ProfileHandler {
	async getProfile(
		request: FastifyRequest<{ Params: Static<typeof ParamsWithUserId> }>,
		reply: FastifyReply
	) {
		try {
			const { userId } = request.params;
			Logger.debug(`Fetching profile for user: ${userId}`, "GetProfile");

			const user = await User.findById(userId).select("-password").lean();

			if (!user) {
				Logger.warn(`User not found: ${userId}`, "GetProfile");
				return sendError(reply, CommonErrors.userNotFound());
			}

			Logger.info(
				`Profile retrieved successfully for user: ${userId}`,
				"GetProfile"
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
			Logger.error(error as Error, "GetProfile");
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
			Logger.debug(
				`Attempting to update profile for user: ${request.params.userId}`,
				"UpdateProfile"
			);

			const user = await User.findByIdAndUpdate(
				request.params.userId,
				{ $set: request.body },
				{ new: true, session }
			).select("-password");

			if (!user) {
				await session.abortTransaction();
				Logger.warn(
					`User not found: ${request.params.userId}`,
					"UpdateProfile"
				);
				return sendError(reply, CommonErrors.userNotFound());
			}

			await session.commitTransaction();
			Logger.info(
				`Profile updated successfully for user: ${user._id}`,
				"UpdateProfile"
			);

			return reply.code(200).send({
				success: true,
				data: {
					user: {
						...user.toObject(),
						createdAt: user.createdAt.toISOString(),
						updatedAt: user.updatedAt.toISOString(),
					},
				},
			});
		} catch (error) {
			await session.abortTransaction();
			Logger.error(error as Error, "UpdateProfile");
			return sendError(reply, error as Error);
		} finally {
			session.endSession();
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
				`Attempting to delete user profile: ${userId}`,
				"DeleteProfile"
			);

			// First check if user exists
			const user = await User.findById(userId).session(session);
			if (!user) {
				await session.abortTransaction();
				Logger.warn(
					`Attempt to delete non-existent user: ${userId}`,
					"DeleteProfile"
				);
				return sendError(reply, CommonErrors.userNotFound());
			}

			// Delete associated data
			Logger.debug(
				`Deleting associated cards for user: ${userId}`,
				"DeleteProfile"
			);
			const cardsDeleteResult = await Card.deleteMany({ userId }).session(
				session
			);
			Logger.debug(
				`Deleted ${cardsDeleteResult.deletedCount} cards for user: ${userId}`,
				"DeleteProfile"
			);

			// Delete user
			await User.findByIdAndDelete(userId).session(session);

			await session.commitTransaction();
			Logger.info(
				`User profile and associated data deleted successfully: ${userId}`,
				"DeleteProfile"
			);

			return reply.code(200).send({
				success: true,
				data: {
					message: "User account deleted successfully",
				},
			});
		} catch (error) {
			await session.abortTransaction();
			Logger.error(error as Error, "DeleteProfile");
			return sendError(reply, error as Error);
		} finally {
			session.endSession();
		}
	}
}
