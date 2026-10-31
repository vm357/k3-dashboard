import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";

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

/** Liveness plus a database round-trip. 503 with no detail when the database is unreachable. */
apiApp.get("/api/health", async (c) => {
	try {
		const db = createDb(c.env);
		await Promise.race([db.execute(sql`select 1`), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))]);
		return c.json({ ok: true, env: c.env.APP_ENV });
	} catch (err) {
		console.error(JSON.stringify({ level: "error", route: "/api/health", message: (err as Error).message }));
		return c.json({ ok: false, env: c.env.APP_ENV }, 503);
	}
});

// Open registration is phase 8. Invitations create accounts server-side; the public
// endpoint does not exist from the outside, in any environment.
apiApp.all("/api/auth/sign-up/*", (c) => c.json({ error: "not_found" }, 404));

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
