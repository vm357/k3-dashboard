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
 * session cookie. Rate limiting for /api/public and /api/auth is a Cloudflare rule,
 * not application code.
 */
export const apiApp = new Hono<{ Bindings: AppEnv }>();

apiApp.get("/api/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));

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
