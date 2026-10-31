import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * Proves at runtime that the connection the Worker holds is subject to row-level
 * security. The policies are written `TO k3_app`, so a connection as any other role,
 * or as a role with SUPERUSER or BYPASSRLS, sees every tenant's rows. Neon in
 * particular grants roles created in its Console membership of `neon_superuser`,
 * which carries BYPASSRLS (docs/LAUNCH.md, step 1). This check is what turns that
 * mistake into a failing health check and smoke test instead of a quiet data leak.
 *
 * Three checks, cheapest first: the role name, the role's attributes, and a query that
 * must return nothing when no tenant context is set.
 */
export async function checkIsolation(db: Db): Promise<{ ok: true } | { ok: false; reason: string }> {
	const [who] = (await db.execute(sql`select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname = current_user`)) as unknown as {
		role: string;
		rolsuper: boolean;
		rolbypassrls: boolean;
	}[];
	if (!who) return { ok: false, reason: "role_unknown" };
	if (who.role !== "k3_app") return { ok: false, reason: `connected_as_${who.role}` };
	if (who.rolsuper) return { ok: false, reason: "superuser" };
	if (who.rolbypassrls) return { ok: false, reason: "bypassrls" };
	const [row] = (await db.execute(sql`select count(*)::int as n from customers`)) as unknown as { n: number }[];
	if (row && row.n > 0) return { ok: false, reason: "rls_not_enforced" };
	return { ok: true };
}
