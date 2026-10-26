import { sql } from "drizzle-orm";
import { pgPolicy, pgRole } from "drizzle-orm/pg-core";

/**
 * Row-level security building blocks.
 *
 * The Worker connects to Postgres as `k3_app`, which owns nothing and therefore
 * cannot bypass RLS. Per request, the transaction sets:
 *   app.business_id  the tenant the request acts on, derived from membership
 *   app.user_id      the signed-in user, used only to find their own memberships
 *   app.bypass_rls   'on' only inside platform-admin code paths, which audit every call
 *
 * A query that forgets its WHERE business_id returns nothing rather than leaking.
 */
export const appRole = pgRole("k3_app");

export const currentBusinessId = sql`nullif(current_setting('app.business_id', true), '')::uuid`;
export const currentUserId = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
export const bypassOn = sql`current_setting('app.bypass_rls', true) = 'on'`;

/**
 * app_is_member() is a SECURITY DEFINER function created in migration 0000. It
 * checks that app.user_id is a member of app.business_id, reading business_members
 * without RLS. Every tenant policy requires it, so a context whose business_id was
 * not derived from the caller's own membership sees nothing, even if server code
 * were tricked into setting it.
 */
export const tenantMatch = sql`(business_id = ${currentBusinessId} and app_is_member())`;

/** Standard tenant policy for a table with a business_id column. */
export function tenantPolicy(table: string) {
	const cond = sql`(${bypassOn} or ${tenantMatch})`;
	return pgPolicy(`${table}_tenant`, { for: "all", to: appRole, using: cond, withCheck: cond });
}
