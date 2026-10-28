import { sql } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantPolicy } from "../rls";
import { businesses } from "./tenants";

/**
 * The service catalog. Money is integer cents; durations are minutes. A service is
 * never deleted once an appointment references it (phase 3); it is deactivated.
 */

export const depositType = pgEnum("deposit_type", ["none", "fixed", "percent"]);

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const serviceCategories = pgTable(
	"service_categories",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		...timestamps,
	},
	(t) => [index("service_categories_business_idx").on(t.businessId, t.sortOrder), tenantPolicy("service_categories")],
).enableRLS();

export const services = pgTable(
	"services",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		categoryId: uuid("category_id").references(() => serviceCategories.id, { onDelete: "set null" }),
		name: text("name").notNull(),
		description: text("description"),
		durationMinutes: integer("duration_minutes").notNull(),
		bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
		priceCents: integer("price_cents").notNull(),
		depositType: depositType("deposit_type").notNull().default("none"),
		/** Cents for `fixed`, whole percent (0 to 100) for `percent`, ignored for `none`. */
		depositAmount: integer("deposit_amount").notNull().default(0),
		active: boolean("active").notNull().default(true),
		bookableOnline: boolean("bookable_online").notNull().default(true),
		sortOrder: integer("sort_order").notNull().default(0),
		...timestamps,
	},
	(t) => [index("services_business_idx").on(t.businessId, t.active, t.sortOrder), tenantPolicy("services")],
).enableRLS();
