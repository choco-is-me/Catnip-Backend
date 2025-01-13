import { Static, Type } from "@sinclair/typebox";
import * as dotenv from "dotenv";
dotenv.config();

const ConfigSchema = Type.Object({
	NODE_ENV: Type.Union([
		Type.Literal("development"),
		Type.Literal("production"),
		Type.Literal("test"),
	]),
	PORT: Type.Number(),
	HOST: Type.String(),
	MONGODB_URI: Type.String(),
	JWT_SECRET: Type.String(),
	JWT_EXPIRES_IN: Type.String(),
	LOG_LEVEL: Type.String(),
	CORS_ORIGIN: Type.String(),
	UPLOAD_DIR: Type.String(),
	ENCRYPTION_KEY: Type.String(),
	ENCRYPTION_IV: Type.String(),
});

// Validate environment variables
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
	throw new Error("ENCRYPTION_KEY must be exactly 32 characters long");
}

if (!process.env.ENCRYPTION_IV || process.env.ENCRYPTION_IV.length !== 16) {
	throw new Error("ENCRYPTION_IV must be exactly 16 characters long");
}

export type Config = Static<typeof ConfigSchema>;

export const CONFIG: Config = {
	NODE_ENV: (process.env.NODE_ENV as Config["NODE_ENV"]) || "development",
	PORT: parseInt(process.env.PORT || "3000", 10),
	HOST: process.env.HOST || "0.0.0.0",
	MONGODB_URI:
		process.env.MONGODB_URI ||
		"mongodb+srv://chocoisme:SpaceCatWillNeverFall@spacecatstudio.qphz1.mongodb.net/?retryWrites=true&w=majority&appName=SpaceCatStudio",
	JWT_SECRET: process.env.JWT_SECRET || "SpaceCatWillNeverFall",
	JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1d",
	LOG_LEVEL: process.env.LOG_LEVEL || "info",
	CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
	UPLOAD_DIR: process.env.UPLOAD_DIR || "./uploads",
	ENCRYPTION_KEY:
		process.env.ENCRYPTION_KEY || "1cd43ad6c3ae4513e293b08822bbb044",
	ENCRYPTION_IV: process.env.ENCRYPTION_IV || "d429f47a46b8295c",
};
