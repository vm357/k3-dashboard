import { NavLink, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requireAdmin, services } from "../../../server/auth/session";

/**
 * Kermit admin. Gated on users.is_platform_admin; a non-admin gets 404 so the area's
 * existence is not confirmed. TOTP arrives in phase 8.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { auth } = services(context);
	const { user } = await requireAdmin(auth, request);
	return { user: { name: user.name } };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
	return (
		<div className="min-h-dvh">
			<header className="flex items-center justify-between gap-4 bg-feature px-5 py-4 text-on-dark lg:px-10">
				<div className="flex items-center gap-3">
					<span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-xs font-extrabold text-heading">
						K3
					</span>
					<span className="text-sm font-bold">Kermit admin</span>
					<nav aria-label="Admin" className="ml-4 flex gap-1">
						<NavLink
							to="/admin"
							end
							className={({ isActive }) =>
								`rounded-pill px-3.5 py-1.5 text-sm font-semibold ${isActive ? "bg-on-dark/20 text-on-dark" : "text-on-dark-soft"}`
							}
						>
							Businesses
						</NavLink>
					</nav>
				</div>
				<div className="flex items-center gap-3 text-sm">
					<span className="hidden text-on-dark-soft sm:inline">{loaderData.user.name}</span>
					<form method="post" action="/sign-out">
						<button type="submit" className="press rounded-pill border border-on-dark px-3.5 py-1.5 text-sm font-semibold">
							Sign out
						</button>
					</form>
				</div>
			</header>
			<main className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 lg:px-10">
				<Outlet />
			</main>
		</div>
	);
}
