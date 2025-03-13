// src/schemas/shipmentProfiles/index.ts
import { Type } from '@sinclair/typebox';
import { ResponseWrapper } from '../common';

// Enumerated type for address type
export const AddressTypeEnum = Type.Union(
    [Type.Literal('home'), Type.Literal('office')],
    {
        description: 'Type of address (home or office)',
        examples: ['home'],
    },
);

// Base schema for shipment profile data
export const ShipmentProfileBaseSchema = Type.Object({
    receiverName: Type.String({
        minLength: 1,
        maxLength: 100,
        description: 'Full name of the recipient',
        examples: ['Nguyen Van A'],
    }),
    phoneNumber: Type.String({
        pattern: '^(0[3|5|7|8|9])+([0-9]{8})$',
        description:
            'Vietnamese phone number for delivery (10 digits starting with 03, 05, 07, 08, or 09)',
        examples: ['0912345678'],
    }),
    addressLine: Type.String({
        minLength: 1,
        maxLength: 200,
        description: 'Street address with house number',
        examples: ['123 Nguyen Hue Street'],
    }),
    ward: Type.String({
        minLength: 1,
        maxLength: 100,
        description: 'Ward name (Phường/Xã)',
        examples: ['Phường Bến Nghé'],
    }),
    district: Type.String({
        minLength: 1,
        maxLength: 100,
        description: 'District name (Quận/Huyện)',
        examples: ['Quận 1'],
    }),
    province: Type.String({
        minLength: 1,
        maxLength: 100,
        description: 'Province/City name (Tỉnh/Thành phố)',
        examples: ['Thành phố Hồ Chí Minh'],
    }),
    addressType: AddressTypeEnum,
    isDefault: Type.Optional(
        Type.Boolean({
            description: 'Whether this is the default shipping address',
        }),
    ),
});

// Example for response data
const shipmentProfileExample = {
    _id: '507f1f77bcf86cd799439011',
    userId: '507f1f77bcf86cd799439012',
    receiverName: 'Nguyen Van A',
    phoneNumber: '0912345678',
    addressLine: '123 Nguyen Hue Street',
    ward: 'Phường Bến Nghé',
    district: 'Quận 1',
    province: 'Thành phố Hồ Chí Minh',
    addressType: 'home',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-01T00:00:00.000Z',
};

// Complete shipment profile schema with system fields
export const ShipmentProfileSchema = Type.Intersect(
    [
        Type.Object({
            _id: Type.String({
                pattern: '^[0-9a-fA-F]{24}$',
                description: 'MongoDB ObjectId',
            }),
            userId: Type.String({
                pattern: '^[0-9a-fA-F]{24}$',
                description: 'User MongoDB ObjectId',
            }),
        }),
        ShipmentProfileBaseSchema,
        Type.Object({
            createdAt: Type.String({ format: 'date-time' }),
            updatedAt: Type.String({ format: 'date-time' }),
        }),
    ],
    {
        description: 'Complete shipment profile information',
    },
);

// Request body schemas
export const CreateShipmentProfileBody = ShipmentProfileBaseSchema;
export const UpdateShipmentProfileBody = Type.Partial(
    ShipmentProfileBaseSchema,
);

// Response schemas
export const ShipmentProfileResponseSchema = ResponseWrapper(
    Type.Object({
        shipmentProfile: ShipmentProfileSchema,
    }),
    {
        description: 'Shipment profile details response',
        examples: [
            {
                success: true,
                data: {
                    shipmentProfile: shipmentProfileExample,
                },
            },
        ],
    },
);

export const ShipmentProfilesResponseSchema = ResponseWrapper(
    Type.Object({
        shipmentProfiles: Type.Array(ShipmentProfileSchema),
        total: Type.Number({
            description: 'Total number of profiles',
            examples: [2],
        }),
    }),
    {
        description: 'List of shipment profiles response',
        examples: [
            {
                success: true,
                data: {
                    shipmentProfiles: [shipmentProfileExample],
                    total: 1,
                },
            },
        ],
    },
);

export const DeleteShipmentProfileResponseSchema = ResponseWrapper(
    Type.Object({
        message: Type.String({
            description: 'Success message',
            examples: ['Shipment profile deleted successfully'],
        }),
        isDefault: Type.Boolean({
            description: 'Whether the deleted profile was the default',
            examples: [true],
        }),
        newDefault: Type.Optional(
            Type.Object({
                _id: Type.String({
                    description:
                        'ID of the new default profile (if applicable)',
                    examples: ['507f1f77bcf86cd799439013'],
                }),
                receiverName: Type.String({
                    description:
                        'Name of the new default profile (if applicable)',
                    examples: ['Nguyen Van B'],
                }),
            }),
        ),
    }),
    {
        description: 'Shipment profile deletion response',
    },
);

export const SetDefaultProfileResponseSchema = ResponseWrapper(
    Type.Object({
        message: Type.String({
            description: 'Success message',
            examples: ['Default shipping address updated successfully'],
        }),
        updatedProfile: Type.Object({
            _id: Type.String({
                description: 'ID of the profile set as default',
                examples: ['507f1f77bcf86cd799439011'],
            }),
            isDefault: Type.Literal(true),
        }),
        previousDefault: Type.Optional(
            Type.Object({
                _id: Type.String({
                    description: 'ID of the previously default profile',
                    examples: ['507f1f77bcf86cd799439013'],
                }),
                isDefault: Type.Literal(false),
            }),
        ),
    }),
    {
        description: 'Response for updating default shipment profile',
    },
);
