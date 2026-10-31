import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { can, require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { customerNotes, customers } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { DomainError } from "../members/service";

export const customerInput = z.object({
	firstName: z.string().trim().min(1, "First name is required").max(60),
	lastName: z.string().trim().max(60).optional().or(z.literal("")),
	email: z.email("Enter a valid email").optional().or(z.literal("")),
	phone: z.string().trim().max(30).optional().or(z.literal("")),
	pinnedNote: z.string().trim().max(500).optional().or(z.literal("")),
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

export async function listCustomers(db: Db, ctx: TenantCtx, opts: { query?: string; limit?: number } = {}) {
	require(ctx, "customers.view");
	const q = opts.query?.trim();
	const limit = Math.min(opts.limit ?? 50, 200);
	return withTenant(db, ctx, async (tx) => {
		const base = and(eq(customers.businessId, ctx.businessId), isNull(customers.mergedIntoId));
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
			})
			.from(customers)
			.where(where)
			.orderBy(asc(customers.firstName), asc(customers.lastName))
			.limit(limit);
		return rows.map((r) => redact(ctx, r));
	});
}

export async function getCustomer(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "customers.view");
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId)));
		if (!row) return null;
		const notes = await tx
			.select({ id: customerNotes.id, body: customerNotes.body, createdAt: customerNotes.createdAt, authorUserId: customerNotes.authorUserId })
			.from(customerNotes)
			.where(eq(customerNotes.customerId, id))
			.orderBy(desc(customerNotes.createdAt));
		return { ...redact(ctx, row), notes };
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

export function fullName(c: { firstName: string; lastName: string | null }): string {
	return [c.firstName, c.lastName].filter(Boolean).join(" ");
}
