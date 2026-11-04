import { and, asc, eq, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { can, require, type TenantCtx } from "../../auth/ctx";
import type { Db, Tx } from "../../db/client";
import {
	appointmentServices,
	appointmentStatusHistory,
	appointments,
	businessHours,
	businessMembers,
	businesses,
	customers,
	employeeAvailability,
	employeeServices,
	employees,
	services,
	timeBlocks,
	users,
	LIVE_STATUSES,
} from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { readPolicy } from "../businesses/hours";
import type { CustomerInput } from "../customers/service";
import { DomainError } from "../members/service";
import { availableStarts, fits, type Interval } from "../scheduling/availability";
import { addDays, formatLocalDate, type LocalDate, localDateOf, parseLocalDate, zonedTimeToUtc } from "../scheduling/time";

export type AppointmentStatus = (typeof appointments.$inferSelect)["status"];

/**
 * Status machine (plan, booking section). Payment state is a separate axis and is
 * never changed here.
 */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
	held: ["confirmed", "expired", "cancelled"],
	confirmed: ["checked_in", "completed", "cancelled", "no_show", "rescheduled"],
	checked_in: ["completed", "cancelled", "no_show"],
	completed: [],
	cancelled: [],
	no_show: [],
	rescheduled: [],
	expired: [],
};

export const bookingInput = z.object({
	employeeId: z.uuid(),
	serviceIds: z.array(z.uuid()).min(1, "Pick at least one service"),
	startAt: z.coerce.date(),
	customerId: z.uuid().optional(),
	newCustomer: z.object({ firstName: z.string().trim().min(1), lastName: z.string().trim().optional().or(z.literal("")), phone: z.string().trim().optional().or(z.literal("")), email: z.string().trim().optional().or(z.literal("")) }).optional(),
	note: z.string().trim().max(500).optional().or(z.literal("")),
	seriesId: z.uuid().optional(),
});
export type BookingInput = z.input<typeof bookingInput>;

/** Everything the booking sheet and the engine need for one employee on one day. */
async function loadDayContext(tx: Tx, ctx: TenantCtx, employeeId: string, date: LocalDate, excludeAppointmentId?: string) {
	const [biz] = await tx.select({ timeZone: businesses.timeZone, policy: businesses.bookingPolicy }).from(businesses).where(eq(businesses.id, ctx.businessId));
	if (!biz) throw new DomainError("business_not_found");
	const tz = biz.timeZone;
	const dayStart = zonedTimeToUtc(date, "00:00", tz);
	const dayEnd = zonedTimeToUtc(addDays(date, 1), "00:00", tz);
	const [hours, avail, blocks, live] = await Promise.all([
		tx.select().from(businessHours).where(eq(businessHours.businessId, ctx.businessId)),
		tx.select().from(employeeAvailability).where(and(eq(employeeAvailability.businessId, ctx.businessId), eq(employeeAvailability.employeeId, employeeId))),
		tx
			.select({ start: timeBlocks.startAt, end: timeBlocks.endAt })
			.from(timeBlocks)
			.where(and(eq(timeBlocks.businessId, ctx.businessId), or(eq(timeBlocks.employeeId, employeeId), sql`${timeBlocks.employeeId} is null`), lt(timeBlocks.startAt, dayEnd), gte(timeBlocks.endAt, dayStart))),
		tx
			.select({ id: appointments.id, start: appointments.startAt, end: appointments.endAt })
			.from(appointments)
			.where(and(eq(appointments.businessId, ctx.businessId), eq(appointments.employeeId, employeeId), inArray(appointments.status, [...LIVE_STATUSES]), lt(appointments.startAt, dayEnd), gte(appointments.endAt, dayStart))),
	]);
	return {
		timeZone: tz,
		policy: readPolicy(biz.policy),
		businessHours: hours.map((h) => ({ weekday: h.weekday, startsAt: h.opensAt, endsAt: h.closesAt })),
		employeeAvailability: avail.map((a) => ({ weekday: a.weekday, startsAt: a.startsAt, endsAt: a.endsAt })),
		timeBlocks: blocks as Interval[],
		liveAppointments: live.filter((a) => a.id !== excludeAppointmentId).map((a) => ({ start: a.start, end: a.end })) as Interval[],
	};
}

