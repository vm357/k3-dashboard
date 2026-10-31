/**
 * Post-deploy smoke test. Hits a deployed (or locally built) K3 Dashboard from the
 * outside and checks the things that break silently: the database round-trip, the
 * sign-in page rendering with a matching CSP nonce, the auth gate, and the public
 * sign-up endpoint staying closed. No credentials needed; nothing is written.
 *
 *   npx tsx scripts/smoke.ts https://staging-app.kermitwebcraft.com
 */
const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures.push(name);
};
const get = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { redirect: "manual", ...init });

const health = await get("/api/health");
const body = (await health.json().catch(() => ({}))) as { ok?: boolean; env?: string };
check("health 200 with database round-trip", health.status === 200 && body.ok === true, `status ${health.status}, env ${body.env ?? "?"}`);

const signIn = await get("/sign-in");
const html = await signIn.text();
check("sign-in page renders", signIn.status === 200 && /Sign in/i.test(html), `status ${signIn.status}`);
const csp = signIn.headers.get("content-security-policy") ?? "";
const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
check("CSP present with a script nonce", !!nonce);
check("HTML scripts carry the same nonce", !!nonce && html.includes(`nonce="${nonce}"`));
check("HSTS set", /max-age=\d+/.test(signIn.headers.get("strict-transport-security") ?? ""));
check("clickjacking blocked", csp.includes("frame-ancestors 'none'"));

const gated = await get("/app/anything");
check("dashboard redirects signed-out users to sign-in", gated.status === 302 && (gated.headers.get("location") ?? "").startsWith("/sign-in"), `status ${gated.status}`);

const admin = await get("/admin");
check("admin is not visible to outsiders", admin.status === 302 || admin.status === 404, `status ${admin.status}`);

const signUp = await get("/api/auth/sign-up/email", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ email: "smoke@example.invalid", password: "smoke-test-password-xyz", name: "smoke" }),
});
check("public sign-up is closed", signUp.status === 404, `status ${signUp.status}`);

const asset = html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/)?.[1];
if (asset) {
	const a = await get(asset);
	check("client bundle served", a.status === 200 && (a.headers.get("content-type") ?? "").includes("javascript"), `status ${a.status}`);
}

if (failures.length) {
	console.error(`\n${failures.length} check(s) failed against ${base}`);
	process.exit(1);
}
console.log(`\nall checks passed against ${base}`);
