import { FastifyInstance, FastifyRequest } from "fastify";
import { Type, Static } from "@sinclair/typebox";
import { User } from "../../models/User";
import { Card } from "../../models/Card";
import { Error } from "mongoose";

// Define request parameter types
const ParamsWithUserId = Type.Object({
	userId: Type.String(),
});

const ParamsWithUserIdAndCardId = Type.Object({
	userId: Type.String(),
	cardId: Type.String(),
});

// Define request body types
const CreateUserBody = Type.Object({
	email: Type.String({ format: "email" }),
	password: Type.String({ minLength: 8 }),
	firstName: Type.String(),
	lastName: Type.String(),
	company: Type.Optional(Type.String()),
	address: Type.Object({
		street: Type.String(),
		city: Type.String(),
		province: Type.String(),
		zipCode: Type.String(),
	}),
	phoneNumber: Type.String(),
});

const UpdateUserBody = Type.Object({
	firstName: Type.Optional(Type.String()),
	lastName: Type.Optional(Type.String()),
	company: Type.Optional(Type.String()),
	address: Type.Optional(
		Type.Object({
			street: Type.String(),
			city: Type.String(),
			province: Type.String(),
			zipCode: Type.String(),
		})
	),
	phoneNumber: Type.Optional(Type.String()),
});

const CreateCardBody = Type.Object({
	cardNumber: Type.String(),
	expirationDate: Type.String(),
	nameOnCard: Type.String(),
	isDefault: Type.Optional(Type.Boolean()),
});

// Create static types from schemas
type UserParams = Static<typeof ParamsWithUserId>;
type UserAndCardParams = Static<typeof ParamsWithUserIdAndCardId>;
type CreateUserRequest = Static<typeof CreateUserBody>;
type UpdateUserRequest = Static<typeof UpdateUserBody>;
type CreateCardRequest = Static<typeof CreateCardBody>;

export default async function userRoutes(fastify: FastifyInstance) {
	// Register user
	fastify.post(
		"/users",
		{
			schema: {
				body: CreateUserBody,
			},
		},
		async (request: FastifyRequest<{ Body: CreateUserRequest }>, reply) => {
			try {
				const userData = request.body;
				const user = new User(userData);
				await user.save();

				return {
					success: true,
					data: {
						user: {
							...user.toJSON(),
							password: undefined,
						},
					},
				};
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return { success: false, error: error.message };
			}
		}
	);

	// Get user profile
	fastify.get(
		"/users/:userId",
		{
			schema: {
				params: ParamsWithUserId,
			},
		},
		async (request: FastifyRequest<{ Params: UserParams }>, reply) => {
			try {
				const { userId } = request.params;
				const user = await User.findById(userId).select("-password");

				if (!user) {
					reply.code(404);
					return { success: false, error: "User not found" };
				}

				return { success: true, data: { user } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return { success: false, error: error.message };
			}
		}
	);

	// Update user profile
	fastify.put(
		"/users/:userId",
		{
			schema: {
				params: ParamsWithUserId,
				body: UpdateUserBody,
			},
		},
		async (
			request: FastifyRequest<{
				Params: UserParams;
				Body: UpdateUserRequest;
			}>,
			reply
		) => {
			try {
				const { userId } = request.params;
				const updateData = request.body;

				const user = await User.findByIdAndUpdate(
					userId,
					{ $set: updateData },
					{ new: true }
				).select("-password");

				if (!user) {
					reply.code(404);
					return { success: false, error: "User not found" };
				}

				return { success: true, data: { user } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return { success: false, error: error.message };
			}
		}
	);

	// Delete user account
	fastify.delete(
		"/users/:userId",
		{
			schema: {
				params: ParamsWithUserId,
			},
		},
		async (request: FastifyRequest<{ Params: UserParams }>, reply) => {
			try {
				const { userId } = request.params;

				// Start a session for transaction
				const session = await User.startSession();
				session.startTransaction();

				try {
					// Delete all user's cards first
					await Card.deleteMany({ userId }).session(session);

					// Delete the user
					const user = await User.findByIdAndDelete(userId).session(
						session
					);

					if (!user) {
						await session.abortTransaction();
						reply.code(404);
						return { success: false, error: "User not found" };
					}

					// If everything is successful, commit the transaction
					await session.commitTransaction();
					return {
						success: true,
						message:
							"User account and all associated data have been deleted successfully",
					};
				} catch (error) {
					// If anything fails, abort the transaction
					await session.abortTransaction();
					throw error;
				} finally {
					// End the session
					session.endSession();
				}
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return { success: false, error: error.message };
			}
		}
	);

	// Add card
	fastify.post(
		"/users/:userId/cards",
		{
			schema: {
				params: ParamsWithUserId,
				body: CreateCardBody,
			},
		},
		async (
			request: FastifyRequest<{
				Params: UserParams;
				Body: CreateCardRequest;
			}>,
			reply
		) => {
			try {
				const { userId } = request.params;
				const cardData = request.body;

				const user = await User.findById(userId);
				if (!user) {
					reply.code(404);
					return { success: false, error: "User not found" };
				}

				const newCard = new Card({
					...cardData,
					userId,
				});
				await newCard.save();

				return { success: true, data: { card: newCard } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return { success: false, error: error.message };
			}
		}
	);

	// Get user's cards
	fastify.get(
		"/users/:userId/cards",
		{
			schema: {
				params: ParamsWithUserId,
			},
		},
		async (request: FastifyRequest<{ Params: UserParams }>, reply) => {
			try {
				const { userId } = request.params;
				const cards = await Card.find({ userId });

				return { success: true, data: { cards } };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return { success: false, error: error.message };
			}
		}
	);

	// Delete card
	fastify.delete(
		"/users/:userId/cards/:cardId",
		{
			schema: {
				params: ParamsWithUserIdAndCardId,
			},
		},
		async (
			request: FastifyRequest<{ Params: UserAndCardParams }>,
			reply
		) => {
			try {
				const { userId, cardId } = request.params;

				const card = await Card.findOneAndDelete({
					_id: cardId,
					userId,
				});

				if (!card) {
					reply.code(404);
					return { success: false, error: "Card not found" };
				}

				return { success: true, message: "Card deleted successfully" };
			} catch (err: unknown) {
				const error = handleError(err);
				reply.code(error.code || 400);
				return { success: false, error: error.message };
			}
		}
	);
}

// Error handling interface and function (same as before)
interface ApiError {
	code?: number;
	message: string;
}

const handleError = (error: unknown): ApiError => {
	if (error instanceof Error.ValidationError) {
		return {
			code: 400,
			message: error.message,
		};
	}

	if (error instanceof Error.CastError) {
		return {
			code: 400,
			message: "Invalid ID format",
		};
	}

	if (error instanceof Error) {
		return {
			code: 500,
			message: error.message,
		};
	}

	return {
		code: 500,
		message: "An unexpected error occurred",
	};
};