/** Resolve the services for a booking and the time they take, honouring per-employee overrides. */
async function resolveServices(tx: Tx, ctx: TenantCtx, employeeId: string, serviceIds: string[]) {
	const rows = await tx
		.select({
			id: services.id,
			name: services.name,
			durationMinutes: services.durationMinutes,
			bufferAfterMinutes: services.bufferAfterMinutes,
			priceCents: services.priceCents,
			depositType: services.depositType,
			depositAmount: services.depositAmount,
			active: services.active,
			overridePrice: employeeServices.priceCentsOverride,
			overrideDuration: employeeServices.durationMinutesOverride,
		})
		.from(services)
		.leftJoin(employeeServices, and(eq(employeeServices.serviceId, services.id), eq(employeeServices.employeeId, employeeId)))
		.where(and(eq(services.businessId, ctx.businessId), inArray(services.id, serviceIds)));
	if (rows.length !== new Set(serviceIds).size) throw new DomainError("service_not_found");
	const ordered = serviceIds.map((id) => rows.find((r) => r.id === id)!);
	if (ordered.some((r) => !r.active)) throw new DomainError("service_inactive", "One of those services is hidden");
	const items = ordered.map((r, i) => ({
		serviceId: r.id,
		name: r.name,
		durationMinutes: r.overrideDuration ?? r.durationMinutes,
		priceCents: r.overridePrice ?? r.priceCents,
		sortOrder: i,
	}));
	const serviceMinutes = items.reduce((n, s) => n + s.durationMinutes, 0);
	const buffer = Math.max(...ordered.map((r) => r.bufferAfterMinutes), 0);
	const priceCents = items.reduce((n, s) => n + s.priceCents, 0);
	const depositDueCents = ordered.reduce((n, r) => {
		if (r.depositType === "fixed") return n + r.depositAmount;
		if (r.depositType === "percent") return n + Math.round(((r.overridePrice ?? r.priceCents) * r.depositAmount) / 100);
		return n;
	}, 0);
	return { items, serviceMinutes, bufferMinutes: buffer, totalMinutes: serviceMinutes + buffer, priceCents, depositDueCents };
}

export async function listSlots(db: Db, ctx: TenantCtx, args: { employeeId: string; serviceIds: string[]; date: string; now?: Date }) {
	require(ctx, "calendar.view_own");
	const date = parseLocalDate(args.date);
	if (!date) throw new DomainError("bad_date");
	return withTenant(db, ctx, async (tx) => {
		const svc = await resolveServices(tx, ctx, args.employeeId, args.serviceIds);
		const day = await loadDayContext(tx, ctx, args.employeeId, date);
		const starts = availableStarts({ ...day, date, totalMinutes: svc.totalMinutes, now: args.now ?? new Date(), ignoreNotice: true });
		return { starts, totalMinutes: svc.totalMinutes, serviceMinutes: svc.serviceMinutes, priceCents: svc.priceCents, depositDueCents: svc.depositDueCents, timeZone: day.timeZone };
	});
}

/**
 * Book an appointment entered by staff. Validates the slot server-side, freezes
 * prices, and relies on the exclusion constraint for the final word on conflicts.
 */
