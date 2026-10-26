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
			// Self-serve signup is phase 8. Until then accounts are created by invitation
			// or by the seed script, so open registration is off.
			disableSignUp: env.APP_ENV === "production",
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
		},
		trustedOrigins: [env.APP_ORIGIN],
	});
}

export type Auth = ReturnType<typeof createAuth>;
