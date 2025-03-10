// src/services/jwt.service.ts
import crypto from 'crypto';
import { FastifyRequest } from 'fastify';
import { sign, verify } from 'jsonwebtoken';
import mongoose from 'mongoose';
import { CONFIG } from '../config';
import { IDeviceInfo, InvalidatedToken, TokenFamily } from '../models/Token';
import { withTransaction } from '../utils/transaction.utils';
import { Logger } from './logger.service';

interface TokenPayload {
    userId: string;
    type: 'access' | 'refresh';
    role: 'user' | 'admin';
    iat?: number;
    jti: string;
    sub?: string;
    familyId: string;
}

interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

interface FingerprintData {
    userAgent: string;
    platform: string;
    screenDimensions: string;
    ipAddress: string;
    timeZone: string;
    language: string;
    // Enhanced fingerprint data
    forwardedFor?: string;
    clientIp: string;
    acceptEncoding: string;
    acceptLanguage: string;
    deviceId?: string;
    // Network info
    connectionType?: string;
    isp?: string;
    // Browser capabilities
    webglRenderer?: string;
    hasLocalStorage: boolean;
    hasSessionStorage: boolean;
    colorDepth?: number;
}

class JWTService {
    private static readonly JWT_OPTIONS = {
        issuer: 'catnip-api',
        audience: 'catnip-api',
        notBefore: '0s',
    };

    private static getInvalidationPeriod(
        tokenType: 'access' | 'refresh',
    ): number {
        const baseTime =
            tokenType === 'access'
                ? this.parse(CONFIG.JWT_EXPIRES_IN)
                : this.parse(CONFIG.JWT_REFRESH_EXPIRES_IN);

        // Add a buffer period (20% of token lifetime)
        return Math.ceil(baseTime * 1.2) * 1000;
    }

    private static readonly MAX_FAMILY_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

    private static parse(duration: string): number {
        const unit = duration.slice(-1);
        const value = parseInt(duration.slice(0, -1));
        switch (unit) {
            case 'd':
                return value * 24 * 60 * 60;
            case 'h':
                return value * 60 * 60;
            case 'm':
                return value * 60;
            case 's':
                return value;
            default:
                throw new Error('Invalid duration unit');
        }
    }

    private static getHeaderValue(
        value: string | string[] | undefined,
    ): string {
        if (Array.isArray(value)) {
            return value[0] || '';
        }
        return value || '';
    }

    private static extractDeviceInfo(request: FastifyRequest): IDeviceInfo {
        const headers = request.headers;
        const userAgent = this.getHeaderValue(headers['user-agent']);

        // Extract device info from user agent
        const deviceInfo: IDeviceInfo = {
            deviceId:
                this.getHeaderValue(headers['x-device-id']) ||
                crypto.randomBytes(16).toString('hex'),
            lastActive: new Date(),
            deviceName: userAgent,
            deviceType: this.getDeviceType(userAgent),
            browserInfo: this.getBrowserInfo(userAgent),
            osInfo: this.getOSInfo(userAgent),
        };

        return deviceInfo;
    }

    private static getDeviceType(userAgent: string): string {
        if (/mobile/i.test(userAgent)) return 'mobile';
        if (/tablet/i.test(userAgent)) return 'tablet';
        if (/ipad/i.test(userAgent)) return 'tablet';
        return 'desktop';
    }

    private static getBrowserInfo(userAgent: string): string {
        const browserRegexes = [
            /chrome\/([0-9.]+)/i,
            /firefox\/([0-9.]+)/i,
            /safari\/([0-9.]+)/i,
            /edge\/([0-9.]+)/i,
            /opera\/([0-9.]+)/i,
        ];

        for (const regex of browserRegexes) {
            const match = userAgent.match(regex);
            if (match) return match[0];
        }

        return 'unknown';
    }

    private static getOSInfo(userAgent: string): string {
        const osRegexes = [
            /windows nt ([0-9.]+)/i,
            /mac os x ([0-9._]+)/i,
            /android ([0-9.]+)/i,
            /ios ([0-9._]+)/i,
            /linux/i,
        ];

        for (const regex of osRegexes) {
            const match = userAgent.match(regex);
            if (match) return match[0];
        }

        return 'unknown';
    }

