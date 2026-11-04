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

Accounts: done (see Phase 1). Password reset landed in phase 6.

## Phase 6 (part): password reset and invitation emails — verified on staging

Designs: `Phase 6 Account Emails.dc.html` (options), picks 1b, 2b, 3a; `Phase 6 Prototype.dc.html`.
Tests: `npm test`, 108 passing locally on 2026-11-01 (22 in `tests/security/password-reset.test.ts`); typecheck clean.
Staging, 2026-11-03: reset email delivered from `no-reply@mail.kermitwebcraft.com` and a test-business password reset end to end. First attempt failed with Resend 403 (sender was the unverified `k3dashboard.app`); fixed via `EMAIL_FROM_ADDRESS` in `wrangler.jsonc` and `RESEND_API_KEY` pushed by `deploy.yml`.
Invitation email delivered on staging the same day (landed in Hotmail spam). `RESEND_API_KEY` set in both GitHub environments.
Open: deliverability. Check SPF, DKIM and DMARC for `mail.kermitwebcraft.com` in Resend before the pilot.

- `/forgot`: six-digit code by email (Better Auth `emailOTP` plugin, 10 minutes, 3 attempts),
  then a new password on the same route; signs in and lands on the user's home. Same answer
  for unknown emails. Throttled in `server/http/throttle.ts` (10 sends per IP and 3 per email
  per 10 minutes, 20 checks per IP) because `auth.api` calls skip Better Auth's limiter.
  `revokeSessionsOnPasswordReset` signs out other devices. "Forgot password?" on Sign in.
- The plugin's public endpoints, OTP sign-in and the link-based reset endpoints are 404 in Hono.
- `server/email`: Resend over fetch, plain-letter templates (HTML + text) for the reset code and
  the invitation. Development prints to the console without a key; test captures in `outbox`;
  staging/production need `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` (no-reply@mail.kermitwebcraft.com, set in `wrangler.jsonc`).
- Team: "Send invitation" emails the link and keeps "Copy link to text it"; if sending fails the
  link is shown to copy. Pending rows show when they were emailed; Resend after 24 h issues a
  fresh token (`resendInvitation`, audited `invitation.resend`).


## Dashboard update 1: appointment panel — done locally, staging pending

Design: `K3 Dashboard.dc.html` (appointment sidebar). No migration.

- Appointments open in a panel on the right of Today and Calendar (full screen on phones) instead of
  their own page. Panel state is in the query string (`?a=`, `&move=`, `&with=`, `&cancel=1`), so every
  tap is a link and the page underneath stays put. `/appointments/:id` now only redirects to the right
  day with the panel open (old links and the booking sheet still work) and takes the panel's POSTs.
- Panel: "With <staff>" line under the client name; one primary action (Check in today, Mark done once
  checked in); No-show, Move and Cancel as a row of pills; cancel asks for confirmation with an optional
  reason; Preferences (the pinned note); history shows the logged-in user behind each change.
