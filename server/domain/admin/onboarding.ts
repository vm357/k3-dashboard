import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AdminCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { businesses, invitations, users } from "../../db/schema";
import { withBypass } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { createBusinessSchema } from "../businesses/schema";
import { createBusiness } from "../businesses/service";

export const onboardSchema = createBusinessSchema.extend({
	ownerEmail: z.email().transform((e) => e.toLowerCase()),
});

/**
 * Admin onboarding: create the business and either attach an existing user as owner or
 * leave an owner invitation for a new one. Returns the invitation token (once) when the
 * owner does not have an account yet, so the admin can send them the link.
 */
export async function onboardBusiness(db: Db, ctx: AdminCtx, raw: z.input<typeof onboardSchema>) {
	if (ctx.isPlatformAdmin !== true) throw new Error("forbidden");
	const input = onboardSchema.parse(raw);

	const existing = await withBypass(db, ctx.userId, (tx) =>
		tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.ownerEmail}`),
	);

	if (existing[0]) {
		const business = await createBusiness(db, ctx, existing[0].id, input);
		return { business, inviteToken: null as string | null };
	}

	// No account yet: create the business with no member, and an owner invitation under bypass.
	const token = randomHex(32);
	const tokenHash = await sha256Hex(token);
	const business = await withBypass(db, ctx.userId, async (tx) => {
		const [biz] = await tx.insert(businesses).values({ name: input.name, slug: input.slug, timeZone: input.timeZone }).returning();
		await tx.insert(invitations).values({
			businessId: biz.id,
			email: input.ownerEmail,
			role: "owner",
			permissions: [],
			tokenHash,
			invitedByUserId: ctx.userId,
			expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		});
		await recordAudit(tx, {
			businessId: biz.id,
			actorUserId: ctx.userId,
			action: "business.create",
			targetTable: "businesses",
			targetId: biz.id,
			after: { name: input.name, slug: input.slug, ownerEmail: input.ownerEmail, ownerPending: true },
		});
		return biz;
	});
	return { business, inviteToken: token };
}

export async function slugAvailable(db: Db, slug: string): Promise<boolean> {
	const rows = await withBypass(db, null, (tx) => tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)));
	return rows.length === 0;
}

function randomHex(bytes: number): string {
	const arr = new Uint8Array(bytes);
	crypto.getRandomValues(arr);
	return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
