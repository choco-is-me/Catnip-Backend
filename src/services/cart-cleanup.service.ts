// src/services/cart-cleanup.service.ts
import { Cart } from '../models/Cart';
import { Logger } from './logger.service';

export class CartCleanupService {
    private static instance: CartCleanupService;
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Run every 24 hours
    private readonly METRICS_INTERVAL = 24 * 60 * 60 * 1000; // Daily metrics
    private metricsInterval: NodeJS.Timeout | null = null;
    private isRunning = false;

    private constructor() {
        // Private constructor to enforce singleton
    }

    static getInstance(): CartCleanupService {
        if (!CartCleanupService.instance) {
            CartCleanupService.instance = new CartCleanupService();
        }
        return CartCleanupService.instance;
    }

    async start(): Promise<void> {
        try {
            if (this.isRunning) {
                Logger.warn(
                    'Cart cleanup service is already running',
                    'CartCleanup',
                );
                return;
            }

            this.isRunning = true;
            Logger.info('Starting cart cleanup service', 'CartCleanup');

            // Run initial cleanup
            await this.cleanup();

            // Schedule periodic cleanup
            this.cleanupInterval = setInterval(() => {
                this.cleanup().catch((error) => {
                    Logger.error(error as Error, 'CartCleanup');
                });
            }, this.CLEANUP_INTERVAL);

            // Schedule metrics collection
            this.metricsInterval = setInterval(() => {
                this.collectMetrics().catch((error) => {
                    Logger.error(error as Error, 'CartCleanup');
                });
            }, this.METRICS_INTERVAL);
        } catch (error) {
            this.isRunning = false;
            Logger.error(error as Error, 'CartCleanup');
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
        Logger.info('Cart cleanup service stopped', 'CartCleanup');
    }

    private async cleanup(): Promise<void> {
        const startTime = Date.now();
        Logger.debug('Starting cart cleanup operation', 'CartCleanup');

        try {
            // Clean expired carts
            // Note: If you've set TTL index on expires field in Cart.ts, MongoDB will auto-delete expired carts
            // But we still do it explicitly here for metrics and better control
            const expiredCartsResult = await Cart.deleteMany({
                expires: { $lt: new Date() },
            });

            // Clean empty carts older than 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const emptyCartsResult = await Cart.deleteMany({
                'items.0': { $exists: false },
                updatedAt: { $lt: thirtyDaysAgo },
            });

            const duration = Date.now() - startTime;
            Logger.info(
                `Cart cleanup completed in ${duration}ms. Results:\n` +
                    `- Expired carts removed: ${expiredCartsResult.deletedCount}\n` +
                    `- Empty old carts removed: ${emptyCartsResult.deletedCount}`,
                'CartCleanup',
            );
        } catch (error) {
            Logger.error(error as Error, 'CartCleanup');
            throw error;
        }
    }

    private async collectMetrics(): Promise<void> {
        try {
            const totalCarts = await Cart.countDocuments();
            const expiredCarts = await Cart.countDocuments({
                expires: { $lt: new Date() },
            });
            const emptyCarts = await Cart.countDocuments({
                'items.0': { $exists: false },
            });
            const activeCarts = await Cart.countDocuments({
                'items.0': { $exists: true },
                expires: { $gt: new Date() },
            });

            Logger.info(
                `Cart Metrics:\n` +
                    `- Total carts: ${totalCarts}\n` +
                    `- Active carts with items: ${activeCarts}\n` +
                    `- Empty carts: ${emptyCarts}\n` +
                    `- Expired carts pending cleanup: ${expiredCarts}`,
                'CartMetrics',
            );
        } catch (error) {
            Logger.error(error as Error, 'CartMetrics');
        }
    }
}
