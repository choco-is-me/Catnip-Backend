// src/schemas/auth/index.ts
import { Type } from '@sinclair/typebox';
import { ResponseWrapper } from '../common';
import { UserSchema } from '../users';

// Request schemas with examples
export const LoginRequestBody = Type.Object(
    {
        email: Type.String({ format: 'email', examples: ['john@example.com'] }),
        password: Type.String({ examples: ['YourSecurePass123!'] }),
    },
    {
        description: 'Login credentials',
        examples: [
            {
                email: 'john@example.com',
                password: 'YourSecurePass123!',
            },
        ],
    },
);

// Response schemas with examples
export const TokensSchema = Type.Object({
    accessToken: Type.String({ examples: ['eyJhbGciOiJIUzI1NiIsI...'] }),
    refreshToken: Type.Optional(Type.String()),
});

// Define response examples as const to ensure literal types
const loginResponseExample = {
    success: true as const, // Force literal type
    data: {
        user: {
            _id: '507f1f77bcf86cd799439011',
            email: 'john@example.com',
            firstName: 'John',
            lastName: 'Doe',
            address: {
                street: '123 Main St',
                city: 'New York',
                province: 'NY',
                zipCode: '10001',
            },
            phoneNumber: '+1234567890',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z',
        },
        tokens: {
            accessToken: 'eyJhbGciOiJIUzI1NiIsI...',
        },
    },
};

const refreshTokenExample = {
    success: true as const,
    data: {
        tokens: {
            accessToken: 'eyJhbGciOiJIUzI1NiIsI...',
        },
    },
};

const logoutExample = {
    success: true as const,
    data: {
        message: 'Logged out successfully',
    },
};

export const LoginResponseSchema = ResponseWrapper(
    Type.Object({
        user: UserSchema,
        tokens: TokensSchema,
    }),
    {
        description: 'Successful login response',
        examples: [loginResponseExample],
    },
);

export const RefreshTokenResponseSchema = ResponseWrapper(
    Type.Object({
        tokens: TokensSchema,
    }),
    {
        description: 'Token refresh response',
        examples: [refreshTokenExample],
    },
);

export const LogoutResponseSchema = ResponseWrapper(
    Type.Object({
        message: Type.Literal('Logged out successfully'),
    }),
    {
        description: 'Logout response',
        examples: [logoutExample],
    },
);
