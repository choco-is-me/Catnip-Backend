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

	private constructor() {
		// Private constructor to enforce singleton
	}

	static getInstance(): TokenCleanupService {
		if (!TokenCleanupService.instance) {
			TokenCleanupService.instance = new TokenCleanupService();
		}
		return TokenCleanupService.instance;
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
		const session = await mongoose.startSession();
		session.startTransaction();

		const startTime = Date.now();
		Logger.debug("Starting cleanup operation", "TokenCleanup");

		try {
			// Clean expired invalidated tokens
			const expiredTokensResult = await InvalidatedToken.deleteMany({
				expiryTime: { $lt: new Date() },
			}).session(session);

			// Clean expired token families
			const expiredFamiliesResult = await TokenFamily.deleteMany({
				validUntil: { $lt: new Date() },
			}).session(session);

			// Clean compromised token families
			const compromisedResult = await this.cleanupCompromisedSessions(
				session
			);

			// Clean orphaned tokens (where family no longer exists)
			const orphanedResult = await this.cleanupOrphanedTokens(session);

			// Clean inactive families (no activity in 30 days)
			const inactiveFamiliesResult = await this.cleanupInactiveFamilies(
				session
			);

			await session.commitTransaction();

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
			await session.abortTransaction();
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		} finally {
			session.endSession();
		}
	}

	private async cleanupCompromisedSessions(
		session: mongoose.ClientSession
	): Promise<number> {
		try {
			// Find all compromised families
			const compromisedFamilies = await TokenFamily.find({
				reuseDetected: true,
			}).session(session);

			// Invalidate all related tokens
			for (const family of compromisedFamilies) {
				await InvalidatedToken.create(
					[
						{
							jti: family.familyId,
							expiryTime: new Date(
								Date.now() + 7 * 24 * 60 * 60 * 1000
							), // 7 days
							tokenType: "refresh",
							familyId: family.familyId,
						},
					],
					{ session }
				);
			}

			// Delete compromised families
			const deleteResult = await TokenFamily.deleteMany({
				familyId: { $in: compromisedFamilies.map((f) => f.familyId) },
			}).session(session);

			return deleteResult.deletedCount;
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	private async cleanupOrphanedTokens(
		session: mongoose.ClientSession
	): Promise<number> {
		try {
			// First get all valid family IDs
			const validFamilyIds = await TokenFamily.distinct(
				"familyId"
			).session(session);

			// Delete tokens where familyId exists but isn't in the valid list
			const result = await InvalidatedToken.deleteMany({
				familyId: {
					$exists: true,
					$nin: validFamilyIds,
				},
			}).session(session);

			return result.deletedCount;
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	private async cleanupInactiveFamilies(
		session: mongoose.ClientSession
	): Promise<number> {
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		try {
			const result = await TokenFamily.deleteMany({
				"deviceInfo.lastActive": { $lt: thirtyDaysAgo },
				reuseDetected: false,
			}).session(session);

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
