// src/constants/currency.constants.ts

export const CURRENCY_CONSTANTS = {
	// Currency configuration
	CURRENCY: "VND" as const,

	// Cart limits
	CART: {
		MAX_ITEMS: 30,
		MIN_ORDER_VALUE: 20_000, // 20,000 VND (~ $0.80 USD)
		MAX_ORDER_VALUE: 50_000_000, // 50,000 VND (~ $2,000 USD)
	},

	// Item price limits
	ITEM: {
		MIN_PRICE: 1_000, // 1,000 VND
		MAX_PRICE: 1_000_000_000, // 1 billion VND
	},

	// Error messages
	ERRORS: {
		// Cart related errors
		MIN_ORDER: (min: number) =>
			`Order total must be at least ${min.toLocaleString()} VND`,
		MAX_ORDER: (max: number) =>
			`Order total cannot exceed ${max.toLocaleString()} VND`,

		// General currency errors
		INVALID_CURRENCY: "Only VND currency is supported",
		INVALID_PRICE: "Price must be an integer (VND does not use decimals)",
		INVALID_PRICE_RANGE: (min: number, max: number) =>
			`Price must be between ${min.toLocaleString()} VND and ${max.toLocaleString()} VND`,
		INVALID_DISCOUNT: "Discount calculation resulted in invalid VND amount",
	},
} as const;

/**
 * Validates if a value is a valid VND amount (integer >= 0)
 */
export const validateVNDValue = (value: number): boolean => {
	return Number.isInteger(value) && value >= 0;
};

/**
 * Validates if a price is within allowed range for items
 */
export const validateVNDPrice = (value: number): boolean => {
	return (
		validateVNDValue(value) &&
		value >= CURRENCY_CONSTANTS.ITEM.MIN_PRICE &&
		value <= CURRENCY_CONSTANTS.ITEM.MAX_PRICE
	);
};

/**
 * Validates if an order total is within allowed range
 */
export const validateVNDOrderTotal = (value: number): boolean => {
	return (
		validateVNDValue(value) &&
		value >= CURRENCY_CONSTANTS.CART.MIN_ORDER_VALUE &&
		value <= CURRENCY_CONSTANTS.CART.MAX_ORDER_VALUE
	);
};

/**
 * Formats a number as VND price string
 */
export const formatVNDPrice = (price: number): string => {
	return `${Math.round(price).toLocaleString()} VND`;
};

/**
 * Calculates discounted price ensuring VND integer values
 */
export const calculateVNDDiscount = (
	originalPrice: number,
	discountPercentage: number
): number => {
	if (!validateVNDPrice(originalPrice)) {
		throw new Error(CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE);
	}

	if (discountPercentage < 0 || discountPercentage > 100) {
		throw new Error("Discount percentage must be between 0 and 100");
	}

	const discountedPrice = Math.round(
		originalPrice * (1 - discountPercentage / 100)
	);

	if (!validateVNDPrice(discountedPrice)) {
		throw new Error(CURRENCY_CONSTANTS.ERRORS.INVALID_DISCOUNT);
	}

	return discountedPrice;
};
