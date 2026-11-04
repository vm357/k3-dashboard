import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, listSlots } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { addClosedDays, closedDates, listClosedDays, listRange, removeClosedDay } from "../../server/domain/calendar/service";
import { createCustomer } from "../../server/domain/customers/service";
import { addMember, listMembers } from "../../server/domain/members/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, createTimeBlock, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const at = (d: number, hhmm: string) => zonedTimeToUtc({ year: 2026, month: 11, day: d }, hhmm, NY);
const NOW = at(1, "08:00");
const OPEN = [1, 2, 3, 4, 5, 6]; // Sunday closed

describe("calendar: week and month ranges, closed days", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let staff: TenantCtx;
	let otherOwner: TenantCtx;
	let lina: { id: string };
	let gel: { id: string };
	let maya: { id: string };

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true as const });
		const admin = { userId: a.id, isPlatformAdmin: true as const };
		const o = await seedUser(db);
		const o2 = await seedUser(db);
		await createBusiness(db, admin, o.id, { name: "Lina", slug: "cal-mine", timeZone: NY });
		await createBusiness(db, admin, o2.id, { name: "Other", slug: "cal-theirs", timeZone: NY });
		owner = (await resolveTenantCtx(db, o.id, "cal-mine"))!;
		otherOwner = (await resolveTenantCtx(db, o2.id, "cal-theirs"))!;
		await setHours(db, owner, OPEN.map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "17:00" })));
		await setPolicy(db, owner, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
		gel = await createService(db, owner, { name: "Gel fill", durationMinutes: 60, priceCents: 4500 });
		const memberId = (await listMembers(db, owner)).find((m) => m.userId === o.id)!.id;
		lina = await createEmployee(db, owner, { displayName: "Lina", memberId });
		await setEmployeeServices(db, owner, lina.id, [gel.id]);
		await setEmployeeAvailability(db, owner, lina.id, OPEN.map((weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00" })));
		maya = await createCustomer(db, owner, { firstName: "Maya" });
		const e = await seedUser(db);
		await addMember(db, owner, { userId: e.id, role: "employee" });
		staff = (await resolveTenantCtx(db, e.id, "cal-mine"))!;
	});
	afterAll(() => close());

	it("adds a closed day that removes availability and warns about bookings already on it", async () => {
		await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(27, "10:00"), customerId: maya.id });
		const r = await addClosedDays(db, owner, { from: "2026-11-26", to: "2026-11-27", label: "Thanksgiving" });
		expect(r.bookingsOnClosedDays).toBe(1);
		expect((await listSlots(db, owner, { employeeId: lina.id, serviceIds: [gel.id], date: "2026-11-26", now: NOW })).starts).toEqual([]);
		expect((await listSlots(db, owner, { employeeId: lina.id, serviceIds: [gel.id], date: "2026-11-28", now: NOW })).starts.length).toBeGreaterThan(0);
		await expect(bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(26, "11:00"), customerId: maya.id })).rejects.toMatchObject({ code: "slot_unavailable" });
		const list = await listClosedDays(db, owner, NOW);
		expect(list).toEqual([{ id: r.id, from: "2026-11-26", to: "2026-11-27", label: "Thanksgiving" }]);
	});

	it("a week range marks Sundays and closed days, and shows staff blocks", async () => {
		await createTimeBlock(db, owner, { employeeId: lina.id, kind: "time_off", startAt: at(24, "13:00"), endAt: at(24, "15:00"), reason: "Dentist" });
		const week = await listRange(db, owner, "2026-11-22", 7);
		const byDay = Object.fromEntries(week.days.map((d) => [d.iso, d]));
		expect(byDay["2026-11-22"].closed).toEqual({ label: "Closed", holiday: false });
		expect(byDay["2026-11-26"].closed).toEqual({ label: "Thanksgiving", holiday: true });
		expect(byDay["2026-11-25"].closed).toBeNull();
		expect(byDay["2026-11-24"].blocks.map((b) => [b.employeeName, b.reason, b.allDay])).toEqual([["Lina", "Dentist", false]]);
		expect(byDay["2026-11-27"].items.length).toBe(1);
		expect(byDay["2026-11-26"].blocks).toEqual([]);
	});

	it("a month grid range is capped and closedDates returns labels", async () => {
		const m = await listRange(db, owner, "2026-11-01", 99);
		expect(m.days.length).toBe(42);
		const c = await closedDates(db, owner, "2026-11-22", 7);
		expect(c["2026-11-26"]).toBe("Thanksgiving");
		expect(c["2026-11-22"]).toBe("Closed");
	});

	it("only settings.edit can add or remove closed days; ranges are checked", async () => {
		await expect(addClosedDays(db, staff, { from: "2026-12-24" })).rejects.toBeInstanceOf(ForbiddenError);
		await expect(addClosedDays(db, owner, { from: "2026-12-26", to: "2026-12-24" })).rejects.toMatchObject({ code: "bad_range" });
		await expect(addClosedDays(db, owner, { from: "2026-12-01", to: "2027-01-15" })).rejects.toMatchObject({ code: "bad_range" });
		const r = await addClosedDays(db, owner, { from: "2026-12-24" });
		await expect(removeClosedDay(db, staff, r.id)).rejects.toBeInstanceOf(ForbiddenError);
		await removeClosedDay(db, owner, r.id);
		expect((await listClosedDays(db, owner, NOW)).some((x) => x.id === r.id)).toBe(false);
	});

	it("never shows or removes another salon's closed days", async () => {
		const theirs = await addClosedDays(db, otherOwner, { from: "2026-11-25", label: "Their day" });
		const week = await listRange(db, owner, "2026-11-22", 7);
		expect(week.days.find((d) => d.iso === "2026-11-25")!.closed).toBeNull();
		await expect(removeClosedDay(db, owner, theirs.id)).rejects.toMatchObject({ code: "time_block_not_found" });
	});
});
