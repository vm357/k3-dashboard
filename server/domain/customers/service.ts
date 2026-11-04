import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { can, require, requireOwner, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { appointments, customerNotes, customers } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { DomainError } from "../members/service";

export const customerInput = z.object({
	firstName: z.string().trim().min(1, "First name is required").max(60),
	lastName: z.string().trim().max(60).optional().or(z.literal("")),
	email: z.email("Enter a valid email").optional().or(z.literal("")),
	phone: z.string().trim().max(30).optional().or(z.literal("")),
	pinnedNote: z.string().trim().max(500).optional().or(z.literal("")),
	allergy: z.string().trim().max(200).optional().or(z.literal("")),
	marketingConsent: z.coerce.boolean().default(false),
});
export type CustomerInput = z.input<typeof customerInput>;

/** Keep digits and a leading +; US numbers without a country code get +1. */
export function normalizePhone(raw: string | undefined): string | null {
	if (!raw) return null;
	const digits = raw.replace(/[^\d+]/g, "");
	if (!digits) return null;
	if (digits.startsWith("+")) return digits;
	if (digits.length === 10) return `+1${digits}`;
	if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
	return digits;
}

/** Strip contact fields for staff without customers.view_contact. */
function redact<T extends { email: string | null; phone: string | null }>(ctx: TenantCtx, row: T): T {
	if (can(ctx, "customers.view_contact")) return row;
	return { ...row, email: row.email ? "hidden" : null, phone: row.phone ? "hidden" : null };
}

export const CLIENT_STATUSES = ["active", "vip", "inactive", "do_not_book"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_FILTERS = ["all", "vip", "new", "inactive", "do_not_book", "archived"] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];

// Written by hand: Drizzle renders a correlated column as a bare name (see STATUS, phase 4).
const completedVisits = sql<number>`(select count(*)::int from "appointments" where "appointments"."customer_id" = "customers"."id" and "appointments"."status" = 'completed')`;

export async function listCustomers(db: Db, ctx: TenantCtx, opts: { query?: string; limit?: number; offset?: number; filter?: ClientFilter; sort?: "first" | "last" } = {}) {
	require(ctx, "customers.view");
	const q = opts.query?.trim();
	const limit = Math.min(opts.limit ?? 50, 200);
	const filter = opts.filter ?? "all";
	return withTenant(db, ctx, async (tx) => {
		const byFilter =
			filter === "archived" ? isNotNull(customers.archivedAt)
			: filter === "all" ? isNull(customers.archivedAt)
			: filter === "new" ? and(isNull(customers.archivedAt), eq(customers.status, "active"), sql`${completedVisits} = 0`)
			: and(isNull(customers.archivedAt), eq(customers.status, filter));
		const base = and(eq(customers.businessId, ctx.businessId), isNull(customers.mergedIntoId), byFilter);
		const digits = q?.replace(/\D/g, "") ?? "";
		const where = q
			? and(
					base,
					or(
						ilike(customers.firstName, `%${q}%`),
						ilike(customers.lastName, `%${q}%`),
						ilike(sql`${customers.firstName} || ' ' || coalesce(${customers.lastName}, '')`, `%${q}%`),
						ilike(customers.email, `%${q}%`),
						// Only match on phone when the query actually contains digits; an empty
						// pattern would match every customer with a phone.
						...(digits.length >= 3 ? [ilike(customers.phone, `%${digits}%`)] : []),
					),
				)
			: base;
		const rows = await tx
			.select({
				id: customers.id,
				firstName: customers.firstName,
				lastName: customers.lastName,
				email: customers.email,
				phone: customers.phone,
				createdAt: customers.createdAt,
				status: customers.status,
				allergy: customers.allergy,
				archivedAt: customers.archivedAt,
				completedVisits,
			})
			.from(customers)
			.where(where)
			.orderBy(...(opts.sort === "last" ? [asc(sql`coalesce(${customers.lastName}, ${customers.firstName})`), asc(customers.firstName)] : [asc(customers.firstName), asc(customers.lastName)]), asc(customers.id))
			.limit(limit)
			.offset(opts.offset ?? 0);
		return rows.map((r) => ({ ...redact(ctx, r), isNew: r.completedVisits === 0 }));
	});
}

export async function getCustomer(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "customers.view");
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx.select({ c: customers, completedVisits }).from(customers).where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId))).then((r) => r.map((x) => ({ ...x.c, completedVisits: x.completedVisits })));
		if (!row) return null;
		const notes = await tx
			.select({ id: customerNotes.id, body: customerNotes.body, createdAt: customerNotes.createdAt, authorUserId: customerNotes.authorUserId })
			.from(customerNotes)
			.where(eq(customerNotes.customerId, id))
			.orderBy(desc(customerNotes.createdAt));
		return { ...redact(ctx, row), isNew: row.completedVisits === 0, notes };
	});
}

export async function createCustomer(db: Db, ctx: TenantCtx, raw: CustomerInput) {
	require(ctx, "customers.edit");
	const input = customerInput.parse(raw);
	const email = input.email ? input.email.toLowerCase() : null;
	return withTenant(db, ctx, async (tx) => {
		if (email) {
			const [dup] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.businessId, ctx.businessId), eq(customers.email, email), isNull(customers.mergedIntoId)));
			if (dup) throw new DomainError("customer_email_exists", "A client with that email already exists");
		}
		const [row] = await tx
			.insert(customers)
			.values({
				businessId: ctx.businessId,
				firstName: input.firstName,
				lastName: input.lastName || null,
				email,
				phone: normalizePhone(input.phone),
				pinnedNote: input.pinnedNote || null,
				allergy: input.allergy || null,
				marketingConsent: input.marketingConsent,
				marketingConsentAt: input.marketingConsent ? new Date() : null,
			})
			.returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "customer.create", targetTable: "customers", targetId: row.id });
		return row;
	});
}

