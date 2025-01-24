// src/utils/transaction.util.ts
import mongoose from "mongoose";
import { Logger } from "../services/logger.service";

export async function withTransaction<T>(
	operation: (session: mongoose.ClientSession) => Promise<T>,
	context: string
): Promise<T> {
	const session = await mongoose.startSession();
	session.startTransaction();

	try {
		const result = await operation(session);
		await session.commitTransaction();
		return result;
	} catch (error) {
		await session.abortTransaction();
		Logger.error(error as Error, context);
		throw error;
	} finally {
		session.endSession();
		Logger.debug("MongoDB session ended", context);
	}
}
