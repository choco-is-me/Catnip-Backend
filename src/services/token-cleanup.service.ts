// src/services/token-cleanup.service.ts
import { InvalidatedToken, TokenFamily } from "../models/Token";
import { Logger } from "./logger.service";

export class TokenCleanupService {
	private static instance: TokenCleanupService;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private readonly CLEANUP_INTERVAL = 12 * 60 * 60 * 1000; // Run every 12 hours

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
			Logger.info("Starting token cleanup service", "TokenCleanup");

			// Run initial cleanup
			await this.cleanup();

			// Schedule periodic cleanup
			this.cleanupInterval = setInterval(() => {
				this.cleanup().catch((error) => {
					Logger.error(error as Error, "TokenCleanup");
				});
			}, this.CLEANUP_INTERVAL);
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
			Logger.info("Token cleanup service stopped", "TokenCleanup");
		}
	}

	private async cleanup(): Promise<void> {
		const startTime = Date.now();
		Logger.debug("Starting cleanup operation", "TokenCleanup");

		try {
			// Clean expired invalidated tokens
			const tokensResult = await InvalidatedToken.deleteMany({
				expiryTime: { $lt: new Date() },
			});

			// Clean compromised token families
			const familiesResult = await TokenFamily.deleteMany({
				$or: [
					{ validUntil: { $lt: new Date() } },
					{ reuseDetected: true },
				],
			});

			const duration = Date.now() - startTime;
			Logger.info(
				`Cleanup completed in ${duration}ms. Removed ${tokensResult.deletedCount} tokens and ${familiesResult.deletedCount} families`,
				"TokenCleanup"
			);
		} catch (error) {
			Logger.error(error as Error, "TokenCleanup");
			throw error;
		}
	}
}
