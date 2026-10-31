import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { apiApp } from "../../server/api/app";
import { checkIsolation } from "../../server/db/isolation";
import { createAuth } from "../../server/auth/auth";
import { securityHeaders, withSecurityHeaders } from "../../server/http/security";
import { createRouteHarness, type RouteHarness } from "../helpers/server";

/**
 * The HTTP edge: what an outsider can reach and what every response carries.
 * These run against the real Hono app and a real Better Auth instance over the
 * test database, with rate limiting switched on the way staging has it.
 */
describe("http edge", () => {
	let h: RouteHarness;
	const exec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

	beforeAll(async () => {
		h = await createRouteHarness();
		await h.seedUser({ email: "owner@k3.test", name: "Owner" });
	}, 120_000);
	afterAll(() => h.close());

	it("the public sign-up endpoint does not exist, even though invitations can create accounts", async () => {
		const res = await apiApp.fetch(
			new Request("http://localhost/api/auth/sign-up/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "intruder@k3.test", password: "a-long-enough-password", name: "x" }),
			}),
			h.env,
			exec,
		);
		expect(res.status).toBe(404);
		// Sign-in itself still works through the same router.
		const ok = await apiApp.fetch(
			new Request("http://localhost/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "owner@k3.test", password: "correct horse battery staple" }),
			}),
			h.env,
			exec,
		);
		expect(ok.status).toBe(200);
	});

	it("health reports the database round-trip and never leaks a connection string", async () => {
		const res = await apiApp.fetch(new Request("http://localhost/api/health"), h.env, exec);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, env: "test" });
		const bad = await apiApp.fetch(new Request("http://localhost/api/health"), { ...h.env, DATABASE_URL: "postgres://nobody:secret@127.0.0.1:1/none" }, exec);
		expect(bad.status).toBe(503);
		expect(await bad.text()).not.toContain("secret");
	}, 20_000);

	it("health fails when the connection could bypass row-level security", async () => {
		// The test database's k3_app is a plain role, so the real check passes...
		expect(await checkIsolation(h.db)).toEqual({ ok: true });
		// ...and a role with BYPASSRLS (what Neon's Console creates) is reported, not ignored.
		await h.db.execute(sql`reset role`);
		await h.db.execute(sql`do $$ begin if not exists (select 1 from pg_roles where rolname = 'k3_console') then create role k3_console bypassrls; end if; end $$`);
		await h.db.execute(sql`grant k3_app to k3_console`);
		await h.db.execute(sql`set role k3_console`);
		try {
			const r = await checkIsolation(h.db);
			expect(r).toEqual({ ok: false, reason: "connected_as_k3_console" });
		} finally {
			await h.db.execute(sql`reset role`);
			await h.db.execute(sql`set role k3_app`);
		}
	});

	it("sign-in is rate limited per client IP with counters in the database", async () => {
		const auth = createAuth(h.db, { ...h.env, APP_ENV: "staging" });
		const attempt = (ip: string) =>
			auth.handler(
				new Request("http://localhost/api/auth/sign-in/email", {
					method: "POST",
					headers: { "content-type": "application/json", "cf-connecting-ip": ip, "x-forwarded-for": "9.9.9.9" },
					body: JSON.stringify({ email: "owner@k3.test", password: "wrong-wrong-wrong" }),
				}),
			);
		const statuses: number[] = [];
		for (let i = 0; i < 11; i++) statuses.push((await attempt("203.0.113.5")).status);
		expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
		expect(statuses[10]).toBe(429);
		// A different client is not affected by the first one's lockout.
		expect((await attempt("203.0.113.6")).status).toBe(401);
	}, 60_000);

	it("every response carries the security headers; CSP and HSTS outside development", () => {
		const prod = securityHeaders({ ...h.env, APP_ENV: "production" }, "abc123");
		expect(prod["Content-Security-Policy"]).toContain("script-src 'self' 'nonce-abc123'");
		expect(prod["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
		expect(prod["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
		expect(prod["X-Content-Type-Options"]).toBe("nosniff");
		const dev = securityHeaders({ ...h.env, APP_ENV: "development" }, "abc123");
		expect(dev["Content-Security-Policy"]).toBeUndefined();
		expect(dev["X-Frame-Options"]).toBe("DENY");
		const wrapped = withSecurityHeaders(new Response("hi", { status: 201, headers: { "x-custom": "kept" } }), { ...h.env, APP_ENV: "staging" }, "n");
		expect(wrapped.status).toBe(201);
		expect(wrapped.headers.get("x-custom")).toBe("kept");
		expect(wrapped.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
	});
});
