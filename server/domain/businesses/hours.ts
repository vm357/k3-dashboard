import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { businessHours, businesses } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const hoursInput = z.array(
	z
		.object({ weekday: z.coerce.number().int().min(0).max(6), opensAt: hhmm, closesAt: hhmm })
		.refine((r) => r.opensAt < r.closesAt, { message: "Closing must be after opening", path: ["closesAt"] }),
);

/**
 * Booking policy lives as JSON on the business so new rules do not need migrations.
 * Every field has a default; the engine (phase 3) reads through `readPolicy`.
 */
export const policySchema = z.object({
	slotIntervalMinutes: z.coerce.number().int().min(5).max(60).default(15),
	minNoticeMinutes: z.coerce.number().int().min(0).max(60 * 24 * 14).default(120),
	maxAdvanceDays: z.coerce.number().int().min(1).max(365).default(60),
	cancellationWindowHours: z.coerce.number().int().min(0).max(24 * 14).default(24),
	cancellationNote: z.string().trim().max(300).optional().or(z.literal("")),
	/** Reminder text with {first_name} {business} {service} {date} {time} {staff}; empty = the default. */
	reminderTemplate: z.string().trim().max(320).optional().or(z.literal("")),
});
export type BookingPolicy = z.output<typeof policySchema>;

export function readPolicy(raw: unknown): BookingPolicy {
	const parsed = policySchema.safeParse(raw ?? {});
	return parsed.success ? parsed.data : policySchema.parse({});
}

export async function getHours(db: Db, ctx: TenantCtx) {
	require(ctx, "settings.view");
	return withTenant(db, ctx, (tx) =>
		tx.select().from(businessHours).where(eq(businessHours.businessId, ctx.businessId)).orderBy(asc(businessHours.weekday)),
	);
}

/** Replace all opening hours. A weekday absent from `rows` is closed. */
export async function setHours(db: Db, ctx: TenantCtx, raw: unknown) {
	require(ctx, "settings.edit");
	const rows = hoursInput.parse(raw);
	const days = new Set(rows.map((r) => r.weekday));
	if (days.size !== rows.length) throw new Error("one row per weekday");
	return withTenant(db, ctx, async (tx) => {
		await tx.delete(businessHours).where(eq(businessHours.businessId, ctx.businessId));
		if (rows.length > 0) await tx.insert(businessHours).values(rows.map((r) => ({ ...r, businessId: ctx.businessId })));
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "business.hours.set", targetTable: "business_hours", after: { rows } });
	});
}

export async function getPolicy(db: Db, ctx: TenantCtx): Promise<BookingPolicy> {
	require(ctx, "settings.view");
	return withTenant(db, ctx, async (tx) => {
		const [b] = await tx.select({ policy: businesses.bookingPolicy }).from(businesses).where(eq(businesses.id, ctx.businessId));
		return readPolicy(b?.policy);
	});
}

export async function setPolicy(db: Db, ctx: TenantCtx, raw: unknown) {
	require(ctx, "settings.edit");
	const policy = policySchema.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [before] = await tx.select({ policy: businesses.bookingPolicy }).from(businesses).where(and(eq(businesses.id, ctx.businessId)));
		await tx.update(businesses).set({ bookingPolicy: policy, updatedAt: new Date() }).where(eq(businesses.id, ctx.businessId));
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "business.policy.set", targetTable: "businesses", targetId: ctx.businessId, before: before?.policy, after: policy });
		return policy;
	});
}
