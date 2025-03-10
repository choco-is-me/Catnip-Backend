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

                // Determine if this should be the default profile
                const isDefault =
                    profileCount === 0 ? true : request.body.isDefault || false;

                // If setting as default, update any existing default profiles
                if (isDefault) {
                    await ShipmentProfile.updateMany(
                        { userId, isDefault: true },
                        { isDefault: false },
                        { session },
                    );
                }

                // Create the new profile
                const shipmentProfile = new ShipmentProfile({
                    ...request.body,
                    userId,
                    isDefault,
                });

                await shipmentProfile.save({ session });
                Logger.info(
                    `Shipment profile created for user: ${userId}`,
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
                const updateData = request.body;

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

                // If setting as default, update any existing default profiles
                if (updateData.isDefault) {
                    await ShipmentProfile.updateMany(
                        {
                            userId,
                            isDefault: true,
                            _id: { $ne: profileId },
                        },
                        { isDefault: false },
                        { session },
                    );
                }

                // Update the profile
                const updatedProfile = await ShipmentProfile.findByIdAndUpdate(
                    profileId,
                    { $set: updateData },
                    {
                        new: true,
                        runValidators: true,
                        session,
                    },
                );

                Logger.info(
                    `Shipment profile updated: ${profileId}`,
                    'ShipmentProfilesHandler',
                );

                return reply.code(200).send({
                    success: true,
                    data: {
                        shipmentProfile: updatedProfile,
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

    // Delete a shipment profile
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
                }).session(session);

                if (!existingProfile) {
                    throw createError(
                        404,
                        ErrorTypes.NOT_FOUND,
                        'Shipment profile not found',
                    );
                }

                const wasDefault = existingProfile.isDefault;

                // Delete the profile
                await ShipmentProfile.findByIdAndDelete(profileId).session(
                    session,
                );

                // If this was the default profile, set another profile as default
                let newDefault = null;
                if (wasDefault) {
                    const anotherProfile =
                        await ShipmentProfile.findOneAndUpdate(
                            { userId },
                            { isDefault: true },
                            {
                                new: true,
                                session,
                                sort: { createdAt: -1 },
                            },
                        ).select('_id receiverName');

                    if (anotherProfile) {
                        newDefault = {
                            _id: anotherProfile._id,
                            receiverName: anotherProfile.receiverName,
                        };
                    }
                }

                Logger.info(
                    `Shipment profile deleted: ${profileId}`,
                    'ShipmentProfilesHandler',
                );

                return reply.code(200).send({
                    success: true,
                    data: {
                        message: 'Shipment profile deleted successfully',
                        isDefault: wasDefault,
                        newDefault: newDefault || undefined,
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

                // Update the current default profile
                let previousDefault = null;
                if (currentDefault) {
                    await ShipmentProfile.findByIdAndUpdate(
                        currentDefault._id,
                        { isDefault: false },
                        { session },
                    );

                    previousDefault = {
                        _id: currentDefault._id,
                        isDefault: false,
                    };
                }

                // Set the new default profile
                const updatedProfile = await ShipmentProfile.findByIdAndUpdate(
                    profileId,
                    { isDefault: true },
                    {
                        new: true,
                        session,
                    },
                );

                Logger.info(
                    `Shipment profile set as default: ${profileId}`,
                    'ShipmentProfilesHandler',
                );

                return reply.code(200).send({
                    success: true,
                    data: {
                        message:
                            'Default shipping address updated successfully',
                        updatedProfile: {
                            _id: updatedProfile!._id,
                            isDefault: true,
                        },
                        previousDefault: previousDefault || undefined,
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
