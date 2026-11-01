import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { checkIsolation } from "../db/isolation";

/**
 * Hono application for everything that is not a dashboard page:
 *  - /api/auth/*        Better Auth (sign-in, sign-out, session)
 *  - /api/public/v1/*   public booking API, phase 7; identified by publishable key
 *  - /webhooks/stripe/* verified Stripe webhooks, phase 5 and 8
 *
 * Every route here is unauthenticated by nature or authenticated by Better Auth's
 * session cookie. Sign-in is rate limited by Better Auth with database-backed counters
 * (server/auth/auth.ts); a Cloudflare WAF rate-limit rule on /api/* is the outer layer.
 */
export const apiApp = new Hono<{ Bindings: AppEnv }>();

/**
 * Liveness, a database round-trip, and proof that row-level security applies to this
 * connection (server/db/isolation.ts). 503 with a reason code and nothing else on failure.
 */
apiApp.get("/api/health", async (c) => {
	try {
		const db = createDb(c.env);
		const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000));
		await Promise.race([db.execute(sql`select 1`), timeout]);
		const isolation = await Promise.race([checkIsolation(db), timeout]);
		if (!isolation.ok) {
			console.error(JSON.stringify({ level: "error", route: "/api/health", message: `isolation check failed: ${isolation.reason}` }));
			return c.json({ ok: false, env: c.env.APP_ENV, reason: isolation.reason }, 503);
		}
		return c.json({ ok: true, env: c.env.APP_ENV });
	} catch (err) {
		console.error(JSON.stringify({ level: "error", route: "/api/health", message: (err as Error).message }));
		return c.json({ ok: false, env: c.env.APP_ENV, reason: "database" }, 503);
	}
});

// Open registration is phase 8. Invitations create accounts server-side; the public
// endpoint does not exist from the outside, in any environment.
apiApp.all("/api/auth/sign-up/*", (c) => c.json({ error: "not_found" }, 404));

// Password reset runs only through the /forgot page, which throttles by IP and email and
// calls auth.api server-side. The plugin's public endpoints (including OTP sign-in) and the
// link-based reset endpoints are not reachable from outside.
for (const path of ["/api/auth/email-otp/*", "/api/auth/sign-in/email-otp", "/api/auth/forget-password/*", "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/reset-password/*"]) {
	apiApp.all(path, (c) => c.json({ error: "not_found" }, 404));
}

apiApp.on(["GET", "POST"], "/api/auth/*", (c) => {
	const db = createDb(c.env);
	const auth = createAuth(db, c.env);
	return auth.handler(c.req.raw);
});

// Phase 7: public booking API. Declared now so the path is reserved and tested as 404.
apiApp.all("/api/public/*", (c) => c.json({ error: "not_found" }, 404));

// Phase 5 and 8: Stripe webhooks. Declared now so the path is reserved.
apiApp.all("/webhooks/*", (c) => c.json({ error: "not_found" }, 404));

apiApp.notFound((c) => c.json({ error: "not_found" }, 404));

apiApp.onError((err, c) => {
	// Message only; no stack, no request body, no IDs from the request.
	console.error(JSON.stringify({ level: "error", route: c.req.path, message: err.message }));
	return c.json({ error: "internal_error" }, 500);
});