export async function bookAppointment(db: Db, ctx: TenantCtx, raw: BookingInput) {
	const input = bookingInput.parse(raw);
	if (!input.customerId && !input.newCustomer) throw new DomainError("customer_required", "Pick a client or add a new one");
	return withTenant(db, ctx, async (tx) => {
		const emp = await assertEmployeeAccess(tx, ctx, input.employeeId);
		let customerId = input.customerId ?? null;
		if (!customerId && input.newCustomer) {
			// Inline creation reuses the customer service's rules (normalisation, duplicate email).
			const created = await createCustomerInTx(tx, ctx, input.newCustomer);
			customerId = created.id;
		} else if (customerId) {
			const [c] = await tx.select({ id: customers.id, status: customers.status, archivedAt: customers.archivedAt }).from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, ctx.businessId)));
			if (!c) throw new DomainError("customer_not_found");
			if (c.archivedAt) throw new DomainError("customer_archived", "This client is archived. Restore them first.");
			if (c.status === "do_not_book") throw new DomainError("do_not_book", "This client is marked Do not book.");
		}

		const svc = await resolveServices(tx, ctx, emp.id, input.serviceIds);
		const day = await loadDayContext(tx, ctx, emp.id, localDateOf(input.startAt, await tzOf(tx, ctx)));
		if (!fits({ ...day, date: localDateOf(input.startAt, day.timeZone), totalMinutes: svc.totalMinutes }, input.startAt)) {
			throw new DomainError("slot_unavailable", "That time is no longer available");
		}
		const serviceEndAt = new Date(input.startAt.getTime() + svc.serviceMinutes * 60000);
		const endAt = new Date(input.startAt.getTime() + svc.totalMinutes * 60000);

		let appt: typeof appointments.$inferSelect;
		try {
			[appt] = await tx
				.insert(appointments)
				.values({
					businessId: ctx.businessId,
					customerId: customerId!,
					employeeId: emp.id,
					startAt: input.startAt,
					serviceEndAt,
					endAt,
					status: "confirmed",
					source: "manual",
					priceCents: svc.priceCents,
					depositDueCents: svc.depositDueCents,
					note: input.note || null,
					seriesId: input.seriesId ?? null,
					createdByUserId: ctx.userId,
				})
				.returning();
		} catch (err) {
			if (isExclusionViolation(err)) throw new DomainError("slot_taken", "That time was just taken");
			throw err;
		}
		await tx.insert(appointmentServices).values(svc.items.map((s) => ({ ...s, businessId: ctx.businessId, appointmentId: appt.id })));
		await tx.insert(appointmentStatusHistory).values({ businessId: ctx.businessId, appointmentId: appt.id, fromStatus: null, toStatus: "confirmed", actorUserId: ctx.userId });
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "appointment.create", targetTable: "appointments", targetId: appt.id, after: { employeeId: emp.id, startAt: input.startAt, services: svc.items.map((s) => s.serviceId) } });
		return appt;
	});
}

export async function transition(db: Db, ctx: TenantCtx, id: string, to: AppointmentStatus, reason?: string) {
	return withTenant(db, ctx, async (tx) => {
		const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.businessId, ctx.businessId)));
		if (!appt) throw new DomainError("appointment_not_found");
		await assertEmployeeAccess(tx, ctx, appt.employeeId);
		if (!TRANSITIONS[appt.status].includes(to)) throw new DomainError("bad_transition", `Cannot go from ${appt.status} to ${to}`);
		const [after] = await tx.update(appointments).set({ status: to, updatedAt: new Date() }).where(eq(appointments.id, id)).returning();
		await tx.insert(appointmentStatusHistory).values({ businessId: ctx.businessId, appointmentId: id, fromStatus: appt.status, toStatus: to, actorUserId: ctx.userId, reason: reason || null });
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: `appointment.${to}`, targetTable: "appointments", targetId: id, before: { status: appt.status }, after: { status: to, reason: reason || null } });
		return after;
	});
}

/**
 * Open starts for moving an appointment: same length as booked (frozen durations and buffer),
 * on any visible staff member's day, ignoring the appointment's own current slot.
 */
export async function listMoveSlots(db: Db, ctx: TenantCtx, id: string, args: { employeeId?: string; date: string; now?: Date }) {
	require(ctx, "calendar.view_own");
	const date = parseLocalDate(args.date);
	if (!date) throw new DomainError("bad_date");
	return withTenant(db, ctx, async (tx) => {
		const [old] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.businessId, ctx.businessId)));
		if (!old) throw new DomainError("appointment_not_found");
		const employeeId = args.employeeId ?? old.employeeId;
		if (!(await visibleEmployeeIds(tx, ctx)).includes(employeeId)) throw new DomainError("employee_not_found");
		const totalMinutes = Math.round((old.endAt.getTime() - old.startAt.getTime()) / 60000);
		const day = await loadDayContext(tx, ctx, employeeId, date, old.id);
		return availableStarts({ ...day, date, totalMinutes, now: args.now ?? new Date(), ignoreNotice: true });
	});
}

/**
 * Reschedule = a new confirmed row linked to the old one, which becomes `rescheduled`.
 * Pass `employeeId` to move it to someone else; prices and durations stay as booked.
 */
