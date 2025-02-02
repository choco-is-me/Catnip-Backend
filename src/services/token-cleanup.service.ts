// src/services/token-cleanup.service.ts
import { InvalidatedToken, TokenFamily } from "../models/Token";
import { Logger } from "./logger.service";
import mongoose from "mongoose";

export class TokenCleanupService {
	private static instance: TokenCleanupService;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private readonly CLEANUP_INTERVAL = 12 * 60 * 60 * 1000; // Run every 12 hours
	private readonly METRICS_INTERVAL = 24 * 60 * 60 * 1000; // Daily metrics
	private metricsInterval: NodeJS.Timeout | null = null;
	private isRunning = false;
	private readonly MAX_RETRIES = 3;
	private readonly RETRY_DELAY = 1000; // 1 second

	private constructor() {
		// Private constructor to enforce singleton
	}

	static getInstance(): TokenCleanupService {
		if (!TokenCleanupService.instance) {
			TokenCleanupService.instance = new TokenCleanupService();
		}
		return TokenCleanupService.instance;
	}

	private async retryOperation<T>(
		operation: () => Promise<T>,
		retries = this.MAX_RETRIES
	): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (retries > 0 && this.isRetryableError(error)) {
				Logger.warn(
					`Retrying operation. Attempts remaining: ${retries}`,
					"TokenCleanup"
				);
				await new Promise((resolve) =>
					setTimeout(resolve, this.RETRY_DELAY)
				);
				return this.retryOperation(operation, retries - 1);
			}
			throw error;
		}
	}

	private isRetryableError(error: any): boolean {
		return (
			error instanceof mongoose.Error ||
			error.name === "MongoError" ||
			error.message.includes("please retry the operation")
		);
	}

	async start(): Promise<void> {
		try {
			if (this.isRunning) {
				Logger.warn(
					"Token cleanup service is already running",
					"TokenCleanup"
				);
				return;
			}

			this.isRunning = true;
			Logger.info("Starting token cleanup service", "TokenCleanup");

			// Run initial cleanup
			await this.cleanup();

			// Schedule periodic cleanup
			this.cleanupInterval = setInterval(() => {
				this.cleanup().catch((error) => {
					Logger.error(error as Error, "TokenCleanup");
				});
			}, this.CLEANUP_INTERVAL);

			// Schedule metrics collection
			this.metricsInterval = setInterval(() => {
				this.collectMetrics().catch((error) => {
					Logger.error(error as Error, "TokenCleanup");
				});
			}, this.METRICS_INTERVAL);
		} catch (error) {
			this.isRunning = false;
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		if (this.metricsInterval) {
			clearInterval(this.metricsInterval);
			this.metricsInterval = null;
		}
		this.isRunning = false;
		Logger.info("Token cleanup service stopped", "TokenCleanup");
	}

	private async cleanup(): Promise<void> {
		const startTime = Date.now();
		Logger.debug("Starting cleanup operation", "TokenCleanup");

		try {
			// Clean expired invalidated tokens
			const expiredTokensResult = await this.retryOperation(() =>
				InvalidatedToken.deleteMany({
					expiryTime: { $lt: new Date() },
				})
			);

			// Clean expired token families
			const expiredFamiliesResult = await this.retryOperation(() =>
				TokenFamily.deleteMany({
					validUntil: { $lt: new Date() },
				})
			);

			// Clean compromised token families
			const compromisedResult = await this.cleanupCompromisedSessions();

			// Clean orphaned tokens
			const orphanedResult = await this.cleanupOrphanedTokens();

			// Clean inactive families
			const inactiveFamiliesResult = await this.cleanupInactiveFamilies();

			const duration = Date.now() - startTime;
			Logger.info(
				`Cleanup completed in ${duration}ms. Results:\n` +
					`- Expired tokens removed: ${expiredTokensResult.deletedCount}\n` +
					`- Expired families removed: ${expiredFamiliesResult.deletedCount}\n` +
					`- Compromised families cleaned: ${compromisedResult}\n` +
					`- Orphaned tokens removed: ${orphanedResult}\n` +
					`- Inactive families removed: ${inactiveFamiliesResult}`,
				"TokenCleanup"
			);
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	private async cleanupCompromisedSessions(): Promise<number> {
		try {
			const compromisedFamilies = await this.retryOperation(() =>
				TokenFamily.find({
					reuseDetected: true,
				})
			);

			for (const family of compromisedFamilies) {
				await this.retryOperation(() =>
					InvalidatedToken.create([
						{
							jti: family.familyId,
							expiryTime: new Date(
								Date.now() + 7 * 24 * 60 * 60 * 1000
							),
							tokenType: "refresh",
							familyId: family.familyId,
						},
					])
				);
			}

			const deleteResult = await this.retryOperation(() =>
				TokenFamily.deleteMany({
					familyId: {
						$in: compromisedFamilies.map((f) => f.familyId),
					},
				})
			);

			return deleteResult.deletedCount;
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	private async cleanupOrphanedTokens(): Promise<number> {
		try {
			const validFamilyIds = await TokenFamily.distinct("familyId");

			const result = await this.retryOperation(() =>
				InvalidatedToken.deleteMany({
					familyId: {
						$exists: true,
						$nin: validFamilyIds,
					},
				})
			);

			return result.deletedCount;
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	private async cleanupInactiveFamilies(): Promise<number> {
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		try {
			const result = await this.retryOperation(() =>
				TokenFamily.deleteMany({
					"deviceInfo.lastActive": { $lt: thirtyDaysAgo },
					reuseDetected: false,
				})
			);

			return result.deletedCount;
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	private async collectMetrics(): Promise<void> {
		try {
			const totalTokenFamilies = await TokenFamily.countDocuments();
			const compromisedFamilies = await TokenFamily.countDocuments({
				reuseDetected: true,
			});
			const totalInvalidatedTokens =
				await InvalidatedToken.countDocuments();
			const expiredTokens = await InvalidatedToken.countDocuments({
				expiryTime: { $lt: new Date() },
			});

			Logger.info(
				`Token Metrics:\n` +
					`- Total token families: ${totalTokenFamilies}\n` +
					`- Compromised families: ${compromisedFamilies}\n` +
					`- Total invalidated tokens: ${totalInvalidatedTokens}\n` +
					`- Expired tokens pending cleanup: ${expiredTokens}`,
				"TokenMetrics"
			);
		} catch (error) {
			Logger.error(error as Error, "TokenMetrics");
		}
	}
}
