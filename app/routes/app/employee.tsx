import { Form, Link, redirect, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/employee";
import type { loader as layoutLoader } from "./business-layout";
import { IconBack } from "../../components/icons";
import { Page } from "../../components/shell";
import { Avatar, Badge, Button, Card, Field, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { listMembers } from "../../../server/domain/members/service";
import { formatMinutes, listServices } from "../../../server/domain/services/service";
import {
	WEEKDAYS,
	createEmployee,
	createTimeBlock,
	deleteTimeBlock,
	getEmployee,
	setEmployeeActive,
	setEmployeeAvailability,
	setEmployeeServices,
	updateEmployee,
} from "../../../server/domain/staff/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Team member · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "team.view")) throw new Response("Forbidden", { status: 403 });
	const [members, catalog] = await Promise.all([listMembers(db, ctx), listServices(db, ctx)]);
	if (params.employeeId === "new") return { employee: null, members, services: catalog.services, timeZone: ctx.businessSlug };
	const employee = await getEmployee(db, ctx, params.employeeId!);
	if (!employee) throw new Response("Not found", { status: 404 });
	return { employee, members, services: catalog.services, timeZone: ctx.businessSlug };
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const intent = form.get("intent");
	const id = params.employeeId!;
	try {
		if (intent === "profile") {
			const input = { displayName: String(form.get("displayName") ?? ""), bio: String(form.get("bio") ?? ""), memberId: String(form.get("memberId") ?? "") };
			if (id === "new") {
				const created = await createEmployee(db, ctx, input);
				throw redirect(`/app/${params.business}/team/${created.id}`);
			}
			await updateEmployee(db, ctx, id, input);
		} else if (intent === "services") {
			await setEmployeeServices(db, ctx, id, form.getAll("serviceId").map(String));
		} else if (intent === "availability") {
			const rows: { weekday: number; startsAt: string; endsAt: string }[] = [];
			for (let d = 0; d < 7; d++) {
				if (form.get(`on-${d}`) !== "on") continue;
				rows.push({ weekday: d, startsAt: String(form.get(`start-${d}`)), endsAt: String(form.get(`end-${d}`)) });
				if (form.get(`split-${d}`) === "on") rows.push({ weekday: d, startsAt: String(form.get(`start2-${d}`)), endsAt: String(form.get(`end2-${d}`)) });
			}
			await setEmployeeAvailability(db, ctx, id, rows);
		} else if (intent === "timeoff.create") {
			await createTimeBlock(db, ctx, { employeeId: id, kind: "time_off", startAt: String(form.get("startAt")), endAt: String(form.get("endAt")), reason: String(form.get("reason") ?? "") });
		} else if (intent === "timeoff.delete") {
			await deleteTimeBlock(db, ctx, String(form.get("blockId")));
		} else if (intent === "active") {
			await setEmployeeActive(db, ctx, id, form.get("active") === "true");
		}
		return { error: undefined };
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "availability_overlap") return { error: "Two shifts on the same day overlap." };
		return { error: "Could not save. Check the times and try again." };
	}
}

