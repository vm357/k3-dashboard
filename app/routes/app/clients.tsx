import type { Route } from "./+types/clients";
import { Page } from "../../components/shell";
import { EmptyState, PageTitle } from "../../components/ui";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Clients · K3 Dashboard" }];
}

export default function Clients() {
	return (
		<Page>
			<PageTitle title="Clients" />
			<EmptyState title="No clients yet" body="Clients are created when you book their first appointment, or added here in phase 2." />
		</Page>
	);
}
