// src/plugins/mongodb.ts
import { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { CONFIG } from "../config";
import { Logger } from "../services/logger.service";

export async function connectDB() {
	try {
		await mongoose.connect(CONFIG.MONGODB_URI);
		// Use the Logger service instead of console.log
		Logger.info("📦 Connected to MongoDB successfully");
		return true;
	} catch (error) {
		Logger.error(error as Error, "MongoDB");
		return false;
	}
}

export async function disconnectDB() {
	try {
		await mongoose.disconnect();
		Logger.info("Disconnected from MongoDB");
	} catch (error) {
		Logger.error(error as Error, "MongoDB");
	}
}

export default async function dbPlugin(fastify: FastifyInstance) {
	fastify.addHook("onClose", async () => {
		await disconnectDB();
	});

	return connectDB();
}
