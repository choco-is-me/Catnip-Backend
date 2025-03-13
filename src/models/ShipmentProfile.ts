// src/models/ShipmentProfile.ts
import mongoose, { Document, Schema } from 'mongoose';
import { Logger } from '../services/logger.service';

export interface IShipmentProfile extends Document {
    userId: mongoose.Types.ObjectId;
    receiverName: string;
    phoneNumber: string;
    addressLine: string;
    ward: string;
    district: string;
    province: string;
    addressType: 'home' | 'office';
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ShipmentProfileSchema = new Schema<IShipmentProfile>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        receiverName: {
            type: String,
            required: true,
            trim: true,
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
        addressLine: {
            type: String,
            required: true,
            trim: true,
        },
        ward: {
            type: String,
            required: true,
            trim: true,
        },
        district: {
            type: String,
            required: true,
            trim: true,
        },
        province: {
            type: String,
            required: true,
            trim: true,
        },
        addressType: {
            type: String,
            enum: ['home', 'office'],
            required: true,
        },
        isDefault: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    },
);

// Ensure a user cannot have more than 5 shipment profiles
ShipmentProfileSchema.pre('save', async function (next) {
    try {
        if (this.isNew) {
            const count = await mongoose.models.ShipmentProfile.countDocuments({
                userId: this.userId,
            });

            if (count >= 5) {
                throw new Error(
                    'User cannot have more than 5 shipment profiles',
                );
            }

            // If this is the first shipment profile, set it as default
            if (count === 0) {
                this.isDefault = true;
            }
        }

        // If this profile is being set as default, ensure other profiles are not default
        // Only do this update if this profile is marked as default and is being modified
        if (this.isDefault && (this.isNew || this.isModified('isDefault'))) {
            await mongoose.models.ShipmentProfile.updateMany(
                {
                    userId: this.userId,
                    _id: { $ne: this._id },
                },
                {
                    isDefault: false,
                },
            );

            Logger.debug(
                `Setting profile ${this._id} as default and removing default status from other profiles`,
                'ShipmentProfile',
            );
        }

        next();
    } catch (error) {
        next(error as Error);
    }
});

// Optimized post-delete hook for better performance when handling the final profile
ShipmentProfileSchema.post('findOneAndDelete', async function (doc) {
    try {
        // Only proceed if the deleted profile was default
        if (doc && doc.isDefault) {
            // Use a more efficient count query first to check if any profiles remain
            const remainingCount =
                await mongoose.models.ShipmentProfile.countDocuments({
                    userId: doc.userId,
                }).limit(1);

            if (remainingCount > 0) {
                // Find and update another profile to be default in one efficient operation
                const result =
                    await mongoose.models.ShipmentProfile.findOneAndUpdate(
                        { userId: doc.userId },
                        { isDefault: true },
                        { new: true },
                    );

                if (result) {
                    Logger.debug(
                        `Set profile ${result._id} as default after deleting default profile ${doc._id}`,
                        'ShipmentProfile',
                    );
                }
            } else {
                // No profiles left - log and exit quickly
                Logger.debug(
                    `No profiles left for user ${doc.userId} after deleting the last profile`,
                    'ShipmentProfile',
                );
            }
        }
    } catch (error) {
        Logger.error(error as Error, 'ShipmentProfile');
    }
});

// Create indexes for better query performance
ShipmentProfileSchema.index({ userId: 1, isDefault: 1 });

export const ShipmentProfile = mongoose.model<IShipmentProfile>(
    'ShipmentProfile',
    ShipmentProfileSchema,
);

// Log model registration
Logger.info('ShipmentProfile model registered', 'ShipmentProfileModel');
