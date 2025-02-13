// src/utils/error-handler.ts
import { FastifyReply } from "fastify";
import mongoose from "mongoose";

interface StandardError {
	success: false;
	error: string;
	message: string;
	code: number;
}

// Enhanced error types for consistency
export const ErrorTypes = {
	// Card Validation Errors
	CARD_VALIDATION_ERROR: "Card Validation Error",
	CARD_FORMAT_ERROR: "Card Format Error",
	CARD_NETWORK_ERROR: "Card Network Error",
	CARD_EXPIRED_ERROR: "Card Expired",
	CARD_SECURITY_ERROR: "Card Security Error",
	CARD_LIMIT_ERROR: "Card Limit Error",

	// Fingerprint related errors
	FINGERPRINT_MISMATCH: "Fingerprint Mismatch",
	FINGERPRINT_MISSING: "Fingerprint Missing",
	FINGERPRINT_INVALID: "Invalid Fingerprint",

	// Validation Errors
	VALIDATION_ERROR: "Validation Error",
	INVALID_INPUT: "Invalid Input",
	INVALID_FORMAT: "Invalid Format",
	MISSING_FIELDS: "Missing Fields",

	// Authentication Errors
	AUTHENTICATION_ERROR: "Authentication Error",
	INVALID_CREDENTIALS: "Invalid Credentials",
	TOKEN_EXPIRED: "Token Expired",
	TOKEN_INVALID: "Token Invalid",
	TOKEN_MISSING: "Token Missing",
	TOKEN_REVOKED: "Token Revoked",
	TOKEN_REUSE: "Token Reuse Detected",
	INVALID_TOKEN_TYPE: "Invalid Token Type",
	INVALID_TOKEN_SUBJECT: "Invalid Token Subject",

	// Authorization Errors
	FORBIDDEN: "Forbidden",
	INSUFFICIENT_PERMISSIONS: "Insufficient Permissions",
	ACCOUNT_LOCKED: "Account Locked",

	// Resource Errors
	NOT_FOUND: "Not Found",
	DUPLICATE_ERROR: "Duplicate Error",
	RESOURCE_CONFLICT: "Resource Conflict",
	RESOURCE_EXPIRED: "Resource Expired",
	ITEM_NOT_FOUND: "Item Not Found",
	SUPPLIER_NOT_FOUND: "Supplier Not Found",

	// Rate Limiting Errors
	RATE_LIMIT_ERROR: "Rate Limit Exceeded",
	TOO_MANY_REQUESTS: "Too Many Requests",

	// Session Errors
	SESSION_EXPIRED: "Session Expired",
	SESSION_INVALID: "Session Invalid",

	// Database Errors
	DATABASE_ERROR: "Database Error",
	TRANSACTION_ERROR: "Transaction Error",
	CONNECTION_ERROR: "Connection Error",

	// Server Errors
	INTERNAL_ERROR: "Internal Server Error",
	SERVICE_UNAVAILABLE: "Service Unavailable",
	TIMEOUT_ERROR: "Timeout Error",

	// Security Errors
	SECURITY_ERROR: "Security Error",
	SUSPICIOUS_ACTIVITY: "Suspicious Activity",
	INVALID_IP: "Invalid IP",

	// Cookie Errors
	COOKIE_ERROR: "Cookie Error",
	COOKIE_MISSING: "Cookie Missing",
	COOKIE_INVALID: "Cookie Invalid",

	// Business Logic Errors
	BUSINESS_ERROR: "Business Rule Violation",
	INVALID_STATE: "Invalid State",
	OPERATION_NOT_ALLOWED: "Operation Not Allowed",
} as const;

// Create error with optional details
export const createError = (
	code: number,
	error: string,
	message: string,
	details?: Record<string, any>
): StandardError => ({
	success: false,
	error,
	message,
	code,
	...(details ? { details } : {}),
});

