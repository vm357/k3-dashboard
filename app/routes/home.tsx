import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { getUser, homeFor, services } from "../../server/auth/session";

/** The root only routes: signed in goes home, signed out goes to sign-in. */
export async function loader({ request, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const user = await getUser(auth, request);
	if (!user) throw redirect("/sign-in");
	throw redirect(await homeFor(db, user));
}

export default function Home() {
	return null;
}
