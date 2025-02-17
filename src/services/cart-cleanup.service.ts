// src/services/cart-cleanup.service.ts

import mongoose from "mongoose";
import { Cart } from "../models/Cart";
import { Logger } from "./logger.service";

export class CartCleanupService {
	private static instance: CartCleanupService;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private isRunning = false;
	private currentCleanupPromise: Promise<void> | null = null;
	private shouldStop = false;

	// Time constants
	private readonly CLEANUP_INTERVAL = 12 * 60 * 60 * 1000; // Run every 12 hours
	private readonly CART_EXPIRY_DAYS = 30; // Expire carts after 30 days of inactivity
	private readonly MAX_RETRIES = 3;
	private readonly RETRY_DELAY = 1000; // 1 second
	private readonly OPERATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes timeout for cleanup operation

	private constructor() {
		// Private constructor to enforce singleton
	}

	static getInstance(): CartCleanupService {
		if (!CartCleanupService.instance) {
			CartCleanupService.instance = new CartCleanupService();
		}
		return CartCleanupService.instance;
	}

	private async retryOperation<T>(
		operation: () => Promise<T>,
		retries = this.MAX_RETRIES
	): Promise<T> {
		try {
			return await this.withTimeout(operation());
		} catch (error) {
			if (
				retries > 0 &&
				this.isRetryableError(error) &&
				!this.shouldStop
			) {
				Logger.warn(
					`Retrying operation. Attempts remaining: ${retries}`,
					"CartCleanup"
				);
				await new Promise((resolve) =>
					setTimeout(resolve, this.RETRY_DELAY)
				);
				return this.retryOperation(operation, retries - 1);
			}
			throw error;
		}
	}

	private async withTimeout<T>(promise: Promise<T>): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				setTimeout(() => {
					reject(new Error("Operation timed out"));
				}, this.OPERATION_TIMEOUT);
			}),
		]);
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
					"Cart cleanup service is already running",
					"CartCleanup"
				);
				return;
			}

			this.isRunning = true;
			this.shouldStop = false;
			Logger.info("Starting cart cleanup service", "CartCleanup");

			// Run initial cleanup
			await this.cleanup();

			// Schedule periodic cleanup
			this.cleanupInterval = setInterval(() => {
				if (!this.currentCleanupPromise && !this.shouldStop) {
					this.currentCleanupPromise = this.cleanup()
						.catch((error) => {
							Logger.error(error as Error, "CartCleanup");
						})
						.finally(() => {
							this.currentCleanupPromise = null;
						});
				} else {
					Logger.warn(
						"Skipping cleanup - previous operation still running",
						"CartCleanup"
					);
				}
			}, this.CLEANUP_INTERVAL);
		} catch (error) {
			this.isRunning = false;
			Logger.error(error as Error, "CartCleanup");
			throw error;
		}
	}

	async stop(): Promise<void> {
		this.shouldStop = true;

		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Wait for current cleanup to finish if it's running
		if (this.currentCleanupPromise) {
			try {
				await this.withTimeout(this.currentCleanupPromise);
			} catch (error) {
				Logger.warn(
					"Cleanup operation timed out during service stop",
					"CartCleanup"
				);
			}
		}

		this.isRunning = false;
		Logger.info("Cart cleanup service stopped", "CartCleanup");
	}

	private async cleanup(): Promise<void> {
		if (this.shouldStop) {
			return;
		}

		const startTime = Date.now();
		Logger.debug("Starting cart cleanup operation", "CartCleanup");

		try {
			// Remove expired carts
			const expiryDate = new Date(
				Date.now() - this.CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000
			);
			const expiredCartsResult = await this.retryOperation(() =>
				Cart.deleteMany({
					lastActive: { $lt: expiryDate },
				})
			);

			// Update prices and sync discounts for active carts
			const activeCarts = await this.retryOperation(() =>
				Cart.find({
					lastActive: { $gte: expiryDate },
					items: { $exists: true, $not: { $size: 0 } },
				})
			);

			let updatedCount = 0;
			let errorCount = 0;

			// Process each cart with timeout
			for (const cart of activeCarts) {
				if (this.shouldStop) break;

				try {
					await this.withTimeout(cart.updatePrices());
					updatedCount++;
				} catch (error) {
					errorCount++;
					Logger.error(
						new Error(
							`Failed to update cart ${cart._id}: ${error}`
						),
						"CartCleanup"
					);
				}
			}

			const duration = Date.now() - startTime;
			Logger.info(
				`Cart cleanup completed in ${duration}ms:\n` +
					`- Expired carts removed: ${expiredCartsResult.deletedCount}\n` +
					`- Active carts processed: ${activeCarts.length}\n` +
					`- Successfully updated: ${updatedCount}\n` +
					`- Failed updates: ${errorCount}`,
				"CartCleanup"
			);

			// Collect and log metrics
			if (!this.shouldStop) {
				await this.withTimeout(this.collectMetrics());
			}
		} catch (error) {
			Logger.error(error as Error, "CartCleanup");
			throw error;
		}
	}

	private async collectMetrics(): Promise<void> {
		try {
			const [totalCarts, emptyCarts, totalItems, averageItemsPerCart] =
				await Promise.all([
					Cart.countDocuments(),
					Cart.countDocuments({ items: { $size: 0 } }),
					Cart.aggregate([
						{
							$group: {
								_id: null,
								total: { $sum: "$itemCount" },
							},
						},
					]),
					Cart.aggregate([
						{ $group: { _id: null, avg: { $avg: "$itemCount" } } },
					]),
				]);

			Logger.info(
				`Cart Metrics:\n` +
					`- Total carts: ${totalCarts}\n` +
					`- Empty carts: ${emptyCarts}\n` +
					`- Total items across all carts: ${
						totalItems[0]?.total || 0
					}\n` +
					`- Average items per cart: ${
						averageItemsPerCart[0]?.avg.toFixed(2) || 0
					}`,
				"CartMetrics"
			);
		} catch (error) {
			Logger.error(error as Error, "CartMetrics");
		}
	}
}
