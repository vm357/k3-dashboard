import { Form, Link, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/client";
import type { loader as layoutLoader } from "./business-layout";
import { IconBack } from "../../components/icons";
import { Page } from "../../components/shell";
import { Avatar, Badge, Button, Card, Field, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { addCustomerNote, customerInput, fullName, getCustomer, updateCustomer } from "../../../server/domain/customers/service";
import { formatDate, formatPhone } from "../../lib/format";

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `${loaderData?.client ? fullName(loaderData.client) : "Client"} · K3 Dashboard` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "customers.view")) throw new Response("Forbidden", { status: 403 });
	const client = await getCustomer(db, ctx, params.customerId!);
	if (!client) throw new Response("Not found", { status: 404 });
	return { client };
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const intent = form.get("intent");
	try {
		if (intent === "note") {
			await addCustomerNote(db, ctx, params.customerId!, String(form.get("body") ?? ""));
			return { errors: {}, saved: "note" as const };
		}
		const parsed = customerInput.safeParse({
			firstName: form.get("firstName"),
			lastName: form.get("lastName") ?? "",
			email: form.get("email") ?? "",
			phone: form.get("phone") ?? "",
			pinnedNote: form.get("pinnedNote") ?? "",
			marketingConsent: form.get("marketingConsent") === "on",
		});
		if (!parsed.success) {
			const e = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
			return { errors: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v?.[0]])) as Record<string, string | undefined>, saved: undefined };
		}
		await updateCustomer(db, ctx, params.customerId!, parsed.data);
		return { errors: {}, saved: "details" as const };
	} catch (err) {
		const e = err as { status?: number; code?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "customer_email_exists") return { errors: { email: "Another client has this email" }, saved: undefined };
		return { errors: { firstName: "Could not save. Try again." }, saved: undefined };
	}
}

export default function Client({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canEdit = hasPermission(data.ctx.role, data.ctx.permissions, "customers.edit");
	const canContact = hasPermission(data.ctx.role, data.ctx.permissions, "customers.view_contact");
	const base = `/app/${data.ctx.businessSlug}`;
	const c = loaderData.client;
	const errors: Record<string, string | undefined> = actionData?.errors ?? {};
	const tz = data.business.timeZone;
	const since = formatDate(c.createdAt, tz, "monthYear");

	return (
		<Page>
			<Link to={`${base}/clients`} className="-mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft">
				<IconBack width={18} height={18} />
				Clients
			</Link>
			<div className="flex items-center gap-3">
				<Avatar name={fullName(c)} size={56} />
				<div className="flex min-w-0 flex-col">
					<PageTitle title={fullName(c)} />
					<span className="text-sm text-ink-soft">Client since {since}</span>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-2.5">
				<Link to={`${base}/calendar`} className="press flex flex-col items-center gap-1.5 rounded-card bg-cta py-3 text-xs font-bold text-on-dark">
					Book
				</Link>
				{canContact && c.phone ? (
					<a href={`tel:${c.phone}`} className="press flex flex-col items-center gap-1.5 rounded-card bg-card py-3 text-xs font-bold text-heading shadow-card">Call</a>
				) : (
					<span className="flex flex-col items-center gap-1.5 rounded-card bg-card py-3 text-xs font-bold text-ink-soft/50 shadow-card">Call</span>
				)}
				{canContact && c.phone ? (
					<a href={`sms:${c.phone}`} className="press flex flex-col items-center gap-1.5 rounded-card bg-card py-3 text-xs font-bold text-heading shadow-card">Text</a>
				) : (
					<span className="flex flex-col items-center gap-1.5 rounded-card bg-card py-3 text-xs font-bold text-ink-soft/50 shadow-card">Text</span>
				)}
			</div>

			{c.pinnedNote ? (
				<section className="flex flex-col gap-1 rounded-card bg-mint px-4 py-3">
					<span className="text-xs font-bold text-heading">Always</span>
					<p className="text-sm leading-relaxed">{c.pinnedNote}</p>
				</section>
			) : null}

			<Card tone="feature" className="flex flex-col gap-1">
				<span className="text-xs text-on-dark-soft">Upcoming</span>
				<span className="text-base font-bold">Nothing booked</span>
				<span className="text-sm text-on-dark-soft">Appointments arrive in the next build.</span>
			</Card>

			<Card className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<h2 className="text-base font-bold">Notes</h2>
					{actionData?.saved === "note" ? <span className="text-xs font-semibold text-heading">Added</span> : null}
				</div>
				{canEdit ? (
					<Form method="post" className="flex flex-col gap-2">
						<input type="hidden" name="intent" value="note" />
						<textarea name="body" rows={2} required placeholder="What you did, what they liked, what to remember next time" className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
						<Button type="submit" size="sm" variant="outlined" className="self-start">Add note</Button>
					</Form>
				) : null}
				{c.notes.length === 0 ? <p className="text-sm text-ink-soft">No notes yet.</p> : null}
				<ol className="flex flex-col">
					{c.notes.map((n) => (
						<li key={n.id} className="flex flex-col gap-1 border-b border-hairline py-3 last:border-b-0">
							<span className="text-xs font-semibold text-ink-soft">{formatDate(n.createdAt, tz)}</span>
							<p className="text-sm leading-relaxed whitespace-pre-line">{n.body}</p>
						</li>
					))}
				</ol>
			</Card>

			<details className="rounded-card bg-card shadow-card">
				<summary className="cursor-pointer px-4 py-3 text-base font-bold">Details</summary>
				<Form method="post" className="flex flex-col gap-4 px-4 pb-4">
					<input type="hidden" name="intent" value="details" />
					<div className="grid grid-cols-2 gap-3">
						<Field label="First name" name="firstName" defaultValue={c.firstName} required disabled={!canEdit} error={errors.firstName} />
						<Field label="Last name" name="lastName" defaultValue={c.lastName ?? ""} disabled={!canEdit} error={errors.lastName} />
					</div>
					{canContact ? (
						<>
							<Field label="Phone" name="phone" type="tel" defaultValue={formatPhone(c.phone)} disabled={!canEdit} error={errors.phone} />
							<Field label="Email" name="email" type="email" defaultValue={c.email ?? ""} disabled={!canEdit} error={errors.email} />
						</>
					) : (
						<p className="text-sm text-ink-soft">Contact details are hidden for your role.</p>
					)}
					<div className="flex flex-col gap-1.5">
						<label htmlFor="pinnedNote" className="text-sm font-semibold">Always (pinned note)</label>
						<textarea id="pinnedNote" name="pinnedNote" rows={3} defaultValue={c.pinnedNote ?? ""} disabled={!canEdit} className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
					</div>
					<label className="flex min-h-11 items-center gap-3 text-sm">
						<input type="checkbox" name="marketingConsent" defaultChecked={c.marketingConsent} disabled={!canEdit} className="h-5 w-5 accent-[#00754a]" />
						Agreed to receive promotions
						{c.marketingConsent ? <Badge variant="green">Yes</Badge> : null}
					</label>
					{actionData?.saved === "details" ? <span className="text-sm font-semibold text-heading">Saved</span> : null}
					{canEdit ? <Button type="submit" size="sm" className="self-start">Save details</Button> : null}
				</Form>
			</details>
		</Page>
	);
}