    private static generateFingerprint(
        request: FastifyRequest,
    ): FingerprintData {
        const headers = request.headers;
        return {
            // Basic info
            userAgent: this.getHeaderValue(headers['user-agent']),
            platform: this.getHeaderValue(headers['x-platform']),
            screenDimensions: this.getHeaderValue(
                headers['x-screen-dimensions'],
            ),
            ipAddress: request.ip,
            timeZone: this.getHeaderValue(headers['x-timezone']),
            language: this.getHeaderValue(headers['accept-language']),

            // Enhanced network info
            forwardedFor: this.getHeaderValue(headers['x-forwarded-for']),
            clientIp: request.ip,
            acceptEncoding: this.getHeaderValue(headers['accept-encoding']),
            acceptLanguage: this.getHeaderValue(headers['accept-language']),
            deviceId: this.getHeaderValue(headers['x-device-id']),
            connectionType: this.getHeaderValue(headers['x-connection-type']),
            isp: this.getHeaderValue(headers['x-isp']),

            // Browser capabilities
            webglRenderer: this.getHeaderValue(headers['x-webgl-renderer']),
            hasLocalStorage:
                this.getHeaderValue(headers['x-has-local-storage']) === 'true',
            hasSessionStorage:
                this.getHeaderValue(headers['x-has-session-storage']) ===
                'true',
            colorDepth:
                parseInt(this.getHeaderValue(headers['x-color-depth'])) ||
                undefined,
        };
    }

    private static hashFingerprint(data: FingerprintData): string {
        const fingerprintStr = Object.values(data)
            .filter((value) => value !== undefined)
            .join('|');
        return crypto.createHash('sha256').update(fingerprintStr).digest('hex');
    }

    private static async validateTokenFamily(family: any): Promise<void> {
        if (Date.now() - family.createdAt.getTime() > this.MAX_FAMILY_AGE) {
            await TokenFamily.deleteOne({ familyId: family.familyId });
            throw new Error('TOKEN_FAMILY_EXPIRED');
        }

        const recentRotations = await TokenFamily.countDocuments({
            familyId: family.familyId,
            lastRotation: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
        });

        if (recentRotations > 10) {
            await TokenFamily.updateOne(
                { familyId: family.familyId },
                { reuseDetected: true },
            );
            throw new Error('SUSPICIOUS_ROTATION_ACTIVITY');
        }
    }

    private static async validateFingerprint(
        storedHash: string | undefined,
        currentRequest: FastifyRequest,
    ): Promise<boolean> {
        if (!storedHash) return false;

        const currentFingerprint = this.generateFingerprint(currentRequest);
        const currentHash = this.hashFingerprint(currentFingerprint);

        return storedHash === currentHash;
    }

    static validateSecrets() {
        if (!this.validateSecretStrength(CONFIG.JWT_SECRET)) {
            throw new Error(
                'JWT_SECRET must be at least 32 characters and contain mixed characters',
            );
        }
        if (!this.validateSecretStrength(CONFIG.JWT_REFRESH_SECRET)) {
            throw new Error(
                'JWT_REFRESH_SECRET must be at least 32 characters and contain mixed characters',
            );
        }
    }

    private static validateSecretStrength(secret: string): boolean {
        return secret.length >= 64 && /^[0-9a-f]{64,}$/i.test(secret);
    }

    static async invalidateToken(
        jti: string,
        tokenType: 'access' | 'refresh',
        familyId?: string,
        isLogout: boolean = false,
    ): Promise<void> {
        return withTransaction(async (session) => {
            const invalidationPeriod = this.getInvalidationPeriod(tokenType);
            const expiryTime = new Date(Date.now() + invalidationPeriod);

            await InvalidatedToken.create(
                [
                    {
                        jti,
                        expiryTime,
                        tokenType,
                        familyId,
                    },
                ],
                { session },
            );

            if (tokenType === 'refresh' && !isLogout && familyId) {
                await this.checkAndCleanupFamily(familyId, session);
            }

            Logger.debug(`Token invalidated: ${jti}`, 'JWTService');
        }, 'JWTService');
    }

    private static async isTokenInvalidated(jti: string): Promise<boolean> {
        const invalidatedToken = await InvalidatedToken.findOne({
            jti,
            expiryTime: { $gt: new Date() },
        });

        return !!invalidatedToken;
    }

