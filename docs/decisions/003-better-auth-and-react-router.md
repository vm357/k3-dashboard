# ADR 003: Better Auth, and React Router with Hono in one Worker

Date: 2026-10-26. Status: approved by Kermit.

## Auth

Better Auth, self-hosted as a library inside the Worker with its Drizzle adapter, email and
password now, magic-link invitations next, passkeys and TOTP (admins) later. Only staff sign in,
so volume is small and a hosted provider's per-user pricing buys nothing. Memberships and
permissions are domain tables, not a vendor feature. Clerk remains the escape hatch if owning
password reset and sessions proves a burden.

Customers never authenticate. Reschedule and cancel links (phase 7) carry a signed, single-use,
appointment-scoped token instead.

## Framework

React Router 8 in framework mode (the plan said 7; 8 shipped with the same model and Cloudflare's
scaffolder targets it). Loaders and actions are the dashboard's backend. Hono handles `/api/*`
and `/webhooks/*` in the same Worker because those routes need CORS, publishable-key auth,
Turnstile and signature verification as middleware. The Worker entry dispatches by path prefix.

## Permissions

A closed union of permission keys (`server/auth/permissions.ts`). Owners hold all keys
implicitly; employees hold what the owner grants, with a small default set. New capabilities add a
key and a check, never a table.
