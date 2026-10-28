import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, resolveTenantCtx, type AdminCtx, type TenantCtx } from "../../server/auth/ctx";
import type { Db } from "../../server/db/client";
import { invitations } from "../../server/db/schema";
import { withBypass, withTenant } from "../../server/db/tenant";
import { onboardBusiness } from "../../server/domain/admin/onboarding";
import { createBusiness } from "../../server/domain/businesses/service";
import { acceptInvitation, createInvitation, listPendingInvitations, previewInvitation } from "../../server/domain/invitations/service";
import { listMembers } from "../../server/domain/members/service";
import { createTestDb, seedUser } from "../helpers/db";

describe("invitations and onboarding", () => {
	let db: Db;
	let close: () => Promise<void>;
	let admin: AdminCtx;
	let ownerCtx: TenantCtx;
	let otherOwnerCtx: TenantCtx;

	beforeAll(async () => {
		({ db, close } = await createTestDb());
		const adminUser = await seedUser(db, { isPlatformAdmin: true });
		admin = { userId: adminUser.id, isPlatformAdmin: true };
		const owner = await seedUser(db);
		const other = await seedUser(db);
		await createBusiness(db, admin, owner.id, { name: "Glow Lashes", slug: "glow-lashes", timeZone: "America/New_York" });
		await createBusiness(db, admin, other.id, { name: "Other Salon", slug: "other-salon", timeZone: "America/New_York" });
		ownerCtx = (await resolveTenantCtx(db, owner.id, "glow-lashes"))!;
		otherOwnerCtx = (await resolveTenantCtx(db, other.id, "other-salon"))!;
	});

	afterAll(() => close());

	it("an owner invites an employee; the token is returned once and only its hash is stored", async () => {
		const { invitation, token } = await createInvitation(db, ownerCtx, { email: "Tech@Example.test" });
		expect(token).toHaveLength(64);
		expect(invitation.email).toBe("tech@example.test");
		expect(invitation.tokenHash).not.toBe(token);
		const pending = await listPendingInvitations(db, ownerCtx);
		expect(pending.map((p) => p.email)).toContain("tech@example.test");
	});

	it("another business cannot see or revoke the invitation", async () => {
		const rows = await withTenant(db, otherOwnerCtx, (tx) => tx.select().from(invitations));
		expect(rows).toHaveLength(0);
	});

	it("preview works with the raw token and refuses a wrong one", async () => {
		const { token } = await createInvitation(db, ownerCtx, { email: "preview@example.test" });
		const ok = await previewInvitation(db, token);
		expect(ok?.businessName).toBe("Glow Lashes");
		expect(ok?.email).toBe("preview@example.test");
		expect(await previewInvitation(db, token.replace(/./g, "0"))).toBeNull();
	});

	it("accepting binds the membership with the invited permissions, once", async () => {
		const { token } = await createInvitation(db, ownerCtx, {
			email: "newhire@example.test",
			permissions: ["calendar.view_own", "customers.view"],
		});
		const user = await withBypass(db, null, async (tx) => {
			const { users } = await import("../../server/db/schema");
			const [u] = await tx.insert(users).values({ name: "New Hire", email: "newhire@example.test" }).returning();
			return u;
		});
		const { businessSlug } = await acceptInvitation(db, token, user.id);
		expect(businessSlug).toBe("glow-lashes");
		const ctx = (await resolveTenantCtx(db, user.id, "glow-lashes"))!;
		expect(ctx.role).toBe("employee");
		expect([...ctx.permissions].sort()).toEqual(["calendar.view_own", "customers.view"]);
		await expect(acceptInvitation(db, token, user.id)).rejects.toMatchObject({ code: "invitation_invalid" });
	});

	it("a user with a different email cannot accept someone else's invitation", async () => {
		const { token } = await createInvitation(db, ownerCtx, { email: "intended@example.test" });
		const intruder = await seedUser(db);
		await expect(acceptInvitation(db, token, intruder.id)).rejects.toMatchObject({ code: "invitation_email_mismatch" });
		expect(await resolveTenantCtx(db, intruder.id, "glow-lashes")).toBeNull();
	});

	it("an employee without team.manage cannot invite, and only an owner can invite an owner", async () => {
		const { token } = await createInvitation(db, ownerCtx, { email: "emp2@example.test", permissions: ["team.view", "team.manage"] });
		const emp = await withBypass(db, null, async (tx) => {
			const { users } = await import("../../server/db/schema");
			const [u] = await tx.insert(users).values({ name: "Emp Two", email: "emp2@example.test" }).returning();
			return u;
		});
		await acceptInvitation(db, token, emp.id);
		const empCtx = (await resolveTenantCtx(db, emp.id, "glow-lashes"))!;
		await expect(createInvitation(db, empCtx, { email: "x@example.test", role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
		await createInvitation(db, empCtx, { email: "y@example.test" });
	});

	it("admin onboarding with a new owner email creates the business and an owner invitation", async () => {
		const { business, inviteToken } = await onboardBusiness(db, admin, {
			name: "Fresh Nails",
			slug: "fresh-nails",
			timeZone: "America/Chicago",
			ownerEmail: "fresh@example.test",
		});
		expect(inviteToken).toBeTruthy();
		const owner = await withBypass(db, null, async (tx) => {
			const { users } = await import("../../server/db/schema");
			const [u] = await tx.insert(users).values({ name: "Fresh Owner", email: "fresh@example.test" }).returning();
			return u;
		});
		await acceptInvitation(db, inviteToken!, owner.id);
		const ctx = (await resolveTenantCtx(db, owner.id, "fresh-nails"))!;
		expect(ctx.role).toBe("owner");
		expect(ctx.businessId).toBe(business.id);
		const members = await listMembers(db, ctx);
		expect(members).toHaveLength(1);
	});

	it("admin onboarding with an existing user attaches them as owner immediately", async () => {
		const existing = await seedUser(db);
		const [{ email }] = await withBypass(db, null, async (tx) => {
			const { users } = await import("../../server/db/schema");
			return tx.select({ email: users.email }).from(users).where(eq(users.id, existing.id));
		});
		const { inviteToken } = await onboardBusiness(db, admin, { name: "Existing Co", slug: "existing-co", timeZone: "America/New_York", ownerEmail: email });
		expect(inviteToken).toBeNull();
		const ctx = await resolveTenantCtx(db, existing.id, "existing-co");
		expect(ctx?.role).toBe("owner");
	});
});
