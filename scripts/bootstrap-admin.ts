import { sql } from "drizzle-orm";
import { createAuth } from "../server/auth/auth";
import { createDb } from "../server/db/client";
import * as schema from "../server/db/schema";
import { withBypass } from "../server/db/tenant";
import { readEnv } from "../server/env";

/**
 * Creates the first platform admin in an empty database. This is the only way into a
 * fresh staging or production deployment: open sign-up is closed and the seed script
 * refuses to run there. It refuses to run once any user exists, so it cannot be used
 * later to add admins; a further admin is made by setting is_platform_admin on the
 * user's row (there is no screen for that yet, on purpose).
 *
 *   DATABASE_URL=<owner connection string> AUTH_SECRET=<the Worker's AUTH_SECRET> \
 *   APP_ORIGIN=https://app.kermitwebcraft.com \
 *   ADMIN_EMAIL=you@kermitwebcraft.com ADMIN_NAME="Kermit" ADMIN_PASSWORD='<12+ chars>' \
 *   npx tsx scripts/bootstrap-admin.ts
 *
 * The password hash is Better Auth's own, so the account signs in normally afterwards.
 * Nothing is printed except the outcome; the password is read once and never logged.
 */
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.ADMIN_NAME?.trim() || "Admin";
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

const env = readEnv({
	APP_ENV: process.env.APP_ENV ?? "production",
	APP_ORIGIN: process.env.APP_ORIGIN ?? "https://app.kermitwebcraft.com",
	AUTH_SECRET: process.env.AUTH_SECRET,
	DATABASE_URL: process.env.DATABASE_URL,
});
const db = createDb(env);

const [{ n }] = await withBypass(db, null, (tx) => tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.users));
if (n > 0) {
	console.error(`Refusing: ${n} user(s) already exist. Further admins are made by setting is_platform_admin on their user row.`);
	process.exit(1);
}

const auth = createAuth(db, env);
const res = await auth.api.signUpEmail({ body: { email, password, name }, headers: new Headers(), asResponse: true });
if (!res.ok) {
	console.error(`Could not create the account (${res.status}).`);
	process.exit(1);
}
await withBypass(db, null, (tx) => tx.update(schema.users).set({ isPlatformAdmin: true }).where(sql`lower(${schema.users.email}) = ${email}`));
console.log(`Platform admin ${email} created. Sign in at ${env.APP_ORIGIN}/sign-in, then onboard the first business under /admin.`);
process.exit(0);
