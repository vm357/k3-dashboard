# Dashboard update 2: client info

Push update 1 first. This folder builds on it (some files here replace update 1's versions).

Copy everything in this folder over the root of your k3-dashboard repo (same paths), then:

    npm test
    npm run typecheck

and push to main. The deploy runs the new migration (0007_client_info) on staging before
the Worker goes out. It only adds columns, so existing clients become Active with no allergy.

New
- drizzle/0007_client_info.sql, drizzle/meta/0007_snapshot.json
- app/components/client-tags.tsx
- tests/domain/client-info.test.ts

Changed
- drizzle/meta/_journal.json
- server/db/schema/customers.ts
- server/domain/customers/service.ts
- server/domain/appointments/service.ts (refuses archived / Do not book; returns allergy and status)
- server/domain/reports/service.ts (Due for a visit skips archived / Do not book)
- app/routes/app/clients.tsx, client.tsx, book.tsx, today.tsx, calendar.tsx
- app/components/appointment-panel.tsx
- docs/STATUS.md (replaces yours)

Check on staging: set a client to VIP and Do not book, add an allergy and look for it on Today
and in the appointment panel, filter and sort the list, archive a client with and without an
upcoming booking, restore one, and delete an archived test client.
