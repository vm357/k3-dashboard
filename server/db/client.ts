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
 * One client per request. Workers do not keep connections between requests;
 * Hyperdrive does the pooling on the Cloudflare side.
 */
export function createDb(env: AppEnv): Db {
	const client = postgres(databaseUrl(env), { prepare: false, max: 1 });
	return drizzle(client, { schema }) as unknown as Db;
}

export { schema };
