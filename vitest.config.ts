import { defineConfig } from "vitest/config";

/**
 * Unit, integration and security tests run against PGlite (Postgres in WebAssembly)
 * with the real migrations applied and the real k3_app role active, so RLS behaves
 * exactly as in production. CI additionally runs the same suite against a real Postgres.
 *
 * Worker-runtime (HTTP-level) tests use @cloudflare/vitest-pool-workers in a later session.
 */
export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts", "server/**/*.test.ts"],
		environment: "node",
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
});
