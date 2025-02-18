// src/models/Cart.ts
import mongoose, { Document, Schema } from "mongoose";
import {
	CURRENCY_CONSTANTS,
	validateVNDValue,
} from "../constants/currency.constants";
import { Logger } from "../services/logger.service";
import { IItem, IVariant, Item } from "./Item";

// Interface for cart item with pricing
export interface ICartItem {
	itemId: mongoose.Types.ObjectId;
	variantSku: string;
	quantity: number;
	priceAtAdd: number; // Original price when added (in VND)
	currentPrice: number; // Current price (in VND)
	effectivePrice: number; // Price after discount (in VND)
	specifications: Record<string, any>;
	name: string;
	status: "active" | "discontinued" | "outOfStock" | "removed";
}

// Main Cart interface
export interface ICart {
	userId: mongoose.Types.ObjectId;
	items: ICartItem[];
	itemCount: number;
	totalOriginalPrice: number; // Total without discounts (in VND)
	totalEffectivePrice: number; // Total with discounts (in VND)
	lastPriceUpdate: Date;
	lastActive: Date;
	version: number; // Version for optimistic locking
	currency: "VND"; // Fixed to VND for Vietnamese Dong
	createdAt: Date;
	updatedAt: Date;
}

// Interface for Cart Document
interface ICartDocument extends ICart, Document {
	validateStock(
		itemId: string,
		variantSku: string,
		quantity: number
	): Promise<boolean>;
	updatePrices(): Promise<void>;
	updateItemStatus(
		item: ICartItem,
		status: "active" | "discontinued" | "outOfStock" | "removed",
		currentPrice?: number
	): ICartItem;
}

// Type for Cart Model
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
			validate: {
				validator: validateVNDValue,
				message: CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE,
			},
		},
		currentPrice: {
			type: Number,
			required: true,
			min: 0,
			validate: {
				validator: validateVNDValue,
				message: CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE,
			},
		},
		effectivePrice: {
			type: Number,
			required: true,
			min: 0,
			validate: {
				validator: validateVNDValue,
				message: CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE,
			},
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
			max: [
				CURRENCY_CONSTANTS.CART.MAX_ITEMS,
				`Cart cannot have more than ${CURRENCY_CONSTANTS.CART.MAX_ITEMS} items`,
			],
		},
		totalOriginalPrice: {
			type: Number,
			default: 0,
			validate: {
				validator: validateVNDValue,
				message: CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE,
			},
		},
		totalEffectivePrice: {
			type: Number,
			default: 0,
			validate: {
				validator: validateVNDValue,
				message: CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE,
			},
		},
		lastPriceUpdate: {
			type: Date,
			default: Date.now,
		},
		lastActive: {
			type: Date,
			default: Date.now,
		},
		version: {
			type: Number,
			default: 0,
			required: true,
		},
		currency: {
			type: String,
			enum: ["VND"],
			default: "VND",
			required: true,
		},
	},
	{
		timestamps: true,
	}
);

// Indexes
CartSchema.index({ userId: 1 }, { unique: true });
CartSchema.index({ "items.itemId": 1 });
CartSchema.index({ lastActive: 1 });
CartSchema.index({ updatedAt: 1 });
CartSchema.index({ version: 1 }); // Index for version queries

// Pre-save middleware to update totals and version
CartSchema.pre("save", async function (next) {
	// Skip validation if prices haven't changed
	if (!this.isModified("items") && !this.isModified("totalEffectivePrice")) {
		return next();
	}

	// Validate minimum order value
	if (
		this.items.length > 0 &&
		this.totalEffectivePrice < CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE
	) {
		next(
			new Error(
				CURRENCY_CONSTANTS.ERRORS.MIN_ORDER(
					CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE
				)
			)
		);
		return;
	}

	// Validate maximum order value
	if (this.totalEffectivePrice > CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE) {
		next(
			new Error(
				CURRENCY_CONSTANTS.ERRORS.MAX_ORDER(
					CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE
				)
			)
		);
		return;
	}

	next();
});

