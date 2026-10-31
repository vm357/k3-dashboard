import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl, type AppEnv } from "../env";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Driver-agnostic database handle: postgres.js in the Worker, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/**
 * One client per request. Workers do not keep connections between requests and I/O
 * objects cannot be shared across requests; Hyperdrive does the pooling on the
 * Cloudflare side. Tests are the exception: the wire-protocol PGlite used there serves
 * one connection at a time, so test mode shares a single client per URL.
 */
const testClients = new Map<string, ReturnType<typeof postgres>>();

export function createDb(env: AppEnv): Db {
	const url = databaseUrl(env);
	if (env.APP_ENV === "test") {
		let client = testClients.get(url);
		if (!client) {
			client = postgres(url, { prepare: false, max: 1 });
			testClients.set(url, client);
		}
		return drizzle(client, { schema }) as unknown as Db;
	}
	// One request, one connection; loaders within a request share it through servicesContext.
	const client = postgres(url, { prepare: false, max: 1 });
	return drizzle(client, { schema }) as unknown as Db;
}

/** Test teardown only. */
export async function closeTestClients(): Promise<void> {
	for (const c of testClients.values()) await c.end({ timeout: 1 });
	testClients.clear();
}

export { schema };
