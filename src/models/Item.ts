// src/models/Item.ts
import mongoose, { Document, Schema } from "mongoose";
import {
	CURRENCY_CONSTANTS,
	formatVNDPrice,
	validateVNDPrice,
} from "../constants/currency.constants";
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
			validate: {
				validator: function (value: number): boolean {
					return validateVNDPrice(value);
				},
				message: function (props: { value: number }): string {
					if (!Number.isInteger(props.value)) {
						return CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE;
					}
					return props.value < CURRENCY_CONSTANTS.ITEM.MIN_PRICE ||
						props.value > CURRENCY_CONSTANTS.ITEM.MAX_PRICE
						? CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE_RANGE(
								CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
								CURRENCY_CONSTANTS.ITEM.MAX_PRICE
						  )
						: CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE;
				},
			},
			get: function (price: number) {
				return price;
			},
			set: function (price: number) {
				// Ensure integer values for VND
				return Math.round(price);
			},
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
ItemSchema.index(
	{
		name: "text",
		description: "text",
		tags: "text",
	},
	{
		weights: {
			name: 10, // Name matches are most important
			tags: 5, // Tags are second priority
			description: 1, // Description matches are lowest priority
		},
		name: "items_text_index",
	}
);
ItemSchema.index({ "variants.sku": 1 });
ItemSchema.index({ "ratings.average": -1 });
ItemSchema.index({ numberOfSales: -1 });
ItemSchema.index({ status: 1 });
ItemSchema.index({
	"discount.active": 1,
	"discount.startDate": 1,
	"discount.endDate": 1,
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
	let currentPrice = variantSku
		? this.variants.find((v: IVariant) => v.sku === variantSku)?.price ||
		  this.currentPrice
		: this.currentPrice;

	if (this.discount?.active) {
		const now = new Date();
		if (now >= this.discount.startDate && now <= this.discount.endDate) {
			return Math.round(
				currentPrice * (1 - this.discount.percentage / 100)
			);
		}
	}
	return currentPrice;
};

// Add methods for price validation
ItemSchema.methods.validateVariantPrices = function (): boolean {
	return this.variants.every((variant: IVariant) =>
		validateVNDPrice(variant.price)
	);
};

ItemSchema.methods.formatPrice = function (price: number): string {
	return formatVNDPrice(price);
};

// Add middleware to validate all prices before save
ItemSchema.pre("save", function (next) {
	try {
		// Validate all variant prices
		this.variants.forEach((variant: IVariant, index: number) => {
			if (!validateVNDPrice(variant.price)) {
				throw new Error(
					`Price for variant ${variant.sku} (${formatVNDPrice(
						variant.price
					)}) is invalid. ${CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE_RANGE(
						CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
						CURRENCY_CONSTANTS.ITEM.MAX_PRICE
					)}`
				);
			}
		});

		next();
	} catch (error) {
		next(error as Error);
	}
});

export const Item = mongoose.model<IItem>("Item", ItemSchema);

// Log model registration
Logger.info("Item model registered", "ItemModel");
