CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'credit');--> statement-breakpoint
CREATE TABLE "customer_credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"appointment_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_credit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_credit_entries" ADD CONSTRAINT "customer_credit_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_credit_customer_idx" ON "customer_credit_entries" USING btree ("business_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_business_day_idx" ON "payments" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_appointment_idx" ON "payments" USING btree ("business_id","appointment_id");--> statement-breakpoint
CREATE POLICY "customer_credit_entries_tenant" ON "customer_credit_entries" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "payments_tenant" ON "payments" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));
