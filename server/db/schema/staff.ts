import { sql } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantPolicy } from "../rls";
import { services } from "./catalog";
import { businessMembers, businesses } from "./tenants";

/**
 * Staff who can be booked. An employee may exist before anyone logs in as them
 * (memberId null) and a member may exist without a calendar (no employee row).
 *
 * Local times are stored as "HH:MM" strings with a weekday, because "open 9 to 5 on
 * Tuesdays" must survive daylight-saving changes; the availability engine (phase 3)
 * converts them to UTC instants per date using the business's time zone.
 */

export const timeBlockKind = pgEnum("time_block_kind", ["time_off", "break", "blocked"]);

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const employees = pgTable(
	"employees",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		memberId: uuid("member_id").references(() => businessMembers.id, { onDelete: "set null" }),
		displayName: text("display_name").notNull(),
		bio: text("bio"),
		photoUrl: text("photo_url"),
		active: boolean("active").notNull().default(true),
		sortOrder: integer("sort_order").notNull().default(0),
		...timestamps,
	},
	(t) => [
		index("employees_business_idx").on(t.businessId, t.active, t.sortOrder),
		uniqueIndex("employees_member_idx").on(t.memberId),
		tenantPolicy("employees"),
	],
).enableRLS();

export const employeeServices = pgTable(
	"employee_services",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employees.id, { onDelete: "cascade" }),
		serviceId: uuid("service_id")
			.notNull()
			.references(() => services.id, { onDelete: "cascade" }),
		priceCentsOverride: integer("price_cents_override"),
		durationMinutesOverride: integer("duration_minutes_override"),
	},
	(t) => [uniqueIndex("employee_services_pair_idx").on(t.employeeId, t.serviceId), index("employee_services_business_idx").on(t.businessId), tenantPolicy("employee_services")],
).enableRLS();

/** Business opening hours, one row per weekday (0 = Sunday). Missing weekday = closed. */
export const businessHours = pgTable(
	"business_hours",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		weekday: integer("weekday").notNull(),
		opensAt: text("opens_at").notNull(),
		closesAt: text("closes_at").notNull(),
	},
	(t) => [uniqueIndex("business_hours_day_idx").on(t.businessId, t.weekday), tenantPolicy("business_hours")],
).enableRLS();

/** Recurring weekly availability per employee. Several rows per weekday allow split shifts. */
export const employeeAvailability = pgTable(
	"employee_availability",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employees.id, { onDelete: "cascade" }),
		weekday: integer("weekday").notNull(),
		startsAt: text("starts_at").notNull(),
		endsAt: text("ends_at").notNull(),
	},
	(t) => [index("employee_availability_idx").on(t.businessId, t.employeeId, t.weekday), tenantPolicy("employee_availability")],
).enableRLS();

/** One-off blocks: time off, breaks, anything that removes availability. employeeId null = whole business. */
export const timeBlocks = pgTable(
	"time_blocks",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
		kind: timeBlockKind("kind").notNull().default("blocked"),
		startAt: timestamp("start_at", { withTimezone: true }).notNull(),
		endAt: timestamp("end_at", { withTimezone: true }).notNull(),
		reason: text("reason"),
		createdByUserId: uuid("created_by_user_id"),
		...timestamps,
	},
	(t) => [index("time_blocks_range_idx").on(t.businessId, t.employeeId, t.startAt), tenantPolicy("time_blocks")],
).enableRLS();
