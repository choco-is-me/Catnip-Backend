// src/models/Token.ts
import mongoose, { Document, Schema } from "mongoose";
import { Logger } from "../services/logger.service";

// Interface for invalidated tokens
export interface IInvalidatedToken extends Document {
	jti: string;
	expiryTime: Date;
	tokenType: "access" | "refresh";
	familyId?: string;
	createdAt: Date;
}

// Interface for token families
export interface ITokenFamily extends Document {
	familyId: string;
	fingerprint: string;
	validUntil: Date;
	lastRotation: Date;
	reuseDetected: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// Schema for invalidated tokens
const InvalidatedTokenSchema = new Schema<IInvalidatedToken>({
	jti: {
		type: String,
		required: true,
		unique: true,
		index: true,
	},
	expiryTime: {
		type: Date,
		required: true,
		index: true,
	},
	tokenType: {
		type: String,
		enum: ["access", "refresh"],
		required: true,
	},
	familyId: {
		type: String,
		sparse: true,
		index: true,
	},
	createdAt: {
		type: Date,
		default: Date.now,
		expires: "30d",
	},
});

// Schema for token families
const TokenFamilySchema = new Schema<ITokenFamily>(
	{
		familyId: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		fingerprint: {
			type: String,
			required: true,
		},
		validUntil: {
			type: Date,
			required: true,
		},
		lastRotation: {
			type: Date,
			required: true,
		},
		reuseDetected: {
			type: Boolean,
			default: false,
		},
	},
	{
		timestamps: true,
	}
);

// Add TTL index for automatic cleanup
TokenFamilySchema.index({ validUntil: 1 }, { expireAfterSeconds: 0 });

// Create models
export const InvalidatedToken = mongoose.model<IInvalidatedToken>(
	"InvalidatedToken",
	InvalidatedTokenSchema
);
export const TokenFamily = mongoose.model<ITokenFamily>(
	"TokenFamily",
	TokenFamilySchema
);

// Log model registration
Logger.info("Token models registered", "TokenModel");
