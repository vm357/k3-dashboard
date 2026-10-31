# K3 Dashboard

Multi-business appointment and customer management for beauty businesses, by Kermit Webcraft.
One Cloudflare Worker, one Postgres database, many isolated businesses.

The architecture plan lives in the Claude doc "Kermit Webcraft Booking Platform: Architecture Plan";
`docs/decisions/` records why each major choice was made, and `docs/STATUS.md` says what is done.
Read `docs/STATUS.md` first in every working session.

## Stack

- Cloudflare Workers with static assets, React Router (framework mode), Hono for `/api` and `/webhooks`
- Postgres (Neon) through Hyperdrive, Drizzle ORM and migrations, row-level security on every tenant table
- Better Auth for staff sign-in; customers never have accounts
- Stripe Connect (phase 5), Stripe Billing (phase 8), Resend (phase 6)
- Vitest against PGlite locally, real Postgres in CI; Playwright later

## Local development

No Postgres install needed. A local database runs from the repo:

```sh
npm install
cp .dev.vars.example .dev.vars   # DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres, any AUTH_SECRET
npm run db:local                 # terminal 1: local Postgres (PGlite) with migrations applied, data in .local-db/
DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres npm run db:seed   # once: demo salon + logins
DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres npx tsx scripts/seed-appointments.ts   # optional: today's bookings
DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres npx tsx scripts/seed-history.ts        # optional: 3 months of history
npm run dev                      # terminal 2
```

Sign in at http://localhost:5173 as `lina@demo.local` (salon owner) or `admin@k3.local` (Kermit admin),
password `demo-password-123`. The seed refuses to run outside development.

Against a real Postgres (Neon), set `DATABASE_URL` to it and use `npm run db:migrate` instead of `db:local`.

`node scripts/shoot.mjs` screenshots every screen at phone and desktop sizes into `lab/shots/` (needs Playwright).

The app connects as the Postgres role `k3_app`, which migration `0001_grants` creates and grants.
Point `DATABASE_URL` at a user that owns the schema for migrations; set the Hyperdrive origin
credentials to `k3_app` for the running Worker.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server in the Workers runtime |
| `npm test` | Unit, integration and security tests against PGlite |
| `npm run typecheck` | Wrangler types, React Router typegen, tsc |
| `npm run db:generate` | Generate a migration from `server/db/schema` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:local` | Zero-install local Postgres with migrations applied |
| `npm run db:seed` | Demo salon and logins (development only) |
| `npm run build` | Production build |
| `npm run deploy:staging` / `deploy:production` | Build and deploy the named environment |

## Layout

```
app/        React Router routes and components (never imports server/db)
server/     Worker-side code: api (Hono), auth, db, domain services, jobs, integrations
workers/    Worker entry: dispatches to Hono or React Router
drizzle/    SQL migrations, committed and applied in order
tests/      security probes, integration tests, helpers
docs/       STATUS.md and architectural decision records
```

Rules that keep this safe to grow: every domain function takes a `TenantCtx` as its first argument
and runs inside `withTenant`; a `TenantCtx` is only ever built by `resolveTenantCtx` from the caller's
own membership; `withBypass` is used by business creation and audited admin services only.
