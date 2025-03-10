// src/models/Token.ts
import mongoose, { Document, Schema, Types } from 'mongoose';
import { Logger } from '../services/logger.service';

export interface IInvalidatedToken extends Document {
    jti: string;
    expiryTime: Date;
    tokenType: 'access' | 'refresh';
    familyId?: string;
    createdAt: Date;
}

export interface IDeviceInfo {
    deviceId: string;
    lastActive: Date;
    deviceName?: string;
    deviceType?: string;
    browserInfo?: string;
    osInfo?: string;
}

export interface ITokenFamily extends Document {
    familyId: string;
    userId: Types.ObjectId;
    fingerprint: string;
    validUntil: Date;
    lastRotation: Date;
    reuseDetected: boolean;
    deviceInfo: IDeviceInfo;
    createdAt: Date;
    updatedAt: Date;
}

interface TokenFamilyModel extends mongoose.Model<ITokenFamily> {
    findActiveSessionsByUserId(userId: string): Promise<ITokenFamily[]>;
    invalidateAllUserSessions(userId: string): Promise<any>;
    cleanupExpiredFamilies(): Promise<any>;
}

// Schema for invalidated tokens
const InvalidatedTokenSchema = new Schema<IInvalidatedToken>({
    jti: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    expiryTime: {
        type: Date,
        required: true,
        index: true,
    },
    tokenType: {
        type: String,
        enum: ['access', 'refresh'],
        required: true,
        index: true,
    },
    familyId: {
        type: String,
        sparse: true,
        index: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: '30d',
    },
});

// Add compound index for faster queries
InvalidatedTokenSchema.index({ tokenType: 1, expiryTime: 1 });

// Schema for device info
const DeviceInfoSchema = new Schema<IDeviceInfo>({
    deviceId: {
        type: String,
        required: true,
    },
    lastActive: {
        type: Date,
        required: true,
        default: Date.now,
    },
    deviceName: String,
    deviceType: String,
    browserInfo: String,
    osInfo: String,
});

// Schema for token families
const TokenFamilySchema = new Schema<ITokenFamily>(
    {
        familyId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        } as any,
        fingerprint: {
            type: String,
            required: true,
            index: true,
        },
        validUntil: {
            type: Date,
            required: true,
        },
        lastRotation: {
            type: Date,
            required: true,
            index: true,
        },
        reuseDetected: {
            type: Boolean,
            default: false,
            index: true,
        },
        deviceInfo: {
            type: DeviceInfoSchema,
            required: true,
        },
    },
    {
        timestamps: true,
    },
);

// Optimized indexes without duplicates
TokenFamilySchema.index({ userId: 1, reuseDetected: 1 });
TokenFamilySchema.index({ userId: 1, 'deviceInfo.lastActive': -1 });
TokenFamilySchema.index({ validUntil: 1, reuseDetected: 1 });
TokenFamilySchema.index({ userId: 1, 'deviceInfo.deviceId': 1 });

// TTL index for automatic expiration
TokenFamilySchema.index({ validUntil: 1 }, { expireAfterSeconds: 0 });

// Methods for TokenFamily
TokenFamilySchema.methods = {
    updateLastActive: async function () {
        this.deviceInfo.lastActive = new Date();
        return this.save();
    },

    isActive: function (): boolean {
        return !this.reuseDetected && this.validUntil > new Date();
    },

    markAsCompromised: async function () {
        this.reuseDetected = true;
        return this.save();
    },
};

// Statics for TokenFamily
TokenFamilySchema.statics = {
    async findActiveSessionsByUserId(userId: string) {
        return this.find({
            userId,
            reuseDetected: false,
            validUntil: { $gt: new Date() },
        }).sort({ 'deviceInfo.lastActive': -1 });
    },

    async invalidateAllUserSessions(userId: string) {
        return this.updateMany(
            { userId },
            {
                reuseDetected: true,
                validUntil: new Date(),
            },
        );
    },

    async cleanupExpiredFamilies() {
        return this.deleteMany({
            $or: [
                { validUntil: { $lte: new Date() } },
                { reuseDetected: true },
            ],
        });
    },
};

// Pre-save middleware for last active update
TokenFamilySchema.pre('save', function (next) {
    if (this.isModified('deviceInfo')) {
        this.deviceInfo.lastActive = new Date();
    }
    next();
});

// Create models
export const InvalidatedToken = mongoose.model<IInvalidatedToken>(
    'InvalidatedToken',
    InvalidatedTokenSchema,
);

export const TokenFamily = mongoose.model<ITokenFamily, TokenFamilyModel>(
    'TokenFamily',
    TokenFamilySchema,
);

// Log model registration
Logger.info('Token models registered', 'TokenModel');
