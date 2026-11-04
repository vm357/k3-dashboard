import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantPolicy } from "../rls";
import { appointments } from "./appointments";
import { customers } from "./customers";
import { businesses } from "./tenants";

/** Nail photos on a visit. The image lives in R2 under `r2Key`; this row is the index and the access check. */
export const visitPhotos = pgTable(
	"visit_photos",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		businessId: uuid("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id")
			.notNull()
			.references(() => customers.id, { onDelete: "cascade" }),
		appointmentId: uuid("appointment_id")
			.notNull()
			.references(() => appointments.id, { onDelete: "cascade" }),
		r2Key: text("r2_key").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		createdByUserId: uuid("created_by_user_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("visit_photos_appointment_idx").on(t.businessId, t.appointmentId), index("visit_photos_customer_idx").on(t.businessId, t.customerId), tenantPolicy("visit_photos")],
).enableRLS();
