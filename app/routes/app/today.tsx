import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/today";
import type { loader as layoutLoader } from "./business-layout";
import { IconCheck } from "../../components/icons";
import { Page } from "../../components/shell";
import { Card, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { getHours } from "../../../server/domain/businesses/hours";
import { listCustomers } from "../../../server/domain/customers/service";
import { listServices } from "../../../server/domain/services/service";
import { listEmployees } from "../../../server/domain/staff/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Today · K3 Dashboard" }];
}

/**
 * Today, Direction A. Until appointments exist (phase 3) the page is a setup
 * checklist built from real data, so a new owner always knows the next step.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const owner = ctx.role === "owner";
	const [svc, staff, hours, clients] = await Promise.all([
		hasPermission(ctx.role, [...ctx.permissions], "services.view") ? listServices(db, ctx) : { services: [] },
		hasPermission(ctx.role, [...ctx.permissions], "team.view") ? listEmployees(db, ctx) : [],
		owner ? getHours(db, ctx) : [],
		hasPermission(ctx.role, [...ctx.permissions], "customers.view") ? listCustomers(db, ctx, { limit: 1 }) : [],
	]);
	return {
		setup: owner
			? [
					{ key: "services", label: "Add your services", done: svc.services.length > 0, to: "services" },
					{ key: "staff", label: "Add yourself as bookable staff", done: staff.length > 0, to: "team" },
					{ key: "hours", label: "Set opening hours", done: hours.length > 0, to: "settings" },
					{ key: "clients", label: "Add your first client", done: clients.length > 0, to: "clients" },
				]
			: null,
	};
}

export default function Today({ loaderData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}`;
	const today = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: data.business.timeZone }).format(new Date());
	const first = data.user.name.split(" ")[0];
	const setup = loaderData.setup;
	const remaining = setup?.filter((s) => !s.done).length ?? 0;

	return (
		<Page>
			<PageTitle eyebrow={`Hi ${first}`} title="Today" aside={today} />
			<Card tone="feature" className="flex flex-col gap-2">
				<span className="text-sm text-on-dark-soft">Next up</span>
				<span className="text-2xl font-bold">No one yet</span>
				<span className="text-sm text-on-dark-soft">Appointments you add will show here, soonest first.</span>
			</Card>

			{setup ? (
				<Card className="flex flex-col gap-3">
					<div className="flex items-baseline justify-between">
						<h2 className="text-base font-bold">{remaining === 0 ? "You're set up" : "Get set up"}</h2>
						<span className="text-sm text-ink-soft">{setup.length - remaining} of {setup.length}</span>
					</div>
					<ol className="flex flex-col">
						{setup.map((s) => (
							<li key={s.key}>
								<Link to={`${base}/${s.to}`} className="flex min-h-12 items-center gap-3 border-b border-hairline text-sm last:border-b-0">
									<span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-full ${s.done ? "bg-cta text-on-dark" : "border border-input-border"}`}>
										{s.done ? <IconCheck width={14} height={14} /> : null}
									</span>
									<span className={s.done ? "text-ink-soft line-through" : "font-semibold"}>{s.label}</span>
								</Link>
							</li>
						))}
					</ol>
					{remaining === 0 ? <p className="text-sm text-ink-soft">The calendar and booking arrive in the next build.</p> : null}
				</Card>
			) : (
				<Card className="text-sm text-ink-soft">Nothing booked today. Your calendar arrives in the next build.</Card>
			)}
		</Page>
	);
}
