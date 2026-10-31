import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/reports";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Card, EmptyState, PageTitle } from "../../components/ui";
import { formatCents, formatDate } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { getBusiness } from "../../../server/domain/businesses/service";
import { buildReport, type Period } from "../../../server/domain/reports/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Reports · K3 Dashboard" }];
}

const PERIODS: { key: Period; label: string }[] = [
	{ key: "week", label: "This week" },
	{ key: "month", label: "This month" },
	{ key: "last30", label: "30 days" },
	{ key: "last90", label: "90 days" },
];

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "reports.view")) throw new Response("Forbidden", { status: 403 });
	const p = new URL(request.url).searchParams.get("period");
	const period: Period = PERIODS.some((x) => x.key === p) ? (p as Period) : "month";
	const biz = await getBusiness(db, ctx);
	const tz = biz?.timeZone ?? "America/New_York";
	const report = await buildReport(db, ctx, period, tz);
	return { report, timeZone: tz };
}

export default function Reports({ loaderData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}`;
	const r = loaderData.report;
	const tz = loaderData.timeZone;
	const maxDay = Math.max(1, ...r.byDay.map((x) => x.revenueCents));
	const multiStaff = r.byEmployee.length > 1;

	return (
		<Page>
			<PageTitle title="Reports" aside={`${formatDate(r.range.start + "T12:00:00Z", "UTC")} to ${formatDate(r.range.end + "T12:00:00Z", "UTC")}`} />
			<div role="tablist" aria-label="Period" className="flex gap-2 overflow-x-auto">
				{PERIODS.map((p) => (
					<Link key={p.key} to={`${base}/reports?period=${p.key}`} role="tab" aria-selected={r.period === p.key} className={`press shrink-0 rounded-pill border px-4 py-2 text-sm font-semibold ${r.period === p.key ? "border-cta bg-mint text-heading" : "border-input-border bg-card"}`}>
						{p.label}
					</Link>
				))}
			</div>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Stat label="Completed visits" value={String(r.totals.completed)} />
				<Stat label="Revenue" value={formatCents(r.totals.revenueCents)} hint="price of completed visits" />
				<Stat label="New clients" value={String(r.totals.newClients)} />
				<Stat label="No-shows" value={String(r.totals.noShows)} hint={`${r.totals.cancellations} cancelled`} tone={r.totals.noShows > 0 ? "warn" : undefined} />
			</div>

			{r.totals.completed === 0 ? (
				<EmptyState title="Nothing completed in this period" body="Revenue counts visits marked done. Check Today for visits still waiting to be closed out." />
			) : (
				<>
					<Card className="flex flex-col gap-3">
						<h2 className="text-base font-bold">By day</h2>
						<div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Revenue by day">
							{r.byDay.map((x) => (
								<div key={x.date} className="flex h-full flex-1 items-end" title={`${formatDate(x.date + "T12:00:00Z", "UTC")}: ${formatCents(x.revenueCents)} · ${x.completed} visits`}>
									<div className={`w-full rounded-t ${x.revenueCents > 0 ? "bg-cta" : "bg-hairline"}`} style={{ height: `${Math.max(3, (x.revenueCents / maxDay) * 100)}%` }} />
								</div>
							))}
						</div>
						<div className="flex justify-between text-xs text-ink-soft">
							<span>{formatDate(r.byDay[0].date + "T12:00:00Z", "UTC")}</span>
							<span>{formatDate(r.byDay[r.byDay.length - 1].date + "T12:00:00Z", "UTC")}</span>
						</div>
					</Card>

					<div className="grid gap-3 lg:grid-cols-2">
						<Card className="flex flex-col gap-2">
							<h2 className="text-base font-bold">By service</h2>
							<ul className="flex flex-col">
								{r.byService.map((s) => (
									<li key={s.serviceId} className="flex items-center justify-between border-b border-hairline py-2 text-sm last:border-b-0">
										<span>{s.name} <span className="text-ink-soft">· {s.count}</span></span>
										<span className="font-semibold">{formatCents(s.revenueCents)}</span>
									</li>
								))}
							</ul>
						</Card>
						{multiStaff ? (
							<Card className="flex flex-col gap-2">
								<h2 className="text-base font-bold">By staff</h2>
								<ul className="flex flex-col">
									{r.byEmployee.map((e) => (
										<li key={e.employeeId} className="flex items-center justify-between border-b border-hairline py-2 text-sm last:border-b-0">
											<span>{e.name} <span className="text-ink-soft">· {e.completed} visits</span></span>
											<span className="font-semibold">{formatCents(e.revenueCents)}</span>
										</li>
									))}
								</ul>
							</Card>
						) : null}
						<Card className="flex flex-col gap-2">
							<h2 className="text-base font-bold">Top clients</h2>
							<ul className="flex flex-col">
								{r.topClients.map((c) => (
									<li key={c.customerId}>
										<Link to={`${base}/clients/${c.customerId}`} className="flex items-center justify-between border-b border-hairline py-2 text-sm last:border-b-0">
											<span className="font-semibold text-heading">{c.name} <span className="font-normal text-ink-soft">· {c.visits} visits</span></span>
											<span className="font-semibold">{formatCents(c.revenueCents)}</span>
										</Link>
									</li>
								))}
							</ul>
						</Card>
					</div>
				</>
			)}
			<p className="px-0.5 text-xs text-ink-soft">Revenue is the price of visits marked done, in {tz.replace("_", " ")}. Collected payments are reported separately once payments are switched on.</p>
		</Page>
	);
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
	return (
		<Card className="flex flex-col gap-0.5">
			<span className={`text-2xl font-bold ${tone === "warn" ? "text-danger" : "text-heading"}`}>{value}</span>
			<span className="text-xs text-ink-soft">{label}</span>
			{hint ? <span className="text-[11px] text-ink-soft">{hint}</span> : null}
		</Card>
	);
}
