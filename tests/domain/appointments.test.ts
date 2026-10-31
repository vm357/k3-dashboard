import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type AdminCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, getAppointment, listDay, listForCustomer, listSlots, reschedule, transition } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { createCustomer, listCustomers } from "../../server/domain/customers/service";
import { addMember, listMembers, setMemberPermissions } from "../../server/domain/members/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { createRouteHarness, type RouteHarness } from "../helpers/server";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const TUE = { year: 2026, month: 11, day: 10 };
const at = (hhmm: string, d = TUE) => zonedTimeToUtc(d, hhmm, NY);

async function seedSalon(db: Db, admin: AdminCtx, ownerId: string, slug: string) {
	await createBusiness(db, admin, ownerId, { name: `Salon ${slug}`, slug, timeZone: NY });
	const ctx = (await resolveTenantCtx(db, ownerId, slug))!;
	await setHours(db, ctx, [{ weekday: 2, opensAt: "09:00", closesAt: "17:00" }, { weekday: 3, opensAt: "09:00", closesAt: "17:00" }]);
	await setPolicy(db, ctx, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
	const gel = await createService(db, ctx, { name: "Gel fill", durationMinutes: 60, bufferAfterMinutes: 10, priceCents: 4500, depositType: "percent", depositAmount: 50 });
	const art = await createService(db, ctx, { name: "Nail art", durationMinutes: 15, priceCents: 1500 });
	const memberId = (await listMembers(db, ctx)).find((m) => m.userId === ownerId)!.id;
	const emp = await createEmployee(db, ctx, { displayName: "Owner", memberId });
	await setEmployeeServices(db, ctx, emp.id, [gel.id, art.id]);
	await setEmployeeAvailability(db, ctx, emp.id, [{ weekday: 2, startsAt: "09:00", endsAt: "17:00" }, { weekday: 3, startsAt: "09:00", endsAt: "17:00" }]);
	const maya = await createCustomer(db, ctx, { firstName: "Maya", lastName: "Reyes", email: "maya@example.test" });
	return { ctx, gel, art, emp, maya };
}

describe("appointments", () => {
	let db: Db;
	let close: () => Promise<void>;
	let admin: AdminCtx;
	let owner: TenantCtx;
	let s: Awaited<ReturnType<typeof seedSalon>>;
	let other: Awaited<ReturnType<typeof seedSalon>>;
	let employeeUserId: string;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true });
		admin = { userId: a.id, isPlatformAdmin: true };
		const o = await seedUser(db);
		const o2 = await seedUser(db);
		s = await seedSalon(db, admin, o.id, "mine");
		other = await seedSalon(db, admin, o2.id, "theirs");
		owner = s.ctx;
		const e = await seedUser(db);
		employeeUserId = e.id;
		await addMember(db, owner, { userId: e.id, role: "employee" });
	});
	afterAll(() => close());

	it("offers slots from the engine with prices and deposit computed from the services", async () => {
		const r = await listSlots(db, owner, { employeeId: s.emp.id, serviceIds: [s.gel.id, s.art.id], date: "2026-11-10", now: at("08:00") });
		expect(r.totalMinutes).toBe(85);
		expect(r.serviceMinutes).toBe(75);
		expect(r.priceCents).toBe(6000);
		expect(r.depositDueCents).toBe(2250);
		expect(r.starts[0].toISOString()).toBe(at("09:00").toISOString());
	});

	it("books, freezes prices, and the slot disappears from availability", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.gel.id, s.art.id], startAt: at("10:30"), customerId: s.maya.id, note: "Chrome again" });
		expect(appt.status).toBe("confirmed");
		expect(appt.paymentStatus).toBe("unpaid");
		expect(appt.priceCents).toBe(6000);
		expect(appt.serviceEndAt.toISOString()).toBe(at("11:45").toISOString());
		expect(appt.endAt.toISOString()).toBe(at("11:55").toISOString());
		const r = await listSlots(db, owner, { employeeId: s.emp.id, serviceIds: [s.art.id], date: "2026-11-10", now: at("08:00") });
		const hh = r.starts.map((d) => d.toISOString());
		expect(hh).not.toContain(at("10:30").toISOString());
		expect(hh).not.toContain(at("11:45").toISOString()); // inside the buffer
		expect(hh).toContain(at("12:00").toISOString());
		expect(hh).toContain(at("10:15").toISOString()); // 15 min art fits before 10:30
	});

	it("refuses a start that does not fit, outside hours, or on a closed day", async () => {
		await expect(bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.gel.id], startAt: at("11:00"), customerId: s.maya.id })).rejects.toMatchObject({ code: "slot_unavailable" });
		await expect(bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.gel.id], startAt: at("16:30"), customerId: s.maya.id })).rejects.toMatchObject({ code: "slot_unavailable" });
		await expect(bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.gel.id], startAt: at("10:00", { year: 2026, month: 11, day: 12 }), customerId: s.maya.id })).rejects.toMatchObject({ code: "slot_unavailable" });
	});

	it("creates a client inline when booking a walk-in", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.art.id], startAt: at("13:00"), newCustomer: { firstName: "Walk", lastName: "In", phone: "555 010 2020" } });
		const found = await listCustomers(db, owner, { query: "walk" });
		expect(found).toHaveLength(1);
		expect(found[0].phone).toBe("+15550102020");
		expect(appt.customerId).toBe(found[0].id);
	});

	it("walks the status machine and refuses bad transitions; payment state is untouched", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.art.id], startAt: at("14:00"), customerId: s.maya.id });
		await expect(transition(db, owner, appt.id, "completed")).resolves.toMatchObject({ status: "completed", paymentStatus: "unpaid" });
		await expect(transition(db, owner, appt.id, "cancelled")).rejects.toMatchObject({ code: "bad_transition" });
		const b = await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.art.id], startAt: at("14:30"), customerId: s.maya.id });
		await transition(db, owner, b.id, "checked_in");
		await transition(db, owner, b.id, "no_show", "left after waiting");
		const full = (await getAppointment(db, owner, b.id))!;
		expect(full.history.map((h) => h.toStatus)).toEqual(["confirmed", "checked_in", "no_show"]);
		expect(full.allowedTransitions).toEqual([]);
	});

	it("cancelling frees the slot", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.art.id], startAt: at("15:00"), customerId: s.maya.id });
		await transition(db, owner, appt.id, "cancelled", "client sick");
		const again = await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.art.id], startAt: at("15:00"), customerId: s.maya.id });
		expect(again.id).not.toBe(appt.id);
	});

	it("reschedules into a new linked row and the old one no longer occupies time", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.gel.id], startAt: at("09:00", { year: 2026, month: 11, day: 11 }), customerId: s.maya.id });
		const moved = await reschedule(db, owner, appt.id, at("12:00", { year: 2026, month: 11, day: 11 }));
		expect(moved.rescheduledFromId).toBe(appt.id);
		expect(moved.priceCents).toBe(4500);
		expect((await getAppointment(db, owner, appt.id))!.status).toBe("rescheduled");
		// the original 09:00 slot is free again
		await bookAppointment(db, owner, { employeeId: s.emp.id, serviceIds: [s.art.id], startAt: at("09:00", { year: 2026, month: 11, day: 11 }), customerId: s.maya.id });
		const day = await listDay(db, owner, "2026-11-11");
		expect(day.items.map((i) => i.status)).toEqual(["confirmed", "confirmed"]);
	});

	it("the day list and the customer history see the right rows", async () => {
		const day = await listDay(db, owner, "2026-11-10");
		expect(day.items.length).toBeGreaterThanOrEqual(4);
		expect(day.items.every((i) => i.customerName.length > 0 && i.services.length > 0)).toBe(true);
		const hist = await listForCustomer(db, owner, s.maya.id);
		expect(hist.lifetimeCents).toBe(1500); // one completed nail art
		expect(hist.past.some((p) => p.status === "no_show")).toBe(true);
	});

	it("an employee without manage_all cannot book onto someone else's calendar, and sees only their own", async () => {
		const emp = (await resolveTenantCtx(db, employeeUserId, "mine"))!;
		await expect(bookAppointment(db, emp, { employeeId: s.emp.id, serviceIds: [s.art.id], startAt: at("16:00"), customerId: s.maya.id })).rejects.toBeInstanceOf(ForbiddenError);
		expect((await listDay(db, emp, "2026-11-10")).items).toHaveLength(0);
		expect(await getAppointment(db, emp, (await listDay(db, owner, "2026-11-10")).items[0].id)).toBeNull();
		const m = (await listMembers(db, owner)).find((x) => x.userId === employeeUserId)!;
		await setMemberPermissions(db, owner, m.id, ["calendar.view_all", "appointments.manage_all"]);
		const emp2 = (await resolveTenantCtx(db, employeeUserId, "mine"))!;
		expect((await listDay(db, emp2, "2026-11-10")).items.length).toBeGreaterThan(0);
	});

	it("another business cannot see, book onto, or transition these appointments", async () => {
		const mine = (await listDay(db, owner, "2026-11-10")).items[0];
		expect(await getAppointment(db, other.ctx, mine.id)).toBeNull();
		await expect(transition(db, other.ctx, mine.id, "cancelled")).rejects.toMatchObject({ code: "appointment_not_found" });
		await expect(bookAppointment(db, other.ctx, { employeeId: s.emp.id, serviceIds: [other.art.id], startAt: at("16:00"), customerId: other.maya.id })).rejects.toMatchObject({ code: "employee_not_found" });
		await expect(bookAppointment(db, other.ctx, { employeeId: other.emp.id, serviceIds: [s.art.id], startAt: at("16:00"), customerId: other.maya.id })).rejects.toMatchObject({ code: "service_not_found" });
		await expect(bookAppointment(db, other.ctx, { employeeId: other.emp.id, serviceIds: [other.art.id], startAt: at("16:00"), customerId: s.maya.id })).rejects.toMatchObject({ code: "customer_not_found" });
	});
});

