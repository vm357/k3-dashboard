import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { Db } from "../../server/db/client";
import * as schema from "../../server/db/schema";
import { withBypass } from "../../server/db/tenant";

/**
 * A fresh database per test file: migrations applied as the superuser, then the
 * session switches to k3_app so every query the tests run is subject to RLS,
 * exactly like the Worker's connection.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
	const client = new PGlite();
	const pglite = drizzle(client, { schema });
	await migrate(pglite, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
	await pglite.execute(sql`set role k3_app`);
	return { db: pglite as unknown as Db, close: () => client.close() };
}

let counter = 0;

/** Insert a login identity directly; Better Auth owns this table in production. */
export async function seedUser(db: Db, opts: { name?: string; isPlatformAdmin?: boolean } = {}) {
	counter += 1;
	const [user] = await withBypass(db, null, (tx) =>
		tx
			.insert(schema.users)
			.values({
				name: opts.name ?? `User ${counter}`,
				email: `user${counter}-${Date.now()}@example.test`,
				isPlatformAdmin: opts.isPlatformAdmin ?? false,
			})
			.returning(),
	);
	return user;
}

/** Drizzle wraps driver errors; the Postgres message lives in `cause`. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
	let caught: unknown;
	try {
		await promise;
	} catch (err) {
		caught = err;
	}
	if (!caught) throw new Error(`expected a database error matching ${pattern}, but the query succeeded`);
	const e = caught as { message?: string; cause?: { message?: string } };
	const message = `${e.cause?.message ?? ""} ${e.message ?? ""}`;
	if (!pattern.test(message)) throw new Error(`expected error matching ${pattern}, got: ${message}`);
}
