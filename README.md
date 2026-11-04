# Dashboard update 6: checkout and client credit

Push updates 1 to 5 first. This folder builds on them (some files here replace their versions).

Copy everything in this folder over the root of your k3-dashboard repo (same paths), then:

    npm test
    npm run typecheck

and push to main. The deploy runs migration 0010_checkout_credit (two new tables).

New
- drizzle/0010_checkout_credit.sql, drizzle/meta/0010_snapshot.json
- server/db/schema/payments.ts
- server/domain/payments/service.ts
- tests/domain/checkout-credit.test.ts

Changed
- drizzle/meta/_journal.json
- server/db/schema/index.ts
- server/domain/appointments/service.ts (one helper exported)
- server/domain/customers/service.ts (credit on the client list)
- app/routes/app/appointment.tsx, client.tsx, clients.tsx, today.tsx
- app/lib/appointment-panel.server.ts, app/components/appointment-panel.tsx
- docs/STATUS.md (replaces yours)

Check on staging: give a test client $20 credit; check them in, Mark done, Take payment with
credit ticked, Card, and a tip; look at the payments in the panel, the credit history on the
profile, and Today's takings.