export async function reschedule(db: Db, ctx: TenantCtx, id: string, startAt: Date, employeeId?: string) {
	return withTenant(db, ctx, async (tx) => {
		const [old] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.businessId, ctx.businessId)));
		if (!old) throw new DomainError("appointment_not_found");
		await assertEmployeeAccess(tx, ctx, old.employeeId);
		if (!TRANSITIONS[old.status].includes("rescheduled")) throw new DomainError("bad_transition");
		const toEmployeeId = employeeId ?? old.employeeId;
		if (toEmployeeId !== old.employeeId) {
			const emp = await assertEmployeeAccess(tx, ctx, toEmployeeId);
			if (!emp.active) throw new DomainError("employee_inactive", "That person is not taking bookings");
		}
		const items = await tx.select().from(appointmentServices).where(eq(appointmentServices.appointmentId, id)).orderBy(asc(appointmentServices.sortOrder));
		const serviceMinutes = items.reduce((n, s) => n + s.durationMinutes, 0);
		const totalMinutes = Math.round((old.endAt.getTime() - old.startAt.getTime()) / 60000);
		const tz = await tzOf(tx, ctx);
		const day = await loadDayContext(tx, ctx, toEmployeeId, localDateOf(startAt, tz), old.id);
		if (!fits({ ...day, date: localDateOf(startAt, tz), totalMinutes }, startAt)) throw new DomainError("slot_unavailable", "That time is not available");

		// Release the old slot first so the new row can take an overlapping time.
		await tx.update(appointments).set({ status: "rescheduled", updatedAt: new Date() }).where(eq(appointments.id, id));
		await tx.insert(appointmentStatusHistory).values({ businessId: ctx.businessId, appointmentId: id, fromStatus: old.status, toStatus: "rescheduled", actorUserId: ctx.userId });
		let created: typeof appointments.$inferSelect;
		try {
			[created] = await tx
				.insert(appointments)
				.values({
					businessId: ctx.businessId,
					customerId: old.customerId,
					employeeId: toEmployeeId,
					startAt,
					serviceEndAt: new Date(startAt.getTime() + serviceMinutes * 60000),
					endAt: new Date(startAt.getTime() + totalMinutes * 60000),
					status: "confirmed",
					source: old.source,
					paymentStatus: old.paymentStatus,
					priceCents: old.priceCents,
					depositDueCents: old.depositDueCents,
					paidCents: old.paidCents,
					refundedCents: old.refundedCents,
					note: old.note,
					rescheduledFromId: old.id,
					seriesId: old.seriesId,
					createdByUserId: ctx.userId,
				})
				.returning();
		} catch (err) {
			if (isExclusionViolation(err)) throw new DomainError("slot_taken", "That time was just taken");
			throw err;
		}
		await tx.insert(appointmentServices).values(items.map(({ id: _id, appointmentId: _a, ...s }) => ({ ...s, appointmentId: created.id })));
		await tx.insert(appointmentStatusHistory).values({ businessId: ctx.businessId, appointmentId: created.id, fromStatus: null, toStatus: "confirmed", actorUserId: ctx.userId, reason: `rescheduled from ${old.id}` });
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "appointment.reschedule", targetTable: "appointments", targetId: created.id, before: { startAt: old.startAt, employeeId: old.employeeId }, after: { startAt, employeeId: toEmployeeId } });
		return created;
	});
}

/**
 * Reminder state. "sent" can repeat (a resend) until the client answers; a "declined" reply
 * only flags the booking so the owner can call, move or cancel it.
 */
export async function updateReminder(db: Db, ctx: TenantCtx, id: string, to: "sent" | "confirmed" | "declined", now = new Date()) {
	return withTenant(db, ctx, async (tx) => {
		const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.businessId, ctx.businessId)));
		if (!appt) throw new DomainError("appointment_not_found");
		await assertEmployeeAccess(tx, ctx, appt.employeeId);
		if (appt.status !== "confirmed" || appt.startAt.getTime() <= now.getTime()) throw new DomainError("not_remindable", "Only upcoming bookings get reminders");
		if (to === "sent" && appt.reminderStatus === "confirmed") throw new DomainError("already_confirmed", "They already confirmed");
		const patch = to === "sent" ? { reminderStatus: "sent" as const, reminderSentAt: now } : { reminderStatus: to, reminderRepliedAt: now };
		const [after] = await tx.update(appointments).set({ ...patch, updatedAt: now }).where(eq(appointments.id, id)).returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: `appointment.reminder_${to}`, targetTable: "appointments", targetId: id });
		return after;
	});
}

