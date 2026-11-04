import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { appointmentServices, appointments, customers, employees } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { addDays, formatLocalDate, type LocalDate, localDateOf, zonedTimeToUtc } from "../scheduling/time";

/**
 * Basic reports (plan, CRM section). Revenue here means the price of completed
 * appointments; collected money is a phase 5 concern and is reported separately
 * once payments exist. Everything is computed in the business's time zone.
 */

export type Period = "week" | "month" | "last30" | "last90";

export function periodRange(period: Period, now: Date, timeZone: string): { start: LocalDate; end: LocalDate; label: string } {
	const today = localDateOf(now, timeZone);
	if (period === "week") {
		const dow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
		const start = addDays(today, -((dow + 6) % 7)); // Monday
		return { start, end: addDays(start, 7), label: "This week" };
	}
	if (period === "month") {
		const start = { year: today.year, month: today.month, day: 1 };
		const end = today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { year: today.year, month: today.month + 1, day: 1 };
		return { start, end, label: "This month" };
	}
	if (period === "last90") return { start: addDays(today, -89), end: addDays(today, 1), label: "Last 90 days" };
	return { start: addDays(today, -29), end: addDays(today, 1), label: "Last 30 days" };
}

export interface Report {
	period: Period;
	label: string;
	range: { start: string; end: string };
	totals: { completed: number; revenueCents: number; noShows: number; cancellations: number; newClients: number; upcoming: number };
	byDay: { date: string; completed: number; revenueCents: number }[];
	byEmployee: { employeeId: string; name: string; completed: number; revenueCents: number }[];
	byService: { serviceId: string; name: string; count: number; revenueCents: number }[];
	topClients: { customerId: string; name: string; visits: number; revenueCents: number }[];
}

export async function buildReport(db: Db, ctx: TenantCtx, period: Period, timeZone: string, now = new Date()): Promise<Report> {
	require(ctx, "reports.view");
	const r = periodRange(period, now, timeZone);
	const startUtc = zonedTimeToUtc(r.start, "00:00", timeZone);
	const endUtc = zonedTimeToUtc(r.end, "00:00", timeZone);
	return withTenant(db, ctx, async (tx) => {
		const inRange = and(eq(appointments.businessId, ctx.businessId), gte(appointments.startAt, startUtc), lt(appointments.startAt, endUtc));
		const rows = await tx
			.select({ id: appointments.id, startAt: appointments.startAt, status: appointments.status, priceCents: appointments.priceCents, employeeId: appointments.employeeId, employeeName: employees.displayName, customerId: appointments.customerId, firstName: customers.firstName, lastName: customers.lastName })
			.from(appointments)
			.innerJoin(employees, eq(employees.id, appointments.employeeId))
			.innerJoin(customers, eq(customers.id, appointments.customerId))
			.where(inRange)
			.orderBy(asc(appointments.startAt));
		const completed = rows.filter((x) => x.status === "completed");
		const completedIds = completed.map((x) => x.id);
		const svc = completedIds.length
			? await tx
					.select({ serviceId: appointmentServices.serviceId, name: appointmentServices.name, count: sql<number>`count(*)`.mapWith(Number), revenueCents: sql<number>`sum(${appointmentServices.priceCents})`.mapWith(Number) })
					.from(appointmentServices)
					.where(and(eq(appointmentServices.businessId, ctx.businessId), inArray(appointmentServices.appointmentId, completedIds)))
					.groupBy(appointmentServices.serviceId, appointmentServices.name)
					.orderBy(desc(sql`sum(${appointmentServices.priceCents})`))
			: [];
		const [newClients] = await tx
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(customers)
			.where(and(eq(customers.businessId, ctx.businessId), gte(customers.createdAt, startUtc), lt(customers.createdAt, endUtc)));

		const byDayMap = new Map<string, { completed: number; revenueCents: number }>();
		for (let d = r.start; formatLocalDate(d) < formatLocalDate(r.end); d = addDays(d, 1)) byDayMap.set(formatLocalDate(d), { completed: 0, revenueCents: 0 });
		for (const x of completed) {
			const k = formatLocalDate(localDateOf(x.startAt, timeZone));
			const cur = byDayMap.get(k) ?? { completed: 0, revenueCents: 0 };
			byDayMap.set(k, { completed: cur.completed + 1, revenueCents: cur.revenueCents + x.priceCents });
		}
		const agg = <K extends string>(key: (x: (typeof completed)[number]) => K, name: (x: (typeof completed)[number]) => string) => {
			const m = new Map<K, { name: string; completed: number; revenueCents: number }>();
			for (const x of completed) {
				const k = key(x);
				const cur = m.get(k) ?? { name: name(x), completed: 0, revenueCents: 0 };
				m.set(k, { ...cur, completed: cur.completed + 1, revenueCents: cur.revenueCents + x.priceCents });
			}
			return [...m.entries()].sort((a, b) => b[1].revenueCents - a[1].revenueCents);
		};
		return {
			period,
			label: r.label,
			range: { start: formatLocalDate(r.start), end: formatLocalDate(addDays(r.end, -1)) },
			totals: {
				completed: completed.length,
				revenueCents: completed.reduce((n, x) => n + x.priceCents, 0),
				noShows: rows.filter((x) => x.status === "no_show").length,
				cancellations: rows.filter((x) => x.status === "cancelled").length,
				newClients: newClients?.n ?? 0,
				upcoming: rows.filter((x) => (x.status === "confirmed" || x.status === "checked_in") && x.startAt.getTime() >= now.getTime()).length,
			},
			byDay: [...byDayMap.entries()].map(([date, v]) => ({ date, ...v })),
			byEmployee: agg((x) => x.employeeId, (x) => x.employeeName).map(([employeeId, v]) => ({ employeeId, ...v })),
			byService: svc.map((s) => ({ serviceId: s.serviceId, name: s.name, count: s.count, revenueCents: s.revenueCents })),
			topClients: agg((x) => x.customerId, (x) => [x.firstName, x.lastName].filter(Boolean).join(" "))
				.slice(0, 5)
				.map(([customerId, v]) => ({ customerId, name: v.name, visits: v.completed, revenueCents: v.revenueCents })),
		};
	});
}

