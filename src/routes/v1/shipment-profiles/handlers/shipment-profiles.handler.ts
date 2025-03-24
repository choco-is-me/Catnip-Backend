// src/routes/v1/users/shipment-profiles/handlers/shipment-profiles.handler.ts
import { Static } from '@sinclair/typebox';
import { FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { ShipmentProfile } from '../../../../models/ShipmentProfile';
import {
    CreateShipmentProfileBody,
    UpdateShipmentProfileBody,
} from '../../../../schemas/shipmentProfiles';
import { Logger } from '../../../../services/logger.service';
import {
    CommonErrors,
    createBusinessError,
    createError,
    ErrorTypes,
} from '../../../../utils/error-handler';
import { withTransaction } from '../../../../utils/transaction.utils';

export class ShipmentProfilesHandler {
    // Get all profiles for the authenticated user
    async getProfiles(request: FastifyRequest, reply: FastifyReply) {
        try {
            const userId = request.user!.userId;
            Logger.debug(
                `Fetching shipment profiles for user: ${userId}`,
                'ShipmentProfilesHandler',
            );

            const shipmentProfiles = await ShipmentProfile.find({ userId })
                .sort({ isDefault: -1, createdAt: -1 })
                .lean();

            const total = shipmentProfiles.length;

            Logger.info(
                `Retrieved ${total} shipment profiles for user: ${userId}`,
                'ShipmentProfilesHandler',
            );

            return reply.code(200).send({
                success: true,
                data: {
                    shipmentProfiles,
                    total,
                },
            });
        } catch (error) {
            Logger.error(error as Error, 'ShipmentProfilesHandler');

            if (error instanceof mongoose.Error) {
                throw CommonErrors.databaseError('shipment profile retrieval');
            }

            throw error;
        }
    }

    // Get profile by ID
    async getProfileById(
        request: FastifyRequest<{
            Params: { profileId: string };
        }>,
        reply: FastifyReply,
    ) {
        try {
            const { profileId } = request.params;
            const userId = request.user!.userId;

            if (!mongoose.Types.ObjectId.isValid(profileId)) {
                throw CommonErrors.invalidFormat('shipment profile ID');
            }

            const shipmentProfile = await ShipmentProfile.findOne({
                _id: profileId,
                userId,
            }).lean();

            if (!shipmentProfile) {
                throw createError(
                    404,
                    ErrorTypes.NOT_FOUND,
                    'Shipment profile not found',
                );
            }

            Logger.debug(
                `Retrieved shipment profile: ${profileId}`,
                'ShipmentProfilesHandler',
            );

            return reply.code(200).send({
                success: true,
                data: {
                    shipmentProfile,
                },
            });
        } catch (error) {
            Logger.error(error as Error, 'ShipmentProfilesHandler');

            if (error instanceof mongoose.Error) {
                throw CommonErrors.databaseError('shipment profile retrieval');
            }

            throw error;
        }
    }

    // Create a new shipment profile
    async createProfile(
        request: FastifyRequest<{
            Body: Static<typeof CreateShipmentProfileBody>;
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const userId = request.user!.userId;
                Logger.debug(
                    `Creating shipment profile for user: ${userId}`,
                    'ShipmentProfilesHandler',
                );

                // Check if user has reached the maximum number of profiles (5)
                const profileCount = await ShipmentProfile.countDocuments({
                    userId,
                }).session(session);

                if (profileCount >= 5) {
                    throw createBusinessError(
                        'Maximum number of shipment profiles (5) reached',
                    );
                }

                // Create the new profile - we let the model pre-save hook handle default logic
                // This ensures consistent behavior across all operations
                const shipmentProfile = new ShipmentProfile({
                    ...request.body,
                    userId,
                    // Use the provided default flag or false, first profile logic is in pre-save hook
                    isDefault: request.body.isDefault || false,
                });

                await shipmentProfile.save({ session });

                Logger.info(
                    `Shipment profile created for user: ${userId}${shipmentProfile.isDefault ? ' (set as default)' : ''}`,
                    'ShipmentProfilesHandler',
                );

                return reply.code(201).send({
                    success: true,
                    data: {
                        shipmentProfile,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'ShipmentProfilesHandler');

                if (error instanceof mongoose.Error.ValidationError) {
                    throw createError(
                        400,
                        ErrorTypes.VALIDATION_ERROR,
                        Object.values(error.errors)
                            .map((err) => err.message)
                            .join(', '),
                    );
                }

                if (error instanceof mongoose.Error) {
                    throw CommonErrors.databaseError(
                        'shipment profile creation',
                    );
                }

                throw error;
            }
        }, 'ShipmentProfilesHandler');
    }

    // Update a shipment profile
    async updateProfile(
        request: FastifyRequest<{
            Params: { profileId: string };
            Body: Static<typeof UpdateShipmentProfileBody>;
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const { profileId } = request.params;
                const userId = request.user!.userId;

                // Get the raw request payload to check if isDefault was actually sent
                const rawPayload = request.body;
                const rawKeys = Object.keys(rawPayload);
                const wasIsDefaultExplicitlySent =
                    rawKeys.includes('isDefault');

                Logger.debug(
                    `Original request keys: ${JSON.stringify(rawKeys)}`,
                    'ShipmentProfilesHandler',
                );

                if (!mongoose.Types.ObjectId.isValid(profileId)) {
                    throw CommonErrors.invalidFormat('shipment profile ID');
                }

                // Find the profile to verify ownership
                const existingProfile = await ShipmentProfile.findOne({
                    _id: profileId,
                    userId,
                }).session(session);

                if (!existingProfile) {
                    throw createError(
                        404,
                        ErrorTypes.NOT_FOUND,
                        'Shipment profile not found',
                    );
                }

                // Create update object WITHOUT isDefault if it wasn't explicitly sent
                const updateData: Record<string, any> = {};
                for (const key of rawKeys) {
                    if (key !== 'isDefault' || wasIsDefaultExplicitlySent) {
                        updateData[key] =
                            rawPayload[key as keyof typeof rawPayload];
                    }
                }

                Logger.debug(
                    `Final update data: ${JSON.stringify(updateData)}`,
                    'ShipmentProfilesHandler',
                );

                // Apply updates to existing profile
                Object.assign(existingProfile, updateData);

                // Save the profile to trigger hooks
                await existingProfile.save({ session });

                const logMessage = wasIsDefaultExplicitlySent
                    ? `Shipment profile updated: ${profileId}${updateData.isDefault ? ' (set as default)' : ' (default status explicitly set to false)'}`
                    : `Shipment profile updated: ${profileId}`;

                Logger.info(logMessage, 'ShipmentProfilesHandler');

                return reply.code(200).send({
                    success: true,
                    data: {
                        shipmentProfile: existingProfile,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'ShipmentProfilesHandler');

                if (error instanceof mongoose.Error.ValidationError) {
                    throw createError(
                        400,
                        ErrorTypes.VALIDATION_ERROR,
                        Object.values(error.errors)
                            .map((err) => err.message)
                            .join(', '),
                    );
                }

                if (error instanceof mongoose.Error) {
                    throw CommonErrors.databaseError('shipment profile update');
                }

                throw error;
            }
        }, 'ShipmentProfilesHandler');
    }

    // Delete a shipment profile - Optimized implementation
    async deleteProfile(
        request: FastifyRequest<{
            Params: { profileId: string };
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const { profileId } = request.params;
                const userId = request.user!.userId;

                if (!mongoose.Types.ObjectId.isValid(profileId)) {
                    throw CommonErrors.invalidFormat('shipment profile ID');
                }

                // Find the profile to verify ownership
                const existingProfile = await ShipmentProfile.findOne({
                    _id: profileId,
                    userId,
                })
                    .session(session)
                    .lean();

                if (!existingProfile) {
                    throw createError(
                        404,
                        ErrorTypes.NOT_FOUND,
                        'Shipment profile not found',
                    );
                }

                // Check how many profiles the user has
                const profileCount = await ShipmentProfile.countDocuments({
                    userId,
                }).session(session);

                // FAST PATH: If this is the user's last profile, use direct deletion to bypass hooks
                if (profileCount === 1) {
                    Logger.debug(
                        `FAST PATH: Deleting the last shipment profile for user ${userId}`,
                        'ShipmentProfilesHandler',
                    );

                    // Check if database connection is established
                    if (!mongoose.connection.db) {
                        throw new Error(
                            'Database connection is not established',
                        );
                    }

                    // Use direct deleteOne to bypass all hooks and middleware
                    const deleteResult = await mongoose.connection.db
                        .collection('shipmentprofiles')
                        .deleteOne({
                            _id: new mongoose.Types.ObjectId(profileId),
                        });

                    if (deleteResult.deletedCount === 0) {
                        throw createError(
                            404,
                            ErrorTypes.NOT_FOUND,
                            'Profile could not be deleted or was already removed',
                        );
                    }

                    Logger.info(
                        `Fast path deletion completed for the last shipment profile: ${profileId}`,
                        'ShipmentProfilesHandler',
                    );

                    return reply.code(200).send({
                        success: true,
                        data: {
                            message:
                                'Shipment profile deleted successfully (fast path)',
                            isDefault: existingProfile.isDefault,
                        },
                    });
                }

                // NORMAL PATH: Handle deletion when user has multiple profiles

                // Check if this is a default profile with multiple profiles
                if (existingProfile.isDefault && profileCount > 1) {
                    throw createBusinessError(
                        'Cannot delete default shipping profile. Please set another profile as default first.',
                    );
                }

                // Delete using findOneAndDelete to properly trigger hooks
                const deletedProfile = await ShipmentProfile.findOneAndDelete({
                    _id: profileId,
                    userId,
                }).session(session);

                if (!deletedProfile) {
                    throw createError(
                        404,
                        ErrorTypes.NOT_FOUND,
                        'Profile could not be deleted or was already removed',
                    );
                }

                Logger.info(
                    `Shipment profile deleted: ${profileId} (was${deletedProfile.isDefault ? '' : ' not'} default)`,
                    'ShipmentProfilesHandler',
                );

                return reply.code(200).send({
                    success: true,
                    data: {
                        message: 'Shipment profile deleted successfully',
                        isDefault: deletedProfile.isDefault,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'ShipmentProfilesHandler');

                if (error instanceof mongoose.Error) {
                    throw CommonErrors.databaseError(
                        'shipment profile deletion',
                    );
                }

                throw error;
            }
        }, 'ShipmentProfilesHandler');
    }

    // Set a shipment profile as default
    async setDefaultProfile(
        request: FastifyRequest<{
            Params: { profileId: string };
        }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            try {
                const { profileId } = request.params;
                const userId = request.user!.userId;

                if (!mongoose.Types.ObjectId.isValid(profileId)) {
                    throw CommonErrors.invalidFormat('shipment profile ID');
                }

                // Find the profile to verify ownership
                const existingProfile = await ShipmentProfile.findOne({
                    _id: profileId,
                    userId,
                }).session(session);

                if (!existingProfile) {
                    throw createError(
                        404,
                        ErrorTypes.NOT_FOUND,
                        'Shipment profile not found',
                    );
                }

                // Check if already default
                if (existingProfile.isDefault) {
                    return reply.code(200).send({
                        success: true,
                        data: {
                            message: 'This profile is already set as default',
                            updatedProfile: {
                                _id: existingProfile._id,
                                isDefault: true,
                            },
                        },
                    });
                }

                // Find the current default profile
                const currentDefault = await ShipmentProfile.findOne({
                    userId,
                    isDefault: true,
                }).session(session);

                // Update using the model instance to ensure pre-save hooks are triggered
                existingProfile.isDefault = true;
                await existingProfile.save({ session });

                // Return a more detailed response
                return reply.code(200).send({
                    success: true,
                    data: {
                        message:
                            'Default shipping address updated successfully',
                        updatedProfile: {
                            _id: existingProfile._id,
                            isDefault: true,
                        },
                        previousDefault: currentDefault
                            ? {
                                  _id: currentDefault._id,
                                  isDefault: false,
                              }
                            : undefined,
                    },
                });
            } catch (error) {
                Logger.error(error as Error, 'ShipmentProfilesHandler');

                if (error instanceof mongoose.Error) {
                    throw CommonErrors.databaseError(
                        'setting default shipment profile',
                    );
                }

                throw error;
            }
        }, 'ShipmentProfilesHandler');
    }
}
