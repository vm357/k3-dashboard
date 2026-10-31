import { Form, Link, redirect, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/appointment";
import type { loader as layoutLoader } from "./business-layout";
import { IconBack } from "../../components/icons";
import { Page } from "../../components/shell";
import { Avatar, Badge, Button, ButtonLink, Card, Field, PageTitle } from "../../components/ui";
import { STATUS_LABEL, formatCents, formatDate, formatMinutes, formatPhone, formatTimeRange } from "../../lib/format";
import { requireTenant, services } from "../../../server/auth/session";
import { getAppointment, listSlots, reschedule, transition, type AppointmentStatus } from "../../../server/domain/appointments/service";
import { formatLocalDate, localDateOf } from "../../../server/domain/scheduling/time";
import { formatTime } from "../../lib/format";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Appointment · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const appt = await getAppointment(db, ctx, params.appointmentId!);
	if (!appt) throw new Response("Not found", { status: 404 });
	const url = new URL(request.url);
	const booked = url.searchParams.get("booked") === "1";
	const moveDate = url.searchParams.get("move");
	let moveSlots: string[] | null = null;
	if (moveDate && appt.allowedTransitions.length > 0 && (appt.status === "confirmed")) {
		try {
			const r = await listSlots(db, ctx, { employeeId: appt.employeeId, serviceIds: appt.services.map((s) => s.serviceId), date: moveDate });
			moveSlots = r.starts.map((d) => d.toISOString());
		} catch {
			moveSlots = [];
		}
	}
	return { appt: { ...appt, services: appt.services, history: appt.history }, booked, moveDate, moveSlots };
}

const ACTION_LABEL: Record<string, { label: string; variant: "filled" | "outlined" | "danger" | "quiet" }> = {
	checked_in: { label: "Check in", variant: "filled" },
	completed: { label: "Mark done", variant: "filled" },
	cancelled: { label: "Cancel appointment", variant: "danger" },
	no_show: { label: "No-show", variant: "quiet" },
};

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const intent = String(form.get("intent"));
	try {
		if (intent === "reschedule") {
			const moved = await reschedule(db, ctx, params.appointmentId!, new Date(String(form.get("at"))));
			throw redirect(`/app/${params.business}/appointments/${moved.id}`);
		}
		await transition(db, ctx, params.appointmentId!, intent as AppointmentStatus, String(form.get("reason") ?? ""));
		return { error: undefined };
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "slot_taken" || e.code === "slot_unavailable") return { error: "That time is not available any more." };
		return { error: e.message ?? "That did not work." };
	}
}

