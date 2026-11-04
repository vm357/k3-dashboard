import { Form, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/clients";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Avatar, ButtonLink, EmptyState, PageTitle } from "../../components/ui";
import { AllergyFlag, ClientTag } from "../../components/client-tags";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { findDuplicates } from "../../../server/domain/customers/merge";
import { CLIENT_FILTERS, type ClientFilter, fullName, listCustomers } from "../../../server/domain/customers/service";
import { dueForVisit } from "../../../server/domain/reports/service";
import { DueList } from "../../components/due-list";
import { formatPhone } from "../../lib/format";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Clients · K3 Dashboard" }];
}

const PAGE_SIZE = 10;
const FILTER_LABEL: Record<ClientFilter, string> = { all: "All", vip: "VIP", new: "New", inactive: "Inactive", do_not_book: "Do not book", archived: "Archived" };

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "customers.view")) throw new Response("Forbidden", { status: 403 });
	const sp = new URL(request.url).searchParams;
	const q = sp.get("q") ?? "";
	const filter = (CLIENT_FILTERS as readonly string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as ClientFilter) : "all";
	const sort = sp.get("sort") === "last" ? "last" : "first";
	const page = Math.max(1, Number(sp.get("page")) || 1);
	const canEdit = hasPermission(ctx.role, [...ctx.permissions], "customers.edit");
	const plain = !q && filter === "all" && page === 1;
	const [rows, due, dupes] = await Promise.all([
		listCustomers(db, ctx, { query: q, filter, sort, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
		plain ? dueForVisit(db, ctx, new Date(), 5) : [],
		plain && canEdit ? findDuplicates(db, ctx).then((d) => d.length) : 0,
	]);
	return {
		clients: rows.slice(0, PAGE_SIZE),
		hasNext: rows.length > PAGE_SIZE,
		page,
		q,
		filter,
		sort,
		due: due.map((x) => ({ ...x, lastVisit: x.lastVisit.toISOString() })),
		dupes,
	};
}

export default function Clients({ loaderData: d }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canEdit = hasPermission(data.ctx.role, data.ctx.permissions, "customers.edit");
	const base = `/app/${data.ctx.businessSlug}/clients`;
	const tz = data.business.timeZone;
	const href = (patch: { status?: string; sort?: string; page?: number }) => {
		const sp = new URLSearchParams();
		if (d.q) sp.set("q", d.q);
		const status = patch.status ?? d.filter;
		const sort = patch.sort ?? d.sort;
		const page = patch.page ?? 1;
		if (status !== "all") sp.set("status", status);
		if (sort !== "first") sp.set("sort", sort);
		if (page > 1) sp.set("page", String(page));
		const s = sp.toString();
		return s ? `?${s}` : base;
	};

	return (
		<Page>
			<PageTitle title="Clients" />
			<div className="flex gap-2">
				<Form method="get" className="flex flex-1 gap-2">
					{d.filter !== "all" ? <input type="hidden" name="status" value={d.filter} /> : null}
					{d.sort !== "first" ? <input type="hidden" name="sort" value={d.sort} /> : null}
					<input type="search" name="q" defaultValue={d.q} placeholder="Search name, phone or email" aria-label="Search clients" autoComplete="off" className="min-h-12 w-full rounded-pill border border-input-border bg-card px-4 text-base" />
				</Form>
				{canEdit ? <ButtonLink to={`${base}/new`}>Add</ButtonLink> : null}
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
					{CLIENT_FILTERS.map((f) => (
						<Link key={f} to={href({ status: f })} aria-pressed={d.filter === f} className={`press inline-flex min-h-9 items-center rounded-pill border px-3 text-sm font-semibold ${d.filter === f ? "border-feature bg-feature text-on-dark" : "border-input-border bg-card text-ink"}`}>{FILTER_LABEL[f]}</Link>
					))}
				</div>
				<Link to={href({ sort: d.sort === "first" ? "last" : "first" })} className="press inline-flex min-h-9 items-center rounded-pill px-2 text-sm font-semibold text-cta">Sort: {d.sort === "first" ? "First name" : "Last name"} A–Z</Link>
			</div>

			{d.dupes > 0 ? (
				<Link to={`${base}/duplicates`} className="press flex items-center justify-between rounded-card border border-input-border bg-card px-4 py-3 text-sm">
					<span><span className="font-semibold">{d.dupes} possible {d.dupes === 1 ? "duplicate" : "duplicates"}</span> <span className="text-ink-soft">· same phone, email or name</span></span>
					<span className="font-semibold text-cta">Review</span>
				</Link>
			) : null}

			{d.due.length > 0 ? <DueList due={d.due} base={`/app/${data.ctx.businessSlug}`} timeZone={tz} /> : null}

			{d.clients.length === 0 ? (
				d.q ? (
					<EmptyState title={`No one matches "${d.q}"`} body={d.filter === "all" ? "Try a different spelling, or add them as a new client." : `Nothing under ${FILTER_LABEL[d.filter]}. Try All.`} action={canEdit ? <ButtonLink to={`${base}/new`} size="sm">Add a client</ButtonLink> : undefined} />
				) : d.filter !== "all" ? (
					<EmptyState title={`No ${FILTER_LABEL[d.filter].toLowerCase()} clients`} body={d.filter === "archived" ? "Archived clients show up here." : "Set a status on a client's profile."} />
				) : (
					<EmptyState title="No clients yet" body="Clients are added here or created when you book their first appointment." action={canEdit ? <ButtonLink to={`${base}/new`} size="sm">Add your first client</ButtonLink> : undefined} />
				)
			) : (
				<>
					<ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
						{d.clients.map((c) => (
							<li key={c.id}>
								<Link to={`${base}/${c.id}`} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
									<Avatar name={fullName(c)} size={36} />
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="flex min-w-0 items-center gap-2">
											<span className="truncate text-sm font-semibold">{fullName(c)}</span>
											<ClientTag status={c.status} isNew={c.isNew} archived={!!c.archivedAt} />
											<AllergyFlag allergy={c.allergy} />
										</span>
										<span className="truncate text-xs text-ink-soft">{[c.phone === "hidden" ? null : formatPhone(c.phone), c.email === "hidden" ? null : c.email].filter(Boolean).join(" · ") || "No contact details"}</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
					{d.page > 1 || d.hasNext ? (
						<nav aria-label="Pages" className="flex items-center justify-between">
							{d.page > 1 ? <Link to={href({ page: d.page - 1 })} className="press inline-flex min-h-10 items-center rounded-pill border border-heading px-4 text-sm font-semibold text-heading">Previous</Link> : <span />}
							<span className="text-sm text-ink-soft">Page {d.page}</span>
							{d.hasNext ? <Link to={href({ page: d.page + 1 })} className="press inline-flex min-h-10 items-center rounded-pill border border-heading px-4 text-sm font-semibold text-heading">Next</Link> : <span />}
						</nav>
					) : null}
				</>
			)}
		</Page>
	);
}