describe("concurrent booking (real Postgres wire, exclusion constraint)", () => {
	let h: RouteHarness;
	let ctx: TenantCtx;
	let seeded: Awaited<ReturnType<typeof seedSalon>>;

	beforeAll(async () => {
		h = await createRouteHarness();
		const a = await h.seedUser({ email: "admin@race.test", isPlatformAdmin: true });
		const o = await h.seedUser({ email: "owner@race.test" });
		seeded = await seedSalon(h.db, { userId: a.id, isPlatformAdmin: true }, o.id, "race");
		ctx = seeded.ctx;
	}, 120_000);
	afterAll(() => h.close());

	it("50 simultaneous attempts on one slot produce exactly one appointment", async () => {
		const start = at("10:00");
		const results = await Promise.allSettled(
			Array.from({ length: 50 }, () => bookAppointment(h.db, ctx, { employeeId: seeded.emp.id, serviceIds: [seeded.gel.id], startAt: start, customerId: seeded.maya.id })),
		);
		const ok = results.filter((r) => r.status === "fulfilled");
		const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
		expect(ok).toHaveLength(1);
		expect(failed).toHaveLength(49);
		expect(failed.every((f) => ["slot_taken", "slot_unavailable"].includes((f.reason as { code?: string }).code ?? ""))).toBe(true);
		const day = await listDay(h.db, ctx, "2026-11-10");
		expect(day.items).toHaveLength(1);
	}, 120_000);

	it("the database itself rejects an overlapping insert even if the application check is bypassed", async () => {
		const { appointments } = await import("../../server/db/schema");
		const { withTenant } = await import("../../server/db/tenant");
		const { expectDbError } = await import("../helpers/db");
		await expectDbError(
			withTenant(h.db, ctx, (tx) =>
				tx.insert(appointments).values({
					businessId: ctx.businessId,
					customerId: seeded.maya.id,
					employeeId: seeded.emp.id,
					startAt: at("10:30"),
					serviceEndAt: at("11:00"),
					endAt: at("11:00"),
					status: "confirmed",
				}),
			),
			/appointments_no_overlap|exclusion/,
		);
	});
});
