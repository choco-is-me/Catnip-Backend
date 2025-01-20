// src/services/jwt.service.ts
import crypto from "crypto";
import { FastifyRequest } from "fastify";
import { sign, verify } from "jsonwebtoken";
import { CONFIG } from "../config";
import { Logger } from "./logger.service";

interface TokenPayload {
	userId: string;
	type: "access" | "refresh";
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
}

interface TokenFamily {
	familyId: string;
	validUntil: number;
	reuseDetected: boolean;
	lastRotation: number;
	fingerprint?: string; // Hashed fingerprint
}

class JWTService {
	private static invalidatedTokens = new Map<string, number>();
	private static tokenFamilies = new Map<string, TokenFamily>();

	private static readonly JWT_OPTIONS = {
		issuer: "catnip-api",
		audience: "catnip-api",
		notBefore: "0s",
	};

	private static readonly MAX_REFRESH_TOKEN_AGE = JWTService.parse(
		CONFIG.JWT_REFRESH_EXPIRES_IN
	);

	private static parse(duration: string): number {
		const unit = duration.slice(-1);
		const value = parseInt(duration.slice(0, -1));
		switch (unit) {
			case "d":
				return value * 24 * 60 * 60;
			case "h":
				return value * 60 * 60;
			case "m":
				return value * 60;
			case "s":
				return value;
			default:
				throw new Error("Invalid duration unit");
		}
	}

	private static readonly CLEANUP_INTERVAL = 1 * 60 * 60 * 1000; // Run cleanup every hour

	static {
		setInterval(() => {
			this.cleanupUsedTokens();
			this.cleanupTokenFamilies();
		}, this.CLEANUP_INTERVAL);
	}

	/**Fingerprinting Token */
	private static getHeaderValue(
		value: string | string[] | undefined
	): string {
		if (Array.isArray(value)) {
			return value[0] || "";
		}
		return value || "";
	}

	private static generateFingerprint(
		request: FastifyRequest
	): FingerprintData {
		const headers = request.headers;

		return {
			userAgent: this.getHeaderValue(headers["user-agent"]),
			platform: this.getHeaderValue(headers["x-platform"]), // Custom header from React Native
			screenDimensions: this.getHeaderValue(
				headers["x-screen-dimensions"]
			), // Custom header
			ipAddress: request.ip,
			timeZone: this.getHeaderValue(headers["x-timezone"]), // Custom header
			language: this.getHeaderValue(headers["accept-language"]),
		};
	}

	private static hashFingerprint(data: FingerprintData): string {
		const fingerprintStr = Object.values(data).join("|");
		return crypto.createHash("sha256").update(fingerprintStr).digest("hex");
	}

	private static validateFingerprint(
		storedHash: string | undefined,
		currentRequest: FastifyRequest
	): boolean {
		if (!storedHash) return false;

		const currentFingerprint = this.generateFingerprint(currentRequest);
		const currentHash = this.hashFingerprint(currentFingerprint);

		return storedHash === currentHash;
	}

	/**Clean up */
	private static cleanupUsedTokens(): void {
		const now = Date.now();
		let cleanedCount = 0;

		for (const [jti, expiryTime] of this.invalidatedTokens.entries()) {
			if (now >= expiryTime) {
				this.invalidatedTokens.delete(jti);
				cleanedCount++;
			}
		}

		if (cleanedCount > 0) {
			Logger.debug(
				`Cleaned up ${cleanedCount} expired tokens`,
				"JWTService"
			);
		}
	}

	private static cleanupTokenFamilies(): void {
		const now = Date.now();
		let cleanedCount = 0;

		for (const [familyId, family] of this.tokenFamilies.entries()) {
			if (now >= family.validUntil || family.reuseDetected) {
				this.tokenFamilies.delete(familyId);
				cleanedCount++;
			}
		}

		if (cleanedCount > 0) {
			Logger.debug(
				`Cleaned up ${cleanedCount} expired token families`,
				"JWTService"
			);
		}
	}

	/**Token Validation */
	static validateSecrets() {
		if (!this.validateSecretStrength(CONFIG.JWT_SECRET)) {
			throw new Error(
				"JWT_SECRET must be at least 32 characters and contain mixed characters"
			);
		}
		if (!this.validateSecretStrength(CONFIG.JWT_REFRESH_SECRET)) {
			throw new Error(
				"JWT_REFRESH_SECRET must be at least 32 characters and contain mixed characters"
			);
		}
	}

	private static validateSecretStrength(secret: string): boolean {
		return secret.length >= 64 && /^[0-9a-f]{64,}$/i.test(secret);
	}

	static async invalidateToken(
		jti: string,
		expiryTime: number,
		familyId?: string
	): Promise<void> {
		try {
			this.invalidatedTokens.set(jti, expiryTime);

			if (familyId) {
				const family = this.tokenFamilies.get(familyId);
				if (family) {
					family.reuseDetected = true;
					this.tokenFamilies.set(familyId, family);
				}
			}

			Logger.debug(`Token invalidated: ${jti}`, "JWTService");
		} catch (error) {
			Logger.error(error as Error, "JWTService");
			throw new Error("Failed to invalidate token");
		}
	}

