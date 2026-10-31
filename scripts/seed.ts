import { sql } from "drizzle-orm";
import { createAuth } from "../server/auth/auth";
import { resolveTenantCtx } from "../server/auth/ctx";
import { createDb } from "../server/db/client";
import * as schema from "../server/db/schema";
import { withBypass } from "../server/db/tenant";
import { readEnv } from "../server/env";
import { setHours, setPolicy } from "../server/domain/businesses/hours";
import { createBusiness } from "../server/domain/businesses/service";
import { createCustomer, addCustomerNote } from "../server/domain/customers/service";
import { createCategory, createService } from "../server/domain/services/service";
import { createEmployee, setEmployeeAvailability, setEmployeeServices } from "../server/domain/staff/service";
import { listMembers } from "../server/domain/members/service";

/**
 * Development seed: one platform admin and one demo salon with an owner, services,
 * staff hours and a few clients. Refuses to run outside development and test.
 *
 *   DATABASE_URL=... npm run db:seed
 *
 * Sign in as admin@k3.local or lina@demo.local, password: demo-password-123
 */
const env = readEnv({
	APP_ENV: process.env.APP_ENV ?? "development",
	APP_ORIGIN: process.env.APP_ORIGIN ?? "http://localhost:5173",
	AUTH_SECRET: process.env.AUTH_SECRET ?? "local-development-secret-not-for-production-1",
	DATABASE_URL: process.env.DATABASE_URL,
});
if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
	throw new Error(`seed refuses to run with APP_ENV=${env.APP_ENV}`);
}

const PASSWORD = "demo-password-123";
const db = createDb(env);
const auth = createAuth(db, env);

async function userByEmail(email: string) {
	const [u] = await withBypass(db, null, (tx) => tx.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`));
	return u ?? null;
}

async function ensureUser(email: string, name: string, isPlatformAdmin = false) {
	const existing = await userByEmail(email);
	if (existing) return existing;
	const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name }, headers: new Headers(), asResponse: true });
	if (!res.ok) throw new Error(`sign-up failed for ${email}: ${res.status} ${await res.text()}`);
	const u = (await userByEmail(email))!;
	if (isPlatformAdmin) await withBypass(db, null, (tx) => tx.update(schema.users).set({ isPlatformAdmin: true }).where(sql`${schema.users.id} = ${u.id}`));
	return u;
}

const admin = await ensureUser("admin@k3.local", "Kermit", true);
const lina = await ensureUser("lina@demo.local", "Lina Park");
const adminCtx = { userId: admin.id, isPlatformAdmin: true as const };

const existingBiz = await withBypass(db, null, (tx) => tx.select({ id: schema.businesses.id }).from(schema.businesses).where(sql`${schema.businesses.slug} = 'demo-salon'`));
if (existingBiz.length === 0) {
	await createBusiness(db, adminCtx, lina.id, { name: "Lina Nail Studio", slug: "demo-salon", timeZone: "America/New_York" });
	const ctx = (await resolveTenantCtx(db, lina.id, "demo-salon"))!;

	const gel = await createCategory(db, ctx, { name: "Gel" });
	const acrylic = await createCategory(db, ctx, { name: "Acrylic" });
	const s1 = await createService(db, ctx, { name: "Gel manicure", durationMinutes: 45, priceCents: 4500, categoryId: gel.id, depositType: "none", depositAmount: 0 });
	const s2 = await createService(db, ctx, { name: "Gel fill", durationMinutes: 60, bufferAfterMinutes: 10, priceCents: 4500, categoryId: gel.id, depositType: "percent", depositAmount: 50 });
	const s3 = await createService(db, ctx, { name: "Full set, acrylic", durationMinutes: 105, bufferAfterMinutes: 15, priceCents: 8000, categoryId: acrylic.id, depositType: "fixed", depositAmount: 2500 });
	const s4 = await createService(db, ctx, { name: "Nail art, 2 to 4 nails", durationMinutes: 15, priceCents: 1500, depositType: "none", depositAmount: 0 });
	const s5 = await createService(db, ctx, { name: "Pedicure", durationMinutes: 60, priceCents: 5500, depositType: "none", depositAmount: 0 });
	await createService(db, ctx, { name: "Removal", durationMinutes: 20, priceCents: 2000, depositType: "none", depositAmount: 0, bookableOnline: false });

	const memberId = (await listMembers(db, ctx)).find((m) => m.userId === lina.id)!.id;
	const emp = await createEmployee(db, ctx, { displayName: "Lina", memberId, bio: "Owner. Gel and acrylic, hand-painted art." });
	await setEmployeeServices(db, ctx, emp.id, [s1.id, s2.id, s3.id, s4.id, s5.id]);
	await setEmployeeAvailability(db, ctx, emp.id, [
		{ weekday: 2, startsAt: "09:00", endsAt: "17:00" },
		{ weekday: 3, startsAt: "09:00", endsAt: "17:00" },
		{ weekday: 4, startsAt: "11:00", endsAt: "19:00" },
		{ weekday: 5, startsAt: "09:00", endsAt: "17:00" },
		{ weekday: 6, startsAt: "10:00", endsAt: "15:00" },
	]);
	await setHours(db, ctx, [
		{ weekday: 2, opensAt: "09:00", closesAt: "17:00" },
		{ weekday: 3, opensAt: "09:00", closesAt: "17:00" },
		{ weekday: 4, opensAt: "11:00", closesAt: "19:00" },
		{ weekday: 5, opensAt: "09:00", closesAt: "17:00" },
		{ weekday: 6, opensAt: "10:00", closesAt: "15:00" },
	]);
	await setPolicy(db, ctx, { slotIntervalMinutes: 15, minNoticeMinutes: 120, maxAdvanceDays: 60, cancellationWindowHours: 24, cancellationNote: "Deposits are kept for cancellations inside 24 hours." });

	const maya = await createCustomer(db, ctx, { firstName: "Maya", lastName: "Reyes", email: "maya@example.test", phone: "555-014-2290", pinnedNote: "Almond, medium. Sensitive cuticles, go easy with the e-file. Likes to see the color on one nail first." });
	await addCustomerNote(db, ctx, maya.id, "OPI Bubble Bath base, chrome powder on ring fingers. She loved the chrome, wants it again.");
	await addCustomerNote(db, ctx, maya.id, "Slight lift on left thumb from last set, filed down and rebuilt.");
	await createCustomer(db, ctx, { firstName: "Priya", lastName: "Natarajan", phone: "555-300-1111" });
	await createCustomer(db, ctx, { firstName: "Tasha", lastName: "Brown", email: "tasha@example.test", phone: "555-777-0199", marketingConsent: true });
	await createCustomer(db, ctx, { firstName: "Jordan", lastName: "Lee", phone: "555-212-4040", pinnedNote: "Short square, clear gel only." });
	console.log("seeded demo salon /app/demo-salon");
} else {
	console.log("demo salon already present; users ensured");
}
console.log(`sign in: admin@k3.local or lina@demo.local, password ${PASSWORD}`);
process.exit(0);
