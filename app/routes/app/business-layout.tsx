import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/business-layout";
import { AppShell } from "../../components/shell";
import { ButtonLink } from "../../components/ui";
import { requireTenant, services } from "../../../server/auth/session";
import { getBusiness } from "../../../server/domain/businesses/service";

/**
 * Every /app/:business/* page sits inside this layout. The loader is the route-layer
 * isolation check: no membership, no page (404). Children read the ctx through
 * useBusiness() and never trust the URL param on their own.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { user, ctx } = await requireTenant(db, auth, request, params.business!);
	const business = await getBusiness(db, ctx);
	if (!business) throw new Response("Not found", { status: 404 });
	return {
		user: { name: user.name },
		ctx: { role: ctx.role, permissions: [...ctx.permissions], businessSlug: ctx.businessSlug },
		business: { name: business.name, timeZone: business.timeZone, status: business.status },
	};
}

export function useBusiness() {
	return useLoaderData<typeof loader>();
}

export default function BusinessLayout({ loaderData }: Route.ComponentProps) {
	const base = `/app/${loaderData.ctx.businessSlug}`;
	return (
		<AppShell
			base={base}
			businessName={loaderData.business.name}
			userName={loaderData.user.name}
			action={
				<ButtonLink to={`${base}/calendar`} className="w-full">
					New appointment
				</ButtonLink>
			}
		>
			{loaderData.business.status === "suspended" ? (
				<div role="status" className="bg-feature px-5 py-2 text-center text-sm text-on-dark">
					This account is suspended. Contact Kermit Webcraft to reactivate it.
				</div>
			) : null}
			<Outlet />
		</AppShell>
	);
}
