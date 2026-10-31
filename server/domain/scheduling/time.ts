/**
 * Time-zone arithmetic without a library. Everything in the database is UTC;
 * business hours and staff availability are local wall-clock times. These helpers
 * convert between the two using Intl, which Workers and Node both ship.
 */

export interface LocalDate {
	year: number;
	month: number; // 1 to 12
	day: number; // 1 to 31
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string): Intl.DateTimeFormat {
	let f = fmtCache.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			weekday: "short",
		});
		fmtCache.set(timeZone, f);
	}
	return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock parts of an instant in a zone. */
export function partsInZone(instant: Date, timeZone: string) {
	const out: Record<string, string> = {};
	for (const p of fmt(timeZone).formatToParts(instant)) if (p.type !== "literal") out[p.type] = p.value;
	return {
		year: Number(out.year),
		month: Number(out.month),
		day: Number(out.day),
		hour: Number(out.hour) % 24,
		minute: Number(out.minute),
		second: Number(out.second),
		weekday: WEEKDAY_INDEX[out.weekday] ?? 0,
	};
}

/** Offset of `timeZone` from UTC, in minutes, at a given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
	const p = partsInZone(instant, timeZone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * The instant at which `date` `hh:mm` occurs in `timeZone`. On a DST "spring
 * forward" gap the nonexistent time resolves to the instant after the gap; on a
 * "fall back" overlap the first occurrence is used. Both are what a salon expects.
 */
export function zonedTimeToUtc(date: LocalDate, hhmm: string, timeZone: string): Date {
	const [h, m] = hhmm.split(":").map(Number);
	const naive = Date.UTC(date.year, date.month - 1, date.day, h, m, 0);
	// Two-pass fixed point: guess with the offset at the naive instant, then re-check.
	const off1 = offsetMinutes(new Date(naive), timeZone);
	let guess = naive - off1 * 60000;
	const off2 = offsetMinutes(new Date(guess), timeZone);
	if (off2 !== off1) guess = naive - off2 * 60000;
	return new Date(guess);
}

/** The calendar date, in `timeZone`, that `instant` falls on. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
	const p = partsInZone(instant, timeZone);
	return { year: p.year, month: p.month, day: p.day };
}

export function addDays(date: LocalDate, days: number): LocalDate {
	const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
	return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Weekday (0 = Sunday) of a local date, zone-independent since it is a pure calendar question. */
export function weekdayOf(date: LocalDate): number {
	return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function parseLocalDate(iso: string): LocalDate | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return null;
	const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
	if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31) return null;
	return d;
}

export function formatLocalDate(d: LocalDate): string {
	return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function sameLocalDate(a: LocalDate, b: LocalDate): boolean {
	return a.year === b.year && a.month === b.month && a.day === b.day;
}
