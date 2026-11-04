ALTER TABLE "appointments" ADD COLUMN "series_id" uuid;--> statement-breakpoint
CREATE INDEX "appointments_series_idx" ON "appointments" USING btree ("business_id","series_id");
