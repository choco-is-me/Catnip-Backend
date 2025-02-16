// src/models/Cart.ts
import mongoose, { Document, Schema } from "mongoose";
import { IVariant, Item } from "./Item";
import { Logger } from "../services/logger.service";

// Interface for cart item with pricing
export interface ICartItem {
	itemId: mongoose.Types.ObjectId;
	variantSku: string;
	quantity: number;
	priceAtAdd: number; // Original price when added
	currentPrice: number; // Current price (updated on server restart)
	effectivePrice: number; // Price after discount
	specifications: Record<string, any>; // Variant specifications
	name: string; // Item name for quick reference
	status: "active" | "discontinued" | "outOfStock" | "removed";
}

// Main Cart interface
export interface ICart {
	userId: mongoose.Types.ObjectId;
	items: ICartItem[];
	itemCount: number; // Total number of items
	totalOriginalPrice: number; // Total without discounts
	totalEffectivePrice: number; // Total with discounts
	lastPriceUpdate: Date; // Track when prices were last updated
	createdAt: Date;
	updatedAt: Date;
}

// Interface for Cart Document combining ICart with Document and instance methods
interface ICartDocument extends ICart, Document {
	validateStock(
		itemId: string,
		variantSku: string,
		quantity: number
	): Promise<boolean>;
	updatePrices(): Promise<void>;
}

// Type for Cart Model with static methods
interface ICartModel extends mongoose.Model<ICartDocument> {
	cleanupDeletedItems(): Promise<void>;
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
		},
		priceAtAdd: {
			type: Number,
			required: true,
			min: 0,
		},
		currentPrice: {
			type: Number,
			required: true,
			min: 0,
		},
		effectivePrice: {
			type: Number,
			required: true,
			min: 0,
		},
		specifications: {
			type: Schema.Types.Mixed,
			required: true,
		},
		name: {
			type: String,
			required: true,
		},
		status: {
			type: String,
			enum: ["active", "discontinued", "outOfStock", "removed"],
			default: "active",
		},
	},
	{ _id: false }
);

const CartSchema = new Schema<ICartDocument>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		items: [CartItemSchema],
		itemCount: {
			type: Number,
			default: 0,
		},
		totalOriginalPrice: {
			type: Number,
			default: 0,
		},
		totalEffectivePrice: {
			type: Number,
			default: 0,
		},
		lastPriceUpdate: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true,
	}
);

// Index for efficient queries
CartSchema.index({ userId: 1 }, { unique: true });
CartSchema.index({ "items.itemId": 1 });
CartSchema.index({ updatedAt: 1 });

// Pre-save middleware to update totals
CartSchema.pre("save", function (next) {
	if (this.isModified("items")) {
		// Update item count
		this.itemCount = this.items.length;

		// Calculate totals
		const totals = this.items.reduce(
			(acc, item: ICartItem) => {
				acc.original += item.currentPrice * item.quantity;
				acc.effective += item.effectivePrice * item.quantity;
				return acc;
			},
			{ original: 0, effective: 0 }
		);

		this.totalOriginalPrice = totals.original;
		this.totalEffectivePrice = totals.effective;
	}
	next();
});

// Method to validate stock before adding/updating
CartSchema.methods.validateStock = async function (
	itemId: string,
	variantSku: string,
	quantity: number
): Promise<boolean> {
	try {
		const item = await Item.findById(itemId);
		if (!item) return false;

		const variant = item.variants.find(
			(v: IVariant) => v.sku === variantSku
		);
		if (!variant) return false;

		return variant.stockQuantity >= quantity;
	} catch (error) {
		Logger.error(error as Error, "CartModel");
		return false;
	}
};

// Method to update prices of all items
CartSchema.methods.updatePrices = async function (): Promise<void> {
	try {
		const updatedItems = await Promise.all(
			this.items.map(async (item: ICartItem) => {
				const dbItem = await Item.findById(item.itemId);
				if (!dbItem) {
					item.status = "removed";
					return item;
				}

				const variant = dbItem.variants.find(
					(v) => v.sku === item.variantSku
				);
				if (!variant) {
					item.status = "removed";
					return item;
				}

				if (dbItem.status === "discontinued") {
					item.status = "discontinued";
					return item;
				}

				if (variant.stockQuantity < item.quantity) {
					item.status = "outOfStock";
					return item;
				}

				// Update prices
				item.currentPrice = variant.price;

				// Calculate effective price considering discounts
				const basePrice = variant.price;
				if (dbItem.discount && dbItem.discount.active) {
					const now = new Date();
					if (
						now >= dbItem.discount.startDate &&
						now <= dbItem.discount.endDate
					) {
						item.effectivePrice =
							basePrice * (1 - dbItem.discount.percentage / 100);
					} else {
						item.effectivePrice = basePrice;
					}
				} else {
					item.effectivePrice = basePrice;
				}

				item.status = "active";
				return item;
			})
		);

		// Filter out removed items
		this.items = updatedItems.filter((item) => item.status === "active");
		this.lastPriceUpdate = new Date();
		await this.save();
	} catch (error) {
		Logger.error(error as Error, "CartModel");
		throw error;
	}
};

// Static method to cleanup carts for deleted items
CartSchema.statics.cleanupDeletedItems = async function () {
	try {
		const carts = await this.find({});
		for (const cart of carts) {
			await cart.updatePrices();
		}
		Logger.info("Cart cleanup completed", "CartModel");
	} catch (error) {
		Logger.error(error as Error, "CartModel");
		throw error;
	}
};

export const Cart = mongoose.model<ICartDocument, ICartModel>(
	"Cart",
	CartSchema
);

// Log model registration
Logger.info("Cart model registered", "CartModel");
