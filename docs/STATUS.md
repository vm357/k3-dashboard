# Status

Updated in the same commit as the code it describes. "Done" means implemented and covered by
tests that ran green in CI; the run link goes beside the entry.

## Phase 1: Foundation — in progress

Done (tests: `npm test`, 20 passing locally against PGlite on 2026-10-26; CI not yet run):

- Project scaffold: React Router 8 on Cloudflare Workers, Hono for `/api` and `/webhooks`, Zod-validated env
- Drizzle schema for users, sessions, accounts, verifications, plans, plan_features, audit_log,
  businesses, business_members, business_feature_overrides; migrations `0000_foundation`, `0001_grants`
- Row-level security: `k3_app` role, policies on every tenant table, `app_is_member()` membership check,
  transaction-local session settings (`withTenant`, `withUser`, `withBypass`)
- Permission keys (closed union), `resolveTenantCtx`, `can`/`require`/`requireOwner`
- Domain services: businesses (create, get, update settings), members (list, add, set permissions,
  remove with last-owner guard), admin (list, suspend/reactivate), audit (append-only)
- Security tests: cross-tenant read/update/insert, missing-WHERE, forged ctx, membership visibility,
  audit log immutability, setting leakage; permission tests for employee defaults, key grants, owner-only
  actions, unknown keys, non-admin use of admin services, audit rows per mutation

Not done (still Phase 1):

- Better Auth wired into routes: sign-in page, session lookup in loaders, invitation by email
- `/app/:business` layout that calls `resolveTenantCtx` and returns 404 on non-membership
- `/admin` layout gated by `is_platform_admin` (TOTP comes with phase 8)
- Platform admin "create business" screen
- HTTP-level security probes in the Workers runtime (`@cloudflare/vitest-pool-workers`)
- GitHub Actions running the suite against a real Postgres service
- Neon project, Hyperdrive bindings, staging and production Workers (needs your Cloudflare and Neon accounts)

## Phase 2 onward

Not started. See the architecture plan for the phase order: dashboard core, appointments and calendar,
CRM (pilot launch), payments, notifications, online booking, subscriptions.

## Known gaps and decisions deferred

- Design direction approved 2026-10-28: Direction A, "Today first", phone-first, on the Siren Coffee tokens (ADR 004). No UI beyond a placeholder route exists yet; Phase 2 builds the component system from the canvas.
- Self-serve signup is disabled in production until phase 8; accounts come from invitations or seeding.
- The Stripe, Resend and Hyperdrive secrets are declared in `.dev.vars.example` but unused until their phases.
