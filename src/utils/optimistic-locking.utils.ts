// src/utils/optimistic-locking.utils.ts

import { Document, Model } from "mongoose";
import { Logger } from "../services/logger.service";
import { createError, ErrorTypes } from "./error-handler";

export class OptimisticLockingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OptimisticLockingError";
	}
}

export class OptimisticLocking {
	private static readonly MAX_RETRIES = 3;
	private static readonly RETRY_DELAY = 100; // 100ms

	/**
	 * Executes an update operation with optimistic locking
	 * @param model Mongoose model
	 * @param id Document ID
	 * @param version Expected version
	 * @param updateFn Function to perform the update
	 * @param retries Number of retries left
	 */
	static async executeWithLock<T extends Document>(
		model: Model<T>,
		id: string,
		version: number,
		updateFn: (doc: T) => Promise<void>,
		retries = this.MAX_RETRIES
	): Promise<T> {
		try {
			// Find document with version check
			const doc = (await model.findOne({
				_id: id,
				version: version,
			})) as T;

			if (!doc) {
				throw new OptimisticLockingError("Document version mismatch");
			}

			// Perform update
			await updateFn(doc);

			try {
				// Save with version increment
				const savedDoc = await doc.save();

				Logger.debug(
					`Successfully updated document ${id} from version ${version} to ${
						version + 1
					}`,
					"OptimisticLocking"
				);

				return savedDoc;
			} catch (error: any) {
				// Check if error is due to version mismatch
				if (
					error.name === "VersionError" ||
					(error.code === 11000 && error.message.includes("version"))
				) {
					throw new OptimisticLockingError(
						"Version conflict during save"
					);
				}
				throw error;
			}
		} catch (error) {
			if (error instanceof OptimisticLockingError && retries > 0) {
				Logger.debug(
					`Version conflict detected for ${id}, retrying... (${retries} retries left)`,
					"OptimisticLocking"
				);

				// Wait before retrying
				await new Promise((resolve) =>
					setTimeout(resolve, this.RETRY_DELAY)
				);

				// Retry with one less retry attempt
				return this.executeWithLock(
					model,
					id,
					version,
					updateFn,
					retries - 1
				);
			}

			// If no more retries or different error
			if (error instanceof OptimisticLockingError) {
				Logger.warn(
					`Maximum retry attempts reached for document ${id}`,
					"OptimisticLocking"
				);
				throw createError(
					409,
					ErrorTypes.RESOURCE_CONFLICT,
					"Document was modified by another operation. Please try again."
				);
			}

			throw error;
		}
	}

	/**
	 * Validates if the provided version matches the current document version
	 */
	static async validateVersion<T extends Document>(
		model: Model<T>,
		id: string,
		expectedVersion: number
	): Promise<boolean> {
		const doc = await model.findById(id);
		if (!doc) return false;

		return (doc as any).version === expectedVersion;
	}

	/**
	 * Gets the current version of a document
	 */
	static async getCurrentVersion<T extends Document>(
		model: Model<T>,
		id: string
	): Promise<number | null> {
		const doc = await model.findById(id);
		if (!doc) return null;

		return (doc as any).version;
	}

	/**
	 * Helper method to calculate exponential backoff time for retries
	 */
	private static getBackoffTime(attempt: number): number {
		return Math.min(100 * Math.pow(2, attempt), 1000); // Max 1 second
	}
}
