import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { businessMembers, businesses } from "../db/schema";
import { withUser } from "../db/tenant";
import { isPermissionKey, type PermissionKey } from "./permissions";

/**
 * The request context every domain function takes as its first argument.
 * It is built from the session and the membership table, never from anything
 * the browser sent. If a route handler has a TenantCtx, the user is a member of
 * that business; there is no other way to obtain one.
 */
export interface TenantCtx {
	userId: string;
	businessId: string;
	businessSlug: string;
	role: "owner" | "employee";
	permissions: ReadonlySet<PermissionKey>;
}

/** A platform administrator acting outside any tenant. */
export interface AdminCtx {
	userId: string;
	isPlatformAdmin: true;
}

export class ForbiddenError extends Error {
	readonly status = 403;
	constructor(public readonly permission: PermissionKey | "owner" | "platform_admin") {
		super(`forbidden: ${permission}`);
	}
}

/** Broader keys imply narrower ones so an owner granting "everyone's" never has to also tick "own". */
const IMPLIED: Partial<Record<PermissionKey, PermissionKey[]>> = {
	"calendar.view_all": ["calendar.view_own"],
	"appointments.manage_all": ["appointments.manage_own", "calendar.view_all", "calendar.view_own"],
	"customers.edit": ["customers.view"],
	"services.manage": ["services.view"],
	"team.manage": ["team.view"],
	"settings.edit": ["settings.view"],
};

export function can(ctx: TenantCtx, key: PermissionKey): boolean {
	if (ctx.role === "owner" || ctx.permissions.has(key)) return true;
	for (const [held, implied] of Object.entries(IMPLIED)) if (ctx.permissions.has(held as PermissionKey) && implied?.includes(key)) return true;
	return false;
}

export function require(ctx: TenantCtx, key: PermissionKey): void {
	if (!can(ctx, key)) throw new ForbiddenError(key);
}

export function requireOwner(ctx: TenantCtx): void {
	if (ctx.role !== "owner") throw new ForbiddenError("owner");
}

/**
 * Resolve the context for `userId` acting on the business at `slug`.
 * Returns null when the user is not a member or the business does not exist;
 * callers answer 404 either way, so the slug's existence is not confirmed.
 */
export async function resolveTenantCtx(db: Db, userId: string, slug: string): Promise<TenantCtx | null> {
	return withUser(db, userId, async (tx) => {
		const rows = await tx
			.select({
				businessId: businesses.id,
				status: businesses.status,
				role: businessMembers.role,
				permissions: businessMembers.permissions,
			})
			.from(businesses)
			.innerJoin(businessMembers, eq(businessMembers.businessId, businesses.id))
			.where(and(eq(businesses.slug, slug), eq(businessMembers.userId, userId)))
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return {
			userId,
			businessId: row.businessId,
			businessSlug: slug,
			role: row.role,
			permissions: new Set(row.permissions.filter(isPermissionKey)),
		};
	});
}

/** Businesses the user may enter, for the workspace switcher and post-login redirect. */
export async function listMemberships(db: Db, userId: string) {
	return withUser(db, userId, (tx) =>
		tx
			.select({ businessId: businesses.id, slug: businesses.slug, name: businesses.name, role: businessMembers.role })
			.from(businessMembers)
			.innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
			.where(eq(businessMembers.userId, userId)),
	);
}
