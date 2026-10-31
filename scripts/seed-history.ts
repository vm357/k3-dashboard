import { sql } from "drizzle-orm";
import { resolveTenantCtx } from "../server/auth/ctx";
import { createDb } from "../server/db/client";
import * as schema from "../server/db/schema";
import { withBypass } from "../server/db/tenant";
import { readEnv } from "../server/env";
import { bookAppointment, transition } from "../server/domain/appointments/service";
import { setPolicy } from "../server/domain/businesses/hours";
import { createCustomer, listCustomers } from "../server/domain/customers/service";
import { addDays, localDateOf, zonedTimeToUtc } from "../server/domain/scheduling/time";
import { listServices } from "../server/domain/services/service";
import { listEmployees } from "../server/domain/staff/service";

/**
 * Development seed, part 3: three months of history so Reports and "Due for a visit"
 * have something to say, plus one likely duplicate for the merge screen. Past
 * appointments are booked with the staff path (no minimum notice) then marked done.
 */
const env = readEnv({ APP_ENV: process.env.APP_ENV ?? "development", APP_ORIGIN: "http://localhost:5173", AUTH_SECRET: "local-development-secret-not-for-production-1", DATABASE_URL: process.env.DATABASE_URL });
if (env.APP_ENV !== "development" && env.APP_ENV !== "test") throw new Error("development only");
const db = createDb(env);
const [lina] = await withBypass(db, null, (tx) => tx.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = 'lina@demo.local'`));
const ctx = (await resolveTenantCtx(db, lina.id, "demo-salon"))!;
const tz = "America/New_York";
const today = localDateOf(new Date(), tz);
await setPolicy(db, ctx, { minNoticeMinutes: 0, maxAdvanceDays: 365 });
const emp = (await listEmployees(db, ctx))[0];
const svc = (await listServices(db, ctx)).services;
const by = (n: string) => svc.find((s) => s.name.startsWith(n))!.id;
// Two clients who drifted away, so "Due for a visit" has someone to show.
for (const extra of [
	{ firstName: "Sofia", lastName: "Alvarez", phone: "555-410-8832" },
	{ firstName: "Dana", lastName: "Kim", email: "dana@example.test" },
]) {
	if (!(await listCustomers(db, ctx, { query: extra.firstName })).length) await createCustomer(db, ctx, extra);
}
const clients = await listCustomers(db, ctx);
const c = (n: string) => clients.find((x) => x.firstName === n)!.id;

// [client, services, days ago, status]
const history: [string, string[], number, "completed" | "no_show" | "cancelled"][] = [
	["Maya", [by("Gel fill")], 84, "completed"],
	["Maya", [by("Gel fill"), by("Nail art")], 63, "completed"],
	["Maya", [by("Gel fill")], 42, "completed"],
	["Maya", [by("Gel fill")], 21, "completed"],
	["Priya", [by("Pedicure")], 70, "completed"],
	["Priya", [by("Pedicure")], 35, "completed"],
	["Tasha", [by("Full set")], 55, "completed"],
	["Tasha", [by("Gel fill")], 27, "completed"],
	["Tasha", [by("Gel fill")], 6, "no_show"],
	["Jordan", [by("Gel manicure")], 48, "completed"],
	["Jordan", [by("Gel manicure")], 20, "completed"],
	["Jordan", [by("Gel manicure")], 3, "completed"],
	["Jordan", [by("Nail art")], 10, "cancelled"],
	["Sofia", [by("Full set")], 92, "completed"],
	["Sofia", [by("Gel fill")], 61, "completed"],
	["Dana", [by("Pedicure")], 50, "completed"],
];
// Idempotent: a client who already has a finished visit was seeded before.
const seeded = new Set(
	(await withBypass(db, null, (tx) => tx.selectDistinct({ id: schema.appointments.customerId }).from(schema.appointments).where(sql`${schema.appointments.businessId} = ${ctx.businessId} and ${schema.appointments.status} in ('completed','no_show') and ${schema.appointments.startAt} < ${zonedTimeToUtc(today, "00:00", tz).toISOString()}::timestamptz`))).map((r) => r.id),
);
let made = 0;
for (const [who, ids, ago, st] of history) {
	if (seeded.has(c(who))) continue;
	const hhmm = `${String(10 + (ago % 6)).padStart(2, "0")}:00`;
	let ok = false;
	// Closed days (Sunday, Monday) slide to the next open one.
	for (let shift = 0; shift < 3 && !ok; shift++) {
		const day = addDays(today, -(ago + shift));
		try {
			const a = await bookAppointment(db, ctx, { employeeId: emp.id, serviceIds: ids, startAt: zonedTimeToUtc(day, hhmm, tz), customerId: c(who) });
			await transition(db, ctx, a.id, st);
			made++;
			ok = true;
		} catch (e) {
			if (shift === 2) console.log(`skip ${who} -${ago}d: ${(e as Error).message}`);
		}
	}
}
// A duplicate: same phone as Maya, entered again at the front desk.
const maya = clients.find((x) => x.firstName === "Maya")!;
if (!clients.some((x) => x.firstName === "Maya" && x.id !== maya.id)) {
	const full = await listCustomers(db, ctx, { query: "maya" });
	const phone = full[0]?.phone && full[0].phone !== "hidden" ? full[0].phone : "555-777-0101";
	await createCustomer(db, ctx, { firstName: "Maya", lastName: "R.", phone });
	console.log("added duplicate Maya");
}
console.log(`seeded ${made} past appointments`);
process.exit(0);
