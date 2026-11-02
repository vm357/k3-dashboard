# Status

Updated in the same commit as the code it describes. "Done" means implemented and covered by
tests that ran green; the CI run link goes beside the entry once the repository is on GitHub.

## Phase 1: Foundation — done except the production deploy

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

Cloud setup (confirmed by Kermit, 2026-11-01): Neon project and roles, Hyperdrive bindings and the
Cloudflare connections, DNS and custom domains are done; the repository is on GitHub with CI green;
staging is deployed. Production is not deployed yet, on purpose: it goes
out from the Actions tab when the pilot salon is ready to start.

Not done (still Phase 1):

- Production deploy (manual, behind the `production` environment's reviewer; see `docs/LAUNCH.md`)
- Invitation emails and password reset: built in phase 6, not yet tested
- TOTP for admins (phase 8)

## Phase 2: Dashboard core — done

Done (tests: `npm test`, 52 passing locally on 2026-10-28; CI not yet run):

- Migration `0003_dashboard_core`: service_categories, services, employees, employee_services,
  business_hours, employee_availability, time_blocks, customers, customer_notes; RLS on all nine
- Services: categories, create/edit in a bottom sheet (duration, buffer, price, deposit none/percent/fixed
  with validation, online flag, description), hide/show, grouped list
- Staff: bookable employees separate from logins (linkable), services they do, weekly hours with split
  shifts and overlap rejection, time off (own time off needs appointments.manage_own, others' needs team.manage),
  hide from booking; Team page lists bookable staff above logins
- Settings: opening hours per weekday, booking rules (slot interval, minimum notice, max advance, cancellation
  window and note) stored as JSON on the business with defaults, links to Services and Team
- Clients: directory with search by name, email or phone digits; add in a sheet with normalised phone and
  lower-cased email; duplicate-email guard; profile with pinned "Always" note, dated notes, Call/Text actions,
  details editable; contact fields hidden for staff without customers.view_contact; audit rows never carry contact details
- Today shows an owner setup checklist built from real data (services, staff, hours, first client)
- Domain tests (14) covering cross-tenant probes for every new table, permission gates, validation

Gate check: an owner can configure a real salon end to end (services, staff with hours, opening hours,
clients) and an employee sees only what their keys allow. Met in tests and confirmed in a browser on 2026-10-30
(phone and desktop screenshots of every screen; fixes: parallel loaders now share one db client per request,
hours row overflow on phones, phone number display, first-name sort, hydration-safe date formatting).

## Phase 3: Appointments and calendar — done

Done (tests: `npm test`, 74 passing locally on 2026-10-30; booking flow walked in a browser at phone width):

- Migrations `0004_appointments`, `0005_appointments_exclusion`: appointments (status and payment state as
  separate axes, frozen totals), appointment_services (prices and durations frozen at booking), status history;
  `EXCLUDE USING gist` on employee + tstzrange for live statuses with btree_gist; RLS on all three
- Scheduling: zone-aware time helpers (`zonedTimeToUtc`, DST gap and overlap handled) and a pure availability
  engine (hours ∩ staff availability, minus blocks and live appointments with buffers, grid anchored to local
  midnight, min notice and max advance); 10 engine tests including the fall-back DST day
- Appointments service: `listSlots`, `bookAppointment` (server-side fit check, inline walk-in client creation,
  exclusion violation mapped to "slot taken"), status machine with history, `reschedule` as a linked new row,
  `listDay`, `getAppointment`, `listForCustomer`, `expireHolds`; employee access by manage_own / manage_all;
  broader permission keys now imply narrower ones
- Concurrency test over the real wire protocol: 50 simultaneous bookings on one slot yield exactly one; the
  database alone rejects an overlapping insert
- Screens: booking sheet (state in the URL, every tap a link, client search or inline new client, service pills,
  14-day chips, times from the engine, one tap books), appointment detail (check in, done, no-show, cancel with
  reason, move to another time, history), Calendar day view with prev/next and date jump, Today with the next-up
  card, timeline, open gaps as "Book +", and an "N to mark done" nudge for visits never closed out; client
  profile shows upcoming and history with lifetime spend from completed visits
- `scripts/seed-appointments.ts` books a believable day for the demo salon relative to today

Not done (deferred to later phases as planned): online booking holds and hold-expiry cron (phase 7), week view
on desktop, drag to reschedule, waitlist.

## Phase 4: CRM — done

- Duplicate detection (`server/domain/customers/merge.ts`): pairs with the same phone, email or full name,
  shown at `/clients/duplicates` with a visit count per record. Merge keeps one record, moves the other's
  appointments and notes, fills in missing contact details, retires the other record (`merged_into_id`) and
  audits it. Nothing merges on its own. Needs `customers.edit`.
- Reports (`server/domain/reports/service.ts`, `/reports`): this week, this month, last 30 or 90 days, in the
  business time zone. Completed visits, revenue (price of completed visits; collected money comes with phase 5),
  new clients, no-shows and cancellations, by day, by service, by staff (hidden for a one-person salon), top
  clients. Needs `reports.view`; on the desktop sidebar, and under Settings on phones.
- "Due for a visit": clients past their own median gap between completed visits (6 weeks when there is only
  one) with nothing booked ahead. Top three on Today, five on Clients, each with a Book shortcut.
- `scripts/seed-history.ts` adds three months of demo history and one duplicate; idempotent.
- Fixed on the way: a correlated subquery where Drizzle rendered `customers.id` as a bare `"id"` (counted zero
  for everyone). Written by hand now, with a test on the count.

Not done: spending from recorded payments (phase 5), marketing consent export, CSV import.

## Launch readiness — code side done, accounts pending

- Security headers on every response (`server/http/security.ts`): nonce-based CSP for scripts,
  HSTS, nosniff, frame-ancestors none, referrer and permissions policies. The nonce flows
  Worker → `entry.server.tsx` → root `<Scripts>`; verified in a browser that hydration and
  client-side navigation work under the policy with no violations.
- Sign-in rate limited by Better Auth with counters in `rate_limits` (migration 0006), keyed by
  `cf-connecting-ip`: 10 attempts a minute per IP, then 429. Memory storage would have been
  per-isolate and useless on Workers.
- The public sign-up endpoint is 404 in every environment (Hono, before Better Auth sees it).
  The earlier `disableSignUp: production` was removed: invitations create accounts through
  `auth.api.signUpEmail` server-side and would have failed in production. Caught by reading,
  not by tests, which run in the test environment; now tested directly.
- `/api/health` does a database round-trip and proves the connection is a plain `k3_app`
  (not superuser, not BYPASSRLS, sees no customers without tenant context); 503 with a reason
  code otherwise. Neon Console-created roles carry BYPASSRLS, so this matters.
- The route-test harness and the local PGlite database now run as `k3_app`; before this
  both were the superuser, so row-level security was not in force in local dev or route tests.
- `scripts/smoke.ts` (`npm run smoke -- <url>`): nine outside-in checks for a deployed site.
- `scripts/bootstrap-admin.ts`: the first platform admin on an empty production database.
- `.github/workflows/deploy.yml`: staging on push to main (once enabled), production by hand.
- `docs/LAUNCH.md`: the account setup, in order.

Still needed from Kermit: Neon project and roles, Cloudflare Hyperdrive ids and the custom
domains, GitHub environment secrets. Resend and Stripe are not needed for the pilot.

Known gap that should land before the pilot depends on the app: there is no password reset
(phase 6, Resend). An owner who forgets her password is locked out and the admin cannot help.

## Phase 6 (part): password reset and invitation emails — done locally, staging pending

Designs: `Phase 6 Account Emails.dc.html` (options), picks 1b, 2b, 3a; `Phase 6 Prototype.dc.html`.
Tests: `npm test`, 108 passing locally on 2026-11-01 (22 in `tests/security/password-reset.test.ts`); typecheck clean.

- `/forgot`: six-digit code by email (Better Auth `emailOTP` plugin, 10 minutes, 3 attempts),
  then a new password on the same route; signs in and lands on the user's home. Same answer
  for unknown emails. Throttled in `server/http/throttle.ts` (10 sends per IP and 3 per email
  per 10 minutes, 20 checks per IP) because `auth.api` calls skip Better Auth's limiter.
  `revokeSessionsOnPasswordReset` signs out other devices. "Forgot password?" on Sign in.
- The plugin's public endpoints, OTP sign-in and the link-based reset endpoints are 404 in Hono.
- `server/email`: Resend over fetch, plain-letter templates (HTML + text) for the reset code and
  the invitation. Development prints to the console without a key; test captures in `outbox`;
  staging/production need `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` (default no-reply@k3dashboard.app).
- Team: "Send invitation" emails the link and keeps "Copy link to text it"; if sending fails the
  link is shown to copy. Pending rows show when they were emailed; Resend after 24 h issues a
  fresh token (`resendInvitation`, audited `invitation.resend`).

To do before calling it done: `RESEND_API_KEY` as a staging secret, verify the sending domain in Resend,
and walk the reset and invite flows on staging with a real inbox.

## Known gaps and decisions deferred

- Self-serve signup is disabled in production until phase 8; accounts come from invitations or admin onboarding.
- The Stripe, Resend and Hyperdrive secrets are declared in `.dev.vars.example` but unused until their phases.
- `createDb` shares one client per URL in test mode only, because PGlite's socket server serves one
  connection at a time; the Worker keeps one client per request as Cloudflare requires.
