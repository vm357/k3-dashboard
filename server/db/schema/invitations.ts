import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantPolicy } from "../rls";
import { users } from "./platform";
import { businesses, memberRole } from "./tenants";

/**
 * An invitation is a single-use, 7-day token that turns an email address into a
 * membership. Only the token's SHA-256 is stored; the raw token lives in the link.
 * The accept route runs under bypass because the invitee has no membership yet.
 */
export const invitations = pgTable(
	"invitations",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		role: memberRole("role").notNull().default("employee"),
		permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
		tokenHash: text("token_hash").notNull(),
		invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		acceptedAt: timestamp("accepted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("invitations_token_hash_idx").on(t.tokenHash),
		index("invitations_business_idx").on(t.businessId, t.email),
		tenantPolicy("invitations"),
	],
).enableRLS();
