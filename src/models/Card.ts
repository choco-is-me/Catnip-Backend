import crypto from "crypto";
import mongoose, { Document, Schema } from "mongoose";
import { CONFIG } from "../config";

interface ICard extends Document {
	userId: mongoose.Types.ObjectId;
	cardNumber: string;
	expirationDate: string;
	nameOnCard: string;
	// We don't store CVV/security code as per PCI compliance
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

// Encryption functions
function encrypt(text: string): string {
	const cipher = crypto.createCipheriv(
		"aes-256-cbc",
		Buffer.from(CONFIG.ENCRYPTION_KEY),
		Buffer.from(CONFIG.ENCRYPTION_IV)
	);
	let encrypted = cipher.update(text, "utf8", "hex");
	encrypted += cipher.final("hex");
	return encrypted;
}

function decrypt(encrypted: string): string {
	const decipher = crypto.createDecipheriv(
		"aes-256-cbc",
		Buffer.from(CONFIG.ENCRYPTION_KEY),
		Buffer.from(CONFIG.ENCRYPTION_IV)
	);
	let decrypted = decipher.update(encrypted, "hex", "utf8");
	decrypted += decipher.final("utf8");
	return decrypted;
}

// Index for faster queries
CardSchema.index({ userId: 1 });

// Ensure only one default card per user
CardSchema.pre("save", async function (next) {
	if (this.isDefault) {
		await this.model("Card").updateMany(
			{ userId: this.userId, _id: { $ne: this._id } },
			{ isDefault: false }
		);
	}
	next();
});

export const Card = mongoose.model<ICard>("Card", CardSchema);
