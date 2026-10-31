import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

/**
 * Platform tables: owned by no business. Users are login identities only; what a
 * user may do inside a business lives in business_members (tenants.ts).
 *
 * users, sessions, accounts and verifications follow Better Auth's model so its
 * Drizzle adapter can use them directly (usePlural: true).
 */

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
	"users",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		name: text("name").notNull(),
		email: text("email").notNull(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
		...timestamps,
	},
	(t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
	"sessions",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		token: text("token").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		...timestamps,
	},
	(t) => [uniqueIndex("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
	"accounts",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
		scope: text("scope"),
		password: text("password"),
		...timestamps,
	},
	(t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
	"verifications",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		...timestamps,
	},
	(t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/**
 * Better Auth's rate-limit counters, stored in the database because a Worker isolate's
 * memory is neither shared nor durable. Keyed by client IP + path; rows are overwritten
 * in place, so the table stays small.
 */
export const rateLimits = pgTable("rate_limits", {
	id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
	key: text("key").notNull().unique(),
	count: integer("count").notNull(),
	lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** A plan is a row mirrored from a Stripe Product; prices live in Stripe. */
export const plans = pgTable("plans", {
	id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
	key: text("key").notNull().unique(),
	name: text("name").notNull(),
	stripeProductId: text("stripe_product_id"),
	active: boolean("active").notNull().default(true),
	...timestamps,
});

/** One row per feature per plan. Booleans and limits both live in `value`. */
export const planFeatures = pgTable(
	"plan_features",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		planId: uuid("plan_id")
			.notNull()
			.references(() => plans.id, { onDelete: "cascade" }),
		featureKey: text("feature_key").notNull(),
		value: jsonb("value").notNull(),
	},
	(t) => [uniqueIndex("plan_features_plan_key_idx").on(t.planId, t.featureKey)],
);

/**
 * Append-only record of who did what. business_id is null for platform-admin
 * actions. Written by domain services, never by the browser.
 */
export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id"),
		actorUserId: uuid("actor_user_id"),
		action: text("action").notNull(),
		targetTable: text("target_table"),
		targetId: uuid("target_id"),
		before: jsonb("before"),
		after: jsonb("after"),
		ipAddress: text("ip_address"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		seq: integer("seq").generatedAlwaysAsIdentity(),
	},
	(t) => [index("audit_log_business_idx").on(t.businessId, t.createdAt)],
);
