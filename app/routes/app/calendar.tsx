import { Form, Link, useLocation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/calendar";
import type { loader as layoutLoader } from "./business-layout";
import { IconBack, IconPlus } from "../../components/icons";
import { Page } from "../../components/shell";
import { Badge, ButtonLink, EmptyState } from "../../components/ui";
import { AppointmentPanel } from "../../components/appointment-panel";
import { AllergyFlag } from "../../components/client-tags";
import { loadAppointmentPanel } from "../../lib/appointment-panel.server";
import { STATUS_LABEL, formatTime, formatTimeRange } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { listDay } from "../../../server/domain/appointments/service";
import { getBusiness } from "../../../server/domain/businesses/service";
import { listRange } from "../../../server/domain/calendar/service";
import { listWaitlist } from "../../../server/domain/waitlist/service";
import { envContext } from "../../../server/context";
import { smsConfigured } from "../../../server/sms/send";
import { addDays, formatLocalDate, type LocalDate, localDateOf, parseLocalDate, weekdayOf } from "../../../server/domain/scheduling/time";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Calendar · K3 Dashboard" }];
}

type View = "day" | "week" | "month";
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Local dates carry no zone, so they are formatted as UTC calendar dates. */
const fmtLocal = (d: LocalDate | string, opts: Intl.DateTimeFormatOptions) => {
	const x = typeof d === "string" ? parseLocalDate(d)! : d;
	return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(x.year, x.month - 1, x.day, 12)));
};

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "calendar.view_own")) throw new Response("Forbidden", { status: 403 });
	const url = new URL(request.url);
	const biz = await getBusiness(db, ctx);
	const tz = biz?.timeZone ?? "America/New_York";
	const today = localDateOf(new Date(), tz);
	const v = url.searchParams.get("view");
	const view: View = v === "week" || v === "month" ? v : "day";
	const param = url.searchParams.get("date");
	const date = (param && parseLocalDate(param)) || today;
	const iso = formatLocalDate(date);

	let rangeStart = date;
	let length = 1;
	let prev = addDays(date, -1);
	let next = addDays(date, 1);
	if (view === "week") {
		rangeStart = addDays(date, -weekdayOf(date));
		length = 7;
		prev = addDays(date, -7);
		next = addDays(date, 7);
	} else if (view === "month") {
		const first = { year: date.year, month: date.month, day: 1 };
		const daysInMonth = new Date(Date.UTC(date.year, date.month, 0)).getUTCDate();
		rangeStart = addDays(first, -weekdayOf(first));
		length = Math.ceil((weekdayOf(first) + daysInMonth) / 7) * 7;
		prev = date.month === 1 ? { year: date.year - 1, month: 12, day: 1 } : { year: date.year, month: date.month - 1, day: 1 };
		next = date.month === 12 ? { year: date.year + 1, month: 1, day: 1 } : { year: date.year, month: date.month + 1, day: 1 };
	}
	const [day, range, panel, waitlist] = await Promise.all([
		view === "day" ? listDay(db, ctx, iso) : null,
		listRange(db, ctx, formatLocalDate(rangeStart), length),
		loadAppointmentPanel(db, ctx, url, { smsReady: smsConfigured(context.get(envContext)) }),
		view === "day" ? listWaitlist(db, ctx, { date: iso }) : [],
	]);
	return {
		view,
		iso,
		todayIso: formatLocalDate(today),
		maxIso: formatLocalDate(addDays(today, 365)),
		prev: formatLocalDate(prev),
		next: formatLocalDate(next),
		month: date.month,
		timeZone: tz,
		items: (day?.items ?? []).map((i) => ({ ...i, startAt: i.startAt.toISOString(), serviceEndAt: i.serviceEndAt.toISOString(), endAt: i.endAt.toISOString() })),
		days: range.days.map((d) => ({
			...d,
			items: d.items.map((i) => ({ ...i, startAt: i.startAt.toISOString(), serviceEndAt: i.serviceEndAt.toISOString() })),
			blocks: d.blocks.map((b) => ({ ...b, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString() })),
		})),
		multi: range.employees.length > 1,
		waitlist: waitlist.map((w) => ({ id: w.id, customerId: w.customerId, customerName: w.customerName, preferredDate: w.preferredDate, note: w.note })),
		panel,
	};
}

