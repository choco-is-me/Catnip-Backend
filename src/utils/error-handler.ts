// src/utils/error-handler.ts
import { FastifyReply } from "fastify";
import mongoose from "mongoose";

interface StandardError {
	success: false;
	error: string;
	message: string;
	code: number;
}

// Common error types for consistency
export const ErrorTypes = {
	VALIDATION_ERROR: "Validation Error",
	NOT_FOUND: "Not Found",
	AUTHENTICATION_ERROR: "Authentication Error",
	DUPLICATE_ERROR: "Duplicate Error",
	FORBIDDEN: "Forbidden",
	RATE_LIMIT_ERROR: "Rate Limit Exceeded",
	INTERNAL_ERROR: "Internal Server Error",
} as const;

// Common error responses
export const createError = (
	code: number,
	error: string,
	message: string
): StandardError => ({
	success: false,
	error,
	message,
	code,
});

// Predefined error responses for common scenarios
export const CommonErrors = {
	userNotFound: (): StandardError =>
		createError(404, ErrorTypes.NOT_FOUND, "User not found"),

	cardNotFound: (): StandardError =>
		createError(404, ErrorTypes.NOT_FOUND, "Card not found"),

	invalidToken: (): StandardError =>
		createError(
			401,
			ErrorTypes.AUTHENTICATION_ERROR,
			"Invalid or expired token"
		),

	noToken: (): StandardError =>
		createError(401, ErrorTypes.AUTHENTICATION_ERROR, "No token provided"),

	forbidden: (): StandardError =>
		createError(
			403,
			ErrorTypes.FORBIDDEN,
			"You do not have permission to access this resource"
		),

	emailExists: (): StandardError =>
		createError(
			409,
			ErrorTypes.DUPLICATE_ERROR,
			"Email already registered"
		),

	invalidCredentials: (): StandardError =>
		createError(
			401,
			ErrorTypes.AUTHENTICATION_ERROR,
			"Invalid email or password"
		),
};

export function handleError(err: any): StandardError {
	// Handle Fastify validation errors first
	if (err.validation) {
		const message = err.validation.map((v: any) => v.message).join(", ");
		return createError(400, ErrorTypes.VALIDATION_ERROR, message);
	}

	// Mongoose Validation Error
	if (err instanceof mongoose.Error.ValidationError) {
		return createError(
			400,
			ErrorTypes.VALIDATION_ERROR,
			Object.values(err.errors)
				.map((error) => error.message)
				.join(", ")
		);
	}

	// Mongoose Cast Error (Invalid ID)
	if (err instanceof mongoose.Error.CastError) {
		return createError(
			400,
			ErrorTypes.VALIDATION_ERROR,
			"The provided ID is invalid"
		);
	}

	// Mongoose Duplicate Key Error
	if (err.code === 11000) {
		const field = Object.keys(err.keyPattern)[0];
		return createError(
			409,
			ErrorTypes.DUPLICATE_ERROR,
			`${field} already exists`
		);
	}

	// Fastify Validation Error
	if (err.statusCode === 400) {
		return createError(
			400,
			ErrorTypes.VALIDATION_ERROR,
			err.message || "Invalid input data"
		);
	}

	// JWT Errors
	if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
		return createError(
			401,
			ErrorTypes.AUTHENTICATION_ERROR,
			err.message || "Invalid or expired token"
		);
	}

	// Rate Limit Error
	if (err.statusCode === 429) {
		return createError(
			429,
			ErrorTypes.RATE_LIMIT_ERROR,
			`Rate limit exceeded, please try again in ${err.after}`
		);
	}

	// If it's already a StandardError, return it
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

export const sendError = (
	reply: FastifyReply,
	error: Error | StandardError
): FastifyReply => {
	const standardError = error instanceof Error ? handleError(error) : error;
	return reply.code(standardError.code).send(standardError);
};