// Enhanced predefined error responses
export const CommonErrors = {
	// Card errors
	cardNotFound: () =>
		createError(404, ErrorTypes.NOT_FOUND, "Card not found"),

	invalidCardNetwork: () =>
		createError(
			400,
			ErrorTypes.CARD_NETWORK_ERROR,
			"Unsupported card network. Only Visa and Mastercard are accepted"
		),

	invalidCardFormat: (network: string) =>
		createError(
			400,
			ErrorTypes.CARD_FORMAT_ERROR,
			`Invalid ${network} card number format`
		),

	invalidLuhnCheck: () =>
		createError(
			400,
			ErrorTypes.CARD_VALIDATION_ERROR,
			"Invalid card number (failed checksum validation)"
		),

	expiredCard: () =>
		createError(
			400,
			ErrorTypes.CARD_EXPIRED_ERROR,
			"Card has expired or expiration date is invalid"
		),

	cardLimitExceeded: (limit: number) =>
		createError(
			400,
			ErrorTypes.CARD_LIMIT_ERROR,
			`Maximum card limit (${limit}) reached for this account`
		),

	duplicateCard: () =>
		createError(
			409,
			ErrorTypes.DUPLICATE_ERROR,
			"This card is already registered to your account"
		),

	cardSecurityError: () =>
		createError(
			403,
			ErrorTypes.CARD_SECURITY_ERROR,
			"This card is registered to another account"
		),

	// Fingerprint related errors
	fingerprintMismatch: () =>
		createError(
			401,
			ErrorTypes.FINGERPRINT_MISMATCH,
			"Token fingerprint mismatch detected"
		),

	fingerprintMissing: () =>
		createError(
			400,
			ErrorTypes.FINGERPRINT_MISSING,
			"Required fingerprint data missing"
		),

	fingerprintInvalid: () =>
		createError(
			400,
			ErrorTypes.FINGERPRINT_INVALID,
			"Invalid fingerprint format"
		),

	// User related errors
	userNotFound: () =>
		createError(404, ErrorTypes.NOT_FOUND, "User not found"),

	emailExists: () =>
		createError(
			409,
			ErrorTypes.DUPLICATE_ERROR,
			"Email already registered"
		),

	invalidCredentials: () =>
		createError(
			401,
			ErrorTypes.INVALID_CREDENTIALS,
			"Invalid email or password"
		),

	accountLocked: (reason?: string) =>
		createError(
			403,
			ErrorTypes.ACCOUNT_LOCKED,
			reason || "Account has been locked"
		),

	// Authentication errors
	invalidToken: () =>
		createError(401, ErrorTypes.TOKEN_INVALID, "Invalid or expired token"),

	noToken: () =>
		createError(401, ErrorTypes.TOKEN_MISSING, "No token provided"),

	tokenExpired: () =>
		createError(401, ErrorTypes.TOKEN_EXPIRED, "Token has expired"),

	tokenRevoked: () =>
		createError(401, ErrorTypes.TOKEN_REVOKED, "Token has been revoked"),

	tokenReused: () =>
		createError(401, ErrorTypes.TOKEN_REUSE, "Token reuse detected"),

	invalidTokenType: () =>
		createError(401, ErrorTypes.INVALID_TOKEN_TYPE, "Invalid token type"),

	// Authorization errors
	forbidden: () =>
		createError(
			403,
			ErrorTypes.FORBIDDEN,
			"You do not have permission to access this resource"
		),

	insufficientPermissions: (requiredPermission?: string) =>
		createError(
			403,
			ErrorTypes.INSUFFICIENT_PERMISSIONS,
			requiredPermission
				? `Insufficient permissions. Required: ${requiredPermission}`
				: "Insufficient permissions to perform this action"
		),

	insufficientRole: (requiredRole: string) =>
		createError(
			403,
			ErrorTypes.FORBIDDEN,
			`This operation requires ${requiredRole} role`
		),

	// Resource errors
	resourceConflict: (resource: string) =>
		createError(
			409,
			ErrorTypes.RESOURCE_CONFLICT,
			`${resource} already exists or conflicts with existing resource`
		),

	// Item errors
	itemNotFound: () =>
		createError(404, ErrorTypes.ITEM_NOT_FOUND, "Item not found"),

	// Supplier errors
	supplierNotFound: () =>
		createError(404, ErrorTypes.SUPPLIER_NOT_FOUND, "Supplier not found"),

	// Rate limiting errors
	rateLimitExceeded: (timeWindow: string) =>
		createError(
			429,
			ErrorTypes.RATE_LIMIT_ERROR,
			`Rate limit exceeded. Please try again in ${timeWindow}`
		),

	// Session errors
	sessionExpired: () =>
		createError(
			401,
			ErrorTypes.SESSION_EXPIRED,
			"Your session has expired. Please log in again"
		),

	sessionInvalid: () =>
		createError(
			401,
			ErrorTypes.SESSION_INVALID,
			"Invalid session. Please log in again"
		),

	// Cookie errors
	cookieError: (cookieName: string) =>
		createError(
			400,
			ErrorTypes.COOKIE_ERROR,
			`Error processing cookie: ${cookieName}`
		),

	cookieMissing: (cookieName: string) =>
		createError(
			400,
			ErrorTypes.COOKIE_MISSING,
			`Required cookie missing: ${cookieName}`
		),

	// Database errors
	databaseError: (operation: string) =>
		createError(
			500,
			ErrorTypes.DATABASE_ERROR,
			`Database error during ${operation}`
		),

	transactionError: () =>
		createError(
			500,
			ErrorTypes.TRANSACTION_ERROR,
			"Transaction failed to complete"
		),

	// Validation errors
	invalidFormat: (field: string) =>
		createError(
			400,
			ErrorTypes.INVALID_FORMAT,
			`Invalid format for ${field}`
		),

	missingFields: (fields: string[]) =>
		createError(
			400,
			ErrorTypes.MISSING_FIELDS,
			`Missing required fields: ${fields.join(", ")}`
		),

	// Security errors
	suspiciousActivity: () =>
		createError(
			403,
			ErrorTypes.SUSPICIOUS_ACTIVITY,
			"Suspicious activity detected"
		),

	invalidIP: () =>
		createError(
			403,
			ErrorTypes.INVALID_IP,
			"Access denied from this IP address"
		),

	// Server Errors
	internalError: (message: string = "Internal server error") =>
		createError(500, ErrorTypes.INTERNAL_ERROR, message),

	configError: (component: string) =>
		createError(
			500,
			ErrorTypes.INTERNAL_ERROR,
			`Configuration error in ${component}`
		),

	serviceError: (service: string, action: string) =>
		createError(
			500,
			ErrorTypes.INTERNAL_ERROR,
			`${service} service error during ${action}`
		),
};

