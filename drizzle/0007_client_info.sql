CREATE TYPE "public"."client_status" AS ENUM('active', 'vip', 'inactive', 'do_not_book');--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "allergy" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "status" "client_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "archived_at" timestamp with time zone;
