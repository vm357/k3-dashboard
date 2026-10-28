import { Form, Link, Outlet, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/services";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Badge, Button, ButtonLink, Card, EmptyState, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { createCategory, deleteCategory, formatCents, formatMinutes, listServices, setServiceActive } from "../../../server/domain/services/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Services · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "services.view")) throw new Response("Forbidden", { status: 403 });
	const catalog = await listServices(db, ctx, { includeInactive: true });
	return catalog;
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const intent = form.get("intent");
	try {
		if (intent === "toggle") await setServiceActive(db, ctx, String(form.get("serviceId")), form.get("active") === "true");
		else if (intent === "category.create") await createCategory(db, ctx, { name: String(form.get("name") ?? "") });
		else if (intent === "category.delete") await deleteCategory(db, ctx, String(form.get("categoryId")));
		return { error: undefined };
	} catch (err) {
		if ((err as { status?: number }).status === 403) throw new Response("Forbidden", { status: 403 });
		return { error: "That did not work. Check the form and try again." };
	}
}

export default function Services({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canManage = hasPermission(data.ctx.role, data.ctx.permissions, "services.manage");
	const base = `/app/${data.ctx.businessSlug}/services`;
	const groups = [
		...loaderData.categories.map((c) => ({ key: c.id, name: c.name, categoryId: c.id as string | null })),
		{ key: "none", name: loaderData.categories.length ? "Other" : "", categoryId: null },
	];
	const active = loaderData.services.filter((s) => s.active);
	const inactive = loaderData.services.filter((s) => !s.active);

	return (
		<Page>
			<PageTitle title="Services" aside={`${active.length} active`} />
			{canManage ? (
				<div className="flex flex-wrap gap-2">
					<ButtonLink to={`${base}/new`}>Add a service</ButtonLink>
					<Form method="post" className="flex gap-2">
						<input type="hidden" name="intent" value="category.create" />
						<input name="name" placeholder="New category" aria-label="New category name" required className="min-h-12 w-40 rounded-input border border-input-border bg-card px-3 text-sm" />
						<Button type="submit" variant="outlined">Add</Button>
					</Form>
				</div>
			) : null}
			{actionData?.error ? <p role="alert" className="text-sm text-danger">{actionData.error}</p> : null}

			{loaderData.services.length === 0 ? (
				<EmptyState
					title="No services yet"
					body="Add what you offer: name, how long it takes, and the price. Deposits and online booking come later."
					action={canManage ? <ButtonLink to={`${base}/new`} size="sm">Add your first service</ButtonLink> : undefined}
				/>
			) : (
				groups.map((g) => {
					const rows = active.filter((s) => s.categoryId === g.categoryId);
					if (rows.length === 0 && g.categoryId === null) return null;
					return (
						<section key={g.key} className="flex flex-col gap-2">
							{g.name ? (
								<div className="flex items-center justify-between px-0.5">
									<h2 className="text-base font-bold">{g.name}</h2>
									{canManage && g.categoryId ? (
										<Form method="post">
											<input type="hidden" name="intent" value="category.delete" />
											<input type="hidden" name="categoryId" value={g.categoryId} />
											<button type="submit" className="press text-xs font-semibold text-ink-soft">Remove category</button>
										</Form>
									) : null}
								</div>
							) : null}
							{rows.length === 0 ? (
								<p className="px-0.5 text-sm text-ink-soft">No services in this category.</p>
							) : (
								<ul className="flex flex-col gap-2">
									{rows.map((s) => (
										<li key={s.id}>
											<ServiceRow s={s} base={base} canManage={canManage} />
										</li>
									))}
								</ul>
							)}
						</section>
					);
				})
			)}

			{inactive.length > 0 ? (
				<details className="group">
					<summary className="cursor-pointer px-0.5 text-sm font-semibold text-ink-soft">
						{inactive.length} hidden {inactive.length === 1 ? "service" : "services"}
					</summary>
					<ul className="mt-2 flex flex-col gap-2">
						{inactive.map((s) => (
							<li key={s.id}>
								<ServiceRow s={s} base={base} canManage={canManage} />
							</li>
						))}
					</ul>
				</details>
			) : null}
			<Outlet />
		</Page>
	);
}

function ServiceRow({
	s,
	base,
	canManage,
}: {
	s: { id: string; name: string; durationMinutes: number; bufferAfterMinutes: number; priceCents: number; depositType: string; depositAmount: number; active: boolean; bookableOnline: boolean };
	base: string;
	canManage: boolean;
}) {
	const deposit = s.depositType === "fixed" ? `${formatCents(s.depositAmount)} deposit` : s.depositType === "percent" ? `${s.depositAmount}% deposit` : null;
	return (
		<Card className={`flex items-center gap-3 ${s.active ? "" : "opacity-60"}`}>
			<Link to={canManage ? `${base}/${s.id}` : "#"} className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-semibold">{s.name}</span>
				<span className="text-sm text-ink-soft">
					{formatMinutes(s.durationMinutes)}
					{s.bufferAfterMinutes ? ` + ${s.bufferAfterMinutes} min buffer` : ""} · {formatCents(s.priceCents)}
					{deposit ? ` · ${deposit}` : ""}
				</span>
			</Link>
			{!s.bookableOnline ? <Badge>In person only</Badge> : null}
			{canManage ? (
				<Form method="post">
					<input type="hidden" name="intent" value="toggle" />
					<input type="hidden" name="serviceId" value={s.id} />
					<input type="hidden" name="active" value={s.active ? "false" : "true"} />
					<Button type="submit" variant="quiet" size="sm">
						{s.active ? "Hide" : "Show"}
					</Button>
				</Form>
			) : null}
		</Card>
	);
}
