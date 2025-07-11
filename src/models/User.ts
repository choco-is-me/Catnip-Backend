// src/models/User.ts
import bcrypt from 'bcrypt';
import mongoose, { CallbackError, Document, Schema, Types } from 'mongoose';
import { CONFIG } from '../config';
import { Logger } from '../services/logger.service';

export type UserRole = 'user' | 'admin';
export type UserGender = 'male' | 'female' | 'other';

export interface IUser extends Document {
    _id: Types.ObjectId;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    phoneNumber: string;
    birthday?: Date;
    gender?: UserGender;
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
        role: {
            type: String,
            enum: ['user', 'admin'],
            default: 'user',
            required: true,
        },
        phoneNumber: {
            type: String,
            required: true,
            trim: true,
            validate: {
                validator: function (v: string) {
                    return /^(0[3|5|7|8|9])+([0-9]{8})$/.test(v);
                },
                message: 'Phone number must be a valid Vietnamese phone number',
            },
        },
        birthday: {
            type: Date,
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other'],
        },
    },
    {
        timestamps: true,
    },
);

// Prevent role modification after creation
UserSchema.pre('save', async function (next) {
    if (!this.isNew && this.isModified('role')) {
        const err = new Error('Role cannot be modified after creation');
        return next(err as CallbackError);
    }
    next();
});

// Hash password before saving
UserSchema.pre('save', async function (next) {
    try {
        if (!this.isModified('password')) {
            Logger.debug('Password not modified, skipping hash', 'UserModel');
            return next();
        }

        Logger.debug(`Hashing password for user: ${this._id}`, 'UserModel');
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        Logger.debug('Password hashed successfully', 'UserModel');
        return next();
    } catch (error) {
        Logger.error(error as Error, 'UserModel');
        const callbackError: CallbackError =
            error instanceof Error
                ? new Error(error.message)
                : new Error('An error occurred while hashing the password');
        return next(callbackError);
    }
});

// Method to compare password
UserSchema.methods.comparePassword = async function (
    candidatePassword: string,
): Promise<boolean> {
    try {
        Logger.debug(`Comparing password for user: ${this._id}`, 'UserModel');
        const isMatch = await bcrypt.compare(candidatePassword, this.password);
        Logger.debug(
            `Password comparison result: ${
                isMatch ? 'matched' : 'did not match'
            }`,
            'UserModel',
        );
        return isMatch;
    } catch (error) {
        Logger.error(error as Error, 'UserModel');
        throw new Error('Error comparing passwords');
    }
};

// Create admin user if it doesn't exist
async function createAdminUser() {
    try {
        const adminEmail = 'chocoisme.spacecat@gmail.com';
        const existingAdmin = await User.findOne({ email: adminEmail });

        if (!existingAdmin) {
            const adminUser = new User({
                email: CONFIG.ADMIN_EMAIL,
                password: CONFIG.ADMIN_PASSWORD,
                firstName: 'Admin',
                lastName: 'SpaceCat',
                role: 'admin',
                phoneNumber: '0912345678',
            });

            await adminUser.save();
            Logger.info('Admin user created successfully', 'UserModel');
        }
    } catch (error) {
        Logger.error(error as Error, 'UserModel');
        // Don't throw error here to prevent app startup failure
        // Just log the error and continue
    }
}

// Log index creation
UserSchema.on('index', function (error) {
    if (error) {
        Logger.error(
            new Error(`Index creation error: ${error.message}`),
            'UserModel',
        );
    } else {
        Logger.info('User indexes created successfully', 'UserModel');
    }
});

export const User = mongoose.model<IUser>('User', UserSchema);

// Create admin user after model is registered
createAdminUser();

// Log model registration
Logger.info('User model registered', 'UserModel');
