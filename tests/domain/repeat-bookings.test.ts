import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTenantCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, bookSeries, cancelSeriesFrom, getAppointment, listSeries, previewSeries, reschedule } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { addClosedDays } from "../../server/domain/calendar/service";
import { createCustomer, listCustomers } from "../../server/domain/customers/service";
import { listMembers } from "../../server/domain/members/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const at = (y: number, m: number, d: number, hhmm: string) => zonedTimeToUtc({ year: y, month: m, day: d }, hhmm, NY);

describe("repeat bookings", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let other: TenantCtx;
	let lina: { id: string };
	let gel: { id: string };
	let maya: { id: string };
	let ava: { id: string };

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true as const });
		const admin = { userId: a.id, isPlatformAdmin: true as const };
		const o = await seedUser(db);
		const o2 = await seedUser(db);
		await createBusiness(db, admin, o.id, { name: "Lina", slug: "rep-mine", timeZone: NY });
		await createBusiness(db, admin, o2.id, { name: "Other", slug: "rep-theirs", timeZone: NY });
		owner = (await resolveTenantCtx(db, o.id, "rep-mine"))!;
		other = (await resolveTenantCtx(db, o2.id, "rep-theirs"))!;
		await setHours(db, owner, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "17:00" })));
		await setPolicy(db, owner, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
		gel = await createService(db, owner, { name: "Gel fill", durationMinutes: 60, priceCents: 4500 });
		const memberId = (await listMembers(db, owner)).find((m) => m.userId === o.id)!.id;
		lina = await createEmployee(db, owner, { displayName: "Lina", memberId });
		await setEmployeeServices(db, owner, lina.id, [gel.id]);
		await setEmployeeAvailability(db, owner, lina.id, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00" })));
		maya = await createCustomer(db, owner, { firstName: "Maya" });
		ava = await createCustomer(db, owner, { firstName: "Ava" });
	});
	afterAll(() => close());

	it("previews every date, keeping local time across the DST change and marking closed and taken dates", async () => {
		// Thursdays every 3 weeks from Oct 15 2026: Oct 15, Nov 5, Nov 26 (Thanksgiving), Dec 17.
		await addClosedDays(db, owner, { from: "2026-11-26", label: "Thanksgiving" });
		await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(2026, 12, 17, "10:30"), customerId: ava.id });
		const plan = await previewSeries(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(2026, 10, 15, "10:00"), everyWeeks: 3, count: 4 });
		expect(plan.map((p) => [p.date, p.status, p.label])).toEqual([
			["2026-10-15", "ok", null],
			["2026-11-05", "ok", null],
			["2026-11-26", "closed", "Thanksgiving"],
			["2026-12-17", "taken", "Time taken"],
		]);
		expect(plan[1].startAt.toISOString()).toBe(at(2026, 11, 5, "10:00").toISOString()); // EST, not 9am
	});

	it("books what fits under one series id and skips the rest", async () => {
		const r = await bookSeries(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(2026, 10, 15, "10:00"), customerId: maya.id, everyWeeks: 3, count: 4 });
		expect(r.booked.length).toBe(2);
		expect(r.skipped.map((s) => s.status)).toEqual(["closed", "taken"]);
		const series = await listSeries(db, owner, r.seriesId);
		expect(series.map((s) => s.id)).toEqual(r.booked.map((b) => b.id));
		expect((await getAppointment(db, owner, r.booked[1].id))!.seriesId).toBe(r.seriesId);
	});

	it("creates a new client once, not once per visit", async () => {
		const r = await bookSeries(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(2026, 10, 16, "14:00"), newCustomer: { firstName: "Walkin", lastName: "Repeat" }, everyWeeks: 2, count: 4 });
		expect(r.booked.length).toBe(4);
		expect(new Set(r.booked.map((b) => b.customerId)).size).toBe(1);
		expect((await listCustomers(db, owner, { query: "Walkin" })).length).toBe(1);
	});

	it("refuses when the first date is not free", async () => {
		await expect(bookSeries(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(2026, 11, 26, "10:00"), customerId: maya.id, everyWeeks: 2, count: 4 })).rejects.toMatchObject({ code: "slot_unavailable" });
	});

	it("a moved visit stays in the series; cancelling from one visit cancels it and the later ones", async () => {
		const r = await bookSeries(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(2026, 10, 17, "09:00"), customerId: ava.id, everyWeeks: 4, count: 4 });
		expect(r.booked.length).toBe(4);
		const moved = await reschedule(db, owner, r.booked[1].id, at(2026, 11, 14, "11:00"));
		expect(moved.seriesId).toBe(r.seriesId);
		const n = await cancelSeriesFrom(db, owner, moved.id, "moving away");
		expect(n).toBe(3);
		const after = await listSeries(db, owner, r.seriesId);
		expect(after.map((s) => s.status)).toEqual(["confirmed", "cancelled", "cancelled", "cancelled"]);
		expect(await listSeries(db, other, r.seriesId)).toEqual([]);
	});
});
