# Phase 6 changes

Copy everything in this folder over the root of your k3-dashboard repo (same paths), then:

```sh
npm test            # expect 10 test files; the new one is tests/security/password-reset.test.ts
npm run typecheck
```

New files: server/email/templates.ts, server/email/send.ts, server/http/throttle.ts,
app/routes/auth/forgot.tsx, tests/security/password-reset.test.ts.

Changed files: server/auth/auth.ts, server/env.ts, server/api/app.ts, app/routes.ts,
app/routes/auth/sign-in.tsx, server/domain/invitations/service.ts, app/routes/app/team.tsx,
tests/helpers/server.ts, docs/STATUS.md.

If you edited any changed file locally since you uploaded the repo, diff before overwriting.

## Sender domain fix

- `wrangler.jsonc`: staging and production send from `no-reply@mail.kermitwebcraft.com` (the domain verified in Resend). Resend returned 403 for the old `k3dashboard.app` address.
- `server/env.ts`: same default.
- `.github/workflows/deploy.yml`: pushes `RESEND_API_KEY` to the Worker on every deploy. Add it under GitHub → Settings → Environments → staging (and production).
