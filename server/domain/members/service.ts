import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { require, requireOwner, type TenantCtx } from "../../auth/ctx";
import { DEFAULT_EMPLOYEE_PERMISSIONS, PERMISSION_KEYS } from "../../auth/permissions";
import type { Db } from "../../db/client";
import { businessMembers, users } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";

export const permissionListSchema = z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length);

export const addMemberSchema = z.object({
	userId: z.uuid(),
	role: z.enum(["owner", "employee"]),
	permissions: permissionListSchema.optional(),
});

export class DomainError extends Error {
	constructor(public readonly code: string, message?: string) {
		super(message ?? code);
	}
}

export async function listMembers(db: Db, ctx: TenantCtx) {
	require(ctx, "team.view");
	return withTenant(db, ctx, (tx) =>
		tx
			.select({
				id: businessMembers.id,
				userId: businessMembers.userId,
				role: businessMembers.role,
				permissions: businessMembers.permissions,
				name: users.name,
				email: users.email,
			})
			.from(businessMembers)
			.innerJoin(users, eq(users.id, businessMembers.userId))
			.where(eq(businessMembers.businessId, ctx.businessId)),
	);
}

/**
 * Add an existing user to the business. Invitation by email (creating the user on
 * acceptance) wraps this in a later session; the membership write is the same.
 */
export async function addMember(db: Db, ctx: TenantCtx, raw: z.input<typeof addMemberSchema>) {
	require(ctx, "team.manage");
	const input = addMemberSchema.parse(raw);
	if (input.role === "owner") requireOwner(ctx);
	const permissions = input.role === "owner" ? [] : (input.permissions ?? DEFAULT_EMPLOYEE_PERMISSIONS);
	return withTenant(db, ctx, async (tx) => {
		const [member] = await tx
			.insert(businessMembers)
			.values({ businessId: ctx.businessId, userId: input.userId, role: input.role, permissions })
			.returning();
		await recordAudit(tx, {
			businessId: ctx.businessId,
			actorUserId: ctx.userId,
			action: "member.add",
			targetTable: "business_members",
			targetId: member.id,
			after: { userId: input.userId, role: input.role, permissions },
		});
		return member;
	});
}

export async function setMemberPermissions(db: Db, ctx: TenantCtx, memberId: string, raw: unknown) {
	require(ctx, "team.manage");
	const permissions = permissionListSchema.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		const [before] = await tx
			.select()
			.from(businessMembers)
			.where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, ctx.businessId)));
		if (!before) throw new DomainError("member_not_found");
		if (before.role === "owner") throw new DomainError("owner_permissions_fixed", "owners hold every permission");
		const [after] = await tx
			.update(businessMembers)
			.set({ permissions, updatedAt: new Date() })
			.where(eq(businessMembers.id, memberId))
			.returning();
		await recordAudit(tx, {
			businessId: ctx.businessId,
			actorUserId: ctx.userId,
			action: "member.permissions.update",
			targetTable: "business_members",
			targetId: memberId,
			before: { permissions: before.permissions },
			after: { permissions },
		});
		return after;
	});
}

export async function removeMember(db: Db, ctx: TenantCtx, memberId: string) {
	require(ctx, "team.manage");
	return withTenant(db, ctx, async (tx) => {
		const [target] = await tx
			.select()
			.from(businessMembers)
			.where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, ctx.businessId)));
		if (!target) throw new DomainError("member_not_found");
		if (target.role === "owner") {
			requireOwner(ctx);
			const owners = await tx
				.select({ id: businessMembers.id })
				.from(businessMembers)
				.where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.role, "owner")));
			if (owners.length <= 1) throw new DomainError("last_owner", "a business must keep at least one owner");
		}
		await tx.delete(businessMembers).where(eq(businessMembers.id, memberId));
		await recordAudit(tx, {
			businessId: ctx.businessId,
			actorUserId: ctx.userId,
			action: "member.remove",
			targetTable: "business_members",
			targetId: memberId,
			before: { userId: target.userId, role: target.role },
		});
	});
}
