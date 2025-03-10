// src/routes/v1/users/shipment-profiles/shipment-profiles.routes.ts
import { Static } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';
import { ErrorResponseSchema } from '../../../schemas';
import {
    CreateShipmentProfileBody,
    DeleteShipmentProfileResponseSchema,
    SetDefaultProfileResponseSchema,
    ShipmentProfileResponseSchema,
    ShipmentProfilesResponseSchema,
    UpdateShipmentProfileBody,
} from '../../../schemas/shipmentProfiles';
import { ShipmentProfilesHandler } from './handlers/shipment-profiles.handler';

export default async function shipmentProfileRoutes(fastify: FastifyInstance) {
    const handler = new ShipmentProfilesHandler();

    // Get all shipment profiles for the authenticated user
    fastify.get(
        '/',
        {
            schema: {
                tags: ['Shipment Profiles'],
                description:
                    'Get all shipment profiles for the authenticated user',
                response: {
                    200: ShipmentProfilesResponseSchema,
                    401: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.getProfiles,
    );

    // Get a specific shipment profile by ID
    fastify.get<{
        Params: { profileId: string };
    }>(
        '/:profileId',
        {
            schema: {
                tags: ['Shipment Profiles'],
                description: 'Get a specific shipment profile by ID',
                params: {
                    type: 'object',
                    properties: {
                        profileId: {
                            type: 'string',
                            pattern: '^[0-9a-fA-F]{24}$',
                            description: 'Shipment Profile MongoDB ObjectId',
                        },
                    },
                    required: ['profileId'],
                },
                response: {
                    200: ShipmentProfileResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.getProfileById,
    );

    // Create a new shipment profile
    fastify.post<{
        Body: Static<typeof CreateShipmentProfileBody>;
    }>(
        '/',
        {
            schema: {
                tags: ['Shipment Profiles'],
                description: 'Create a new shipment profile',
                body: CreateShipmentProfileBody,
                response: {
                    201: ShipmentProfileResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.createProfile,
    );

    // Update a shipment profile
    fastify.put<{
        Params: { profileId: string };
        Body: Static<typeof UpdateShipmentProfileBody>;
    }>(
        '/:profileId',
        {
            schema: {
                tags: ['Shipment Profiles'],
                description: 'Update a shipment profile',
                params: {
                    type: 'object',
                    properties: {
                        profileId: {
                            type: 'string',
                            pattern: '^[0-9a-fA-F]{24}$',
                            description: 'Shipment Profile MongoDB ObjectId',
                        },
                    },
                    required: ['profileId'],
                },
                body: UpdateShipmentProfileBody,
                response: {
                    200: ShipmentProfileResponseSchema,
                    400: ErrorResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.updateProfile,
    );

    // Delete a shipment profile
    fastify.delete<{
        Params: { profileId: string };
    }>(
        '/:profileId',
        {
            schema: {
                tags: ['Shipment Profiles'],
                description: 'Delete a shipment profile',
                params: {
                    type: 'object',
                    properties: {
                        profileId: {
                            type: 'string',
                            pattern: '^[0-9a-fA-F]{24}$',
                            description: 'Shipment Profile MongoDB ObjectId',
                        },
                    },
                    required: ['profileId'],
                },
                response: {
                    200: DeleteShipmentProfileResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.deleteProfile,
    );

    // Set a shipment profile as default
    fastify.patch<{
        Params: { profileId: string };
    }>(
        '/:profileId/default',
        {
            schema: {
                tags: ['Shipment Profiles'],
                description: 'Set a shipment profile as the default',
                params: {
                    type: 'object',
                    properties: {
                        profileId: {
                            type: 'string',
                            pattern: '^[0-9a-fA-F]{24}$',
                            description: 'Shipment Profile MongoDB ObjectId',
                        },
                    },
                    required: ['profileId'],
                },
                response: {
                    200: SetDefaultProfileResponseSchema,
                    401: ErrorResponseSchema,
                    403: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.setDefaultProfile,
    );
}
