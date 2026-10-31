import { Link } from "react-router";
import { Avatar, Card } from "./ui";
import { formatDate } from "../lib/format";

/**
 * "Due for a visit": clients whose usual gap between visits has passed with nothing
 * booked. Each row books straight into the flow with the client preselected.
 */
export function DueList({
	due,
	base,
	timeZone,
	compact = false,
}: {
	due: { customerId: string; name: string; lastVisit: string; typicalDays: number; overdueDays: number }[];
	base: string;
	timeZone: string;
	compact?: boolean;
}) {
	return (
		<Card className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between">
				<h2 className="text-base font-bold">Due for a visit</h2>
				{compact ? <Link to={`${base}/clients`} className="text-sm font-semibold text-cta">All clients</Link> : null}
			</div>
			<ul className="flex flex-col">
				{due.map((c) => (
					<li key={c.customerId} className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0">
						<Avatar name={c.name} size={32} />
						<Link to={`${base}/clients/${c.customerId}`} className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-semibold text-heading">{c.name}</span>
							<span className="truncate text-xs text-ink-soft">
								Last {formatDate(c.lastVisit, timeZone)} · every {c.typicalDays} days
							</span>
						</Link>
						<Link to={`${base}/book?client=${c.customerId}`} className="press shrink-0 rounded-pill border border-input-border px-3 py-1.5 text-xs font-semibold text-heading">
							Book
						</Link>
					</li>
				))}
			</ul>
		</Card>
	);
}
