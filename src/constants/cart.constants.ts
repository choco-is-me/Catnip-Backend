// src/constants/cart.constants.ts

export const CART_CONSTANTS = {
	// Item limits
	MAX_CART_ITEMS: 30,

	// Value limits (in VND)
	MIN_ORDER_VALUE: 20_000, // 20,000 VND (~ $0.80 USD)
	MAX_ORDER_VALUE: 50_000_000, // 50,000,000 VND (~ $2,000 USD)

	// Currency
	CURRENCY: "VND" as const,

	// Error messages
	ERRORS: {
		MIN_ORDER: (min: number) =>
			`Order total must be at least ${min.toLocaleString()} VND`,
		MAX_ORDER: (max: number) =>
			`Order total cannot exceed ${max.toLocaleString()} VND`,
		INVALID_CURRENCY: "Only VND currency is supported",
		INVALID_PRICE: "Price must be an integer (VND does not use decimals)",
	},
} as const;

// Validation helpers
export const validateVNDValue = (value: number): boolean => {
	return Number.isInteger(value) && value >= 0;
};

export const formatVNDPrice = (price: number): string => {
	return `${Math.round(price).toLocaleString()} VND`;
};
