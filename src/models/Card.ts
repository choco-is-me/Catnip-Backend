// src/models/Card.ts
import crypto from "crypto";
import mongoose, { Document, Model, Schema } from "mongoose";
import { CONFIG } from "../config";
import { Logger } from "../services/logger.service";

export type CardNetwork = "visa" | "mastercard";

export interface ICard extends Document {
	userId: mongoose.Types.ObjectId;
	cardNumber: string;
	expirationDate: string;
	nameOnCard: string;
	network: CardNetwork;
	isDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// Define interface for static methods
interface ICardModel extends Model<ICard> {
	detectCardNetwork(cardNumber: string): CardNetwork | null;
	compareCardNumbers(
		plainCardNumber: string,
		encryptedCardNumber: string
	): Promise<boolean>;
}

interface EncryptedData {
	encryptedValue: string;
	iv: string;
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
		network: {
			type: String,
			required: true,
			enum: ["visa", "mastercard"],
			index: true,
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

// Add network detection utility as static method
CardSchema.statics.detectCardNetwork = function (
	cardNumber: string
): CardNetwork | null {
	// Visa: Starts with 4, length 13 or 16
	const visaPattern = /^4[0-9]{12}(?:[0-9]{3})?$/;

	// Mastercard: Starts with 51-55 or 2221-2720, length 16
	const mastercardPattern =
		/^(5[1-5][0-9]{14}|2(22[1-9][0-9]{12}|2[3-9][0-9]{13}|[3-6][0-9]{14}|7[0-1][0-9]{13}|720[0-9]{12}))$/;

	if (visaPattern.test(cardNumber)) {
		return "visa";
	} else if (mastercardPattern.test(cardNumber)) {
		return "mastercard";
	}

	return null;
};

// Encryption functions
function encrypt(text: string): string {
	try {
		Logger.debug("Encrypting sensitive card data", "CardEncryption");
		// Generate a new IV for each encryption
		const iv = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv(
			"aes-256-cbc",
			Buffer.from(CONFIG.ENCRYPTION_KEY),
			iv
		);
		let encrypted = cipher.update(text, "utf8", "hex");
		encrypted += cipher.final("hex");

		// Combine IV and encrypted data
		const result: EncryptedData = {
			encryptedValue: encrypted,
			iv: iv.toString("hex"),
		};

		return JSON.stringify(result);
	} catch (error) {
		Logger.error(error as Error, "CardEncryption");
		throw new Error("Encryption failed");
	}
}

function decrypt(encryptedJson: string): string {
	try {
		Logger.debug("Decrypting card data", "CardDecryption");
		const { encryptedValue, iv } = JSON.parse(
			encryptedJson
		) as EncryptedData;

		const decipher = crypto.createDecipheriv(
			"aes-256-cbc",
			Buffer.from(CONFIG.ENCRYPTION_KEY),
			Buffer.from(iv, "hex")
		);

		let decrypted = decipher.update(encryptedValue, "hex", "utf8");
		decrypted += decipher.final("utf8");
		return decrypted;
	} catch (error) {
		Logger.error(error as Error, "CardDecryption");
		throw new Error("Decryption failed");
	}
}

// Add network detection utility
CardSchema.statics.detectCardNetwork = function (
	cardNumber: string
): CardNetwork | null {
	// Visa: Starts with 4, length 13 or 16
	const visaPattern = /^4[0-9]{12}(?:[0-9]{3})?$/;

	// Mastercard: Starts with 51-55 or 2221-2720, length 16
	const mastercardPattern =
		/^(5[1-5][0-9]{14}|2(22[1-9][0-9]{12}|2[3-9][0-9]{13}|[3-6][0-9]{14}|7[0-1][0-9]{13}|720[0-9]{12}))$/;

	if (visaPattern.test(cardNumber)) {
		return "visa";
	} else if (mastercardPattern.test(cardNumber)) {
		return "mastercard";
	}

	return null;
};

// Indexes
CardSchema.index({ userId: 1 });
CardSchema.index({ cardNumber: 1 }, { unique: true });

// Export the model with proper typing for static methods
export const Card = mongoose.model<ICard, ICardModel>("Card", CardSchema);

// Log model registration
Logger.info("Card model registered", "CardModel");