export type SeriesStatus = "ok" | "closed" | "off" | "taken";

/**
 * Dates for a repeat booking at the same local time every `everyWeeks` weeks. Each one is checked
 * like a single booking: closed days (weekly or from Settings), the staff member's day off, and
 * anything already in the slot.
 */
export async function previewSeries(db: Db, ctx: TenantCtx, args: { employeeId: string; serviceIds: string[]; startAt: Date; everyWeeks: number; count: number }) {
	require(ctx, "calendar.view_own");
	const every = z.number().int().min(1).max(8).parse(args.everyWeeks);
	const count = z.number().int().min(2).max(12).parse(args.count);
	return withTenant(db, ctx, async (tx) => {
		const tz = await tzOf(tx, ctx);
		const svc = await resolveServices(tx, ctx, args.employeeId, args.serviceIds);
		const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(args.startAt);
		const first = localDateOf(args.startAt, tz);
		const out: { startAt: Date; date: string; status: SeriesStatus; label: string | null }[] = [];
		for (let k = 0; k < count; k++) {
			const date = addDays(first, 7 * every * k);
			const startAt = zonedTimeToUtc(date, hhmm, tz);
			const day = await loadDayContext(tx, ctx, args.employeeId, date);
			const wd = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
			const hours = day.businessHours.find((h) => h.weekday === wd);
			let status: SeriesStatus = "ok";
			let label: string | null = null;
			if (!fits({ ...day, date, totalMinutes: svc.totalMinutes }, startAt)) {
				const closure = hours
					? (await tx.select({ reason: timeBlocks.reason }).from(timeBlocks).where(and(eq(timeBlocks.businessId, ctx.businessId), sql`${timeBlocks.employeeId} is null`, lte(timeBlocks.startAt, zonedTimeToUtc(date, hours.startsAt, tz)), gte(timeBlocks.endAt, zonedTimeToUtc(date, hours.endsAt, tz)))).limit(1))[0]
					: null;
				if (!hours || closure) {
					status = "closed";
					label = closure?.reason || "Closed";
				} else if (!day.employeeAvailability.some((a) => a.weekday === wd)) {
					status = "off";
					label = "Day off";
				} else {
					status = "taken";
					label = "Time taken";
				}
			}
			out.push({ startAt, date: formatLocalDate(date), status, label });
		}
		return out;
	});
}

/**
 * Book the first visit (must fit) and every later one that fits, all sharing a series id.
 * Dates that are closed or taken are skipped and reported, never forced.
 */
export async function bookSeries(db: Db, ctx: TenantCtx, raw: BookingInput & { everyWeeks: number; count: number }) {
	const input = bookingInput.parse(raw);
	const plan = await previewSeries(db, ctx, { employeeId: input.employeeId, serviceIds: input.serviceIds, startAt: input.startAt, everyWeeks: raw.everyWeeks, count: raw.count });
	if (plan[0].status !== "ok") throw new DomainError("slot_unavailable", "That time is no longer available");
	const seriesId = crypto.randomUUID();
	const first = await bookAppointment(db, ctx, { ...raw, seriesId });
	const booked = [first];
	const skipped: typeof plan = [];
	for (const occ of plan.slice(1)) {
		if (occ.status !== "ok") {
			skipped.push(occ);
			continue;
		}
		try {
			booked.push(await bookAppointment(db, ctx, { ...raw, customerId: first.customerId, newCustomer: undefined, startAt: occ.startAt, seriesId }));
		} catch (err) {
			const code = (err as { code?: string }).code;
			if (code !== "slot_taken" && code !== "slot_unavailable") throw err;
			skipped.push({ ...occ, status: "taken", label: "Time taken" });
		}
	}
	return { first, booked, skipped, seriesId };
}

