import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { appointments, customers, employees, waitlistEntries } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { DomainError } from "../members/service";
import { parseLocalDate } from "../scheduling/time";

export const waitlistInput = z.object({
	customerId: z.uuid(),
	preferredDate: z.string().optional().or(z.literal("")).refine((v) => !v || !!parseLocalDate(v), "Pick a valid date"),
	employeeId: z.uuid().optional().or(z.literal("")),
	note: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function addToWaitlist(db: Db, ctx: TenantCtx, raw: z.input<typeof waitlistInput>) {
	require(ctx, "appointments.manage_own");
	const input = waitlistInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [c] = await tx.select({ id: customers.id, status: customers.status, archivedAt: customers.archivedAt }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.businessId, ctx.businessId)));
		if (!c) throw new DomainError("customer_not_found");
		if (c.archivedAt) throw new DomainError("customer_archived", "This client is archived. Restore them first.");
		if (c.status === "do_not_book") throw new DomainError("do_not_book", "This client is marked Do not book.");
		if (input.employeeId) {
			const [e] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId)));
			if (!e) throw new DomainError("employee_not_found");
		}
		const [row] = await tx
			.insert(waitlistEntries)
			.values({ businessId: ctx.businessId, customerId: c.id, employeeId: input.employeeId || null, preferredDate: input.preferredDate || null, note: input.note || null, createdByUserId: ctx.userId })
			.returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "waitlist.add", targetTable: "waitlist_entries", targetId: row.id });
		return row;
	});
}

/** Open entries: a specific day first (soonest), then "any day", oldest first. */
export async function listWaitlist(db: Db, ctx: TenantCtx, opts: { date?: string } = {}) {
	require(ctx, "calendar.view_own");
	return withTenant(db, ctx, async (tx) => {
		const rows = await tx
			.select({ id: waitlistEntries.id, customerId: waitlistEntries.customerId, preferredDate: waitlistEntries.preferredDate, note: waitlistEntries.note, createdAt: waitlistEntries.createdAt, employeeName: employees.displayName, firstName: customers.firstName, lastName: customers.lastName })
			.from(waitlistEntries)
			.innerJoin(customers, eq(customers.id, waitlistEntries.customerId))
			.leftJoin(employees, eq(employees.id, waitlistEntries.employeeId))
			.where(and(eq(waitlistEntries.businessId, ctx.businessId), isNull(waitlistEntries.removedAt), isNull(waitlistEntries.bookedAppointmentId), isNull(customers.archivedAt), ...(opts.date ? [sql`(${waitlistEntries.preferredDate} = ${opts.date} or ${waitlistEntries.preferredDate} is null)`] : [])))
			.orderBy(sql`${waitlistEntries.preferredDate} asc nulls last`, asc(waitlistEntries.createdAt));
		return rows.map((r) => ({ ...r, customerName: [r.firstName, r.lastName].filter(Boolean).join(" ") }));
	});
}

export async function removeFromWaitlist(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "appointments.manage_own");
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx.update(waitlistEntries).set({ removedAt: new Date() }).where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.businessId, ctx.businessId), isNull(waitlistEntries.removedAt))).returning({ id: waitlistEntries.id });
		if (!row) throw new DomainError("waitlist_not_found");
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "waitlist.remove", targetTable: "waitlist_entries", targetId: id });
	});
}

/** Close an entry once its client is booked. Ignores entries for someone else. */
export async function markWaitlistBooked(db: Db, ctx: TenantCtx, id: string, appointmentId: string) {
	require(ctx, "appointments.manage_own");
	return withTenant(db, ctx, async (tx) => {
		const [appt] = await tx.select({ customerId: appointments.customerId }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, ctx.businessId)));
		if (!appt) return false;
		const [row] = await tx
			.update(waitlistEntries)
			.set({ bookedAppointmentId: appointmentId })
			.where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.businessId, ctx.businessId), eq(waitlistEntries.customerId, appt.customerId), isNull(waitlistEntries.bookedAppointmentId), isNull(waitlistEntries.removedAt)))
			.returning({ id: waitlistEntries.id });
		return !!row;
	});
}
