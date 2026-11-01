import { useState } from "react";
import { Form, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/team";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Avatar, Badge, Button, ButtonLink, Card, Field, PageTitle } from "../../components/ui";
import { Link } from "react-router";
import { envContext } from "../../../server/context";
import { hasPermission, PERMISSION_KEYS, type PermissionKey } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { createInvitation, invitationEmailContext, listPendingInvitations, resendInvitation, revokeInvitation } from "../../../server/domain/invitations/service";
import { sendEmail } from "../../../server/email/send";
import type { AppEnv } from "../../../server/env";
import type { Db } from "../../../server/db/client";
import type { TenantCtx } from "../../../server/auth/ctx";
import { invitationEmail } from "../../../server/email/templates";
import { listMembers, removeMember, setMemberPermissions } from "../../../server/domain/members/service";
import { listEmployees } from "../../../server/domain/staff/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Team · K3 Dashboard" }];
}

const PERMISSION_LABELS: Record<PermissionKey, string> = {
	"settings.view": "See settings",
	"settings.edit": "Change settings",
	"team.view": "See the team",
	"team.manage": "Invite and remove team members",
	"services.view": "See services",
	"services.manage": "Change services and prices",
	"calendar.view_own": "See their own calendar",
	"calendar.view_all": "See everyone's calendar",
	"appointments.manage_own": "Book and change their own appointments",
	"appointments.manage_all": "Book and change anyone's appointments",
	"customers.view": "See clients",
	"customers.edit": "Edit client notes and details",
	"customers.view_contact": "See client phone and email",
	"payments.view": "See payments",
	"payments.charge": "Charge clients",
	"payments.refund": "Issue refunds",
	"reports.view": "See reports",
};

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	if (!hasPermission(ctx.role, [...ctx.permissions], "team.view")) throw new Response("Forbidden", { status: 403 });
	const [members, pending, employees] = await Promise.all([listMembers(db, ctx), listPendingInvitations(db, ctx), listEmployees(db, ctx, { includeInactive: true })]);
	return { members, pending, employees, now: Date.now() };
}

const inviteForm = z.object({ email: z.email("Enter a valid email"), role: z.enum(["owner", "employee"]) });

type ActionData = { error?: string; inviteLink?: string; sentTo?: string; emailFailed?: boolean; resentTo?: string };

/** Email the invitation; on failure the caller still has the link to copy. */
async function deliver(env: AppEnv, db: Db, ctx: TenantCtx, inviterName: string, inv: { email: string; role: "owner" | "employee"; expiresAt: Date }, link: string) {
	try {
		const biz = await invitationEmailContext(db, ctx);
		await sendEmail(env, invitationEmail({ to: inv.email, inviterName, businessName: biz.name, timeZone: biz.timeZone, role: inv.role, link, expiresAt: inv.expiresAt }));
		return true;
	} catch {
		return false;
	}
}

export async function action({ request, params, context }: Route.ActionArgs): Promise<ActionData> {
	const { db, auth } = services(context);
	const { user, ctx } = await requireTenant(db, auth, request, params.business!);
	const env = context.get(envContext);
	const form = await request.formData();
	const intent = form.get("intent");
	try {
		if (intent === "invite") {
			const parsed = inviteForm.safeParse({ email: form.get("email"), role: form.get("role") ?? "employee" });
			if (!parsed.success) return { error: z.flattenError(parsed.error).fieldErrors.email?.[0] ?? "Check the form" };
			const { invitation, token } = await createInvitation(db, ctx, parsed.data);
			const link = `${env.APP_ORIGIN}/invite/${token}`;
			const ok = await deliver(env, db, ctx, user.name, invitation, link);
			return { inviteLink: link, sentTo: invitation.email, emailFailed: !ok };
		}
		if (intent === "resend") {
			const { invitation, token } = await resendInvitation(db, ctx, String(form.get("invitationId")));
			const link = `${env.APP_ORIGIN}/invite/${token}`;
			const ok = await deliver(env, db, ctx, user.name, invitation, link);
			return ok ? { resentTo: invitation.email } : { inviteLink: link, sentTo: invitation.email, emailFailed: true };
		}
		if (intent === "revoke") {
			await revokeInvitation(db, ctx, String(form.get("invitationId")));
			return {};
		}
		if (intent === "remove") {
			await removeMember(db, ctx, String(form.get("memberId")));
			return {};
		}
		if (intent === "permissions") {
			const keys = form.getAll("permission").map(String);
			await setMemberPermissions(db, ctx, String(form.get("memberId")), keys);
			return {};
		}
	} catch (err) {
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "last_owner") return { error: "A business must keep at least one owner." };
		return { error: "That did not work. Try again." };
	}
	return { error: "Unknown action" };
}

