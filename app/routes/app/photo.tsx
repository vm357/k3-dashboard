import type { Route } from "./+types/photo";
import { envContext } from "../../../server/context";
import { requireTenant, services } from "../../../server/auth/session";
import { readPhoto } from "../../../server/domain/photos/service";

/** Streams one nail photo after the membership and row-level checks. Never cached publicly. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const photo = await readPhoto(db, ctx, context.get(envContext).PHOTOS, params.photoId!).catch(() => null);
	if (!photo) throw new Response("Not found", { status: 404 });
	return new Response(photo.body, { headers: { "content-type": photo.contentType, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}
