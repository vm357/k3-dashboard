import { eq } from "drizzle-orm";
import { require, type AdminCtx, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { businessMembers, businesses } from "../../db/schema";
import { withBypass, withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { createBusinessSchema, updateBusinessSettingsSchema, type CreateBusinessInput, type UpdateBusinessSettingsInput } from "./schema";

/**
 * Create a business and its first owner in one transaction.
 *
 * Two legitimate callers: a platform admin onboarding a client (ownerUserId is the
 * client's user), and self-serve signup in phase 8 (ownerUserId is the caller).
 * This is one of the two sanctioned uses of withBypass, because no tenant exists yet.
 */
export async function createBusiness(
	db: Db,
	actor: AdminCtx | { userId: string; selfServe: true },
	ownerUserId: string,
	raw: CreateBusinessInput,
) {
	const input = createBusinessSchema.parse(raw);
	if (!("isPlatformAdmin" in actor) && actor.userId !== ownerUserId) {
		throw new Error("self-serve signup may only create a business for the signed-in user");
	}
	return withBypass(db, actor.userId, async (tx) => {
		const [business] = await tx
			.insert(businesses)
			.values({ name: input.name, slug: input.slug, timeZone: input.timeZone })
			.returning();
		await tx.insert(businessMembers).values({ businessId: business.id, userId: ownerUserId, role: "owner" });
		await recordAudit(tx, {
			businessId: business.id,
			actorUserId: actor.userId,
			action: "business.create",
			targetTable: "businesses",
			targetId: business.id,
			after: { name: input.name, slug: input.slug, ownerUserId },
		});
		return business;
	});
}

export async function getBusiness(db: Db, ctx: TenantCtx) {
	require(ctx, "settings.view");
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx.select().from(businesses).where(eq(businesses.id, ctx.businessId));
		return row ?? null;
	});
}

export async function updateBusinessSettings(db: Db, ctx: TenantCtx, raw: UpdateBusinessSettingsInput) {
	require(ctx, "settings.edit");
	const patch = updateBusinessSettingsSchema.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [before] = await tx.select().from(businesses).where(eq(businesses.id, ctx.businessId));
		const [after] = await tx
			.update(businesses)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(businesses.id, ctx.businessId))
			.returning();
		await recordAudit(tx, {
			businessId: ctx.businessId,
			actorUserId: ctx.userId,
			action: "business.settings.update",
			targetTable: "businesses",
			targetId: ctx.businessId,
			before: pick(before, Object.keys(patch)),
			after: pick(after, Object.keys(patch)),
		});
		return after;
	});
}

function pick<T extends object>(obj: T | undefined, keys: string[]) {
	if (!obj) return null;
	return Object.fromEntries(keys.map((k) => [k, (obj as Record<string, unknown>)[k]]));
}
