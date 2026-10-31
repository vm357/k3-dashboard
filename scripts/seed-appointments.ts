import { sql } from "drizzle-orm";
import { resolveTenantCtx } from "../server/auth/ctx";
import { createDb } from "../server/db/client";
import * as schema from "../server/db/schema";
import { withBypass } from "../server/db/tenant";
import { readEnv } from "../server/env";
import { bookAppointment, transition } from "../server/domain/appointments/service";
import { setHours } from "../server/domain/businesses/hours";
import { listCustomers } from "../server/domain/customers/service";
import { addDays, formatLocalDate, localDateOf, weekdayOf, zonedTimeToUtc } from "../server/domain/scheduling/time";
import { listServices } from "../server/domain/services/service";
import { listEmployees, setEmployeeAvailability } from "../server/domain/staff/service";

/**
 * Development seed, part 2: a believable day of appointments for the demo salon,
 * relative to today so the Today screen always has something on it. Opens the
 * salon today and tomorrow if it was closed, so the demo reads well any weekday.
 */
const env = readEnv({ APP_ENV: process.env.APP_ENV ?? "development", APP_ORIGIN: "http://localhost:5173", AUTH_SECRET: "local-development-secret-not-for-production-1", DATABASE_URL: process.env.DATABASE_URL });
if (env.APP_ENV !== "development" && env.APP_ENV !== "test") throw new Error("development only");
const db = createDb(env);
const [lina] = await withBypass(db, null, (tx) => tx.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = 'lina@demo.local'`));
const ctx = (await resolveTenantCtx(db, lina.id, "demo-salon"))!;
const tz = "America/New_York";
const today = localDateOf(new Date(), tz);
const tomorrow = addDays(today, 1);
const wd = [weekdayOf(today), weekdayOf(tomorrow)];
await setHours(db, ctx, [2, 3, 4, 5, 6, ...wd].filter((v, i, a) => a.indexOf(v) === i).map((d) => ({ weekday: d, opensAt: "09:00", closesAt: "18:00" })));
const emp = (await listEmployees(db, ctx))[0];
await setEmployeeAvailability(db, ctx, emp.id, [2, 3, 4, 5, 6, ...wd].filter((v, i, a) => a.indexOf(v) === i).map((d) => ({ weekday: d, startsAt: "09:00", endsAt: "18:00" })));
const svc = (await listServices(db, ctx)).services;
const by = (n: string) => svc.find((s) => s.name.startsWith(n))!.id;
const clients = await listCustomers(db, ctx);
const c = (n: string) => clients.find((x) => x.firstName === n)!.id;

const plan: [string, string[], string, string?][] = [
	["09:00", [by("Gel manicure")], "Jordan", "completed"],
	["10:30", [by("Gel fill"), by("Nail art")], "Maya"],
	["12:00", [by("Pedicure")], "Priya"],
	["14:30", [by("Full set"), by("Removal")], "Tasha"],
];
let made = 0;
for (const [hhmm, ids, who, status] of plan) {
	try {
		const a = await bookAppointment(db, ctx, { employeeId: emp.id, serviceIds: ids, startAt: zonedTimeToUtc(today, hhmm, tz), customerId: c(who) });
		if (status === "completed") await transition(db, ctx, a.id, "completed");
		made++;
	} catch (e) {
		console.log(`skip ${hhmm}: ${(e as Error).message}`);
	}
}
try {
	await bookAppointment(db, ctx, { employeeId: emp.id, serviceIds: [by("Gel fill")], startAt: zonedTimeToUtc(tomorrow, "11:00", tz), customerId: c("Maya") });
	made++;
} catch (e) { console.log(`skip tomorrow: ${(e as Error).message}`); }
console.log(`booked ${made} appointments for ${formatLocalDate(today)} and ${formatLocalDate(tomorrow)}`);
process.exit(0);
