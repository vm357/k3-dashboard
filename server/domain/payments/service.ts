import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { require, type TenantCtx } from "../../auth/ctx";
import type { Db, Tx } from "../../db/client";
import { appointments, businesses, customerCreditEntries, customers, payments, users } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { assertEmployeeAccess } from "../appointments/service";
import { DomainError } from "../members/service";
import { addDays, parseLocalDate, zonedTimeToUtc } from "../scheduling/time";

const MAX_CENTS = 10_000_00;

async function balanceOf(tx: Tx, ctx: TenantCtx, customerId: string): Promise<number> {
	const [r] = await tx
		.select({ n: sql<number>`coalesce(sum(${customerCreditEntries.amountCents}), 0)::int` })
		.from(customerCreditEntries)
		.where(and(eq(customerCreditEntries.businessId, ctx.businessId), eq(customerCreditEntries.customerId, customerId)));
	return r?.n ?? 0;
}

/** Row lock on the customer so two checkouts or credit edits cannot both spend the same balance. */
async function lockCustomer(tx: Tx, ctx: TenantCtx, customerId: string) {
	const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, ctx.businessId))).for("update");
	if (!c) throw new DomainError("customer_not_found");
}

export async function getCredit(db: Db, ctx: TenantCtx, customerId: string) {
	require(ctx, "customers.view");
	return withTenant(db, ctx, async (tx) => {
		const balanceCents = await balanceOf(tx, ctx, customerId);
		const entries = await tx
			.select({ id: customerCreditEntries.id, amountCents: customerCreditEntries.amountCents, reason: customerCreditEntries.reason, appointmentId: customerCreditEntries.appointmentId, createdAt: customerCreditEntries.createdAt, byName: users.name })
			.from(customerCreditEntries)
			.leftJoin(users, eq(users.id, customerCreditEntries.createdByUserId))
			.where(and(eq(customerCreditEntries.businessId, ctx.businessId), eq(customerCreditEntries.customerId, customerId)))
			.orderBy(desc(customerCreditEntries.createdAt))
			.limit(30);
		return { balanceCents, entries };
	});
}

export const creditInput = z.object({
	amountCents: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= MAX_CENTS, "Enter an amount"),
	reason: z.string().trim().max(80).optional().or(z.literal("")),
});

/** Add (positive) or remove (negative) credit by hand. The balance can never go below zero. */
export async function addCredit(db: Db, ctx: TenantCtx, customerId: string, raw: z.input<typeof creditInput>) {
	require(ctx, "customers.edit");
	const input = creditInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		await lockCustomer(tx, ctx, customerId);
		const balance = await balanceOf(tx, ctx, customerId);
		if (balance + input.amountCents < 0) throw new DomainError("credit_negative", `Only ${(balance / 100).toFixed(2)} available`);
		const [row] = await tx.insert(customerCreditEntries).values({ businessId: ctx.businessId, customerId, amountCents: input.amountCents, reason: input.reason || null, createdByUserId: ctx.userId }).returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: input.amountCents > 0 ? "credit.add" : "credit.remove", targetTable: "customers", targetId: customerId, after: { amountCents: input.amountCents } });
		return { entry: row, balanceCents: balance + input.amountCents };
	});
}

export const checkoutInput = z.object({
	method: z.enum(["cash", "card"]),
	useCredit: z.boolean().default(false),
	tipCents: z.number().int().min(0).max(MAX_CENTS).default(0),
});

/**
 * Record payment for a visit that is checked in or done: the remaining balance, optionally
 * paid first from client credit, the rest by cash or card, plus any tip.
 */
