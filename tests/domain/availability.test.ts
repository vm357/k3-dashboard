import { describe, expect, it } from "vitest";
import { availableStarts, fits, workingWindows } from "../../server/domain/scheduling/availability";
import { localDateOf, partsInZone, zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { readPolicy } from "../../server/domain/businesses/hours";

const NY = "America/New_York";
const policy = readPolicy({ slotIntervalMinutes: 15, minNoticeMinutes: 120, maxAdvanceDays: 60 });
const hours = [{ weekday: 2, startsAt: "09:00", endsAt: "17:00" }];
const avail = [{ weekday: 2, startsAt: "09:00", endsAt: "17:00" }];
const tue = { year: 2026, month: 11, day: 10 }; // a Tuesday, EST
const hhmm = (d: Date) => { const p = partsInZone(d, NY); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };

describe("time zone helpers", () => {
	it("converts local wall time to UTC with the right offset", () => {
		expect(zonedTimeToUtc({ year: 2026, month: 7, day: 1 }, "09:00", NY).toISOString()).toBe("2026-07-01T13:00:00.000Z"); // EDT
		expect(zonedTimeToUtc({ year: 2026, month: 12, day: 1 }, "09:00", NY).toISOString()).toBe("2026-12-01T14:00:00.000Z"); // EST
	});
	it("handles the spring-forward gap and the fall-back overlap", () => {
		// 2026-03-08 02:30 does not exist in New York; resolves to after the gap (03:30 EDT = 06:30Z)
		expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8 }, "02:30", NY).toISOString()).toBe("2026-03-08T06:30:00.000Z");
		// 2026-11-01 01:30 happens twice; first occurrence is EDT (05:30Z)
		expect(zonedTimeToUtc({ year: 2026, month: 11, day: 1 }, "01:30", NY).toISOString()).toBe("2026-11-01T05:30:00.000Z");
	});
	it("gives the local date of an instant near midnight", () => {
		expect(localDateOf(new Date("2026-11-11T03:30:00Z"), NY)).toEqual({ year: 2026, month: 11, day: 10 });
	});
});

describe("availability engine", () => {
	const base = { date: tue, timeZone: NY, businessHours: hours, employeeAvailability: avail, timeBlocks: [], liveAppointments: [], policy, now: new Date("2026-11-01T12:00:00Z") };

	it("offers every slot where the whole appointment fits, on the interval grid", () => {
		const starts = availableStarts({ ...base, totalMinutes: 60 });
		expect(hhmm(starts[0])).toBe("09:00");
		expect(hhmm(starts[starts.length - 1])).toBe("16:00");
		expect(starts.length).toBe(29);
	});

	it("clips to the narrower of business hours and the employee's availability", () => {
		const w = workingWindows({ ...base, employeeAvailability: [{ weekday: 2, startsAt: "11:00", endsAt: "19:00" }] });
		expect(w).toHaveLength(1);
		expect(hhmm(w[0].start)).toBe("11:00");
		expect(hhmm(w[0].end)).toBe("17:00");
	});

	it("subtracts time blocks and live appointments including their buffers", () => {
		const block = { start: zonedTimeToUtc(tue, "12:00", NY), end: zonedTimeToUtc(tue, "13:00", NY) };
		const appt = { start: zonedTimeToUtc(tue, "09:00", NY), end: zonedTimeToUtc(tue, "10:10", NY) }; // 60 min + 10 buffer
		const starts = availableStarts({ ...base, totalMinutes: 45, timeBlocks: [block], liveAppointments: [appt] }).map(hhmm);
		expect(starts[0]).toBe("10:15"); // first clean mark after the 10:10 end
		expect(starts).not.toContain("11:30"); // 11:30 + 45 crosses the 12:00 block
		expect(starts).toContain("11:15");
		expect(starts).toContain("13:00");
	});

	it("respects minimum notice unless staff override it", () => {
		const now = zonedTimeToUtc(tue, "10:00", NY);
		const online = availableStarts({ ...base, totalMinutes: 30, now }).map(hhmm);
		expect(online[0]).toBe("12:00"); // 2h notice
		const staff = availableStarts({ ...base, totalMinutes: 30, now, ignoreNotice: true }).map(hhmm);
		expect(staff[0]).toBe("10:00");
	});

	it("offers nothing past the maximum advance window, on a closed day, or when nothing fits", () => {
		expect(availableStarts({ ...base, totalMinutes: 30, now: new Date("2026-01-01T12:00:00Z") })).toHaveLength(0); // > 60 days out
		expect(availableStarts({ ...base, totalMinutes: 30, date: { year: 2026, month: 11, day: 11 } })).toHaveLength(0); // Wednesday, closed
		expect(availableStarts({ ...base, totalMinutes: 9 * 60 })).toHaveLength(0);
	});

	it("fits() agrees with the offered starts", () => {
		const input = { ...base, totalMinutes: 60 };
		expect(fits(input, zonedTimeToUtc(tue, "16:00", NY))).toBe(true);
		expect(fits(input, zonedTimeToUtc(tue, "16:15", NY))).toBe(false);
		expect(fits(input, zonedTimeToUtc(tue, "08:45", NY))).toBe(false);
	});

	it("works across the fall-back DST day without duplicating or losing an hour", () => {
		const sun = { year: 2026, month: 11, day: 1 };
		const sunHours = [{ weekday: 0, startsAt: "09:00", endsAt: "12:00" }];
		const starts = availableStarts({ ...base, date: sun, businessHours: sunHours, employeeAvailability: sunHours, totalMinutes: 60, now: new Date("2026-10-25T12:00:00Z") });
		expect(starts.map(hhmm)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30", "10:45", "11:00"]);
		expect(starts[0].toISOString()).toBe("2026-11-01T14:00:00.000Z"); // 09:00 EST after fall back
	});
});