/** Every visit in a series the caller can see, in date order (moved visits show at their new time). */
export async function listSeries(db: Db, ctx: TenantCtx, seriesId: string) {
	require(ctx, "calendar.view_own");
	return withTenant(db, ctx, async (tx) => {
		const visible = await visibleEmployeeIds(tx, ctx);
		if (visible.length === 0) return [];
		return tx
			.select({ id: appointments.id, startAt: appointments.startAt, status: appointments.status })
			.from(appointments)
			.where(and(eq(appointments.businessId, ctx.businessId), eq(appointments.seriesId, seriesId), inArray(appointments.employeeId, visible), ne(appointments.status, "rescheduled"), ne(appointments.status, "expired")))
			.orderBy(asc(appointments.startAt));
	});
}

/** Cancel this visit and every later booked one in its series. Returns how many were cancelled. */
export async function cancelSeriesFrom(db: Db, ctx: TenantCtx, id: string, reason?: string) {
	const appt = await getAppointment(db, ctx, id);
	if (!appt) throw new DomainError("appointment_not_found");
	if (!appt.seriesId) {
		await transition(db, ctx, id, "cancelled", reason);
		return 1;
	}
	const rest = (await listSeries(db, ctx, appt.seriesId)).filter((a) => a.startAt.getTime() >= appt.startAt.getTime() && (a.status === "confirmed" || a.status === "held"));
	for (const a of rest) await transition(db, ctx, a.id, "cancelled", reason);
	return rest.length;
}

export interface DayAppointment {
	id: string;
	startAt: Date;
	serviceEndAt: Date;
	endAt: Date;
	status: AppointmentStatus;
	paymentStatus: (typeof appointments.$inferSelect)["paymentStatus"];
	priceCents: number;
	employeeId: string;
	employeeName: string;
	customerId: string;
	customerName: string;
	services: string[];
	note: string | null;
	allergy: string | null;
	clientStatus: (typeof customers.$inferSelect)["status"];
}

/** Appointments for one local day across the staff the caller may see. */
export async function listDay(db: Db, ctx: TenantCtx, dateIso: string): Promise<{ date: LocalDate; timeZone: string; items: DayAppointment[]; employees: { id: string; displayName: string }[] }> {
	require(ctx, "calendar.view_own");
	const date = parseLocalDate(dateIso);
	if (!date) throw new DomainError("bad_date");
	return withTenant(db, ctx, async (tx) => {
		const tz = await tzOf(tx, ctx);
		const dayStart = zonedTimeToUtc(date, "00:00", tz);
		const dayEnd = zonedTimeToUtc(addDays(date, 1), "00:00", tz);
		const visibleEmployees = await visibleEmployeeIds(tx, ctx);
		const emps = await tx.select({ id: employees.id, displayName: employees.displayName }).from(employees).where(and(eq(employees.businessId, ctx.businessId), eq(employees.active, true))).orderBy(asc(employees.sortOrder));
		if (visibleEmployees.length === 0) return { date, timeZone: tz, items: [], employees: emps.filter((e) => visibleEmployees.includes(e.id)) };
		const rows = await tx
			.select({
				id: appointments.id,
				startAt: appointments.startAt,
				serviceEndAt: appointments.serviceEndAt,
				endAt: appointments.endAt,
				status: appointments.status,
				paymentStatus: appointments.paymentStatus,
				priceCents: appointments.priceCents,
				employeeId: appointments.employeeId,
				employeeName: employees.displayName,
				customerId: appointments.customerId,
				firstName: customers.firstName,
				lastName: customers.lastName,
				note: appointments.note,
				allergy: customers.allergy,
				clientStatus: customers.status,
			})
			.from(appointments)
			.innerJoin(employees, eq(employees.id, appointments.employeeId))
			.innerJoin(customers, eq(customers.id, appointments.customerId))
			.where(and(eq(appointments.businessId, ctx.businessId), inArray(appointments.employeeId, visibleEmployees), gte(appointments.startAt, dayStart), lt(appointments.startAt, dayEnd), ne(appointments.status, "rescheduled"), ne(appointments.status, "expired")))
			.orderBy(asc(appointments.startAt));
		const ids = rows.map((r) => r.id);
		const svcRows = ids.length ? await tx.select({ appointmentId: appointmentServices.appointmentId, name: appointmentServices.name, sortOrder: appointmentServices.sortOrder }).from(appointmentServices).where(inArray(appointmentServices.appointmentId, ids)).orderBy(asc(appointmentServices.sortOrder)) : [];
		const items: DayAppointment[] = rows.map((r) => ({
			id: r.id,
			startAt: r.startAt,
			serviceEndAt: r.serviceEndAt,
			endAt: r.endAt,
			status: r.status,
			paymentStatus: r.paymentStatus,
			priceCents: r.priceCents,
			employeeId: r.employeeId,
			employeeName: r.employeeName,
			customerId: r.customerId,
			customerName: [r.firstName, r.lastName].filter(Boolean).join(" "),
			services: svcRows.filter((s) => s.appointmentId === r.id).map((s) => s.name),
			note: r.note,
			allergy: r.allergy,
			clientStatus: r.clientStatus,
		}));
		return { date, timeZone: tz, items, employees: emps.filter((e) => visibleEmployees.includes(e.id)) };
	});
}

