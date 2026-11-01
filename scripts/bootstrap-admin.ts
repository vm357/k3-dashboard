import { sql } from "drizzle-orm";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createAuth } from "../server/auth/auth";
import { createDb } from "../server/db/client";
import * as schema from "../server/db/schema";
import { withBypass } from "../server/db/tenant";
import { readEnv } from "../server/env";

/**
 * Creates the first platform admin in an empty database. This is the only way into a
 * fresh staging or production deployment: open sign-up is closed and the seed script
 * refuses to run there. It refuses to run once any user exists, so it cannot be used
 * later to add admins; a further admin is made by setting is_platform_admin on the
 * user's row (there is no screen for that yet, on purpose).
 *
 *   npx tsx scripts/bootstrap-admin.ts
 *
 * It asks for each value (secrets are typed without echo). Every answer can also be
 * given as an environment variable of the same name to skip the prompt, which is how
 * an automated run would do it. Nothing is printed except the outcome; secrets are
 * read once and never logged or written anywhere.
 *
 * The password hash is Better Auth's own, so the account signs in normally afterwards.
 */
function plainQuestion(prompt: string): Promise<string> {
	const rl = createInterface({ input: stdin, output: stdout });
	return rl.question(prompt).finally(() => rl.close());
}

/** Reads a line with the terminal in raw mode so nothing typed or pasted is echoed. */
function hiddenQuestion(prompt: string): Promise<string> {
	return new Promise((resolve) => {
		stdout.write(prompt);
		const wasRaw = stdin.isRaw;
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");
		let buf = "";
		const onData = (chunk: string) => {
			for (const ch of chunk) {
				if (ch === "\r" || ch === "\n") {
					stdin.removeListener("data", onData);
					stdin.setRawMode(wasRaw ?? false);
					stdin.pause();
					stdout.write("\n");
					resolve(buf);
					return;
				}
				if (ch === "\u0003") process.exit(130); // Ctrl-C
				if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
				else if (ch >= " ") buf += ch;
			}
		};
		stdin.on("data", onData);
	});
}

async function ask(name: string, label: string, opts: { secret?: boolean; fallback?: string } = {}): Promise<string> {
	const fromEnv = process.env[name]?.trim();
	if (fromEnv) return fromEnv;
	if (!stdin.isTTY) {
		if (opts.fallback !== undefined) return opts.fallback;
		throw new Error(`${name} is required (no terminal to ask in)`);
	}
	const prompt = `${label}${opts.fallback ? ` [${opts.fallback}]` : ""}: `;
	const answer = opts.secret ? await hiddenQuestion(prompt) : await plainQuestion(prompt);
	return answer.trim() || opts.fallback || "";
}

const target = await ask("APP_ENV", "Environment (staging or production)", { fallback: "staging" });
if (target !== "staging" && target !== "production") throw new Error("Environment must be staging or production");
const origin = target === "production" ? "https://app.kermitwebcraft.com" : "https://staging-app.kermitwebcraft.com";
const databaseUrl = await ask("DATABASE_URL", `Neon ${target} connection string for neondb_owner (pasted text stays hidden)`, { secret: true });
const authSecret = await ask("AUTH_SECRET", `The ${target} AUTH_SECRET from GitHub (hidden)`, { secret: true });
const email = (await ask("ADMIN_EMAIL", "Admin email")).toLowerCase();
const name = await ask("ADMIN_NAME", "Admin display name", { fallback: "Admin" });
const password = await ask("ADMIN_PASSWORD", "Admin password, 12+ characters (hidden)", { secret: true });
if (!email.includes("@")) throw new Error("That is not an email address");
if (password.length < 12) throw new Error("The password must be at least 12 characters");

const env = readEnv({ APP_ENV: target, APP_ORIGIN: process.env.APP_ORIGIN ?? origin, AUTH_SECRET: authSecret, DATABASE_URL: databaseUrl });
const db = createDb(env);

const [{ n }] = await withBypass(db, null, (tx) => tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.users));
if (n > 0) {
	console.error(`Refusing: ${n} user(s) already exist. Further admins are made by setting is_platform_admin on their user row.`);
	process.exit(1);
}

const auth = createAuth(db, env);
const res = await auth.api.signUpEmail({ body: { email, password, name }, headers: new Headers(), asResponse: true });
if (!res.ok) {
	console.error(`Could not create the account (${res.status}).`);
	process.exit(1);
}
await withBypass(db, null, (tx) => tx.update(schema.users).set({ isPlatformAdmin: true }).where(sql`lower(${schema.users.email}) = ${email}`));
console.log(`Platform admin ${email} created. Sign in at ${env.APP_ORIGIN}/sign-in, then onboard the first business under /admin.`);
process.exit(0);