export async function checkout(db: Db, ctx: TenantCtx, appointmentId: string, raw: z.input<typeof checkoutInput>) {
	require(ctx, "appointments.manage_own");
	const input = checkoutInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, ctx.businessId))).for("update");
		if (!appt) throw new DomainError("appointment_not_found");
		await assertEmployeeAccess(tx, ctx, appt.employeeId);
		if (appt.status !== "completed" && appt.status !== "checked_in") throw new DomainError("not_ready", "Check the client in first");
		const due = Math.max(0, appt.priceCents - appt.paidCents);
		if (due === 0) throw new DomainError("already_paid", "This visit is already paid");
		await lockCustomer(tx, ctx, appt.customerId);
		const creditCents = input.useCredit ? Math.min(await balanceOf(tx, ctx, appt.customerId), due) : 0;
		const chargedCents = due - creditCents;
		if (creditCents > 0) {
			await tx.insert(customerCreditEntries).values({ businessId: ctx.businessId, customerId: appt.customerId, amountCents: -creditCents, reason: "Used at checkout", appointmentId, createdByUserId: ctx.userId });
			await tx.insert(payments).values({ businessId: ctx.businessId, appointmentId, customerId: appt.customerId, method: "credit", amountCents: creditCents, recordedByUserId: ctx.userId });
		}
		if (chargedCents > 0 || input.tipCents > 0) {
			await tx.insert(payments).values({ businessId: ctx.businessId, appointmentId, customerId: appt.customerId, method: input.method, amountCents: chargedCents, tipCents: input.tipCents, recordedByUserId: ctx.userId });
		}
		await tx.update(appointments).set({ paidCents: appt.paidCents + due, paymentStatus: "paid_in_full", updatedAt: new Date() }).where(eq(appointments.id, appointmentId));
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "appointment.checkout", targetTable: "appointments", targetId: appointmentId, after: { method: input.method, creditCents, chargedCents, tipCents: input.tipCents } });
		return { creditCents, chargedCents, tipCents: input.tipCents };
	});
}

export async function listPayments(db: Db, ctx: TenantCtx, appointmentId: string) {
	require(ctx, "calendar.view_own");
	return withTenant(db, ctx, (tx) =>
		tx
			.select({ id: payments.id, method: payments.method, amountCents: payments.amountCents, tipCents: payments.tipCents, createdAt: payments.createdAt, byName: users.name })
			.from(payments)
			.leftJoin(users, eq(users.id, payments.recordedByUserId))
			.where(and(eq(payments.businessId, ctx.businessId), eq(payments.appointmentId, appointmentId)))
			.orderBy(payments.createdAt),
	);
}

/** Money recorded on one local day, by method. Credit used is shown but is not new money. */
export async function takingsForDay(db: Db, ctx: TenantCtx, dateIso: string) {
	require(ctx, "reports.view");
	const date = parseLocalDate(dateIso);
	if (!date) throw new DomainError("bad_date");
	return withTenant(db, ctx, async (tx) => {
		const [b] = await tx.select({ tz: businesses.timeZone }).from(businesses).where(eq(businesses.id, ctx.businessId));
		const tz = b?.tz ?? "America/New_York";
		const rows = await tx
			.select({ method: payments.method, amount: sql<number>`sum(${payments.amountCents})::int`, tips: sql<number>`sum(${payments.tipCents})::int`, visits: sql<number>`count(distinct ${payments.appointmentId})::int` })
			.from(payments)
			.where(and(eq(payments.businessId, ctx.businessId), gte(payments.createdAt, zonedTimeToUtc(date, "00:00", tz)), lt(payments.createdAt, zonedTimeToUtc(addDays(date, 1), "00:00", tz))))
			.groupBy(payments.method);
		const by = (m: string) => rows.find((r) => r.method === m);
		const cash = by("cash")?.amount ?? 0;
		const card = by("card")?.amount ?? 0;
		const tips = rows.reduce((n, r) => n + (r.tips ?? 0), 0);
		const [{ visits } = { visits: 0 }] = await tx
			.select({ visits: sql<number>`count(distinct ${payments.appointmentId})::int` })
			.from(payments)
			.where(and(eq(payments.businessId, ctx.businessId), gte(payments.createdAt, zonedTimeToUtc(date, "00:00", tz)), lt(payments.createdAt, zonedTimeToUtc(addDays(date, 1), "00:00", tz))));
		return { cashCents: cash, cardCents: card, creditCents: by("credit")?.amount ?? 0, tipsCents: tips, totalCents: cash + card + tips, visits };
	});
}