export async function getAppointment(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "calendar.view_own");
	return withTenant(db, ctx, async (tx) => {
		const [r] = await tx
			.select({
				appt: appointments,
				employeeName: employees.displayName,
				firstName: customers.firstName,
				lastName: customers.lastName,
				phone: customers.phone,
				pinnedNote: customers.pinnedNote,
				allergy: customers.allergy,
				clientStatus: customers.status,
			})
			.from(appointments)
			.innerJoin(employees, eq(employees.id, appointments.employeeId))
			.innerJoin(customers, eq(customers.id, appointments.customerId))
			.where(and(eq(appointments.id, id), eq(appointments.businessId, ctx.businessId)));
		if (!r) return null;
		const visible = await visibleEmployeeIds(tx, ctx);
		if (!visible.includes(r.appt.employeeId)) return null;
		const items = await tx.select().from(appointmentServices).where(eq(appointmentServices.appointmentId, id)).orderBy(asc(appointmentServices.sortOrder));
		// Who did it: the logged-in user behind each change (null for system changes like hold expiry).
		const history = await tx
			.select({ id: appointmentStatusHistory.id, fromStatus: appointmentStatusHistory.fromStatus, toStatus: appointmentStatusHistory.toStatus, reason: appointmentStatusHistory.reason, createdAt: appointmentStatusHistory.createdAt, actorName: users.name })
			.from(appointmentStatusHistory)
			.leftJoin(users, eq(users.id, appointmentStatusHistory.actorUserId))
			.where(eq(appointmentStatusHistory.appointmentId, id))
			.orderBy(asc(appointmentStatusHistory.createdAt));
		const tz = await tzOf(tx, ctx);
		return {
			...r.appt,
			employeeName: r.employeeName,
			customerName: [r.firstName, r.lastName].filter(Boolean).join(" "),
			customerPhone: can(ctx, "customers.view_contact") ? r.phone : null,
			pinnedNote: r.pinnedNote,
			allergy: r.allergy,
			clientStatus: r.clientStatus,
			services: items,
			history,
			timeZone: tz,
			allowedTransitions: TRANSITIONS[r.appt.status].filter((t) => t !== "expired" && t !== "rescheduled"),
		};
	});
}

/** Upcoming appointments for a customer, newest first for history, soonest first for upcoming. */
export async function listForCustomer(db: Db, ctx: TenantCtx, customerId: string) {
	require(ctx, "customers.view");
	return withTenant(db, ctx, async (tx) => {
		const rows = await tx
			.select({ id: appointments.id, startAt: appointments.startAt, status: appointments.status, priceCents: appointments.priceCents, paymentStatus: appointments.paymentStatus, employeeName: employees.displayName })
			.from(appointments)
			.innerJoin(employees, eq(employees.id, appointments.employeeId))
			.where(and(eq(appointments.businessId, ctx.businessId), eq(appointments.customerId, customerId), ne(appointments.status, "rescheduled"), ne(appointments.status, "expired")))
			.orderBy(asc(appointments.startAt));
		const ids = rows.map((r) => r.id);
		const svcRows = ids.length ? await tx.select({ appointmentId: appointmentServices.appointmentId, name: appointmentServices.name }).from(appointmentServices).where(inArray(appointmentServices.appointmentId, ids)).orderBy(asc(appointmentServices.sortOrder)) : [];
		const now = Date.now();
		const withSvc = rows.map((r) => ({ ...r, services: svcRows.filter((s) => s.appointmentId === r.id).map((s) => s.name) }));
		return {
			upcoming: withSvc.filter((r) => r.startAt.getTime() >= now && (r.status === "confirmed" || r.status === "checked_in" || r.status === "held")),
			past: withSvc.filter((r) => r.startAt.getTime() < now || r.status === "completed" || r.status === "cancelled" || r.status === "no_show").reverse(),
			lifetimeCents: withSvc.filter((r) => r.status === "completed").reduce((n, r) => n + r.priceCents, 0),
		};
	});
}

