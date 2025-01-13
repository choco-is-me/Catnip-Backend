import bcrypt from "bcrypt";
import mongoose, { CallbackError, Document, Schema, Types } from "mongoose";

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
			unique: true,
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
	if (!this.isModified("password")) return next();

	try {
		const salt = await bcrypt.genSalt(10);
		this.password = await bcrypt.hash(this.password, salt);
		return next();
	} catch (error) {
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
		return await bcrypt.compare(candidatePassword, this.password);
	} catch (error) {
		throw new Error("Error comparing passwords");
	}
};

export const User = mongoose.model<IUser>("User", UserSchema);
