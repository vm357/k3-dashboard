import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { can, require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { appointmentServices, appointments, businessMembers, businesses, customers, employees } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { AppEnv } from "../../env";
import { sendSms } from "../../sms/send";
import { getAppointment, updateReminder } from "../appointments/service";
import { readPolicy } from "../businesses/hours";
import { DomainError } from "../members/service";
import { addDays, localDateOf, zonedTimeToUtc } from "../scheduling/time";
import { DEFAULT_REMINDER, renderReminder, reminderVars } from "./text";

export { DEFAULT_REMINDER, REMINDER_PLACEHOLDERS, renderReminder, reminderVars } from "./text";

/** The text that would go out for this appointment, using the business name and template from Settings. */
export async function reminderPreview(db: Db, ctx: TenantCtx, id: string) {
	const appt = await getAppointment(db, ctx, id);
	if (!appt) throw new DomainError("appointment_not_found");
	const extra = await withTenant(db, ctx, async (tx) => {
		const [b] = await tx.select({ name: businesses.name, policy: businesses.bookingPolicy }).from(businesses).where(eq(businesses.id, ctx.businessId));
		const [c] = await tx.select({ firstName: customers.firstName, phone: customers.phone }).from(customers).where(eq(customers.id, appt.customerId));
		return { business: b?.name ?? "", template: readPolicy(b?.policy).reminderTemplate || DEFAULT_REMINDER, firstName: c?.firstName ?? "", phone: c?.phone ?? null };
	});
	const body = renderReminder(extra.template, reminderVars({ firstName: extra.firstName, business: extra.business, services: appt.services.map((s) => s.name), startAt: appt.startAt, staff: appt.employeeName, timeZone: appt.timeZone }));
	return { body, to: can(ctx, "customers.view_contact") ? extra.phone : null, status: appt.reminderStatus, sentAt: appt.reminderSentAt, repliedAt: appt.reminderRepliedAt };
}

/** Send through Twilio (or the test outbox) and record it. Throws SmsNotConfigured until Twilio is set up. */
export async function sendReminder(db: Db, ctx: TenantCtx, env: AppEnv, id: string, now = new Date()) {
	require(ctx, "appointments.manage_own");
	const p = await reminderPreview(db, ctx, id);
	if (!p.to) throw new DomainError("no_phone", "No phone number on file");
	if (p.status === "confirmed") throw new DomainError("already_confirmed", "They already confirmed");
	await sendSms(env, { to: p.to, body: p.body });
	return updateReminder(db, ctx, id, "sent", now);
}

/** Bookings from now to the end of tomorrow that the client has not confirmed. */
export async function listNotConfirmed(db: Db, ctx: TenantCtx, now = new Date()) {
	require(ctx, "calendar.view_own");
	return withTenant(db, ctx, async (tx) => {
		const [b] = await tx.select({ tz: businesses.timeZone }).from(businesses).where(eq(businesses.id, ctx.businessId));
		const tz = b?.tz ?? "America/New_York";
		const until = zonedTimeToUtc(addDays(localDateOf(now, tz), 2), "00:00", tz);
		const rows = await tx
			.select({ id: appointments.id, startAt: appointments.startAt, employeeId: appointments.employeeId, reminderStatus: appointments.reminderStatus, reminderSentAt: appointments.reminderSentAt, firstName: customers.firstName, lastName: customers.lastName, employeeName: employees.displayName })
			.from(appointments)
			.innerJoin(customers, eq(customers.id, appointments.customerId))
			.innerJoin(employees, eq(employees.id, appointments.employeeId))
			.where(and(eq(appointments.businessId, ctx.businessId), eq(appointments.status, "confirmed"), gt(appointments.startAt, now), lt(appointments.startAt, until), inArray(appointments.reminderStatus, ["not_sent", "sent", "declined"])))
			.orderBy(asc(appointments.startAt));
		// Same visibility as the calendar.
		const visible = can(ctx, "calendar.view_all") ? null : new Set(await getVisible(tx, ctx));
		const ids = rows.map((r) => r.id);
		const svc = ids.length ? await tx.select({ appointmentId: appointmentServices.appointmentId, name: appointmentServices.name }).from(appointmentServices).where(inArray(appointmentServices.appointmentId, ids)) : [];
		return rows
			.filter((r) => !visible || visible.has(r.employeeId))
			.map((r) => ({ id: r.id, startAt: r.startAt, reminderStatus: r.reminderStatus, reminderSentAt: r.reminderSentAt, customerName: [r.firstName, r.lastName].filter(Boolean).join(" "), employeeName: r.employeeName, services: svc.filter((s) => s.appointmentId === r.id).map((s) => s.name), timeZone: tz }));
	});
}

async function getVisible(tx: Parameters<Parameters<typeof withTenant>[2]>[0], ctx: TenantCtx): Promise<string[]> {
	const [me] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.userId, ctx.userId)));
	const rows = await tx.select({ id: employees.id, memberId: employees.memberId }).from(employees).where(eq(employees.businessId, ctx.businessId));
	return rows.filter((e) => me && e.memberId === me.id).map((e) => e.id);
}
