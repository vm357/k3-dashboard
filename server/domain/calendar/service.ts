import { and, asc, eq, gt, gte, inArray, isNull, lt, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import { can, require, type TenantCtx } from "../../auth/ctx";
import type { Db, Tx } from "../../db/client";
import { appointments, businessHours, businessMembers, businesses, customers, employees, timeBlocks, LIVE_STATUSES } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { DomainError } from "../members/service";
import { createTimeBlock, deleteTimeBlock } from "../staff/service";
import { addDays, formatLocalDate, localDateOf, parseLocalDate, weekdayOf, zonedTimeToUtc } from "../scheduling/time";

/**
 * Closed days are business-wide time blocks (employee_id null) covering whole local days,
 * so the availability engine already keeps them off the booking sheet. No extra table.
 */

export interface RangeDay {
	iso: string;
	weekday: number;
	day: number;
	month: number;
	/** Weekly closing day ("Closed") or a closed day from Settings (its label, holiday: true). */
	closed: { label: string; holiday: boolean } | null;
	hours: { opensAt: string; closesAt: string } | null;
	items: { id: string; startAt: Date; serviceEndAt: Date; status: (typeof appointments.$inferSelect)["status"]; employeeId: string; employeeName: string; customerName: string }[];
	blocks: { id: string; employeeId: string | null; employeeName: string | null; kind: string; startAt: Date; endAt: Date; reason: string | null; allDay: boolean }[];
}

/** Appointments, blocks and closures for `days` local days from `startIso`, for Week and Month views. */
export async function listRange(db: Db, ctx: TenantCtx, startIso: string, days: number): Promise<{ timeZone: string; days: RangeDay[]; employees: { id: string; displayName: string }[] }> {
	require(ctx, "calendar.view_own");
	const start = parseLocalDate(startIso);
	if (!start) throw new DomainError("bad_date");
	const n = Math.min(Math.max(Math.round(days), 1), 42);
	return withTenant(db, ctx, async (tx) => {
		const tz = await tzOf(tx, ctx);
		const from = zonedTimeToUtc(start, "00:00", tz);
		const to = zonedTimeToUtc(addDays(start, n), "00:00", tz);
		const visible = await visibleEmployeeIds(tx, ctx);
		const emps = await tx.select({ id: employees.id, displayName: employees.displayName }).from(employees).where(and(eq(employees.businessId, ctx.businessId), eq(employees.active, true))).orderBy(asc(employees.sortOrder));
		const hours = await tx.select().from(businessHours).where(eq(businessHours.businessId, ctx.businessId));
		const blocks = await tx
			.select({ id: timeBlocks.id, employeeId: timeBlocks.employeeId, kind: timeBlocks.kind, startAt: timeBlocks.startAt, endAt: timeBlocks.endAt, reason: timeBlocks.reason, employeeName: employees.displayName })
			.from(timeBlocks)
			.leftJoin(employees, eq(employees.id, timeBlocks.employeeId))
			.where(and(eq(timeBlocks.businessId, ctx.businessId), lt(timeBlocks.startAt, to), gt(timeBlocks.endAt, from), visible.length ? or(isNull(timeBlocks.employeeId), inArray(timeBlocks.employeeId, visible)) : isNull(timeBlocks.employeeId)))
			.orderBy(asc(timeBlocks.startAt));
		const appts = visible.length
			? await tx
					.select({ id: appointments.id, startAt: appointments.startAt, serviceEndAt: appointments.serviceEndAt, status: appointments.status, employeeId: appointments.employeeId, employeeName: employees.displayName, firstName: customers.firstName, lastName: customers.lastName })
					.from(appointments)
					.innerJoin(employees, eq(employees.id, appointments.employeeId))
					.innerJoin(customers, eq(customers.id, appointments.customerId))
					.where(and(eq(appointments.businessId, ctx.businessId), inArray(appointments.employeeId, visible), gte(appointments.startAt, from), lt(appointments.startAt, to), notInArray(appointments.status, ["rescheduled", "expired", "cancelled"])))
					.orderBy(asc(appointments.startAt))
			: [];

		const out: RangeDay[] = [];
		for (let i = 0; i < n; i++) {
			const d = addDays(start, i);
			const ds = zonedTimeToUtc(d, "00:00", tz).getTime();
			const de = zonedTimeToUtc(addDays(d, 1), "00:00", tz).getTime();
			const h = hours.find((x) => x.weekday === weekdayOf(d)) ?? null;
			const dayBlocks = blocks.filter((b) => b.startAt.getTime() < de && b.endAt.getTime() > ds);
			const covers = (b: (typeof blocks)[number]) => b.employeeId === null && (h ? b.startAt.getTime() <= zonedTimeToUtc(d, h.opensAt, tz).getTime() && b.endAt.getTime() >= zonedTimeToUtc(d, h.closesAt, tz).getTime() : b.startAt.getTime() <= ds && b.endAt.getTime() >= de);
			const closure = dayBlocks.find(covers) ?? null;
			out.push({
				iso: formatLocalDate(d),
				weekday: weekdayOf(d),
				day: d.day,
				month: d.month,
				closed: closure ? { label: closure.reason || "Closed", holiday: true } : h ? null : { label: "Closed", holiday: false },
				hours: h ? { opensAt: h.opensAt, closesAt: h.closesAt } : null,
				items: appts
					.filter((a) => a.startAt.getTime() >= ds && a.startAt.getTime() < de)
					.map((a) => ({ id: a.id, startAt: a.startAt, serviceEndAt: a.serviceEndAt, status: a.status, employeeId: a.employeeId, employeeName: a.employeeName, customerName: [a.firstName, a.lastName].filter(Boolean).join(" ") })),
				blocks: dayBlocks.filter((b) => b !== closure).map((b) => ({ ...b, allDay: b.startAt.getTime() <= ds && b.endAt.getTime() >= de })),
			});
		}
		return { timeZone: tz, days: out, employees: emps.filter((e) => visible.includes(e.id)) };
	});
}

/** Closed local dates among the next `days` from today; empty when the caller cannot see the calendar. */
export async function closedDates(db: Db, ctx: TenantCtx, startIso: string, days: number): Promise<Record<string, string>> {
	if (!can(ctx, "calendar.view_own")) return {};
	const r = await listRange(db, ctx, startIso, days);
	return Object.fromEntries(r.days.filter((d) => d.closed).map((d) => [d.iso, d.closed!.label]));
}

const closedInput = z
	.object({ from: z.string(), to: z.string().optional().or(z.literal("")), label: z.string().trim().max(60).optional().or(z.literal("")) })
	.transform((r, c) => {
		const from = parseLocalDate(r.from);
		const to = r.to ? parseLocalDate(r.to) : from;
		if (!from || !to) {
			c.addIssue({ code: "custom", message: "Pick a date", path: ["from"] });
			return z.NEVER;
		}
		return { from, to, label: r.label || "" };
	});

export async function listClosedDays(db: Db, ctx: TenantCtx, now = new Date()) {
	require(ctx, "settings.view");
	return withTenant(db, ctx, async (tx) => {
		const tz = await tzOf(tx, ctx);
		const rows = await tx.select().from(timeBlocks).where(and(eq(timeBlocks.businessId, ctx.businessId), isNull(timeBlocks.employeeId), gt(timeBlocks.endAt, now))).orderBy(asc(timeBlocks.startAt));
		return rows.map((r) => ({ id: r.id, from: formatLocalDate(localDateOf(r.startAt, tz)), to: formatLocalDate(localDateOf(new Date(r.endAt.getTime() - 1), tz)), label: r.reason }));
	});
}

/** Close the business for whole local days. Returns how many live bookings still sit on them. */
export async function addClosedDays(db: Db, ctx: TenantCtx, raw: z.input<typeof closedInput>) {
	require(ctx, "settings.edit");
	const input = closedInput.parse(raw);
	if (formatLocalDate(input.to) < formatLocalDate(input.from)) throw new DomainError("bad_range", "The last day is before the first");
	const span = (Date.UTC(input.to.year, input.to.month - 1, input.to.day) - Date.UTC(input.from.year, input.from.month - 1, input.from.day)) / 86400000 + 1;
	if (span > 31) throw new DomainError("bad_range", "Close up to 31 days at a time");
	const tz = await withTenant(db, ctx, (tx) => tzOf(tx, ctx));
	const startAt = zonedTimeToUtc(input.from, "00:00", tz);
	const endAt = zonedTimeToUtc(addDays(input.to, 1), "00:00", tz);
	const block = await createTimeBlock(db, ctx, { kind: "blocked", startAt, endAt, reason: input.label });
	const clashes = await withTenant(db, ctx, (tx) =>
		tx
			.select({ id: appointments.id })
			.from(appointments)
			.where(and(eq(appointments.businessId, ctx.businessId), inArray(appointments.status, [...LIVE_STATUSES]), lt(appointments.startAt, endAt), gt(appointments.endAt, startAt))),
	);
	return { id: block.id, bookingsOnClosedDays: clashes.length };
}

export async function removeClosedDay(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "settings.edit");
	const [row] = await withTenant(db, ctx, (tx) => tx.select({ employeeId: timeBlocks.employeeId }).from(timeBlocks).where(and(eq(timeBlocks.id, id), eq(timeBlocks.businessId, ctx.businessId))));
	if (!row || row.employeeId !== null) throw new DomainError("time_block_not_found");
	await deleteTimeBlock(db, ctx, id);
}

async function tzOf(tx: Tx, ctx: TenantCtx): Promise<string> {
	const [b] = await tx.select({ tz: businesses.timeZone }).from(businesses).where(eq(businesses.id, ctx.businessId));
	return b?.tz ?? "America/New_York";
}

/** Same rule as the appointments service: everyone with calendar.view_all, else only your own row. */
async function visibleEmployeeIds(tx: Tx, ctx: TenantCtx): Promise<string[]> {
	const all = await tx.select({ id: employees.id, memberId: employees.memberId }).from(employees).where(eq(employees.businessId, ctx.businessId));
	if (can(ctx, "calendar.view_all")) return all.map((e) => e.id);
	const [me] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.userId, ctx.userId)));
	return all.filter((e) => e.memberId === me?.id).map((e) => e.id);
}
