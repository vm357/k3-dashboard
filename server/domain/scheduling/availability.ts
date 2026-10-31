import type { BookingPolicy } from "../businesses/hours";
import { addDays, localDateOf, type LocalDate, weekdayOf, zonedTimeToUtc } from "./time";

/**
 * The availability engine, as a pure function over plain data so it can be tested
 * without a database and reasoned about on its own. The appointments service
 * loads the inputs and calls `availableStarts`.
 *
 * A start is offered when the whole appointment (services plus the final buffer)
 * fits inside: business hours ∩ the employee's weekly availability, minus time
 * blocks, minus live appointments (which already include their buffers).
 */

export interface Interval {
	start: Date;
	end: Date;
}

export interface WeeklyRule {
	weekday: number;
	startsAt: string; // HH:MM local
	endsAt: string;
}

export interface AvailabilityInput {
	date: LocalDate;
	timeZone: string;
	businessHours: WeeklyRule[]; // opensAt/closesAt mapped to startsAt/endsAt
	employeeAvailability: WeeklyRule[];
	timeBlocks: Interval[]; // UTC
	liveAppointments: Interval[]; // UTC, end includes buffer
	totalMinutes: number; // services plus trailing buffer
	policy: BookingPolicy;
	now: Date;
	/** Staff may book inside the minimum notice; online booking may not. */
	ignoreNotice?: boolean;
}

/** Windows on `date` where the employee can work, in UTC, already clipped by hours and availability. */
export function workingWindows(input: Pick<AvailabilityInput, "date" | "timeZone" | "businessHours" | "employeeAvailability">): Interval[] {
	const wd = weekdayOf(input.date);
	const hours = input.businessHours.filter((r) => r.weekday === wd).map((r) => toInterval(input.date, r, input.timeZone));
	const avail = input.employeeAvailability.filter((r) => r.weekday === wd).map((r) => toInterval(input.date, r, input.timeZone));
	if (hours.length === 0 || avail.length === 0) return [];
	return intersect(hours, avail);
}

export function availableStarts(input: AvailabilityInput): Date[] {
	if (input.totalMinutes <= 0) return [];
	const windows = subtractAll(workingWindows(input), [...input.timeBlocks, ...input.liveAppointments]);
	const stepMs = input.policy.slotIntervalMinutes * 60000;
	const durMs = input.totalMinutes * 60000;
	const earliest = input.ignoreNotice ? input.now : new Date(input.now.getTime() + input.policy.minNoticeMinutes * 60000);
	const latestDate = addDays(localDateOf(input.now, input.timeZone), input.policy.maxAdvanceDays);
	const dayStartUtc = zonedTimeToUtc(input.date, "00:00", input.timeZone);
	if (!input.ignoreNotice && zonedTimeToUtc(latestDate, "00:00", input.timeZone).getTime() < dayStartUtc.getTime()) return [];

	// The grid is anchored to the local midnight of the day, so starts land on clean
	// marks (9:00, 9:15, ...) even when a gap opens at 10:10: the next offer is 10:15.
	const anchor = dayStartUtc.getTime();
	const starts: Date[] = [];
	for (const w of windows) {
		const first = anchor + Math.ceil((w.start.getTime() - anchor) / stepMs) * stepMs;
		for (let t = first; t + durMs <= w.end.getTime(); t += stepMs) {
			if (t < earliest.getTime()) continue;
			starts.push(new Date(t));
		}
	}
	return starts.sort((a, b) => a.getTime() - b.getTime());
}

/** Does [start, start + total) fit entirely in some working window with no conflicts? */
export function fits(input: Omit<AvailabilityInput, "policy" | "now" | "ignoreNotice">, start: Date): boolean {
	const end = new Date(start.getTime() + input.totalMinutes * 60000);
	const windows = subtractAll(workingWindows(input), [...input.timeBlocks, ...input.liveAppointments]);
	return windows.some((w) => w.start.getTime() <= start.getTime() && end.getTime() <= w.end.getTime());
}

function toInterval(date: LocalDate, r: WeeklyRule, tz: string): Interval {
	return { start: zonedTimeToUtc(date, r.startsAt, tz), end: zonedTimeToUtc(date, r.endsAt, tz) };
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
	const out: Interval[] = [];
	for (const x of a)
		for (const y of b) {
			const s = Math.max(x.start.getTime(), y.start.getTime());
			const e = Math.min(x.end.getTime(), y.end.getTime());
			if (s < e) out.push({ start: new Date(s), end: new Date(e) });
		}
	return merge(out);
}

export function subtractAll(windows: Interval[], holes: Interval[]): Interval[] {
	let current = merge(windows);
	for (const h of holes) {
		const next: Interval[] = [];
		for (const w of current) {
			if (h.end.getTime() <= w.start.getTime() || h.start.getTime() >= w.end.getTime()) {
				next.push(w);
				continue;
			}
			if (h.start.getTime() > w.start.getTime()) next.push({ start: w.start, end: h.start });
			if (h.end.getTime() < w.end.getTime()) next.push({ start: h.end, end: w.end });
		}
		current = next;
	}
	return current;
}

function merge(list: Interval[]): Interval[] {
	const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
	const out: Interval[] = [];
	for (const i of sorted) {
		const last = out[out.length - 1];
		if (last && i.start.getTime() <= last.end.getTime()) {
			if (i.end.getTime() > last.end.getTime()) last.end = i.end;
		} else out.push({ start: i.start, end: i.end });
	}
	return out;
}