/** Expire held appointments whose hold has lapsed (cron, phase 7 uses holds; harmless now). */
export async function expireHolds(db: Db, ctx: TenantCtx) {
	return withTenant(db, ctx, async (tx) => {
		const expired = await tx
			.update(appointments)
			.set({ status: "expired", updatedAt: new Date() })
			.where(and(eq(appointments.businessId, ctx.businessId), eq(appointments.status, "held"), lte(appointments.holdExpiresAt, new Date())))
			.returning({ id: appointments.id });
		for (const e of expired) await tx.insert(appointmentStatusHistory).values({ businessId: ctx.businessId, appointmentId: e.id, fromStatus: "held", toStatus: "expired", actorUserId: null, reason: "hold expired" });
		return expired.length;
	});
}

async function tzOf(tx: Tx, ctx: TenantCtx): Promise<string> {
	const [b] = await tx.select({ tz: businesses.timeZone }).from(businesses).where(eq(businesses.id, ctx.businessId));
	return b?.tz ?? "America/New_York";
}

/** Employees the caller may act on: all with calendar.view_all, else only their own employee row. */
async function visibleEmployeeIds(tx: Tx, ctx: TenantCtx): Promise<string[]> {
	const all = await tx.select({ id: employees.id, memberId: employees.memberId }).from(employees).where(eq(employees.businessId, ctx.businessId));
	if (can(ctx, "calendar.view_all")) return all.map((e) => e.id);
	const [me] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.userId, ctx.userId)));
	return all.filter((e) => e.memberId === me?.id).map((e) => e.id);
}

/** Acting on an employee's calendar needs manage_all, or manage_own for your own row. */
async function assertEmployeeAccess(tx: Tx, ctx: TenantCtx, employeeId: string) {
	const [emp] = await tx.select({ id: employees.id, memberId: employees.memberId, active: employees.active }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.businessId, ctx.businessId)));
	if (!emp) throw new DomainError("employee_not_found");
	if (can(ctx, "appointments.manage_all")) return emp;
	const [me] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.userId, ctx.userId)));
	if (emp.memberId && emp.memberId === me?.id) {
		require(ctx, "appointments.manage_own");
		return emp;
	}
	require(ctx, "appointments.manage_all");
	return emp;
}

async function createCustomerInTx(tx: Tx, ctx: TenantCtx, input: NonNullable<z.output<typeof bookingInput>["newCustomer"]>) {
	// Delegate to the customer service rules by running them against the same transaction shape.
	const { customerInput, normalizePhone } = await import("../customers/service");
	const parsed = customerInput.parse({ firstName: input.firstName, lastName: input.lastName ?? "", email: input.email ?? "", phone: input.phone ?? "", pinnedNote: "", marketingConsent: false } satisfies CustomerInput);
	const email = parsed.email ? parsed.email.toLowerCase() : null;
	if (email) {
		const [dup] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.businessId, ctx.businessId), eq(customers.email, email)));
		if (dup) return dup;
	}
	const [row] = await tx.insert(customers).values({ businessId: ctx.businessId, firstName: parsed.firstName, lastName: parsed.lastName || null, email, phone: normalizePhone(parsed.phone) }).returning({ id: customers.id });
	await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "customer.create", targetTable: "customers", targetId: row.id, after: { inline: true } });
	return row;
}

function isExclusionViolation(err: unknown): boolean {
	const e = err as { code?: string; cause?: { code?: string } };
	return e?.code === "23P01" || e?.cause?.code === "23P01";
}

export { formatLocalDate };