    static async verifyToken(
        token: string,
        isRefresh = false,
    ): Promise<TokenPayload & { jti: string }> {
        return withTransaction(async (session) => {
            if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
                throw new Error('JWT_SECRETS_NOT_CONFIGURED');
            }

            const secret = isRefresh
                ? CONFIG.JWT_REFRESH_SECRET
                : CONFIG.JWT_SECRET;
            const decoded = verify(token, secret, {
                algorithms: ['HS256'],
                issuer: this.JWT_OPTIONS.issuer,
                audience: this.JWT_OPTIONS.audience,
                complete: true,
            }) as any;

            const payload = decoded.payload as TokenPayload & { jti: string };

            if (!payload.sub || payload.sub !== payload.userId) {
                throw new Error('INVALID_TOKEN_SUBJECT');
            }

            if (
                (isRefresh && payload.type !== 'refresh') ||
                (!isRefresh && payload.type !== 'access')
            ) {
                throw new Error('INVALID_TOKEN_TYPE');
            }

            if (await this.isTokenInvalidated(payload.jti)) {
                throw new Error('TOKEN_INVALIDATED');
            }

            if (isRefresh && payload.familyId) {
                const family = await TokenFamily.findOne({
                    familyId: payload.familyId,
                }).session(session);
                if (!family) throw new Error('INVALID_TOKEN_FAMILY');
                if (family.reuseDetected)
                    throw new Error('TOKEN_FAMILY_COMPROMISED');
                if (family.validUntil < new Date())
                    throw new Error('TOKEN_FAMILY_EXPIRED');

                await this.validateTokenFamily(family);
            }

            return payload;
        }, 'JWTService');
    }

    private static async checkAndCleanupFamily(
        familyId: string,
        session: mongoose.ClientSession,
    ): Promise<void> {
        const family = await TokenFamily.findOne({ familyId }).session(session);
        if (!family) return;

        // Check for suspicious activity
        const recentInvalidations = await InvalidatedToken.countDocuments({
            familyId,
            createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
        }).session(session);

        if (recentInvalidations > 5) {
            await TokenFamily.updateOne(
                { familyId },
                { reuseDetected: true },
            ).session(session);

            throw new Error('TOKEN_FAMILY_COMPROMISED');
        }
    }

    private static async createTokenFamily(
        fingerprintHash: string,
        userId: string,
        request: FastifyRequest,
    ): Promise<string> {
        const familyId = crypto.randomBytes(32).toString('hex');
        const now = new Date();
        const validUntil = new Date(now.getTime() + this.MAX_FAMILY_AGE);

        const deviceInfo = this.extractDeviceInfo(request);

        await TokenFamily.create({
            familyId,
            userId,
            fingerprint: fingerprintHash,
            validUntil,
            lastRotation: now,
            reuseDetected: false,
            deviceInfo,
        });

        return familyId;
    }

    static async generateTokens(
        userId: string,
        role: 'user' | 'admin',
        request: FastifyRequest,
    ): Promise<TokenPair> {
        try {
            if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
                throw new Error('JWT secrets not configured properly');
            }

            const accessJti = crypto.randomBytes(32).toString('hex');
            const refreshJti = crypto.randomBytes(32).toString('hex');
            const now = Math.floor(Date.now() / 1000);

            const fingerprint = this.generateFingerprint(request);
            const fingerprintHash = this.hashFingerprint(fingerprint);

            const familyId = await this.createTokenFamily(
                fingerprintHash,
                userId,
                request,
            );

            Logger.debug(`Generating tokens for user: ${userId}`, 'JWTService');

            const accessToken = sign(
                {
                    userId,
                    type: 'access',
                    role,
                    iat: now,
                    familyId,
                },
                CONFIG.JWT_SECRET,
                {
                    ...this.JWT_OPTIONS,
                    expiresIn: CONFIG.JWT_EXPIRES_IN,
                    algorithm: 'HS256',
                    jwtid: accessJti,
                    subject: userId,
                },
            );

            const refreshToken = sign(
                {
                    userId,
                    type: 'refresh',
                    role,
                    iat: now,
                    familyId,
                },
                CONFIG.JWT_REFRESH_SECRET,
                {
                    ...this.JWT_OPTIONS,
                    expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN,
                    algorithm: 'HS256',
                    jwtid: refreshJti,
                    subject: userId,
                },
            );

            return { accessToken, refreshToken };
        } catch (error) {
            Logger.error(error as Error, 'JWTService');
            throw error;
        }
    }

    static async rotateTokens(
        refreshToken: string,
        request: FastifyRequest,
    ): Promise<TokenPair> {
        return withTransaction(async (session) => {
            const decoded = await this.verifyToken(refreshToken, true);

            const family = await TokenFamily.findOneAndUpdate(
                { familyId: decoded.familyId },
                {
                    lastRotation: new Date(),
                    $set: { 'deviceInfo.lastActive': new Date() },
                },
                { session, new: true },
            );

            if (!family) {
                throw new Error('INVALID_TOKEN_FAMILY');
            }

            if (
                !(await this.validateFingerprint(family.fingerprint, request))
            ) {
                await TokenFamily.updateOne(
                    { familyId: decoded.familyId },
                    { reuseDetected: true },
                ).session(session);
                throw new Error('TOKEN_FINGERPRINT_MISMATCH');
            }

            await this.invalidateToken(
                decoded.jti,
                'refresh',
                decoded.familyId,
            );
            return this.generateTokens(decoded.userId, decoded.role, request);
        }, 'JWTService');
    }
}

JWTService.validateSecrets();

export default JWTService;
