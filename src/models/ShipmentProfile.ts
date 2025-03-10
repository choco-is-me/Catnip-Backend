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

        // If this profile is being set as default, update all other profiles for this user
        if (this.isDefault) {
            await mongoose.models.ShipmentProfile.updateMany(
                {
                    userId: this.userId,
                    _id: { $ne: this._id },
                },
                {
                    isDefault: false,
                },
            );
        }

        next();
    } catch (error) {
        next(error as Error);
    }
});

// Ensure at least one profile is default if others exist
ShipmentProfileSchema.post('findOneAndDelete', async function (doc) {
    try {
        if (doc && doc.isDefault) {
            const remainingProfiles =
                await mongoose.models.ShipmentProfile.find({
                    userId: doc.userId,
                });

            if (remainingProfiles.length > 0) {
                await mongoose.models.ShipmentProfile.findByIdAndUpdate(
                    remainingProfiles[0]._id,
                    { isDefault: true },
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