export default function Appointment({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}`;
	const a = loaderData.appt;
	const tz = a.timeZone;
	const live = a.status === "confirmed" || a.status === "checked_in";
	const dateIso = formatLocalDate(localDateOf(new Date(a.startAt), tz));

	return (
		<Page>
			<Link to={`${base}/calendar?date=${dateIso}`} className="-mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft">
				<IconBack width={18} height={18} />
				{formatDate(a.startAt, tz, "full")}
			</Link>
			{loaderData.booked ? <p role="status" className="rounded-card bg-mint px-4 py-3 text-sm font-semibold text-heading">Booked.</p> : null}
			{actionData?.error ? <p role="alert" className="text-sm text-danger">{actionData.error}</p> : null}

			<Card tone={live ? "feature" : "default"} className="flex flex-col gap-3">
				<div className="flex items-start justify-between gap-3">
					<div className="flex flex-col gap-0.5">
						<span className={`text-sm ${live ? "text-on-dark-soft" : "text-ink-soft"}`}>{formatTimeRange(a.startAt, a.serviceEndAt, tz)} · {formatMinutes(Math.round((new Date(a.serviceEndAt).getTime() - new Date(a.startAt).getTime()) / 60000))}</span>
						<span className="text-2xl font-bold">{a.customerName}</span>
						<span className={`text-sm ${live ? "text-on-dark-soft" : "text-ink-soft"}`}>with {a.employeeName}</span>
					</div>
					<Badge variant={live ? "onDark" : a.status === "completed" ? "green" : "neutral"}>{STATUS_LABEL[a.status]}</Badge>
				</div>
				{a.pinnedNote ? <p className={`text-sm leading-relaxed ${live ? "text-on-dark" : ""}`}>{a.pinnedNote}</p> : null}
				<div className="flex flex-wrap gap-2">
					<ButtonLink to={`${base}/clients/${a.customerId}`} variant={live ? "inverted" : "outlined"} size="sm">Open client</ButtonLink>
					{a.customerPhone ? <a href={`sms:${a.customerPhone}`} className={`press inline-flex min-h-10 items-center rounded-pill border px-4 text-sm font-semibold ${live ? "border-on-dark text-on-dark" : "border-heading text-heading"}`}>Text {formatPhone(a.customerPhone)}</a> : null}
				</div>
			</Card>

			<Card className="flex flex-col gap-2">
				<h2 className="text-base font-bold">Services</h2>
				<ul className="flex flex-col">
					{a.services.map((s) => (
						<li key={s.id} className="flex items-center justify-between border-b border-hairline py-2 text-sm last:border-b-0">
							<span>{s.name} <span className="text-ink-soft">· {formatMinutes(s.durationMinutes)}</span></span>
							<span className="font-semibold">{formatCents(s.priceCents)}</span>
						</li>
					))}
					<li className="flex items-center justify-between pt-2 text-sm font-bold"><span>Total</span><span>{formatCents(a.priceCents)}</span></li>
				</ul>
				<div className="flex items-center justify-between text-sm">
					<span className="text-ink-soft">Payment</span>
					<Badge>{a.paymentStatus === "unpaid" ? "Not paid" : STATUS_LABEL[a.paymentStatus] ?? a.paymentStatus}</Badge>
				</div>
				{a.depositDueCents > 0 ? <p className="text-xs text-ink-soft">{formatCents(a.depositDueCents)} deposit due. Collecting payments arrives in a later build.</p> : null}
				{a.note ? <p className="text-sm"><span className="font-semibold">Note:</span> {a.note}</p> : null}
			</Card>

			{a.allowedTransitions.length > 0 ? (
				<Card className="flex flex-col gap-3">
					<h2 className="text-base font-bold">Update</h2>
					<div className="flex flex-wrap gap-2">
						{a.allowedTransitions.filter((t) => t !== "cancelled").map((t) => (
							<Form key={t} method="post">
								<input type="hidden" name="intent" value={t} />
								<Button type="submit" variant={ACTION_LABEL[t]?.variant ?? "outlined"}>{ACTION_LABEL[t]?.label ?? STATUS_LABEL[t]}</Button>
							</Form>
						))}
					</div>
					{a.status === "confirmed" ? (
						<details className="rounded-card border border-hairline p-3">
							<summary className="cursor-pointer text-sm font-semibold">Move to another time</summary>
							<Form method="get" className="mt-3 flex items-end gap-2">
								<Field label="Day" name="move" type="date" defaultValue={loaderData.moveDate ?? dateIso} className="flex-1" />
								<Button type="submit" variant="outlined">Show times</Button>
							</Form>
							{loaderData.moveSlots ? (
								loaderData.moveSlots.length === 0 ? (
									<p className="mt-3 text-sm text-ink-soft">Nothing open that day.</p>
								) : (
									<Form method="post" className="mt-3 grid grid-cols-4 gap-2">
										<input type="hidden" name="intent" value="reschedule" />
										{loaderData.moveSlots.map((iso) => (
											<button key={iso} type="submit" name="at" value={iso} className="press min-h-11 rounded-pill border border-input-border bg-card text-sm font-semibold hover:border-cta">{formatTime(iso, tz)}</button>
										))}
									</Form>
								)
							) : null}
						</details>
					) : null}
					{a.allowedTransitions.includes("cancelled") ? (
						<details className="rounded-card border border-hairline p-3">
							<summary className="cursor-pointer text-sm font-semibold text-danger">Cancel this appointment</summary>
							<Form method="post" className="mt-3 flex flex-col gap-3">
								<input type="hidden" name="intent" value="cancelled" />
								<Field label="Reason (optional)" name="reason" />
								<Button type="submit" variant="danger" className="self-start">Cancel appointment</Button>
							</Form>
						</details>
					) : null}
				</Card>
			) : null}

			<details>
				<summary className="cursor-pointer px-0.5 text-sm font-semibold text-ink-soft">History</summary>
				<ol className="mt-2 flex flex-col rounded-card bg-card shadow-card">
					{a.history.map((h) => (
						<li key={h.id} className="flex items-center justify-between border-b border-hairline px-4 py-2 text-sm last:border-b-0">
							<span>{STATUS_LABEL[h.toStatus]}{h.reason ? <span className="text-ink-soft"> · {h.reason}</span> : null}</span>
							<span className="text-xs text-ink-soft">{formatDate(h.createdAt, tz)} {formatTime(h.createdAt, tz)}</span>
						</li>
					))}
				</ol>
			</details>
			<div className="hidden"><Avatar name={a.customerName} /></div>
		</Page>
	);
}
