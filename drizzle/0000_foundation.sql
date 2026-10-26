CREATE TYPE "public"."business_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'employee');--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'k3_app') THEN
		CREATE ROLE "k3_app";
	END IF;
END $$;--> statement-breakpoint
-- Membership check used by every tenant policy. SECURITY DEFINER so it reads
-- business_members without RLS; owned by the migration role, callable by k3_app.
CREATE FUNCTION app_is_member() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
	RETURN EXISTS (
		SELECT 1 FROM business_members m
		WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
		  AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
	);
END $$;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_table" text,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "plan_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"stripe_product_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_feature_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_feature_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"time_zone" text DEFAULT 'America/New_York' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "business_status" DEFAULT 'active' NOT NULL,
	"custom_domain" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booking_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_feature_overrides" ADD CONSTRAINT "business_feature_overrides_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_business_idx" ON "audit_log" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_features_plan_key_idx" ON "plan_features" USING btree ("plan_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "business_feature_overrides_key_idx" ON "business_feature_overrides" USING btree ("business_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_user_business_idx" ON "business_members" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "business_members_business_idx" ON "business_members" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_slug_idx" ON "businesses" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_custom_domain_idx" ON "businesses" USING btree ("custom_domain");--> statement-breakpoint
CREATE POLICY "business_feature_overrides_tenant" ON "business_feature_overrides" AS PERMISSIVE FOR ALL TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "business_members_select" ON "business_members" AS PERMISSIVE FOR SELECT TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or "business_members"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "business_members_insert" ON "business_members" AS PERMISSIVE FOR INSERT TO "k3_app" WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "business_members_update" ON "business_members" AS PERMISSIVE FOR UPDATE TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "business_members_delete" ON "business_members" AS PERMISSIVE FOR DELETE TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "businesses_member" ON "businesses" AS PERMISSIVE FOR SELECT TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()) or exists (
				select 1 from business_members m
				where m.business_id = "businesses"."id" and m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
			)));--> statement-breakpoint
CREATE POLICY "businesses_write" ON "businesses" AS PERMISSIVE FOR UPDATE TO "k3_app" USING ((current_setting('app.bypass_rls', true) = 'on' or (id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member()))) WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' or (id = nullif(current_setting('app.business_id', true), '')::uuid and app_is_member())));--> statement-breakpoint
CREATE POLICY "businesses_insert" ON "businesses" AS PERMISSIVE FOR INSERT TO "k3_app" WITH CHECK (current_setting('app.bypass_rls', true) = 'on');--> statement-breakpoint
CREATE POLICY "businesses_delete" ON "businesses" AS PERMISSIVE FOR DELETE TO "k3_app" USING (current_setting('app.bypass_rls', true) = 'on');