// src/models/Cart.ts
import mongoose, { Document, Schema } from "mongoose";
import { Logger } from "../services/logger.service";

// Define the cart expiration period - 7 days
const CART_EXPIRY_DAYS = 7;

export interface ICartItem {
	itemId: mongoose.Types.ObjectId;
	variantSku: string;
	quantity: number;
	addedAt: Date;
	updatedAt: Date;
}

export interface ICart extends Document {
	userId: mongoose.Types.ObjectId;
	items: ICartItem[];
	lastActivity: Date;
	lastSyncedAt?: Date;
	syncData?: any;
	expires: Date;
	createdAt: Date;
	updatedAt: Date;

	// Helper methods
	getItem(itemId: string, variantSku: string): ICartItem | undefined;
	calculateTotals(): {
		subtotal: number;
		totalItems: number;
		totalQuantity: number;
	};
	isExpired(): boolean;
	refreshExpiry(): void;
}

const CartItemSchema = new Schema<ICartItem>(
	{
		itemId: {
			type: Schema.Types.ObjectId,
			ref: "Item",
			required: true,
		},
		variantSku: {
			type: String,
			required: true,
		},
		quantity: {
			type: Number,
			required: true,
			min: 1,
			default: 1,
		},
		addedAt: {
			type: Date,
			default: Date.now,
		},
		updatedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ _id: false }
);

const CartSchema = new Schema<ICart>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true,
			// Remove the unique: true from here, will define it with index() below
		},
		items: [CartItemSchema],
		lastActivity: {
			type: Date,
			default: Date.now,
		},
		lastSyncedAt: {
			type: Date,
		},
		syncData: {
			type: Schema.Types.Mixed,
		},
		expires: {
			type: Date,
			default: function () {
				return new Date(
					Date.now() + CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000
				);
			},
		},
	},
	{
		timestamps: true,
	}
);

// Add methods to the schema
CartSchema.methods.getItem = function (
	itemId: string,
	variantSku: string
): ICartItem | undefined {
	return this.items.find(
		(item: ICartItem) =>
			item.itemId.toString() === itemId && item.variantSku === variantSku
	);
};

CartSchema.methods.calculateTotals = function () {
	return {
		subtotal: 0, // Placeholder, calculated during sync with current prices
		totalItems: this.items.length,
		totalQuantity: this.items.reduce(
			(total: number, item: ICartItem) => total + item.quantity,
			0
		),
	};
};

CartSchema.methods.isExpired = function (): boolean {
	return this.expires < new Date();
};

CartSchema.methods.refreshExpiry = function (): void {
	this.lastActivity = new Date();
	this.expires = new Date(
		Date.now() + CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000
	);
};

// Update lastActivity and expires on save
CartSchema.pre("save", function (next) {
	this.lastActivity = new Date();
	this.expires = new Date(
		Date.now() + CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000
	);
	next();
});

// Add indexes for better performance
CartSchema.index({ userId: 1 }, { unique: true });
// Create a TTL index to automatically remove expired carts
CartSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

export const Cart = mongoose.model<ICart>("Cart", CartSchema);

// Log model registration
Logger.info("Cart model registered", "CartModel");
