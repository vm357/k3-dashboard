# ADR 002: Tenant isolation in three layers

Date: 2026-10-26. Status: implemented in `0000_foundation`.

## Decision

1. Route layer: `/app/:businessSlug/*` resolves the slug through `resolveTenantCtx`, which joins
   `businesses` to the caller's own `business_members` rows. No membership, no ctx, 404.
2. Service layer: every domain function takes `TenantCtx` first, runs inside `withTenant`, and
   filters by `ctx.businessId`. Permission checks (`require(ctx, key)`) precede every mutation.
3. Database layer: the Worker connects as `k3_app`, which owns nothing. Every tenant table has
   RLS policies of the form `bypass OR (business_id = app.business_id AND app_is_member())`.
   `app_is_member()` is a `SECURITY DEFINER` function that verifies `app.user_id` is a member of
   `app.business_id`, so even a forged ctx in server code sees nothing. Settings are set with
   `set_config(..., true)` and die with the transaction.

## Bypass

`app.bypass_rls = 'on'` is set only by `withBypass`, whose two sanctioned callers are business
creation (no tenant exists yet) and the platform-admin services, each of which writes an
`audit_log` row in the same transaction. Any other `withBypass` call is a review failure.

## Why not FORCE ROW LEVEL SECURITY

Migrations run as the owning role and must see everything. Keeping the app on a non-owner role
gives the same protection for the running system without complicating migrations.

## Tests

`tests/security/tenant-isolation.test.ts` and `tests/security/permissions.test.ts` run the real
migrations under the real role on PGlite and must stay green on every PR.
