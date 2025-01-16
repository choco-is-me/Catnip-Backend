import mongoose from "mongoose";

interface StandardError {
	success: false;
	error: string;
	message: string;
	code: number;
}

export function handleError(err: any): StandardError {
	// Mongoose Validation Error
	if (err instanceof mongoose.Error.ValidationError) {
		return {
			success: false,
			error: "Validation Error",
			message: Object.values(err.errors)
				.map((error) => error.message)
				.join(", "),
			code: 400,
		};
	}

	// Mongoose Cast Error (Invalid ID)
	if (err instanceof mongoose.Error.CastError) {
		return {
			success: false,
			error: "Invalid ID",
			message: "The provided ID is invalid",
			code: 400,
		};
	}

	// Mongoose Duplicate Key Error
	if (err.code === 11000) {
		const field = Object.keys(err.keyPattern)[0];
		return {
			success: false,
			error: "Duplicate Error",
			message: `${field} already exists`,
			code: 409,
		};
	}

	// Fastify Validation Error
	if (err.validation || err.statusCode === 400) {
		return {
			success: false,
			error: "Validation Error",
			message: err.message || "Invalid input data",
			code: 400,
		};
	}

	// JWT Errors
	if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
		return {
			success: false,
			error: "Authentication Error",
			message: err.message || "Invalid or expired token",
			code: 401,
		};
	}

	// Default Error
	return {
		success: false,
		error: "Internal Server Error",
		message: err.message || "An unexpected error occurred",
		code: 500,
	};
}
