# Status

Updated in the same commit as the code it describes. "Done" means implemented and covered by
tests that ran green; the CI run link goes beside the entry once the repository is on GitHub.

## Phase 1: Foundation — done except cloud setup

Done (tests: `npm test`, 38 passing locally against PGlite on 2026-10-28; CI not yet run):

- Project scaffold: React Router 8 on Cloudflare Workers, Hono for `/api` and `/webhooks`, Zod-validated env
- Drizzle schema for users, sessions, accounts, verifications, plans, plan_features, audit_log,
  businesses, business_members, business_feature_overrides, invitations; migrations
  `0000_foundation`, `0001_grants`, `0002_invitations`
- Row-level security: `k3_app` role, policies on every tenant table, `app_is_member()` membership check,
  transaction-local session settings (`withTenant`, `withUser`, `withBypass`)
- Permission keys (closed union), `resolveTenantCtx`, `can`/`require`/`requireOwner`, browser-safe `hasPermission`
- Domain services: businesses (create, get, update settings), members (list, add, set permissions,
  remove with last-owner guard), invitations (create with hashed single-use token, list, revoke,
  preview, accept with email match), admin (list, suspend/reactivate, onboard with owner invitation), audit (append-only)
- Better Auth wired: email and password sign-in, sign-out (POST only), session helpers
  (`requireUser`, `requireTenant` → 404 for non-members, `requireAdmin` → 404 for non-admins), post-login routing
- Routes: `/sign-in`, `/sign-out`, `/invite/:token` (creates the account and binds the membership),
  `/no-business`, `/app` chooser, `/app/:business` layout with bottom bar (phone) and sidebar (desktop),
  Today, Calendar and Clients placeholders with honest empty states, Settings (name, time zone),
  Team (invite with copyable link, pending list, per-member permission checklist, remove),
  `/admin` layout, business list with suspend/reactivate, Add a business (attaches an existing owner
  or issues an owner invitation)
- Design tokens and primitives from ADR 004: `app.css` theme, Button, ButtonLink, Card, Badge, Field,
  PageTitle, Avatar, EmptyState, AppShell, Page, line icons
- Security tests: tenant isolation (10), roles and permissions (10), invitations and onboarding (8),
  route level with real Better Auth sessions over PGlite's wire protocol (10)

Not done (still Phase 1):

- Neon project, Hyperdrive bindings, staging and production Workers, DNS (needs the Kermit Webcraft Cloudflare and Neon accounts)
- Push to GitHub and a first CI run (repository not yet created)
- Invitation emails (phase 6); until then the owner copies the link from the Team page
- Password reset (needs email); TOTP for admins (phase 8)

## Phase 2: Dashboard core — next

Services and categories, employee profiles and availability, time off, client directory (read-only),
business hours and booking policy settings. Builds on the primitives above; design per ADR 004.

## Known gaps and decisions deferred

- Self-serve signup is disabled in production until phase 8; accounts come from invitations or admin onboarding.
- The Stripe, Resend and Hyperdrive secrets are declared in `.dev.vars.example` but unused until their phases.
- `createDb` shares one client per URL in test mode only, because PGlite's socket server serves one
  connection at a time; the Worker keeps one client per request as Cloudflare requires.
