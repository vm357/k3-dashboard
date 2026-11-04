import { Form, Link, useLocation, useNavigation } from "react-router";
import type { AppointmentPanelData } from "../lib/appointment-panel.server";
import { IconCancel, IconClose, IconMove, IconNoShow } from "./icons";
import { Avatar, Badge, Field } from "./ui";
import { AllergyNotice, ClientTag } from "./client-tags";
import { VisitPhotos } from "./visit-photos";
import { STATUS_LABEL, formatCents, formatDate, formatMinutes, formatPhone, formatTime, formatTimeRange } from "../lib/format";

const PANEL_KEYS = ["a", "move", "with", "cancel", "remind", "pay", "err", "booked"];
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
	const showPay = panel.payment.canPay && !panel.payment.open && (a.status === "completed" || !primary);
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
					{panel.booked ? <p role="status" className="rounded-card bg-mint px-4 py-3 text-sm font-semibold text-heading">{panel.booked > 1 ? `Booked ${panel.booked} visits.` : "Booked."}</p> : null}
					{panel.err ? <p role="alert" className="rounded-card bg-card px-4 py-3 text-sm text-danger shadow-card">{panel.err === "taken" ? "That time is not available any more. Pick another." : panel.err === "sms" ? "The text did not go out. Try again, or send it from your phone." : "That did not work. Try again."}</p> : null}

					{primary || canNoShow || canMove || canCancel || showPay ? (
						<div className="flex flex-col gap-2 rounded-card bg-card p-3 shadow-card">
							{showPay ? (
								<Link to={to({ pay: "1", move: null, cancel: null, remind: null })} className="press flex min-h-12 w-full items-center justify-center rounded-pill bg-cta text-base font-semibold text-on-dark">Take payment · {formatCents(panel.payment.dueCents)}</Link>
							) : null}
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

					{panel.payment.open ? (
						<Form method="post" action={actionUrl} aria-label="Take payment" className="flex flex-col gap-3 rounded-card bg-card p-4 shadow-card">
							<input type="hidden" name="returnTo" value={here} />
							<input type="hidden" name="intent" value="checkout" />
							<div className="flex items-baseline justify-between">
								<h3 className="text-base font-bold">Take payment</h3>
								<span className="text-base font-bold">{formatCents(panel.payment.dueCents)}</span>
							</div>
							{panel.payment.creditCents > 0 ? (
								<label className="flex min-h-11 items-center gap-3 rounded-card bg-mint px-3 text-sm">
									<input type="checkbox" name="useCredit" defaultChecked className="h-5 w-5 accent-[#00754a]" />
									<span>Use credit · <span className="font-bold">{formatCents(Math.min(panel.payment.creditCents, panel.payment.dueCents))}</span> of {formatCents(panel.payment.creditCents)}</span>
								</label>
							) : null}
							<fieldset className="flex flex-col gap-1.5">
								<legend className="mb-1.5 text-sm font-semibold">Paid by</legend>
								<div className="grid grid-cols-2 gap-2">
									{(["card", "cash"] as const).map((m, i) => (
										<label key={m} className="press flex min-h-12 cursor-pointer items-center justify-center rounded-pill border border-input-border bg-card text-base font-semibold has-[:checked]:border-feature has-[:checked]:bg-feature has-[:checked]:text-on-dark">
											<input type="radio" name="method" value={m} defaultChecked={i === 0} className="sr-only" />
											{m === "card" ? "Card" : "Cash"}
										</label>
									))}
								</div>
							</fieldset>
							<Field label="Tip (optional)" name="tip" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" />
							<div className="flex flex-wrap justify-end gap-2">
								<Link to={to({ pay: null })} className="press inline-flex min-h-10 items-center rounded-pill border border-heading px-4 text-sm font-semibold text-heading">Not now</Link>
								<button type="submit" disabled={busy} className="press inline-flex min-h-10 items-center rounded-pill bg-cta px-5 text-sm font-semibold text-on-dark disabled:opacity-50">Record payment</button>
							</div>
							<p className="text-xs text-ink-soft">Take the card on your own machine, then record it here.</p>
						</Form>
					) : null}

					{panel.cancel ? (
						<Form method="post" action={actionUrl} className="flex flex-col gap-3 rounded-card border border-danger bg-card p-4">
							<input type="hidden" name="returnTo" value={here} />
							<p className="text-base font-bold">Cancel this appointment?</p>
							<Field label="Reason (optional)" name="reason" />
							{panel.series && panel.series.laterBooked > 0 ? (
								<label className="flex min-h-11 items-center gap-3 text-sm">
									<input type="checkbox" name="series" value="rest" className="h-5 w-5 accent-[#c82014]" />
									Also cancel the {panel.series.laterBooked} later {panel.series.laterBooked === 1 ? "visit" : "visits"} in this repeat
								</label>
							) : null}
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

					{panel.photos && (panel.photos.ids.length > 0 || panel.photos.canAdd) ? (
						<section aria-label="Nail photos" className="flex flex-col gap-2 rounded-card bg-card p-4 shadow-card">
							<h3 className="text-base font-bold">Photos</h3>
							{panel.err === "photo" ? <p role="alert" className="text-sm text-danger">That photo did not save. Use a JPEG, PNG, WebP or HEIC up to 10 MB.</p> : null}
							<VisitPhotos base={base} appointmentId={a.id} ids={panel.photos.ids} canAdd={panel.photos.canAdd} canDelete={panel.photos.canDelete} action={actionUrl} returnTo={here} label={`${a.customerName}'s visit`} />
						</section>
					) : null}

					{panel.series ? (
						<section aria-label="Repeat booking" className="flex flex-col gap-1.5 rounded-card bg-card p-4 shadow-card">
							<div className="flex items-baseline justify-between">
								<h3 className="text-base font-bold">Repeat booking</h3>
								<span className="text-xs text-ink-soft">{panel.series.position} of {panel.series.items.length}</span>
							</div>
							<ol className="flex flex-col">
								{panel.series.items.map((s) => (
									<li key={s.id}>
										<Link to={to({ a: s.id, move: null, cancel: null, remind: null })} aria-current={s.id === a.id || undefined} className={`flex items-center justify-between gap-3 border-b border-hairline py-2 text-sm last:border-b-0 ${s.id === a.id ? "font-bold text-heading" : ""}`}>
											<span className={s.status === "cancelled" ? "text-ink-soft line-through" : ""}>{formatDate(s.startAt, tz, "full")} · {formatTime(s.startAt, tz)}</span>
											{s.status !== "confirmed" ? <span className="text-xs text-ink-soft">{STATUS_LABEL[s.status]}</span> : null}
										</Link>
									</li>
								))}
							</ol>
						</section>
					) : null}

					{panel.reminder ? (
						<section aria-label="Reminder" className="flex flex-col gap-2.5 rounded-card bg-card p-4 shadow-card">
							<div className="flex items-center justify-between gap-2">
								<h3 className="text-base font-bold">Reminder</h3>
								<span className={`rounded-pill px-2.5 py-0.5 text-xs font-bold ${panel.reminder.status === "confirmed" ? "bg-mint text-heading" : panel.reminder.status === "declined" ? "bg-danger text-on-dark" : "bg-canvas-alt text-ink-soft"}`}>
									{panel.reminder.status === "confirmed" ? "Confirmed" : panel.reminder.status === "declined" ? "Said no" : panel.reminder.status === "sent" ? "No reply yet" : "Not sent"}
								</span>
							</div>
							{panel.reminder.sentAt ? <p className="text-xs text-ink-soft">Sent {formatDate(panel.reminder.sentAt, tz)}, {formatTime(panel.reminder.sentAt, tz)}{panel.reminder.repliedAt ? ` · answered ${formatDate(panel.reminder.repliedAt, tz)}, ${formatTime(panel.reminder.repliedAt, tz)}` : ""}</p> : null}
							{panel.reminder.status === "declined" ? <p className="text-sm">They can't make it. Move or cancel the booking.</p> : null}
							{panel.reminder.preview ? (
								<div className="flex flex-col gap-2.5">
									<p className="rounded-card bg-canvas px-3.5 py-3 text-sm leading-relaxed whitespace-pre-line">{panel.reminder.preview.body}</p>
									{!panel.reminder.preview.to ? <p className="text-sm text-danger">No phone number on file for this client.</p> : null}
									<div className="flex flex-wrap justify-end gap-2">
										<Link to={to({ remind: null })} className="press inline-flex min-h-10 items-center rounded-pill border border-heading px-4 text-sm font-semibold text-heading">Not now</Link>
										{panel.reminder.preview.to && panel.reminder.smsReady ? (
											<Form method="post" action={actionUrl}>
												<input type="hidden" name="returnTo" value={here} />
												<button type="submit" name="intent" value="remind-send" disabled={busy} className="press inline-flex min-h-10 items-center rounded-pill bg-cta px-4 text-sm font-semibold text-on-dark disabled:opacity-50">Send text</button>
											</Form>
										) : panel.reminder.preview.to ? (
											<>
												<a href={`sms:${panel.reminder.preview.to}?&body=${encodeURIComponent(panel.reminder.preview.body)}`} className="press inline-flex min-h-10 items-center rounded-pill border border-cta px-4 text-sm font-semibold text-cta">Open Messages</a>
												<Form method="post" action={actionUrl}>
													<input type="hidden" name="returnTo" value={here} />
													<button type="submit" name="intent" value="remind-sent" disabled={busy} className="press inline-flex min-h-10 items-center rounded-pill bg-cta px-4 text-sm font-semibold text-on-dark disabled:opacity-50">I sent it</button>
												</Form>
											</>
										) : null}
									</div>
									{!panel.reminder.smsReady && panel.reminder.preview.to ? <p className="text-xs text-ink-soft">Texts go out from your phone until automatic texting is set up.</p> : null}
								</div>
							) : panel.reminder.status !== "confirmed" ? (
								<div className="flex flex-wrap gap-2">
									<Link to={to({ remind: "1", move: null, cancel: null })} className="press inline-flex min-h-10 items-center rounded-pill border border-heading px-4 text-sm font-semibold text-heading">{panel.reminder.status === "not_sent" ? "Send reminder" : "Resend reminder"}</Link>
									<Form method="post" action={actionUrl}>
										<input type="hidden" name="returnTo" value={here} />
										<button type="submit" name="intent" value="remind-confirmed" disabled={busy} className="press inline-flex min-h-10 items-center rounded-pill border border-input-border px-4 text-sm font-semibold text-ink disabled:opacity-50">Mark confirmed</button>
									</Form>
									{panel.reminder.status !== "declined" ? (
										<Form method="post" action={actionUrl}>
											<input type="hidden" name="returnTo" value={here} />
											<button type="submit" name="intent" value="remind-declined" disabled={busy} className="press inline-flex min-h-10 items-center rounded-pill px-3 text-sm font-semibold text-danger disabled:opacity-50">They said no</button>
										</Form>
									) : null}
								</div>
							) : null}
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
						{panel.payment.items.length > 0 ? (
							<ul className="flex flex-col gap-1 border-t border-hairline pt-2">
								{panel.payment.items.map((p) => (
									<li key={p.id} className="flex items-center justify-between text-sm">
										<span>{p.method === "credit" ? "Credit" : p.method === "card" ? "Card" : "Cash"}{p.tipCents ? <span className="text-ink-soft"> · tip {formatCents(p.tipCents)}</span> : null}<span className="text-xs text-ink-soft"> · {formatTime(p.createdAt, tz)}{p.byName ? ` · ${p.byName}` : ""}</span></span>
										<span className="font-semibold">{formatCents(p.amountCents + p.tipCents)}</span>
									</li>
								))}
							</ul>
						) : null}
						<div className="flex items-center justify-between text-sm">
							<span className="text-ink-soft">Payment</span>
							<Badge variant={a.paymentStatus === "paid_in_full" ? "green" : "neutral"}>{a.paymentStatus === "unpaid" ? "Not paid" : a.paymentStatus === "paid_in_full" ? "Paid" : a.paymentStatus === "deposit_paid" ? "Deposit paid" : a.paymentStatus === "refunded" ? "Refunded" : "Part refunded"}</Badge>
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
