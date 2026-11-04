import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { bookAppointment, transition } from "../../server/domain/appointments/service";
import { setHours, setPolicy } from "../../server/domain/businesses/hours";
import { createBusiness } from "../../server/domain/businesses/service";
import { archiveCustomer, createCustomer, deleteCustomer, setUsualServices, suggestedServiceIds } from "../../server/domain/customers/service";
import { addMember, listMembers } from "../../server/domain/members/service";
import { addVisitPhoto, deletePhoto, listPhotos, readPhoto } from "../../server/domain/photos/service";
import { zonedTimeToUtc } from "../../server/domain/scheduling/time";
import { createService, setServiceActive } from "../../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { memoryBucket } from "../../server/photos/store";
import { createTestDb, seedUser } from "../helpers/db";

const NY = "America/New_York";
const at = (d: number, hhmm: string) => zonedTimeToUtc({ year: 2026, month: 11, day: d }, hhmm, NY);
const jpeg = (bytes = 1000) => ({ type: "image/jpeg", size: bytes, arrayBuffer: async () => new Uint8Array(bytes).buffer });

describe("usual service and nail photos", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let other: TenantCtx;
	let staff: TenantCtx;
	let lina: { id: string };
	let gel: { id: string };
	let art: { id: string };
	let soak: { id: string };
	const bucket = memoryBucket();
	const done = async (customerId: string, d: number, svc: string[]) => {
		const a = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: svc, startAt: at(d, "10:00"), customerId });
		await transition(db, owner, a.id, "checked_in");
		await transition(db, owner, a.id, "completed");
		return a;
	};

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const a = await seedUser(db, { isPlatformAdmin: true as const });
		const admin = { userId: a.id, isPlatformAdmin: true as const };
		const o = await seedUser(db);
		const o2 = await seedUser(db);
		await createBusiness(db, admin, o.id, { name: "Lina", slug: "usual-mine", timeZone: NY });
		await createBusiness(db, admin, o2.id, { name: "Other", slug: "usual-theirs", timeZone: NY });
		owner = (await resolveTenantCtx(db, o.id, "usual-mine"))!;
		other = (await resolveTenantCtx(db, o2.id, "usual-theirs"))!;
		await setHours(db, owner, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "17:00" })));
		await setPolicy(db, owner, { slotIntervalMinutes: 15, minNoticeMinutes: 0, maxAdvanceDays: 365 });
		gel = await createService(db, owner, { name: "Gel fill", durationMinutes: 60, priceCents: 4500 });
		art = await createService(db, owner, { name: "Nail art", durationMinutes: 15, priceCents: 1500 });
		soak = await createService(db, owner, { name: "Soak off", durationMinutes: 15, priceCents: 1000 });
		const memberId = (await listMembers(db, owner)).find((m) => m.userId === o.id)!.id;
		lina = await createEmployee(db, owner, { displayName: "Lina", memberId });
		await setEmployeeServices(db, owner, lina.id, [gel.id, art.id, soak.id]);
		await setEmployeeAvailability(db, owner, lina.id, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startsAt: "09:00", endsAt: "17:00" })));
		const e = await seedUser(db);
		await addMember(db, owner, { userId: e.id, role: "employee" });
		staff = (await resolveTenantCtx(db, e.id, "usual-mine"))!;
	});
	afterAll(() => close());

	it("suggests last visit's services until a usual is set, then the usual; hidden services drop out", async () => {
		const c = await createCustomer(db, owner, { firstName: "Maya" });
		expect(await suggestedServiceIds(db, owner, c.id)).toEqual({ ids: [], source: null });
		await done(c.id, 10, [soak.id, gel.id]);
		expect(await suggestedServiceIds(db, owner, c.id)).toEqual({ ids: [soak.id, gel.id], source: "last" });
		await setUsualServices(db, owner, c.id, [gel.id, art.id]);
		expect(await suggestedServiceIds(db, owner, c.id)).toEqual({ ids: [gel.id, art.id], source: "usual" });
		await setServiceActive(db, owner, art.id, false);
		expect(await suggestedServiceIds(db, owner, c.id)).toEqual({ ids: [gel.id], source: "usual" });
		await setServiceActive(db, owner, art.id, true);
		const theirs = await createService(db, other, { name: "Theirs", durationMinutes: 30, priceCents: 100 });
		await expect(setUsualServices(db, owner, c.id, [theirs.id])).rejects.toMatchObject({ code: "service_not_found" });
	});

	it("adds photos to a visit that happened, serves them only to the same salon, and deletes them", async () => {
		const c = await createCustomer(db, owner, { firstName: "Ava" });
		const a = await done(c.id, 11, [gel.id]);
		const p = await addVisitPhoto(db, owner, bucket, a.id, jpeg());
		expect(p.r2Key.startsWith(`${owner.businessId}/${c.id}/`)).toBe(true);
		expect((await listPhotos(db, owner, [a.id]))[a.id]).toEqual([p.id]);
		expect(await readPhoto(db, owner, bucket, p.id)).toMatchObject({ contentType: "image/jpeg" });
		expect(await readPhoto(db, other, bucket, p.id)).toBeNull();
		await expect(addVisitPhoto(db, owner, bucket, a.id, { ...jpeg(), type: "image/gif" })).rejects.toMatchObject({ code: "photo_type" });
		await expect(addVisitPhoto(db, owner, bucket, a.id, jpeg(11 * 1024 * 1024))).rejects.toMatchObject({ code: "photo_size" });
		await expect(addVisitPhoto(db, owner, undefined, a.id, jpeg())).rejects.toMatchObject({ code: "photos_not_configured" });
		await expect(addVisitPhoto(db, other, bucket, a.id, jpeg())).rejects.toMatchObject({ code: "appointment_not_found" });
		await expect(deletePhoto(db, staff, bucket, p.id)).rejects.toBeInstanceOf(ForbiddenError);
		await deletePhoto(db, owner, bucket, p.id);
		expect(bucket.keys()).not.toContain(p.r2Key);
		expect(await listPhotos(db, owner, [a.id])).toEqual({});
	});

	it("refuses photos on a visit that has not happened and caps them at six", async () => {
		const c = await createCustomer(db, owner, { firstName: "Bea" });
		const future = await bookAppointment(db, owner, { employeeId: lina.id, serviceIds: [gel.id], startAt: at(12, "10:00"), customerId: c.id });
		await expect(addVisitPhoto(db, owner, bucket, future.id, jpeg())).rejects.toMatchObject({ code: "photo_not_visit" });
		const a = await done(c.id, 13, [gel.id]);
		for (let i = 0; i < 6; i++) await addVisitPhoto(db, owner, bucket, a.id, jpeg());
		await expect(addVisitPhoto(db, owner, bucket, a.id, jpeg())).rejects.toMatchObject({ code: "photo_limit" });
	});

	it("erasing a client removes their photos and returns the storage keys", async () => {
		const c = await createCustomer(db, owner, { firstName: "Cal" });
		const a = await done(c.id, 14, [gel.id]);
		const p = await addVisitPhoto(db, owner, bucket, a.id, jpeg());
		await archiveCustomer(db, owner, c.id);
		const r = await deleteCustomer(db, owner, c.id);
		expect(r).toEqual({ mode: "erased", photoKeys: [p.r2Key] });
		expect(await listPhotos(db, owner, [a.id])).toEqual({});
	});
});
