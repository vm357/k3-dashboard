import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type AdminCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, listForCustomer, transition } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { findDuplicates, mergeCustomers } from "../../server/domain/customers/merge";
import { addCustomerNote, createCustomer, getCustomer, listCustomers } from "../../server/domain/customers/service";
import { addMember, listMembers } from "../../server/domain/members/service";
import { buildReport, dueForVisit, periodRange } from "../../server/domain/reports/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const d = (y: number, m: number, day: number, hhmm = "10:00") => zonedTimeToUtc({ year: y, month: m, day }, hhmm, NY);

describe("CRM: duplicates, merge, reports, due for a visit", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let emp: { id: string };
	let gel: { id: string };
	let art: { id: string };
	let employeeUserId: string;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true });
		const admin: AdminCtx = { userId: a.id, isPlatformAdmin: true };
		const o = await seedUser(db);
		await createBusiness(db, admin, o.id, { name: "Studio", slug: "studio", timeZone: NY });
		owner = (await resolveTenantCtx(db, o.id, "studio"))!;
		const all = [0, 1, 2, 3, 4, 5, 6];
		await setHours(db, owner, all.map((w) => ({ weekday: w, opensAt: "08:00", closesAt: "20:00" })));
		await setPolicy(db, owner, { minNoticeMinutes: 0, maxAdvanceDays: 365 });
		gel = await createService(db, owner, { name: "Gel fill", durationMinutes: 60, priceCents: 4500 });
		art = await createService(db, owner, { name: "Nail art", durationMinutes: 15, priceCents: 1500 });
		const memberId = (await listMembers(db, owner))[0].id;
		emp = await createEmployee(db, owner, { displayName: "Lina", memberId });
		await setEmployeeServices(db, owner, emp.id, [gel.id, art.id]);
		await setEmployeeAvailability(db, owner, emp.id, all.map((w) => ({ weekday: w, startsAt: "08:00", endsAt: "20:00" })));
		const e = await seedUser(db);
		employeeUserId = e.id;
		await addMember(db, owner, { userId: e.id, role: "employee" });
	});
	afterAll(() => close());

	async function visit(customerId: string, when: Date, serviceIds = [gel.id], done = true) {
		const a = await bookAppointment(db, owner, { employeeId: emp.id, serviceIds, startAt: when, customerId });
		if (done) await transition(db, owner, a.id, "completed");
		return a;
	}

	it("flags same phone, same email and same full name as likely duplicates, nothing else", async () => {
		const m1 = await createCustomer(db, owner, { firstName: "Maya", lastName: "Reyes", phone: "555-100-2000", email: "maya@example.test" });
		const m2 = await createCustomer(db, owner, { firstName: "Maya", lastName: "Reyes", phone: "555-100-2000" });
		await createCustomer(db, owner, { firstName: "Maya", lastName: "Chen", phone: "555-999-0000" });
		const dupes = await findDuplicates(db, owner);
		expect(dupes).toHaveLength(1);
		expect(dupes[0].reason).toBe("same_phone");
		expect([dupes[0].a.id, dupes[0].b.id].sort()).toEqual([m1.id, m2.id].sort());
	});

	it("merge moves appointments and notes, fills gaps, retires the other record, and is audited", async () => {
		const [keep, from] = (await listCustomers(db, owner, { query: "maya reyes" })).sort((a, b) => (a.email ? -1 : 1));
		await visit(from.id, d(2026, 9, 1));
		await visit(keep.id, d(2026, 10, 1));
		await visit(keep.id, d(2026, 10, 15));
		const pair = (await findDuplicates(db, owner))[0];
		const visitsOf = (id: string) => (pair.a.id === id ? pair.a : pair.b).visits;
		expect(visitsOf(keep.id)).toBe(2); // the count must be per customer, not zero for everyone
		expect(visitsOf(from.id)).toBe(1);
		await addCustomerNote(db, owner, from.id, "note on the duplicate");
		const r = await mergeCustomers(db, owner, keep.id, from.id);
		expect(r.appointmentsMoved).toBe(1);
		expect(r.notesMoved).toBe(1);
		const full = (await getCustomer(db, owner, keep.id))!;
		expect(full.notes.map((n) => n.body)).toContain("note on the duplicate");
		expect((await listForCustomer(db, owner, keep.id)).past).toHaveLength(3);
		expect(await listCustomers(db, owner, { query: "maya reyes" })).toHaveLength(1);
		expect(await findDuplicates(db, owner)).toHaveLength(0);
		await expect(mergeCustomers(db, owner, keep.id, from.id)).rejects.toMatchObject({ code: "customer_not_found" });
	});

	it("an employee without customers.edit cannot see duplicates or merge", async () => {
		const e = (await resolveTenantCtx(db, employeeUserId, "studio"))!;
		await expect(findDuplicates(db, e)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(mergeCustomers(db, e, "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000001")).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("period ranges start on Monday and cover the month", () => {
		const w = periodRange("week", new Date("2026-11-05T15:00:00Z"), NY); // a Thursday
		expect(w.start).toEqual({ year: 2026, month: 11, day: 2 });
		expect(w.end).toEqual({ year: 2026, month: 11, day: 9 });
		const m = periodRange("month", new Date("2026-12-15T15:00:00Z"), NY);
		expect(m.start).toEqual({ year: 2026, month: 12, day: 1 });
		expect(m.end).toEqual({ year: 2027, month: 1, day: 1 });
	});

	it("reports count only completed visits as revenue and split by staff and service", async () => {
		const priya = await createCustomer(db, owner, { firstName: "Priya" });
		const now = new Date("2026-11-20T15:00:00Z");
		await visit(priya.id, d(2026, 11, 3), [gel.id, art.id]);
		await visit(priya.id, d(2026, 11, 10), [gel.id]);
		const ns = await bookAppointment(db, owner, { employeeId: emp.id, serviceIds: [art.id], startAt: d(2026, 11, 12), customerId: priya.id });
		await transition(db, owner, ns.id, "no_show");
		const cx = await bookAppointment(db, owner, { employeeId: emp.id, serviceIds: [art.id], startAt: d(2026, 11, 13), customerId: priya.id });
		await transition(db, owner, cx.id, "cancelled");
		await bookAppointment(db, owner, { employeeId: emp.id, serviceIds: [art.id], startAt: d(2026, 11, 25), customerId: priya.id });
		const r = await buildReport(db, owner, "month", NY, now);
		expect(r.totals.completed).toBe(2);
		expect(r.totals.revenueCents).toBe(10500);
		expect(r.totals.noShows).toBe(1);
		expect(r.totals.cancellations).toBe(1);
		expect(r.totals.upcoming).toBe(1);
		expect(r.byEmployee[0]).toMatchObject({ name: "Lina", completed: 2, revenueCents: 10500 });
		expect(r.byService.find((s) => s.name === "Gel fill")).toMatchObject({ count: 2, revenueCents: 9000 });
		expect(r.byService.find((s) => s.name === "Nail art")).toMatchObject({ count: 1, revenueCents: 1500 });
		expect(r.byDay.find((x) => x.date === "2026-11-03")).toMatchObject({ completed: 1, revenueCents: 6000 });
		expect(r.topClients[0]).toMatchObject({ name: "Priya", visits: 2 });
		const e = (await resolveTenantCtx(db, employeeUserId, "studio"))!;
		await expect(buildReport(db, e, "month", NY, now)).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("due for a visit uses each client's own rhythm and skips anyone booked ahead", async () => {
		const reg = await createCustomer(db, owner, { firstName: "Regular" });
		await visit(reg.id, d(2026, 7, 1));
		await visit(reg.id, d(2026, 7, 29)); // 28-day gap
		await visit(reg.id, d(2026, 8, 26)); // 28 days
		const once = await createCustomer(db, owner, { firstName: "Once" });
		await visit(once.id, d(2026, 8, 1));
		const booked = await createCustomer(db, owner, { firstName: "Booked" });
		await visit(booked.id, d(2026, 8, 1));
		await visit(booked.id, d(2026, 12, 1), [gel.id], false);
		const now = new Date("2026-10-01T15:00:00Z");
		const due = await dueForVisit(db, owner, now);
		const names = due.map((x) => x.name);
		expect(names).toContain("Regular"); // 36 days since, rhythm 28
		expect(names).toContain("Once"); // 61 days since, default 42
		expect(names).not.toContain("Booked");
		expect(due.find((x) => x.name === "Regular")!.typicalDays).toBe(28);
	});
});
