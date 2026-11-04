# Dashboard update 4: waitlist and reminders

Push updates 1, 2 and 3 first. This folder builds on them (some files here replace their versions).

Copy everything in this folder over the root of your k3-dashboard repo (same paths), then:

    npm test
    npm run typecheck

and push to main. The deploy runs migration 0008_waitlist_reminders on staging. It adds a
waitlist table and three reminder columns; existing bookings start as "not sent".

Twilio is not needed yet. Until it is set up, "Send reminder" opens your phone's Messages app
with the text filled in, and you tap "I sent it".

New
- drizzle/0008_waitlist_reminders.sql, drizzle/meta/0008_snapshot.json
- server/sms/send.ts
- server/domain/reminders/service.ts, server/domain/reminders/text.ts
- server/domain/waitlist/service.ts
- app/routes/app/waitlist-new.tsx
- tests/domain/waitlist-reminders.test.ts

Changed
- drizzle/meta/_journal.json
- server/db/schema/appointments.ts, server/env.ts
- server/domain/appointments/service.ts, server/domain/businesses/hours.ts
- app/routes.ts
- app/routes/app/appointment.tsx, today.tsx, calendar.tsx, settings.tsx, book.tsx
- app/lib/appointment-panel.server.ts, app/components/appointment-panel.tsx
- docs/STATUS.md (replaces yours)

Check on staging: edit the reminder text in Settings; open tomorrow's booking from "Not confirmed
yet", send the reminder from your phone and tap "I sent it", then Mark confirmed; add someone to the
waitlist and book them from it.
