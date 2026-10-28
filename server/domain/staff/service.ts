import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { require, type TenantCtx } from "../../auth/ctx";
import type { Db } from "../../db/client";
import { businessMembers, employeeAvailability, employeeServices, employees, services, timeBlocks, users } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { recordAudit } from "../audit/service";
import { DomainError } from "../members/service";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const employeeInput = z.object({
	displayName: z.string().trim().min(1, "Give them a name").max(60),
	bio: z.string().trim().max(300).optional().or(z.literal("")),
	memberId: z.uuid().optional().or(z.literal("")),
});

export const availabilityInput = z.array(
	z
		.object({ weekday: z.coerce.number().int().min(0).max(6), startsAt: hhmm, endsAt: hhmm })
		.refine((r) => r.startsAt < r.endsAt, { message: "End must be after start", path: ["endsAt"] }),
);

export const timeBlockInput = z
	.object({
		employeeId: z.uuid().optional().or(z.literal("")),
		kind: z.enum(["time_off", "break", "blocked"]).default("time_off"),
		startAt: z.coerce.date(),
		endAt: z.coerce.date(),
		reason: z.string().trim().max(120).optional().or(z.literal("")),
	})
	.refine((r) => r.startAt < r.endAt, { message: "End must be after start", path: ["endAt"] });

export async function listEmployees(db: Db, ctx: TenantCtx, opts: { includeInactive?: boolean } = {}) {
	require(ctx, "team.view");
	return withTenant(db, ctx, async (tx) => {
		const where = opts.includeInactive ? eq(employees.businessId, ctx.businessId) : and(eq(employees.businessId, ctx.businessId), eq(employees.active, true));
		const rows = await tx
			.select({
				id: employees.id,
				displayName: employees.displayName,
				bio: employees.bio,
				active: employees.active,
				memberId: employees.memberId,
				memberName: users.name,
			})
			.from(employees)
			.leftJoin(businessMembers, eq(businessMembers.id, employees.memberId))
			.leftJoin(users, eq(users.id, businessMembers.userId))
			.where(where)
			.orderBy(asc(employees.sortOrder), asc(employees.displayName));
		return rows;
	});
}

export async function getEmployee(db: Db, ctx: TenantCtx, id: string) {
	require(ctx, "team.view");
	return withTenant(db, ctx, async (tx) => {
		const [emp] = await tx.select().from(employees).where(and(eq(employees.id, id), eq(employees.businessId, ctx.businessId)));
		if (!emp) return null;
		const availability = await tx
			.select()
			.from(employeeAvailability)
			.where(eq(employeeAvailability.employeeId, id))
			.orderBy(asc(employeeAvailability.weekday), asc(employeeAvailability.startsAt));
		const assigned = await tx.select({ serviceId: employeeServices.serviceId }).from(employeeServices).where(eq(employeeServices.employeeId, id));
		const upcomingBlocks = await tx
			.select()
			.from(timeBlocks)
			.where(and(eq(timeBlocks.employeeId, id), gte(timeBlocks.endAt, new Date())))
			.orderBy(asc(timeBlocks.startAt));
		return { ...emp, availability, serviceIds: assigned.map((a) => a.serviceId), upcomingBlocks };
	});
}

export async function createEmployee(db: Db, ctx: TenantCtx, raw: z.input<typeof employeeInput>) {
	require(ctx, "team.manage");
	const input = employeeInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		if (input.memberId) await assertMember(tx, ctx, input.memberId);
		const [row] = await tx
			.insert(employees)
			.values({ businessId: ctx.businessId, displayName: input.displayName, bio: input.bio || null, memberId: input.memberId || null })
			.returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "employee.create", targetTable: "employees", targetId: row.id, after: { displayName: input.displayName, memberId: input.memberId || null } });
		return row;
	});
}

export async function updateEmployee(db: Db, ctx: TenantCtx, id: string, raw: z.input<typeof employeeInput>) {
	require(ctx, "team.manage");
	const input = employeeInput.parse(raw);
	return withTenant(db, ctx, async (tx) => {
		if (input.memberId) await assertMember(tx, ctx, input.memberId);
		const [row] = await tx
			.update(employees)
			.set({ displayName: input.displayName, bio: input.bio || null, memberId: input.memberId || null, updatedAt: new Date() })
			.where(and(eq(employees.id, id), eq(employees.businessId, ctx.businessId)))
			.returning();
		if (!row) throw new DomainError("employee_not_found");
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "employee.update", targetTable: "employees", targetId: id, after: { displayName: input.displayName, memberId: input.memberId || null } });
		return row;
	});
}

export async function setEmployeeActive(db: Db, ctx: TenantCtx, id: string, active: boolean) {
	require(ctx, "team.manage");
	return withTenant(db, ctx, async (tx) => {
		const [row] = await tx.update(employees).set({ active, updatedAt: new Date() }).where(and(eq(employees.id, id), eq(employees.businessId, ctx.businessId))).returning();
		if (!row) throw new DomainError("employee_not_found");
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: active ? "employee.activate" : "employee.deactivate", targetTable: "employees", targetId: id });
		return row;
	});
}

