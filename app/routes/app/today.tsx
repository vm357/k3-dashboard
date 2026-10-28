import { useRouteLoaderData } from "react-router";
import type { Route } from "./+types/today";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Card, EmptyState, PageTitle } from "../../components/ui";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Today · K3 Dashboard" }];
}

/**
 * Today, Direction A: a dark "next up" card, then the day's timeline. Until appointments
 * exist (phase 3) this shows the real business and an honest empty state, not mock data.
 */
export default function Today() {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const today = new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: data.business.timeZone,
	}).format(new Date());
	const first = data.user.name.split(" ")[0];

	return (
		<Page>
			<PageTitle eyebrow={`Hi ${first}`} title="Today" aside={today} />
			<Card tone="feature" className="flex flex-col gap-2">
				<span className="text-sm text-on-dark-soft">Next up</span>
				<span className="text-2xl font-bold">No one yet</span>
				<span className="text-sm text-on-dark-soft">Appointments you add will show here, soonest first.</span>
			</Card>
			<EmptyState
				title="Nothing booked today"
				body="The calendar and appointment form arrive in the next build. Until then, settings and your team are ready to set up."
			/>
		</Page>
	);
}
