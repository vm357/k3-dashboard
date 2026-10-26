import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: "./server/db/schema/index.ts",
	out: "./drizzle",
	// Roles and policies are part of the schema, so the k3_app role is created by migrations.
	entities: { roles: true },
	dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/unused" },
	strict: true,
	verbose: true,
});
