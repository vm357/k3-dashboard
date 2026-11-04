import { z } from "zod";

/**
 * Validated runtime environment. Fails loudly at the first request of a deploy
 * that is missing a secret, instead of failing the first customer.
 *
 * Only names are declared here; values come from wrangler vars, .dev.vars and
 * `wrangler secret`. Nothing in this module may be imported by browser code.
 */
const EnvSchema = z.object({
	APP_ENV: z.enum(["development", "test", "staging", "production"]),
	APP_ORIGIN: z.url(),
	AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
	DATABASE_URL: z.string().min(1).optional(),
	STRIPE_SECRET_KEY: z.string().optional(),
	STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_PLATFORM_WEBHOOK_SECRET: z.string().optional(),
	RESEND_API_KEY: z.string().optional(),
	/** Verified sender address on the Resend domain. The display name is set per email. */
	EMAIL_FROM_ADDRESS: z.email().default("no-reply@mail.kermitwebcraft.com"),
	/** Twilio, for reminder texts. Until all three are set, reminders are sent from the owner's phone. */
	TWILIO_ACCOUNT_SID: z.string().optional(),
	TWILIO_AUTH_TOKEN: z.string().optional(),
	TWILIO_FROM_NUMBER: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema> & {
	/** Hyperdrive binding, present in staging and production. */
	HYPERDRIVE?: { connectionString: string };
};

let cached: AppEnv | undefined;

export function readEnv(raw: unknown): AppEnv {
	if (cached) return cached;
	const parsed = EnvSchema.safeParse(raw);
	if (!parsed.success) {
		// Names only. Values are never logged.
		const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
		throw new Error(`Invalid environment configuration: ${missing}`);
	}
	const r = raw as { HYPERDRIVE?: { connectionString: string } };
	if (!parsed.data.DATABASE_URL && !r.HYPERDRIVE?.connectionString) {
		throw new Error("Invalid environment configuration: DATABASE_URL or HYPERDRIVE is required");
	}
	cached = { ...parsed.data, HYPERDRIVE: r.HYPERDRIVE };
	return cached;
}

export function databaseUrl(env: AppEnv): string {
	return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL!;
}
