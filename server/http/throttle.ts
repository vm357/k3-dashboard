import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/**
 * Fixed-window counter in `rate_limits`, for flows that call Better Auth through
 * `auth.api` (server-side calls skip Better Auth's own limiter). Keys are prefixed
 * `k3:` so they never collide with Better Auth's rows. Returns false when over the limit.
 */
export async function hit(db: Db, key: string, windowSeconds: number, max: number): Promise<boolean> {
	const now = Date.now();
	const windowStart = now - windowSeconds * 1000;
	const rows = await db.execute<{ count: number }>(sql`
		insert into rate_limits (key, count, last_request) values (${`k3:${key}`}, 1, ${now})
		on conflict (key) do update set
			count = case when rate_limits.last_request < ${windowStart} then 1 else rate_limits.count + 1 end,
			last_request = case when rate_limits.last_request < ${windowStart} then ${now} else rate_limits.last_request end
		returning count`);
	const count = Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 1);
	return count <= max;
}

export function clientIp(request: Request): string {
	return request.headers.get("cf-connecting-ip") ?? "local";
}
