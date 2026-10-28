CREATE TYPE "public"."deposit_type" AS ENUM('none', 'fixed', 'percent');--> statement-breakpoint
CREATE TYPE "public"."time_block_kind" AS ENUM('time_off', 'break', 'blocked');--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"price_cents" integer NOT NULL,
	"deposit_type" "deposit_type" DEFAULT 'none' NOT NULL,
	"deposit_amount" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"bookable_online" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"opens_at" text NOT NULL,
	"closes_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_cents_override" integer,
	"duration_minutes_override" integer
);
--> statement-breakpoint
ALTER TABLE "employee_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"member_id" uuid,
	"display_name" text NOT NULL,
	"bio" text,
	"photo_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid,
	"kind" time_block_kind DEFAULT 'blocked' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text,
	"phone" text,
	"pinned_note" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"marketing_consent_at" timestamp with time zone,
	"stripe_customer_id" text,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability" ADD CONSTRAINT "employee_availability_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_availability" ADD CONSTRAINT "employee_availability_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_member_id_business_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."business_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_categories_business_idx" ON "service_categories" USING btree ("business_id","sort_order");--> statement-breakpoint
CREATE INDEX "services_business_idx" ON "services" USING btree ("business_id","active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "business_hours_day_idx" ON "business_hours" USING btree ("business_id","weekday");--> statement-breakpoint
CREATE INDEX "employee_availability_idx" ON "employee_availability" USING btree ("business_id","employee_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_services_pair_idx" ON "employee_services" USING btree ("employee_id","service_id");--> statement-breakpoint
CREATE INDEX "employee_services_business_idx" ON "employee_services" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "employees_business_idx" ON "employees" USING btree ("business_id","active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_member_idx" ON "employees" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "time_blocks_range_idx" ON "time_blocks" USING btree ("business_id","employee_id","start_at");--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("business_id","customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_business_email_idx" ON "customers" USING btree ("business_id","email") WHERE "customers"."email" is not null and "customers"."merged_into_id" is null;--> statement-breakpoint
CREATE INDEX "customers_business_name_idx" ON "customers" USING btree ("business_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "customers_business_phone_idx" ON "customers" USING btree ("business_id","phone");--> statement-breakpoint
CREATE POLICY "service_categories_tenant" ON "service_categories" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "services_tenant" ON "services" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "business_hours_tenant" ON "business_hours" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "employee_availability_tenant" ON "employee_availability" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "employee_services_tenant" ON "employee_services" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "employees_tenant" ON "employees" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "time_blocks_tenant" ON "time_blocks" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "customer_notes_tenant" ON "customer_notes" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "customers_tenant" ON "customers" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));