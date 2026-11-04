import { redirect } from "react-router";
import type { Route } from "./+types/appointment";
import { requireTenant, services } from "../../../server/auth/session";
import { cancelSeriesFrom, getAppointment, reschedule, transition, updateReminder, type AppointmentStatus } from "../../../server/domain/appointments/service";
import { sendReminder } from "../../../server/domain/reminders/service";
import { envContext } from "../../../server/context";
import { formatLocalDate, localDateOf } from "../../../server/domain/scheduling/time";

/**
 * No page of its own any more: appointments open in the side panel on Today or Calendar.
 * GET (old links, the booking sheet's redirect) sends you to the right day with the panel open.
 * POST runs an action and returns to `returnTo` with the panel still open.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const appt = await getAppointment(db, ctx, params.appointmentId!);
	if (!appt) throw new Response("Not found", { status: 404 });
	const base = `/app/${params.business}`;
	const day = formatLocalDate(localDateOf(appt.startAt, appt.timeZone));
	const today = formatLocalDate(localDateOf(new Date(), appt.timeZone));
	const n = Number(new URL(request.url).searchParams.get("booked"));
	const booked = n > 0 ? `&booked=${Math.min(n, 12)}` : "";
	throw redirect(day === today ? `${base}?a=${appt.id}${booked}` : `${base}/calendar?date=${day}&a=${appt.id}${booked}`);
}

/** Only same-business paths; anything else falls back to Today. */
function backTo(raw: string, base: string, patch: Record<string, string | null>) {
	const ok = raw === base || raw.startsWith(`${base}/`) || raw.startsWith(`${base}?`);
	const u = new URL(ok ? raw : base, "http://x");
	for (const k of ["move", "with", "cancel", "remind", "err", "booked"]) u.searchParams.delete(k);
	for (const [k, v] of Object.entries(patch)) (v === null ? u.searchParams.delete(k) : u.searchParams.set(k, v));
	return u.pathname + u.search;
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const base = `/app/${params.business}`;
	const form = await request.formData();
	const intent = String(form.get("intent"));
	const returnTo = String(form.get("returnTo") ?? base);
	const id = params.appointmentId!;
	try {
		if (intent === "reschedule") {
			const employeeId = form.get("employeeId") ? String(form.get("employeeId")) : undefined;
			const moved = await reschedule(db, ctx, id, new Date(String(form.get("at"))), employeeId);
			return redirect(backTo(returnTo, base, { a: moved.id }));
		}
		if (intent === "remind-send") {
			try {
				await sendReminder(db, ctx, context.get(envContext), id);
			} catch (err) {
				const c = (err as { code?: string }).code;
				if (c === "sms_not_configured" || c === "sms_failed") return redirect(backTo(returnTo, base, { a: id, remind: "1", err: "sms" }));
				throw err;
			}
			return redirect(backTo(returnTo, base, { a: id }));
		}
		if (intent === "remind-sent" || intent === "remind-confirmed" || intent === "remind-declined") {
			await updateReminder(db, ctx, id, intent.slice(7) as "sent" | "confirmed" | "declined");
			return redirect(backTo(returnTo, base, { a: id }));
		}
		if (intent === "cancelled" && form.get("series") === "rest") {
			await cancelSeriesFrom(db, ctx, id, String(form.get("reason") ?? ""));
			return redirect(backTo(returnTo, base, { a: id }));
		}
		await transition(db, ctx, id, intent as AppointmentStatus, String(form.get("reason") ?? ""));
		// Checking in from the Next up card stays on Today without opening the panel.
		return redirect(backTo(returnTo, base, new URL(returnTo, "http://x").searchParams.has("a") ? { a: id } : {}));
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		const code = e.code === "slot_taken" || e.code === "slot_unavailable" ? "taken" : "failed";
		return redirect(backTo(returnTo, base, { a: id, err: code, ...(intent === "reschedule" ? { move: "" } : {}) }));
	}
}

export default function Appointment() {
	return null;
}
