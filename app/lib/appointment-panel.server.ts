import type { TenantCtx } from "../../server/auth/ctx";
import { hasPermission } from "../../server/auth/permissions";
import type { Db } from "../../server/db/client";
import { getAppointment, listMoveSlots, listSeries } from "../../server/domain/appointments/service";
import { listEmployees } from "../../server/domain/staff/service";
import { closedDates } from "../../server/domain/calendar/service";
import { reminderPreview } from "../../server/domain/reminders/service";
import { getCredit, listPayments } from "../../server/domain/payments/service";
import { addDays, formatLocalDate, localDateOf, weekdayOf } from "../../server/domain/scheduling/time";

/**
 * The appointment side panel shared by Today and Calendar. Its state lives in the page's
 * query string, so every tap is a link and the page underneath stays put:
 *   ?a=<id>            open the panel
 *   &move=YYYY-MM-DD   show the move picker for that day (empty = the booked day)
 *   &with=<employeeId> move to someone else
 *   &cancel=1          show the cancel confirmation
 *   &remind=1          show the reminder preview
 *   &pay=1             show checkout
 *   &err=taken|failed|sms  last action's error;  &booked=1  just booked
 */
export const PANEL_PARAMS = ["a", "move", "with", "cancel", "remind", "pay", "err", "booked"] as const;

export async function loadAppointmentPanel(db: Db, ctx: TenantCtx, url: URL, opts: { smsReady?: boolean } = {}) {
	const id = url.searchParams.get("a");
	if (!id) return null;
	const appt = await getAppointment(db, ctx, id);
	if (!appt) return null;
	const tz = appt.timeZone;
	const now = new Date();
	const today = localDateOf(now, tz);
	const apptDay = formatLocalDate(localDateOf(appt.startAt, tz));

	let staff = [{ id: appt.employeeId, displayName: appt.employeeName }];
	if (hasPermission(ctx.role, [...ctx.permissions], "team.view")) {
		const list = (await listEmployees(db, ctx)).map((e) => ({ id: e.id, displayName: e.displayName }));
		staff = list.some((e) => e.id === appt.employeeId) ? list : [...staff, ...list];
	}

	const moveParam = url.searchParams.get("move");
	let move: { date: string; employeeId: string; starts: string[]; days: { iso: string; weekday: number; day: number; closed: string | null }[] } | null = null;
	if (moveParam !== null && appt.status === "confirmed") {
		const date = moveParam || apptDay;
		const employeeId = staff.find((e) => e.id === url.searchParams.get("with"))?.id ?? appt.employeeId;
		let starts: string[] = [];
		try {
			starts = (await listMoveSlots(db, ctx, appt.id, { employeeId, date, now })).map((d) => d.toISOString());
		} catch {
			starts = [];
		}
		const closed = await closedDates(db, ctx, formatLocalDate(today), 14).catch(() => ({}) as Record<string, string>);
		const days = Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => ({ iso: formatLocalDate(d), weekday: weekdayOf(d), day: d.day, closed: closed[formatLocalDate(d)] ?? null }));
		move = { date, employeeId, starts, days };
	}

	const remindable = appt.status === "confirmed" && new Date(appt.startAt).getTime() > now.getTime();
	const preview = remindable && url.searchParams.get("remind") === "1" ? await reminderPreview(db, ctx, appt.id) : null;

	const seriesRows = appt.seriesId ? await listSeries(db, ctx, appt.seriesId) : [];
	const series = seriesRows.length > 1
		? { items: seriesRows, position: seriesRows.findIndex((s) => s.id === appt.id) + 1, laterBooked: seriesRows.filter((s) => s.startAt.getTime() > new Date(appt.startAt).getTime() && s.status === "confirmed").length }
		: null;

	const dueCents = Math.max(0, appt.priceCents - appt.paidCents);
	const canPay = (appt.status === "completed" || appt.status === "checked_in") && dueCents > 0;
	const [paid, credit] = await Promise.all([
		listPayments(db, ctx, appt.id),
		hasPermission(ctx.role, [...ctx.permissions], "customers.view") ? getCredit(db, ctx, appt.customerId).then((c) => c.balanceCents) : Promise.resolve(0),
	]);

	return {
		appt,
		payment: { dueCents, canPay, open: canPay && url.searchParams.get("pay") === "1", creditCents: credit, items: paid },
		series,
		reminder: remindable ? { status: appt.reminderStatus, sentAt: appt.reminderSentAt, repliedAt: appt.reminderRepliedAt, preview: preview ? { body: preview.body, to: preview.to } : null, smsReady: !!opts.smsReady } : null,
		isToday: apptDay === formatLocalDate(today),
		staff,
		move,
		cancel: url.searchParams.get("cancel") === "1" && appt.allowedTransitions.includes("cancelled"),
		err: url.searchParams.get("err"),
		booked: Math.max(0, Math.min(12, Number(url.searchParams.get("booked")) || 0)),
	};
}

export type AppointmentPanelData = NonNullable<Awaited<ReturnType<typeof loadAppointmentPanel>>>;
