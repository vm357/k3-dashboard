import { Form, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/calendar";
import type { loader as layoutLoader } from "./business-layout";
import { IconBack, IconPlus } from "../../components/icons";
import { Page } from "../../components/shell";
import { Badge, ButtonLink, EmptyState } from "../../components/ui";
import { AppointmentPanel } from "../../components/appointment-panel";
import { AllergyFlag } from "../../components/client-tags";
import { loadAppointmentPanel } from "../../lib/appointment-panel.server";
import { STATUS_LABEL, formatDate, formatTime, formatTimeRange } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { listDay } from "../../../server/domain/appointments/service";
import { getBusiness } from "../../../server/domain/businesses/service";
import { addDays, formatLocalDate, localDateOf, parseLocalDate } from "../../../server/domain/scheduling/time";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Calendar · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "calendar.view_own")) throw new Response("Forbidden", { status: 403 });
	const biz = await getBusiness(db, ctx);
	const tz = biz?.timeZone ?? "America/New_York";
	const today = localDateOf(new Date(), tz);
	const param = new URL(request.url).searchParams.get("date");
	const date = (param && parseLocalDate(param)) || today;
	const iso = formatLocalDate(date);
	const [day, panel] = await Promise.all([listDay(db, ctx, iso), loadAppointmentPanel(db, ctx, new URL(request.url))]);
	return {
		iso,
		isToday: iso === formatLocalDate(today),
		prev: formatLocalDate(addDays(date, -1)),
		next: formatLocalDate(addDays(date, 1)),
		timeZone: tz,
		label: formatDate(new Date(day.items[0]?.startAt ?? Date.UTC(date.year, date.month - 1, date.day, 12)), tz, "full"),
		items: day.items.map((i) => ({ ...i, startAt: i.startAt.toISOString(), serviceEndAt: i.serviceEndAt.toISOString(), endAt: i.endAt.toISOString() })),
		employees: day.employees,
		panel,
	};
}

export default function Calendar({ loaderData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}`;
	const d = loaderData;
	const tz = d.timeZone;
	const multi = d.employees.length > 1;

	return (
		<Page>
			<div className="flex items-center justify-between gap-2">
				<Link to={`${base}/calendar?date=${d.prev}`} aria-label="Previous day" className="press flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-card"><IconBack width={20} height={20} /></Link>
				<div className="flex flex-col items-center">
					<h1 className="text-xl font-bold text-heading">{d.isToday ? "Today" : d.label}</h1>
					{d.isToday ? <span className="text-xs text-ink-soft">{d.label}</span> : <Link to={`${base}/calendar`} className="text-xs font-semibold text-cta">Back to today</Link>}
				</div>
				<Link to={`${base}/calendar?date=${d.next}`} aria-label="Next day" className="press flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-card"><IconBack width={20} height={20} className="rotate-180" /></Link>
			</div>
			<Form method="get" className="flex justify-center">
				<input type="date" name="date" defaultValue={d.iso} onChange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Jump to date" className="min-h-10 rounded-pill border border-input-border bg-card px-3 text-sm" />
			</Form>

			{d.items.length === 0 ? (
				<EmptyState title="Nothing booked" body={d.isToday ? "A clear day. Add a walk-in or book ahead." : "Nothing on this day yet."} action={<ButtonLink to={`${base}/book`} size="sm">Book</ButtonLink>} />
			) : (
				<ol className="flex flex-col gap-2">
					{d.items.map((i) => {
						const done = i.status === "completed" || i.status === "cancelled" || i.status === "no_show";
						return (
							<li key={i.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3">
								<span className={`pt-3.5 text-sm font-semibold ${i.status === "checked_in" ? "text-heading" : "text-ink-soft"}`}>{formatTime(i.startAt, tz)}</span>
								<Link to={`?date=${d.iso}&a=${i.id}`} className={`press flex items-center gap-3 rounded-card bg-card px-3.5 py-3 shadow-card ${i.status === "checked_in" ? "border-2 border-cta" : ""} ${done ? "opacity-60" : ""}`}>
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="flex min-w-0 items-center gap-2"><span className="truncate text-base font-semibold">{i.customerName}</span><AllergyFlag allergy={i.allergy} /></span>
										<span className="truncate text-sm text-ink-soft">{i.services.join(" + ")} · {formatTimeRange(i.startAt, i.serviceEndAt, tz)}{multi ? ` · ${i.employeeName}` : ""}</span>
									</span>
									{i.status !== "confirmed" ? <Badge variant={i.status === "completed" ? "green" : "neutral"}>{STATUS_LABEL[i.status]}</Badge> : null}
								</Link>
							</li>
						);
					})}
				</ol>
			)}
			<Link to={`${base}/book`} aria-label="New appointment" className="press fixed right-5 bottom-24 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-cta text-on-dark shadow-float lg:hidden">
				<IconPlus width={26} height={26} />
			</Link>
			{d.panel ? <AppointmentPanel key={d.panel.appt.id} panel={d.panel} base={base} /> : null}
		</Page>
	);
}
