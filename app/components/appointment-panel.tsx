import { Form, Link, useLocation, useNavigation } from "react-router";
import type { AppointmentPanelData } from "../lib/appointment-panel.server";
import { IconCancel, IconClose, IconMove, IconNoShow } from "./icons";
import { Avatar, Badge, Field } from "./ui";
import { AllergyNotice, ClientTag } from "./client-tags";
import { STATUS_LABEL, formatCents, formatDate, formatMinutes, formatPhone, formatTime, formatTimeRange } from "../lib/format";

const PANEL_KEYS = ["a", "move", "with", "cancel", "err", "booked"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Appointment details in a panel on the right (full screen on phones), over Today or
 * Calendar. Replaces the old full appointment page. Actions post to the appointment
 * route, which redirects back here with the panel still open.
 */
export function AppointmentPanel({ panel, base }: { panel: AppointmentPanelData; base: string }) {
	const location = useLocation();
	const busy = useNavigation().state !== "idle";
	const a = panel.appt;
	const tz = a.timeZone;
	const here = location.pathname + location.search;

	const to = (patch: Record<string, string | null>) => {
		const sp = new URLSearchParams(location.search);
		for (const [k, v] of Object.entries(patch)) (v === null ? sp.delete(k) : sp.set(k, v));
		sp.delete("err");
		sp.delete("booked");
		const s = sp.toString();
		return { pathname: location.pathname, search: s ? `?${s}` : "" };
	};
	const closeTo = (() => {
		const sp = new URLSearchParams(location.search);
		for (const k of PANEL_KEYS) sp.delete(k);
		const s = sp.toString();
		return { pathname: location.pathname, search: s ? `?${s}` : "" };
	})();
	const actionUrl = `${base}/appointments/${a.id}`;
	const minutes = Math.round((new Date(a.serviceEndAt).getTime() - new Date(a.startAt).getTime()) / 60000);

	const booked = a.status === "confirmed";
	const primary = a.status === "checked_in" ? { intent: "completed", label: "Mark done" } : booked && panel.isToday ? { intent: "checked_in", label: "Check in" } : null;
	const canNoShow = a.allowedTransitions.includes("no_show") && (panel.isToday || a.status === "checked_in");
	const canMove = booked;
	const canCancel = a.allowedTransitions.includes("cancelled") && !panel.cancel;
	const pill = "press flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-pill px-2.5 text-sm font-semibold whitespace-nowrap";

	return (
		<div className="fixed inset-0 z-30 flex justify-end">
			<Link to={closeTo} aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-feature/40" />
			<aside role="dialog" aria-modal="true" aria-labelledby="appt-title" className="relative flex h-full w-full max-w-[440px] flex-col bg-canvas shadow-nav">
				<div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
					<div className="flex min-w-0 flex-col gap-1">
						<span className="text-sm text-ink-soft">{formatDate(a.startAt, tz, "full")} · {formatTimeRange(a.startAt, a.serviceEndAt, tz)}</span>
						<div className="flex flex-wrap items-center gap-2">
							<h2 id="appt-title" className="text-2xl font-bold text-heading">{a.customerName}</h2>
							{a.status !== "confirmed" ? <Badge variant={a.status === "completed" ? "green" : "neutral"}>{STATUS_LABEL[a.status]}</Badge> : null}
							<ClientTag status={a.clientStatus} />
						</div>
						<div aria-label="Staff member" className="mt-1 flex items-center gap-2">
							<Avatar name={a.employeeName} size={28} />
							<span className="text-sm">With <strong className="font-bold">{a.employeeName}</strong></span>
							<span className="text-sm text-ink-soft">· {formatMinutes(minutes)}</span>
						</div>
					</div>
					<Link to={closeTo} aria-label="Close" className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card shadow-card"><IconClose width={20} height={20} /></Link>
				</div>

				<div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-6">
					<AllergyNotice allergy={a.allergy} />
					{panel.booked ? <p role="status" className="rounded-card bg-mint px-4 py-3 text-sm font-semibold text-heading">Booked.</p> : null}
					{panel.err ? <p role="alert" className="rounded-card bg-card px-4 py-3 text-sm text-danger shadow-card">{panel.err === "taken" ? "That time is not available any more. Pick another." : "That did not work. Try again."}</p> : null}

					{primary || canNoShow || canMove || canCancel ? (
						<div className="flex flex-col gap-2 rounded-card bg-card p-3 shadow-card">
							{primary ? (
								<Form method="post" action={actionUrl}>
									<input type="hidden" name="returnTo" value={here} />
									<button type="submit" name="intent" value={primary.intent} disabled={busy} className="press min-h-12 w-full rounded-pill bg-cta text-base font-semibold text-on-dark disabled:opacity-50">{primary.label}</button>
								</Form>
							) : null}
							<div className="grid auto-cols-fr grid-flow-col gap-2">
								{canNoShow ? (
									<Form method="post" action={actionUrl} className="contents">
										<input type="hidden" name="returnTo" value={here} />
										<button type="submit" name="intent" value="no_show" disabled={busy} className={`${pill} bg-canvas text-ink`}><IconNoShow width={16} height={16} />No-show</button>
									</Form>
								) : null}
								{canMove ? <Link to={to({ move: panel.move ? null : "", with: null, cancel: null })} aria-pressed={!!panel.move} className={`${pill} ${panel.move ? "bg-feature text-on-dark" : "bg-canvas text-ink"}`}><IconMove width={16} height={16} />Move</Link> : null}
								{canCancel ? <Link to={to({ cancel: "1", move: null, with: null })} className={`${pill} bg-[#fbeceb] text-danger`}><IconCancel width={16} height={16} />Cancel</Link> : null}
							</div>
						</div>
					) : null}

					{panel.cancel ? (
						<Form method="post" action={actionUrl} className="flex flex-col gap-3 rounded-card border border-danger bg-card p-4">
							<input type="hidden" name="returnTo" value={here} />
							<p className="text-base font-bold">Cancel this appointment?</p>
							<Field label="Reason (optional)" name="reason" />
							<div className="flex flex-wrap justify-end gap-2">
								<Link to={to({ cancel: null })} className="press inline-flex min-h-10 items-center rounded-pill border border-heading px-4 text-sm font-semibold text-heading">Keep it</Link>
								<button type="submit" name="intent" value="cancelled" disabled={busy} className="press inline-flex min-h-10 items-center rounded-pill bg-danger px-4 text-sm font-semibold text-on-dark disabled:opacity-50">Cancel appointment</button>
							</div>
						</Form>
					) : null}

					{panel.move ? (
						<section aria-label="Move appointment" className="flex flex-col gap-3 rounded-card bg-card p-4 shadow-card">
							<div className="flex items-baseline justify-between">
								<h3 className="text-base font-bold">Move to</h3>
								<span className="text-xs text-ink-soft">{formatMinutes(Math.round((new Date(a.endAt).getTime() - new Date(a.startAt).getTime()) / 60000))} slot</span>
							</div>
							{panel.staff.length > 1 ? (
								<div className="flex flex-wrap gap-2" role="group" aria-label="Staff member">
									{panel.staff.map((e) => {
										const on = e.id === panel.move!.employeeId;
										return <Link key={e.id} to={to({ with: e.id === a.employeeId ? null : e.id })} aria-pressed={on} className={`press inline-flex min-h-10 items-center gap-2 rounded-pill border pr-3.5 pl-1.5 text-sm font-semibold ${on ? "border-cta bg-cta text-on-dark" : "border-input-border bg-card text-ink"}`}><Avatar name={e.displayName} size={26} onDark={on} />{e.displayName}</Link>;
									})}
								</div>
							) : null}
							<div className="grid grid-cols-7 gap-1.5">
								{panel.move.days.map((d) => {
									const on = d.iso === panel.move!.date;
									if (d.closed) return (
										<span key={d.iso} title={d.closed} className="flex flex-col items-center gap-0.5 rounded-card border border-dashed border-input-border bg-canvas-alt py-2 text-ink-soft">
											<span className="text-[11px] font-semibold">{WD[d.weekday]}</span>
											<span className="text-base font-bold line-through">{d.day}</span>
										</span>
									);
									return (
										<Link key={d.iso} to={to({ move: d.iso })} aria-pressed={on} className={`press flex flex-col items-center gap-0.5 rounded-card border py-2 ${on ? "border-feature bg-feature text-on-dark" : "border-input-border bg-card"}`}>
											<span className={`text-[11px] font-semibold ${on ? "text-on-dark-soft" : "text-ink-soft"}`}>{WD[d.weekday]}</span>
											<span className="text-base font-bold">{d.day}</span>
										</Link>
									);
								})}
							</div>
							{panel.move.starts.length === 0 ? (
								<p className="text-sm text-ink-soft">Nothing open that day{panel.staff.length > 1 ? " for this person" : ""}. Try another day.</p>
							) : (
								<Form method="post" action={actionUrl} className="grid grid-cols-4 gap-2">
									<input type="hidden" name="returnTo" value={here} />
									<input type="hidden" name="intent" value="reschedule" />
									<input type="hidden" name="employeeId" value={panel.move.employeeId} />
									{panel.move.starts.map((iso) => (
										<button key={iso} type="submit" name="at" value={iso} disabled={busy} className={`press min-h-11 rounded-pill border text-sm font-semibold ${iso === new Date(a.startAt).toISOString() && panel.move!.employeeId === a.employeeId ? "border-cta text-cta" : "border-input-border bg-card hover:border-cta"}`}>{formatTime(iso, tz)}</button>
									))}
								</Form>
							)}
						</section>
					) : null}

					<section className="flex items-center gap-3 rounded-card bg-card p-3 shadow-card">
						<Avatar name={a.customerName} size={40} />
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-semibold">{a.customerName}</span>
							{a.customerPhone ? <a href={`sms:${a.customerPhone}`} className="truncate text-sm text-cta">{formatPhone(a.customerPhone)}</a> : null}
						</div>
						<Link to={`${base}/clients/${a.customerId}`} className="press inline-flex min-h-10 items-center rounded-pill border border-heading px-4 text-sm font-semibold text-heading">View client</Link>
					</section>
					{a.pinnedNote ? (
						<section className="flex flex-col gap-1 rounded-card bg-mint px-4 py-3">
							<span className="text-xs font-bold text-heading">Preferences</span>
							<p className="text-sm leading-relaxed">{a.pinnedNote}</p>
						</section>
					) : null}

					<section className="flex flex-col gap-2 rounded-card bg-card p-4 shadow-card">
						<h3 className="text-base font-bold">Services</h3>
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
							<Badge>{a.paymentStatus === "unpaid" ? "Not paid" : (STATUS_LABEL[a.paymentStatus] ?? a.paymentStatus)}</Badge>
						</div>
						{a.depositDueCents > 0 ? <p className="text-xs text-ink-soft">{formatCents(a.depositDueCents)} deposit due.</p> : null}
						{a.note ? <p className="text-sm"><span className="font-semibold">Note:</span> {a.note}</p> : null}
					</section>

					<section className="flex flex-col gap-1">
						<h3 className="px-0.5 text-sm font-bold text-ink-soft">History</h3>
						<ol className="flex flex-col rounded-card bg-card shadow-card">
							{a.history.map((h) => (
								<li key={h.id} className="flex flex-col gap-0.5 border-b border-hairline px-4 py-2.5 text-sm last:border-b-0">
									<span>{STATUS_LABEL[h.toStatus]}{h.reason && !h.reason.startsWith("rescheduled from") ? <span className="text-ink-soft"> · {h.reason}</span> : h.reason ? <span className="text-ink-soft"> · moved</span> : null}</span>
									<span className="text-xs text-ink-soft">{formatDate(h.createdAt, tz)}, {formatTime(h.createdAt, tz)}{h.actorName ? ` · ${h.actorName}` : ""}</span>
								</li>
							))}
						</ol>
					</section>
				</div>
			</aside>
		</div>
	);
}
