# Citi Cabana Local App

The app runs locally as two processes: Vite serves the website, and Express serves the API. Express connects to the local PostgreSQL database. Firebase is no longer used by the application pages.

## First-time setup

1. Install Node.js and PostgreSQL.
2. In pgAdmin, create a database named `citicabana`.
3. Copy `.env.example` to `.env` and put your local PostgreSQL password in `PGPASSWORD`. Keep `.env` private; Git ignores it.
4. From the project folder, run `npm install`.
5. Start PostgreSQL if it is not already running.

## Run the app

Open two terminals in the project folder.

In the first terminal:

```powershell
npm run server
```

In the second terminal:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`. The first visit to `http://127.0.0.1:3000/admin/login.html` offers one-time creation of the local administrator account. Use a unique password of at least 10 characters.

The API creates its tables and seeds default site content, rooms, gallery entries, and physical rooms when the server starts. Existing content is preserved. Public text and images can be edited at `/admin/cms.html`; uploaded images are stored in `server/uploads/`.

## Local data

- PostgreSQL stores website content, rooms, gallery entries, admin password hashes, room status, and bookings.
- `.env` stores local database credentials and is not committed.
- CMS image uploads are stored on disk under `server/uploads/` and are not committed.
- Default site photos are in `public/images/` and need no external image service.

This configuration is for local development. The session store uses process memory, and the server listens only on loopback. It is not configured for public internet deployment. Existing Firebase-hosted content and admin accounts are not automatically imported; the server starts with the bundled defaults and the first-admin setup flow.
