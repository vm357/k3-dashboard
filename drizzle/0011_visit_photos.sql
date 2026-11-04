CREATE TABLE "visit_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_photos_appointment_idx" ON "visit_photos" USING btree ("business_id","appointment_id");--> statement-breakpoint
CREATE INDEX "visit_photos_customer_idx" ON "visit_photos" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE POLICY "visit_photos_tenant" ON "visit_photos" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));
