// src/models/User.ts
import bcrypt from "bcrypt";
import mongoose, { CallbackError, Document, Schema, Types } from "mongoose";
import { Logger } from "../services/logger.service";

export interface IUser extends Document {
	_id: Types.ObjectId;
	email: string;
	password: string;
	firstName: string;
	lastName: string;
	company?: string;
	address: {
		street: string;
		city: string;
		province: string;
		zipCode: string;
	};
	phoneNumber: string;
	createdAt: Date;
	updatedAt: Date;
	comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
	{
		email: {
			type: String,
			required: true,
			unique: true, // This creates an index automatically
			lowercase: true,
			trim: true,
		},
		password: {
			type: String,
			required: true,
			minlength: 8,
		},
		firstName: {
			type: String,
			required: true,
			trim: true,
		},
		lastName: {
			type: String,
			required: true,
			trim: true,
		},
		company: {
			type: String,
			trim: true,
		},
		address: {
			street: {
				type: String,
				required: true,
				trim: true,
			},
			city: {
				type: String,
				required: true,
				trim: true,
			},
			province: {
				type: String,
				required: true,
				trim: true,
			},
			zipCode: {
				type: String,
				required: true,
				trim: true,
			},
		},
		phoneNumber: {
			type: String,
			required: true,
			trim: true,
		},
	},
	{
		timestamps: true,
	}
);

// Hash password before saving
UserSchema.pre("save", async function (next) {
	try {
		if (!this.isModified("password")) {
			Logger.debug("Password not modified, skipping hash", "UserModel");
			return next();
		}

		Logger.debug(`Hashing password for user: ${this._id}`, "UserModel");
		const salt = await bcrypt.genSalt(10);
		this.password = await bcrypt.hash(this.password, salt);
		Logger.debug("Password hashed successfully", "UserModel");
		return next();
	} catch (error) {
		Logger.error(error as Error, "UserModel");
		const callbackError: CallbackError =
			error instanceof Error
				? new Error(error.message)
				: new Error("An error occurred while hashing the password");
		return next(callbackError);
	}
});

// Method to compare password
UserSchema.methods.comparePassword = async function (
	candidatePassword: string
): Promise<boolean> {
	try {
		Logger.debug(`Comparing password for user: ${this._id}`, "UserModel");
		const isMatch = await bcrypt.compare(candidatePassword, this.password);
		Logger.debug(
			`Password comparison result: ${
				isMatch ? "matched" : "did not match"
			}`,
			"UserModel"
		);
		return isMatch;
	} catch (error) {
		Logger.error(error as Error, "UserModel");
		throw new Error("Error comparing passwords");
	}
};

// Log index creation
UserSchema.on("index", function (error) {
	if (error) {
		Logger.error(
			new Error(`Index creation error: ${error.message}`),
			"UserModel"
		);
	} else {
		Logger.info("User indexes created successfully", "UserModel");
	}
});

export const User = mongoose.model<IUser>("User", UserSchema);

// Log model registration
Logger.info("User model registered", "UserModel");