/** Replace the employee's assigned services. Services must belong to this business. */
export async function setEmployeeServices(db: Db, ctx: TenantCtx, employeeId: string, serviceIds: string[]) {
	require(ctx, "team.manage");
	const ids = z.array(z.uuid()).parse(serviceIds);
	return withTenant(db, ctx, async (tx) => {
		await assertEmployee(tx, ctx, employeeId);
		if (ids.length > 0) {
			const owned = await tx.select({ id: services.id }).from(services).where(and(eq(services.businessId, ctx.businessId), inArray(services.id, ids)));
			if (owned.length !== new Set(ids).size) throw new DomainError("service_not_found");
		}
		await tx.delete(employeeServices).where(eq(employeeServices.employeeId, employeeId));
		if (ids.length > 0) {
			await tx.insert(employeeServices).values([...new Set(ids)].map((serviceId) => ({ businessId: ctx.businessId, employeeId, serviceId })));
		}
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "employee.services.set", targetTable: "employees", targetId: employeeId, after: { serviceIds: ids } });
	});
}

/** Replace the employee's weekly availability. Rows are validated and must not overlap within a weekday. */
export async function setEmployeeAvailability(db: Db, ctx: TenantCtx, employeeId: string, raw: unknown) {
	require(ctx, "team.manage");
	const rows = availabilityInput.parse(raw);
	assertNoOverlap(rows);
	return withTenant(db, ctx, async (tx) => {
		await assertEmployee(tx, ctx, employeeId);
		await tx.delete(employeeAvailability).where(eq(employeeAvailability.employeeId, employeeId));
		if (rows.length > 0) {
			await tx.insert(employeeAvailability).values(rows.map((r) => ({ ...r, businessId: ctx.businessId, employeeId })));
		}
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "employee.availability.set", targetTable: "employees", targetId: employeeId, after: { rows } });
	});
}

export async function createTimeBlock(db: Db, ctx: TenantCtx, raw: z.input<typeof timeBlockInput>) {
	const input = timeBlockInput.parse(raw);
	// Managing your own time off needs appointments.manage_own; anyone else's needs team.manage.
	return withTenant(db, ctx, async (tx) => {
		if (input.employeeId) {
			const emp = await assertEmployee(tx, ctx, input.employeeId);
			const own = await isOwnEmployee(tx, ctx, emp.memberId);
			if (own) require(ctx, "appointments.manage_own");
			else require(ctx, "team.manage");
		} else {
			require(ctx, "settings.edit");
		}
		const [row] = await tx
			.insert(timeBlocks)
			.values({ businessId: ctx.businessId, employeeId: input.employeeId || null, kind: input.kind, startAt: input.startAt, endAt: input.endAt, reason: input.reason || null, createdByUserId: ctx.userId })
			.returning();
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "time_block.create", targetTable: "time_blocks", targetId: row.id, after: { employeeId: input.employeeId || null, kind: input.kind, startAt: input.startAt, endAt: input.endAt } });
		return row;
	});
}

export async function deleteTimeBlock(db: Db, ctx: TenantCtx, id: string) {
	return withTenant(db, ctx, async (tx) => {
		const [block] = await tx.select().from(timeBlocks).where(and(eq(timeBlocks.id, id), eq(timeBlocks.businessId, ctx.businessId)));
		if (!block) throw new DomainError("time_block_not_found");
		if (block.employeeId) {
			const [emp] = await tx.select({ memberId: employees.memberId }).from(employees).where(eq(employees.id, block.employeeId));
			if (emp && (await isOwnEmployee(tx, ctx, emp.memberId))) require(ctx, "appointments.manage_own");
			else require(ctx, "team.manage");
		} else {
			require(ctx, "settings.edit");
		}
		await tx.delete(timeBlocks).where(eq(timeBlocks.id, id));
		await recordAudit(tx, { businessId: ctx.businessId, actorUserId: ctx.userId, action: "time_block.delete", targetTable: "time_blocks", targetId: id, before: { startAt: block.startAt, endAt: block.endAt } });
	});
}

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

async function assertEmployee(tx: Tx, ctx: TenantCtx, employeeId: string) {
	const [emp] = await tx.select({ id: employees.id, memberId: employees.memberId }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.businessId, ctx.businessId)));
	if (!emp) throw new DomainError("employee_not_found");
	return emp;
}

async function assertMember(tx: Tx, ctx: TenantCtx, memberId: string) {
	const [m] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, ctx.businessId)));
	if (!m) throw new DomainError("member_not_found");
}

async function isOwnEmployee(tx: Tx, ctx: TenantCtx, memberId: string | null): Promise<boolean> {
	if (!memberId) return false;
	const [m] = await tx.select({ userId: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.id, memberId));
	return m?.userId === ctx.userId;
}

function assertNoOverlap(rows: z.output<typeof availabilityInput>) {
	const byDay = new Map<number, { s: string; e: string }[]>();
	for (const r of rows) {
		const list = byDay.get(r.weekday) ?? [];
		for (const o of list) if (r.startsAt < o.e && o.s < r.endsAt) throw new DomainError("availability_overlap", "Hours overlap on the same day");
		list.push({ s: r.startsAt, e: r.endsAt });
		byDay.set(r.weekday, list);
	}
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
