import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { serviceCategories, services } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { DomainError } from "../members/service";

export const serviceInput = z
	.object({
		name: z.string().trim().min(1, "Give the service a name").max(80),
		description: z.string().trim().max(500).optional().or(z.literal("")),
		categoryId: z.uuid().optional().or(z.literal("")),
		durationMinutes: z.coerce.number().int().min(5, "At least 5 minutes").max(600),
		bufferAfterMinutes: z.coerce.number().int().min(0).max(120).default(0),
		priceCents: z.coerce.number().int().min(0).max(1_000_000),
		depositType: z.enum(["none", "fixed", "percent"]).default("none"),
		depositAmount: z.coerce.number().int().min(0).default(0),
		bookableOnline: z.coerce.boolean().default(true),
	})
	.superRefine((v, ctx) => {
		if (v.depositType === "percent" && v.depositAmount > 100) ctx.addIssue({ code: "custom", path: ["depositAmount"], message: "Percent cannot exceed 100" });
		if (v.depositType === "fixed" && v.depositAmount > v.priceCents) ctx.addIssue({ code: "custom", path: ["depositAmount"], message: "Deposit cannot exceed the price" });
	});
export type ServiceInput = z.input<typeof serviceInput>;

export const categoryInput = z.object({ name: z.string().trim().min(1).max(60) });

export async function listServices(db: Db, ctx: TenantCtx, opts: { includeInactive?: boolean } = {}) {
	require(ctx, "services.view");
	return withTenant(db, ctx, async (tx) => {
		const cats = await tx
			.select()
			.from(serviceCategories)
			.where(eq(serviceCategories.businessId, ctx.businessId))
			.orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));
		const where = opts.includeInactive
			? eq(services.businessId, ctx.businessId)
			: and(eq(services.businessId, ctx.businessId), eq(services.active, true));
		const rows = await tx.select().from(services).where(where).orderBy(asc(services.sortOrder), asc(services.name));
		return { categories: cats, services: rows };
	});
}

export async function getService(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "services.view");
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx.select().from(services).where(and(eq(services.id, id), eq(services.businessId, ctx.businessId)));
		return row ?? null;
	});
}

export async function createService(db: Db, ctx: TenantCtx, raw: ServiceInput) {
	require(ctx, "services.manage");
	const input = serviceInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx
			.insert(services)
			.values({ ...normalize(input), businessId: ctx.businessId })
			.returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "service.create", targetTable: "services", targetId: row.id, after: normalize(input) });
		return row;
	});
}

export async function updateService(db: Db, ctx: TenantCtx, id: string, raw: ServiceInput) {
	require(ctx, "services.manage");
	const input = serviceInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [before] = await tx.select().from(services).where(and(eq(services.id, id), eq(services.businessId, ctx.businessId)));
		if (!before) throw new DomainError("service_not_found");
		const [after] = await tx
			.update(services)
			.set({ ...normalize(input), updatedAt: new Date() })
			.where(eq(services.id, id))
			.returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "service.update", targetTable: "services", targetId: id, before: pick(before), after: pick(after) });
		return after;
	});
}

export async function setServiceActive(db: Db, ctx: TenantCtx, id: string, active: boolean) {
	require(ctx, "services.manage");
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx
			.update(services)
			.set({ active, updatedAt: new Date() })
			.where(and(eq(services.id, id), eq(services.businessId, ctx.businessId)))
			.returning();
		if (!row) throw new DomainError("service_not_found");
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: active ? "service.activate" : "service.deactivate", targetTable: "services", targetId: id });
		return row;
	});
}

export async function createCategory(db: Db, ctx: TenantCtx, raw: z.input<typeof categoryInput>) {
	require(ctx, "services.manage");
	const input = categoryInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx.insert(serviceCategories).values({ businessId: ctx.businessId, name: input.name }).returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "category.create", targetTable: "service_categories", targetId: row.id, after: input });
		return row;
	});
}

export async function deleteCategory(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "services.manage");
	return withTenant(db, ctx, async (tx) => {
		// Services keep existing; their category_id is set null by the FK.
		const deleted = await tx
			.delete(serviceCategories)
			.where(and(eq(serviceCategories.id, id), eq(serviceCategories.businessId, ctx.businessId)))
			.returning({ name: serviceCategories.name });
		if (deleted[0]) await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "category.delete", targetTable: "service_categories", targetId: id, before: deleted[0] });
	});
}

function normalize(input: z.output<typeof serviceInput>) {
	return {
		name: input.name,
		description: input.description || null,
		categoryId: input.categoryId || null,
		durationMinutes: input.durationMinutes,
		bufferAfterMinutes: input.bufferAfterMinutes,
		priceCents: input.priceCents,
		depositType: input.depositType,
		depositAmount: input.depositType === "none" ? 0 : input.depositAmount,
		bookableOnline: input.bookableOnline,
	};
}

function pick(row: typeof services.$inferSelect) {
	const { name, durationMinutes, bufferAfterMinutes, priceCents, depositType, depositAmount, bookableOnline, categoryId } = row;
	return { name, durationMinutes, bufferAfterMinutes, priceCents, depositType, depositAmount, bookableOnline, categoryId };
}

/** Display helpers shared by pages. */
export function formatCents(cents: number): string {
	return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}

export function formatMinutes(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} min`;
	if (m === 0) return `${h} h`;
	return `${h} h ${m}`;
}
