// src/services/logger.service.ts
import chalk from "chalk"; // You'll need to install this: npm install chalk
import { CONFIG } from "../config";

export class Logger {
	private static formatMessage(
		level: string,
		message: string,
		context?: string
	): string {
		const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
		const contextStr = context ? ` [${context}]` : "";
		return `${timestamp} ${level}${contextStr}: ${message}`;
	}

	static error(error: Error, context?: string) {
		const message = this.formatMessage("ERROR", error.message, context);
		console.error(chalk.red(message));

		if (CONFIG.NODE_ENV === "development" && error.stack) {
			console.error(chalk.red(error.stack));
		}
	}

	static info(message: string, context?: string) {
		if (CONFIG.LOG_LEVEL === "info") {
			const formattedMessage = this.formatMessage(
				"INFO",
				message,
				context
			);
			console.log(chalk.blue(formattedMessage));
		}
	}

	static warn(message: string, context?: string) {
		const formattedMessage = this.formatMessage("WARN", message, context);
		console.warn(chalk.yellow(formattedMessage));
	}

	static debug(message: string, context?: string) {
		if (CONFIG.NODE_ENV === "development") {
			const formattedMessage = this.formatMessage(
				"DEBUG",
				message,
				context
			);
			console.debug(chalk.gray(formattedMessage));
		}
	}
}