// Update totals and version
CartSchema.pre("save", function (next) {
	if (this.isModified("items")) {
		// Update item count (only count active items)
		this.itemCount = this.items.filter(
			(item) => item.status === "active"
		).length;

		// Calculate totals (ensuring integer values for VND)
		const totals = this.items
			.filter((item) => item.status === "active")
			.reduce(
				(acc, item: ICartItem) => {
					acc.original += Math.round(
						item.currentPrice * item.quantity
					);
					acc.effective += Math.round(
						item.effectivePrice * item.quantity
					);
					return acc;
				},
				{ original: 0, effective: 0 }
			);

		this.totalOriginalPrice = totals.original;
		this.totalEffectivePrice = totals.effective;
		this.lastActive = new Date();
	}

	// Increment version on any modification
	if (this.isModified()) {
		this.version += 1;
	}

	next();
});

// Cart item limit validation
CartSchema.methods.validateItemLimit = function (
	newItemCount: number = 1
): boolean {
	const futureItemCount = this.items.length + newItemCount;
	return futureItemCount <= CURRENCY_CONSTANTS.CART.MAX_ITEMS;
};

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

// Helper method to update item status
CartSchema.methods.updateItemStatus = function (
	item: ICartItem,
	status: "active" | "discontinued" | "outOfStock" | "removed",
	currentPrice?: number
): ICartItem {
	item.status = status;

	if (currentPrice !== undefined) {
		item.currentPrice = Math.round(currentPrice);
		// For discontinued items, keep the effective price same as current
		item.effectivePrice = item.currentPrice;
	}

	return item;
};

// Method to update prices of all items
CartSchema.methods.updatePrices = async function (): Promise<void> {
	try {
		// Get all unique item IDs
		const itemIds = [
			...new Set(this.items.map((item: ICartItem) => item.itemId)),
		];

		// Fetch items with a single query
		const dbItems = await Item.find<IItem>({
			_id: { $in: itemIds },
		}).lean();

		// Create map for O(1) lookups
		const itemsMap = new Map(
			dbItems.map((item) => [item._id.toString(), item])
		);

		const updatedItems = this.items.map((item: ICartItem) => {
			const dbItem = itemsMap.get(item.itemId.toString());
			if (!dbItem) {
				item.status = "removed";
				return this.updateItemStatus(item, "removed");
			}

			const variant = dbItem.variants.find(
				(v: IVariant) => v.sku === item.variantSku
			);
			if (!variant) {
				return this.updateItemStatus(item, "removed");
			}

			// Handle discontinued items
			if (dbItem.status === "discontinued") {
				// Keep discontinued items in cart but mark them
				return this.updateItemStatus(
					item,
					"discontinued",
					variant.price
				);
			}

			// Handle out of stock items
			if (variant.stockQuantity < item.quantity) {
				return this.updateItemStatus(item, "outOfStock", variant.price);
			}

			// Calculate prices for active items
			const basePrice = Math.round(variant.price);
			let effectivePrice = basePrice;

			// Apply discounts if available and valid
			if (dbItem.discount?.active) {
				const now = new Date();
				if (
					now >= dbItem.discount.startDate &&
					now <= dbItem.discount.endDate
				) {
					effectivePrice = Math.round(
						basePrice * (1 - dbItem.discount.percentage / 100)
					);
				}
			}

			// Update item with new prices and status
			item.currentPrice = basePrice;
			item.effectivePrice = effectivePrice;
			item.status = "active";
			item.name = dbItem.name; // Keep name updated
			item.specifications = variant.specifications; // Keep specifications updated
			return item;
		});

		// Update cart items - keep all items but filter active ones for total calculations
		this.items = updatedItems;
		this.lastPriceUpdate = new Date();
		this.lastActive = new Date();

		// Update total calculations considering only active items
		this.itemCount = this.items.filter(
			(item: ICartItem) => item.status === "active"
		).length;
		const totals = this.items
			.filter((item: ICartItem) => item.status === "active")
			.reduce(
				(
					acc: { original: number; effective: number },
					item: ICartItem
				) => {
					acc.original += Math.round(
						item.currentPrice * item.quantity
					);
					acc.effective += Math.round(
						item.effectivePrice * item.quantity
					);
					return acc;
				},
				{ original: 0, effective: 0 }
			);

		this.totalOriginalPrice = totals.original;
		this.totalEffectivePrice = totals.effective;

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
