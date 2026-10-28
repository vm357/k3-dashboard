import { Form, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/team";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Avatar, Badge, Button, Card, Field, PageTitle } from "../../components/ui";
import { envContext } from "../../../server/context";
import { hasPermission, PERMISSION_KEYS, type PermissionKey } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { createInvitation, listPendingInvitations, revokeInvitation } from "../../../server/domain/invitations/service";
import { listMembers, removeMember, setMemberPermissions } from "../../../server/domain/members/service";

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
	const [members, pending] = await Promise.all([listMembers(db, ctx), listPendingInvitations(db, ctx)]);
	return { members, pending, origin: context.get(envContext).APP_ORIGIN };
}

const inviteForm = z.object({ email: z.email("Enter a valid email"), role: z.enum(["owner", "employee"]) });

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const intent = form.get("intent");
	try {
		if (intent === "invite") {
			const parsed = inviteForm.safeParse({ email: form.get("email"), role: form.get("role") ?? "employee" });
			if (!parsed.success) return { error: z.flattenError(parsed.error).fieldErrors.email?.[0] ?? "Check the form", inviteLink: undefined };
			const { token } = await createInvitation(db, ctx, parsed.data);
			const origin = context.get(envContext).APP_ORIGIN;
			return { error: undefined, inviteLink: `${origin}/invite/${token}` };
		}
		if (intent === "revoke") {
			await revokeInvitation(db, ctx, String(form.get("invitationId")));
			return { error: undefined, inviteLink: undefined };
		}
		if (intent === "remove") {
			await removeMember(db, ctx, String(form.get("memberId")));
			return { error: undefined, inviteLink: undefined };
		}
		if (intent === "permissions") {
			const keys = form.getAll("permission").map(String);
			await setMemberPermissions(db, ctx, String(form.get("memberId")), keys);
			return { error: undefined, inviteLink: undefined };
		}
	} catch (err) {
		const e = err as { status?: number; code?: string; message?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "last_owner") return { error: "A business must keep at least one owner.", inviteLink: undefined };
		return { error: "That did not work. Try again.", inviteLink: undefined };
	}
	return { error: "Unknown action", inviteLink: undefined };
}

export default function Team({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const canManage = hasPermission(data.ctx.role, data.ctx.permissions, "team.manage");
	const isOwner = data.ctx.role === "owner";

	return (
		<Page>
			<PageTitle title="Team" aside={`${loaderData.members.length} ${loaderData.members.length === 1 ? "person" : "people"}`} />

			{canManage ? (
				<Card className="flex flex-col gap-4">
					<h2 className="text-base font-bold">Invite someone</h2>
					<Form method="post" className="flex flex-col gap-4" noValidate>
						<input type="hidden" name="intent" value="invite" />
						<Field label="Email" name="email" type="email" inputMode="email" autoComplete="off" required />
						{isOwner ? (
							<fieldset className="flex gap-2">
								<legend className="mb-1.5 text-sm font-semibold">Role</legend>
								<label className="flex items-center gap-2 rounded-pill border border-input-border bg-card px-4 py-2 text-sm font-semibold has-checked:border-cta has-checked:bg-mint has-checked:text-heading">
									<input type="radio" name="role" value="employee" defaultChecked className="sr-only" />
									Employee
								</label>
								<label className="flex items-center gap-2 rounded-pill border border-input-border bg-card px-4 py-2 text-sm font-semibold has-checked:border-cta has-checked:bg-mint has-checked:text-heading">
									<input type="radio" name="role" value="owner" className="sr-only" />
									Owner
								</label>
							</fieldset>
						) : (
							<input type="hidden" name="role" value="employee" />
						)}
						{actionData?.error ? <p role="alert" className="text-sm text-danger">{actionData.error}</p> : null}
						<Button type="submit" className="self-start">
							Create invitation
						</Button>
					</Form>
					{actionData?.inviteLink ? (
						<div className="flex flex-col gap-2 rounded-card bg-mint p-3.5">
							<span className="text-sm font-semibold text-heading">Send this link. It works once and expires in 7 days.</span>
							<code className="break-all rounded-input bg-card px-3 py-2 text-xs">{actionData.inviteLink}</code>
							<span className="text-xs text-ink-soft">Email delivery is added in a later build; for now copy and text it.</span>
						</div>
					) : null}
				</Card>
			) : null}

			{loaderData.pending.length > 0 ? (
				<section className="flex flex-col gap-2">
					<h2 className="px-0.5 text-base font-bold">Waiting to join</h2>
					<ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
						{loaderData.pending.map((p) => (
							<li key={p.id} className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
								<div className="flex min-w-0 flex-col">
									<span className="truncate text-sm font-semibold">{p.email}</span>
									<span className="text-xs text-ink-soft">{p.role === "owner" ? "Owner" : "Employee"} · invited</span>
								</div>
								{canManage ? (
									<Form method="post">
										<input type="hidden" name="intent" value="revoke" />
										<input type="hidden" name="invitationId" value={p.id} />
										<Button type="submit" variant="quiet" size="sm">Revoke</Button>
									</Form>
								) : null}
							</li>
						))}
					</ul>
				</section>
			) : null}

			<section className="flex flex-col gap-2">
				<h2 className="px-0.5 text-base font-bold">Members</h2>
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
