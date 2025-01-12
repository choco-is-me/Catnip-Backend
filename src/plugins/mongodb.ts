import mongoose from "mongoose";
import { FastifyInstance } from "fastify";
import { CONFIG } from "../config";

export async function connectDB() {
	try {
		await mongoose.connect(CONFIG.MONGODB_URI);
		console.log("📦 Connected to MongoDB successfully");
		return true;
	} catch (error) {
		console.error("Failed to connect to MongoDB:", error);
		return false;
	}
}

export async function disconnectDB() {
	try {
		await mongoose.disconnect();
		console.log("Disconnected from MongoDB");
	} catch (error) {
		console.error("Error disconnecting from MongoDB:", error);
	}
}

export default async function dbPlugin(fastify: FastifyInstance) {
	fastify.addHook("onClose", async () => {
		await disconnectDB();
	});

	return connectDB();
}
