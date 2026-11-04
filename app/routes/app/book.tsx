import { Form, Link, redirect, useLocation, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/book";
import type { loader as layoutLoader } from "./business-layout";
import { Sheet } from "../../components/sheet";
import { Avatar, Button, Field } from "../../components/ui";
import { IconCheck } from "../../components/icons";
import { AllergyFlag, ClientTag } from "../../components/client-tags";
import { formatCents, formatDate, formatMinutes, formatPhone, formatTime } from "../../lib/format";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { bookAppointment, bookSeries, listSlots, previewSeries } from "../../../server/domain/appointments/service";
import { fullName, listCustomers, suggestedServiceIds } from "../../../server/domain/customers/service";
import { addDays, formatLocalDate, localDateOf, parseLocalDate, weekdayOf } from "../../../server/domain/scheduling/time";
import { listServices } from "../../../server/domain/services/service";
import { getBusiness } from "../../../server/domain/businesses/service";
import { closedDates } from "../../../server/domain/calendar/service";
import { markWaitlistBooked } from "../../../server/domain/waitlist/service";
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
	let svcIds = url.searchParams.getAll("svc");
	// Picking a client fills in their usual services (or last visit's) once; after any tap on a
	// service the sheet carries &own=1 and never refills, so clearing them all sticks.
	const own = url.searchParams.get("own") === "1";
	const dateParam = url.searchParams.get("date");
	const employeeParam = url.searchParams.get("employee");
	const waitlist = url.searchParams.get("waitlist");

	const [catalog, staff, business] = await Promise.all([listServices(db, ctx), listEmployees(db, ctx), getBusiness(db, ctx)]);
	const timeZone = business?.timeZone ?? "America/New_York";

	const client = clientId ? (await listCustomers(db, ctx, { limit: 200 })).find((c) => c.id === clientId) ?? null : null;
	let filledFrom: "usual" | "last" | null = null;
	if (client && svcIds.length === 0 && !own) {
		const s = await suggestedServiceIds(db, ctx, client.id).catch(() => ({ ids: [] as string[], source: null }));
		svcIds = s.ids;
		filledFrom = s.source;
	}
	const matches = !client && !newClient && q.length >= 1 ? await listCustomers(db, ctx, { query: q, limit: 8 }) : [];
	const employee = staff.find((e) => e.id === employeeParam) ?? staff[0] ?? null;

	const today = localDateOf(new Date(), timeZone);
	const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
	const closed = await closedDates(db, ctx, formatLocalDate(today), 14).catch(() => ({}) as Record<string, string>);
	const date = dateParam ? parseLocalDate(dateParam) : null;

	let slots: { starts: Date[]; totalMinutes: number; priceCents: number; depositDueCents: number; timeZone: string } | null = null;
	if (employee && svcIds.length > 0 && date) {
		try {
			slots = await listSlots(db, ctx, { employeeId: employee.id, serviceIds: svcIds, date: formatLocalDate(date) });
		} catch {
			slots = null;
		}
	}
	// Repeat: ?repeat=2|3|4 (weeks) &n=visits; with &at= the sheet previews every date before booking.
	const repeatParam = Number(url.searchParams.get("repeat"));
	const repeat = [2, 3, 4].includes(repeatParam) ? repeatParam : 0;
	const count = [4, 6, 8, 12].includes(Number(url.searchParams.get("n"))) ? Number(url.searchParams.get("n")) : 6;
	const at = url.searchParams.get("at");
	let series: { startAt: string; date: string; status: string; label: string | null }[] | null = null;
	if (repeat && at && employee && svcIds.length > 0) {
		try {
			series = (await previewSeries(db, ctx, { employeeId: employee.id, serviceIds: svcIds, startAt: new Date(at), everyWeeks: repeat, count })).map((o) => ({ ...o, startAt: o.startAt.toISOString() }));
		} catch {
			series = null;
		}
	}
	const carry = { newFirstName: url.searchParams.get("newFirstName") ?? "", newLastName: url.searchParams.get("newLastName") ?? "", newPhone: url.searchParams.get("newPhone") ?? "", note: url.searchParams.get("note") ?? "" };
	return {
		filledFrom,
		repeat,
		count,
		at: series ? at : null,
		series,
		carry,
		q,
		client,
		newClient,
		matches,
		services: catalog.services,
		staff,
		employee,
		svcIds,
		days: days.map((d) => ({ iso: formatLocalDate(d), weekday: weekdayOf(d), day: d.day, closed: closed[formatLocalDate(d)] ?? null })),
		date: date ? formatLocalDate(date) : null,
		slots: slots ? { ...slots, starts: slots.starts.map((d) => d.toISOString()) } : null,
		timeZone,
		waitlist,
	};
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const newCustomer = form.get("newFirstName")
		? { firstName: String(form.get("newFirstName")), lastName: String(form.get("newLastName") ?? ""), phone: String(form.get("newPhone") ?? ""), email: String(form.get("newEmail") ?? "") }
		: undefined;
	const repeat = Number(form.get("repeat") ?? 0);
	try {
		if (repeat) {
			const r = await bookSeries(db, ctx, {
				employeeId: String(form.get("employeeId")),
				serviceIds: form.getAll("svc").map(String),
				startAt: String(form.get("at")),
				customerId: form.get("client") ? String(form.get("client")) : undefined,
				newCustomer,
				note: String(form.get("note") ?? ""),
				everyWeeks: repeat,
				count: Number(form.get("n") ?? 6),
			});
			const wl = form.get("waitlist");
			if (wl) await markWaitlistBooked(db, ctx, String(wl), r.first.id).catch(() => false);
			throw redirect(`/app/${params.business}/appointments/${r.first.id}?booked=${r.booked.length}`);
		}
		const appt = await bookAppointment(db, ctx, {
			employeeId: String(form.get("employeeId")),
			serviceIds: form.getAll("svc").map(String),
			startAt: String(form.get("at")),
			customerId: form.get("client") ? String(form.get("client")) : undefined,
			newCustomer,
			note: String(form.get("note") ?? ""),
		});
		const waitlistId = form.get("waitlist");
		if (waitlistId) await markWaitlistBooked(db, ctx, String(waitlistId), appt.id).catch(() => false);
		throw redirect(`/app/${params.business}/appointments/${appt.id}?booked=1`);
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "slot_taken" || e.code === "slot_unavailable") return { error: "That time was just taken. Pick another." };
		if (e.code === "customer_required") return { error: "Pick a client or add a new one." };
		if (e.code === "do_not_book" || e.code === "customer_archived") return { error: e.message ?? "This client cannot be booked." };
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
	const href = (patch: { client?: string | null; new?: boolean; q?: string | null; svc?: string[]; date?: string | null; employee?: string | null; repeat?: number; n?: number }) => {
		const sp = new URLSearchParams();
		const client = patch.client === undefined ? d.client?.id ?? null : patch.client;
		const isNew = patch.new === undefined ? d.newClient : patch.new;
		const q = patch.q === undefined ? null : patch.q;
		const svc = patch.svc ?? d.svcIds;
		const clientChanging = patch.client !== undefined && patch.client !== (d.client?.id ?? null);
		if (!clientChanging && (patch.svc !== undefined || d.svcIds.length > 0)) sp.set("own", "1");
		const date = patch.date === undefined ? d.date : patch.date;
		const employee = patch.employee === undefined ? d.employee?.id ?? null : patch.employee;
		if (client) sp.set("client", client);
		if (isNew) sp.set("new", "1");
		if (q) sp.set("q", q);
		for (const id of svc) sp.append("svc", id);
		if (date) sp.set("date", date);
		if (employee) sp.set("employee", employee);
		if (d.waitlist) sp.set("waitlist", d.waitlist);
		const repeat = patch.repeat ?? d.repeat;
		if (repeat) {
			sp.set("repeat", String(repeat));
			sp.set("n", String(patch.n ?? d.count));
		}
		return { pathname: `${base}/book`, search: `?${sp.toString()}` };
	};
	const hidden = () => (
		<>
			{d.client ? <input type="hidden" name="client" value={d.client.id} /> : null}
			{d.newClient ? <input type="hidden" name="new" value="1" /> : null}
			{d.svcIds.map((id) => <input key={id} type="hidden" name="svc" value={id} />)}
			<input type="hidden" name="own" value="1" />
			{d.date ? <input type="hidden" name="date" value={d.date} /> : null}
			{d.employee ? <input type="hidden" name="employee" value={d.employee.id} /> : null}
			{d.waitlist ? <input type="hidden" name="waitlist" value={d.waitlist} /> : null}
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
							<span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold">{fullName(d.client)}</span><ClientTag status={d.client.status} isNew={d.client.isNew} /><AllergyFlag allergy={d.client.allergy} /></span>
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
											<span className="flex min-w-0 flex-col"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold">{fullName(c)}</span><ClientTag status={c.status} isNew={c.isNew} /></span><span className="truncate text-xs text-ink-soft">{c.phone && c.phone !== "hidden" ? formatPhone(c.phone) : ""}</span></span>
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

			{d.client?.status === "do_not_book" ? <p role="alert" className="mb-3 rounded-card border border-danger bg-[#fbeceb] px-3.5 py-3 text-sm text-danger">Marked <span className="font-bold">Do not book</span>. Change their status on the client profile to book them.</p> : null}

			{/* 2. Services */}
			{clientChosen && d.client?.status !== "do_not_book" ? (
				<section className="mb-5 flex flex-col gap-2">
					<div className="flex items-baseline justify-between">
						<h2 className="text-sm font-bold">Services</h2>
						<span className="text-xs text-ink-soft">{d.filledFrom === "usual" ? "their usual · tap to change" : d.filledFrom === "last" ? "same as last visit · tap to change" : "tap to add or remove"}</span>
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
							if (day.closed) return (
								<span key={day.iso} title={day.closed} aria-label={`${WD[day.weekday]} ${day.day}, ${day.closed}`} className="flex w-full flex-col items-center gap-0.5 rounded-card border border-dashed border-input-border bg-canvas-alt py-2 text-ink-soft">
									<span className="text-[11px] font-semibold">{WD[day.weekday]}</span>
									<span className="text-base font-bold line-through">{day.day}</span>
								</span>
							);
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
							{d.waitlist ? <input type="hidden" name="waitlist" value={d.waitlist} /> : null}
							<input type="hidden" name="employeeId" value={d.employee?.id ?? ""} />
							{d.client ? <input type="hidden" name="client" value={d.client.id} /> : null}
							{d.svcIds.map((id) => <input key={id} type="hidden" name="svc" value={id} />)}
							{d.repeat ? (
								<>
									{/* A repeat previews first: the time buttons submit as GET with everything needed to redraw the sheet. */}
									{d.newClient ? <input type="hidden" name="new" value="1" /> : null}
									{d.date ? <input type="hidden" name="date" value={d.date} /> : null}
									{d.employee ? <input type="hidden" name="employee" value={d.employee.id} /> : null}
									<input type="hidden" name="repeat" value={d.repeat} />
									<input type="hidden" name="n" value={d.count} />
								</>
							) : null}
							<div className="flex flex-col gap-2 rounded-card bg-card p-3 shadow-card">
								<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Repeat">
									<span className="mr-1 text-sm font-semibold">Repeat</span>
									{[0, 2, 3, 4].map((w) => (
										<Link key={w} to={href({ repeat: w })} aria-pressed={d.repeat === w} className={`press inline-flex min-h-9 items-center rounded-pill border px-3 text-sm font-semibold ${d.repeat === w ? "border-feature bg-feature text-on-dark" : "border-input-border bg-card"}`}>{w === 0 ? "No" : `Every ${w} wks`}</Link>
									))}
								</div>
								{d.repeat ? (
									<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Number of visits">
										<span className="mr-1 text-sm font-semibold">Visits</span>
										{[4, 6, 8, 12].map((n) => (
											<Link key={n} to={href({ n })} aria-pressed={d.count === n} className={`press inline-flex min-h-9 min-w-11 items-center justify-center rounded-pill border px-3 text-sm font-semibold ${d.count === n ? "border-feature bg-feature text-on-dark" : "border-input-border bg-card"}`}>{n}</Link>
										))}
									</div>
								) : null}
							</div>
							<div className="grid grid-cols-4 gap-2">
								{d.slots.starts.map((iso) => (
									<button key={iso} type="submit" name="at" value={iso} formMethod={d.repeat ? "get" : undefined} disabled={busy} aria-pressed={d.at === iso || undefined} className={`press min-h-11 rounded-pill border text-sm font-semibold hover:border-cta ${d.at === iso ? "border-cta bg-cta text-on-dark" : "border-input-border bg-card"}`}>
										{formatTime(iso, tz)}
									</button>
								))}
							</div>
							{d.newClient ? (
								<fieldset className="flex flex-col gap-3 rounded-card bg-card p-3 shadow-card">
									<legend className="sr-only">New client details</legend>
									<div className="grid grid-cols-2 gap-3">
										<Field label="First name" name="newFirstName" defaultValue={d.carry.newFirstName || d.q} required />
										<Field label="Last name" name="newLastName" defaultValue={d.carry.newLastName} />
									</div>
									<Field label="Phone" name="newPhone" type="tel" inputMode="tel" defaultValue={d.carry.newPhone} />
								</fieldset>
							) : null}
							<Field label={d.repeat ? "Note for these visits (optional)" : "Note for this visit (optional)"} name="note" defaultValue={d.carry.note} />
							<p className="text-xs text-ink-soft">{d.repeat ? "Tap a time to see every date before booking." : "Tapping a time books it."}</p>
						</Form>
					)}
					{d.series && d.at ? (
						<Form method="post" aria-label="Repeat dates" className="flex flex-col gap-3 rounded-card bg-card p-3 shadow-card">
							<div className="flex items-baseline justify-between">
								<h3 className="text-sm font-bold">Every {d.repeat} weeks · {formatTime(d.at, tz)}</h3>
								<span className="text-xs text-ink-soft">{d.series.filter((o) => o.status === "ok").length} of {d.series.length} free</span>
							</div>
							<ol className="flex flex-col">
								{d.series.map((o) => (
									<li key={o.startAt} className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-sm last:border-b-0">
										<span className={o.status === "ok" ? "font-semibold" : "text-ink-soft line-through"}>{formatDate(o.startAt, tz, "full")}</span>
										{o.status === "ok" ? <IconCheck width={18} height={18} className="text-cta" /> : <span className={`text-xs font-semibold ${o.status === "taken" ? "text-danger" : "text-ink-soft"}`}>{o.label}</span>}
									</li>
								))}
							</ol>
							{d.waitlist ? <input type="hidden" name="waitlist" value={d.waitlist} /> : null}
							<input type="hidden" name="employeeId" value={d.employee?.id ?? ""} />
							{d.client ? <input type="hidden" name="client" value={d.client.id} /> : null}
							{d.svcIds.map((id) => <input key={id} type="hidden" name="svc" value={id} />)}
							<input type="hidden" name="at" value={d.at} />
							<input type="hidden" name="repeat" value={d.repeat} />
							<input type="hidden" name="n" value={d.count} />
							<input type="hidden" name="note" value={d.carry.note} />
							{d.newClient ? (
								<>
									<input type="hidden" name="newFirstName" value={d.carry.newFirstName} />
									<input type="hidden" name="newLastName" value={d.carry.newLastName} />
									<input type="hidden" name="newPhone" value={d.carry.newPhone} />
								</>
							) : null}
							{d.series[0]?.status !== "ok" ? (
								<p className="text-sm text-danger">The first date is not free. Pick another time.</p>
							) : (
								<Button type="submit" disabled={busy} className="self-start">Book {d.series.filter((o) => o.status === "ok").length} visits</Button>
							)}
							{d.series.some((o) => o.status !== "ok") ? <p className="text-xs text-ink-soft">Crossed-out dates are skipped. Book them separately if you want a different time.</p> : null}
						</Form>
					) : null}
				</section>
			) : null}
			{chosenServices.length > 0 && !d.date ? <p className="text-xs text-ink-soft">{chosenServices.map((s) => s.name).join(" + ")}</p> : null}
		</Sheet>
	);
}
