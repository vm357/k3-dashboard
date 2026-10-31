import { Form, Link, redirect, useLocation, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/book";
import type { loader as layoutLoader } from "./business-layout";
import { Sheet } from "../../components/sheet";
import { Avatar, Button, Field } from "../../components/ui";
import { IconCheck } from "../../components/icons";
import { formatCents, formatMinutes, formatPhone, formatTime } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { bookAppointment, listSlots } from "../../../server/domain/appointments/service";
import { fullName, listCustomers } from "../../../server/domain/customers/service";
import { addDays, formatLocalDate, localDateOf, parseLocalDate, weekdayOf } from "../../../server/domain/scheduling/time";
import { listServices } from "../../../server/domain/services/service";
import { getBusiness } from "../../../server/domain/businesses/service";
import { listEmployees } from "../../../server/domain/staff/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "New appointment · K3 Dashboard" }];
}

/**
 * The booking sheet (Direction A). Every choice is a query parameter, so each tap is
 * a GET and the sheet re-renders with the next section filled in:
 *   ?client=<id> | ?q=<search> | ?new=1  →  &svc=<id>&svc=<id>  →  &date=YYYY-MM-DD  →  &at=<ISO>
 * Booking itself is the one POST.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "appointments.manage_own")) throw new Response("Forbidden", { status: 403 });
	const url = new URL(request.url);
	const q = url.searchParams.get("q") ?? "";
	const clientId = url.searchParams.get("client");
	const newClient = url.searchParams.get("new") === "1";
	const svcIds = url.searchParams.getAll("svc");
	const dateParam = url.searchParams.get("date");
	const employeeParam = url.searchParams.get("employee");

	const [catalog, staff, business] = await Promise.all([listServices(db, ctx), listEmployees(db, ctx), getBusiness(db, ctx)]);
	const timeZone = business?.timeZone ?? "America/New_York";

	const client = clientId ? (await listCustomers(db, ctx, { limit: 200 })).find((c) => c.id === clientId) ?? null : null;
	const matches = !client && !newClient && q.length >= 1 ? await listCustomers(db, ctx, { query: q, limit: 8 }) : [];
	const employee = staff.find((e) => e.id === employeeParam) ?? staff[0] ?? null;

	const today = localDateOf(new Date(), timeZone);
	const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
	const date = dateParam ? parseLocalDate(dateParam) : null;

	let slots: { starts: Date[]; totalMinutes: number; priceCents: number; depositDueCents: number; timeZone: string } | null = null;
	if (employee && svcIds.length > 0 && date) {
		try {
			slots = await listSlots(db, ctx, { employeeId: employee.id, serviceIds: svcIds, date: formatLocalDate(date) });
		} catch {
			slots = null;
		}
	}
	return {
		q,
		client,
		newClient,
		matches,
		services: catalog.services,
		staff,
		employee,
		svcIds,
		days: days.map((d) => ({ iso: formatLocalDate(d), weekday: weekdayOf(d), day: d.day })),
		date: date ? formatLocalDate(date) : null,
		slots: slots ? { ...slots, starts: slots.starts.map((d) => d.toISOString()) } : null,
		timeZone,
	};
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const newCustomer = form.get("newFirstName")
		? { firstName: String(form.get("newFirstName")), lastName: String(form.get("newLastName") ?? ""), phone: String(form.get("newPhone") ?? ""), email: String(form.get("newEmail") ?? "") }
		: undefined;
	try {
		const appt = await bookAppointment(db, ctx, {
			employeeId: String(form.get("employeeId")),
			serviceIds: form.getAll("svc").map(String),
			startAt: String(form.get("at")),
			customerId: form.get("client") ? String(form.get("client")) : undefined,
			newCustomer,
			note: String(form.get("note") ?? ""),
		});
		throw redirect(`/app/${params.business}/appointments/${appt.id}?booked=1`);
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "slot_taken" || e.code === "slot_unavailable") return { error: "That time was just taken. Pick another." };
		if (e.code === "customer_required") return { error: "Pick a client or add a new one." };
		return { error: e.message?.startsWith("[") ? "Check the form and try again." : (e.message ?? "Could not book. Try again.") };
	}
}

export default function Book({ loaderData, actionData }: Route.ComponentProps) {
	const location = useLocation();
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const base = `/app/${data.ctx.businessSlug}`;
	const closeTo = `${base}`;
	const nav = useNavigation();
	const busy = nav.state !== "idle";
	const d = loaderData;
	const tz = d.timeZone;
	const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

	// Every tap is a link whose query string carries the whole state; no hydration needed.
	const href = (patch: { client?: string | null; new?: boolean; q?: string | null; svc?: string[]; date?: string | null; employee?: string | null }) => {
		const sp = new URLSearchParams();
		const client = patch.client === undefined ? d.client?.id ?? null : patch.client;
		const isNew = patch.new === undefined ? d.newClient : patch.new;
		const q = patch.q === undefined ? null : patch.q;
		const svc = patch.svc ?? d.svcIds;
		const date = patch.date === undefined ? d.date : patch.date;
		const employee = patch.employee === undefined ? d.employee?.id ?? null : patch.employee;
		if (client) sp.set("client", client);
		if (isNew) sp.set("new", "1");
		if (q) sp.set("q", q);
		for (const id of svc) sp.append("svc", id);
		if (date) sp.set("date", date);
		if (employee) sp.set("employee", employee);
		return { pathname: `${base}/book`, search: `?${sp.toString()}` };
	};
	const hidden = () => (
		<>
			{d.client ? <input type="hidden" name="client" value={d.client.id} /> : null}
			{d.newClient ? <input type="hidden" name="new" value="1" /> : null}
			{d.svcIds.map((id) => <input key={id} type="hidden" name="svc" value={id} />)}
			{d.date ? <input type="hidden" name="date" value={d.date} /> : null}
			{d.employee ? <input type="hidden" name="employee" value={d.employee.id} /> : null}
		</>
	);

	const chosenServices = d.services.filter((s) => d.svcIds.includes(s.id));
	const clientChosen = !!d.client || d.newClient;

	return (
		<Sheet
			key={location.search}
			title="New appointment"
			closeTo={closeTo}
			footer={
				d.slots && d.date ? (
					<Form method="post" className="flex items-center justify-between gap-3">
						<input type="hidden" name="employeeId" value={d.employee?.id ?? ""} />
						{d.client ? <input type="hidden" name="client" value={d.client.id} /> : null}
						{d.svcIds.map((id) => <input key={id} type="hidden" name="svc" value={id} />)}
						<input type="hidden" name="at" id="chosen-at" value="" />
						<div className="flex min-w-0 flex-col">
							<span className="text-base font-bold">{formatCents(d.slots.priceCents)} · {formatMinutes(d.slots.totalMinutes)}</span>
							<span className="truncate text-xs text-ink-soft">{d.slots.depositDueCents > 0 ? `${formatCents(d.slots.depositDueCents)} deposit due` : "No deposit"}</span>
						</div>
						<span className="text-xs text-ink-soft">Pick a time above</span>
					</Form>
				) : (
					<p className="text-center text-sm text-ink-soft">
						{!clientChosen ? "Start with the client" : d.svcIds.length === 0 ? "Then pick services" : !d.date ? "Then a day" : "Then a time"}
					</p>
				)
			}
		>
			{actionData?.error ? <p role="alert" className="mb-3 rounded-card bg-card px-3.5 py-3 text-sm text-danger shadow-card">{actionData.error}</p> : null}

			{/* 1. Client */}
			<section className="mb-5 flex flex-col gap-2">
				<h2 className="text-sm font-bold">Client</h2>
				{d.client ? (
					<div className="flex items-center gap-3 rounded-card bg-card px-3 py-2.5 shadow-card">
						<Avatar name={fullName(d.client)} size={36} />
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-semibold">{fullName(d.client)}</span>
							<span className="truncate text-xs text-ink-soft">{d.client.phone && d.client.phone !== "hidden" ? formatPhone(d.client.phone) : "Returning client"}</span>
						</div>
						<IconCheck width={20} height={20} className="text-cta" />
						<Link to={href({ client: null, new: false })} className="text-xs font-semibold text-ink-soft">Change</Link>
					</div>
				) : d.newClient ? (
					<div className="flex flex-col gap-3 rounded-card bg-card p-3 shadow-card">
						<div className="flex items-center justify-between">
							<span className="text-sm font-semibold">New client</span>
							<Link to={href({ client: null, new: false })} className="text-xs font-semibold text-ink-soft">Search instead</Link>
						</div>
						<p className="text-xs text-ink-soft">Filled in below; they are saved when you book.</p>
					</div>
				) : (
					<>
						<Form method="get" className="flex gap-2">
							{hidden()}
							<input type="search" name="q" defaultValue={d.q} placeholder="Name or phone" aria-label="Search clients" autoComplete="off" autoFocus className="min-h-12 w-full rounded-pill border border-input-border bg-card px-4 text-base" />
							<Button type="submit" variant="outlined">Find</Button>
						</Form>
						{d.matches.length > 0 ? (
							<ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
								{d.matches.map((c) => (
									<li key={c.id}>
										<Link to={href({ client: c.id, new: false })} className="press flex w-full items-center gap-3 border-b border-hairline px-3 py-2.5 text-left last:border-b-0">
											<Avatar name={fullName(c)} size={32} />
											<span className="flex min-w-0 flex-col"><span className="truncate text-sm font-semibold">{fullName(c)}</span><span className="truncate text-xs text-ink-soft">{c.phone && c.phone !== "hidden" ? formatPhone(c.phone) : ""}</span></span>
										</Link>
									</li>
								))}
							</ul>
						) : d.q ? (
							<p className="text-sm text-ink-soft">No one matches "{d.q}".</p>
						) : null}
						<Link to={href({ client: null, new: true, q: d.q })} className="press self-start py-2 text-sm font-semibold text-cta">+ New client{d.q ? ` "${d.q}"` : ""}</Link>
					</>
				)}
			</section>

			{/* 2. Services */}
			{clientChosen ? (
				<section className="mb-5 flex flex-col gap-2">
					<div className="flex items-baseline justify-between">
						<h2 className="text-sm font-bold">Services</h2>
						<span className="text-xs text-ink-soft">tap to add or remove</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{d.services.map((s) => {
							const on = d.svcIds.includes(s.id);
							const next = on ? d.svcIds.filter((id) => id !== s.id) : [...d.svcIds, s.id];
							return (
								<Link key={s.id} to={href({ svc: next, date: null })} aria-pressed={on} role="button" className={`press inline-flex min-h-11 items-center rounded-pill border px-3.5 text-sm font-semibold ${on ? "border-cta bg-cta text-on-dark" : "border-input-border bg-card text-ink"}`}>
									{s.name} · {formatMinutes(s.durationMinutes)} · {formatCents(s.priceCents)}
								</Link>
							);
						})}
					</div>
					{d.staff.length > 1 && d.employee ? (
						<Form method="get" className="mt-1 flex items-center gap-2 text-sm">
							{d.client ? <input type="hidden" name="client" value={d.client.id} /> : null}
							{d.newClient ? <input type="hidden" name="new" value="1" /> : null}
							{d.svcIds.map((id) => <input key={id} type="hidden" name="svc" value={id} />)}
							<label htmlFor="employee" className="text-ink-soft">With</label>
							<select id="employee" name="employee" defaultValue={d.employee.id} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="min-h-10 rounded-input border border-input-border bg-card px-2 text-sm">
								{d.staff.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
							</select>
						</Form>
					) : null}
				</section>
			) : null}

			{/* 3. Day */}
			{clientChosen && d.svcIds.length > 0 ? (
				<section className="mb-5 flex flex-col gap-2">
					<h2 className="text-sm font-bold">Day</h2>
					<div className="grid grid-cols-7 gap-1.5">
						{d.days.map((day) => {
							const on = d.date === day.iso;
							return (
								<Link key={day.iso} to={href({ date: day.iso })} aria-pressed={on} role="button" className={`press flex w-full flex-col items-center gap-0.5 rounded-card border py-2 ${on ? "border-feature bg-feature text-on-dark" : "border-input-border bg-card"}`}>
									<span className={`text-[11px] font-semibold ${on ? "text-on-dark-soft" : "text-ink-soft"}`}>{WD[day.weekday]}</span>
									<span className="text-base font-bold">{day.day}</span>
								</Link>
							);
						})}
					</div>
				</section>
			) : null}

			{/* 4. Time */}
			{d.slots && d.date ? (
				<section className="mb-3 flex flex-col gap-2">
					<div className="flex items-baseline justify-between">
						<h2 className="text-sm font-bold">Time</h2>
						<span className="text-xs text-ink-soft">{d.slots.starts.length} open for {formatMinutes(d.slots.totalMinutes)}</span>
					</div>
					{d.slots.starts.length === 0 ? (
						<p className="rounded-card bg-card px-3.5 py-3 text-sm text-ink-soft shadow-card">Nothing fits that day. Try another day or fewer services.</p>
					) : (
						<Form method="post" className="flex flex-col gap-3">
							<input type="hidden" name="employeeId" value={d.employee?.id ?? ""} />
							{d.client ? <input type="hidden" name="client" value={d.client.id} /> : null}
							{d.svcIds.map((id) => <input key={id} type="hidden" name="svc" value={id} />)}
							<div className="grid grid-cols-4 gap-2">
								{d.slots.starts.map((iso) => (
									<button key={iso} type="submit" name="at" value={iso} disabled={busy} className="press min-h-11 rounded-pill border border-input-border bg-card text-sm font-semibold hover:border-cta">
										{formatTime(iso, tz)}
									</button>
								))}
							</div>
							{d.newClient ? (
								<fieldset className="flex flex-col gap-3 rounded-card bg-card p-3 shadow-card">
									<legend className="sr-only">New client details</legend>
									<div className="grid grid-cols-2 gap-3">
										<Field label="First name" name="newFirstName" defaultValue={d.q} required />
										<Field label="Last name" name="newLastName" />
									</div>
									<Field label="Phone" name="newPhone" type="tel" inputMode="tel" />
								</fieldset>
							) : null}
							<Field label="Note for this visit (optional)" name="note" />
							<p className="text-xs text-ink-soft">Tapping a time books it.</p>
						</Form>
					)}
				</section>
			) : null}
			{chosenServices.length > 0 && !d.date ? <p className="text-xs text-ink-soft">{chosenServices.map((s) => s.name).join(" + ")}</p> : null}
		</Sheet>
	);
}
