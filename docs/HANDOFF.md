# Handoff for the developer

The repository is `github.com/vm357/k3-dashboard`, branch `main`, CI green. Phases 1–4 are
built; what is left before a pilot salon can use it is cloud setup, which needs the Kermit
Webcraft accounts. That is written up step by step in `docs/LAUNCH.md`.

## Run it locally

```sh
npm install
cp .dev.vars.example .dev.vars        # DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres, any 32+ char AUTH_SECRET
npm run db:local                      # terminal 1: local Postgres (PGlite), migrations applied, data in .local-db/
DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres npm run db:seed                       # demo salon + logins
DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres npx tsx scripts/seed-appointments.ts  # today's bookings
DATABASE_URL=postgres://k3_app:k3_app@127.0.0.1:5433/postgres npx tsx scripts/seed-history.ts       # 3 months of history
npm run dev                           # terminal 2, then sign in as lina@demo.local / demo-password-123
npm test                              # 85 tests, no database install needed
```

`admin@k3.local` (same password) is the platform admin and lands on `/admin`.

To see the app the way production serves it (security headers, CSP, built assets):

```sh
npm run build && npx wrangler dev --port 8787 --var APP_ENV:staging --var APP_ORIGIN:http://localhost:8787
npm run smoke -- http://localhost:8787
```

## How it is put together

- `README.md`: stack, layout, the three rules that keep tenant isolation intact.
- `docs/STATUS.md`: what is done, what is not, what is deferred. Update it in the same commit
  as the code it describes.
- `docs/decisions/`: why Postgres over D1, how isolation works, why Better Auth, the shell.
- `docs/LAUNCH.md`: accounts, secrets, first deploy, first sign-in, pilot onboarding, rollback.
- The architecture plan (Claude doc) has the phase order and the open product decisions.

Every domain function takes a `TenantCtx` first and runs inside `withTenant`. A `TenantCtx`
only comes from `resolveTenantCtx`. `withBypass` is for business creation and audited admin
services only. If a change needs to break one of those rules, it needs a new ADR, not a
workaround.

Secrets: only in `wrangler secret` and `.dev.vars`. `.dev.vars.example` lists names, never
values. The audit log never contains customer contact details. Seed and bootstrap scripts
refuse to run where they should not.

## Deploys

`.github/workflows/deploy.yml`: push to `main` deploys staging once the repository variable
`DEPLOY_STAGING` is `true`; production is a manual run from the Actions tab, from `main`
only, behind the `production` environment's required reviewer. Each deploy runs migrations
as the database owner, uploads the Worker, then runs `scripts/smoke.ts` against the live URL.
`npx wrangler rollback --env production` undoes a bad deploy in seconds.

## Next work, in order

1. Cloud setup and the pilot (`docs/LAUNCH.md`).
2. Phase 6 first, not 5: password reset and invitation emails through Resend. A pilot owner
   who forgets her password currently has no way back in, and neither does the admin.
3. Phase 5 payments (Stripe Connect), phase 7 online booking, phase 8 subscriptions.
