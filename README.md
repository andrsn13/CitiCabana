# Citi Cabana Local App

The app runs locally as two processes: Vite serves the website, and Express serves the API. Express connects to the local PostgreSQL database. Firebase is no longer used by the application pages.

## First-time setup

1. Install Node.js and PostgreSQL.
2. In pgAdmin, create a database named `citicabana`.
3. Copy `.env.example` to `.env` in the project folder (next to `package.json`) and replace `PGPASSWORD` with the password for the local PostgreSQL `postgres` user that was set when PostgreSQL was installed. This is the PostgreSQL user's password, not the database name or a password created in the app. Keep `.env` private; Git ignores it.
4. Open a terminal in the folder containing `package.json` (not just the folder where the ZIP was extracted), then run `npm install`. In Windows PowerShell, if script execution policy blocks `npm`, run `npm.cmd install` instead; this calls npm's Command Prompt shim without changing the machine's execution policy. If you are unsure which extracted folder contains the project, run `Get-ChildItem -Path . -Filter package.json -Recurse | Select-Object -ExpandProperty FullName`, then use `cd` to enter the directory containing the listed `package.json`.
5. Start PostgreSQL if it is not already running.
6. Configure the SMTP settings in `.env` to send booking-confirmation email. Without them, booking confirmation still updates its status, but the admin sees that email delivery failed and can retry after configuration.

### If the server reports `password authentication failed` (`28P01`)

The app reads PostgreSQL settings from `.env` in the project folder where `npm.cmd run server` is run. Confirm that this is the same folder as `package.json`, that `.env` exists there (not `.env.example` or `.env.txt`), and that `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` match the local PostgreSQL server. In particular, replace the example `PGPASSWORD` value with the password for that PostgreSQL user. If the password is unknown, reset it in PostgreSQL/pgAdmin and update `.env`; then stop and restart the server. Do not share or commit `.env`.

## Run the app

Open two terminals in the project folder.

In the first terminal:

```powershell
npm.cmd run server
```

In the second terminal:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:3000`. The first visit to `http://127.0.0.1:3000/admin/login.html` offers one-time creation of the local administrator account. Use a unique password of at least 10 characters.

The API creates its tables and seeds default site content, rooms, gallery entries, and physical rooms when the server starts. Existing content is preserved. Public text and images can be edited at `/admin/cms.html`; uploaded images are stored in `server/uploads/`.

## Local data

- PostgreSQL stores website content, room inventory, physical-room housekeeping, maintenance blocks, admin password hashes, and bookings.
- To seed exactly 120 realistic synthetic bookings (96 room stays and 24 events), start the server once so it creates the schema, default rooms, physical rooms, and maintenance-block table, then run `seed-demo-bookings.sql` against the same database configured in `.env`. From PowerShell in the project folder, use `psql -U postgres -d citicabana -f .\seed-demo-bookings.sql`, or open the file in pgAdmin's Query Tool. The script replaces only its clearly marked `demo.guest.NNN@example.com` rows, preserves other bookings and room configuration, and checks unit assignment and room-type capacity before committing.
- To restore the bundled default CMS image selections after testing, run `reset-cms-photos.sql` against the same database. It resets the public hero/event images, default room photos, room-specific photo galleries, main gallery, and hero carousel. It does not remove uploaded files or change booking records, housekeeping, room types, rates, or site text.
- `.env` stores local database and optional SMTP credentials and is not committed.
- CMS image uploads are stored on disk under `server/uploads/` and are not committed.
- Room types can be added, edited, archived, and restored in the CMS. Inventory reductions are blocked when affected units are Dirty or room bookings would exceed the new quantity. Additional per-room photos are managed from the room card and appear in the Villa carousel.
- The Room Status tape chart uses half-open date ranges in the Asia/Manila property timezone. Pending, Confirmed, and CheckedIn bookings hold nights; CheckedOut, Cancelled, Rejected, and NoShow bookings do not. Public availability and admin booking changes use the same server-side overlap and maintenance-block checks inside transactions. A date shown as available on the chart is therefore available through the public availability endpoint as well.
- Housekeeping is independent from occupancy and has only Clean/Dirty values. Checking out automatically marks the assigned physical room Dirty; staff can toggle it from the chart or Housekeeping tab. Dirty rooms remain bookable, with a warning shown when staff checks a guest in. Maintenance blocks are separate date ranges and cannot be placed over a blocking booking.
- A room booking stores its required room type separately from its nullable assigned unit. Pending requests consume room-type capacity but remain in the chart's Unassigned lane; confirming one transactionally assigns the first available unit. Room assignments use the booking's `room_id`; the legacy `physical_room_id` column is migrated away. Events are listed separately and do not block room inventory.
- The Bookings page defaults to Needs action and provides date-based Today, In-house, Upcoming, Past, Cancelled, and All views, live search/filters, 25-row pagination, status actions, and the same booking drawer as the Room Status chart. Its list refreshes periodically so newly submitted public requests appear without a manual reload.
- Existing room statuses migrate from Ready/Occupied to Clean and Needs Cleaning to Dirty. Existing completed bookings migrate to CheckedOut. Existing bookings migrate their room type and unit into separate fields. Missing units on Confirmed or CheckedIn bookings are assigned on startup. If a date-blocking booking cannot be assigned, the server logs the inventory/overlap issue and keeps it as an unassigned capacity hold, visible in the chart and Bookings list.
- Confirmation email delivery uses the configured SMTP server (`SMTP_REPLY_TO` optionally sets the front-desk reply address). A confirmation states the 50% downpayment requirement and directs guests to arrange payment with the front desk; the system does not process or record payments.
- Reports can be generated for a selected booking-created date range and printed to PDF using the browser’s “Save as PDF” option.
- Default site photos are in `public/images/` and need no external image service.

This configuration is for local development. The session store uses process memory, and the server listens only on loopback. It is not configured for public internet deployment. Existing Firebase-hosted content and admin accounts are not automatically imported; the server starts with the bundled defaults and the first-admin setup flow.
