# Dashboard update 1: appointment panel

Copy everything in this folder over the root of your k3-dashboard repo (same paths), then:

    npm test
    npm run typecheck

and push to main. No database migration in this update.

New
- app/components/appointment-panel.tsx
- app/lib/appointment-panel.server.ts
- tests/domain/appointment-panel.test.ts

Changed
- app/routes/app/appointment.tsx (now redirect + actions only)
- app/routes/app/today.tsx
- app/routes/app/calendar.tsx
- app/components/icons.tsx (four icons added)
- app/lib/format.ts ("Confirmed" → "Booked")
- server/domain/appointments/service.ts (listMoveSlots, reschedule to another person, who-did-it on history)
- docs/STATUS.md (includes the phase 6 notes; replaces yours)

Check on staging: open an appointment from Today and from Calendar, check in from Next up,
move one to another day and to another person, cancel one, and look at the history names.
