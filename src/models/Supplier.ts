// src/models/Supplier.ts
import mongoose, { Document, Schema } from 'mongoose';
import { Logger } from '../services/logger.service';

export interface IContactPerson {
    name: string;
    position: string;
    email: string;
    phone: string;
}

export interface IPaymentInfo {
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    swiftCode?: string;
}

export interface ISupplier extends Document {
    name: string;
    code: string;
    description?: string;
    contactPersons: IContactPerson[];
    address: {
        street: string;
        city: string;
        state: string;
        country: string;
        postalCode: string;
    };
    paymentInfo: IPaymentInfo[];
    email: string;
    phone: string;
    website?: string;
    status: 'active' | 'inactive' | 'blacklisted';
    rating: number;
    tags: string[];
    contractStartDate: Date;
    contractEndDate?: Date;
    minimumOrderValue?: number;
    leadTime: number; // in days
    paymentTerms: string;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ContactPersonSchema = new Schema<IContactPerson>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        position: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
        },
        phone: {
            type: String,
            required: true,
            trim: true,
        },
    },
    { _id: false },
);

const PaymentInfoSchema = new Schema<IPaymentInfo>(
    {
        bankName: {
            type: String,
            required: true,
            trim: true,
        },
        accountNumber: {
            type: String,
            required: true,
            trim: true,
        },
        accountHolder: {
            type: String,
            required: true,
            trim: true,
        },
        swiftCode: {
            type: String,
            trim: true,
        },
    },
    { _id: false },
);

const SupplierSchema = new Schema<ISupplier>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        description: {
            type: String,
            trim: true,
        },
        contactPersons: [ContactPersonSchema],
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
            state: {
                type: String,
                required: true,
                trim: true,
            },
            country: {
                type: String,
                required: true,
                trim: true,
            },
            postalCode: {
                type: String,
                required: true,
                trim: true,
            },
        },
        paymentInfo: [PaymentInfoSchema],
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
        },
        phone: {
            type: String,
            required: true,
            trim: true,
        },
        website: {
            type: String,
            trim: true,
            match: [
                /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
                'Please enter a valid URL',
            ],
        },
        status: {
            type: String,
            enum: ['active', 'inactive', 'blacklisted'],
            default: 'active',
            index: true,
        },
        rating: {
            type: Number,
            min: 0,
            max: 5,
            default: 0,
        },
        tags: [
            {
                type: String,
                trim: true,
            },
        ],
        contractStartDate: {
            type: Date,
            required: true,
        },
        contractEndDate: {
            type: Date,
        },
        minimumOrderValue: {
            type: Number,
            min: 0,
        },
        leadTime: {
            type: Number,
            required: true,
            min: 0,
        },
        paymentTerms: {
            type: String,
            required: true,
            trim: true,
        },
        notes: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    },
);

// Indexes for efficient querying
SupplierSchema.index({ name: 'text', code: 'text' });
SupplierSchema.index({
    'address.country': 1,
    'address.state': 1,
    'address.city': 1,
});
SupplierSchema.index({ rating: -1 });
SupplierSchema.index({ leadTime: 1 });
SupplierSchema.index({ contractStartDate: 1, contractEndDate: 1 });

// Pre-save hook to ensure contractEndDate is after contractStartDate
SupplierSchema.pre('save', function (next) {
    if (this.contractEndDate && this.contractEndDate < this.contractStartDate) {
        next(new Error('Contract end date must be after contract start date'));
    }
    next();
});

// Method to check if supplier contract is active
SupplierSchema.methods.isContractActive = function (): boolean {
    const now = new Date();
    return (
        now >= this.contractStartDate &&
        (!this.contractEndDate || now <= this.contractEndDate)
    );
};

// Method to get active contact persons
SupplierSchema.methods.getActiveContactPersons = function (): IContactPerson[] {
    return this.contactPersons;
};

// Static method to find suppliers by tag
SupplierSchema.statics.findByTag = function (tag: string) {
    return this.find({ tags: tag, status: 'active' });
};

export const Supplier = mongoose.model<ISupplier>('Supplier', SupplierSchema);

// Log model registration
Logger.info('Supplier model registered', 'SupplierModel');
