// src/services/jwt.service.ts
import crypto from "crypto";
import { sign, verify } from "jsonwebtoken";
import { CONFIG } from "../config";

interface TokenPayload {
	userId: string;
	iat?: number;
}

interface TokenPair {
	accessToken: string;
	refreshToken: string;
}

class JWTService {
	private static usedTokens = new Set<string>();
	private static usedRefreshTokens = new Set<string>();

	static generateTokens(userId: string): TokenPair {
		try {
			if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
				throw new Error("JWT secrets not configured properly");
			}

			const accessJti = crypto.randomBytes(32).toString("hex");
			const refreshJti = crypto.randomBytes(32).toString("hex");

			const accessToken = sign({ userId }, CONFIG.JWT_SECRET, {
				expiresIn: CONFIG.JWT_EXPIRES_IN || "15m",
				algorithm: "HS256",
				jwtid: accessJti,
			});

			const refreshToken = sign(
				{
					userId,
					tokenVersion: refreshJti, // Add version to track rotations
				},
				CONFIG.JWT_REFRESH_SECRET,
				{
					expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN || "7d",
					algorithm: "HS256",
					jwtid: refreshJti,
				}
			);

			return { accessToken, refreshToken };
		} catch (error) {
			console.error("JWT Token Generation Error:", error);
			throw new Error("Failed to generate authentication tokens");
		}
	}

	static verifyToken(
		token: string,
		isRefresh = false
	): TokenPayload & { jti: string } {
		try {
			if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
				throw new Error("JWT secrets not configured properly");
			}

			const decoded = verify(
				token,
				isRefresh ? CONFIG.JWT_REFRESH_SECRET : CONFIG.JWT_SECRET,
				{
					algorithms: ["HS256"],
				}
			) as TokenPayload & { jti: string };

			// Check if token has been invalidated
			const tokenSet = isRefresh
				? this.usedRefreshTokens
				: this.usedTokens;
			if (decoded.jti && tokenSet.has(decoded.jti)) {
				throw new Error("Token has been invalidated");
			}

			return decoded;
		} catch (error) {
			if (error instanceof Error) {
				console.error("JWT Verification Error:", error.message);
			}
			throw new Error("Invalid token");
		}
	}

	static invalidateToken(jti: string, isRefresh = false): void {
		try {
			const tokenSet = isRefresh
				? this.usedRefreshTokens
				: this.usedTokens;
			tokenSet.add(jti);
			this.cleanupUsedTokens();
		} catch (error) {
			console.error("Token Invalidation Error:", error);
			throw new Error("Failed to invalidate token");
		}
	}

	static rotateTokens(refreshToken: string): TokenPair {
		try {
			// Verify the refresh token
			const decoded = this.verifyToken(refreshToken, true);

			// Invalidate the used refresh token
			this.invalidateToken(decoded.jti, true);

			// Generate new token pair
			return this.generateTokens(decoded.userId);
		} catch (error) {
			throw new Error("Failed to rotate tokens");
		}
	}

	private static cleanupUsedTokens(): void {
		// Cleanup logic for both token sets
		if (this.usedTokens.size > 1000) {
			this.usedTokens.clear();
		}
		if (this.usedRefreshTokens.size > 1000) {
			this.usedRefreshTokens.clear();
		}
	}
}

export default JWTService;
