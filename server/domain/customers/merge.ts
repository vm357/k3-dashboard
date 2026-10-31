import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { appointments, customerNotes, customers } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { DomainError } from "../members/service";

/**
 * Duplicate handling (plan, CRM section): the system points out likely duplicates and
 * the owner decides. Nothing merges on its own, because two people can share a phone
 * (a parent and a teenager) or a name.
 */

export interface DuplicatePair {
	reason: "same_phone" | "same_email" | "same_name";
	a: { id: string; firstName: string; lastName: string | null; phone: string | null; email: string | null; visits: number; createdAt: Date };
	b: { id: string; firstName: string; lastName: string | null; phone: string | null; email: string | null; visits: number; createdAt: Date };
}

export async function findDuplicates(db: Db, ctx: TenantCtx): Promise<DuplicatePair[]> {
	require(ctx, "customers.edit");
	return withTenant(db, ctx, async (tx) => {
		const rows = await tx
			.select({
				id: customers.id,
				firstName: customers.firstName,
				lastName: customers.lastName,
				phone: customers.phone,
				email: customers.email,
				createdAt: customers.createdAt,
				// Qualified by hand: inside a subquery Drizzle renders `customers.id` as a bare "id",
				// which would resolve to the appointment's own id and count nothing.
				visits: sql<number>`(select count(*) from appointments a where a.customer_id = customers.id and a.status in ('completed','confirmed','checked_in'))`.mapWith(Number),
			})
			.from(customers)
			.where(and(eq(customers.businessId, ctx.businessId), isNull(customers.mergedIntoId)))
			.orderBy(asc(customers.createdAt));
		const pairs: DuplicatePair[] = [];
		const seen = new Set<string>();
		const push = (reason: DuplicatePair["reason"], a: (typeof rows)[number], b: (typeof rows)[number]) => {
			const key = [a.id, b.id].sort().join(":");
			if (seen.has(key)) return;
			seen.add(key);
			pairs.push({ reason, a, b });
		};
		const byPhone = new Map<string, typeof rows>();
		const byEmail = new Map<string, typeof rows>();
		const byName = new Map<string, typeof rows>();
		for (const r of rows) {
			if (r.phone) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r]);
			if (r.email) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
			const name = `${r.firstName} ${r.lastName ?? ""}`.trim().toLowerCase();
			if (r.lastName) byName.set(name, [...(byName.get(name) ?? []), r]);
		}
		for (const [, list] of byPhone) for (let i = 1; i < list.length; i++) push("same_phone", list[0], list[i]);
		for (const [, list] of byEmail) for (let i = 1; i < list.length; i++) push("same_email", list[0], list[i]);
		for (const [, list] of byName) for (let i = 1; i < list.length; i++) push("same_name", list[0], list[i]);
		return pairs;
	});
}

/**
 * Merge `fromId` into `keepId`: appointments and notes move, missing contact fields on the
 * kept record are filled from the other, and the merged record is retired (not deleted,
 * so audit references stay valid). Owner or customers.edit only.
 */
export async function mergeCustomers(db: Db, ctx: TenantCtx, keepId: string, fromId: string) {
	require(ctx, "customers.edit");
	if (keepId === fromId) throw new DomainError("merge_same");
	return withTenant(db, ctx, async (tx) => {
		const [keep] = await tx.select().from(customers).where(and(eq(customers.id, keepId), eq(customers.businessId, ctx.businessId), isNull(customers.mergedIntoId)));
		const [from] = await tx.select().from(customers).where(and(eq(customers.id, fromId), eq(customers.businessId, ctx.businessId), isNull(customers.mergedIntoId)));
		if (!keep || !from) throw new DomainError("customer_not_found");

		const moved = await tx.update(appointments).set({ customerId: keepId }).where(and(eq(appointments.customerId, fromId), eq(appointments.businessId, ctx.businessId))).returning({ id: appointments.id });
		const notes = await tx.update(customerNotes).set({ customerId: keepId }).where(and(eq(customerNotes.customerId, fromId), eq(customerNotes.businessId, ctx.businessId))).returning({ id: customerNotes.id });

		// Fill gaps on the kept record; never overwrite what it already has.
		const patch: Partial<typeof customers.$inferInsert> = { updatedAt: new Date() };
		if (!keep.phone && from.phone) patch.phone = from.phone;
		if (!keep.lastName && from.lastName) patch.lastName = from.lastName;
		if (!keep.pinnedNote && from.pinnedNote) patch.pinnedNote = from.pinnedNote;
		if (!keep.marketingConsent && from.marketingConsent) {
			patch.marketingConsent = true;
			patch.marketingConsentAt = from.marketingConsentAt;
		}
		// Email is unique per business among live records; retire the other record first, then adopt its email if needed.
		await tx.update(customers).set({ mergedIntoId: keepId, email: null, updatedAt: new Date() }).where(eq(customers.id, fromId));
		if (!keep.email && from.email) patch.email = from.email;
		await tx.update(customers).set(patch).where(eq(customers.id, keepId));

		await recordAudit(tx, {
			businessId: ctx.businessId,
			actorUserId: ctx.userId,
			action: "customer.merge",
			targetTable: "customers",
			targetId: keepId,
			after: { mergedFrom: fromId, appointmentsMoved: moved.length, notesMoved: notes.length },
		});
		return { keepId, appointmentsMoved: moved.length, notesMoved: notes.length };
	});
}

/** Follow merges so an old link to a retired record lands on the surviving one. */
export async function resolveMergedId(db: Db, ctx: TenantCtx, id: string): Promise<string> {
	return withTenant(db, ctx, async (tx) => {
		let current = id;
		for (let i = 0; i < 5; i++) {
			const [row] = await tx.select({ mergedIntoId: customers.mergedIntoId }).from(customers).where(and(eq(customers.id, current), eq(customers.businessId, ctx.businessId), ne(customers.id, "00000000-0000-0000-0000-000000000000")));
			if (!row?.mergedIntoId) return current;
			current = row.mergedIntoId;
		}
		return current;
	});
}
