/**
 * Client status as a small pill. Active has no pill (it's the normal case); "New" means no
 * completed visits yet and only shows while the client is Active.
 */
const TAGS = {
	vip: { label: "VIP", className: "bg-[#f6eedd] text-[#6b4f14]" },
	new: { label: "New", className: "bg-mint text-heading" },
	inactive: { label: "Inactive", className: "bg-canvas-alt text-ink-soft" },
	do_not_book: { label: "Do not book", className: "bg-danger text-on-dark" },
	archived: { label: "Archived", className: "border border-input-border bg-card text-ink-soft" },
} as const;

export const STATUS_OPTIONS = [
	{ value: "active", label: "Active" },
	{ value: "vip", label: "VIP" },
	{ value: "inactive", label: "Inactive" },
	{ value: "do_not_book", label: "Do not book" },
] as const;

export function ClientTag({ status, isNew, archived }: { status: string; isNew?: boolean; archived?: boolean }) {
	const key = archived ? "archived" : status === "active" ? (isNew ? "new" : null) : (status as keyof typeof TAGS);
	if (!key || !(key in TAGS)) return null;
	const t = TAGS[key];
	return <span className={`inline-flex shrink-0 items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${t.className}`}>{t.label}</span>;
}

export function AllergyFlag({ allergy }: { allergy: string | null | undefined }) {
	if (!allergy) return null;
	return (
		<span title={`Allergy: ${allergy}`} className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-[#fbeceb] px-2.5 py-0.5 text-xs font-bold text-danger">
			<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-danger" />
			Allergy
		</span>
	);
}

/** Full-width red notice with the allergy text, for profiles and the appointment panel. */
export function AllergyNotice({ allergy }: { allergy: string | null | undefined }) {
	if (!allergy) return null;
	return (
		<p role="note" className="flex items-start gap-2 rounded-card border border-danger bg-[#fbeceb] px-4 py-3 text-sm text-danger">
			<span className="font-bold">Allergy:</span>
			<span className="text-ink">{allergy}</span>
		</p>
	);
}
