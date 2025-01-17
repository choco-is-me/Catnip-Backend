// src/services/jwt.service.ts
import crypto from "crypto";
import { sign, verify } from "jsonwebtoken";
import { CONFIG } from "../config";
import { Logger } from "./logger.service";

interface TokenPayload {
	userId: string;
	type: "access" | "refresh";
	iat?: number;
	jti: string;
}

interface TokenPair {
	accessToken: string;
	refreshToken: string;
}

class JWTService {
	// In-memory storage for invalidated refresh tokens
	private static invalidatedTokens = new Map<string, number>();

	private static readonly JWT_OPTIONS = {
		issuer: "space-cat-api",
		audience: "space-cat-api",
		notBefore: "0s",
	};

	private static readonly MAX_REFRESH_TOKEN_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
	private static readonly CLEANUP_INTERVAL = 1 * 60 * 60 * 1000; // Run cleanup every hour

	// Initialize cleanup interval
	static {
		setInterval(() => {
			this.cleanupUsedTokens();
		}, this.CLEANUP_INTERVAL);
	}

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

	static async invalidateToken(
		jti: string,
		expiryTime: number
	): Promise<void> {
		try {
			this.invalidatedTokens.set(jti, expiryTime);
			Logger.debug(`Token invalidated: ${jti}`, "JWTService");
		} catch (error) {
			Logger.error(error as Error, "JWTService");
			throw new Error("Failed to invalidate token");
		}
	}

	private static isTokenInvalidated(jti: string): boolean {
		const expiryTime = this.invalidatedTokens.get(jti);
		if (!expiryTime) return false;

		// If token has expired, remove it from invalidated tokens
		if (Date.now() >= expiryTime) {
			this.invalidatedTokens.delete(jti);
			return false;
		}

		return true;
	}

	static async generateTokens(userId: string): Promise<TokenPair> {
		try {
			if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
				throw new Error("JWT secrets not configured properly");
			}

			const accessJti = crypto.randomBytes(32).toString("hex");
			const refreshJti = crypto.randomBytes(32).toString("hex");
			const now = Math.floor(Date.now() / 1000);

			Logger.debug(`Generating tokens for user: ${userId}`, "JWTService");

			const accessToken = sign(
				{
					userId,
					type: "access",
					iat: now,
				},
				CONFIG.JWT_SECRET,
				{
					...this.JWT_OPTIONS,
					expiresIn: CONFIG.JWT_EXPIRES_IN || "5m",
					algorithm: "HS256",
					jwtid: accessJti,
				}
			);

			const refreshToken = sign(
				{
					userId,
					type: "refresh",
					iat: now,
				},
				CONFIG.JWT_REFRESH_SECRET,
				{
					...this.JWT_OPTIONS,
					expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN || "7d",
					algorithm: "HS256",
					jwtid: refreshJti,
				}
			);

			Logger.debug(
				`Tokens generated successfully for user: ${userId}`,
				"JWTService"
			);
			return { accessToken, refreshToken };
		} catch (error) {
			Logger.error(error as Error, "JWTService");
			throw new Error("Failed to generate authentication tokens");
		}
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

			try {
				const decoded = verify(token, secret, {
					algorithms: ["HS256"],
					issuer: this.JWT_OPTIONS.issuer,
					audience: this.JWT_OPTIONS.audience,
					complete: true,
				}) as any;

				const payload = decoded.payload as TokenPayload & {
					jti: string;
				};

				if (isRefresh && payload.type !== "refresh") {
					throw new Error("Invalid token type");
				}
				if (!isRefresh && payload.type !== "access") {
					throw new Error("Invalid token type");
				}

				// Check if refresh token has been invalidated
				if (isRefresh && this.isTokenInvalidated(payload.jti)) {
					throw new Error("Token has been invalidated");
				}

				// For refresh tokens, check absolute lifetime
				if (isRefresh && payload.iat) {
					const now = Math.floor(Date.now() / 1000);
					if (now - payload.iat > this.MAX_REFRESH_TOKEN_AGE) {
						throw new Error(
							"Refresh token exceeded maximum lifetime"
						);
					}
				}

				return payload;
			} catch (error) {
				if ((error as Error).name === "TokenExpiredError") {
					Logger.warn("Token has expired", "JWTService");
					throw new Error("Token has expired");
				}
				throw error;
			}
		} catch (error) {
			if (error instanceof Error) {
				Logger.warn(error.message, "JWTService");
				throw error;
			}
			throw new Error("Invalid token");
		}
	}

	static async rotateTokens(refreshToken: string): Promise<TokenPair> {
		try {
			Logger.debug("Attempting to rotate tokens", "JWTService");
			const decoded = await this.verifyToken(refreshToken, true);

			// Calculate token expiry time (matches the JWT expiry)
			const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

			// Invalidate the used refresh token
			await this.invalidateToken(decoded.jti, expiryTime);

			// Generate new token pair
			const newTokens = await this.generateTokens(decoded.userId);
			Logger.info(
				`Tokens rotated successfully for user: ${decoded.userId}`,
				"JWTService"
			);

			return newTokens;
		} catch (error) {
			Logger.error(error as Error, "JWTService");
			throw new Error("Failed to rotate tokens");
		}
	}
}

// Initialize secret validation
JWTService.validateSecrets();

export default JWTService;
