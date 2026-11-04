import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type AdminCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, getAppointment, listDay, transition } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { addCustomerNote, archiveCustomer, createCustomer, deleteCustomer, getCustomer, listCustomers, restoreCustomer, setCustomerStatus, updateCustomer } from "../../server/domain/customers/service";
import { addMember, listMembers, setMemberPermissions } from "../../server/domain/members/service";
import { dueForVisit } from "../../server/domain/reports/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const day = (d: number) => ({ year: 2026, month: 11, day: d });
const at = (hhmm: string, d = 10) => zonedTimeToUtc(day(d), hhmm, NY);

async function seedSalon(db: Db, admin: AdminCtx, ownerId: string, slug: string) {
	await createBusiness(db, admin, ownerId, { name: `Salon ${slug}`, slug, timeZone: NY });
	const ctx = (await resolveTenantCtx(db, ownerId, slug))!;
	await setHours(db, ctx, [2, 3, 4].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "17:00" })));
	await setPolicy(db, ctx, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
	const gel = await createService(db, ctx, { name: "Gel fill", durationMinutes: 60, priceCents: 4500 });
	const memberId = (await listMembers(db, ctx)).find((m) => m.userId === ownerId)!.id;
	const emp = await createEmployee(db, ctx, { displayName: "Lina", memberId });
	await setEmployeeServices(db, ctx, emp.id, [gel.id]);
	await setEmployeeAvailability(db, ctx, emp.id, [2, 3, 4].map((weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00" })));
	return { ctx, gel, emp };
}

describe("client info: status, allergy, archive", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let staff: TenantCtx;
	let s: Awaited<ReturnType<typeof seedSalon>>;
	let other: Awaited<ReturnType<typeof seedSalon>>;
	const book = (customerId: string, hhmm: string, d = 10) => bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.gel.id], startAt: at(hhmm, d), customerId });

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true as const });
		const admin = { userId: a.id, isPlatformAdmin: true as const };
		const o = await seedUser(db);
		const o2 = await seedUser(db);
		s = await seedSalon(db, admin, o.id, "info-mine");
		other = await seedSalon(db, admin, o2.id, "info-theirs");
		owner = s.ctx;
		const e = await seedUser(db);
		await addMember(db, owner, { userId: e.id, role: "employee" });
		const m = (await listMembers(db, owner)).find((x) => x.userId === e.id)!;
		await setMemberPermissions(db, owner, m.id, ["customers.view", "customers.edit"]);
		staff = (await resolveTenantCtx(db, e.id, "info-mine"))!;
	});
	afterAll(() => close());

	it("stores allergy and status, derives New until a completed visit", async () => {
		const c = await createCustomer(db, owner, { firstName: "Ava", lastName: "Shah", allergy: "Latex" });
		let row = (await getCustomer(db, owner, c.id))!;
		expect(row.allergy).toBe("Latex");
		expect(row.status).toBe("active");
		expect(row.isNew).toBe(true);
		const appt = await book(c.id, "09:00");
		await transition(db, owner, appt.id, "completed");
		row = (await getCustomer(db, owner, c.id))!;
		expect(row.isNew).toBe(false);
		await setCustomerStatus(db, owner, c.id, "vip");
		expect((await listCustomers(db, owner, { filter: "vip" })).map((x) => x.id)).toEqual([c.id]);
		expect((await listCustomers(db, owner, { filter: "new" })).map((x) => x.id)).not.toContain(c.id);
		const full = (await getAppointment(db, owner, appt.id))!;
		expect(full.allergy).toBe("Latex");
		expect(full.clientStatus).toBe("vip");
		expect((await listDay(db, owner, "2026-11-10")).items[0].allergy).toBe("Latex");
		await expect(setCustomerStatus(db, owner, c.id, "banned")).rejects.toBeTruthy();
	});

	it("keeps the allergy when details are saved without changing it, clears it when emptied", async () => {
		const c = await createCustomer(db, owner, { firstName: "Bea", allergy: "Acrylic" });
		await updateCustomer(db, owner, c.id, { firstName: "Bea", allergy: "Acrylic" });
		expect((await getCustomer(db, owner, c.id))!.allergy).toBe("Acrylic");
		await updateCustomer(db, owner, c.id, { firstName: "Bea", allergy: "" });
		expect((await getCustomer(db, owner, c.id))!.allergy).toBeNull();
	});

	it("refuses to book a Do not book client", async () => {
		const c = await createCustomer(db, owner, { firstName: "Cal" });
		await setCustomerStatus(db, owner, c.id, "do_not_book");
		await expect(book(c.id, "11:00")).rejects.toMatchObject({ code: "do_not_book" });
	});

	it("blocks archiving with an upcoming booking, then hides archived clients and refuses to book them", async () => {
		const c = await createCustomer(db, owner, { firstName: "Dee", lastName: "Park" });
		const appt = await book(c.id, "13:00", 11);
		await expect(archiveCustomer(db, owner, c.id, at("08:00", 9))).rejects.toMatchObject({ code: "has_upcoming" });
		await transition(db, owner, appt.id, "cancelled");
		await archiveCustomer(db, owner, c.id, at("08:00", 9));
		expect((await listCustomers(db, owner, { query: "Dee" })).length).toBe(0);
		expect((await listCustomers(db, owner, { filter: "archived" })).map((x) => x.id)).toContain(c.id);
		await expect(book(c.id, "14:00", 11)).rejects.toMatchObject({ code: "customer_archived" });
		await restoreCustomer(db, owner, c.id);
		expect((await listCustomers(db, owner, { query: "Dee" })).length).toBe(1);
	});

	it("archived and Do not book clients drop out of Due for a visit", async () => {
		const c = await createCustomer(db, owner, { firstName: "Eve" });
		const appt = await book(c.id, "15:00", 10);
		await transition(db, owner, appt.id, "completed");
		const later = zonedTimeToUtc({ year: 2027, month: 1, day: 15 }, "12:00", NY);
		expect((await dueForVisit(db, owner, later, 50)).some((x) => x.customerId === c.id)).toBe(true);
		await setCustomerStatus(db, owner, c.id, "do_not_book");
		expect((await dueForVisit(db, owner, later, 50)).some((x) => x.customerId === c.id)).toBe(false);
	});

	it("delete: owner only, archived only; erases a client with visits, removes one without", async () => {
		const withVisits = await createCustomer(db, owner, { firstName: "Fay", lastName: "Lo", phone: "732 555 0101", allergy: "Nickel" });
		const appt = await book(withVisits.id, "10:00", 12);
		await transition(db, owner, appt.id, "completed");
		await addCustomerNote(db, owner, withVisits.id, "Almond shape");
		await expect(deleteCustomer(db, owner, withVisits.id)).rejects.toMatchObject({ code: "not_archived" });
		await archiveCustomer(db, owner, withVisits.id, at("08:00", 13));
		await expect(deleteCustomer(db, staff, withVisits.id)).rejects.toBeInstanceOf(ForbiddenError);
		expect(await deleteCustomer(db, owner, withVisits.id)).toEqual({ mode: "erased", photoKeys: [] });
		const erased = (await getCustomer(db, owner, withVisits.id))!;
		expect([erased.firstName, erased.lastName, erased.phone, erased.allergy, erased.notes.length]).toEqual(["Deleted", "client", null, null, 0]);
		expect((await getAppointment(db, owner, appt.id))!.customerName).toBe("Deleted client");

		const none = await createCustomer(db, owner, { firstName: "Gus" });
		await archiveCustomer(db, owner, none.id);
		expect(await deleteCustomer(db, owner, none.id)).toEqual({ mode: "deleted", photoKeys: [] });
		expect(await getCustomer(db, owner, none.id)).toBeNull();
	});

	it("cannot touch another salon's client", async () => {
		const theirs = await createCustomer(db, other.ctx, { firstName: "Hal" });
		await expect(setCustomerStatus(db, owner, theirs.id, "vip")).rejects.toMatchObject({ code: "customer_not_found" });
		await expect(archiveCustomer(db, owner, theirs.id)).rejects.toMatchObject({ code: "customer_not_found" });
		await expect(restoreCustomer(db, owner, theirs.id)).rejects.toMatchObject({ code: "customer_not_found" });
		await expect(deleteCustomer(db, owner, theirs.id)).rejects.toMatchObject({ code: "customer_not_found" });
	});
});
