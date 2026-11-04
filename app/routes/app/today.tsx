import { Form, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/today";
import type { loader as layoutLoader } from "./business-layout";
import { IconCheck, IconPlus } from "../../components/icons";
import { Page } from "../../components/shell";
import { Badge, Button, ButtonLink, Card, PageTitle } from "../../components/ui";
import { AppointmentPanel } from "../../components/appointment-panel";
import { DueList } from "../../components/due-list";
import { loadAppointmentPanel } from "../../lib/appointment-panel.server";
import { STATUS_LABEL, formatDate, formatMinutes, formatTime, formatTimeRange, relativeStart } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { listDay } from "../../../server/domain/appointments/service";
import { getHours } from "../../../server/domain/businesses/hours";
import { getBusiness } from "../../../server/domain/businesses/service";
import { listCustomers } from "../../../server/domain/customers/service";
import { dueForVisit } from "../../../server/domain/reports/service";
import { formatLocalDate, localDateOf, zonedTimeToUtc } from "../../../server/domain/scheduling/time";
import { listServices } from "../../../server/domain/services/service";
import { listEmployees } from "../../../server/domain/staff/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Today · K3 Dashboard" }];
}

/**
 * Today, Direction A: the dark "next up" card, then the day's timeline with open
 * gaps rendered as bookable. The setup checklist stays until the salon is configured.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const p = [...ctx.permissions];
	const owner = ctx.role === "owner";
	const biz = await getBusiness(db, ctx);
	const tz = biz?.timeZone ?? "America/New_York";
	const now = new Date();
	const today = localDateOf(now, tz);
	const iso = formatLocalDate(today);

	const canSeeClients = hasPermission(ctx.role, p, "customers.view");
	const [svc, staff, hours, clients, day, due, panel] = await Promise.all([
		hasPermission(ctx.role, p, "services.view") ? listServices(db, ctx) : { services: [] },
		hasPermission(ctx.role, p, "team.view") ? listEmployees(db, ctx) : [],
		owner ? getHours(db, ctx) : [],
		canSeeClients ? listCustomers(db, ctx, { limit: 1 }) : [],
		hasPermission(ctx.role, p, "calendar.view_own") ? listDay(db, ctx, iso) : null,
		canSeeClients ? dueForVisit(db, ctx, now, 3) : [],
		loadAppointmentPanel(db, ctx, new URL(request.url)),
	]);

	const setup = owner
		? [
				{ key: "services", label: "Add your services", done: svc.services.length > 0, to: "services" },
				{ key: "staff", label: "Add yourself as bookable staff", done: staff.length > 0, to: "team" },
				{ key: "hours", label: "Set opening hours", done: hours.length > 0, to: "settings" },
				{ key: "clients", label: "Add your first client", done: clients.length > 0, to: "clients" },
			]
		: null;

	// Timeline: live appointments in order, with gaps of 30+ minutes inside today's hours marked bookable.
	const items = (day?.items ?? []).filter((i) => i.status !== "cancelled").map((i) => ({ ...i, startAt: i.startAt.toISOString(), serviceEndAt: i.serviceEndAt.toISOString(), endAt: i.endAt.toISOString() }));
	const live = items.filter((i) => i.status === "confirmed" || i.status === "checked_in");
	const next = live.find((i) => new Date(i.serviceEndAt).getTime() > now.getTime()) ?? null;
	// Visits whose time has passed but were never marked done, no-show or cancelled.
	const unfinished = live.filter((i) => new Date(i.serviceEndAt).getTime() <= now.getTime());
	const seen = items.filter((i) => i.status === "completed").length;
	const todaysHours = hours.find((h) => h.weekday === new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay()) ?? null;
	const gaps: { startAt: string; endAt: string }[] = [];
	if (todaysHours) {
		let cursor = Math.max(zonedTimeToUtc(today, todaysHours.opensAt, tz).getTime(), now.getTime());
		const close = zonedTimeToUtc(today, todaysHours.closesAt, tz).getTime();
		for (const i of live) {
			const s = new Date(i.startAt).getTime();
			if (s - cursor >= 30 * 60000) gaps.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(s).toISOString() });
			cursor = Math.max(cursor, new Date(i.endAt).getTime());
		}
		if (close - cursor >= 30 * 60000) gaps.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(close).toISOString() });
	}
	return {
		setup,
		items,
		next,
		gaps,
		unfinished: unfinished.map((i) => i.id),
		seen,
		timeZone: tz,
		now: now.toISOString(),
		count: items.length,
		closedToday: owner && hours.length > 0 && !todaysHours,
		due: due.map((x) => ({ ...x, lastVisit: x.lastVisit.toISOString() })),
		panel,
		multiStaff: new Set(items.map((i) => i.employeeId)).size > 1 || staff.length > 1,
	};
}

export default function Today({ loaderData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}`;
	const d = loaderData;
	const tz = d.timeZone;
	const now = new Date(d.now);
	const first = data.user.name.split(" ")[0];
	const remaining = d.setup?.filter((s) => !s.done).length ?? 0;
	const timeline = [
		...d.items.map((i) => ({ kind: "appt" as const, at: i.startAt, i })),
		...d.gaps.map((g) => ({ kind: "gap" as const, at: g.startAt, g })),
	].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

	return (
		<Page>
			<PageTitle eyebrow={`Hi ${first}`} title="Today" aside={formatDate(now, tz, "full")} />

			<Card tone="feature" className="flex flex-col gap-2.5">
				{d.next ? (
					<>
						<span className="text-sm text-on-dark-soft">{d.next.status === "checked_in" ? "In the chair" : `Next up · ${relativeStart(d.next.startAt, now) ?? formatTime(d.next.startAt, tz)}`}</span>
						<div className="flex flex-col gap-0.5">
							<span className="text-2xl font-bold">{d.next.customerName}</span>
							<span className="text-sm text-on-dark-soft">{formatTime(d.next.startAt, tz)} · {d.next.services.join(" + ")} · {formatMinutes(Math.round((new Date(d.next.serviceEndAt).getTime() - new Date(d.next.startAt).getTime()) / 60000))}</span>
						</div>
						<div className="mt-1 flex gap-2">
							{d.next.status === "checked_in" ? (
								<ButtonLink to={`?a=${d.next.id}`} variant="inverted" size="sm">Open</ButtonLink>
							) : (
								<Form method="post" action={`${base}/appointments/${d.next.id}`}>
									<input type="hidden" name="returnTo" value={base} />
									<Button type="submit" name="intent" value="checked_in" variant="inverted" size="sm">Check in</Button>
								</Form>
							)}
							<ButtonLink to={`${base}/clients/${d.next.customerId}`} variant="outlinedOnDark" size="sm">View client</ButtonLink>
						</div>
					</>
				) : (
					<>
						<span className="text-sm text-on-dark-soft">{d.unfinished.length > 0 ? "Wrap up" : "Next up"}</span>
						<span className="text-2xl font-bold">{d.unfinished.length > 0 ? `${d.unfinished.length} to mark done` : d.count > 0 ? "All done for today" : d.closedToday ? "Closed today" : "No one yet"}</span>
						<span className="text-sm text-on-dark-soft">{d.unfinished.length > 0 ? "Tap each visit below and mark it done or no-show." : d.count > 0 ? `${d.seen} ${d.seen === 1 ? "client" : "clients"} seen.` : "Book a walk-in or set up tomorrow."}</span>
					</>
				)}
			</Card>

			{d.setup && remaining > 0 ? (
				<Card className="flex flex-col gap-3">
					<div className="flex items-baseline justify-between">
						<h2 className="text-base font-bold">Get set up</h2>
						<span className="text-sm text-ink-soft">{d.setup.length - remaining} of {d.setup.length}</span>
					</div>
					<ol className="flex flex-col">
						{d.setup.map((s) => (
							<li key={s.key}>
								<Link to={`${base}/${s.to}`} className="flex min-h-12 items-center gap-3 border-b border-hairline text-sm last:border-b-0">
									<span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-full ${s.done ? "bg-cta text-on-dark" : "border border-input-border"}`}>{s.done ? <IconCheck width={14} height={14} /> : null}</span>
									<span className={s.done ? "text-ink-soft line-through" : "font-semibold"}>{s.label}</span>
								</Link>
							</li>
						))}
					</ol>
				</Card>
			) : null}

			{timeline.length > 0 ? (
				<ol aria-label="Today's schedule" className="flex flex-col gap-2">
					{timeline.map((t) =>
						t.kind === "appt" ? (
							<li key={t.i.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3">
								<span className={`pt-3.5 text-sm font-semibold ${t.i.id === d.next?.id ? "text-heading" : "text-ink-soft"}`}>{formatTime(t.i.startAt, tz)}</span>
								<Link to={`?a=${t.i.id}`} className={`press flex items-center gap-3 rounded-card bg-card px-3.5 py-3 shadow-card ${t.i.id === d.next?.id ? "border-2 border-cta" : ""} ${t.i.status === "completed" || t.i.status === "no_show" ? "opacity-60" : ""}`}>
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="truncate text-base font-semibold">{t.i.customerName}</span>
										<span className="truncate text-sm text-ink-soft">{t.i.services.join(" + ")} · {formatTimeRange(t.i.startAt, t.i.serviceEndAt, tz)}{d.multiStaff ? ` · ${t.i.employeeName}` : ""}</span>
									</span>
									{d.unfinished.includes(t.i.id) ? <Badge variant="danger">Mark done</Badge> : t.i.status !== "confirmed" ? <Badge variant={t.i.status === "completed" ? "green" : "neutral"}>{STATUS_LABEL[t.i.status]}</Badge> : null}
								</Link>
							</li>
						) : (
							<li key={t.g.startAt} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3">
								<span className="pt-3.5 text-sm font-semibold text-ink-soft">{formatTime(t.g.startAt, tz)}</span>
								<Link to={`${base}/book`} className="press flex items-center justify-between rounded-card border border-dashed border-input-border px-3.5 py-3 text-sm font-semibold text-cta">
									<span>Open until {formatTime(t.g.endAt, tz)}</span>
									<span>Book +</span>
								</Link>
							</li>
						),
					)}
				</ol>
			) : d.setup && remaining === 0 ? (
				<p className="px-0.5 text-sm text-ink-soft">Nothing booked today.</p>
			) : null}

			{d.due.length > 0 ? <DueList due={d.due} base={base} timeZone={tz} compact /> : null}

			<Link to={`${base}/book`} aria-label="New appointment" className="press fixed right-5 bottom-24 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-cta text-on-dark shadow-float lg:hidden">
				<IconPlus width={26} height={26} />
			</Link>
			{d.panel ? <AppointmentPanel key={d.panel.appt.id} panel={d.panel} base={base} /> : null}
		</Page>
	);
}
