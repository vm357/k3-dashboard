# Handoff for the developer

This folder is a git repository with one commit on `main`. Nothing has been pushed yet.

## 1. Push it

Create an empty repository on GitHub (no README, no license), then:

```sh
git remote add origin git@github.com:<owner>/k3-dashboard.git
git push -u origin main
```

CI (`.github/workflows/ci.yml`) runs on every pull request and push to `main`: typecheck,
migrations from zero on Postgres 17, the test suite, and a production build.

## 2. Run it locally

```sh
npm install
cp .dev.vars.example .dev.vars        # set DATABASE_URL and AUTH_SECRET (openssl rand -base64 32)
npm run db:migrate                    # as a role that owns the schema
npm test                              # 20 tests, PGlite, no database needed
npm run dev
```

`DATABASE_URL` is used for migrations and local dev. The running Worker in staging and
production uses a Hyperdrive binding instead (see `wrangler.jsonc`). Migration `0001_grants`
creates the `k3_app` role the Worker must connect as; it owns nothing, so row-level security
applies to every query.

## 3. Cloud setup still needed (needs the Kermit Webcraft accounts)

- Neon: one project; `main` branch for production, a branch for staging. Create a login role
  `k3_app` with a password. Migrations run as the project's owner role.
- Cloudflare: `wrangler hyperdrive create k3-staging --connection-string "<k3_app staging URL>"`
  and the same for production; paste the ids into the commented `hyperdrive` blocks in
  `wrangler.jsonc`. Then `wrangler secret put AUTH_SECRET --env staging|production`.
- DNS: `app.kermitwebcraft.com` → production Worker, `staging-app.kermitwebcraft.com` → staging.

## 4. What to read

- `README.md`: stack, layout, the three rules that keep tenant isolation intact.
- `docs/STATUS.md`: what is done, what is not, and what is deferred. Update it in the same
  commit as any code it describes.
- `docs/decisions/`: why Postgres over D1, how isolation works, why Better Auth.
- The architecture plan (Claude doc) has the full phase order and the open decisions.

## 5. Next work, in order

1. Finish Phase 1: sign-in route, `/app/:business` layout calling `resolveTenantCtx`,
   `/admin` layout gated on `is_platform_admin`, email invitations, HTTP-level security probes
   with `@cloudflare/vitest-pool-workers`.
2. Phase 2, dashboard core, after Kermit approves a design direction.

Every domain function takes a `TenantCtx` first and runs inside `withTenant`. A `TenantCtx` only
comes from `resolveTenantCtx`. `withBypass` is for business creation and audited admin services
only. If a change needs to break one of those rules, it needs a new ADR, not a workaround.
