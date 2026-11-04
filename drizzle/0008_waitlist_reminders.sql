CREATE TYPE "public"."reminder_status" AS ENUM('not_sent', 'sent', 'confirmed', 'declined');--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"employee_id" uuid,
	"preferred_date" date,
	"note" text,
	"booked_appointment_id" uuid,
	"removed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_status" "reminder_status" DEFAULT 'not_sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_entries_business_idx" ON "waitlist_entries" USING btree ("business_id","preferred_date");--> statement-breakpoint
CREATE POLICY "waitlist_entries_tenant" ON "waitlist_entries" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));
