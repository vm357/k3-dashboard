import { eq } from "drizzle-orm";
import { ForbiddenError, type AdminCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { businesses } from "../../db/schema";
import { withBypass } from "../../db/tenant";
import { recordAudit } from "../audit/service";

/**
 * Platform-admin services. Every function here runs under withBypass and writes an
 * audit row in the same transaction. The AdminCtx type is only constructed by the
 * admin route layout after checking users.is_platform_admin, so a non-admin cannot
 * reach these without forging a ctx in server code.
 */
function assertAdmin(ctx: AdminCtx) {
	if (ctx.isPlatformAdmin !== true) throw new ForbiddenError("platform_admin");
}

export async function listBusinesses(db: Db, ctx: AdminCtx) {
	assertAdmin(ctx);
	return withBypass(db, ctx.userId, async (tx) => {
		await recordAudit(tx, { businessId: null, actorUserId: ctx.userId, action: "admin.businesses.list" });
		return tx
			.select({ id: businesses.id, slug: businesses.slug, name: businesses.name, status: businesses.status, createdAt: businesses.createdAt })
			.from(businesses)
			.orderBy(businesses.createdAt);
	});
}

export async function setBusinessStatus(db: Db, ctx: AdminCtx, businessId: string, status: "active" | "suspended", reason: string) {
	assertAdmin(ctx);
	if (reason.trim().length < 3) throw new Error("a reason is required");
	return withBypass(db, ctx.userId, async (tx) => {
		const [before] = await tx.select({ status: businesses.status }).from(businesses).where(eq(businesses.id, businessId));
		if (!before) throw new Error("business_not_found");
		const [after] = await tx
			.update(businesses)
			.set({ status, updatedAt: new Date() })
			.where(eq(businesses.id, businessId))
			.returning({ id: businesses.id, status: businesses.status });
		await recordAudit(tx, {
			businessId,
			actorUserId: ctx.userId,
			action: status === "suspended" ? "admin.business.suspend" : "admin.business.reactivate",
			targetTable: "businesses",
			targetId: businessId,
			before: { status: before.status },
			after: { status, reason },
		});
		return after;
	});
}