export default function Calendar({ loaderData: d }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const location = useLocation();
	const base = `/app/${data.ctx.businessSlug}`;
	const tz = d.timeZone;
	const q = (patch: { view?: View; date?: string; a?: string }) => {
		const sp = new URLSearchParams();
		const view = patch.view ?? d.view;
		if (view !== "day") sp.set("view", view);
		sp.set("date", patch.date ?? d.iso);
		if (patch.a) sp.set("a", patch.a);
		return `?${sp.toString()}`;
	};
	const isToday = d.iso === d.todayIso;
	const title =
		d.view === "day" ? (isToday ? "Today" : fmtLocal(d.iso, { weekday: "short", month: "short", day: "numeric" }))
		: d.view === "week" ? `${fmtLocal(d.days[0].iso, { month: "short", day: "numeric" })} – ${fmtLocal(d.days[6].iso, { month: d.days[0].month === d.days[6].month ? undefined : "short", day: "numeric" })}`
		: fmtLocal(d.iso, { month: "long", year: "numeric" });
	const blockLabel = (b: (typeof d.days)[number]["blocks"][number]) => `${b.employeeName ?? "Everyone"} · ${b.allDay ? "all day" : formatTimeRange(b.startAt, b.endAt, tz)}${b.reason ? ` · ${b.reason}` : ""}`;
	const today = d.days.find((x) => x.iso === d.iso);

	return (
		<Page>
			<div className="flex items-center justify-between gap-2">
				<Link to={q({ date: d.prev })} aria-label={`Previous ${d.view}`} className="press flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-card"><IconBack width={20} height={20} /></Link>
				<div className="flex flex-col items-center">
					<h1 className="text-xl font-bold text-heading">{title}</h1>
					{d.view === "day" && isToday ? <span className="text-xs text-ink-soft">{fmtLocal(d.iso, { weekday: "short", month: "short", day: "numeric" })}</span> : !isToday ? <Link to={q({ date: d.todayIso })} className="text-xs font-semibold text-cta">Back to today</Link> : null}
				</div>
				<Link to={q({ date: d.next })} aria-label={`Next ${d.view}`} className="press flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-card"><IconBack width={20} height={20} className="rotate-180" /></Link>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-2">
				<div role="group" aria-label="View" className="flex rounded-pill bg-card p-1 shadow-card">
					{(["day", "week", "month"] as const).map((v) => (
						<Link key={v} to={q({ view: v })} aria-pressed={d.view === v} className={`press inline-flex min-h-9 items-center rounded-pill px-4 text-sm font-semibold capitalize ${d.view === v ? "bg-feature text-on-dark" : "text-ink"}`}>{v}</Link>
					))}
				</div>
				<Form method="get" key={location.search}>
					{d.view !== "day" ? <input type="hidden" name="view" value={d.view} /> : null}
					<input type="date" name="date" defaultValue={d.iso} max={d.maxIso} onChange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Jump to date" className="min-h-10 rounded-pill border border-input-border bg-card px-3 text-sm" />
				</Form>
			</div>

			{d.view === "day" ? (
				<>
					{d.waitlist.length > 0 && !today?.closed ? (
						<section aria-label="Waitlist" className="flex flex-col gap-1.5 rounded-card border border-dashed border-cta bg-card px-4 py-3">
							<span className="text-sm font-bold text-heading">Waitlist · {d.waitlist.length} could take a spot</span>
							<ul className="flex flex-col">
								{d.waitlist.map((w) => (
									<li key={w.id} className="flex items-center justify-between gap-3 py-1">
										<span className="min-w-0 truncate text-sm"><span className="font-semibold">{w.customerName}</span><span className="text-ink-soft"> · {w.preferredDate ? "this day" : "any day"}{w.note ? ` · ${w.note}` : ""}</span></span>
										<Link to={`${base}/book?client=${w.customerId}&waitlist=${w.id}&date=${d.iso}`} className="press shrink-0 rounded-pill border border-input-border px-3 py-1 text-xs font-semibold text-heading">Book</Link>
									</li>
								))}
							</ul>
						</section>
					) : null}
					{today?.closed ? <p className="rounded-card bg-canvas-alt px-4 py-3 text-sm font-semibold">{today.closed.holiday ? `Closed · ${today.closed.label}` : "Closed"}</p> : null}
					{d.items.length === 0 && (today?.blocks.length ?? 0) === 0 ? (
						<EmptyState title="Nothing booked" body={today?.closed ? "The salon is closed this day." : isToday ? "A clear day. Add a walk-in or book ahead." : "Nothing on this day yet."} action={today?.closed ? undefined : <ButtonLink to={`${base}/book`} size="sm">Book</ButtonLink>} />
					) : (
						<ol className="flex flex-col gap-2">
							{[
								...d.items.map((i) => ({ kind: "appt" as const, at: i.startAt, i })),
								...(today?.blocks ?? []).map((b) => ({ kind: "block" as const, at: b.startAt, b })),
							]
								.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime())
								.map((row) =>
									row.kind === "block" ? (
										<li key={row.b.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3">
											<span className="pt-3 text-sm font-semibold text-ink-soft">{row.b.allDay ? "All day" : formatTime(row.b.startAt, tz)}</span>
											<div className="rounded-card border border-dashed border-input-border bg-canvas-alt px-3.5 py-2.5 text-sm"><span className="font-semibold">{row.b.kind === "time_off" ? "Time off" : row.b.kind === "break" ? "Break" : "Blocked"}</span> <span className="text-ink-soft">· {blockLabel(row.b)}</span></div>
										</li>
									) : (
										<li key={row.i.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3">
											<span className={`pt-3.5 text-sm font-semibold ${row.i.status === "checked_in" ? "text-heading" : "text-ink-soft"}`}>{formatTime(row.i.startAt, tz)}</span>
											<Link to={q({ a: row.i.id })} className={`press flex items-center gap-3 rounded-card bg-card px-3.5 py-3 shadow-card ${row.i.status === "checked_in" ? "border-2 border-cta" : ""} ${row.i.status === "completed" || row.i.status === "cancelled" || row.i.status === "no_show" ? "opacity-60" : ""}`}>
												<span className="flex min-w-0 flex-1 flex-col gap-0.5">
													<span className="flex min-w-0 items-center gap-2"><span className="truncate text-base font-semibold">{row.i.customerName}</span><AllergyFlag allergy={row.i.allergy} /></span>
													<span className="truncate text-sm text-ink-soft">{row.i.services.join(" + ")} · {formatTimeRange(row.i.startAt, row.i.serviceEndAt, tz)}{d.multi ? ` · ${row.i.employeeName}` : ""}</span>
												</span>
												{row.i.status !== "confirmed" ? <Badge variant={row.i.status === "completed" ? "green" : "neutral"}>{STATUS_LABEL[row.i.status]}</Badge> : null}
											</Link>
										</li>
									),
								)}
						</ol>
					)}
				</>
			) : d.view === "week" ? (
				<div className="grid gap-2 lg:grid-cols-7">
					{d.days.map((day) => (
						<section key={day.iso} aria-label={fmtLocal(day.iso, { weekday: "long", month: "short", day: "numeric" })} className={`flex min-w-0 flex-col gap-1.5 rounded-card p-2.5 ${day.closed ? "bg-canvas-alt" : "bg-card shadow-card"} ${day.iso === d.todayIso ? "ring-2 ring-cta" : ""}`}>
							<Link to={q({ view: "day", date: day.iso })} className="flex items-baseline justify-between gap-2">
								<span className="text-sm font-bold">{WD[day.weekday]} {day.day}</span>
								{day.items.length > 0 ? <span className="text-xs text-ink-soft">{day.items.length}</span> : null}
							</Link>
							{day.closed ? <span className="text-xs font-semibold text-ink-soft">{day.closed.label}</span> : null}
							{day.blocks.map((b) => <span key={b.id} className="truncate rounded-input border border-dashed border-input-border px-2 py-1 text-xs text-ink-soft">{blockLabel(b)}</span>)}
							{day.items.map((i) => (
								<Link key={i.id} to={q({ a: i.id })} className={`press flex min-w-0 flex-col rounded-input bg-canvas px-2 py-1.5 ${i.status === "completed" || i.status === "no_show" ? "opacity-60" : ""}`}>
									<span className="text-xs font-semibold text-heading">{formatTime(i.startAt, tz)}{d.multi ? ` · ${i.employeeName}` : ""}</span>
									<span className="truncate text-sm font-semibold">{i.customerName}</span>
								</Link>
							))}
							{!day.closed && day.items.length === 0 && day.blocks.length === 0 ? <span className="text-xs text-ink-soft">Open</span> : null}
						</section>
					))}
				</div>
			) : (
				<div className="flex flex-col gap-1">
					<div className="grid grid-cols-7 gap-1 px-0.5">{WD.map((w) => <span key={w} className="text-center text-xs font-semibold text-ink-soft">{w}</span>)}</div>
					<div className="grid grid-cols-7 gap-1">
						{d.days.map((day) => {
							const out = day.month !== d.month;
							return (
								<Link key={day.iso} to={q({ view: "day", date: day.iso })} aria-label={`${fmtLocal(day.iso, { weekday: "long", month: "long", day: "numeric" })}${day.closed ? `, ${day.closed.label}` : day.items.length ? `, ${day.items.length} booked` : ""}`} className={`press flex min-h-16 min-w-0 flex-col gap-1 rounded-input p-1.5 lg:min-h-24 ${day.closed ? "bg-canvas-alt" : "bg-card shadow-card"} ${out ? "opacity-50" : ""} ${day.iso === d.todayIso ? "ring-2 ring-cta" : ""}`}>
									<span className="text-sm font-bold">{day.day}</span>
									{day.closed ? (
										<span className="truncate text-[11px] font-semibold text-ink-soft">{day.closed.label}</span>
									) : day.items.length > 0 ? (
										<span className="self-start rounded-pill bg-mint px-1.5 text-[11px] font-bold text-heading">{day.items.length}<span className="hidden lg:inline"> booked</span></span>
									) : null}
									{day.blocks.length > 0 ? <span className="truncate text-[11px] text-ink-soft">Blocked</span> : null}
								</Link>
							);
						})}
					</div>
				</div>
			)}

			<Link to={`${base}/book`} aria-label="New appointment" className="press fixed right-5 bottom-24 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-cta text-on-dark shadow-float lg:hidden">
				<IconPlus width={26} height={26} />
			</Link>
			{d.panel ? <AppointmentPanel key={d.panel.appt.id} panel={d.panel} base={base} /> : null}
		</Page>
	);
}