function sentAgo(sentAt: Date | string, now: number): string {
	const min = Math.round((now - new Date(sentAt).getTime()) / 60000);
	if (min < 1) return "just now";
	if (min < 60) return `${min} min ago`;
	const h = Math.round(min / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	return d === 1 ? "yesterday" : `${d} days ago`;
}

function CopyLink({ link }: { link: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			type="button"
			variant="outlined"
			size="sm"
			onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}
		>
			{copied ? "Link copied" : "Copy link to text it"}
		</Button>
	);
}

export default function Team({ loaderData, actionData }: Route.ComponentProps) {
	const now = loaderData.now;
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canManage = hasPermission(data.ctx.role, data.ctx.permissions, "team.manage");
	const isOwner = data.ctx.role === "owner";

	return (
		<Page>
			<PageTitle title="Team" aside={`${loaderData.members.length} ${loaderData.members.length === 1 ? "person" : "people"}`} />

			{canManage ? (
				<Card className="flex flex-col gap-4">
					<h2 className="text-base font-bold">Invite someone</h2>
					{actionData?.sentTo ? (
						<div role="status" className="flex flex-col gap-2.5 rounded-card bg-mint p-3.5">
							{actionData.emailFailed ? (
								<>
									<span className="text-[15px] font-bold text-heading">Invitation ready for {actionData.sentTo}</span>
									<span className="text-sm">The email didn't go out. Copy the link and text it; it works once and expires in 7 days.</span>
									<code className="break-all rounded-input bg-card px-3 py-2 text-xs">{actionData.inviteLink}</code>
								</>
							) : (
								<>
									<span className="text-[15px] font-bold text-heading">Invitation sent to {actionData.sentTo}</span>
									<span className="text-sm">It works once and expires in 7 days. They'll show under Waiting to join until they accept.</span>
								</>
							)}
							<div className="flex flex-wrap gap-2">
								{actionData.inviteLink ? <CopyLink link={actionData.inviteLink} /> : null}
								<ButtonLink to="." variant="quiet" size="sm" replace>Invite another</ButtonLink>
							</div>
						</div>
					) : (
						<Form method="post" className="flex flex-col gap-4" noValidate>
							<input type="hidden" name="intent" value="invite" />
							<Field label="Email" name="email" type="email" inputMode="email" autoComplete="off" required error={actionData?.error} />
							{isOwner ? (
								<fieldset className="flex gap-2">
									<legend className="mb-1.5 text-sm font-semibold">Role</legend>
									<label className="flex min-h-10 items-center gap-2 rounded-pill border border-input-border bg-card px-4 text-sm font-semibold has-checked:border-cta has-checked:bg-mint has-checked:text-heading">
										<input type="radio" name="role" value="employee" defaultChecked className="sr-only" />
										Employee
									</label>
									<label className="flex min-h-10 items-center gap-2 rounded-pill border border-input-border bg-card px-4 text-sm font-semibold has-checked:border-cta has-checked:bg-mint has-checked:text-heading">
										<input type="radio" name="role" value="owner" className="sr-only" />
										Owner
									</label>
								</fieldset>
							) : (
								<input type="hidden" name="role" value="employee" />
							)}
							<Button type="submit" className="self-start">Send invitation</Button>
						</Form>
					)}
				</Card>
			) : null}

			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between px-0.5">
					<h2 className="text-base font-bold">Bookable staff</h2>
					{canManage ? <ButtonLink to={`/app/${data.ctx.businessSlug}/team/new`} variant="outlined" size="sm">Add</ButtonLink> : null}
				</div>
				{loaderData.employees.length === 0 ? (
					<p className="px-0.5 text-sm text-ink-soft">Add yourself first: name, services you do, and your weekly hours. Appointments are booked against bookable staff, not logins.</p>
				) : (
					<ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
						{loaderData.employees.map((e) => (
							<li key={e.id}>
								<Link to={`/app/${data.ctx.businessSlug}/team/${e.id}`} className={`flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0 ${e.active ? "" : "opacity-60"}`}>
									<Avatar name={e.displayName} size={36} />
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm font-semibold">{e.displayName}</span>
										<span className="truncate text-xs text-ink-soft">{e.memberName ? `Login: ${e.memberName}` : "No login"}</span>
									</span>
									{!e.active ? <Badge>Hidden</Badge> : null}
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			{loaderData.pending.length > 0 ? (
				<section className="flex flex-col gap-2">
					<h2 className="px-0.5 text-base font-bold">Waiting to join</h2>
					{actionData?.resentTo ? <p role="status" className="px-0.5 text-sm text-heading">Sent a fresh link to {actionData.resentTo}. The old one no longer works.</p> : null}
					<ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
						{loaderData.pending.map((p) => (
							<li key={p.id} className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
								<div className="flex min-w-0 flex-col">
									<span className="truncate text-sm font-semibold">{p.email}</span>
									<span className="text-xs text-ink-soft">{p.role === "owner" ? "Owner" : "Employee"} · emailed {sentAgo(p.sentAt, now)}</span>
								</div>
								{canManage ? (
									<Form method="post" className="flex shrink-0">
										<input type="hidden" name="invitationId" value={p.id} />
										{now - new Date(p.sentAt).getTime() > 24 * 60 * 60 * 1000 ? (
											<Button type="submit" variant="quiet" size="sm" name="intent" value="resend" className="text-cta">Resend</Button>
										) : null}
										<Button type="submit" variant="quiet" size="sm" name="intent" value="revoke">Revoke</Button>
									</Form>
								) : null}
							</li>
						))}
					</ul>
				</section>
			) : null}

			<section className="flex flex-col gap-2">
				<h2 className="px-0.5 text-base font-bold">Logins</h2>
				<ul className="flex flex-col gap-2">
					{loaderData.members.map((m) => (
						<li key={m.id}>
							<Card className="flex flex-col gap-3">
								<div className="flex items-center gap-3">
									<Avatar name={m.name} />
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="truncate font-semibold">{m.name}</span>
										<span className="truncate text-sm text-ink-soft">{m.email}</span>
									</div>
									<Badge variant={m.role === "owner" ? "green" : "neutral"}>{m.role === "owner" ? "Owner" : "Employee"}</Badge>
								</div>
								{canManage && m.role === "employee" ? (
									<details className="group">
										<summary className="cursor-pointer text-sm font-semibold text-cta">What they can do</summary>
										<Form method="post" className="mt-3 flex flex-col gap-3">
											<input type="hidden" name="intent" value="permissions" />
											<input type="hidden" name="memberId" value={m.id} />
											<ul className="flex flex-col gap-2">
												{PERMISSION_KEYS.map((key) => (
													<li key={key}>
														<label className="flex min-h-11 items-center gap-3 text-sm">
															<input
																type="checkbox"
																name="permission"
																value={key}
																defaultChecked={m.permissions.includes(key)}
																className="h-5 w-5 accent-[#00754a]"
															/>
															{PERMISSION_LABELS[key]}
														</label>
													</li>
												))}
											</ul>
											<div className="flex gap-2">
												<Button type="submit" size="sm">Save</Button>
												<Button type="submit" size="sm" variant="danger" name="intent" value="remove">
													Remove from team
												</Button>
											</div>
										</Form>
									</details>
								) : null}
							</Card>
						</li>
					))}
				</ul>
			</section>
		</Page>
	);
}
