import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantPolicy } from "../rls";
import { businesses } from "./tenants";

/** Set by staff. "New" is not stored: it means no completed visits yet. */
export const clientStatus = pgEnum("client_status", ["active", "vip", "inactive", "do_not_book"]);

/**
 * Customers are per business, by design. The same person at two salons is two rows
 * that never reference each other, so there is no global person table to leak across.
 * Email is stored lower-cased; phone in E.164 when it can be normalised.
 */
export const customers = pgTable(
	"customers",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		firstName: text("first_name").notNull(),
		lastName: text("last_name"),
		email: text("email"),
		phone: text("phone"),
		/** Pinned note, shown as "Preferences" on the profile and the appointment panel. */
		pinnedNote: text("pinned_note"),
		/** Allergies or sensitivities; shown as a red flag everywhere the client appears. */
		allergy: text("allergy"),
		status: clientStatus("status").notNull().default("active"),
		/** Archived clients are hidden from lists, search and booking; history is kept. */
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
		marketingConsent: boolean("marketing_consent").notNull().default(false),
		marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
		stripeCustomerId: text("stripe_customer_id"),
		mergedIntoId: uuid("merged_into_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("customers_business_email_idx").on(t.businessId, t.email).where(sql`${t.email} is not null and ${t.mergedIntoId} is null`),
		index("customers_business_name_idx").on(t.businessId, t.lastName, t.firstName),
		index("customers_business_phone_idx").on(t.businessId, t.phone),
		tenantPolicy("customers"),
	],
).enableRLS();

/** Dated notes on a customer, one per visit or observation. */
export const customerNotes = pgTable(
	"customer_notes",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "cascade" }),
		body: text("body").notNull(),
		authorUserId: uuid("author_user_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("customer_notes_customer_idx").on(t.businessId, t.customerId, t.createdAt), tenantPolicy("customer_notes")],
).enableRLS();