// Enhanced error handling function
export function handleError(err: any): StandardError {
	// Fastify validation errors
	if (err.validation) {
		return createError(
			400,
			ErrorTypes.VALIDATION_ERROR,
			err.validation.map((v: any) => v.message).join(", ")
		);
	}

	// Mongoose specific errors
	if (err instanceof mongoose.Error) {
		// Validation Error
		if (err instanceof mongoose.Error.ValidationError) {
			return createError(
				400,
				ErrorTypes.VALIDATION_ERROR,
				Object.values(err.errors)
					.map((error) => error.message)
					.join(", ")
			);
		}

		// Cast Error (Invalid ID)
		if (err instanceof mongoose.Error.CastError) {
			return createError(
				400,
				ErrorTypes.INVALID_FORMAT,
				`Invalid format for ${err.path}: ${err.value}`
			);
		}
	}

	// MongoDB Server Error (includes duplicate key errors)
	// Using type assertion for MongoDB specific error properties
	if (err instanceof Error && (err as any).code === 11000) {
		const mongoError = err as any;
		const field = mongoError.keyPattern
			? Object.keys(mongoError.keyPattern)[0]
			: "field";
		return createError(
			409,
			ErrorTypes.DUPLICATE_ERROR,
			`${field} already exists`
		);
	}

	// JWT Errors
	if (err.name === "JsonWebTokenError") {
		return createError(
			401,
			ErrorTypes.TOKEN_INVALID,
			"Invalid token format or signature"
		);
	}

	if (err.name === "TokenExpiredError") {
		return createError(401, ErrorTypes.TOKEN_EXPIRED, "Token has expired");
	}

	// Rate Limit Error
	if (err.statusCode === 429) {
		return createError(
			429,
			ErrorTypes.RATE_LIMIT_ERROR,
			`Rate limit exceeded, please try again in ${err.after}`
		);
	}

	// Check if it's already a StandardError
	if (err.success === false && err.code && err.error && err.message) {
		return err as StandardError;
	}

	// Default Error
	return createError(
		500,
		ErrorTypes.INTERNAL_ERROR,
		err.message || "An unexpected error occurred"
	);
}

// Enhanced error sending function
export const sendError = (
	reply: FastifyReply,
	error: Error | StandardError
): FastifyReply => {
	const standardError = error instanceof Error ? handleError(error) : error;
	return reply.code(standardError.code).send(standardError);
};

// Helper function to create validation errors
export const createValidationError = (message: string): StandardError =>
	createError(400, ErrorTypes.VALIDATION_ERROR, message);

// Helper function to create business logic errors
export const createBusinessError = (message: string): StandardError =>
	createError(422, ErrorTypes.BUSINESS_ERROR, message);

// Helper function to create security errors
export const createSecurityError = (message: string): StandardError =>
	createError(403, ErrorTypes.SECURITY_ERROR, message);
