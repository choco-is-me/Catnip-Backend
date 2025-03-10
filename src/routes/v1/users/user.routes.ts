// src/routes/v1/users/user.routes.ts
import { Static } from '@sinclair/typebox';
import { FastifyInstance } from 'fastify';
import { ErrorResponseSchema } from '../../../schemas/common';
import {
    ChangePasswordBody,
    ChangePasswordResponseSchema,
    DeleteResponseSchema,
    UpdateUserBody,
    UserResponseSchema,
} from '../../../schemas/users/index';
import { UserHandler } from './handlers/user.handler';

export default async function userRoutes(fastify: FastifyInstance) {
    const handler = new UserHandler();

    // Get user profile
    fastify.get(
        '/profile',
        {
            schema: {
                tags: ['Users'],
                description: "Get authenticated user's profile",
                response: {
                    200: UserResponseSchema,
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.getProfile,
    );

    // Update profile
    fastify.put<{
        Body: Static<typeof UpdateUserBody>;
    }>(
        '/profile',
        {
            schema: {
                tags: ['Users'],
                description: "Update authenticated user's profile",
                body: UpdateUserBody,
                response: {
                    200: UserResponseSchema,
                    400: {
                        description: 'Validation error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'VALIDATION_ERROR',
                            },
                            message: {
                                type: 'string',
                                example: 'Invalid phone number format',
                            },
                            code: { type: 'integer', example: 400 },
                        },
                    },
                    401: ErrorResponseSchema,
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.updateProfile,
    );

    // Delete profile
    fastify.delete(
        '/profile',
        {
            schema: {
                tags: ['Users'],
                description: "Delete authenticated user's account",
                response: {
                    200: DeleteResponseSchema,
                    401: ErrorResponseSchema,
                    403: {
                        description: 'Forbidden - Cannot delete admin account',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: { type: 'string', example: 'FORBIDDEN' },
                            message: {
                                type: 'string',
                                example: 'Admin accounts cannot be deleted',
                            },
                            code: { type: 'integer', example: 403 },
                        },
                    },
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.deleteProfile,
    );

    // Change password
    fastify.put<{
        Body: Static<typeof ChangePasswordBody>;
    }>(
        '/profile/password',
        {
            schema: {
                tags: ['Users'],
                description: "Change authenticated user's password",
                body: ChangePasswordBody,
                response: {
                    200: ChangePasswordResponseSchema,
                    400: {
                        description: 'Validation error',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'VALIDATION_ERROR',
                            },
                            message: {
                                type: 'string',
                                example:
                                    'New password must be different from current password',
                            },
                            code: { type: 'integer', example: 400 },
                        },
                    },
                    401: {
                        description: 'Invalid current password',
                        properties: {
                            success: { type: 'boolean', example: false },
                            error: {
                                type: 'string',
                                example: 'INVALID_CREDENTIALS',
                            },
                            message: {
                                type: 'string',
                                example: 'Current password is incorrect',
                            },
                            code: { type: 'integer', example: 401 },
                        },
                    },
                    404: ErrorResponseSchema,
                    500: ErrorResponseSchema,
                },
            },
            ...fastify.protectedRoute(['user', 'admin']),
        },
        handler.changePassword,
    );
}
