import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiApp } from "../../server/api/app";
import { createAuth } from "../../server/auth/auth";
import { resolveTenantCtx } from "../../server/auth/ctx";
import { createBusiness } from "../../server/domain/businesses/service";
import { addMember } from "../../server/domain/members/service";
import { previewInvitation } from "../../server/domain/invitations/service";
import { outbox } from "../../server/email/send";
import { invitationEmail, resetCodeEmail } from "../../server/email/templates";
import { action as forgotAction, loader as forgotLoader } from "../../app/routes/auth/forgot";
import { action as teamAction, loader as teamLoader } from "../../app/routes/app/team";
import { createRouteHarness, status, type RouteHarness } from "../helpers/server";

/**
 * Phase 6: password reset by emailed code (/forgot) and invitation emails from Team.
 * Emails are captured in `outbox` (APP_ENV=test never sends). Each test uses its own
 * user and client IP so the per-email and per-IP throttles don't bleed between tests.
 */
describe("password reset and account emails", () => {
	let h: RouteHarness;
	let owner: { id: string; cookie: string };
	let employee: { id: string; cookie: string };
	const exec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
	const args = (request: Request, params: Record<string, string> = {}) => ({ request, params, context: h.context, unstable_pattern: "" }) as never;
	let ipSeq = 0;

	/** A form POST from its own client IP, like two different phones. */
	function post(url: string, form: Record<string, string>, opts: { ip?: string; cookie?: string } = {}) {
		const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": opts.ip ?? `198.51.100.${++ipSeq}` });
		if (opts.cookie) headers.set("cookie", opts.cookie);
		return new Request(`http://localhost${url}`, { method: "POST", headers, body: new URLSearchParams(form) });
	}
	type Step = { step: string; email?: string; otp?: string; error?: string };
	const forgot = (form: Record<string, string>, ip?: string) => forgotAction(args(post("/forgot", form, { ip }))) as Promise<Step>;
	const lastCode = () => {
		const m = /^(\d{6}) is your K3 reset code$/.exec(outbox.at(-1)?.subject ?? "");
		if (!m) throw new Error(`no reset email in outbox: ${outbox.map((e) => e.subject).join(", ")}`);
		return m[1];
	};
	const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

	beforeAll(async () => {
		h = await createRouteHarness();
		const admin = await h.seedUser({ email: "admin@k3.test", isPlatformAdmin: true });
		owner = await h.seedUser({ email: "owner@k3.test", name: "Lina Park" });
		employee = await h.seedUser({ email: "emp@k3.test", name: "Sam" });
		await createBusiness(h.db, { userId: admin.id, isPlatformAdmin: true }, owner.id, { name: "Lina <Nail> Studio", slug: "lina", timeZone: "America/New_York" });
		const ctx = (await resolveTenantCtx(h.db, owner.id, "lina"))!;
		await addMember(h.db, ctx, { userId: employee.id, role: "employee" });
	}, 120_000);
	afterAll(() => h.close());
	beforeEach(() => {
		outbox.length = 0;
	});

	describe("the HTTP edge", () => {
		it.each([
			"/api/auth/email-otp/send-verification-otp",
			"/api/auth/email-otp/check-verification-otp",
			"/api/auth/sign-in/email-otp",
			"/api/auth/forget-password/email-otp",
			"/api/auth/email-otp/reset-password",
			"/api/auth/request-password-reset",
			"/api/auth/reset-password",
		])("%s is 404 from outside", async (path) => {
			const res = await apiApp.fetch(
				new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@k3.test", type: "sign-in", otp: "000000" }) }),
				h.env,
				exec,
			);
			expect(res.status).toBe(404);
			expect(outbox).toHaveLength(0);
		});
	});

	describe("/forgot", () => {
		it("a signed-in user is sent home instead", async () => {
			const r = await status(() => forgotLoader(args(new Request("http://localhost/forgot", { headers: { cookie: owner.cookie } }))));
			expect(r.status).toBe(302);
			expect(r.location).toBe("/app/lina");
		});

		it("rejects a malformed email without sending", async () => {
			const r = await forgot({ intent: "send", email: "not-an-email" });
			expect(r.step).toBe("email");
			expect(r.error).toBeTruthy();
			expect(outbox).toHaveLength(0);
		});

		it("an unknown email gets the same answer as a real one, and nothing is sent", async () => {
			const r = await forgot({ intent: "send", email: "nobody@k3.test" });
			expect(r).toMatchObject({ step: "code", email: "nobody@k3.test" });
			expect(r.error).toBeUndefined();
			expect(outbox).toHaveLength(0);
		});

		it("a known email gets one code, in the subject and the text, and nothing else sensitive", async () => {
			await h.seedUser({ email: "send@k3.test" });
			const r = await forgot({ intent: "send", email: "SEND@k3.test" });
			expect(r).toMatchObject({ step: "code", email: "send@k3.test" });
			expect(outbox).toHaveLength(1);
			const mail = outbox[0];
			expect(mail.to).toBe("send@k3.test");
			const code = lastCode();
			expect(mail.text).toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
			expect(mail.html).not.toContain("correct horse");
		});

		it("a wrong code is refused; after three wrong tries even the right code no longer works", async () => {
			await h.seedUser({ email: "tries@k3.test" });
			await forgot({ intent: "send", email: "tries@k3.test" });
			const code = lastCode();
			for (let i = 0; i < 3; i++) {
				const r = await forgot({ intent: "check", email: "tries@k3.test", otp: wrong(code) });
				expect(r.step).toBe("code");
				expect(r.error).toBeTruthy();
			}
			const late = await forgot({ intent: "check", email: "tries@k3.test", otp: code });
			expect(late.step).toBe("code");
			expect(late.error).toBeTruthy();
		});

		it("a code that isn't six digits is refused before Better Auth sees it", async () => {
			const r = await forgot({ intent: "check", email: "send@k3.test", otp: "12ab" });
			expect(r).toMatchObject({ step: "code", error: "Enter all six digits" });
		});

		it("the full reset: right code, new password, signed in, other sessions revoked, old password dead, code single-use", async () => {
			const user = await h.seedUser({ email: "reset@k3.test" });
			const auth = createAuth(h.db, h.env);
			expect(await auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) })).not.toBeNull();

			await forgot({ intent: "send", email: "reset@k3.test" });
			const code = lastCode();
			const checked = await forgot({ intent: "check", email: "reset@k3.test", otp: code });
			expect(checked).toMatchObject({ step: "password", email: "reset@k3.test", otp: code });

			const short = await forgot({ intent: "reset", email: "reset@k3.test", otp: code, password: "too-short" });
			expect(short).toMatchObject({ step: "password", error: "Use at least 12 characters" });

			let redirect: Response | undefined;
			try {
				await forgot({ intent: "reset", email: "reset@k3.test", otp: code, password: "a brand new long password" });
			} catch (err) {
				redirect = err as Response;
			}
			expect(redirect?.status).toBe(302);
			expect(redirect?.headers.get("location")).toBe("/no-business");
			expect(redirect?.headers.get("set-cookie")).toBeTruthy();

			expect(await auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) })).toBeNull();
			await expect(h.signIn("reset@k3.test")).rejects.toThrow();
			await expect(h.signIn("reset@k3.test", "a brand new long password")).resolves.toBeTruthy();

			const replay = await forgot({ intent: "reset", email: "reset@k3.test", otp: code, password: "yet another long password" });
			expect(replay.step).toBe("code");
			expect(replay.error).toBeTruthy();
			await expect(h.signIn("reset@k3.test", "a brand new long password")).resolves.toBeTruthy();
		});

		it("a code for one account cannot reset another", async () => {
			await h.seedUser({ email: "victim@k3.test" });
			await h.seedUser({ email: "attacker@k3.test" });
			await forgot({ intent: "send", email: "attacker@k3.test" });
			const code = lastCode();
			const r = await forgot({ intent: "reset", email: "victim@k3.test", otp: code, password: "attacker chose this one" });
			expect(r.step).toBe("code");
			await expect(h.signIn("victim@k3.test")).resolves.toBeTruthy();
		});

		it("throttles codes per email: the fourth request in ten minutes sends nothing", async () => {
			await h.seedUser({ email: "spam@k3.test" });
			for (let i = 0; i < 3; i++) expect((await forgot({ intent: "send", email: "spam@k3.test" })).error).toBeUndefined();
			expect(outbox).toHaveLength(3);
			const fourth = await forgot({ intent: "send", email: "spam@k3.test" });
			expect(fourth.error).toMatch(/Too many codes/);
			expect(outbox).toHaveLength(3);
		});

		it("throttles codes per IP across different emails", async () => {
			const ip = "203.0.113.77";
			const answers: Step[] = [];
			for (let i = 0; i < 11; i++) answers.push(await forgot({ intent: "send", email: `ip${i}@k3.test` }, ip));
			expect(answers.slice(0, 10).every((a) => !a.error)).toBe(true);
			expect(answers[10].error).toMatch(/Too many codes/);
		});
	});

	describe("invitation emails from Team", () => {
		const team = (form: Record<string, string>, cookie: string) => teamAction(args(post("/app/lina/team", form, { cookie }), { business: "lina" })) as Promise<{ error?: string; inviteLink?: string; sentTo?: string; emailFailed?: boolean; resentTo?: string }>;

		it("sending an invitation emails the link that the accept page recognises", async () => {
			const r = await team({ intent: "invite", email: "New.Person@k3.test", role: "employee" }, owner.cookie);
			expect(r).toMatchObject({ sentTo: "new.person@k3.test", emailFailed: false });
			expect(outbox).toHaveLength(1);
			const mail = outbox[0];
			expect(mail.to).toBe("new.person@k3.test");
			expect(mail.fromName).toBe("Lina at Lina <Nail> Studio");
			expect(mail.subject).toBe("Join Lina <Nail> Studio on K3");
			expect(mail.html).toContain("Lina &lt;Nail&gt; Studio");
			expect(mail.html).not.toContain("<Nail>");
			expect(mail.text).toContain(r.inviteLink!);
			const token = r.inviteLink!.split("/invite/")[1];
			expect(await previewInvitation(h.db, token)).toMatchObject({ email: "new.person@k3.test", role: "employee" });
		});

		it("resend issues a fresh link and kills the old one", async () => {
			const first = await team({ intent: "invite", email: "resend@k3.test", role: "employee" }, owner.cookie);
			const oldToken = first.inviteLink!.split("/invite/")[1];
			const pending = (await teamLoader(args(new Request("http://localhost/app/lina/team", { headers: { cookie: owner.cookie } }), { business: "lina" }))) as { pending: { id: string; email: string; sentAt: Date }[] };
			const inv = pending.pending.find((p) => p.email === "resend@k3.test")!;
			expect(inv.sentAt).toBeTruthy();
			outbox.length = 0;

			const r = await team({ intent: "resend", invitationId: inv.id }, owner.cookie);
			expect(r.resentTo).toBe("resend@k3.test");
			expect(outbox).toHaveLength(1);
			const newToken = /\/invite\/([0-9a-f]+)/.exec(outbox[0].text)![1];
			expect(newToken).not.toBe(oldToken);
			expect(await previewInvitation(h.db, oldToken)).toBeNull();
			expect(await previewInvitation(h.db, newToken)).toMatchObject({ email: "resend@k3.test" });
		});

		it("an employee without team.manage cannot invite or resend", async () => {
			expect((await status(() => team({ intent: "invite", email: "x@k3.test", role: "employee" }, employee.cookie))).status).toBe(403);
			expect((await status(() => team({ intent: "resend", invitationId: "00000000-0000-0000-0000-000000000000" }, employee.cookie))).status).toBe(403);
			expect(outbox).toHaveLength(0);
		});

		it("resending an invitation from another business does nothing", async () => {
			const r = await team({ intent: "resend", invitationId: "00000000-0000-0000-0000-000000000000" }, owner.cookie);
			expect(r.error).toBeTruthy();
			expect(outbox).toHaveLength(0);
		});
	});

	describe("templates", () => {
		it("escape everything that came from a user and keep a plain-text part", () => {
			const inv = invitationEmail({ to: "a@b.test", inviterName: `Eve "<script>"`, businessName: `<img src=x onerror=alert(1)>`, role: "owner", link: "https://k3.test/invite/abc", expiresAt: new Date("2026-11-08T12:00:00Z"), timeZone: "America/New_York" });
			expect(inv.html).not.toMatch(/<img|<script/);
			expect(inv.text).toContain("You're joining as an owner.");
			expect(inv.text).toContain("Sunday, November 8");
			const reset = resetCodeEmail({ to: "a@b.test", code: "482916" });
			expect(reset.subject).toBe("482916 is your K3 reset code");
			expect(reset.text).toContain("482 916");
		});
	});
});
