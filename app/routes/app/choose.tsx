import { Link, redirect } from "react-router";
import type { Route } from "./+types/choose";
import { Avatar, PageTitle } from "../../components/ui";
import { listMemberships } from "../../../server/auth/ctx";
import { requireUser, services } from "../../../server/auth/session";

export async function loader({ request, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const user = await requireUser(auth, request);
	const memberships = await listMemberships(db, user.id);
	if (memberships.length === 1) throw redirect(`/app/${memberships[0].slug}`);
	if (memberships.length === 0) throw redirect(user.isPlatformAdmin ? "/admin" : "/no-business");
	return { memberships };
}

export default function Choose({ loaderData }: Route.ComponentProps) {
	return (
		<main className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-12">
			<PageTitle title="Choose a business" />
			<ul className="flex flex-col gap-2">
				{loaderData.memberships.map((m) => (
					<li key={m.businessId}>
						<Link to={`/app/${m.slug}`} className="press flex items-center gap-3 rounded-card bg-card p-4 shadow-card">
							<Avatar name={m.name} />
							<span className="flex flex-col">
								<span className="font-semibold">{m.name}</span>
								<span className="text-sm text-ink-soft">{m.role === "owner" ? "Owner" : "Employee"}</span>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</main>
	);
}
