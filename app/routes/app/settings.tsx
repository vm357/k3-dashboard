import { Form, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/settings";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Button, ButtonLink, Card, Field, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { getHours, getPolicy, policySchema, setHours, setPolicy } from "../../../server/domain/businesses/hours";
import { updateBusinessSettings } from "../../../server/domain/businesses/service";
import { addClosedDays, listClosedDays, removeClosedDay } from "../../../server/domain/calendar/service";
import { DEFAULT_REMINDER, REMINDER_PLACEHOLDERS, renderReminder } from "../../../server/domain/reminders/text";
import { WEEKDAYS } from "../../../server/domain/staff/service";

const fmtDay = (iso: string) => {
	const [y, m, d] = iso.split("-").map(Number);
	return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
};

export function meta(): Route.MetaDescriptors {
	return [{ title: "Settings · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "settings.view")) throw new Response("Forbidden", { status: 403 });
	const [hours, policy, closed] = await Promise.all([getHours(db, ctx), getPolicy(db, ctx), listClosedDays(db, ctx)]);
	return { hours, policy, closed };
}

const businessSchema = z.object({
	name: z.string().trim().min(2, "At least 2 characters").max(80),
	timeZone: z.string().min(1),
});

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const intent = form.get("intent");
	try {
		if (intent === "business") {
			const parsed = businessSchema.safeParse({ name: form.get("name"), timeZone: form.get("timeZone") });
			if (!parsed.success) {
				const e = z.flattenError(parsed.error).fieldErrors;
				return { saved: undefined, errors: { name: e.name?.[0], timeZone: e.timeZone?.[0] } };
			}
			await updateBusinessSettings(db, ctx, parsed.data);
			return { saved: "business" as const, errors: {} };
		}
		if (intent === "hours") {
			const rows: { weekday: number; opensAt: string; closesAt: string }[] = [];
			for (let d = 0; d < 7; d++) {
				if (form.get(`open-${d}`) !== "on") continue;
				rows.push({ weekday: d, opensAt: String(form.get(`opens-${d}`)), closesAt: String(form.get(`closes-${d}`)) });
			}
			await setHours(db, ctx, rows);
			return { saved: "hours" as const, errors: {} };
		}
		if (intent === "closed-add") {
			try {
				const r = await addClosedDays(db, ctx, { from: String(form.get("from") ?? ""), to: String(form.get("to") ?? ""), label: String(form.get("label") ?? "") });
				return { saved: "closed" as const, errors: {}, clashes: r.bookingsOnClosedDays };
			} catch (err) {
				const e = err as { status?: number; code?: string; message?: string };
				if (e.status === 403) throw err;
				return { saved: undefined, errors: { closed: e.code === "bad_range" ? e.message : "Pick a date." } };
			}
		}
		if (intent === "closed-remove") {
			await removeClosedDay(db, ctx, String(form.get("id")));
			return { saved: "closed" as const, errors: {} };
		}
		if (intent === "reminder") {
			const current = await getPolicy(db, ctx);
			const raw = String(form.get("reminderTemplate") ?? "").trim();
			await setPolicy(db, ctx, { ...current, reminderTemplate: raw === DEFAULT_REMINDER ? "" : raw });
			return { saved: "reminder" as const, errors: {} };
		}
		if (intent === "policy") {
			const parsed = policySchema.safeParse({
				slotIntervalMinutes: form.get("slotIntervalMinutes"),
				minNoticeMinutes: Number(form.get("minNoticeHours") || 0) * 60,
				maxAdvanceDays: form.get("maxAdvanceDays"),
				cancellationWindowHours: form.get("cancellationWindowHours"),
				cancellationNote: form.get("cancellationNote") ?? "",
				reminderTemplate: (await getPolicy(db, ctx)).reminderTemplate ?? "",
			});
			if (!parsed.success) return { saved: undefined, errors: { policy: "Check the numbers and try again." } };
			await setPolicy(db, ctx, parsed.data);
			return { saved: "policy" as const, errors: {} };
		}
		return { saved: undefined, errors: {} };
	} catch (err) {
		if ((err as { status?: number }).status === 403) throw new Response("Forbidden", { status: 403 });
		return { saved: undefined, errors: { timeZone: "Could not save. Check the values and try again." } };
	}
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const editable = hasPermission(data.ctx.role, data.ctx.permissions, "settings.edit");
	const canReport = hasPermission(data.ctx.role, data.ctx.permissions, "reports.view");
	const base = `/app/${data.ctx.businessSlug}`;
	const errors: Record<string, string | undefined> = actionData?.errors ?? {};
	const hoursByDay = new Map(loaderData.hours.map((h) => [h.weekday, h]));
	const p = loaderData.policy;

	return (
		<Page>
			<PageTitle title="Settings" />

			<div className="grid gap-3 sm:grid-cols-2">
				<Card className="flex items-center justify-between gap-3">
					<div className="flex flex-col">
						<h2 className="text-base font-bold">Services</h2>
						<span className="text-sm text-ink-soft">What you offer, prices, deposits.</span>
					</div>
					<ButtonLink to={`${base}/services`} variant="outlined" size="sm">Open</ButtonLink>
				</Card>
				<Card className="flex items-center justify-between gap-3">
					<div className="flex flex-col">
						<h2 className="text-base font-bold">Team</h2>
						<span className="text-sm text-ink-soft">Staff, their hours, and logins.</span>
					</div>
					<ButtonLink to={`${base}/team`} variant="outlined" size="sm">Open</ButtonLink>
				</Card>
				{canReport ? (
					<Card className="flex items-center justify-between gap-3">
						<div className="flex flex-col">
							<h2 className="text-base font-bold">Reports</h2>
							<span className="text-sm text-ink-soft">Visits, revenue, no-shows by week or month.</span>
						</div>
						<ButtonLink to={`${base}/reports`} variant="outlined" size="sm">Open</ButtonLink>
					</Card>
				) : null}
			</div>

			<Card className="flex flex-col gap-4">
				<h2 className="text-base font-bold">Business</h2>
				<Form method="post" className="flex flex-col gap-4">
					<input type="hidden" name="intent" value="business" />
					<Field label="Business name" name="name" defaultValue={data.business.name} disabled={!editable} error={errors.name} />
					<Field label="Time zone" name="timeZone" defaultValue={data.business.timeZone} disabled={!editable} hint="IANA name, for example America/New_York" error={errors.timeZone} />
					{actionData?.saved === "business" ? <p role="status" className="text-sm font-semibold text-heading">Saved</p> : null}
					{editable ? <Button type="submit" className="self-start">Save</Button> : <p className="text-sm text-ink-soft">Only the owner can change these.</p>}
				</Form>
			</Card>

			<Card className="flex flex-col gap-3">
				<h2 className="text-base font-bold">Opening hours</h2>
				<p className="text-sm text-ink-soft">When the business takes appointments. Each team member's own hours sit inside these.</p>
				<Form method="post" className="flex flex-col">
					<input type="hidden" name="intent" value="hours" />
					{WEEKDAYS.map((name, d) => {
						const h = hoursByDay.get(d);
						return (
							<div key={d} className="flex flex-col gap-2 border-b border-hairline py-2 last:border-b-0 sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
								<label className="flex min-h-10 items-center gap-3 text-sm font-semibold">
									<input type="checkbox" name={`open-${d}`} defaultChecked={!!h} disabled={!editable} className="h-5 w-5 accent-[#00754a]" />
									{name}
								</label>
								<div className="flex items-center gap-2 pl-8 sm:contents">
									<input type="time" name={`opens-${d}`} defaultValue={h?.opensAt ?? "09:00"} disabled={!editable} aria-label={`${name} opens`} className="min-h-11 min-w-0 flex-1 rounded-input border border-input-border bg-card px-2 text-sm sm:w-28 sm:flex-none" />
									<span className="text-sm text-ink-soft">to</span>
									<input type="time" name={`closes-${d}`} defaultValue={h?.closesAt ?? "17:00"} disabled={!editable} aria-label={`${name} closes`} className="min-h-11 min-w-0 flex-1 rounded-input border border-input-border bg-card px-2 text-sm sm:w-28 sm:flex-none" />
								</div>
							</div>
						);
					})}
					{actionData?.saved === "hours" ? <p role="status" className="mt-2 text-sm font-semibold text-heading">Saved</p> : null}
					{editable ? <Button type="submit" className="mt-3 self-start">Save hours</Button> : null}
				</Form>
			</Card>

			<Card className="flex flex-col gap-3">
				<h2 className="text-base font-bold">Closed days</h2>
				<p className="text-sm text-ink-soft">Holidays and days off for the whole salon. Nobody can be booked on them.</p>
				{loaderData.closed.length === 0 ? <p className="text-sm text-ink-soft">None coming up.</p> : (
					<ul className="flex flex-col">
						{loaderData.closed.map((c) => (
							<li key={c.id} className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
								<span className="flex min-w-0 flex-col">
									<span className="text-sm font-semibold">{c.label || "Closed"}</span>
									<span className="text-xs text-ink-soft">{fmtDay(c.from)}{c.to !== c.from ? ` to ${fmtDay(c.to)}` : ""}</span>
								</span>
								{editable ? (
									<Form method="post">
										<input type="hidden" name="intent" value="closed-remove" />
										<input type="hidden" name="id" value={c.id} />
										<Button type="submit" variant="quiet" size="sm">Remove</Button>
									</Form>
								) : null}
							</li>
						))}
					</ul>
				)}
				{editable ? (
					<Form method="post" className="flex flex-col gap-3 border-t border-hairline pt-3">
						<input type="hidden" name="intent" value="closed-add" />
						<div className="grid gap-3 sm:grid-cols-3">
							<Field label="First day" name="from" type="date" required />
							<Field label="Last day (optional)" name="to" type="date" />
							<Field label="Label" name="label" placeholder="e.g. Thanksgiving" maxLength={60} />
						</div>
						{errors.closed ? <p role="alert" className="text-sm text-danger">{errors.closed}</p> : null}
						{actionData?.saved === "closed" && "clashes" in actionData && actionData.clashes ? <p role="alert" className="text-sm text-danger">Saved. {actionData.clashes} {actionData.clashes === 1 ? "booking is" : "bookings are"} still on those days. Move or cancel {actionData.clashes === 1 ? "it" : "them"} from Calendar.</p> : actionData?.saved === "closed" ? <p role="status" className="text-sm font-semibold text-heading">Saved</p> : null}
						<Button type="submit" variant="outlined" className="self-start">Add closed day</Button>
					</Form>
				) : null}
			</Card>

			<Card className="flex flex-col gap-3">
				<h2 className="text-base font-bold">Reminder text</h2>
				<p className="text-sm text-ink-soft">Sent before each booking. These fill in automatically: {REMINDER_PLACEHOLDERS.map((k) => `{${k}}`).join(" ")}</p>
				<Form method="post" className="flex flex-col gap-3">
					<input type="hidden" name="intent" value="reminder" />
					<textarea name="reminderTemplate" rows={4} maxLength={320} defaultValue={p.reminderTemplate || DEFAULT_REMINDER} disabled={!editable} aria-label="Reminder text" className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
					<div className="flex flex-col gap-1 rounded-card bg-canvas px-3.5 py-3">
						<span className="text-xs font-bold text-ink-soft">Example</span>
						<p className="text-sm leading-relaxed">{renderReminder(p.reminderTemplate || DEFAULT_REMINDER, { first_name: "Maya", business: data.business.name, service: "Gel fill", date: "Tue, Nov 10", time: "10:30am", staff: data.user.name.split(" ")[0] })}</p>
					</div>
					{actionData?.saved === "reminder" ? <p role="status" className="text-sm font-semibold text-heading">Saved</p> : null}
					{editable ? <Button type="submit" variant="outlined" className="self-start">Save reminder text</Button> : null}
				</Form>
			</Card>

			<Card className="flex flex-col gap-4">
				<h2 className="text-base font-bold">Booking rules</h2>
				<Form method="post" className="flex flex-col gap-4">
					<input type="hidden" name="intent" value="policy" />
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Slot interval (minutes)" name="slotIntervalMinutes" type="number" inputMode="numeric" min={5} max={60} step={5} defaultValue={p.slotIntervalMinutes} disabled={!editable} hint="Start times are offered every N minutes" />
						<Field label="Minimum notice (hours)" name="minNoticeHours" type="number" inputMode="numeric" min={0} defaultValue={Math.round(p.minNoticeMinutes / 60)} disabled={!editable} />
						<Field label="Book up to (days ahead)" name="maxAdvanceDays" type="number" inputMode="numeric" min={1} max={365} defaultValue={p.maxAdvanceDays} disabled={!editable} />
						<Field label="Cancellation window (hours)" name="cancellationWindowHours" type="number" inputMode="numeric" min={0} defaultValue={p.cancellationWindowHours} disabled={!editable} hint="Cancellations inside this window keep the deposit" />
					</div>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="cancellationNote" className="text-sm font-semibold">Policy shown to clients (optional)</label>
						<textarea id="cancellationNote" name="cancellationNote" rows={2} defaultValue={p.cancellationNote ?? ""} disabled={!editable} className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
					</div>
					{errors.policy ? <p role="alert" className="text-sm text-danger">{errors.policy}</p> : null}
					{actionData?.saved === "policy" ? <p role="status" className="text-sm font-semibold text-heading">Saved</p> : null}
					{editable ? <Button type="submit" className="self-start">Save rules</Button> : null}
				</Form>
			</Card>

			<form method="post" action="/sign-out" className="lg:hidden">
				<Button type="submit" variant="quiet" className="w-full">Sign out</Button>
			</form>
		</Page>
	);
}
