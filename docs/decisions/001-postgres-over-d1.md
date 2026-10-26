# ADR 001: Postgres (Neon) through Hyperdrive, not D1

Date: 2026-10-26. Status: approved by Kermit.

## Decision

The application database is Postgres hosted on Neon, reached from the Worker through
Cloudflare Hyperdrive, with Drizzle ORM and SQL migrations.

## Why

Three requirements in the brief need features D1 (SQLite) does not have:

1. Double-booking prevention under concurrency: a Postgres `EXCLUDE` constraint on
   `(employee_id, tstzrange(start_at, end_at))` makes an overlapping live appointment impossible
   at the database. D1 has no overlap constraint and no multi-statement interactive transactions.
2. Database-level tenant isolation: Postgres row-level security filters every query by the
   session's business. D1 has no RLS; isolation would be application code only.
3. Transactions across several statements with rollback (appointment, services, customer,
   payment written together).

## Cost

A second vendor and bill (Neon, from $0 to about $19/month at this scale), and Hyperdrive setup
per environment. Accepted. Hyperdrive makes a later move to another Postgres host a
connection-string change.

## Rejected alternative

D1 plus a Durable Object per business to serialize booking writes. More code to get right,
no RLS, and the DO becomes a single point of contention per tenant.
