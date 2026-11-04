import { Form, Link, redirect, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/client";
import type { loader as layoutLoader } from "./business-layout";
import { IconBack } from "../../components/icons";
import { Page } from "../../components/shell";
import { Avatar, Badge, Button, Card, Field, PageTitle } from "../../components/ui";
import { AllergyNotice, ClientTag, STATUS_OPTIONS } from "../../components/client-tags";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { addCustomerNote, archiveCustomer, customerInput, deleteCustomer, fullName, getCustomer, restoreCustomer, setCustomerStatus, updateCustomer } from "../../../server/domain/customers/service";
import { STATUS_LABEL, formatCents, formatDate, formatPhone, formatTime } from "../../lib/format";
import { listForCustomer } from "../../../server/domain/appointments/service";
import { addCredit, getCredit } from "../../../server/domain/payments/service";

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: `${loaderData?.client ? fullName(loaderData.client) : "Client"} · K3 Dashboard` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "customers.view")) throw new Response("Forbidden", { status: 403 });
	const client = await getCustomer(db, ctx, params.customerId!);
	if (!client) throw new Response("Not found", { status: 404 });
	const [visits, credit] = await Promise.all([listForCustomer(db, ctx, client.id), getCredit(db, ctx, client.id)]);
	const ser = (r: (typeof visits.upcoming)[number]) => ({ ...r, startAt: r.startAt.toISOString() });
	const sp = new URL(request.url).searchParams;
	return { client, visits: { upcoming: visits.upcoming.map(ser), past: visits.past.map(ser), lifetimeCents: visits.lifetimeCents }, askArchive: sp.get("archive") === "1", askDelete: sp.get("delete") === "1" && ctx.role === "owner", credit };
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
		const here = `/app/${params.business}/clients/${params.customerId}`;
		if (intent === "credit-add" || intent === "credit-remove") {
			const cents = Math.round(Number(String(form.get("amount") ?? "").replace(/[^\d.]/g, "") || 0) * 100);
			if (!cents) return { errors: { credit: "Enter an amount." }, saved: undefined };
			try {
				await addCredit(db, ctx, params.customerId!, { amountCents: intent === "credit-add" ? cents : -cents, reason: String(form.get("reason") ?? "") });
			} catch (err) {
				const e = err as { status?: number; code?: string; message?: string };
				if (e.status === 403) throw err;
				return { errors: { credit: e.code === "credit_negative" ? `Can't remove more than they have. ${e.message}.` : "Could not save. Try again." }, saved: undefined };
			}
			return { errors: {}, saved: "credit" as const };
		}
		if (intent === "status") {
			await setCustomerStatus(db, ctx, params.customerId!, String(form.get("status")));
			return { errors: {}, saved: "status" as const };
		}
		if (intent === "archive") {
			await archiveCustomer(db, ctx, params.customerId!);
			throw redirect(here);
		}
		if (intent === "restore") {
			await restoreCustomer(db, ctx, params.customerId!);
			throw redirect(here);
		}
		if (intent === "delete") {
			const r = await deleteCustomer(db, ctx, params.customerId!);
			throw redirect(r.mode === "deleted" ? `/app/${params.business}/clients?status=archived` : here);
		}
		const parsed = customerInput.safeParse({
			firstName: form.get("firstName"),
			lastName: form.get("lastName") ?? "",
			email: form.get("email") ?? "",
			phone: form.get("phone") ?? "",
			pinnedNote: form.get("pinnedNote") ?? "",
			allergy: form.get("allergy") ?? "",
			marketingConsent: form.get("marketingConsent") === "on",
		});
		if (!parsed.success) {
			const e = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
			return { errors: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v?.[0]])) as Record<string, string | undefined>, saved: undefined };
		}
		await updateCustomer(db, ctx, params.customerId!, parsed.data);
		return { errors: {}, saved: "details" as const };
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "has_upcoming") return { errors: { archive: `Can't archive yet: ${e.message}. Cancel or move them first.` }, saved: undefined };
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
	const archived = !!c.archivedAt;
	const noBook = archived || c.status === "do_not_book";
	const isOwner = data.ctx.role === "owner";

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
					<span className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">Client since {since}<ClientTag status={c.status} isNew={c.isNew} archived={archived} /></span>
				</div>
			</div>

			{archived ? (
				<section className="flex flex-col gap-3 rounded-card border border-input-border bg-card p-4">
					<p className="text-sm"><span className="font-bold">Archived {formatDate(c.archivedAt!, tz)}.</span> Hidden from lists, search and booking. Visits are kept.</p>
					<div className="flex flex-wrap gap-2">
						{canEdit ? <Form method="post"><Button type="submit" name="intent" value="restore" size="sm">Restore client</Button></Form> : null}
						{isOwner && !loaderData.askDelete ? <Link to="?delete=1" className="press inline-flex min-h-10 items-center rounded-pill border border-danger px-4 text-sm font-semibold text-danger">Delete permanently</Link> : null}
					</div>
					{loaderData.askDelete ? (
						<Form method="post" className="flex flex-col gap-3 rounded-card border border-danger bg-[#fbeceb] p-3">
							<p className="text-sm font-bold text-danger">Delete {fullName(c)} for good?</p>
							<p className="text-sm">Their name, contact details, notes and allergy are erased and can't be brought back. {loaderData.visits.past.length > 0 ? "Past visits stay in your reports as \"Deleted client\"." : ""}</p>
							<div className="flex flex-wrap justify-end gap-2">
								<Link to="." className="press inline-flex min-h-10 items-center rounded-pill border border-heading bg-card px-4 text-sm font-semibold text-heading">Keep</Link>
								<button type="submit" name="intent" value="delete" className="press inline-flex min-h-10 items-center rounded-pill bg-danger px-4 text-sm font-semibold text-on-dark">Yes, delete</button>
							</div>
						</Form>
					) : null}
				</section>
			) : null}

			<AllergyNotice allergy={c.allergy} />

			<div className="grid grid-cols-3 gap-2.5">
				{noBook ? (
					<span title={archived ? "Restore the client to book" : "Marked Do not book"} className="flex flex-col items-center gap-1.5 rounded-card bg-card py-3 text-xs font-bold text-ink-soft/50 shadow-card">Book</span>
				) : (
					<Link to={`${base}/book?client=${c.id}`} className="press flex flex-col items-center gap-1.5 rounded-card bg-cta py-3 text-xs font-bold text-on-dark">
						Book
					</Link>
				)}
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
					<span className="text-xs font-bold text-heading">Preferences</span>
					<p className="text-sm leading-relaxed">{c.pinnedNote}</p>
				</section>
			) : null}

			{loaderData.visits.upcoming.length > 0 ? (
				<Card tone="feature" className="flex items-center justify-between gap-3">
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-on-dark-soft">Upcoming</span>
						<span className="text-base font-bold">{formatDate(loaderData.visits.upcoming[0].startAt, tz, "full")} · {formatTime(loaderData.visits.upcoming[0].startAt, tz)}</span>
						<span className="text-sm text-on-dark-soft">{loaderData.visits.upcoming[0].services.join(" + ")} · {formatCents(loaderData.visits.upcoming[0].priceCents)}</span>
					</div>
					<Link to={`${base}/appointments/${loaderData.visits.upcoming[0].id}`} className="press rounded-pill border border-on-dark px-4 py-2 text-sm font-semibold">Open</Link>
				</Card>
			) : (
				<Card tone="feature" className="flex items-center justify-between gap-3">
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-on-dark-soft">Upcoming</span>
						<span className="text-base font-bold">Nothing booked</span>
					</div>
					{noBook ? null : <Link to={`${base}/book?client=${c.id}`} className="press rounded-pill bg-card px-4 py-2 text-sm font-semibold text-heading">Book</Link>}
				</Card>
			)}

			<Card className="flex flex-col gap-3">
				<div className="flex items-baseline justify-between">
					<h2 className="text-base font-bold">Credit</h2>
					<span className={`text-xl font-bold ${loaderData.credit.balanceCents > 0 ? "text-heading" : "text-ink-soft"}`}>{formatCents(loaderData.credit.balanceCents)}</span>
				</div>
				<p className="text-xs text-ink-soft">Gift cards, refunds as credit, prepaid visits. Used at checkout.</p>
				{canEdit && !archived ? (
					<Form method="post" className="flex flex-col gap-2">
						<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
							<Field label="Amount" name="amount" type="number" inputMode="decimal" min={0.01} step="0.01" placeholder="25.00" required />
							<Field label="Reason (optional)" name="reason" maxLength={80} placeholder="e.g. Gift card" />
						</div>
						{errors.credit ? <p role="alert" className="text-sm text-danger">{errors.credit}</p> : actionData?.saved === "credit" ? <p role="status" className="text-sm font-semibold text-heading">Saved</p> : null}
						<div className="flex flex-wrap gap-2">
							<Button type="submit" name="intent" value="credit-add" size="sm" variant="outlined">Add credit</Button>
							{loaderData.credit.balanceCents > 0 ? <Button type="submit" name="intent" value="credit-remove" size="sm" variant="quiet">Remove</Button> : null}
						</div>
					</Form>
				) : null}
				{loaderData.credit.entries.length > 0 ? (
					<details>
						<summary className="cursor-pointer text-sm font-semibold text-ink-soft">History</summary>
						<ol className="mt-2 flex flex-col">
							{loaderData.credit.entries.map((e) => (
								<li key={e.id} className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-sm last:border-b-0">
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{e.reason || (e.amountCents > 0 ? "Added" : "Removed")}</span>
										<span className="text-xs text-ink-soft">{formatDate(e.createdAt, tz)}{e.byName ? ` · ${e.byName}` : ""}</span>
									</span>
									<span className={`shrink-0 font-semibold ${e.amountCents > 0 ? "text-heading" : "text-ink"}`}>{e.amountCents > 0 ? "+" : "−"}{formatCents(Math.abs(e.amountCents))}</span>
								</li>
							))}
						</ol>
					</details>
				) : null}
			</Card>

			<Card className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<h2 className="text-base font-bold">Visit notes</h2>
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
							<span className="text-xs font-semibold text-ink-soft">{n.id === c.notes[0]?.id ? "Last visit · " : ""}{formatDate(n.createdAt, tz)}</span>
							<p className="text-sm leading-relaxed whitespace-pre-line">{n.body}</p>
						</li>
					))}
				</ol>
			</Card>

			<section className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between px-0.5">
					<h2 className="text-base font-bold">History</h2>
					<span className="text-sm text-ink-soft">{formatCents(loaderData.visits.lifetimeCents)} lifetime</span>
				</div>
				{loaderData.visits.past.length === 0 ? (
					<p className="px-0.5 text-sm text-ink-soft">No visits yet.</p>
				) : (
					<ol className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
						{loaderData.visits.past.map((v) => (
							<li key={v.id}>
								<Link to={`${base}/appointments/${v.id}`} className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
									<span className="flex min-w-0 flex-col gap-0.5">
										<span className="text-sm font-semibold">{formatDate(v.startAt, tz)}</span>
										<span className="truncate text-xs text-ink-soft">{v.services.join(" + ")}{v.status !== "completed" ? ` · ${STATUS_LABEL[v.status]}` : ""}</span>
									</span>
									<span className="text-sm font-semibold">{formatCents(v.priceCents)}</span>
								</Link>
							</li>
						))}
					</ol>
				)}
			</section>

			{canEdit && !archived ? (
				<Card className="flex flex-col gap-2">
					<div className="flex items-baseline justify-between">
						<h2 className="text-base font-bold">Status</h2>
						{actionData?.saved === "status" ? <span className="text-xs font-semibold text-heading">Saved</span> : null}
					</div>
					<Form method="post" role="group" aria-label="Client status" className="flex flex-wrap gap-1.5">
						<input type="hidden" name="intent" value="status" />
						{STATUS_OPTIONS.map((o) => {
							const on = c.status === o.value;
							const danger = o.value === "do_not_book";
							return <button key={o.value} type="submit" name="status" value={o.value} aria-pressed={on} className={`press inline-flex min-h-10 items-center rounded-pill border px-3.5 text-sm font-semibold ${on ? (danger ? "border-danger bg-danger text-on-dark" : "border-feature bg-feature text-on-dark") : "border-input-border bg-card text-ink"}`}>{o.label}</button>;
						})}
					</Form>
					{c.isNew && c.status === "active" ? <p className="text-xs text-ink-soft">Shows as New until their first visit is marked done.</p> : null}
				</Card>
			) : null}

			<details className="rounded-card bg-card shadow-card" open={loaderData.askArchive || !!errors.archive || undefined}>
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
						<label htmlFor="pinnedNote" className="text-sm font-semibold">Preferences</label>
						<textarea id="pinnedNote" name="pinnedNote" rows={3} defaultValue={c.pinnedNote ?? ""} disabled={!canEdit} className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
					</div>
					<Field label="Allergies" name="allergy" defaultValue={c.allergy ?? ""} disabled={!canEdit} hint="Shown as a red flag on bookings and the schedule." placeholder="e.g. acrylic monomer, latex" />
					<label className="flex min-h-11 items-center gap-3 text-sm">
						<input type="checkbox" name="marketingConsent" defaultChecked={c.marketingConsent} disabled={!canEdit} className="h-5 w-5 accent-[#00754a]" />
						Agreed to receive promotions
						{c.marketingConsent ? <Badge variant="green">Yes</Badge> : null}
					</label>
					{actionData?.saved === "details" ? <span className="text-sm font-semibold text-heading">Saved</span> : null}
					{canEdit ? <Button type="submit" size="sm" className="self-start">Save details</Button> : null}
				</Form>
				{canEdit && !archived ? (
					<div className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
						{errors.archive ? (
							<p role="alert" className="rounded-card border border-danger bg-[#fbeceb] px-3.5 py-3 text-sm text-danger">{errors.archive}</p>
						) : loaderData.askArchive ? (
							<Form method="post" className="flex flex-col gap-3 rounded-card border border-danger bg-[#fbeceb] p-3">
								<p className="text-sm font-bold text-danger">Archive {fullName(c)}?</p>
								<p className="text-sm">They'll be hidden from lists, search and booking. Visits and notes are kept, and you can restore them any time.</p>
								<div className="flex flex-wrap justify-end gap-2">
									<Link to="." className="press inline-flex min-h-10 items-center rounded-pill border border-heading bg-card px-4 text-sm font-semibold text-heading">Cancel</Link>
									<button type="submit" name="intent" value="archive" className="press inline-flex min-h-10 items-center rounded-pill bg-danger px-4 text-sm font-semibold text-on-dark">Yes, archive</button>
								</div>
							</Form>
						) : (
							<Link to="?archive=1" className="press inline-flex min-h-11 items-center gap-2 self-start rounded-pill border-[1.5px] border-danger px-5 text-sm font-bold text-danger hover:bg-[#fbeceb]">Archive client</Link>
						)}
					</div>
				) : null}
			</details>
		</Page>
	);
}
