import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, getAppointment, transition } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { createCustomer, listCustomers } from "../../server/domain/customers/service";
import { addMember, listMembers } from "../../server/domain/members/service";
import { addCredit, checkout, getCredit, listPayments, takingsForDay } from "../../server/domain/payments/service";
import { formatLocalDate, localDateOf, zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const at = (d: number, hhmm: string) => zonedTimeToUtc({ year: 2026, month: 11, day: d }, hhmm, NY);

describe("checkout and client credit", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let staff: TenantCtx;
	let other: TenantCtx;
	let lina: { id: string };
	let gel: { id: string };
	const visit = async (customerId: string, d: number, hhmm: string, done = true) => {
		const a = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(d, hhmm), customerId });
		await transition(db, owner, a.id, "checked_in");
		if (done) await transition(db, owner, a.id, "completed");
		return a;
	};

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true as const });
		const admin = { userId: a.id, isPlatformAdmin: true as const };
		const o = await seedUser(db, { name: "Lina Owner" });
		const o2 = await seedUser(db);
		await createBusiness(db, admin, o.id, { name: "Lina", slug: "pay-mine", timeZone: NY });
		await createBusiness(db, admin, o2.id, { name: "Other", slug: "pay-theirs", timeZone: NY });
		owner = (await resolveTenantCtx(db, o.id, "pay-mine"))!;
		other = (await resolveTenantCtx(db, o2.id, "pay-theirs"))!;
		await setHours(db, owner, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "17:00" })));
		await setPolicy(db, owner, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
		gel = await createService(db, owner, { name: "Gel fill", durationMinutes: 60, priceCents: 4500 });
		const memberId = (await listMembers(db, owner)).find((m) => m.userId === o.id)!.id;
		lina = await createEmployee(db, owner, { displayName: "Lina", memberId });
		await setEmployeeServices(db, owner, lina.id, [gel.id]);
		await setEmployeeAvailability(db, owner, lina.id, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00" })));
		const e = await seedUser(db);
		await addMember(db, owner, { userId: e.id, role: "employee" });
		staff = (await resolveTenantCtx(db, e.id, "pay-mine"))!;
	});
	afterAll(() => close());

	it("adds and removes credit, never below zero, and shows it on the client list", async () => {
		const c = await createCustomer(db, owner, { firstName: "Cora" });
		await addCredit(db, owner, c.id, { amountCents: 3000, reason: "Gift card" });
		await addCredit(db, owner, c.id, { amountCents: -500, reason: "Correction" });
		await expect(addCredit(db, owner, c.id, { amountCents: -9999 })).rejects.toMatchObject({ code: "credit_negative" });
		await expect(addCredit(db, owner, c.id, { amountCents: 0 })).rejects.toBeTruthy();
		const credit = await getCredit(db, owner, c.id);
		expect(credit.balanceCents).toBe(2500);
		expect(credit.entries.map((e) => [e.amountCents, e.reason, e.byName])).toEqual([[-500, "Correction", "Lina Owner"], [3000, "Gift card", "Lina Owner"]]);
		expect((await listCustomers(db, owner, { query: "Cora" }))[0].creditCents).toBe(2500);
	});

	it("checks out with credit first, the rest by card, plus a tip", async () => {
		const c = await createCustomer(db, owner, { firstName: "Dana" });
		await addCredit(db, owner, c.id, { amountCents: 2000 });
		const a = await visit(c.id, 10, "10:00");
		const r = await checkout(db, owner, a.id, { method: "card", useCredit: true, tipCents: 900 });
		expect(r).toEqual({ creditCents: 2000, chargedCents: 2500, tipCents: 900 });
		const full = (await getAppointment(db, owner, a.id))!;
		expect([full.paidCents, full.paymentStatus]).toEqual([4500, "paid_in_full"]);
		expect((await listPayments(db, owner, a.id)).map((p) => [p.method, p.amountCents, p.tipCents])).toEqual([["credit", 2000, 0], ["card", 2500, 900]]);
		expect((await getCredit(db, owner, c.id)).balanceCents).toBe(0);
		await expect(checkout(db, owner, a.id, { method: "cash" })).rejects.toMatchObject({ code: "already_paid" });
	});

	it("credit larger than the bill pays it all and leaves the rest", async () => {
		const c = await createCustomer(db, owner, { firstName: "Ena" });
		await addCredit(db, owner, c.id, { amountCents: 6000 });
		const a = await visit(c.id, 10, "12:00", false); // checked in, not yet done
		const r = await checkout(db, owner, a.id, { method: "cash", useCredit: true });
		expect(r).toEqual({ creditCents: 4500, chargedCents: 0, tipCents: 0 });
		expect((await listPayments(db, owner, a.id)).map((p) => p.method)).toEqual(["credit"]);
		expect((await getCredit(db, owner, c.id)).balanceCents).toBe(1500);
	});

	it("refuses booked-only visits, other salons, and staff without access", async () => {
		const c = await createCustomer(db, owner, { firstName: "Fern" });
		const booked = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(11, "10:00"), customerId: c.id });
		await expect(checkout(db, owner, booked.id, { method: "cash" })).rejects.toMatchObject({ code: "not_ready" });
		await transition(db, owner, booked.id, "checked_in");
		await expect(checkout(db, other, booked.id, { method: "cash" })).rejects.toMatchObject({ code: "appointment_not_found" });
		await expect(checkout(db, staff, booked.id, { method: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
		await expect(addCredit(db, other, c.id, { amountCents: 100 })).rejects.toMatchObject({ code: "customer_not_found" });
	});

	it("today's takings split by method; credit used is not counted as money in", async () => {
		const today = formatLocalDate(localDateOf(new Date(), NY));
		const t = await takingsForDay(db, owner, today);
		expect(t).toEqual({ cashCents: 0, cardCents: 2500, creditCents: 6500, tipsCents: 900, totalCents: 3400, visits: 2 });
		await expect(takingsForDay(db, staff, today)).rejects.toBeInstanceOf(ForbiddenError);
	});
});
