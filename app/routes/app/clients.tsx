import { Form, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/clients";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Avatar, ButtonLink, EmptyState, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { findDuplicates } from "../../../server/domain/customers/merge";
import { fullName, listCustomers } from "../../../server/domain/customers/service";
import { dueForVisit } from "../../../server/domain/reports/service";
import { DueList } from "../../components/due-list";
import { formatPhone } from "../../lib/format";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Clients · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "customers.view")) throw new Response("Forbidden", { status: 403 });
	const q = new URL(request.url).searchParams.get("q") ?? "";
	const canEdit = hasPermission(ctx.role, [...ctx.permissions], "customers.edit");
	const [clients, due, dupes] = await Promise.all([
		listCustomers(db, ctx, { query: q, limit: 100 }),
		q ? [] : dueForVisit(db, ctx, new Date(), 5),
		q || !canEdit ? 0 : findDuplicates(db, ctx).then((d) => d.length),
	]);
	return { clients, q, due: due.map((x) => ({ ...x, lastVisit: x.lastVisit.toISOString() })), dupes };
}

export default function Clients({ loaderData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canEdit = hasPermission(data.ctx.role, data.ctx.permissions, "customers.edit");
	const base = `/app/${data.ctx.businessSlug}/clients`;
	const tz = data.business.timeZone;

	return (
		<Page>
			<PageTitle title="Clients" aside={loaderData.q ? `${loaderData.clients.length} found` : `${loaderData.clients.length}`} />
			<div className="flex gap-2">
				<Form method="get" className="flex flex-1 gap-2">
					<input
						type="search"
						name="q"
						defaultValue={loaderData.q}
						placeholder="Search name, phone or email"
						aria-label="Search clients"
						autoComplete="off"
						className="min-h-12 w-full rounded-pill border border-input-border bg-card px-4 text-base"
					/>
				</Form>
				{canEdit ? <ButtonLink to={`${base}/new`}>Add</ButtonLink> : null}
			</div>

			{loaderData.dupes > 0 ? (
				<Link to={`${base}/duplicates`} className="press flex items-center justify-between rounded-card border border-input-border bg-card px-4 py-3 text-sm">
					<span><span className="font-semibold">{loaderData.dupes} possible {loaderData.dupes === 1 ? "duplicate" : "duplicates"}</span> <span className="text-ink-soft">· same phone, email or name</span></span>
					<span className="font-semibold text-cta">Review</span>
				</Link>
			) : null}

			{loaderData.due.length > 0 ? <DueList due={loaderData.due} base={`/app/${data.ctx.businessSlug}`} timeZone={tz} /> : null}

			{loaderData.clients.length === 0 ? (
				loaderData.q ? (
					<EmptyState title={`No one matches "${loaderData.q}"`} body="Try a different spelling, or add them as a new client." action={canEdit ? <ButtonLink to={`${base}/new`} size="sm">Add a client</ButtonLink> : undefined} />
				) : (
					<EmptyState title="No clients yet" body="Clients are added here or created when you book their first appointment." action={canEdit ? <ButtonLink to={`${base}/new`} size="sm">Add your first client</ButtonLink> : undefined} />
				)
			) : (
				<ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
					{loaderData.clients.map((c) => (
						<li key={c.id}>
							<Link to={`${base}/${c.id}`} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
								<Avatar name={fullName(c)} size={36} />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-semibold">{fullName(c)}</span>
									<span className="truncate text-xs text-ink-soft">{[c.phone === "hidden" ? null : formatPhone(c.phone), c.email === "hidden" ? null : c.email].filter(Boolean).join(" · ") || "No contact details"}</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</Page>
	);
}
