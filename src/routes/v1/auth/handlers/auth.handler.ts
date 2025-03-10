// src/routes/v1/users/handlers/auth.handler.ts
import { Static } from '@sinclair/typebox';
import { FastifyReply, FastifyRequest } from 'fastify';
import { CONFIG } from '../../../../config';
import { TokenFamily } from '../../../../models/Token';
import { User, UserRole } from '../../../../models/User';
import { CreateUserBody, LoginRequestBody } from '../../../../schemas';
import JWTService from '../../../../services/jwt.service';
import { Logger } from '../../../../services/logger.service';
import {
    CommonErrors,
    createBusinessError,
    createError,
    ErrorTypes,
    sendError,
} from '../../../../utils/error-handler';
import { withTransaction } from '../../../../utils/transaction.utils';

export class AuthHandler {
    // Private helper methods
    private static async validateLoginCredentials(
        email: string,
        password: string,
    ): Promise<{ user: any; role: UserRole } | null> {
        try {
            Logger.debug(
                `Attempting to validate credentials for email: ${email}`,
                'Auth',
            );

            const user = await User.findOne({
                email: { $regex: new RegExp(`^${email}$`, 'i') },
            });

            if (!user || !(await user.comparePassword(password))) {
                await new Promise((resolve) => setTimeout(resolve, 1000)); // Prevent timing attacks
                Logger.warn(`Failed login attempt for email: ${email}`, 'Auth');
                return null;
            }

            Logger.debug(
                `Credentials validated successfully for user: ${user._id}`,
                'Auth',
            );
            return { user, role: user.role };
        } catch (error) {
            Logger.error(error as Error, 'Auth');
            throw CommonErrors.databaseError('credential validation');
        }
    }