export default function Employee({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canManage = hasPermission(data.ctx.role, data.ctx.permissions, "team.manage");
	const base = `/app/${data.ctx.businessSlug}`;
	const e = loaderData.employee;
	const byDay = new Map<number, { startsAt: string; endsAt: string }[]>();
	for (const a of e?.availability ?? []) byDay.set(a.weekday, [...(byDay.get(a.weekday) ?? []), a]);

	return (
		<Page>
			<Link to={`${base}/team`} className="-mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft">
				<IconBack width={18} height={18} />
				Team
			</Link>
			<div className="flex items-center gap-3">
				{e ? <Avatar name={e.displayName} size={48} /> : null}
				<PageTitle title={e ? e.displayName : "New team member"} />
				{e && !e.active ? <Badge>Hidden</Badge> : null}
			</div>
			{actionData?.error ? <p role="alert" className="text-sm text-danger">{actionData.error}</p> : null}

			<Card className="flex flex-col gap-4">
				<h2 className="text-base font-bold">Profile</h2>
				<Form method="post" className="flex flex-col gap-4">
					<input type="hidden" name="intent" value="profile" />
					<Field label="Name clients see" name="displayName" defaultValue={e?.displayName ?? ""} required disabled={!canManage} />
					<div className="flex flex-col gap-1.5">
						<label htmlFor="memberId" className="text-sm font-semibold">Login</label>
						<select id="memberId" name="memberId" defaultValue={e?.memberId ?? ""} disabled={!canManage} className="min-h-12 rounded-input border border-input-border bg-card px-3 text-base">
							<option value="">No login (bookable only)</option>
							{loaderData.members.map((m) => (
								<option key={m.id} value={m.id}>{m.name} · {m.email}</option>
							))}
						</select>
						<span className="text-sm text-ink-soft">Linking a login lets them see their own calendar.</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="bio" className="text-sm font-semibold">Short bio (optional)</label>
						<textarea id="bio" name="bio" rows={2} defaultValue={e?.bio ?? ""} disabled={!canManage} className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
					</div>
					{canManage ? <Button type="submit" className="self-start">{e ? "Save profile" : "Create"}</Button> : null}
				</Form>
			</Card>

			{e ? (
				<>
					<Card className="flex flex-col gap-3">
						<h2 className="text-base font-bold">Services they do</h2>
						{loaderData.services.length === 0 ? (
							<p className="text-sm text-ink-soft">Add services first, then pick which ones {e.displayName} offers.</p>
						) : (
							<Form method="post" className="flex flex-col gap-3">
								<input type="hidden" name="intent" value="services" />
								<ul className="flex flex-col">
									{loaderData.services.map((s) => (
										<li key={s.id}>
											<label className="flex min-h-11 items-center gap-3 border-b border-hairline text-sm last:border-b-0">
												<input type="checkbox" name="serviceId" value={s.id} defaultChecked={e.serviceIds.includes(s.id)} disabled={!canManage} className="h-5 w-5 accent-[#00754a]" />
												<span className="flex-1">{s.name}</span>
												<span className="text-ink-soft">{formatMinutes(s.durationMinutes)}</span>
											</label>
										</li>
									))}
								</ul>
								{canManage ? <Button type="submit" size="sm" className="self-start">Save services</Button> : null}
							</Form>
						)}
					</Card>

					<Card className="flex flex-col gap-3">
						<h2 className="text-base font-bold">Weekly hours</h2>
						<Form method="post" className="flex flex-col gap-2">
							<input type="hidden" name="intent" value="availability" />
							{WEEKDAYS.map((name, d) => {
								const shifts = byDay.get(d) ?? [];
								const on = shifts.length > 0;
								return (
									<fieldset key={d} className="flex flex-col gap-2 border-b border-hairline py-2 last:border-b-0">
										<label className="flex min-h-10 items-center gap-3 text-sm font-semibold">
											<input type="checkbox" name={`on-${d}`} defaultChecked={on} disabled={!canManage} className="h-5 w-5 accent-[#00754a]" />
											{name}
										</label>
										<div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pl-8">
											<input type="time" name={`start-${d}`} defaultValue={shifts[0]?.startsAt ?? "09:00"} disabled={!canManage} aria-label={`${name} start`} className="min-h-11 rounded-input border border-input-border bg-card px-2 text-sm" />
											<span className="text-sm text-ink-soft">to</span>
											<input type="time" name={`end-${d}`} defaultValue={shifts[0]?.endsAt ?? "17:00"} disabled={!canManage} aria-label={`${name} end`} className="min-h-11 rounded-input border border-input-border bg-card px-2 text-sm" />
										</div>
										<details className="pl-8" open={shifts.length > 1}>
											<summary className="cursor-pointer text-xs font-semibold text-ink-soft">Split shift</summary>
											<div className="mt-2 grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2">
												<input type="checkbox" name={`split-${d}`} defaultChecked={shifts.length > 1} disabled={!canManage} aria-label={`${name} second shift`} className="h-5 w-5 accent-[#00754a]" />
												<input type="time" name={`start2-${d}`} defaultValue={shifts[1]?.startsAt ?? "14:00"} disabled={!canManage} aria-label={`${name} second start`} className="min-h-11 rounded-input border border-input-border bg-card px-2 text-sm" />
												<span className="text-sm text-ink-soft">to</span>
												<input type="time" name={`end2-${d}`} defaultValue={shifts[1]?.endsAt ?? "18:00"} disabled={!canManage} aria-label={`${name} second end`} className="min-h-11 rounded-input border border-input-border bg-card px-2 text-sm" />
											</div>
										</details>
									</fieldset>
								);
							})}
							{canManage ? <Button type="submit" size="sm" className="mt-2 self-start">Save hours</Button> : null}
						</Form>
					</Card>

					<Card className="flex flex-col gap-3">
						<h2 className="text-base font-bold">Time off</h2>
						{e.upcomingBlocks.length === 0 ? <p className="text-sm text-ink-soft">No time off coming up.</p> : null}
						<ul className="flex flex-col">
							{e.upcomingBlocks.map((b) => (
								<li key={b.id} className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
									<div className="flex flex-col text-sm">
										<span className="font-semibold">{formatRange(b.startAt, b.endAt)}</span>
										{b.reason ? <span className="text-ink-soft">{b.reason}</span> : null}
									</div>
									<Form method="post">
										<input type="hidden" name="intent" value="timeoff.delete" />
										<input type="hidden" name="blockId" value={b.id} />
										<Button type="submit" variant="quiet" size="sm">Remove</Button>
									</Form>
								</li>
							))}
						</ul>
						<Form method="post" className="flex flex-col gap-3">
							<input type="hidden" name="intent" value="timeoff.create" />
							<div className="grid grid-cols-2 gap-3">
								<Field label="From" name="startAt" type="datetime-local" required />
								<Field label="To" name="endAt" type="datetime-local" required />
							</div>
							<Field label="Reason (optional)" name="reason" />
							<Button type="submit" variant="outlined" size="sm" className="self-start">Add time off</Button>
						</Form>
					</Card>

					{canManage ? (
						<Form method="post">
							<input type="hidden" name="intent" value="active" />
							<input type="hidden" name="active" value={e.active ? "false" : "true"} />
							<Button type="submit" variant="quiet" className="w-full">
								{e.active ? "Hide from booking" : "Show in booking again"}
							</Button>
						</Form>
					) : null}
				</>
			) : null}
		</Page>
	);
}

function formatRange(start: Date | string, end: Date | string): string {
	const s = new Date(start);
	const en = new Date(end);
	const f = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	return `${f.format(s)} to ${f.format(en)}`;
}
