// src/models/Card.ts
import crypto from "crypto";
import mongoose, { Document, Schema } from "mongoose";
import { CONFIG } from "../config";
import { Logger } from "../services/logger.service";

export interface ICard extends Document {
	userId: mongoose.Types.ObjectId;
	cardNumber: string;
	expirationDate: string;
	nameOnCard: string;
	isDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
}

const CardSchema = new Schema<ICard>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		cardNumber: {
			type: String,
			required: true,
			set: (value: string) => encrypt(value),
			get: (value: string) => decrypt(value),
		},
		expirationDate: {
			type: String,
			required: true,
			set: (value: string) => encrypt(value),
			get: (value: string) => decrypt(value),
		},
		nameOnCard: {
			type: String,
			required: true,
			set: (value: string) => encrypt(value),
			get: (value: string) => decrypt(value),
		},
		isDefault: {
			type: Boolean,
			default: false,
		},
	},
	{
		timestamps: true,
		toJSON: { getters: true },
		toObject: { getters: true },
	}
);

// Static method to compare encrypted card numbers
CardSchema.statics.compareCardNumbers = async function (
	plainCardNumber: string,
	encryptedCardNumber: string
): Promise<boolean> {
	const decryptedNumber = decrypt(encryptedCardNumber);
	return decryptedNumber === plainCardNumber;
};

// Encryption functions
function encrypt(text: string): string {
	try {
		Logger.debug("Encrypting sensitive card data", "CardEncryption");
		const cipher = crypto.createCipheriv(
			"aes-256-cbc",
			Buffer.from(CONFIG.ENCRYPTION_KEY),
			Buffer.from(CONFIG.ENCRYPTION_IV)
		);
		let encrypted = cipher.update(text, "utf8", "hex");
		encrypted += cipher.final("hex");
		return encrypted;
	} catch (error) {
		Logger.error(error as Error, "CardEncryption");
		throw new Error("Encryption failed");
	}
}

function decrypt(encrypted: string): string {
	try {
		Logger.debug("Decrypting card data", "CardDecryption");
		const decipher = crypto.createDecipheriv(
			"aes-256-cbc",
			Buffer.from(CONFIG.ENCRYPTION_KEY),
			Buffer.from(CONFIG.ENCRYPTION_IV)
		);
		let decrypted = decipher.update(encrypted, "hex", "utf8");
		decrypted += decipher.final("utf8");
		return decrypted;
	} catch (error) {
		Logger.error(error as Error, "CardDecryption");
		throw new Error("Decryption failed");
	}
}

// Indexes
CardSchema.index({ userId: 1 });
CardSchema.index({ cardNumber: 1 }, { unique: true });

export const Card = mongoose.model<ICard>("Card", CardSchema);

// Log model registration
Logger.info("Card model registered", "CardModel");
