import { sql } from "drizzle-orm";
import {
	index,
	jsonb,
	pgEnum,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { appRole, bypassOn, currentBusinessId, currentUserId, tenantPolicy } from "../rls";
import { plans, users } from "./platform";

/**
 * Tenant core. Every later tenant table (services, appointments, customers...)
 * follows the same pattern: a business_id column, an index leading with it, and
 * tenantPolicy(). These two tables are the exceptions whose policies also admit
 * a user looking up their own memberships, which is how a request learns which
 * business it may act on before app.business_id is set.
 */

export const businessStatus = pgEnum("business_status", ["active", "suspended"]);
export const memberRole = pgEnum("member_role", ["owner", "employee"]);

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const businessMatch = sql`(id = ${currentBusinessId} and app_is_member())`;
const memberMatch = sql`(business_id = ${currentBusinessId} and app_is_member())`;

export const businesses = pgTable(
	"businesses",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		timeZone: text("time_zone").notNull().default("America/New_York"),
		currency: text("currency").notNull().default("usd"),
		status: businessStatus("status").notNull().default("active"),
		customDomain: text("custom_domain"),
		branding: jsonb("branding").notNull().default({}),
		bookingPolicy: jsonb("booking_policy").notNull().default({}),
		planId: uuid("plan_id").references(() => plans.id),
		...timestamps,
	},
	(t) => [
		uniqueIndex("businesses_slug_idx").on(t.slug),
		uniqueIndex("businesses_custom_domain_idx").on(t.customDomain),
		// A user sees the businesses they belong to, which is how slugs resolve to a ctx.
		pgPolicy("businesses_member", {
			for: "select",
			to: appRole,
			using: sql`(${bypassOn} or ${businessMatch} or exists (
				select 1 from business_members m
				where m.business_id = ${t.id} and m.user_id = ${currentUserId}
			))`,
		}),
		pgPolicy("businesses_write", {
			for: "update",
			to: appRole,
			using: sql`(${bypassOn} or ${businessMatch})`,
			withCheck: sql`(${bypassOn} or ${businessMatch})`,
		}),
		// Inserting a business is a platform action or self-serve signup; both run under bypass
		// inside businesses/service.ts, which writes the owner membership in the same transaction.
		pgPolicy("businesses_insert", { for: "insert", to: appRole, withCheck: bypassOn }),
		pgPolicy("businesses_delete", { for: "delete", to: appRole, using: bypassOn }),
	],
).enableRLS();

export const businessMembers = pgTable(
	"business_members",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: memberRole("role").notNull(),
		/** Permission keys (server/auth/permissions.ts). Owners have every key implicitly. */
		permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
		...timestamps,
	},
	(t) => [
		uniqueIndex("business_members_user_business_idx").on(t.userId, t.businessId),
		index("business_members_business_idx").on(t.businessId),
		pgPolicy("business_members_select", {
			for: "select",
			to: appRole,
			using: sql`(${bypassOn} or ${t.userId} = ${currentUserId} or ${memberMatch})`,
		}),
		pgPolicy("business_members_insert", { for: "insert", to: appRole, withCheck: sql`(${bypassOn} or ${memberMatch})` }),
		pgPolicy("business_members_update", {
			for: "update",
			to: appRole,
			using: sql`(${bypassOn} or ${memberMatch})`,
			withCheck: sql`(${bypassOn} or ${memberMatch})`,
		}),
		pgPolicy("business_members_delete", { for: "delete", to: appRole, using: sql`(${bypassOn} or ${memberMatch})` }),
	],
).enableRLS();

/** Per-business exceptions to plan features. Kermit admin only. */
export const businessFeatureOverrides = pgTable(
	"business_feature_overrides",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		featureKey: text("feature_key").notNull(),
		value: jsonb("value").notNull(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("business_feature_overrides_key_idx").on(t.businessId, t.featureKey),
		tenantPolicy("business_feature_overrides"),
	],
).enableRLS();
