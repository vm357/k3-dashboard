import type { Route } from "./+types/no-business";
import { Button } from "../../components/ui";
import { requireUser, services } from "../../../server/auth/session";

export async function loader({ request, context }: Route.LoaderArgs) {
	const { auth } = services(context);
	const user = await requireUser(auth, request);
	return { name: user.name };
}

export default function NoBusiness({ loaderData }: Route.ComponentProps) {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
			<h1 className="text-2xl font-bold text-heading">Hi {loaderData.name}, you are not part of a business yet</h1>
			<p className="max-w-sm text-ink-soft">
				Ask the business owner to invite you, or contact Kermit Webcraft if your business is still being set up.
			</p>
			<form method="post" action="/sign-out">
				<Button type="submit" variant="outlined">
					Sign out
				</Button>
			</form>
		</main>
	);
}
