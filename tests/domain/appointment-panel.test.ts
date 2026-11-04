import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTenantCtx, type AdminCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, getAppointment, listDay, listMoveSlots, reschedule } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { createCustomer } from "../../server/domain/customers/service";
import { listMembers } from "../../server/domain/members/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { loadAppointmentPanel } from "../../app/lib/appointment-panel.server";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const TUE = { year: 2026, month: 11, day: 10 };
const at = (hhmm: string) => zonedTimeToUtc(TUE, hhmm, NY);
const NOW = zonedTimeToUtc({ year: 2026, month: 11, day: 9 }, "08:00", NY);

async function seedSalon(db: Db, admin: AdminCtx, ownerId: string, slug: string) {
	await createBusiness(db, admin, ownerId, { name: `Salon ${slug}`, slug, timeZone: NY });
	const ctx = (await resolveTenantCtx(db, ownerId, slug))!;
	await setHours(db, ctx, [{ weekday: 2, opensAt: "09:00", closesAt: "17:00" }]);
	await setPolicy(db, ctx, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
	const gel = await createService(db, ctx, { name: "Gel fill", durationMinutes: 60, bufferAfterMinutes: 15, priceCents: 4500 });
	const memberId = (await listMembers(db, ctx)).find((m) => m.userId === ownerId)!.id;
	const lina = await createEmployee(db, ctx, { displayName: "Lina", memberId });
	const tess = await createEmployee(db, ctx, { displayName: "Tess" });
	for (const e of [lina, tess]) {
		await setEmployeeServices(db, ctx, e.id, [gel.id]);
		await setEmployeeAvailability(db, ctx, e.id, [{ weekday: 2, startsAt: "09:00", endsAt: "17:00" }]);
	}
	const maya = await createCustomer(db, ctx, { firstName: "Maya", lastName: "Reyes" });
	return { ctx, gel, lina, tess, maya };
}

describe("appointment panel: move and staff", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let s: Awaited<ReturnType<typeof seedSalon>>;
	let other: Awaited<ReturnType<typeof seedSalon>>;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true });
		const admin = { userId: a.id, isPlatformAdmin: true as const };
		const o = await seedUser(db, { name: "Lina Owner" });
		const o2 = await seedUser(db);
		s = await seedSalon(db, admin, o.id, "panel-mine");
		other = await seedSalon(db, admin, o2.id, "panel-theirs");
		owner = s.ctx;
	});
	afterAll(() => close());

	it("offers move times that overlap the appointment's own current slot", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.lina.id, serviceIds: [s.gel.id], startAt: at("10:00"), customerId: s.maya.id });
		const starts = (await listMoveSlots(db, owner, appt.id, { date: "2026-11-10", now: NOW })).map((d) => d.toISOString());
		expect(starts).toContain(at("10:30").toISOString());
		expect(starts).toContain(at("10:00").toISOString());
	});

	it("moves to another staff member, keeps prices, and records who did it", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.lina.id, serviceIds: [s.gel.id], startAt: at("13:00"), customerId: s.maya.id });
		const moved = await reschedule(db, owner, appt.id, at("13:00"), s.tess.id);
		expect(moved.employeeId).toBe(s.tess.id);
		expect(moved.priceCents).toBe(4500);
		expect(moved.endAt.getTime() - moved.startAt.getTime()).toBe(75 * 60000);
		const full = (await getAppointment(db, owner, moved.id))!;
		expect(full.employeeName).toBe("Tess");
		expect(full.history[0].actorName).toBe("Lina Owner");
		const day = await listDay(db, owner, "2026-11-10");
		expect(day.items.find((i) => i.id === moved.id)?.employeeName).toBe("Tess");
		expect(day.items.some((i) => i.id === appt.id)).toBe(false);
	});

	it("refuses a move to a staff member from another business", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.lina.id, serviceIds: [s.gel.id], startAt: at("15:00"), customerId: s.maya.id });
		await expect(reschedule(db, owner, appt.id, at("15:00"), other.tess.id)).rejects.toMatchObject({ code: "employee_not_found" });
		await expect(listMoveSlots(db, owner, appt.id, { employeeId: other.tess.id, date: "2026-11-10", now: NOW })).rejects.toMatchObject({ code: "employee_not_found" });
	});

	it("loads the panel from the query string, staff list included", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: s.lina.id, serviceIds: [s.gel.id], startAt: at("11:30"), customerId: s.maya.id });
		const p = (await loadAppointmentPanel(db, owner, new URL(`http://x/app/panel-mine?a=${appt.id}&move=2026-11-10&with=${s.tess.id}`)))!;
		expect(p.appt.id).toBe(appt.id);
		expect(p.staff.map((e) => e.displayName).sort()).toEqual(["Lina", "Tess"]);
		expect(p.move?.employeeId).toBe(s.tess.id);
		expect(await loadAppointmentPanel(db, owner, new URL("http://x/app/panel-mine"))).toBeNull();
		expect(await loadAppointmentPanel(db, other.ctx, new URL(`http://x/app/panel-theirs?a=${appt.id}`))).toBeNull();
	});
});
