# Dashboard update 7: usual service and nail photos

Push updates 1 to 6 first. This folder builds on them (some files here replace their versions).

BEFORE pushing, create the photo buckets, or the staging deploy will fail:
1. Cloudflare dashboard → R2 Object Storage (turn it on if asked; the free tier covers 10 GB).
2. Create bucket → name k3-photos-staging → Create.
3. Create bucket → name k3-photos-production → Create.
The API token GitHub uses ("Edit Cloudflare Workers") already covers R2 bindings.

Then copy everything in this folder over the root of your k3-dashboard repo (same paths), run

    npm test
    npm run typecheck

and push to main. The deploy runs migration 0011_visit_photos (one new table).

New
- drizzle/0011_visit_photos.sql, drizzle/meta/0011_snapshot.json
- server/db/schema/photos.ts
- server/photos/store.ts
- server/domain/photos/service.ts
- app/routes/app/photo.tsx
- app/components/visit-photos.tsx
- tests/domain/usual-photos.test.ts

Changed
- drizzle/meta/_journal.json, wrangler.jsonc (R2 buckets), server/env.ts
- server/db/schema/index.ts, server/domain/customers/service.ts
- app/routes.ts
- app/routes/app/client.tsx, book.tsx, appointment.tsx, today.tsx, calendar.tsx
- app/lib/appointment-panel.server.ts, app/components/appointment-panel.tsx
- tests/domain/client-info.test.ts (delete now also reports photo files)
- docs/STATUS.md (replaces yours)

Check on staging: set a usual service on a client and start a booking for them; mark a visit done
and add a photo from your phone in the appointment panel and from the client's History; open it
full size; delete it.
