import { Form, Link, redirect, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/waitlist-new";
import type { loader as layoutLoader } from "./business-layout";
import { Sheet } from "../../components/sheet";
import { Avatar, Button, Field } from "../../components/ui";
import { ClientTag } from "../../components/client-tags";
import { formatPhone } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { fullName, listCustomers } from "../../../server/domain/customers/service";
import { listEmployees } from "../../../server/domain/staff/service";
import { addToWaitlist, removeFromWaitlist } from "../../../server/domain/waitlist/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Add to waitlist · K3 Dashboard" }];
}

/** Same pattern as the booking sheet: ?q= to search, ?client= once picked, then one POST. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "appointments.manage_own")) throw new Response("Forbidden", { status: 403 });
	const sp = new URL(request.url).searchParams;
	const q = sp.get("q") ?? "";
	const clientId = sp.get("client");
	const [matches, picked, staff] = await Promise.all([
		!clientId && q ? listCustomers(db, ctx, { query: q, limit: 8 }) : [],
		clientId ? listCustomers(db, ctx, { limit: 200 }).then((r) => r.find((c) => c.id === clientId) ?? null) : null,
		hasPermission(ctx.role, [...ctx.permissions], "team.view") ? listEmployees(db, ctx) : [],
	]);
	return { q, matches, client: picked, staff: staff.map((e) => ({ id: e.id, displayName: e.displayName })) };
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const back = `/app/${params.business}`;
	try {
		if (form.get("intent") === "remove") {
			await removeFromWaitlist(db, ctx, String(form.get("id")));
			throw redirect(back);
		}
		await addToWaitlist(db, ctx, { customerId: String(form.get("client")), preferredDate: String(form.get("date") ?? ""), employeeId: String(form.get("employee") ?? ""), note: String(form.get("note") ?? "") });
		throw redirect(back);
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		return { error: e.code === "do_not_book" || e.code === "customer_archived" ? e.message : "Could not add them. Try again." };
	}
}

export default function WaitlistNew({ loaderData: d, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}`;
	return (
		<Sheet title="Add to waitlist" closeTo={base}>
			{actionData?.error ? <p role="alert" className="mb-3 rounded-card bg-card px-3.5 py-3 text-sm text-danger shadow-card">{actionData.error}</p> : null}
			{d.client ? (
				<Form method="post" className="flex flex-col gap-4">
					<input type="hidden" name="client" value={d.client.id} />
					<div className="flex items-center gap-3 rounded-card bg-card px-3 py-2.5 shadow-card">
						<Avatar name={fullName(d.client)} size={36} />
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{fullName(d.client)}</span><ClientTag status={d.client.status} isNew={d.client.isNew} /></span>
							<span className="truncate text-xs text-ink-soft">{d.client.phone && d.client.phone !== "hidden" ? formatPhone(d.client.phone) : ""}</span>
						</span>
						<Link to="?" className="text-xs font-semibold text-ink-soft">Change</Link>
					</div>
					<Field label="Day they want (optional)" name="date" type="date" hint="Leave empty for any day." />
					{d.staff.length > 1 ? (
						<div className="flex flex-col gap-1.5">
							<label htmlFor="employee" className="text-sm font-semibold">With (optional)</label>
							<select id="employee" name="employee" defaultValue="" className="min-h-12 rounded-input border border-input-border bg-card px-3 text-base">
								<option value="">Anyone</option>
								{d.staff.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
							</select>
						</div>
					) : null}
					<Field label="Note (optional)" name="note" maxLength={200} placeholder="e.g. Gel fill, after 3pm" />
					<Button type="submit" className="self-start">Add to waitlist</Button>
				</Form>
			) : (
				<div className="flex flex-col gap-2">
					<Form method="get" className="flex gap-2">
						<input type="search" name="q" defaultValue={d.q} placeholder="Name or phone" aria-label="Search clients" autoComplete="off" autoFocus className="min-h-12 w-full rounded-pill border border-input-border bg-card px-4 text-base" />
						<Button type="submit" variant="outlined">Find</Button>
					</Form>
					{d.matches.length > 0 ? (
						<ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
							{d.matches.map((c) => (
								<li key={c.id}>
									<Link to={`?client=${c.id}`} className="press flex items-center gap-3 border-b border-hairline px-3 py-2.5 last:border-b-0">
										<Avatar name={fullName(c)} size={32} />
										<span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold">{fullName(c)}</span><ClientTag status={c.status} isNew={c.isNew} /></span>
									</Link>
								</li>
							))}
						</ul>
					) : d.q ? <p className="text-sm text-ink-soft">No one matches "{d.q}". Add them as a client first.</p> : <p className="text-sm text-ink-soft">Find the client who wants a spot.</p>}
				</div>
			)}
		</Sheet>
	);
}
