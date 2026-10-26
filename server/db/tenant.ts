import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client";

/**
 * Every domain query runs inside one of these three transaction scopes. They set
 * the session variables that the RLS policies read (server/db/rls.ts). Because the
 * settings are transaction-local (`set_config(..., true)`), nothing leaks between
 * requests even when a connection is reused by the pool.
 */

export interface TenantScope {
	businessId: string;
	userId: string;
}

/** Act on one business as a member of it. */
export function withTenant<T>(db: Db, scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select set_config('app.business_id', ${scope.businessId}, true), set_config('app.user_id', ${scope.userId}, true)`,
		);
		return fn(tx);
	});
}

/** Act as a signed-in user with no business selected: only their own memberships are visible. */
export function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
		return fn(tx);
	});
}

/**
 * Bypass tenant isolation. Only two callers are allowed: platform-admin services,
 * which must write an audit row before returning, and business creation, which
 * has no tenant yet. Any other use is a code-review failure.
 */
export function withBypass<T>(db: Db, actorUserId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select set_config('app.bypass_rls', 'on', true), set_config('app.user_id', ${actorUserId ?? ""}, true)`,
		);
		return fn(tx);
	});
}
