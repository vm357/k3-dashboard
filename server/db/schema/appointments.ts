import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantPolicy } from "../rls";
import { services } from "./catalog";
import { customers } from "./customers";
import { employees } from "./staff";
import { businesses } from "./tenants";

/**
 * Appointments. Two independent axes on the row: `status` (where the visit is in its
 * life) and `paymentStatus` (what has been paid). Completing a visit never changes
 * payment state and a deposit never changes status (plan, booking section).
 *
 * The exclusion constraint that prevents double booking is added in the migration
 * (Drizzle cannot express EXCLUDE): for one employee, two live rows cannot overlap.
 * `endAt` already includes the buffer so the constraint sees it.
 */
export const appointmentStatus = pgEnum("appointment_status", [
	"held",
	"confirmed",
	"checked_in",
	"completed",
	"cancelled",
	"no_show",
	"rescheduled",
	"expired",
]);

export const paymentStatus = pgEnum("payment_status", ["unpaid", "deposit_paid", "paid_in_full", "partially_refunded", "refunded"]);

export const appointmentSource = pgEnum("appointment_source", ["manual", "online"]);

/** Statuses that occupy the employee's time. Mirrored in the migration's constraint. */
export const LIVE_STATUSES = ["held", "confirmed", "checked_in"] as const;

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const appointments = pgTable(
	"appointments",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "restrict" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employees.id, { onDelete: "restrict" }),
		startAt: timestamp("start_at", { withTimezone: true }).notNull(),
		/** End of the last service plus its buffer. */
		endAt: timestamp("end_at", { withTimezone: true }).notNull(),
		/** End of service as the client experiences it, before buffer. */
		serviceEndAt: timestamp("service_end_at", { withTimezone: true }).notNull(),
		status: appointmentStatus("status").notNull().default("confirmed"),
		paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
		source: appointmentSource("source").notNull().default("manual"),
		priceCents: integer("price_cents").notNull().default(0),
		depositDueCents: integer("deposit_due_cents").notNull().default(0),
		paidCents: integer("paid_cents").notNull().default(0),
		refundedCents: integer("refunded_cents").notNull().default(0),
		note: text("note"),
		policyAcknowledgment: jsonb("policy_acknowledgment"),
		holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
		rescheduledFromId: uuid("rescheduled_from_id"),
		createdByUserId: uuid("created_by_user_id"),
		...timestamps,
	},
	(t) => [
		index("appointments_business_day_idx").on(t.businessId, t.startAt),
		index("appointments_employee_day_idx").on(t.businessId, t.employeeId, t.startAt),
		index("appointments_customer_idx").on(t.businessId, t.customerId, t.startAt),
		tenantPolicy("appointments"),
	],
).enableRLS();

/** One row per service on the appointment, with price and duration frozen at booking time. */
export const appointmentServices = pgTable(
	"appointment_services",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		appointmentId: uuid("appointment_id")
			.notNull()
			.references(() => appointments.id, { onDelete: "cascade" }),
		serviceId: uuid("service_id")
			.notNull()
			.references(() => services.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		durationMinutes: integer("duration_minutes").notNull(),
		priceCents: integer("price_cents").notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(t) => [index("appointment_services_appt_idx").on(t.businessId, t.appointmentId), tenantPolicy("appointment_services")],
).enableRLS();

export const appointmentStatusHistory = pgTable(
	"appointment_status_history",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		appointmentId: uuid("appointment_id")
			.notNull()
			.references(() => appointments.id, { onDelete: "cascade" }),
		fromStatus: appointmentStatus("from_status"),
		toStatus: appointmentStatus("to_status").notNull(),
		actorUserId: uuid("actor_user_id"),
		reason: text("reason"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("appointment_status_history_idx").on(t.businessId, t.appointmentId, t.createdAt), tenantPolicy("appointment_status_history")],
).enableRLS();