/**
 * Clients who are "due": their typical gap between completed visits has passed since
 * the last one, and nothing is booked ahead. Needs at least two completed visits to
 * know a rhythm; with one visit, 6 weeks is assumed.
 */
export async function dueForVisit(db: Db, ctx: TenantCtx, now = new Date(), limit = 10) {
	require(ctx, "customers.view");
	return withTenant(db, ctx, async (tx) => {
		const rows = await tx
			.select({ customerId: appointments.customerId, firstName: customers.firstName, lastName: customers.lastName, startAt: appointments.startAt, status: appointments.status })
			.from(appointments)
			.innerJoin(customers, eq(customers.id, appointments.customerId))
			.where(and(eq(appointments.businessId, ctx.businessId), inArray(appointments.status, ["completed", "confirmed", "checked_in"]), sql`${customers.mergedIntoId} is null and ${customers.archivedAt} is null and ${customers.status} <> 'do_not_book'`))
			.orderBy(asc(appointments.startAt));
		const by = new Map<string, { name: string; completed: Date[]; hasUpcoming: boolean }>();
		for (const r of rows) {
			const cur = by.get(r.customerId) ?? { name: [r.firstName, r.lastName].filter(Boolean).join(" "), completed: [], hasUpcoming: false };
			if (r.status === "completed") cur.completed.push(r.startAt);
			else if (r.startAt.getTime() >= now.getTime()) cur.hasUpcoming = true;
			by.set(r.customerId, cur);
		}
		const out: { customerId: string; name: string; lastVisit: Date; typicalDays: number; overdueDays: number }[] = [];
		for (const [customerId, c] of by) {
			if (c.hasUpcoming || c.completed.length === 0) continue;
			const last = c.completed[c.completed.length - 1];
			let typicalDays = 42;
			if (c.completed.length >= 2) {
				const gaps = c.completed.slice(1).map((d, i) => (d.getTime() - c.completed[i].getTime()) / 86400000);
				gaps.sort((a, b) => a - b);
				typicalDays = Math.round(gaps[Math.floor(gaps.length / 2)]);
			}
			const sinceDays = (now.getTime() - last.getTime()) / 86400000;
			if (sinceDays >= typicalDays) out.push({ customerId, name: c.name, lastVisit: last, typicalDays, overdueDays: Math.round(sinceDays - typicalDays) });
		}
		return out.sort((a, b) => b.overdueDays - a.overdueDays).slice(0, limit);
	});
}
