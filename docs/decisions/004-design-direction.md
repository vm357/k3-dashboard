# ADR 004: Design direction A, "Today first", phone-first

Date: 2026-10-28. Status: approved by Kermit.

## Who the screen is for

A solo nail technician who owns her business and uses the dashboard on her phone between
clients, often one-handed. Desktop is the secondary layout. A front-desk receptionist on a
laptop is not the primary user and the design does not optimize for them.

## Decision

Direction A from the "K3 Dashboard Design Directions" canvas:

- **Home is Today, not a calendar.** A dark "next up" card (name, time until arrival, service,
  Check in and Text actions) above a timeline of appointment cards. Open gaps are rendered as
  dashed, tappable "Book +" cards. Completed appointments fade.
- **Booking is a bottom sheet**, filled top to bottom with one thumb: client search with a
  recognized-client confirmation row, service pills (multi-select), a seven-day chip row, time
  pills showing only slots that fit the selected duration, a sticky summary and one primary button.
- **The client page leads with notes**, then three equal actions (Book again, Call, Text), the
  upcoming appointment, and history with prices.
- **Navigation** is a four-item bottom bar on phone (Today, Calendar, Clients, Settings) and a
  left sidebar on desktop. A floating circular + button books from anywhere on phone.
- **Borrowed from Direction B:** a pinned "Always" note at the top of every client's notes, and a
  "Repeat last visit" shortcut at the top of the booking sheet.

## Visual system

The Siren Coffee design system, as selected by Kermit, with two exclusions: the coffee logo
mark and the Rewards gold accent are never used. What is used:

- Canvas warm cream `--surface-page`, white cards with `--shadow-card`, 12 px card radius,
  full-pill buttons, 56 px circular floating action.
- Four greens by role: `--brand-heading` for page titles and active nav, `--brand-cta` for
  the primary action, `--surface-feature` (house green) for the one dark card per screen,
  `--green-light` for selected and highlighted states.
- Manrope throughout; hierarchy by weight and color, not size jumps; tight tracking.
- Press feedback is `scale(0.95)`; no decorative motion.

## Rules for Phase 2 components

- One dark card per screen at most. It marks "what matters now," and loses meaning if repeated.
- Touch targets 44 px minimum; the bottom bar and sheet buttons are 48 px or taller.
- Open gaps are always bookable in place; never make the owner leave the timeline to book.
- Status is a badge, never a color alone. Payment state (phase 5) will be a second badge, not a
  change to the appointment card's color.
- Copy in sentence case, verb-first buttons ("Book Maya", "Check in"), no all-caps labels.

## Rejected

Direction B (calendar grid first, stepper booking, tabbed client page). Better for a salon with
several technicians, where columns need comparing; wrong default for one person with one column.
Its grid returns as the Week view on desktop when multi-employee businesses are supported.
