# Dashboard update 5: repeat bookings

Push updates 1 to 4 first. This folder builds on them (some files here replace their versions).

Copy everything in this folder over the root of your k3-dashboard repo (same paths), then:

    npm test
    npm run typecheck

and push to main. The deploy runs migration 0009_appointment_series (one new column, nullable).

New
- drizzle/0009_appointment_series.sql, drizzle/meta/0009_snapshot.json
- tests/domain/repeat-bookings.test.ts

Changed
- drizzle/meta/_journal.json
- server/db/schema/appointments.ts
- server/domain/appointments/service.ts
- app/routes/app/book.tsx, appointment.tsx
- app/lib/appointment-panel.server.ts, app/components/appointment-panel.tsx
- docs/STATUS.md (replaces yours)

Check on staging: book a client every 3 weeks for 6 visits over Thanksgiving and see that date
crossed out; open one of the visits and look at the series list; cancel from the middle with
"Also cancel the later visits" ticked.
