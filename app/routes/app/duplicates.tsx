import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/duplicates";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Avatar, Button, Card, EmptyState, PageTitle } from "../../components/ui";
import { IconBack } from "../../components/icons";
import { formatDate, formatPhone } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { findDuplicates, mergeCustomers, type DuplicatePair } from "../../../server/domain/customers/merge";
import { DomainError } from "../../../server/domain/members/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Possible duplicates · K3 Dashboard" }];
}

const REASON: Record<DuplicatePair["reason"], string> = {
	same_phone: "Same phone number",
	same_email: "Same email",
	same_name: "Same name",
};

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "customers.edit")) throw new Response("Forbidden", { status: 403 });
	const pairs = await findDuplicates(db, ctx);
	return { pairs };
}

const mergeSchema = z.object({ keep: z.uuid(), from: z.uuid() });

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "customers.edit")) throw new Response("Forbidden", { status: 403 });
	const parsed = mergeSchema.safeParse(Object.fromEntries(await request.formData()));
	if (!parsed.success) return { error: "That pair is no longer available." };
	try {
		const r = await mergeCustomers(db, ctx, parsed.data.keep, parsed.data.from);
		return { merged: parsed.data.keep, moved: r.appointmentsMoved };
	} catch (e) {
		if (e instanceof DomainError) return { error: e.code === "customer_not_found" ? "One of those records was already merged." : e.message };
		throw e;
	}
}

export default function Duplicates({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}/clients`;
	const tz = data.business.timeZone;
	const nav = useNavigation();

	return (
		<Page>
			<Link to={base} className="-mb-2 flex items-center gap-1 text-sm font-semibold text-ink-soft">
				<IconBack width={18} height={18} /> Clients
			</Link>
			<PageTitle title="Possible duplicates" aside={loaderData.pairs.length ? `${loaderData.pairs.length}` : undefined} />
			<p className="text-sm text-ink-soft">
				Two records that look like the same person. Merging keeps one record and moves the other's visits and notes onto it. Nothing is deleted on its own, since a parent and a teenager can share a phone.
			</p>
			{actionData && "merged" in actionData ? (
				<p role="status" className="rounded-card bg-mint px-4 py-3 text-sm font-semibold text-heading">
					Merged. <Link to={`${base}/${actionData.merged}`} className="underline">Open the client</Link>
				</p>
			) : null}
			{actionData && "error" in actionData ? <p role="alert" className="text-sm font-semibold text-danger">{actionData.error}</p> : null}

			{loaderData.pairs.length === 0 ? (
				<EmptyState title="No duplicates found" body="Clients with the same phone, email or full name show up here." />
			) : (
				<ul className="flex flex-col gap-3">
					{loaderData.pairs.map((p) => {
						const key = `${p.a.id}:${p.b.id}`;
						const busy = nav.state !== "idle" && nav.formData?.get("from") && [p.a.id, p.b.id].includes(String(nav.formData.get("from")));
						return (
							<li key={key}>
								<Card className="flex flex-col gap-3">
									<span className="text-xs font-bold uppercase tracking-wide text-ink-soft">{REASON[p.reason]}</span>
									<div className="grid gap-3 sm:grid-cols-2">
										{[p.a, p.b].map((c, i) => {
											const other = i === 0 ? p.b : p.a;
											return (
												<div key={c.id} className="flex flex-col gap-3 rounded-card border border-hairline p-3">
													<div className="flex items-center gap-3">
														<Avatar name={[c.firstName, c.lastName].filter(Boolean).join(" ")} size={36} />
														<div className="flex min-w-0 flex-col">
															<Link to={`${base}/${c.id}`} className="truncate text-sm font-semibold text-heading">{[c.firstName, c.lastName].filter(Boolean).join(" ")}</Link>
															<span className="truncate text-xs text-ink-soft">{[c.phone ? formatPhone(c.phone) : null, c.email].filter(Boolean).join(" · ") || "No contact details"}</span>
														</div>
													</div>
													<span className="text-xs text-ink-soft">
														{c.visits} {c.visits === 1 ? "visit" : "visits"} · added {formatDate(c.createdAt, tz)}
													</span>
													<Form method="post">
														<input type="hidden" name="keep" value={c.id} />
														<input type="hidden" name="from" value={other.id} />
														<Button type="submit" variant="outlined" size="sm" disabled={!!busy} className="w-full">
															Keep this one
														</Button>
													</Form>
												</div>
											);
										})}
									</div>
								</Card>
							</li>
						);
					})}
				</ul>
			)}
		</Page>
	);
}
