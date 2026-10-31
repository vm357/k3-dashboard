import { Form, Link } from "react-router";
import type { Route } from "./+types/businesses";
import { Avatar, Badge, Button, ButtonLink, EmptyState, PageTitle } from "../../components/ui";
import { requireAdmin, services } from "../../../server/auth/session";
import { listBusinesses, setBusinessStatus } from "../../../server/domain/admin/service";
import { formatDate } from "../../lib/format";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Businesses · Kermit admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireAdmin(auth, request);
	return { businesses: await listBusinesses(db, ctx) };
}

export async function action({ request, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireAdmin(auth, request);
	const form = await request.formData();
	const status = form.get("status") === "suspended" ? "suspended" : "active";
	const reason = String(form.get("reason") ?? "");
	if (reason.trim().length < 3) return { error: "Give a reason; it goes in the audit log." };
	await setBusinessStatus(db, ctx, String(form.get("businessId")), status, reason);
	return { error: undefined };
}

export default function Businesses({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<>
			<PageTitle title="Businesses" aside={`${loaderData.businesses.length} total`} />
			<ButtonLink to="/admin/businesses/new" className="self-start">
				Add a business
			</ButtonLink>
			{actionData?.error ? <p role="alert" className="text-sm text-danger">{actionData.error}</p> : null}
			{loaderData.businesses.length === 0 ? (
				<EmptyState title="No businesses yet" body="Add the first client business and send its owner the invitation link." />
			) : (
				<ul className="flex flex-col gap-2">
					{loaderData.businesses.map((b) => (
						<li key={b.id} className="flex flex-col gap-3 rounded-card bg-card p-4 shadow-card sm:flex-row sm:items-center">
							<Avatar name={b.name} />
							<div className="flex min-w-0 flex-1 flex-col">
								<Link to={`/app/${b.slug}`} className="truncate font-semibold text-heading">
									{b.name}
								</Link>
								<span className="text-sm text-ink-soft">
									/{b.slug} · since {formatDate(b.createdAt, "America/New_York")}
								</span>
							</div>
							<Badge variant={b.status === "active" ? "green" : "danger"}>{b.status === "active" ? "Active" : "Suspended"}</Badge>
							<Form method="post" className="flex items-center gap-2">
								<input type="hidden" name="businessId" value={b.id} />
								<input type="hidden" name="status" value={b.status === "active" ? "suspended" : "active"} />
								<input
									name="reason"
									placeholder="Reason"
									aria-label="Reason"
									required
									className="min-h-10 w-36 rounded-input border border-input-border bg-card px-3 text-sm"
								/>
								<Button type="submit" variant={b.status === "active" ? "danger" : "outlined"} size="sm">
									{b.status === "active" ? "Suspend" : "Reactivate"}
								</Button>
							</Form>
						</li>
					))}
				</ul>
			)}
		</>
	);
}
