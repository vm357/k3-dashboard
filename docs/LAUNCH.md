# Launch checklist

How K3 Dashboard goes from this repository to `app.kermitwebcraft.com` with a pilot salon on
it. Steps 1–4 need the Kermit Webcraft accounts and take about an hour the first time. The
code side is done: CI is green, the deploy workflow exists, and the smoke test runs against
any URL. Nothing below is optional for production; staging can skip step 6.

What does **not** need an account for launch: email (invitations are shown as a link the
admin sends by hand until phase 6), Stripe (phase 5 and 8).

## 1. Neon (database)

1. Sign up at neon.com (GitHub login is fine). Create a project: name `k3-dashboard`,
   Postgres 17, region **AWS US East (N. Virginia)**. Leave the database name as `neondb`.
   Neon creates a branch called `production` (older projects call it `main`) and an owner
   role `neondb_owner`.
2. Branches → Create branch: name `staging`, parent `production`. Each branch is a full copy
   with its own connection strings.
3. Create the application role **with SQL, not with the Roles tab.** Roles made in the Neon
   Console (or CLI or API) are members of `neon_superuser`, which can bypass row-level
   security; that would silently turn off tenant isolation. Open **SQL Editor**, pick the
   branch at the top, and run, once per branch:
   ```sql
   CREATE ROLE k3_app WITH LOGIN PASSWORD '<a different 32+ character password per branch>';
   ```
   (Migrations also create `k3_app` without a password if it does not exist; if that ran
   first, use `ALTER ROLE k3_app WITH LOGIN PASSWORD '...'` instead.) Generate the password
   with `openssl rand -base64 32` or a password manager and store it there.
   The deployed app checks this on every `/api/health` call and reports 503 with reason
   `bypassrls` or `connected_as_<role>` if the connection is not a plain `k3_app`.
4. Connection strings, from the **Connect** button with the branch selected. You need two
   per branch:
   - **Owner** (role `neondb_owner`, "Pooled connection" off): for migrations. This is the
     GitHub environment secret `DATABASE_URL`.
   - **k3_app** (role `k3_app`, "Pooled connection" on): for the Worker, via Hyperdrive.
     The Connect dialog lets you pick the role; the password is the one you set in step 3.
   Both look like `postgresql://<role>:<password>@<host>/neondb?sslmode=require`. Keep them
   in your password manager; they are never committed.
5. Settings → "Restore window" (history retention): set it to the longest the plan allows.
   This is the backup.

## 2. Cloudflare (Worker, Hyperdrive, DNS)

1. `kermitwebcraft.com` must be on Cloudflare DNS (it is the zone the Worker routes attach to).
2. Hyperdrive, once per environment, from a machine with `wrangler login` done:
   ```sh
   npx wrangler hyperdrive create k3-staging    --connection-string "<k3_app staging URL>"
   npx wrangler hyperdrive create k3-production --connection-string "<k3_app production URL>"
   ```
   Paste the two ids into the commented `hyperdrive` blocks in `wrangler.jsonc` and commit.
3. Worker secrets, once per environment (the value is read from the prompt, never a file):
   ```sh
   openssl rand -base64 32          # generate; paste when prompted
   npx wrangler secret put AUTH_SECRET --env staging
   npx wrangler secret put AUTH_SECRET --env production
   ```
   Keep the production value somewhere safe: `scripts/bootstrap-admin.ts` needs it once.
4. Custom domains: after the first deploy, Workers → the Worker → Settings → Domains & Routes
   → add `staging-app.kermitwebcraft.com` (staging) and `app.kermitwebcraft.com` (production).
   Cloudflare creates the DNS records and certificates.
5. WAF rate limiting rule (free plan allows one): path starts with `/api/`, 100 requests per
   10 seconds per IP, block for 10 seconds. The application also limits sign-in attempts to
   10 a minute per IP with database-backed counters, so this is the outer layer only.

## 3. GitHub (deploys)

1. Settings → Environments: create `staging` and `production`. On `production`, add yourself
   as a required reviewer so a production deploy waits for a click.
2. In each environment, secrets:
   - `DATABASE_URL`: the **owner** connection string for that branch (migrations only).
   - `CLOUDFLARE_API_TOKEN`: My Profile → API Tokens → "Edit Cloudflare Workers" template.
   - `CLOUDFLARE_ACCOUNT_ID`: from the Workers overview page.
3. Settings → Secrets and variables → Actions → Variables: `DEPLOY_STAGING` = `true`. From
   then on every push to `main` migrates and deploys staging and smoke-tests it.
4. Production: Actions → Deploy → Run workflow → `production`. Only from `main`.

## 4. First sign-in

Open sign-up is closed and the seed script refuses to run outside development, so the first
account is created from a terminal, once, against an empty database:

```sh
DATABASE_URL='<owner connection string>' AUTH_SECRET='<the Worker's AUTH_SECRET>' \
APP_ORIGIN=https://app.kermitwebcraft.com \
ADMIN_EMAIL=you@kermitwebcraft.com ADMIN_NAME="Kermit" ADMIN_PASSWORD='<12+ characters>' \
npx tsx scripts/bootstrap-admin.ts
```

It refuses if any user already exists. Then sign in at `/sign-in` and you land on `/admin`.

## 5. Onboard the pilot salon

1. `/admin/businesses/new`: name, slug (becomes the URL, cannot change later without a
   migration), time zone, the owner's email. If the owner has no account yet, the page shows
   the invitation link **once**. Send it to her by text; it expires in 7 days.
2. She opens the link, sets a name and a 12+ character password, and lands on Today with the
   "Get set up" checklist: services, herself as bookable staff, opening hours, first client.
3. Sit with her for the first setup. Known rough edges to warn about: no password reset until
   phase 6 (an admin cannot reset it either; the workaround is a new invitation to a new
   email, which is bad, so do not lose it); no online booking (phase 7); revenue in Reports is
   list price of completed visits, not money collected.

## 6. Before calling production live

- [ ] `npm run smoke -- https://app.kermitwebcraft.com` passes.
- [ ] Sign in on a phone, book, check in, mark done, reschedule, cancel: all on the real URL.
- [ ] Neon: point-in-time restore window is on (default 1 day on the free plan; set 7 if the
      plan allows). This is the backup.
- [ ] Cloudflare: Workers → Observability shows requests; errors are JSON lines with a
      `route` and `message` and nothing else.
- [ ] `wrangler.jsonc` committed with both Hyperdrive ids; `.dev.vars` is not in git
      (`git ls-files .dev.vars` prints nothing).
- [ ] Decide the two plan-doc items still open: deposit defaults and plan prices do not
      block the pilot, but the pilot's terms (free for how long, what she gets) should be
      written down before she depends on it.

## Rollback

`npx wrangler rollback --env production` returns the previous Worker version in seconds.
Migrations are additive so far (no column drops), so an older Worker runs against a newer
database. If a migration ever has to be destructive, it ships in two deploys: one that stops
using the column, one that drops it.
