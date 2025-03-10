// src/plugins/mongodb.ts
import { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { CONFIG } from '../config';
import { Logger } from '../services/logger.service';

export async function connectDB() {
    try {
        Logger.info(
            `Attempting to connect to MongoDB at ${CONFIG.MONGODB_URI.replace(
                /\/\/[^:]+:[^@]+@/,
                '//',
            )}`,
            'MongoDB',
        );

        // Add connection monitoring
        mongoose.connection.on('error', (error) => {
            Logger.error(error, 'MongoDB');
        });

        mongoose.connection.on('disconnected', () => {
            Logger.warn('MongoDB disconnected', 'MongoDB');
        });

        mongoose.connection.on('reconnected', () => {
            Logger.info('MongoDB reconnected', 'MongoDB');
        });

        // Set connection options
        await mongoose.connect(CONFIG.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            heartbeatFrequencyMS: 30000,
            writeConcern: {
                w: 'majority',
                wtimeout: 5000,
            },
            retryWrites: true,
            retryReads: true,
        });

        const { host, port, name } = mongoose.connection;
        Logger.info(
            `📦 Connected to MongoDB successfully at ${host}:${port}/${name}`,
            'MongoDB',
        );
        return true;
    } catch (error) {
        Logger.error(error as Error, 'MongoDB');

        // Special case handling for specific MongoDB errors
        if (error instanceof Error) {
            if (error.name === 'MongoServerSelectionError') {
                Logger.error(
                    new Error('Could not connect to any MongoDB servers'),
                    'MongoDB',
                );
            } else if (error.name === 'MongoNetworkError') {
                Logger.error(
                    new Error(
                        'Network error occurred while connecting to MongoDB',
                    ),
                    'MongoDB',
                );
            }
        }
        return false;
    }
}

export async function disconnectDB() {
    try {
        Logger.info('Attempting to disconnect from MongoDB', 'MongoDB');
        await mongoose.disconnect();
        Logger.info('Successfully disconnected from MongoDB', 'MongoDB');
    } catch (error) {
        Logger.error(error as Error, 'MongoDB');
    }
}

export default async function dbPlugin(fastify: FastifyInstance) {
    // Add health check decorator
    fastify.decorate('isDbConnected', () => {
        return mongoose.connection.readyState === 1;
    });

    fastify.addHook('onClose', async () => {
        Logger.info(
            'Server shutting down, closing MongoDB connection',
            'MongoDB',
        );
        await disconnectDB();
    });

    return connectDB();
}
