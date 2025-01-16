import { Error } from "mongoose";

export interface ApiError {
	code?: number;
	error: string;
	message: string;
}

export const handleError = (error: unknown): ApiError => {
	if (error instanceof Error.ValidationError) {
		return {
			code: 400,
			error: "Validation Error",
			message: error.message,
		};
	}

	if (error instanceof Error.CastError) {
		return {
			code: 400,
			error: "Invalid Format",
			message: "Invalid ID format",
		};
	}

	if (error instanceof Error) {
		return {
			code: 500,
			error: "Server Error",
			message: error.message,
		};
	}

	return {
		code: 500,
		error: "Unknown Error",
		message: "An unexpected error occurred",
	};
};
