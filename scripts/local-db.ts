import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";

/**
 * A zero-install local Postgres for development: PGlite served over the wire protocol,
 * data persisted under .local-db/. Migrations are applied on every start.
 *
 *   npm run db:local            then in another terminal: npm run dev
 *
 * DATABASE_URL for .dev.vars: postgres://k3_app:k3_app@127.0.0.1:5433/postgres
 * Serves one connection at a time, which is fine for one developer, not for a team.
 */
const port = Number(process.env.LOCAL_DB_PORT ?? 5433);
const dir = path.resolve(process.cwd(), ".local-db");

const pglite = new PGlite(dir, { extensions: { btree_gist } });
const db = drizzle(pglite);
await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
await db.execute(sql`alter role k3_app with login password 'k3_app'`);
// The socket server ignores the connecting user, so every connection shares this one
// session: switch it to the application role now, and local dev runs under row-level
// security exactly as production does. Migrations above ran as the owner, as they must.
await db.execute(sql`set role k3_app`);

const server = new PGLiteSocketServer({ db: pglite, port, host: "127.0.0.1" });
await server.start();
console.log(`local Postgres ready on postgres://k3_app:k3_app@127.0.0.1:${port}/postgres (data in .local-db/)`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, async () => {
		await server.stop();
		await pglite.close();
		process.exit(0);
	});
}
