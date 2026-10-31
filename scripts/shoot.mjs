import { chromium } from "playwright";
import fs from "node:fs";

/**
 * Visual pass: signs in and screenshots every screen at phone (390x844) and
 * desktop (1280x820). Output in lab/shots/. Run with the dev server and local db up:
 *   node scripts/shoot.mjs [baseUrl]
 */
const base = process.argv[2] ?? "http://127.0.0.1:5173";
const out = "lab/shots";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const sizes = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1280, height: 820 } };

async function signIn(page, email) {
	await page.goto(`${base}/sign-in`);
	await page.fill('input[name="email"]', email);
	await page.fill('input[name="password"]', "demo-password-123");
	await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/sign-in")), page.click('button[type="submit"]')]);
}

const problems = [];
for (const [name, viewport] of Object.entries(sizes)) {
	const ctx = await browser.newContext({ viewport, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch, deviceScaleFactor: viewport.deviceScaleFactor ?? 1 });
	const page = await ctx.newPage();
	page.on("pageerror", (e) => problems.push(`${name}: pageerror ${e.message}`));
	page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: console ${m.text().slice(0, 200)}`); });

	await page.goto(`${base}/sign-in`);
	await page.screenshot({ path: `${out}/${name}-00-sign-in.png`, fullPage: true });

	await signIn(page, "lina@demo.local");
	const b = "/app/demo-salon";
	const screens = [
		["01-today", b],
		["02-services", `${b}/services`],
		["03-service-edit", `${b}/services/new`],
		["04-team", `${b}/team`],
		["06-clients", `${b}/clients`],
		["07-client-new", `${b}/clients/new`],
		["09-settings", `${b}/settings`],
		["10-calendar", `${b}/calendar`],
		["13-reports", `${b}/reports?period=last90`],
		["14-duplicates", `${b}/clients/duplicates`],
	];
	for (const [label, path] of screens) {
		await page.goto(`${base}${path}`);
		await page.waitForLoadState("networkidle");
		await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true });
	}
	// Employee and client detail: follow the first link on each list.
	await page.goto(`${base}${b}/team`);
	const empHref = await page.locator(`a[href^="${b}/team/"]`).first().getAttribute("href");
	if (empHref) { await page.goto(`${base}${empHref}`); await page.waitForLoadState("networkidle"); await page.screenshot({ path: `${out}/${name}-05-employee.png`, fullPage: true }); }
	await page.goto(`${base}${b}/clients`);
	const cHref = await page.locator(`a[href^="${b}/clients/"]`).first().getAttribute("href");
	if (cHref) { await page.goto(`${base}${cHref}`); await page.waitForLoadState("networkidle"); await page.screenshot({ path: `${out}/${name}-08-client.png`, fullPage: true }); }

	// Admin
	await page.goto(`${base}/sign-out`);
	await ctx.clearCookies();
	await signIn(page, "admin@k3.local");
	await page.goto(`${base}/admin`); await page.waitForLoadState("networkidle");
	await page.screenshot({ path: `${out}/${name}-11-admin.png`, fullPage: true });
	await page.goto(`${base}/admin/businesses/new`); await page.waitForLoadState("networkidle");
	await page.screenshot({ path: `${out}/${name}-12-admin-new.png`, fullPage: true });
	await ctx.close();
}
await browser.close();
fs.writeFileSync(`${out}/problems.txt`, problems.join("\n"));
console.log(`done: ${fs.readdirSync(out).length - 1} screenshots, ${problems.length} console/page errors`);
