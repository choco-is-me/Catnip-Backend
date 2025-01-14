import { sign, verify } from "jsonwebtoken";
import crypto from "crypto";
import { CONFIG } from "../config";

interface TokenPayload {
	userId: string;
	iat?: number;
}

class JWTService {
	private static usedTokens = new Set<string>();

	static generateTokens(userId: string) {
		try {
			if (!CONFIG.JWT_SECRET || !CONFIG.JWT_REFRESH_SECRET) {
				throw new Error("JWT secrets not configured properly");
			}

			const jti = crypto.randomBytes(32).toString("hex");

			// Remove jti from payload since we're using it in options
			const accessToken = sign(
				{ userId }, // Remove jti from payload
				CONFIG.JWT_SECRET,
				{
					expiresIn: CONFIG.JWT_EXPIRES_IN || "15m",
					algorithm: "HS256",
					jwtid: jti, // Keep jti only in options
				}
			);

			const refreshToken = sign({ userId }, CONFIG.JWT_REFRESH_SECRET, {
				expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN || "7d",
				algorithm: "HS256",
			});

			return { accessToken, refreshToken };
		} catch (error) {
			console.error("JWT Token Generation Error:", error);
			throw new Error("Failed to generate authentication tokens");
		}
	}

	static verifyToken(token: string, isRefresh = false) {
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
			) as TokenPayload & { jti?: string }; // Add jti from JWT header

			// Check jti from the token header
			if (!isRefresh && decoded.jti && this.usedTokens.has(decoded.jti)) {
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

	static invalidateToken(jti: string) {
		try {
			this.usedTokens.add(jti);
			this.cleanupUsedTokens();
		} catch (error) {
			console.error("Token Invalidation Error:", error);
			throw new Error("Failed to invalidate token");
		}
	}

	private static cleanupUsedTokens() {
		// Implementation for token cleanup
		// You might want to periodically clear old tokens
		// This is a simple implementation
		if (this.usedTokens.size > 1000) {
			// Arbitrary limit
			this.usedTokens.clear();
		}
	}
}

export default JWTService;
