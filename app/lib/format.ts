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

export function formatTime(value: Date | string, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value)).replace(":00", "").toLowerCase().replace(" ", "");
}

export function formatTimeRange(start: Date | string, end: Date | string, timeZone: string): string {
	return `${formatTime(start, timeZone)} to ${formatTime(end, timeZone)}`;
}

/** "in 25 min", "in 2 h", "now", "started 10 min ago"; null when more than a day away. */
export function relativeStart(start: Date | string, now: Date): string | null {
	const diff = (new Date(start).getTime() - now.getTime()) / 60000;
	if (diff > 24 * 60) return null;
	if (diff <= -1) return `started ${Math.round(-diff)} min ago`;
	if (diff < 1) return "now";
	if (diff < 60) return `in ${Math.round(diff)} min`;
	const h = Math.floor(diff / 60);
	const m = Math.round(diff % 60);
	return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

export function formatMinutes(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} min`;
	if (m === 0) return `${h} h`;
	return `${h} h ${m}`;
}

export function formatCents(cents: number): string {
	return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}

export const STATUS_LABEL: Record<string, string> = {
	held: "Held",
	confirmed: "Confirmed",
	checked_in: "Checked in",
	completed: "Done",
	cancelled: "Cancelled",
	no_show: "No-show",
	rescheduled: "Rescheduled",
	expired: "Expired",
};
