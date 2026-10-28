import { Form, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/clients";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Avatar, ButtonLink, EmptyState, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { fullName, listCustomers } from "../../../server/domain/customers/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Clients · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "customers.view")) throw new Response("Forbidden", { status: 403 });
	const q = new URL(request.url).searchParams.get("q") ?? "";
	const clients = await listCustomers(db, ctx, { query: q, limit: 100 });
	return { clients, q };
}

export default function Clients({ loaderData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canEdit = hasPermission(data.ctx.role, data.ctx.permissions, "customers.edit");
	const base = `/app/${data.ctx.businessSlug}/clients`;

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
									<span className="truncate text-xs text-ink-soft">{[c.phone, c.email].filter((v) => v && v !== "hidden").join(" · ") || "No contact details"}</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</Page>
	);
}
