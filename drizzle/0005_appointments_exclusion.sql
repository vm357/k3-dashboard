-- The guarantee behind "no double bookings": for one employee, two appointments that
-- occupy their time cannot overlap. The insert that loses a race fails with a 23P01
-- exclusion violation; the application catches it and offers fresh times.
-- end_at includes the buffer, so buffers are protected too. Half-open ranges: an
-- appointment ending at 10:00 and one starting at 10:00 do not conflict.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
	EXCLUDE USING gist (
		"employee_id" WITH =,
		tstzrange("start_at", "end_at", '[)') WITH &&
	)
	WHERE ("status" IN ('held', 'confirmed', 'checked_in'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_time_order" CHECK ("start_at" < "service_end_at" AND "service_end_at" <= "end_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "appointments", "appointment_services", "appointment_status_history" TO k3_app;
