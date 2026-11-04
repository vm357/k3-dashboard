import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTenantCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import type { AppEnv } from "../../server/env";
import { bookAppointment, transition, updateReminder } from "../../server/domain/appointments/service";
import { getPolicy, setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { createCustomer, setCustomerStatus } from "../../server/domain/customers/service";
import { listMembers } from "../../server/domain/members/service";
import { DEFAULT_REMINDER, listNotConfirmed, reminderPreview, renderReminder, sendReminder } from "../../server/domain/reminders/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { addToWaitlist, listWaitlist, markWaitlistBooked, removeFromWaitlist } from "../../server/domain/waitlist/service";
import { smsConfigured, smsOutbox } from "../../server/sms/send";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const at = (d: number, hhmm: string) => zonedTimeToUtc({ year: 2026, month: 11, day: d }, hhmm, NY);
const env = { APP_ENV: "test", APP_ORIGIN: "http://localhost", AUTH_SECRET: "x".repeat(32), EMAIL_FROM_ADDRESS: "no-reply@example.test" } as AppEnv;

describe("reminders and waitlist", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let other: TenantCtx;
	let lina: { id: string };
	let gel: { id: string };
	let maya: { id: string };

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true as const });
		const admin = { userId: a.id, isPlatformAdmin: true as const };
		const o = await seedUser(db);
		const o2 = await seedUser(db);
		await createBusiness(db, admin, o.id, { name: "Lina Nail Studio", slug: "rem-mine", timeZone: NY });
		await createBusiness(db, admin, o2.id, { name: "Other", slug: "rem-theirs", timeZone: NY });
		owner = (await resolveTenantCtx(db, o.id, "rem-mine"))!;
		other = (await resolveTenantCtx(db, o2.id, "rem-theirs"))!;
		await setHours(db, owner, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "17:00" })));
		await setPolicy(db, owner, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
		gel = await createService(db, owner, { name: "Gel fill", durationMinutes: 60, priceCents: 4500 });
		const memberId = (await listMembers(db, owner)).find((m) => m.userId === o.id)!.id;
		lina = await createEmployee(db, owner, { displayName: "Lina", memberId });
		await setEmployeeServices(db, owner, lina.id, [gel.id]);
		await setEmployeeAvailability(db, owner, lina.id, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00" })));
		maya = await createCustomer(db, owner, { firstName: "Maya", lastName: "Reyes", phone: "732 555 0199" });
	});
	afterAll(() => close());

	it("renders the template with the business name from Settings and leaves unknown placeholders", async () => {
		expect(renderReminder("Hi {first_name} at {business} {oops}", { first_name: "Maya", business: "Lina Nail Studio", service: "", date: "", time: "", staff: "" })).toBe("Hi Maya at Lina Nail Studio {oops}");
		const appt = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(10, "10:30"), customerId: maya.id });
		let p = await reminderPreview(db, owner, appt.id);
		expect(p.body).toBe(renderReminder(DEFAULT_REMINDER, { first_name: "Maya", business: "Lina Nail Studio", service: "Gel fill", date: "Tue, Nov 10", time: "10:30am", staff: "Lina" }));
		expect(p.to).toBe("+17325550199");
		await setPolicy(db, owner, { ...(await getPolicy(db, owner)), reminderTemplate: "See you {date} at {time}, {first_name}!" });
		p = await reminderPreview(db, owner, appt.id);
		expect(p.body).toBe("See you Tue, Nov 10 at 10:30am, Maya!");
	});

	it("sends through the outbox in test mode, records it, and stops resends once confirmed", async () => {
		expect(smsConfigured(env)).toBe(true);
		expect(smsConfigured({ ...env, APP_ENV: "staging" } as AppEnv)).toBe(false);
		const appt = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(10, "13:00"), customerId: maya.id });
		const before = smsOutbox.length;
		const sent = await sendReminder(db, owner, env, appt.id);
		expect(sent.reminderStatus).toBe("sent");
		expect(smsOutbox.length).toBe(before + 1);
		expect(smsOutbox.at(-1)!.to).toBe("+17325550199");
		await updateReminder(db, owner, appt.id, "confirmed");
		await expect(sendReminder(db, owner, env, appt.id)).rejects.toMatchObject({ code: "already_confirmed" });
		const list = await listNotConfirmed(db, owner, at(9, "08:00"));
		expect(list.some((x) => x.id === appt.id)).toBe(false);
		expect(list.some((x) => x.customerName === "Maya Reyes")).toBe(true);
	});

	it("a 'no' flags the booking without cancelling it; past or cancelled bookings get no reminders", async () => {
		const appt = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(11, "09:00"), customerId: maya.id });
		const after = await updateReminder(db, owner, appt.id, "declined");
		expect([after.status, after.reminderStatus]).toEqual(["confirmed", "declined"]);
		await transition(db, owner, appt.id, "cancelled");
		await expect(updateReminder(db, owner, appt.id, "sent")).rejects.toMatchObject({ code: "not_remindable" });
		await expect(updateReminder(db, other, appt.id, "confirmed")).rejects.toMatchObject({ code: "appointment_not_found" });
	});

	it("waitlist: add, list by day, book, remove; refuses Do not book and other salons", async () => {
		const ava = await createCustomer(db, owner, { firstName: "Ava" });
		const day = await addToWaitlist(db, owner, { customerId: ava.id, preferredDate: "2026-11-12", note: "after 3pm" });
		const any = await addToWaitlist(db, owner, { customerId: maya.id });
		expect((await listWaitlist(db, owner)).map((w) => w.id)).toEqual([day.id, any.id]);
		expect((await listWaitlist(db, owner, { date: "2026-11-13" })).map((w) => w.id)).toEqual([any.id]);
		const appt = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(12, "15:00"), customerId: ava.id });
		expect(await markWaitlistBooked(db, owner, any.id, appt.id)).toBe(false); // someone else's entry
		expect(await markWaitlistBooked(db, owner, day.id, appt.id)).toBe(true);
		await removeFromWaitlist(db, owner, any.id);
		expect(await listWaitlist(db, owner)).toEqual([]);
		await setCustomerStatus(db, owner, ava.id, "do_not_book");
		await expect(addToWaitlist(db, owner, { customerId: ava.id })).rejects.toMatchObject({ code: "do_not_book" });
		await expect(addToWaitlist(db, other, { customerId: maya.id })).rejects.toMatchObject({ code: "customer_not_found" });
		await expect(removeFromWaitlist(db, other, day.id)).rejects.toMatchObject({ code: "waitlist_not_found" });
	});
});
