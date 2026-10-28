import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type AdminCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { customers, employeeServices, services } from "../../server/db/schema";
import { withTenant } from "../../server/db/tenant";
import { createBusiness } from "../../server/domain/businesses/service";
import { getHours, getPolicy, readPolicy, setHours, setPolicy } from "../../server/domain/businesses/hours";
import { addCustomerNote, createCustomer, getCustomer, listCustomers, normalizePhone, updateCustomer } from "../../server/domain/customers/service";
import { addMember, setMemberPermissions, listMembers } from "../../server/domain/members/service";
import { createCategory, createService, deleteCategory, listServices, setServiceActive, updateService } from "../../server/domain/services/service";
import { createEmployee, createTimeBlock, deleteTimeBlock, getEmployee, listEmployees, setEmployeeAvailability, setEmployeeServices } from "../../server/domain/staff/service";
import { createTestDb, expectDbError, seedUser } from "../helpers/db";

describe("dashboard core domain", () => {
	let db: Db;
	let close: () => Promise<void>;
	let owner: TenantCtx;
	let other: TenantCtx;
	let employeeUser: { id: string };
	let employeeMemberId: string;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const adminUser = await seedUser(db, { isPlatformAdmin: true });
		const admin: AdminCtx = { userId: adminUser.id, isPlatformAdmin: true };
		const o = await seedUser(db);
		const o2 = await seedUser(db);
		employeeUser = await seedUser(db);
		await createBusiness(db, admin, o.id, { name: "Nails by Lina", slug: "lina", timeZone: "America/New_York" });
		await createBusiness(db, admin, o2.id, { name: "Elsewhere", slug: "elsewhere", timeZone: "America/New_York" });
		owner = (await resolveTenantCtx(db, o.id, "lina"))!;
		other = (await resolveTenantCtx(db, o2.id, "elsewhere"))!;
		await addMember(db, owner, { userId: employeeUser.id, role: "employee" });
		employeeMemberId = (await listMembers(db, owner)).find((m) => m.userId === employeeUser.id)!.id;
	});

	afterAll(() => close());

	async function employeeCtx() {
		return (await resolveTenantCtx(db, employeeUser.id, "lina"))!;
	}

	describe("services", () => {
		it("creates, lists, updates and deactivates, with deposit validation", async () => {
			const cat = await createCategory(db, owner, { name: "Gel" });
			const s = await createService(db, owner, { name: "Gel fill", durationMinutes: 60, priceCents: 4500, categoryId: cat.id, depositType: "percent", depositAmount: 50 });
			expect(s.depositAmount).toBe(50);
			await expect(createService(db, owner, { name: "Bad", durationMinutes: 30, priceCents: 1000, depositType: "fixed", depositAmount: 5000 })).rejects.toThrow();
			await expect(createService(db, owner, { name: "Bad", durationMinutes: 30, priceCents: 1000, depositType: "percent", depositAmount: 150 })).rejects.toThrow();
			const updated = await updateService(db, owner, s.id, { name: "Gel fill", durationMinutes: 75, priceCents: 5000, bufferAfterMinutes: 10, depositType: "none", depositAmount: 99 });
			expect(updated.durationMinutes).toBe(75);
			expect(updated.depositAmount).toBe(0);
			await setServiceActive(db, owner, s.id, false);
			expect((await listServices(db, owner)).services).toHaveLength(0);
			expect((await listServices(db, owner, { includeInactive: true })).services).toHaveLength(1);
			await setServiceActive(db, owner, s.id, true);
		});

		it("an employee can view but not manage services", async () => {
			const emp = await employeeCtx();
			expect((await listServices(db, emp)).services.length).toBeGreaterThan(0);
			await expect(createService(db, emp, { name: "X", durationMinutes: 30, priceCents: 100 })).rejects.toBeInstanceOf(ForbiddenError);
		});

		it("another business cannot see or edit these services", async () => {
			const mine = (await listServices(db, owner)).services[0];
			expect((await listServices(db, other)).services).toHaveLength(0);
			await expect(updateService(db, other, mine.id, { name: "Stolen", durationMinutes: 30, priceCents: 1 })).rejects.toMatchObject({ code: "service_not_found" });
			const rows = await withTenant(db, other, (tx) => tx.select().from(services).where(eq(services.id, mine.id)));
			expect(rows).toHaveLength(0);
		});

		it("deleting a category leaves its services in place", async () => {
			const cat = await createCategory(db, owner, { name: "Temp" });
			const s = await createService(db, owner, { name: "In temp", durationMinutes: 30, priceCents: 1000, categoryId: cat.id });
			await deleteCategory(db, owner, cat.id);
			const after = (await listServices(db, owner)).services.find((x) => x.id === s.id)!;
			expect(after.categoryId).toBeNull();
		});
	});

	describe("staff", () => {
		it("creates an employee linked to a member, assigns services, sets availability", async () => {
			const emp = await createEmployee(db, owner, { displayName: "Lina", memberId: employeeMemberId });
			const svc = (await listServices(db, owner)).services;
			await setEmployeeServices(db, owner, emp.id, svc.map((s) => s.id));
			await setEmployeeAvailability(db, owner, emp.id, [
				{ weekday: 2, startsAt: "09:00", endsAt: "13:00" },
				{ weekday: 2, startsAt: "14:00", endsAt: "18:00" },
				{ weekday: 4, startsAt: "10:00", endsAt: "17:00" },
			]);
			const full = (await getEmployee(db, owner, emp.id))!;
			expect(full.serviceIds).toHaveLength(svc.length);
			expect(full.availability).toHaveLength(3);
			expect((await listEmployees(db, owner))[0].memberName).toBeTruthy();
		});

		it("rejects overlapping availability and bad times", async () => {
			const emp = (await listEmployees(db, owner))[0];
			await expect(setEmployeeAvailability(db, owner, emp.id, [{ weekday: 1, startsAt: "09:00", endsAt: "12:00" }, { weekday: 1, startsAt: "11:00", endsAt: "15:00" }])).rejects.toMatchObject({ code: "availability_overlap" });
			await expect(setEmployeeAvailability(db, owner, emp.id, [{ weekday: 1, startsAt: "12:00", endsAt: "09:00" }])).rejects.toThrow();
		});

		it("cannot assign another business's service to an employee", async () => {
			const foreign = await createService(db, other, { name: "Foreign", durationMinutes: 30, priceCents: 100 });
			const emp = (await listEmployees(db, owner))[0];
			await expect(setEmployeeServices(db, owner, emp.id, [foreign.id])).rejects.toMatchObject({ code: "service_not_found" });
			const rows = await withTenant(db, owner, (tx) => tx.select().from(employeeServices).where(eq(employeeServices.serviceId, foreign.id)));
			expect(rows).toHaveLength(0);
		});

		it("an employee can block their own time but not a colleague's", async () => {
			const emp = await employeeCtx();
			const me = (await listEmployees(db, owner)).find((e) => e.memberId === employeeMemberId)!;
			const colleague = await createEmployee(db, owner, { displayName: "Colleague" });
			const block = await createTimeBlock(db, emp, { employeeId: me.id, kind: "time_off", startAt: new Date("2026-11-03T14:00:00Z"), endAt: new Date("2026-11-03T18:00:00Z") });
			expect(block.employeeId).toBe(me.id);
			await expect(createTimeBlock(db, emp, { employeeId: colleague.id, startAt: new Date("2026-11-03T14:00:00Z"), endAt: new Date("2026-11-03T18:00:00Z") })).rejects.toBeInstanceOf(ForbiddenError);
			await expect(createTimeBlock(db, emp, { startAt: new Date("2026-11-03T14:00:00Z"), endAt: new Date("2026-11-03T18:00:00Z") })).rejects.toBeInstanceOf(ForbiddenError);
			await deleteTimeBlock(db, emp, block.id);
			await expect(deleteTimeBlock(db, emp, block.id)).rejects.toMatchObject({ code: "time_block_not_found" });
		});
	});

	describe("hours and policy", () => {
		it("sets hours with closed days omitted, and the policy with defaults filled", async () => {
			await setHours(db, owner, [
				{ weekday: 2, opensAt: "09:00", closesAt: "18:00" },
				{ weekday: 3, opensAt: "09:00", closesAt: "18:00" },
				{ weekday: 6, opensAt: "10:00", closesAt: "15:00" },
			]);
			expect((await getHours(db, owner)).map((h) => h.weekday)).toEqual([2, 3, 6]);
			await expect(setHours(db, owner, [{ weekday: 2, opensAt: "18:00", closesAt: "09:00" }])).rejects.toThrow();
			expect(readPolicy(undefined).slotIntervalMinutes).toBe(15);
			const p = await setPolicy(db, owner, { minNoticeMinutes: 240, maxAdvanceDays: 90 });
			expect(p.minNoticeMinutes).toBe(240);
			expect((await getPolicy(db, owner)).maxAdvanceDays).toBe(90);
			expect((await getPolicy(db, owner)).slotIntervalMinutes).toBe(15);
			await expect(setHours(db, await employeeCtx(), [])).rejects.toBeInstanceOf(ForbiddenError);
		});
	});

	describe("customers", () => {
		it("creates with normalised contact details and blocks duplicate emails", async () => {
			const c = await createCustomer(db, owner, { firstName: "Maya", lastName: "Reyes", email: "Maya@Example.test", phone: "(555) 014-2290", pinnedNote: "Almond, medium" });
			expect(c.email).toBe("maya@example.test");
			expect(c.phone).toBe("+15550142290");
			await expect(createCustomer(db, owner, { firstName: "Dup", email: "maya@example.test" })).rejects.toMatchObject({ code: "customer_email_exists" });
			expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
			expect(normalizePhone("")).toBeNull();
		});

		it("searches by name, email and digits of a phone", async () => {
			await createCustomer(db, owner, { firstName: "Priya", lastName: "Natarajan", phone: "555-300-1111" });
			expect((await listCustomers(db, owner, { query: "rey" })).map((c) => c.firstName)).toEqual(["Maya"]);
			expect((await listCustomers(db, owner, { query: "maya reyes" })).length).toBe(1);
			expect((await listCustomers(db, owner, { query: "3001111" })).map((c) => c.firstName)).toEqual(["Priya"]);
			expect((await listCustomers(db, owner, { query: "example.test" })).length).toBe(1);
			expect((await listCustomers(db, other)).length).toBe(0);
		});

		it("hides contact details from staff without customers.view_contact", async () => {
			const emp = await employeeCtx();
			const list = await listCustomers(db, emp);
			expect(list[0].phone === "hidden" || list[0].phone === null).toBe(true);
			expect(list.every((c) => c.email === "hidden" || c.email === null)).toBe(true);
			const member = (await listMembers(db, owner)).find((m) => m.userId === employeeUser.id)!;
			await setMemberPermissions(db, owner, member.id, ["customers.view", "customers.view_contact"]);
			const list2 = await listCustomers(db, await employeeCtx());
			expect(list2.find((c) => c.firstName === "Maya")!.email).toBe("maya@example.test");
		});

		it("notes attach to the customer and the pinned note updates; the audit log carries no contact details", async () => {
			const maya = (await listCustomers(db, owner, { query: "maya" }))[0];
			await addCustomerNote(db, owner, maya.id, "Chrome on ring fingers. Loved it.");
			await updateCustomer(db, owner, maya.id, { firstName: "Maya", lastName: "Reyes", email: "maya@example.test", phone: "5550142290", pinnedNote: "Almond, medium. Sensitive cuticles." });
			const full = (await getCustomer(db, owner, maya.id))!;
			expect(full.notes).toHaveLength(1);
			expect(full.pinnedNote).toContain("Sensitive");
			const { auditLog } = await import("../../server/db/schema");
			const { withBypass } = await import("../../server/db/tenant");
			const rows = await withBypass(db, null, (tx) => tx.select().from(auditLog).where(eq(auditLog.targetId, maya.id)));
			expect(JSON.stringify(rows)).not.toContain("example.test");
			expect(JSON.stringify(rows)).not.toContain("2290");
		});

		it("another business cannot read a customer by id, even through RLS directly", async () => {
			const maya = (await listCustomers(db, owner, { query: "maya" }))[0];
			expect(await getCustomer(db, other, maya.id)).toBeNull();
			await expectDbError(
				withTenant(db, other, (tx) => tx.insert(customers).values({ businessId: owner.businessId, firstName: "Injected" })),
				/row-level security/,
			);
		});
	});
});
