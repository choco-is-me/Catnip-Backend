import { sign, verify } from "jsonwebtoken";
import crypto from "crypto";
import { CONFIG } from "../config";

interface TokenPayload {
	userId: string;
	jti?: string; // JWT ID for tracking used tokens
	iat?: number; // Issued at
}

class JWTService {
	private static usedTokens = new Set<string>();

	static generateTokens(userId: string) {
		const jti = crypto.randomBytes(32).toString("hex");

		const accessToken = sign({ userId, jti }, CONFIG.JWT_SECRET, {
			expiresIn: CONFIG.JWT_EXPIRES_IN,
			algorithm: "HS256", // Explicitly specify algorithm
			jwtid: jti, // Include JWT ID
		});

		const refreshToken = sign({ userId }, CONFIG.JWT_REFRESH_SECRET, {
			expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN,
			algorithm: "HS256",
		});

		return { accessToken, refreshToken };
	}

	static verifyToken(token: string, isRefresh = false) {
		try {
			const decoded = verify(
				token,
				isRefresh ? CONFIG.JWT_REFRESH_SECRET : CONFIG.JWT_SECRET,
				{
					algorithms: ["HS256"], // Only allow HS256
				}
			) as TokenPayload;

			// Check if token has been used (prevents replay attacks)
			if (this.usedTokens.has(decoded.jti!)) {
				throw new Error("Token has been invalidated");
			}

			return decoded;
		} catch (error) {
			throw new Error("Invalid token");
		}
	}

	static invalidateToken(jti: string) {
		this.usedTokens.add(jti);
		// Implement cleanup of old tokens periodically
		this.cleanupUsedTokens();
	}

	private static cleanupUsedTokens() {
		// Implement cleanup of expired tokens from usedTokens set
		// This should run periodically to prevent memory leaks
	}
}

export default JWTService;
