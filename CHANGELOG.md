# Changelog

## Unreleased

### Local application and database

- Replaced the app's runtime Firebase dependencies with a local Express API backed by PostgreSQL.
- Kept Vite as the frontend server and configured local `/api` and `/uploads` proxies. Both servers bind to `127.0.0.1` for local development.
- Added PostgreSQL tables for public site content, rooms, gallery images, bookings, physical room units, and admin accounts. Server startup applies the schema and seeds defaults without overwriting existing content.
- Added parameterized SQL operations for content, rooms, gallery items, bookings, reports, and room status.
- Added `.env.example`; `.env` remains ignored by Git. User-uploaded images under `server/uploads/` are also ignored.
- Added `npm run server` and documented local setup and startup in `README.md`.

### Public website and CMS

- Moved public website text, labels, links, policy copy, hero/event backgrounds, and booking-form copy into editable PostgreSQL content.
- Added local default images under `public/images/` and removed runtime Google Fonts and Unsplash requests.
- Replaced the public site's Firestore data loader with the local API. Room cards, event copy, gallery items, image alt text, and booking summaries now use database data.
- Added a local CMS for public text and image settings, room create/edit/delete, gallery upload/delete, gallery ordering, and alternative text.
- Added authenticated local image uploads served from the local Express server.

### Admin and booking workflows

- Replaced Firebase Auth with a local admin setup/sign-in flow, hashed passwords, and server-side sessions. The first admin can be created once from the admin login page.
- Migrated public room and event reservation forms to the local bookings API.
- Migrated admin booking lists, manual bookings, booking details/status changes, dashboard summaries, reports, and room-status actions to the API.
- Added dashboard arrival/departure lists for confirmed or checked-in bookings scheduled today. Each entry links to its booking detail page.
- Added live room-status totals to the dashboard.

### Inventory-linked room status

- Added a room-type relationship, unit number, and active flag to physical room status records, including an idempotent migration for existing local rows.
- Replaced the fixed physical-room seed list with reconciliation from each CMS room's inventory. Increasing inventory creates status units; decreasing inventory hides surplus units without resetting statuses; increasing it later reactivates them.
- Room deletion removes its associated physical status units through the database relationship.

### Firebase removal and local assets

- Removed Firebase SDK/configuration scripts from the application pages and deleted the unused Firebase client scripts.
- Kept the existing Firebase rules files in the repository; they are not used by the local app. The pre-existing user modification to `storage.rules` was preserved.
- Existing Firebase-hosted content and admin accounts are not automatically imported. The local database starts from the bundled defaults; the local admin account is managed separately.

### Verification

- `npm run build` passes. Vite still prints non-fatal notices that the existing classic script tags are not bundled as ES modules.
- Verified public room/event booking submissions, admin confirmation and downpayment logging, reports, local uploads, CMS content save/restore, room/gallery CRUD, and room-status changes in the browser.
- Verified a CMS room inventory change from 1 to 3 creates three active status units, then reducing it to 1 leaves one active unit and preserves that unit's `Occupied` status.
- Verified the dashboard displays same-day arrival/departure bookings and live room-status counts.
- Removed temporary smoke-test bookings, rooms, uploads, and test admin accounts after verification.
