import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { createAuth } from "../../server/auth/auth";
import { envContext, executionContext } from "../../server/context";
import { closeTestClients, createDb, type Db } from "../../server/db/client";
import * as schema from "../../server/db/schema";
import { withBypass } from "../../server/db/tenant";
import type { AppEnv } from "../../server/env";

/**
 * Route-level harness: PGlite served over the Postgres wire protocol, so the real
 * postgres.js client used by the Worker talks to it; a RouterContextProvider carrying
 * the env; and helpers that sign users in through Better Auth to get real cookies.
 *
 * Migrations run as PGlite's superuser; then the k3_app role is given a password so the
 * Worker-side connection (which is subject to RLS) can authenticate as it.
 */
export interface RouteHarness {
	db: Db;
	env: AppEnv;
	context: RouterContextProvider;
	close: () => Promise<void>;
	seedUser: (opts: { email: string; name?: string; password?: string; isPlatformAdmin?: boolean }) => Promise<{ id: string; email: string; cookie: string }>;
	signIn: (email: string, password?: string) => Promise<string>;
}

const PASSWORD = "correct horse battery staple";

export async function createRouteHarness(): Promise<RouteHarness> {
	const pglite = new PGlite({ extensions: { btree_gist } });
	const sudo = drizzle(pglite, { schema });
	await migrate(sudo, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
	await sudo.execute(sql`alter role k3_app with login password 'k3_app'`);

	const port = 54000 + Math.floor(Math.random() * 1000);
	const server = new PGLiteSocketServer({ db: pglite, port, host: "127.0.0.1" });
	await server.start();

	const env: AppEnv = {
		APP_ENV: "test",
		APP_ORIGIN: "http://localhost",
		AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
		DATABASE_URL: `postgres://k3_app:k3_app@127.0.0.1:${port}/postgres`,
	};
	const context = new RouterContextProvider();
	context.set(envContext, env);
	context.set(executionContext, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

	const db = createDb(env);
	// The PGlite socket ignores the URL's user, so switch the shared connection to the
	// application role ourselves; the route layer must run under row-level security too.
	await db.execute(sql`set role k3_app`);
	const auth = createAuth(db, env);

	async function signIn(email: string, password = PASSWORD): Promise<string> {
		const res = await auth.api.signInEmail({ body: { email, password }, headers: new Headers(), asResponse: true });
		if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status}`);
		return cookieFrom(res);
	}

	async function seedUser(opts: { email: string; name?: string; password?: string; isPlatformAdmin?: boolean }) {
		const res = await auth.api.signUpEmail({
			body: { email: opts.email, password: opts.password ?? PASSWORD, name: opts.name ?? opts.email.split("@")[0] },
			headers: new Headers(),
			asResponse: true,
		});
		if (!res.ok) throw new Error(`sign-up failed for ${opts.email}: ${res.status} ${await res.text()}`);
		const cookie = cookieFrom(res);
		const [row] = await withBypass(db, null, (tx) =>
			tx.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${opts.email.toLowerCase()}`),
		);
		if (opts.isPlatformAdmin) {
			await withBypass(db, null, (tx) => tx.update(schema.users).set({ isPlatformAdmin: true }).where(sql`${schema.users.id} = ${row.id}`));
		}
		return { id: row.id, email: opts.email, cookie };
	}

	return {
		db,
		env,
		context,
		seedUser,
		signIn,
		close: async () => {
			await closeTestClients();
			await server.stop();
			await pglite.close();
		},
	};
}

function cookieFrom(res: Response): string {
	const all = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
	return all.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

export function req(url: string, init: { cookie?: string; method?: string; form?: Record<string, string> } = {}): Request {
	const headers = new Headers();
	if (init.cookie) headers.set("cookie", init.cookie);
	let body: BodyInit | undefined;
	if (init.form) {
		body = new URLSearchParams(init.form);
		headers.set("content-type", "application/x-www-form-urlencoded");
	}
	return new Request(`http://localhost${url}`, { method: init.method ?? (init.form ? "POST" : "GET"), headers, body });
}

/** Loaders throw Responses for redirects and 404s; normalize to a status. */
export async function status(run: () => Promise<unknown>): Promise<{ status: number; location?: string; data?: unknown }> {
	try {
		const data = await run();
		if (data instanceof Response) return { status: data.status, location: data.headers.get("location") ?? undefined };
		return { status: 200, data };
	} catch (err) {
		if (err instanceof Response) return { status: err.status, location: err.headers.get("location") ?? undefined };
		throw err;
	}
}
