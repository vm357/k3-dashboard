import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type AdminCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { auditLog, businesses } from "../../server/db/schema";
import { withBypass } from "../../server/db/tenant";
import { listBusinesses, setBusinessStatus } from "../../server/domain/admin/service";
import { createBusiness, updateBusinessSettings } from "../../server/domain/businesses/service";
import { addMember, listMembers, removeMember, setMemberPermissions } from "../../server/domain/members/service";
import { createTestDb, seedUser } from "../helpers/db";

describe("roles and permissions", () => {
	let db: Db;
	let close: () => Promise<void>;
	let admin: AdminCtx;
	let owner: { id: string };
	let employee: { id: string };
	let outsider: { id: string };
	let biz: { id: string };
	let ownerCtx: TenantCtx;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const adminUser = await seedUser(db, { isPlatformAdmin: true });
		admin = { userId: adminUser.id, isPlatformAdmin: true };
		owner = await seedUser(db);
		employee = await seedUser(db);
		outsider = await seedUser(db);
		biz = await createBusiness(db, admin, owner.id, { name: "Lash Studio", slug: "lash-studio", timeZone: "America/New_York" });
		ownerCtx = (await resolveTenantCtx(db, owner.id, "lash-studio"))!;
		await addMember(db, ownerCtx, { userId: employee.id, role: "employee" });
	});

	afterAll(() => close());

	async function employeeCtx() {
		return (await resolveTenantCtx(db, employee.id, "lash-studio"))!;
	}

	it("a new employee gets the default permissions and nothing more", async () => {
		const ctx = await employeeCtx();
		expect(ctx.role).toBe("employee");
		expect(ctx.permissions.has("calendar.view_own")).toBe(true);
		expect(ctx.permissions.has("team.manage")).toBe(false);
		expect(ctx.permissions.has("settings.edit")).toBe(false);
	});

	it("an employee cannot edit settings or manage the team", async () => {
		const ctx = await employeeCtx();
		await expect(updateBusinessSettings(db, ctx, { name: "Renamed" })).rejects.toBeInstanceOf(ForbiddenError);
		await expect(addMember(db, ctx, { userId: outsider.id, role: "employee" })).rejects.toBeInstanceOf(ForbiddenError);
		await expect(listMembers(db, ctx)).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("granting a key takes effect on the next ctx, and only that key", async () => {
		const members = await listMembers(db, ownerCtx);
		const emp = members.find((m) => m.userId === employee.id)!;
		await setMemberPermissions(db, ownerCtx, emp.id, ["calendar.view_own", "team.view"]);
		const ctx = await employeeCtx();
		expect((await listMembers(db, ctx)).length).toBe(2);
		await expect(addMember(db, ctx, { userId: outsider.id, role: "employee" })).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("unknown permission keys are rejected at the boundary", async () => {
		const members = await listMembers(db, ownerCtx);
		const emp = members.find((m) => m.userId === employee.id)!;
		await expect(setMemberPermissions(db, ownerCtx, emp.id, ["platform.god_mode"])).rejects.toThrow();
	});

	it("an employee with team.manage still cannot add an owner", async () => {
		const members = await listMembers(db, ownerCtx);
		const emp = members.find((m) => m.userId === employee.id)!;
		await setMemberPermissions(db, ownerCtx, emp.id, ["team.view", "team.manage"]);
		const ctx = await employeeCtx();
		await expect(addMember(db, ctx, { userId: outsider.id, role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
		await addMember(db, ctx, { userId: outsider.id, role: "employee" });
		expect((await listMembers(db, ownerCtx)).length).toBe(3);
	});

	it("the last owner cannot be removed", async () => {
		const members = await listMembers(db, ownerCtx);
		const me = members.find((m) => m.userId === owner.id)!;
		await expect(removeMember(db, ownerCtx, me.id)).rejects.toThrow(/last_owner|at least one owner/);
	});

	it("owner permissions cannot be edited into something smaller", async () => {
		const members = await listMembers(db, ownerCtx);
		const me = members.find((m) => m.userId === owner.id)!;
		await expect(setMemberPermissions(db, ownerCtx, me.id, [])).rejects.toMatchObject({ code: "owner_permissions_fixed" });
	});

	it("non-admins cannot use admin services even with a hand-built ctx", async () => {
		const fake = { userId: owner.id, isPlatformAdmin: false } as unknown as AdminCtx;
		await expect(listBusinesses(db, fake)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(setBusinessStatus(db, fake, biz.id, "suspended", "because")).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("admin suspension works and is audited in the same transaction", async () => {
		const result = await setBusinessStatus(db, admin, biz.id, "suspended", "non-payment");
		expect(result.status).toBe("suspended");
		const rows = await withBypass(db, admin.userId, (tx) =>
			tx.select().from(auditLog).where(eq(auditLog.action, "admin.business.suspend")),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].actorUserId).toBe(admin.userId);
		expect(rows[0].after).toMatchObject({ status: "suspended", reason: "non-payment" });
		await setBusinessStatus(db, admin, biz.id, "active", "paid");
		const [b] = await withBypass(db, null, (tx) => tx.select().from(businesses).where(eq(businesses.id, biz.id)));
		expect(b.status).toBe("active");
	});

	it("every member mutation left an audit row scoped to the business", async () => {
		const rows = await withBypass(db, null, (tx) => tx.select().from(auditLog).where(eq(auditLog.businessId, biz.id)));
		const actions = rows.map((r) => r.action);
		expect(actions).toContain("business.create");
		expect(actions).toContain("member.add");
		expect(actions).toContain("member.permissions.update");
	});
});
