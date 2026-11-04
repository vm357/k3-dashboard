import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantPolicy } from "../rls";
import { appointments } from "./appointments";
import { customers } from "./customers";
import { businesses } from "./tenants";

/**
 * Money recorded by hand at checkout until Stripe (phase 5): cash, card on the salon's own
 * machine, or client credit. One row per method used; tips sit on the cash/card row.
 */
export const paymentMethod = pgEnum("payment_method", ["cash", "card", "credit"]);

export const payments = pgTable(
	"payments",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		appointmentId: uuid("appointment_id")
			.notNull()
			.references(() => appointments.id, { onDelete: "restrict" }),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "restrict" }),
		method: paymentMethod("method").notNull(),
		amountCents: integer("amount_cents").notNull(),
		tipCents: integer("tip_cents").notNull().default(0),
		recordedByUserId: uuid("recorded_by_user_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("payments_business_day_idx").on(t.businessId, t.createdAt), index("payments_appointment_idx").on(t.businessId, t.appointmentId), tenantPolicy("payments")],
).enableRLS();

/** Client credit as a ledger: + for credit added, - for credit used or removed. Balance = sum. */
export const customerCreditEntries = pgTable(
	"customer_credit_entries",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "cascade" }),
		amountCents: integer("amount_cents").notNull(),
		reason: text("reason"),
		appointmentId: uuid("appointment_id"),
		createdByUserId: uuid("created_by_user_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("customer_credit_customer_idx").on(t.businessId, t.customerId, t.createdAt), tenantPolicy("customer_credit_entries")],
).enableRLS();
