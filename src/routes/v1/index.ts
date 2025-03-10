// src/routes/v1/users/index.ts
import { FastifyInstance } from 'fastify';
import authRoutes from './auth/auth.routes';
import cardRoutes from './cards/cards.routes';
import cartRoutes from './cart/cart.routes';
import itemRoutes from './items/items.routes';
import publicItemRoutes from './items/public.items.routes';
import supplierRoutes from './suppliers/suppliers.routes';
import userRoutes from './users/user.routes';

export default async function modifierRoutes(fastify: FastifyInstance) {
    // Public routes (no authentication required)
    await fastify.register(authRoutes, { prefix: '/auth' });
    await fastify.register(publicItemRoutes, { prefix: '/public/items' });

    // User routes (requires user role)
    await fastify.register(userRoutes, { prefix: '/users' });
    await fastify.register(cardRoutes, { prefix: '/cards' });
    await fastify.register(cartRoutes, { prefix: '/cart' });

    // Admin routes (requires admin role)
    await fastify.register(itemRoutes, { prefix: '/items' });
    await fastify.register(supplierRoutes, { prefix: '/suppliers' });
}
