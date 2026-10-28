import type { Route } from "./+types/calendar";
import { Page } from "../../components/shell";
import { EmptyState, PageTitle } from "../../components/ui";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Calendar · K3 Dashboard" }];
}

export default function Calendar() {
	return (
		<Page>
			<PageTitle title="Calendar" />
			<EmptyState title="Coming in phase 3" body="Day and week views, and the booking sheet, are built after settings and team." />
		</Page>
	);
}
