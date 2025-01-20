// src/config/helmet.ts

import { FastifyHelmetOptions } from "@fastify/helmet";
import { CONFIG } from "./index";

export const getHelmetConfig = (): FastifyHelmetOptions => {
	const baseConfig: FastifyHelmetOptions = {
		global: true,
		crossOriginEmbedderPolicy: false,
		crossOriginResourcePolicy: false,
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
				styleSrc: ["'self'", "'unsafe-inline'"],
				imgSrc: ["'self'", "data:", "https:"],
				connectSrc: ["'self'"],
				frameSrc: ["'none'"],
				objectSrc: ["'none'"],
				workerSrc: ["'self'"],
			},
		},
		hsts: {
			maxAge: 15552000,
			includeSubDomains: true,
			preload: true,
		},
		referrerPolicy: {
			policy: "strict-origin-when-cross-origin",
		},
		// Additional standard security headers
		hidePoweredBy: true,
		noSniff: true,
		xssFilter: true,
	};

	if (CONFIG.NODE_ENV === "development") {
		// Relax some security settings for development
		if (
			baseConfig.contentSecurityPolicy &&
			typeof baseConfig.contentSecurityPolicy === "object"
		) {
			baseConfig.contentSecurityPolicy = {
				useDefaults: true,
				reportOnly: false,
				directives: {
					...baseConfig.contentSecurityPolicy.directives,
					// Add development-specific CSP rules
					scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
					styleSrc: ["'self'", "'unsafe-inline'"],
				},
			};
		}
	}

	return baseConfig;
};
