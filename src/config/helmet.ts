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
				// Enhanced CSP directives
				baseUri: ["'self'"],
				formAction: ["'self'"],
				frameAncestors: ["'none'"],
				manifestSrc: ["'self'"],
				mediaSrc: ["'self'"],
				upgradeInsecureRequests: [],
				blockAllMixedContent: [],
			},
		},
		hsts: {
			maxAge: 15552000, // 180 days
			includeSubDomains: true,
			preload: true,
		},
		referrerPolicy: {
			policy: "strict-origin-when-cross-origin",
		},
		// Additional security headers
		hidePoweredBy: true,
		noSniff: true,
		xssFilter: true,
		// Enhanced security headers
		dnsPrefetchControl: {
			allow: false,
		},
		frameguard: {
			action: "deny",
		},
		crossOriginOpenerPolicy: {
			policy: "same-origin",
		},
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
					// Development-specific CSP rules
					scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
					styleSrc: ["'self'", "'unsafe-inline'"],
					// Allow connection to development servers
					connectSrc: ["'self'", "ws:", "wss:"],
				},
			};

			// Disable certain strict security measures in development
			baseConfig.crossOriginEmbedderPolicy = false;
			baseConfig.crossOriginResourcePolicy = false;
			baseConfig.crossOriginOpenerPolicy = false;
		}
	}

	return baseConfig;
};
