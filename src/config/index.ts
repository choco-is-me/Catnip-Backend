// src/config/index.ts
import { Static, Type } from '@sinclair/typebox';
import * as dotenv from 'dotenv';
dotenv.config();

const ConfigSchema = Type.Object({
    NODE_ENV: Type.Union([
        Type.Literal('development'),
        Type.Literal('production'),
        Type.Literal('test'),
    ]),
    ENABLE_SECURITY_HEADERS: Type.Optional(Type.Boolean()),
    LOG_LEVEL: Type.Union([
        Type.Literal('info'),
        Type.Literal('error'),
        Type.Literal('warn'),
        Type.Literal('debug'),
        Type.Literal('silent'),
    ]),
    LOG_REQUESTS: Type.Optional(Type.Boolean()),
    PORT: Type.Number(),
    HOST: Type.String(),
    MONGODB_URI: Type.String(),
    CLOUDINARY_CLOUD_NAME: Type.String(),
    CLOUDINARY_API_KEY: Type.String(),
    CLOUDINARY_API_SECRET: Type.String(),
    COOKIE_SECRET: Type.String(),
    COOKIE_DOMAIN: Type.Optional(Type.String()),
    COOKIE_SECURE: Type.Optional(Type.Boolean()),
    COOKIE_MAX_AGE: Type.Optional(Type.Number()),
    JWT_SECRET: Type.String(),
    JWT_EXPIRES_IN: Type.String(),
    JWT_REFRESH_SECRET: Type.String(),
    JWT_REFRESH_EXPIRES_IN: Type.String(),
    CORS_ORIGIN: Type.String(),
    UPLOAD_DIR: Type.String(),
    ENCRYPTION_KEY: Type.String(),
    ENCRYPTION_IV: Type.String(),
    ADMIN_EMAIL: Type.String({
        format: 'email',
        description: 'Default admin user email',
    }),
    ADMIN_PASSWORD: Type.String({
        minLength: 8,
        description: 'Default admin user password',
    }),
});

// Validate required environment variables
const requiredEnvVars = [
    'MONGODB_URI',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'COOKIE_SECRET',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
    'ENCRYPTION_IV',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
] as const;

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

// Validate encryption key and IV lengths
if (process.env.ENCRYPTION_KEY!.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
}

if (process.env.ENCRYPTION_IV!.length !== 16) {
    throw new Error('ENCRYPTION_IV must be exactly 16 characters long');
}

export type Config = Static<typeof ConfigSchema>;

export const CONFIG: Config = {
    NODE_ENV: (process.env.NODE_ENV as Config['NODE_ENV']) || 'development',
    ENABLE_SECURITY_HEADERS: process.env.NODE_ENV === 'production',
    PORT: parseInt(process.env.PORT || '3000', 10),
    HOST: process.env.HOST || '0.0.0.0',
    MONGODB_URI: process.env.MONGODB_URI!,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME!,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY!,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET!,
    COOKIE_SECRET: process.env.COOKIE_SECRET!,
    COOKIE_DOMAIN:
        process.env.NODE_ENV === 'production'
            ? process.env.COOKIE_DOMAIN
            : 'localhost',
    COOKIE_SECURE: process.env.NODE_ENV === 'production',
    COOKIE_MAX_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    JWT_SECRET: process.env.JWT_SECRET!,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '10s',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    LOG_LEVEL: (process.env.LOG_LEVEL as Config['LOG_LEVEL']) || 'info',
    LOG_REQUESTS: process.env.LOG_REQUESTS === 'true',
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
    UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
    ENCRYPTION_IV: process.env.ENCRYPTION_IV!,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL!,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD!,
};
