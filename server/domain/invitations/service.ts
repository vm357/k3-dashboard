import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { require, requireOwner, type TenantCtx } from "../../auth/ctx";
import { DEFAULT_EMPLOYEE_PERMISSIONS, PERMISSION_KEYS } from "../../auth/permissions";
import type { Db } from "../../db/client";
import { businessMembers, businesses, invitations, users } from "../../db/schema";
import { withBypass, withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { DomainError } from "../members/service";

export const inviteSchema = z.object({
	email: z.email().transform((e) => e.toLowerCase()),
	role: z.enum(["owner", "employee"]).default("employee"),
	permissions: z.array(z.enum(PERMISSION_KEYS)).optional(),
});

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create an invitation. Returns the raw token exactly once; it is never stored.
 * Sending the email is phase 6; until then the owner copies the link from the team page.
 */
export async function createInvitation(db: Db, ctx: TenantCtx, raw: z.input<typeof inviteSchema>) {
	require(ctx, "team.manage");
	const input = inviteSchema.parse(raw);
	if (input.role === "owner") requireOwner(ctx);
	const token = newToken();
	const tokenHash = await sha256Hex(token);
	const permissions = input.role === "owner" ? [] : (input.permissions ?? DEFAULT_EMPLOYEE_PERMISSIONS);

	const invitation = await withTenant(db, ctx, async (tx) => {
		// One live invitation per email per business: replace any unaccepted one.
		await tx
			.delete(invitations)
			.where(and(eq(invitations.businessId, ctx.businessId), eq(invitations.email, input.email), isNull(invitations.acceptedAt)));
		const [row] = await tx
			.insert(invitations)
			.values({
				businessId: ctx.businessId,
				email: input.email,
				role: input.role,
				permissions,
				tokenHash,
				invitedByUserId: ctx.userId,
				expiresAt: new Date(Date.now() + INVITE_TTL_MS),
			})
			.returning();
		await recordAudit(tx, {
			businessId: ctx.businessId,
			actorUserId: ctx.userId,
			action: "invitation.create",
			targetTable: "invitations",
			targetId: row.id,
			after: { email: input.email, role: input.role, permissions },
		});
		return row;
	});
	return { invitation, token };
}

export async function listPendingInvitations(db: Db, ctx: TenantCtx) {
	require(ctx, "team.view");
	return withTenant(db, ctx, (tx) =>
		tx
			.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
			.from(invitations)
			.where(and(eq(invitations.businessId, ctx.businessId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))),
	);
}

export async function revokeInvitation(db: Db, ctx: TenantCtx, invitationId: string) {
	require(ctx, "team.manage");
	return withTenant(db, ctx, async (tx) => {
		const deleted = await tx
			.delete(invitations)
			.where(and(eq(invitations.id, invitationId), eq(invitations.businessId, ctx.businessId), isNull(invitations.acceptedAt)))
			.returning({ id: invitations.id, email: invitations.email });
		if (deleted[0]) {
			await recordAudit(tx, {
				businessId: ctx.businessId,
				actorUserId: ctx.userId,
				action: "invitation.revoke",
				targetTable: "invitations",
				targetId: invitationId,
				before: { email: deleted[0].email },
			});
		}
	});
}

/** What the accept page shows before the invitee commits: business name and the email it was sent to. */
export async function previewInvitation(db: Db, token: string) {
	const tokenHash = await sha256Hex(token);
	return withBypass(db, null, async (tx) => {
		const [row] = await tx
			.select({
				id: invitations.id,
				email: invitations.email,
				role: invitations.role,
				businessName: businesses.name,
				expiresAt: invitations.expiresAt,
				acceptedAt: invitations.acceptedAt,
			})
			.from(invitations)
			.innerJoin(businesses, eq(businesses.id, invitations.businessId))
			.where(eq(invitations.tokenHash, tokenHash));
		if (!row || row.acceptedAt || row.expiresAt < new Date()) return null;
		return { id: row.id, email: row.email, role: row.role, businessName: row.businessName };
	});
}

/**
 * Bind an invitation to a user. The user must already exist (the accept route creates it
 * through Better Auth first, with the invitation's email, so the address is verified by
 * possession of the link). Runs under bypass: this is the sanctioned third caller, and it
 * writes an audit row like the others.
 */
export async function acceptInvitation(db: Db, token: string, userId: string) {
	const tokenHash = await sha256Hex(token);
	return withBypass(db, userId, async (tx) => {
		const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash));
		if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new DomainError("invitation_invalid");
		const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
		if (!user || user.email.toLowerCase() !== inv.email) throw new DomainError("invitation_email_mismatch");

		const existing = await tx
			.select({ id: businessMembers.id })
			.from(businessMembers)
			.where(and(eq(businessMembers.businessId, inv.businessId), eq(businessMembers.userId, userId)));
		if (!existing[0]) {
			await tx.insert(businessMembers).values({
				businessId: inv.businessId,
				userId,
				role: inv.role,
				permissions: inv.permissions,
			});
		}
		await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
		await recordAudit(tx, {
			businessId: inv.businessId,
			actorUserId: userId,
			action: "invitation.accept",
			targetTable: "invitations",
			targetId: inv.id,
			after: { role: inv.role },
		});
		const [biz] = await tx.select({ slug: businesses.slug }).from(businesses).where(eq(businesses.id, inv.businessId));
		return { businessSlug: biz.slug };
	});
}
