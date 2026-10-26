import type { Route } from "./+types/home";
import { envContext } from "../../server/context";

/**
 * Placeholder landing route. The sign-in page, the /app/:business dashboard layout
 * and the /admin layout arrive with the approved design direction (phase 2, dashboard
 * core). Until then this route only proves the Worker, env and React Router wiring.
 */
export function meta(): Route.MetaDescriptors {
	return [{ title: "K3 Dashboard" }];
}

export function loader({ context }: Route.LoaderArgs) {
	const env = context.get(envContext);
	return { appEnv: env.APP_ENV };
}

export default function Home({ loaderData }: Route.ComponentProps) {
	return (
		<main>
			<h1>K3 Dashboard</h1>
			<p>Foundation build. Environment: {loaderData.appEnv}.</p>
		</main>
	);
}
