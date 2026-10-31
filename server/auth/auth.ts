import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";

/**
 * Better Auth, built per request because the Worker has no process-level state.
 * Only staff sign in here; customers never have accounts (see the plan, section 2.D).
 *
 * Sessions: database-backed, HTTP-only cookie, 30-day idle expiry, refreshed daily.
 * Passkeys and TOTP for platform admins are additive plugins for a later session.
 */
export function createAuth(db: Db, env: AppEnv) {
	return betterAuth({
		baseURL: env.APP_ORIGIN,
		secret: env.AUTH_SECRET,
		database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 12,
			// Self-serve signup is phase 8. Until then accounts come from invitations (which
			// call signUpEmail server-side) and the seed script. The public HTTP endpoint is
			// blocked in server/api/app.ts in every environment; `disableSignUp` is not used
			// because it would also break invitation acceptance.
		},
		rateLimit: {
			// Off in development and test; the route tests switch it on explicitly.
			enabled: env.APP_ENV === "staging" || env.APP_ENV === "production",
			storage: "database",
			window: 10,
			max: 60,
			customRules: {
				// Credential guessing: 10 attempts a minute per IP, then 429.
				"/sign-in/email": { window: 60, max: 10 },
				"/request-password-reset": { window: 60, max: 5 },
			},
		},
		user: {
			additionalFields: {
				isPlatformAdmin: { type: "boolean", defaultValue: false, input: false },
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24,
		},
		advanced: {
			database: { generateId: "uuid" },
			useSecureCookies: env.APP_ENV !== "development" && env.APP_ENV !== "test",
			// Cloudflare sets cf-connecting-ip from the real client; x-forwarded-for is
			// client-controlled and must not be trusted.
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
		},
		trustedOrigins: [env.APP_ORIGIN],
	});
}

export type Auth = ReturnType<typeof createAuth>;