    private static setRefreshTokenCookie(
        reply: FastifyReply,
        refreshToken: string,
    ) {
        try {
            reply.setCookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: CONFIG.COOKIE_SECURE,
                sameSite: 'strict',
                path: '/api/v1/auth/refresh-token',
                maxAge: CONFIG.COOKIE_MAX_AGE,
                domain: CONFIG.COOKIE_DOMAIN,
                partitioned: true,
            });
            Logger.debug('Refresh token cookie set successfully', 'Auth');
        } catch (error) {
            Logger.error(error as Error, 'Auth');
            throw createError(
                500,
                ErrorTypes.COOKIE_ERROR,
                'Failed to set refresh token cookie',
            );
        }
    }

    private static clearRefreshTokenCookie(reply: FastifyReply) {
        try {
            reply.clearCookie('refreshToken', {
                httpOnly: true,
                secure: CONFIG.COOKIE_SECURE,
                sameSite: 'strict',
                path: '/api/v1/auth/refresh-token',
                maxAge: CONFIG.COOKIE_MAX_AGE,
                domain: CONFIG.COOKIE_DOMAIN,
                partitioned: true,
            });
            Logger.debug('Refresh token cookie cleared successfully', 'Auth');
        } catch (error) {
            Logger.error(error as Error, 'Auth');
            throw createError(
                500,
                ErrorTypes.COOKIE_ERROR,
                'Failed to clear refresh token cookie',
            );
        }
    }

    private static formatUserResponse(user: any) {
        try {
            return {
                _id: user._id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                company: user.company,
                role: user.role, // Include role in response
                address: user.address,
                phoneNumber: user.phoneNumber,
                createdAt: user.createdAt.toISOString(),
                updatedAt: user.updatedAt.toISOString(),
            };
        } catch (error) {
            Logger.error(error as Error, 'Auth');
            throw createError(
                500,
                ErrorTypes.INTERNAL_ERROR,
                'Failed to format user response',
            );
        }
    }

    async refreshToken(request: FastifyRequest, reply: FastifyReply) {
        return withTransaction(async (session) => {
            Logger.debug('Processing refresh token request', 'Auth');

            const refreshToken = request.cookies.refreshToken;
            if (!refreshToken) {
                return sendError(
                    reply,
                    CommonErrors.cookieMissing('refreshToken'),
                );
            }

            try {
                const tokens = await JWTService.rotateTokens(
                    refreshToken,
                    request,
                );
                AuthHandler.setRefreshTokenCookie(reply, tokens.refreshToken);

                Logger.info('Tokens refreshed successfully', 'Auth');
                return reply.code(200).send({
                    success: true,
                    data: {
                        tokens: {
                            accessToken: tokens.accessToken,
                        },
                    },
                });
            } catch (error) {
                AuthHandler.clearRefreshTokenCookie(reply);
                if (error instanceof Error) {
                    switch (error.message) {
                        case 'TOKEN_FINGERPRINT_MISMATCH':
                            return sendError(
                                reply,
                                CommonErrors.fingerprintMismatch(),
                            );
                        case 'TOKEN_EXPIRED':
                            return sendError(
                                reply,
                                CommonErrors.tokenExpired(),
                            );
                        case 'TOKEN_INVALIDATED':
                            return sendError(
                                reply,
                                CommonErrors.tokenRevoked(),
                            );
                        case 'INVALID_TOKEN_TYPE':
                            return sendError(
                                reply,
                                CommonErrors.invalidTokenType(),
                            );
                        case 'TOKEN_FAMILY_COMPROMISED':
                            return sendError(
                                reply,
                                CommonErrors.suspiciousActivity(),
                            );
                        case 'TOKEN_FAMILY_EXPIRED':
                            return sendError(
                                reply,
                                CommonErrors.sessionExpired(),
                            );
                        default:
                            return sendError(
                                reply,
                                CommonErrors.invalidToken(),
                            );
                    }
                }
                throw error;
            }
        }, 'Auth');
    }

    async login(
        request: FastifyRequest<{ Body: Static<typeof LoginRequestBody> }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            Logger.debug('Processing login request', 'Auth');
            const { email, password } = request.body;

            const validationResult = await AuthHandler.validateLoginCredentials(
                email,
                password,
            );
            if (!validationResult) {
                return sendError(reply, CommonErrors.invalidCredentials());
            }

            const { user, role } = validationResult;

            const existingSessions =
                await TokenFamily.findActiveSessionsByUserId(
                    user._id.toString(),
                );
            if (existingSessions.length >= 5) {
                return sendError(
                    reply,
                    createBusinessError('Maximum active sessions reached'),
                );
            }

            const tokens = await JWTService.generateTokens(
                user._id.toString(),
                role, // Pass role to token generation
                request,
            );
            AuthHandler.setRefreshTokenCookie(reply, tokens.refreshToken);

            Logger.info(`User logged in successfully: ${user._id}`, 'Auth');
            return reply.code(200).send({
                success: true,
                data: {
                    user: AuthHandler.formatUserResponse(user),
                    tokens: { accessToken: tokens.accessToken },
                },
            });
        }, 'Auth');
    }

    async register(
        request: FastifyRequest<{ Body: Static<typeof CreateUserBody> }>,
        reply: FastifyReply,
    ) {
        return withTransaction(async (session) => {
            Logger.debug(
                `Starting registration process for email: ${request.body.email}`,
                'Auth',
            );

            const existingUser = await User.findOne({
                email: request.body.email.toLowerCase(),
            }).session(session);

            if (existingUser) {
                Logger.warn(
                    `Registration failed - email already exists: ${request.body.email}`,
                    'Auth',
                );
                return sendError(reply, CommonErrors.emailExists());
            }

            // Force role to be 'user' for all registrations
            const user = new User({
                ...request.body,
                email: request.body.email.toLowerCase(),
                role: 'user', // Always set role to 'user' for new registrations
            });

            await user.save({ session });
            Logger.info(`User registered successfully: ${user._id}`, 'Auth');

            return reply.code(201).send({
                success: true,
                data: {
                    user: AuthHandler.formatUserResponse(user),
                },
            });
        }, 'Auth');
    }

    async logout(request: FastifyRequest, reply: FastifyReply) {
        return withTransaction(async (session) => {
            Logger.debug('Processing logout request', 'Auth');

            if (!request.user) {
                Logger.warn('Logout attempt without user in request', 'Auth');
                return sendError(reply, CommonErrors.sessionInvalid());
            }

            const authHeader = request.headers.authorization;
            if (!authHeader?.startsWith('Bearer ')) {
                Logger.warn('Logout attempt without Bearer token', 'Auth');
                return sendError(reply, CommonErrors.noToken());
            }

            const token = authHeader.split(' ')[1];
            const decodedToken = await JWTService.verifyToken(token, false);

            await JWTService.invalidateToken(
                decodedToken.jti,
                'access',
                decodedToken.familyId,
                true,
            );

            const refreshToken = request.cookies.refreshToken;
            if (refreshToken) {
                const decodedRefresh = await JWTService.verifyToken(
                    refreshToken,
                    true,
                );
                await JWTService.invalidateToken(
                    decodedRefresh.jti,
                    'refresh',
                    decodedRefresh.familyId,
                    true,
                );
            }

            AuthHandler.clearRefreshTokenCookie(reply);
            Logger.info(
                `User ${request.user.userId} logged out successfully`,
                'Auth',
            );

            return reply.code(200).send({
                success: true,
                data: {
                    message: 'Logged out successfully',
                },
            });
        }, 'Auth');
    }
}