- Move: day chips, staff picker when there is more than one bookable person, times from
  `listMoveSlots` (frozen length, ignores the appointment's own slot). `reschedule` takes an optional
  `employeeId`; prices and durations stay as booked; the audit row records both employees.
- "Confirmed" is now "Booked", and the pill is hidden on booked appointments (shown only for
  Checked in, Done, Cancelled, No-show). Next up: "Check in" checks in directly; "Client notes" is "View client".
- Today's timeline names the staff member when the salon has more than one.
- Tests: `tests/domain/appointment-panel.test.ts` (move slots, move to another person, cross-business
  refusal, panel loader).

## Dashboard update 2: client info — done locally, staging pending

Design: `K3 Dashboard.dc.html` (Clients tab, client sidebar). Migration `0007_client_info`.

- Customers get `status` (Active, VIP, Inactive, Do not book; default Active), `allergy` and
  `archived_at`. "New" is derived: Active with no completed visits.
- Tags show on the client list, profile, booking sheet, appointment panel and Next up. Active has no
  pill. Allergies show as a red "Allergy" flag in lists and the schedule and as a red notice with the
  text on the profile, the appointment panel and Next up.
- Clients list: status filters (All, VIP, New, Inactive, Do not book, Archived), sort by first or last
  name, 10 per page.
- Profile: status picker; "Always" is now Preferences; the newest dated note is labelled Last visit;
  Allergies field in Details. Archive is a red pill inside Details with a confirmation, refused while
  the client has upcoming bookings. Archived clients are hidden from lists, search, booking and Due
  for a visit, and can be restored.
- Delete permanently: owner only, archived clients only. No visits on record: the row is deleted.
  With visits: name, contact, notes and allergy are erased and the visits stay as "Deleted client".
- Booking refuses archived and Do not book clients (server-side; the sheet says why).
- Tests: `tests/domain/client-info.test.ts` (derivation, filters, booking refusal, archive guard,
  Due for a visit, delete and erase, cross-business refusal).

## Dashboard update 3: calendar views and closed days — done locally, staging pending

Design: `K3 Dashboard.dc.html` (Bookings tab). No migration.

- Calendar has Day, Week and Month views (`?view=week|month&date=`), prev/next by the view's unit,
  and a date jump up to a year ahead. Week is seven day cards (stacked on phones); Month is a grid
  with a booking count per day. Tapping a booking opens the appointment panel in any view; tapping
  a day goes to its Day view.
- Closed days: Settings → Closed days adds one or more whole days with a label ("Thanksgiving").
  Stored as business-wide time blocks, so the availability engine already keeps them unbookable.
  Saving warns when bookings already sit on those days. Weekly closing days come from opening hours.
- Closed days and staff time off / breaks / blocks show in Day (as rows in the timeline), Week and
  Month. Today says "Closed · <label>" and shows no open gaps. The booking sheet and the Move picker
  cross out closed days.
- `server/domain/calendar/service.ts`: `listRange` (up to 42 days), `closedDates`, `listClosedDays`,
  `addClosedDays` (up to 31 days at a time), `removeClosedDay`.
- Tests: `tests/domain/calendar.test.ts`.

Not done: creating blocks from the calendar itself (still under Team → staff member).

## Dashboard update 4: waitlist and reminders — done locally, staging pending

Design: `K3 Dashboard.dc.html` (Today, appointment sidebar, Settings). Migration `0008_waitlist_reminders`.

- Reminder state on appointments (`reminder_status`: not sent, sent, confirmed, declined; sent and
  replied times), separate from the visit status, so a "no" never cancels anything by itself. A moved
  booking starts again at "not sent".
- Appointment panel: Reminder card with status, Send / Resend (hidden once confirmed), Mark confirmed,
  They said no. Send shows a preview first. Without Twilio the preview offers "Open Messages" (the
  phone's own app with the text filled in) and "I sent it"; with Twilio it is one "Send text" button.
- Settings → Reminder text: template with {first_name} {business} {service} {date} {time} {staff} and
  a live example. The business name comes from Settings.
- Today: "Not confirmed yet" (today and tomorrow) and a Waitlist card with Add, Book and Remove.
  Calendar Day view lists waitlist entries that want that day or any day. Booking from the waitlist
  closes the entry.
- `server/sms/send.ts`: Twilio over fetch; test mode captures in `smsOutbox`. Env:
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (all optional until set).
- Tests: `tests/domain/waitlist-reminders.test.ts`.

Not done (Twilio step): reading Y/N replies from clients (Twilio webhook with signature check) and
sending reminders automatically the day before (cron). Both need the approved Twilio number.

## Dashboard update 5: repeat bookings — done locally, staging pending

Design: `K3 Dashboard.dc.html` (booking sheet, appointment sidebar). Migration `0009_appointment_series`.

- Booking sheet: Repeat (No, every 2, 3 or 4 weeks) and number of visits (4, 6, 8, 12). With a repeat
  set, tapping a time shows every date first; closed days (weekly or from Settings), the staff
  member's day off and taken slots are crossed out with the reason. "Book N visits" books the free
  ones. Same local time on every date, through daylight saving.
- `previewSeries`, `bookSeries` (first date must be free; later conflicts, including a race, are
  skipped and reported), `listSeries`, `cancelSeriesFrom`. Visits share `series_id`; a moved visit
  keeps it. A new client entered in the sheet is created once.
- Appointment panel: "Repeat booking · 2 of 6" with every date in the series (cancelled ones crossed
  out), and the cancel confirmation can also cancel the later visits.
- Tests: `tests/domain/repeat-bookings.test.ts`.

## Known gaps and decisions deferred

- Self-serve signup is disabled in production until phase 8; accounts come from invitations or admin onboarding.
- The Stripe, Resend and Hyperdrive secrets are declared in `.dev.vars.example` but unused until their phases.
- `createDb` shares one client per URL in test mode only, because PGlite's socket server serves one
  connection at a time; the Worker keeps one client per request as Cloudflare requires.
