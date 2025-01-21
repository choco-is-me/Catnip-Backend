// src/services/jwt.service.ts
import crypto from "crypto";
import { FastifyRequest } from "fastify";
import { sign, verify } from "jsonwebtoken";
import mongoose from "mongoose";
import { CONFIG } from "../config";
import { InvalidatedToken, TokenFamily } from "../models/Token";
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

class JWTService {
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
			platform: this.getHeaderValue(headers["x-platform"]),
			screenDimensions: this.getHeaderValue(
				headers["x-screen-dimensions"]
			),
			ipAddress: request.ip,
			timeZone: this.getHeaderValue(headers["x-timezone"]),
			language: this.getHeaderValue(headers["accept-language"]),
		};
	}

	private static hashFingerprint(data: FingerprintData): string {
		const fingerprintStr = Object.values(data).join("|");
		return crypto.createHash("sha256").update(fingerprintStr).digest("hex");
	}

	private static async validateFingerprint(
		storedHash: string | undefined,
		currentRequest: FastifyRequest
	): Promise<boolean> {
		if (!storedHash) return false;

		const currentFingerprint = this.generateFingerprint(currentRequest);
		const currentHash = this.hashFingerprint(currentFingerprint);

		return storedHash === currentHash;
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

	static async invalidateToken(
		jti: string,
		expiryTime: number,
		familyId?: string,
		isLogout: boolean = false
	): Promise<void> {
		try {
			// Create invalidated token record
			await InvalidatedToken.create({
				jti,
				expiryTime: new Date(expiryTime),
				tokenType: familyId ? "refresh" : "access",
				familyId,
			});

			// Only mark token family as compromised if it's not a normal logout
			if (familyId && !isLogout) {
				await TokenFamily.updateOne(
					{ familyId },
					{ reuseDetected: true }
				);
			}

			Logger.debug(`Token invalidated: ${jti}`, "JWTService");
		} catch (error) {
			Logger.error(error as Error, "JWTService");
			throw new Error("Failed to invalidate token");
		}
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

			if (await this.isTokenInvalidated(payload.jti)) {
				throw new Error("Token has been invalidated");
			}

			if (isRefresh && payload.familyId) {
				const family = await TokenFamily.findOne({
					familyId: payload.familyId,
				});
				if (!family) {
					throw new Error("Invalid token family");
				}
				if (family.reuseDetected) {
					throw new Error("Token family has been compromised");
				}
				if (family.validUntil < new Date()) {
					throw new Error("Token family has expired");
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

	private static async createTokenFamily(
		fingerprintHash: string
	): Promise<string> {
		const familyId = crypto.randomBytes(32).toString("hex");
		const now = new Date();
		const validUntil = new Date(
			now.getTime() + this.MAX_REFRESH_TOKEN_AGE * 1000
		);

		await TokenFamily.create({
			familyId,
			fingerprint: fingerprintHash,
			validUntil,
			lastRotation: now,
			reuseDetected: false,
		});

		return familyId;
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

			const familyId = await this.createTokenFamily(fingerprintHash);

			Logger.debug(`Generating tokens for user: ${userId}`, "JWTService");

			const accessToken = sign(
				{
					userId,
					type: "access",
					iat: now,
					familyId,
				},
				CONFIG.JWT_SECRET,
				{
					...this.JWT_OPTIONS,
					expiresIn: CONFIG.JWT_EXPIRES_IN,
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
					familyId,
				},
				CONFIG.JWT_REFRESH_SECRET,
				{
					...this.JWT_OPTIONS,
					expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN,
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

			// Find token family without transaction first
			const family = await TokenFamily.findOne({
				familyId: decoded.familyId,
			});

			if (!family) {
				throw new Error("Invalid token family");
			}

			// Validate fingerprint
			if (
				!(await this.validateFingerprint(family.fingerprint, request))
			) {
				await TokenFamily.updateOne(
					{ familyId: decoded.familyId },
					{ reuseDetected: true }
				);
				throw new Error("Token fingerprint mismatch");
			}

			if (family.reuseDetected) {
				await TokenFamily.deleteOne({ familyId: decoded.familyId });
				throw new Error("Token family has been compromised");
			}

			// Update last rotation
			await TokenFamily.updateOne(
				{ familyId: decoded.familyId },
				{ lastRotation: new Date() }
			);

			// Invalidate old refresh token
			await InvalidatedToken.create({
				jti: decoded.jti,
				expiryTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
				tokenType: "refresh",
				familyId: decoded.familyId,
			});

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
