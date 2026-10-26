import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTenantCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { auditLog, businessFeatureOverrides, businessMembers, businesses } from "../../server/db/schema";
import { withBypass, withTenant } from "../../server/db/tenant";
import { createBusiness } from "../../server/domain/businesses/service";
import { createTestDb, expectDbError, seedUser } from "../helpers/db";

/**
 * The plan's isolation guarantees, checked at the database layer with the real
 * migrations and the real application role. If any of these fail, nothing else
 * in the product is safe to ship.
 */
describe("tenant isolation", () => {
	let db: Db;
	let close: () => Promise<void>;
	let ownerA: { id: string };
	let ownerB: { id: string };
	let bizA: { id: string; slug: string };
	let bizB: { id: string; slug: string };
	let ctxA: TenantCtx;
	let ctxB: TenantCtx;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const admin = await seedUser(db, { isPlatformAdmin: true });
		ownerA = await seedUser(db);
		ownerB = await seedUser(db);
		const adminCtx = { userId: admin.id, isPlatformAdmin: true as const };
		bizA = await createBusiness(db, adminCtx, ownerA.id, { name: "Salon A", slug: "salon-a", timeZone: "America/New_York" });
		bizB = await createBusiness(db, adminCtx, ownerB.id, { name: "Salon B", slug: "salon-b", timeZone: "America/Chicago" });
		ctxA = (await resolveTenantCtx(db, ownerA.id, "salon-a"))!;
		ctxB = (await resolveTenantCtx(db, ownerB.id, "salon-b"))!;
		await withTenant(db, ctxA, (tx) =>
			tx.insert(businessFeatureOverrides).values({ businessId: bizA.id, featureKey: "sms", value: true }),
		);
		await withTenant(db, ctxB, (tx) =>
			tx.insert(businessFeatureOverrides).values({ businessId: bizB.id, featureKey: "sms", value: false }),
		);
	});

	afterAll(() => close());

	it("resolves a ctx only for members", async () => {
		expect(ctxA.businessId).toBe(bizA.id);
		expect(ctxA.role).toBe("owner");
		expect(await resolveTenantCtx(db, ownerA.id, "salon-b")).toBeNull();
		expect(await resolveTenantCtx(db, ownerA.id, "does-not-exist")).toBeNull();
	});

	it("A cannot read B's business by id", async () => {
		const rows = await withTenant(db, ctxA, (tx) => tx.select().from(businesses).where(eq(businesses.id, bizB.id)));
		expect(rows).toHaveLength(0);
	});

	it("A cannot update B's business, even with B's id", async () => {
		const updated = await withTenant(db, ctxA, (tx) =>
			tx.update(businesses).set({ name: "hacked" }).where(eq(businesses.id, bizB.id)).returning(),
		);
		expect(updated).toHaveLength(0);
		const [b] = await withTenant(db, ctxB, (tx) => tx.select().from(businesses).where(eq(businesses.id, bizB.id)));
		expect(b.name).toBe("Salon B");
	});

	it("A cannot insert a membership into B", async () => {
		await expectDbError(
			withTenant(db, ctxA, (tx) =>
				tx.insert(businessMembers).values({ businessId: bizB.id, userId: ownerA.id, role: "owner" }),
			),
			/row-level security/,
		);
	});

	it("a query that forgets its WHERE business_id returns only the caller's rows", async () => {
		const rows = await withTenant(db, ctxA, (tx) => tx.select().from(businessFeatureOverrides));
		expect(rows).toHaveLength(1);
		expect(rows[0].businessId).toBe(bizA.id);
	});

	it("a forged ctx naming a business the user is not a member of sees nothing", async () => {
		const forged: TenantCtx = { ...ctxA, businessId: bizB.id, businessSlug: "salon-b" };
		const biz = await withTenant(db, forged, (tx) => tx.select().from(businesses).where(eq(businesses.id, bizB.id)));
		const overrides = await withTenant(db, forged, (tx) => tx.select().from(businessFeatureOverrides));
		expect(biz).toHaveLength(0);
		expect(overrides).toHaveLength(0);
	});

	it("A cannot see B's members", async () => {
		const rows = await withTenant(db, ctxA, (tx) =>
			tx.select().from(businessMembers).where(eq(businessMembers.businessId, bizB.id)),
		);
		expect(rows).toHaveLength(0);
	});

	it("a user with no business selected sees only their own memberships", async () => {
		const { withUser } = await import("../../server/db/tenant");
		const rows = await withUser(db, ownerA.id, (tx) => tx.select().from(businessMembers));
		expect(rows.map((r) => r.userId)).toEqual([ownerA.id]);
	});

	it("the application role cannot alter or erase the audit log", async () => {
		await expectDbError(withBypass(db, null, (tx) => tx.update(auditLog).set({ action: "x" })), /permission denied/);
		await expectDbError(withBypass(db, null, (tx) => tx.delete(auditLog)), /permission denied/);
	});

	it("session settings do not leak between transactions", async () => {
		await withTenant(db, ctxA, async (tx) => {
			const { rows } = (await tx.execute(sql`select current_setting('app.business_id', true) as v`)) as unknown as { rows: { v: string }[] };
			expect(rows[0].v).toBe(bizA.id);
		});
		const { rows } = (await db.execute(sql`select current_setting('app.business_id', true) as v`)) as unknown as { rows: { v: string | null }[] };
		const v = rows[0].v;
		expect(v === null || v === "").toBe(true);
		const visible = await db.select().from(businesses);
		expect(visible).toHaveLength(0);
	});
});
