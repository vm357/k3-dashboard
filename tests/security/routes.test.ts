import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRouteHarness, req, status, type RouteHarness } from "../helpers/server";
import { createBusiness } from "../../server/domain/businesses/service";
import { loader as businessLayout } from "../../app/routes/app/business-layout";
import { loader as adminLayout } from "../../app/routes/admin/layout";
import { loader as signInLoader, action as signInAction } from "../../app/routes/auth/sign-in";
import { loader as homeLoader } from "../../app/routes/home";
import { action as settingsAction } from "../../app/routes/app/settings";
import { loader as teamLoader } from "../../app/routes/app/team";

/**
 * The route layer, exercised the way a browser would: real Better Auth sessions over
 * cookies, the real postgres.js client as k3_app, and loaders called with the params the
 * router would pass. These prove the "404, not 403" rule and the admin gate end to end.
 */
describe("routes", () => {
	let h: RouteHarness;
	let ownerA: { id: string; cookie: string };
	let ownerB: { id: string; cookie: string };
	let employeeA: { id: string; cookie: string };
	let admin: { id: string; cookie: string };
	let outsider: { id: string; cookie: string };

	beforeAll(async () => {
		h = await createRouteHarness();
		admin = await h.seedUser({ email: "admin@k3.test", isPlatformAdmin: true });
		ownerA = await h.seedUser({ email: "ownera@k3.test", name: "Owner A" });
		ownerB = await h.seedUser({ email: "ownerb@k3.test", name: "Owner B" });
		employeeA = await h.seedUser({ email: "empa@k3.test", name: "Employee A" });
		outsider = await h.seedUser({ email: "outsider@k3.test" });
		const adminCtx = { userId: admin.id, isPlatformAdmin: true as const };
		await createBusiness(h.db, adminCtx, ownerA.id, { name: "Salon A", slug: "salon-a", timeZone: "America/New_York" });
		await createBusiness(h.db, adminCtx, ownerB.id, { name: "Salon B", slug: "salon-b", timeZone: "America/New_York" });
		const { resolveTenantCtx } = await import("../../server/auth/ctx");
		const { addMember } = await import("../../server/domain/members/service");
		const ctxA = (await resolveTenantCtx(h.db, ownerA.id, "salon-a"))!;
		await addMember(h.db, ctxA, { userId: employeeA.id, role: "employee" });
	}, 120_000);

	afterAll(() => h.close());

	const args = (request: Request, params: Record<string, string> = {}) =>
		({ request, params, context: h.context, unstable_pattern: "" }) as never;

	it("signed-out users are redirected to sign-in with a return path", async () => {
		const r = await status(() => businessLayout(args(req("/app/salon-a"), { business: "salon-a" })));
		expect(r.status).toBe(302);
		expect(r.location).toBe("/sign-in?next=%2Fapp%2Fsalon-a");
	});

	it("sign-in with a wrong password fails without revealing which part was wrong", async () => {
		const r = await signInAction(args(req("/sign-in", { form: { email: "ownera@k3.test", password: "nope-nope-nope" } })));
		expect((r as { message?: string }).message).toMatch(/do not match/);
	});

	it("sign-in with the right password sets a cookie and lands on the only business", async () => {
		const r = await status(() =>
			signInAction(args(req("/sign-in", { form: { email: "ownera@k3.test", password: "correct horse battery staple" } }))),
		);
		expect(r.status).toBe(302);
		expect(r.location).toBe("/app/salon-a");
	});

	it("the root sends each user to the right home", async () => {
		expect((await status(() => homeLoader(args(req("/", { cookie: ownerA.cookie }))))).location).toBe("/app/salon-a");
		expect((await status(() => homeLoader(args(req("/", { cookie: admin.cookie }))))).location).toBe("/admin");
		expect((await status(() => homeLoader(args(req("/", { cookie: outsider.cookie }))))).location).toBe("/no-business");
	});

	it("a member loads their business; a non-member gets 404, not 403", async () => {
		const ok = await status(() => businessLayout(args(req("/app/salon-a", { cookie: ownerA.cookie }), { business: "salon-a" })));
		expect(ok.status).toBe(200);
		expect((ok.data as { business: { name: string } }).business.name).toBe("Salon A");

		const cross = await status(() => businessLayout(args(req("/app/salon-b", { cookie: ownerA.cookie }), { business: "salon-b" })));
		expect(cross.status).toBe(404);

		const missing = await status(() => businessLayout(args(req("/app/nope", { cookie: ownerA.cookie }), { business: "nope" })));
		expect(missing.status).toBe(404);
	});

	it("a signed-in sign-in page redirects home instead of showing the form", async () => {
		const r = await status(() => signInLoader(args(req("/sign-in", { cookie: ownerB.cookie }))));
		expect(r.status).toBe(302);
		expect(r.location).toBe("/app/salon-b");
	});

	it("an employee cannot change settings (403) and cannot open the team page without team.view", async () => {
		const settings = await status(() =>
			settingsAction(args(req("/app/salon-a/settings", { cookie: employeeA.cookie, form: { name: "Hacked", timeZone: "America/New_York" } }), { business: "salon-a" })),
		);
		expect(settings.status).toBe(403);
		const team = await status(() => teamLoader(args(req("/app/salon-a/team", { cookie: employeeA.cookie }), { business: "salon-a" })));
		expect(team.status).toBe(403);
	});

	it("the owner can change settings, and the change is scoped to their business", async () => {
		const r = await status(() =>
			settingsAction(args(req("/app/salon-a/settings", { cookie: ownerA.cookie, form: { name: "Salon A Renamed", timeZone: "America/New_York" } }), { business: "salon-a" })),
		);
		expect(r.status).toBe(200);
		const b = await status(() => businessLayout(args(req("/app/salon-b", { cookie: ownerB.cookie }), { business: "salon-b" })));
		expect((b.data as { business: { name: string } }).business.name).toBe("Salon B");
	});

	it("the admin area is 404 for everyone but platform admins", async () => {
		expect((await status(() => adminLayout(args(req("/admin", { cookie: ownerA.cookie }))))).status).toBe(404);
		expect((await status(() => adminLayout(args(req("/admin", { cookie: outsider.cookie }))))).status).toBe(404);
		expect((await status(() => adminLayout(args(req("/admin", { cookie: admin.cookie }))))).status).toBe(200);
	});

	it("a forged or garbage cookie is treated as signed out", async () => {
		const r = await status(() => businessLayout(args(req("/app/salon-a", { cookie: "better-auth.session_token=forged" }), { business: "salon-a" })));
		expect(r.status).toBe(302);
	});
});