	private static isTokenInvalidated(jti: string): boolean {
		const expiryTime = this.invalidatedTokens.get(jti);
		if (!expiryTime) return false;

		if (Date.now() >= expiryTime) {
			this.invalidatedTokens.delete(jti);
			return false;
		}

		return true;
	}

	static async verifyToken(
		token: string,
		isRefresh = false
	): Promise<TokenPayload & { jti: string }> {
		try {
			if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
				throw new Error("JWT secrets not configured properly");
			}

			const secret = isRefresh
				? CONFIG.JWT_REFRESH_SECRET
				: CONFIG.JWT_SECRET;

			const decoded = verify(token, secret, {
				algorithms: ["HS256"],
				issuer: this.JWT_OPTIONS.issuer,
				audience: this.JWT_OPTIONS.audience,
				complete: true,
			}) as any;

			const payload = decoded.payload as TokenPayload & { jti: string };

			if (!payload.sub || payload.sub !== payload.userId) {
				throw new Error("Invalid token subject");
			}

			if (isRefresh && payload.type !== "refresh") {
				throw new Error("Invalid token type");
			}
			if (!isRefresh && payload.type !== "access") {
				throw new Error("Invalid token type");
			}

			if (this.isTokenInvalidated(payload.jti)) {
				throw new Error("Token has been invalidated");
			}

			if (isRefresh && payload.familyId) {
				const family = this.tokenFamilies.get(payload.familyId);
				if (!family) {
					throw new Error("Invalid token family");
				}
				if (family.reuseDetected) {
					throw new Error("Token family has been compromised");
				}
			}

			if (isRefresh && payload.iat) {
				const now = Math.floor(Date.now() / 1000);
				if (now - payload.iat > this.MAX_REFRESH_TOKEN_AGE) {
					throw new Error("Refresh token exceeded maximum lifetime");
				}
			}

			return payload;
		} catch (error) {
			if ((error as Error).name === "TokenExpiredError") {
				throw new Error("Token has expired");
			}
			throw error;
		}
	}

	/**Token Generation and Rotation */
	private static createTokenFamily(fingerprintHash: string): TokenFamily {
		const familyId = crypto.randomBytes(32).toString("hex");
		const now = Date.now();
		const family: TokenFamily = {
			familyId,
			validUntil: now + this.MAX_REFRESH_TOKEN_AGE * 1000,
			reuseDetected: false,
			lastRotation: now,
			fingerprint: fingerprintHash,
		};
		this.tokenFamilies.set(familyId, family);
		return family;
	}

	static async generateTokens(
		userId: string,
		request: FastifyRequest
	): Promise<TokenPair> {
		try {
			if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
				throw new Error("JWT secrets not configured properly");
			}

			const accessJti = crypto.randomBytes(32).toString("hex");
			const refreshJti = crypto.randomBytes(32).toString("hex");
			const now = Math.floor(Date.now() / 1000);

			const fingerprint = this.generateFingerprint(request);
			const fingerprintHash = this.hashFingerprint(fingerprint);

			const family = this.createTokenFamily(fingerprintHash);

			Logger.debug(`Generating tokens for user: ${userId}`, "JWTService");

			const accessToken = sign(
				{
					userId,
					type: "access",
					iat: now,
					familyId: family.familyId,
				},
				CONFIG.JWT_SECRET,
				{
					...this.JWT_OPTIONS,
					expiresIn: CONFIG.JWT_EXPIRES_IN || "1m", // Changed to 1 minute
					algorithm: "HS256",
					jwtid: accessJti,
					subject: userId,
				}
			);

			const refreshToken = sign(
				{
					userId,
					type: "refresh",
					iat: now,
					familyId: family.familyId,
				},
				CONFIG.JWT_REFRESH_SECRET,
				{
					...this.JWT_OPTIONS,
					expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN || "7d",
					algorithm: "HS256",
					jwtid: refreshJti,
					subject: userId,
				}
			);

			return { accessToken, refreshToken };
		} catch (error) {
			Logger.error(error as Error, "JWTService");
			throw error;
		}
	}

	static async rotateTokens(
		refreshToken: string,
		request: FastifyRequest
	): Promise<TokenPair> {
		try {
			Logger.debug("Attempting to rotate tokens", "JWTService");
			const decoded = await this.verifyToken(refreshToken, true);

			const family = this.tokenFamilies.get(decoded.familyId);
			if (!family) {
				throw new Error("Invalid token family");
			}

			// Validate fingerprint
			if (!this.validateFingerprint(family.fingerprint, request)) {
				family.reuseDetected = true;
				this.tokenFamilies.set(decoded.familyId, family);
				throw new Error("Token fingerprint mismatch");
			}

			if (family.reuseDetected) {
				this.tokenFamilies.delete(decoded.familyId);
				throw new Error("Token family has been compromised");
			}

			family.lastRotation = Date.now();
			this.tokenFamilies.set(decoded.familyId, family);

			const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
			await this.invalidateToken(
				decoded.jti,
				expiryTime,
				decoded.familyId
			);

			const newTokens = await this.generateTokens(
				decoded.userId,
				request
			);
			Logger.info(
				`Tokens rotated successfully for user: ${decoded.userId}`,
				"JWTService"
			);

			return newTokens;
		} catch (error) {
			Logger.error(error as Error, "JWTService");
			throw error;
		}
	}
}

JWTService.validateSecrets();

export default JWTService;
