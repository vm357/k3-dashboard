/**
 * Display formatting shared by pages. Everything here is deterministic given its
 * inputs and an explicit time zone, so server and browser render the same text
 * (React hydration requires it). Pages pass the business's time zone, never the
 * device's.
 */

export function formatPhone(e164: string | null | undefined): string {
	if (!e164) return "";
	const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
	if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
	return e164;
}

export function formatDate(value: Date | string, timeZone: string, style: "short" | "monthYear" | "full" = "short"): string {
	const d = new Date(value);
	const opts: Intl.DateTimeFormatOptions =
		style === "monthYear" ? { month: "short", year: "numeric" } : style === "full" ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
	return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(d);
}

export function formatDateTimeRange(start: Date | string, end: Date | string, timeZone: string): string {
	const f = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
	return `${f.format(new Date(start))} to ${f.format(new Date(end))}`;
}
