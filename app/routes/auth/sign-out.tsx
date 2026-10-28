import { redirect } from "react-router";
import type { Route } from "./+types/sign-out";
import { services } from "../../../server/auth/session";

/** POST only; a GET just goes to sign-in so a stray link cannot sign someone out. */
export async function action({ request, context }: Route.ActionArgs) {
	const { auth } = services(context);
	const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
	const headers = new Headers();
	for (const [k, v] of response.headers) if (k.toLowerCase() === "set-cookie") headers.append("set-cookie", v);
	throw redirect("/sign-in", { headers });
}

export function loader() {
	throw redirect("/sign-in");
}

export default function SignOut() {
	return null;
}