export async function updateCustomer(db: Db, ctx: TenantCtx, id: string, raw: CustomerInput) {
	require(ctx, "customers.edit");
	const input = customerInput.parse(raw);
	const email = input.email ? input.email.toLowerCase() : null;
	return withTenant(db, ctx, async (tx) => {
		const [before] = await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId)));
		if (!before) throw new DomainError("customer_not_found");
		const consentChanged = input.marketingConsent !== before.marketingConsent;
		const [after] = await tx
			.update(customers)
			.set({
				firstName: input.firstName,
				lastName: input.lastName || null,
				email,
				phone: normalizePhone(input.phone),
				pinnedNote: input.pinnedNote || null,
				allergy: input.allergy || null,
				marketingConsent: input.marketingConsent,
				marketingConsentAt: consentChanged ? (input.marketingConsent ? new Date() : null) : before.marketingConsentAt,
				updatedAt: new Date(),
			})
			.where(eq(customers.id, id))
			.returning();
		// Contact details stay out of the audit log on purpose.
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "customer.update", targetTable: "customers", targetId: id, after: { consent: input.marketingConsent } });
		return after;
	});
}

export async function addCustomerNote(db: Db, ctx: TenantCtx, customerId: string, body: string) {
	require(ctx, "customers.edit");
	const text = z.string().trim().min(1).max(2000).parse(body);
	return withTenant(db, ctx, async (tx) => {
		const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, ctx.businessId)));
		if (!c) throw new DomainError("customer_not_found");
		const [row] = await tx.insert(customerNotes).values({ businessId: ctx.businessId, customerId, body: text, authorUserId: ctx.userId }).returning();
		return row;
	});
}

export async function setCustomerStatus(db: Db, ctx: TenantCtx, id: string, raw: string) {
	require(ctx, "customers.edit");
	const status = z.enum(CLIENT_STATUSES).parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [before] = await tx.select({ status: customers.status }).from(customers).where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId)));
		if (!before) throw new DomainError("customer_not_found");
		const [after] = await tx.update(customers).set({ status, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "customer.status", targetTable: "customers", targetId: id, before: { status: before.status }, after: { status } });
		return after;
	});
}

/** Upcoming bookings block archiving: cancel or move them first. */
export async function archiveCustomer(db: Db, ctx: TenantCtx, id: string, now = new Date()) {
	require(ctx, "customers.edit");
	return withTenant(db, ctx, async (tx) => {
		const [c] = await tx.select({ id: customers.id, archivedAt: customers.archivedAt }).from(customers).where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId)));
		if (!c) throw new DomainError("customer_not_found");
		if (c.archivedAt) return c;
		const upcoming = await tx
			.select({ id: appointments.id })
			.from(appointments)
			.where(and(eq(appointments.businessId, ctx.businessId), eq(appointments.customerId, id), inArray(appointments.status, ["held", "confirmed", "checked_in"]), gte(appointments.endAt, now)));
		if (upcoming.length > 0) throw new DomainError("has_upcoming", `${upcoming.length} upcoming ${upcoming.length === 1 ? "booking" : "bookings"}`);
		const [after] = await tx.update(customers).set({ archivedAt: now, updatedAt: now }).where(eq(customers.id, id)).returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "customer.archive", targetTable: "customers", targetId: id });
		return after;
	});
}

export async function restoreCustomer(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "customers.edit");
	return withTenant(db, ctx, async (tx) => {
		const [after] = await tx.update(customers).set({ archivedAt: null, updatedAt: new Date() }).where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId))).returning();
		if (!after) throw new DomainError("customer_not_found");
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "customer.restore", targetTable: "customers", targetId: id });
		return after;
	});
}

/**
 * Owner only, archived clients only. With no visits on record the row is deleted; with
 * visits, the person is erased (name, contact, notes, allergy) and the visits stay for
 * the books under "Deleted client".
 */
export async function deleteCustomer(db: Db, ctx: TenantCtx, id: string): Promise<{ mode: "deleted" | "erased" }> {
	requireOwner(ctx);
	return withTenant(db, ctx, async (tx) => {
		const [c] = await tx.select({ id: customers.id, archivedAt: customers.archivedAt }).from(customers).where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId)));
		if (!c) throw new DomainError("customer_not_found");
		if (!c.archivedAt) throw new DomainError("not_archived", "Archive the client first");
		const [visit] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.businessId, ctx.businessId), eq(appointments.customerId, id))).limit(1);
		await tx.delete(customerNotes).where(and(eq(customerNotes.businessId, ctx.businessId), eq(customerNotes.customerId, id)));
		if (visit) {
			await tx
				.update(customers)
				.set({ firstName: "Deleted", lastName: "client", email: null, phone: null, pinnedNote: null, allergy: null, preferences: {}, marketingConsent: false, marketingConsentAt: null, status: "inactive", updatedAt: new Date() })
				.where(eq(customers.id, id));
		} else {
			await tx.delete(customers).where(eq(customers.id, id));
		}
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: visit ? "customer.erase" : "customer.delete", targetTable: "customers", targetId: id });
		return { mode: visit ? "erased" : "deleted" };
	});
}

export function fullName(c: { firstName: string; lastName: string | null }): string {
	return [c.firstName, c.lastName].filter(Boolean).join(" ");
}
