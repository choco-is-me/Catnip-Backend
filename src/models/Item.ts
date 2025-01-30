// src/models/Item.ts
import mongoose, { Document, Schema } from "mongoose";
import { Logger } from "../services/logger.service";

// Interface for dynamic specifications
export interface ISpecification {
	[key: string]: string | number | boolean | Array<string>;
}

// Interface for variant with improved stock tracking
export interface IVariant {
	sku: string;
	specifications: ISpecification;
	price: number;
	stockQuantity: number;
	lowStockThreshold?: number;
}

// Interface for price history with retention
export interface IPriceHistory {
	price: number;
	date: Date;
}

// Interface for discount with validation
export interface IDiscount {
	percentage: number;
	startDate: Date;
	endDate: Date;
	active: boolean;
}

// Main Item interface
export interface IItem extends Document {
	name: string;
	description: string;
	basePrice: number;
	priceHistory: IPriceHistory[];
	images: string[];
	tags: string[];
	variants: IVariant[];
	supplier: mongoose.Types.ObjectId;
	ratings: {
		average: number;
		count: number;
		reviewCount: number;
	};
	numberOfSales: number;
	status: "active" | "discontinued" | "draft";
	discount?: IDiscount;
	createdAt: Date;
	updatedAt: Date;
}

const SpecificationSchema = new Schema({}, { strict: false, _id: false });

const VariantSchema = new Schema(
	{
		sku: {
			type: String,
			required: true,
			trim: true,
		},
		specifications: SpecificationSchema,
		price: {
			type: Number,
			required: true,
			min: 0,
		},
		stockQuantity: {
			type: Number,
			required: true,
			min: 0,
			default: 0,
		},
		lowStockThreshold: {
			type: Number,
			min: 0,
		},
	},
	{ _id: false }
);

const PriceHistorySchema = new Schema(
	{
		price: {
			type: Number,
			required: true,
		},
		date: {
			type: Date,
			default: Date.now,
		},
	},
	{ _id: false }
);

const DiscountSchema = new Schema(
	{
		percentage: {
			type: Number,
			required: true,
			min: 0,
			max: 100,
		},
		startDate: {
			type: Date,
			required: true,
		},
		endDate: {
			type: Date,
			required: true,
		},
		active: {
			type: Boolean,
			default: true,
		},
	},
	{ _id: false }
);

const ItemSchema = new Schema<IItem>(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			index: true,
		},
		description: {
			type: String,
			required: true,
			trim: true,
		},
		basePrice: {
			type: Number,
			required: true,
			min: 0,
		},
		priceHistory: [PriceHistorySchema],
		images: [
			{
				type: String,
				required: true,
			},
		],
		tags: [
			{
				type: String,
				trim: true,
				lowercase: true,
				index: true,
			},
		],
		variants: [VariantSchema],
		supplier: {
			type: Schema.Types.ObjectId,
			ref: "Supplier",
			required: true,
		},
		ratings: {
			average: {
				type: Number,
				default: 0,
				min: 0,
				max: 5,
			},
			count: {
				type: Number,
				default: 0,
				min: 0,
			},
			reviewCount: {
				type: Number,
				default: 0,
				min: 0,
			},
		},
		numberOfSales: {
			type: Number,
			default: 0,
			min: 0,
		},
		status: {
			type: String,
			enum: ["active", "discontinued", "draft"],
			default: "draft",
		},
		discount: DiscountSchema,
	},
	{
		timestamps: true,
	}
);

// Indexes for efficient querying
ItemSchema.index({ name: "text", description: "text" });
ItemSchema.index({ "variants.sku": 1 });
ItemSchema.index({ "ratings.average": -1 });
ItemSchema.index({ numberOfSales: -1 });
ItemSchema.index({ basePrice: 1 });
ItemSchema.index({ status: 1 });
ItemSchema.index({
	"discount.active": 1,
	"discount.startDate": 1,
	"discount.endDate": 1,
});

// Pre-save middleware to update price history
ItemSchema.pre("save", function (next) {
	if (this.isModified("basePrice")) {
		this.priceHistory.push({
			price: this.basePrice,
			date: new Date(),
		});

		// Keep only last 365 days of price history
		const oneYearAgo = new Date();
		oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
		this.priceHistory = this.priceHistory.filter(
			(ph) => ph.date >= oneYearAgo
		);
	}
	next();
});

// Method to check stock status of a variant
ItemSchema.methods.getStockStatus = function (
	variantSku: string
): "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" {
	const variant = this.variants.find((v: IVariant) => v.sku === variantSku);
	if (!variant) return "OUT_OF_STOCK";

	if (variant.stockQuantity === 0) return "OUT_OF_STOCK";
	if (
		variant.lowStockThreshold &&
		variant.stockQuantity <= variant.lowStockThreshold
	)
		return "LOW_STOCK";
	return "IN_STOCK";
};

// Method to get current price (considering discounts)
ItemSchema.methods.getCurrentPrice = function (variantSku?: string): number {
	let basePrice = variantSku
		? this.variants.find((v: IVariant) => v.sku === variantSku)?.price ||
		  this.basePrice
		: this.basePrice;

	if (this.discount && this.discount.active) {
		const now = new Date();
		if (now >= this.discount.startDate && now <= this.discount.endDate) {
			return basePrice * (1 - this.discount.percentage / 100);
		}
	}
	return basePrice;
};

export const Item = mongoose.model<IItem>("Item", ItemSchema);

// Log model registration
Logger.info("Item model registered", "ItemModel");
