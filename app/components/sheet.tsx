import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * Direction A's bottom sheet: a panel that rises from the bottom on phones and sits
 * centred on desktop. The page behind stays rendered under a house-green scrim.
 * Used by every create/edit form so they feel like one gesture across the product.
 * `closeTo` is the URL the Cancel link and the scrim return to.
 */
export function Sheet({ title, closeTo, children, footer }: { title: string; closeTo: string; children: ReactNode; footer?: ReactNode }) {
	return (
		<div className="fixed inset-0 z-30 flex flex-col justify-end bg-feature/90 lg:items-center lg:justify-center">
			<Link to={closeTo} aria-label="Close" className="absolute inset-0" tabIndex={-1} />
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby="sheet-title"
				className="relative flex max-h-[92dvh] w-full flex-col rounded-t-[20px] bg-canvas shadow-nav lg:max-h-[85dvh] lg:max-w-lg lg:rounded-card"
			>
				<div className="flex justify-center pt-2.5 lg:hidden">
					<span aria-hidden="true" className="h-1 w-10 rounded-full bg-ink/20" />
				</div>
				<div className="flex items-center justify-between px-5 pt-2 pb-1 lg:px-6 lg:pt-6">
					<h1 id="sheet-title" className="text-[22px] font-bold text-heading">
						{title}
					</h1>
					<Link to={closeTo} className="press py-2 text-sm font-semibold text-ink-soft">
						Cancel
					</Link>
				</div>
				<div className="flex-1 overflow-y-auto px-5 pt-2 pb-4 lg:px-6">{children}</div>
				{footer ? <div className="bg-card px-5 pt-3 pb-7 shadow-nav lg:rounded-b-card lg:px-6 lg:pb-5">{footer}</div> : null}
			</section>
		</div>
	);
}
