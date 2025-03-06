import { ICart } from "@/models/Cart";
import mongoose from "mongoose";

// Interface for cart item detail in sync response
export interface CartItemDetail {
	item: {
		_id: string | mongoose.Types.ObjectId;
		name: string;
		images?: string[];
		status?: string;
		description?: string;
	};
	variant: {
		sku: string;
		specifications?: Record<string, any>;
		price?: number;
		stockQuantity?: number;
		effectivePrice?: number;
		discountPercentage?: number;
	};
	quantity: number;
	itemTotal: number;
	isAvailable: boolean;
	hasChanged: boolean;
	stockStatus?: string;
	stockIssue?: string;
	quantityAdjusted?: boolean;
	suggestedQuantity?: number;
	severity?: "info" | "warning" | "error";
	actionRequired?: boolean;
	recommendation?: string;
	priceChanged?: boolean;
	previousPrice?: number;
	currentPrice?: number;
}

// Interface for cart sync response
export interface CartSyncResponse {
	cart: ICart;
	totals: {
		subtotal: number;
		totalItems: number;
		totalQuantity: number;
		isOrderBelowMinimum?: boolean;
		isOrderAboveMaximum?: boolean;
		minimumOrderValue?: number;
		maximumOrderValue?: number;
		orderMessage?: string;
		shortfall?: number;
		excess?: number;
	};
	itemDetails: CartItemDetail[];
	stockIssues?: Array<{
		itemId: string;
		variantSku: string;
		issue: string;
		severity?: "info" | "warning" | "error";
		actionRequired?: boolean;
		recommendation?: string;
	}>;
}
