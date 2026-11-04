# Dashboard update 3: calendar views and closed days

Push updates 1 and 2 first. This folder builds on them (some files here replace their versions).

Copy everything in this folder over the root of your k3-dashboard repo (same paths), then:

    npm test
    npm run typecheck

and push to main. No database migration in this update.

New
- server/domain/calendar/service.ts
- tests/domain/calendar.test.ts

Changed
- app/routes/app/calendar.tsx (Day / Week / Month)
- app/routes/app/settings.tsx (Closed days card)
- app/routes/app/today.tsx, book.tsx
- app/lib/appointment-panel.server.ts, app/components/appointment-panel.tsx
- docs/STATUS.md (replaces yours)

Check on staging: switch between Day, Week and Month and page through them; add Thanksgiving
(Nov 26) in Settings and see it crossed out in the booking sheet and shown in Week and Month;
add time off for a staff member under Team and look for it in all three views; open a booking
from Week and Month.
