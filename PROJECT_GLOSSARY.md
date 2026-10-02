# Citi Cabana Project Glossary

This is a cross-stack study list ranked by **leverage**: ideas near the top help you understand many other concepts. The ranking is global, not split into separate HTML, JavaScript, Express, and database glossaries. Category tags show where each idea applies; the code anchor shows where it appears in this project.

## How to study this list

- Learn one tier at a time. First explain the term in your own words; then point to its project example.
- After each tier, close the document and draw the flow from memory. Retrieval practice reveals gaps better than rereading alone.
- Interleave technologies: follow one feature from HTML to browser JavaScript to API to SQL, rather than memorizing all of one language first.
- Review difficult items after roughly 1 day, 3 days, and 1 week. Keep a short “can explain / need to revisit” mark beside each item.
- For panel questions, answer in this order: definition, why this project uses it, where it lives, and what happens if it fails.

## Tier 1: Understand the whole system first

1. **End-to-end data flow** `[Architecture]` — How information moves from a user action through the browser, API, and database and back. Example: booking form → `POST /api/bookings` → PostgreSQL insert → success message. Anchor: `index.html`, `js/booking.js`, `server/api.js`.
2. **System boundary** `[Architecture/Security]` — Which program owns which responsibility. The browser displays and collects; Express validates and authorizes; PostgreSQL stores durable records. Anchor: `server/server.js`.
3. **Client and server** `[Web]` — The client is the program requesting work (the browser); the server receives requests and responds (Express). They are separate programs, even on one computer.
4. **Frontend, application layer, database layer** `[Architecture]` — The frontend is the user interface; the application layer contains request-handling/business rules; the database layer stores structured data. Anchor: `index.html`, `server/api.js`, `server/schema.sql`.
5. **Source of truth** `[Architecture/Data]` — The authoritative place a value is stored. PostgreSQL is the durable source for CMS content, room inventory, bookings, and room status; rendered HTML is only a view of it.
6. **Persistence** `[Data]` — Data surviving page reloads or process restarts. Browser variables disappear; PostgreSQL rows remain. Uploaded images persist as files under `server/uploads/`.
7. **Trust boundary** `[Security]` — A point where outside input enters code you control. Every form, URL parameter, uploaded file, and API request is untrusted, even when sent from your own webpage. Anchor: API validation in `server/api.js`.
8. **Request/response cycle** `[Web]` — A client sends a request; a server returns a status and usually data. The browser does not execute SQL itself.
9. **API** `[Architecture]` — A defined way for one program to ask another for work. This app’s browser-to-server API is JSON over HTTP under `/api`.
10. **End-to-end feature tracing** `[Problem Solving]` — Following one behavior across every layer. Trace a CMS save from its button to JavaScript, route, SQL, table, response, and refreshed page.

## Tier 2: Web and browser foundations

11. **URL and path** `[Web]` — A URL identifies where to send a request; a path identifies the resource/action, such as `/api/public-content` or `/admin/cms.html`.
12. **HTTP method** `[Web/API]` — The request’s intended action: `GET` reads, `POST` creates/submits, `PUT` replaces/saves a resource, `PATCH` changes selected fields, and `DELETE` removes it. Anchor: route definitions in `server/api.js`.
13. **HTTP status code** `[Web/API]` — A compact result category: `200` success, `201` created, `204` success with no body, `400` invalid request, `401` not signed in, `404` missing record, `409` conflict, `500` server failure.
14. **JSON** `[Web/API]` — A text format for objects and arrays sent between browser and server. Example: `{ "guestName": "...", "roomId": "standard" }`.
15. **Same origin** `[Web/Security]` — The same protocol, host, and port. Vite proxies `/api` to Express so the browser sees one origin; this avoids needing cross-origin permission (CORS) for local development.
16. **HTML document** `[HTML]` — The page structure the browser parses into a DOM. `index.html` is the public page; each `admin/*.html` file is a separate admin page.
17. **DOM (Document Object Model)** `[Browser]` — The browser’s in-memory tree of HTML elements. JavaScript finds and updates elements through `document` methods such as `getElementById` and `querySelector`.
18. **Element, attribute, and content** `[HTML]` — An element is a page node such as `<button>`; attributes configure it (`id`, `href`, `required`); text or child elements provide content.
19. **Semantic HTML** `[HTML/Accessibility]` — Choosing elements for their meaning, such as `<nav>`, `<main>`, `<form>`, `<label>`, and `<button>`, rather than using generic containers for everything.
20. **Form and native validation** `[HTML/Browser]` — A form groups inputs; attributes such as `required`, `type="email"`, `min`, and `type="date"` enable built-in browser checks before submission.
21. **CSS selector** `[CSS]` — A pattern targeting elements to style, such as `.admin-content`, `#rooms-container`, or `button[type="submit"]`.
22. **Cascade and specificity** `[CSS]` — Rules can conflict; the cascade resolves them using origin, importance, specificity, and order. A later/more-specific rule may override an earlier one.
23. **Box model** `[CSS]` — An element’s content, padding, border, and margin determine its occupied size. `box-sizing: border-box` makes declared dimensions include padding and border.
24. **Layout: Flexbox and Grid** `[CSS]` — Flexbox arranges items along one axis; Grid arranges rows and columns. The project uses both for admin layouts, cards, and responsive fields.
25. **Responsive design** `[CSS]` — Layout adapting to available viewport size using flexible dimensions, wrapping, and media queries rather than assuming one screen width.
26. **Accessibility name and alternative text** `[HTML/Accessibility]` — An accessible name identifies a control to assistive technology; `alt` describes meaningful images. The CMS can edit several public `aria-label` and gallery-alt values.

## Tier 3: JavaScript and runtime concepts

27. **JavaScript value** `[JavaScript]` — A piece of data such as a string, number, boolean, object, array, or `null`. Forms initially provide strings; code converts values like price and inventory to numbers.
28. **Variable and scope** `[JavaScript]` — A named binding to a value. `const` cannot be reassigned; `let` can. Scope determines where that name is available.
29. **Object and array** `[JavaScript/Data]` — An object groups named values; an array is an ordered list. API responses commonly contain objects such as `content` and arrays such as `rooms`.
30. **Function** `[JavaScript]` — Reusable instructions that can accept inputs and return a result. Examples: `loadDashboard()`, `syncPhysicalRooms()`, and `calculateOrderSummary()`.
31. **Callback and event handler** `[JavaScript/Browser]` — A function passed to another function so it can run later. A form’s `submit` handler runs when the visitor submits that form.
32. **Event-driven programming** `[JavaScript/Browser]` — Code responding to events such as page load, click, input, or form submit. Anchor: `DOMContentLoaded` listeners and button listeners in the `js/` files.
33. **DOM query and update** `[JavaScript/Browser]` — Find a DOM element, then update its text, attribute, class, or children. Prefer `textContent` for plain text; use `innerHTML` only when constructing markup safely.
34. **`preventDefault()`** `[JavaScript/Forms]` — Stops a browser’s built-in action (such as navigating on form submission) so JavaScript can send the request and update the page instead.
35. **Promise** `[JavaScript/Async]` — An object representing a result that may arrive later, such as an HTTP or database response.
36. **`async` / `await`** `[JavaScript/Async]` — Syntax for writing promise-based work in a readable sequence. `await fetch(...)` pauses that function until the response arrives; it does not block the whole server.
37. **Error handling: `try/catch/finally`** `[JavaScript/Reliability]` — `try` runs risky work, `catch` handles a failure, and `finally` runs cleanup such as re-enabling a submit button.
38. **Browser JavaScript versus Node.js** `[Runtime]` — Browser JavaScript has page APIs such as `document`; Node.js runs JavaScript outside the browser and has server/file/process APIs. `server/*.js` runs in Node; `js/*.js` runs in the browser.
39. **Module system: ES modules** `[JavaScript/Node]` — `import` and `export` share code between files. This project sets `"type": "module"` for Node; browser scripts are currently classic `<script>` tags loaded in a deliberate order.
40. **Global browser scope and script order** `[JavaScript/Browser]` — Classic scripts share top-level declarations; later scripts can call functions from earlier scripts. `index.html` loads `rooms-data.js` before `main.js` and `booking.js`.
41. **Text versus markup** `[Security/JavaScript]` — `textContent` inserts literal text; `innerHTML` parses strings as HTML. Untrusted CMS/user input inserted as HTML can cause cross-site scripting (XSS); this app escapes dynamic markup and uses text nodes where practical.

## Tier 4: Toolchain and local execution

42. **Node.js** `[Runtime]` — The JavaScript runtime that executes the Express server from a terminal.
43. **npm** `[Tooling]` — The package manager that installs libraries and runs scripts in `package.json`.
44. **Package manifest** `[Tooling]` — `package.json` lists scripts, package dependencies, and project metadata; `package-lock.json` records the resolved install versions.
45. **Dependency versus devDependency** `[Tooling]` — A runtime dependency is needed by the app; a development dependency supports local development/build/type checking. `express` and `pg` are runtime dependencies.
46. **Package script** `[Tooling]` — A named command in `package.json`. Here `npm run server`, `npm run dev`, and `npm run build` start Express, start Vite, and build static output.
47. **Environment variable** `[Configuration/Security]` — A process setting supplied outside source code. `.env` holds local PostgreSQL credentials and session configuration; it is ignored by Git.
48. **Vite development server** `[Tooling/Web]` — Serves source files locally, supports browser reloads, and applies the configured API proxy. It is not the database or Express server.
49. **Development proxy** `[Networking]` — A forwarding rule: the browser requests `/api/...` from port 3000 and Vite forwards it to Express on 3001. `/uploads/...` is forwarded similarly.
50. **Multi-page build** `[Build]` — Vite is configured with `index.html` and each admin HTML file as separate build inputs, so all these pages are emitted into `dist/`.
51. **Build versus runtime** `[Tooling]` — Build-time checks/package assets into output; runtime is when the website and server actually execute. A successful frontend build does not by itself prove PostgreSQL is running.
52. **Static asset** `[Web/Files]` — A file served without database computation, such as CSS or `public/images/hero.jpg`. Vite exposes files in `public/` from the site root.

## Tier 5: Express and API concepts

53. **Express application** `[Express]` — The server object created by `express()`; routes and middleware are attached to it. Anchor: `server/server.js`.
54. **Route** `[Express/API]` — A method plus path that selects behavior, such as `router.post('/bookings', handler)`.
55. **Route parameter** `[Express/API]` — A variable portion of a URL such as `:id`; Express exposes it as `request.params.id`.
56. **Query parameter** `[HTTP/API]` — Optional URL data after `?`, often used to filter. Example: `/api/admin/bookings?status=Pending&type=room` becomes `request.query`.
57. **Request object** `[Express]` — `request` contains method, path, body, query, route parameters, headers, cookies/session, and other incoming data.
58. **Response object** `[Express]` — `response` sends status codes, JSON, files, headers, or an empty response back to the browser.
59. **Middleware** `[Express]` — A function that runs in the request path before or after a route. `express.json()` parses JSON bodies; session middleware loads the admin session; `requireAdmin` protects write/read routes.
60. **`next()`** `[Express]` — Passes control to the next middleware or to error handling. A middleware that neither responds nor calls `next()` leaves the request waiting.
61. **JSON body parsing** `[Express]` — `express.json()` turns a request’s JSON text into `request.body`. Without it, submitted form JSON is not conveniently available as an object.
62. **Route handler** `[Express]` — The function that performs the selected endpoint’s work: validate input, call SQL, and return JSON/status.
63. **Async error wrapper** `[Express/Reliability]` — `asyncRoute()` connects rejected promises to Express’s error handler; without this pattern, async errors may not reach centralized handling in Express 4.
64. **API contract** `[Architecture/API]` — The agreed request/response shape. Example: a room booking sends `guestName`, `contact`, `roomId`, `checkIn`, and `checkOut`; the server returns the saved row.
65. **REST-style API** `[Architecture/API]` — An API organized around resources and HTTP methods. This project uses resource-like paths (`/bookings`, `/admin/rooms/:id`) and JSON; “REST-style” describes the convention, not a claim of strict REST compliance.
66. **Fetch** `[Browser/API]` — The browser function for making HTTP requests. It returns a promise; code must check `response.ok` because an HTTP 400/500 does not automatically reject the promise.
67. **Content type** `[HTTP/API]` — A header describing body format. JSON requests use `application/json`; image uploads use browser `FormData` and a multipart content type.
68. **Status/error mapping** `[API/Reliability]` — The API tells the caller what happened through a status code and JSON error. The UI can then show validation, authentication, or conflict messages.

## Tier 6: PostgreSQL and data modeling

69. **Database** `[Data]` — A managed collection of structured data. Here PostgreSQL runs locally and persists records when Express restarts.
70. **SQL** `[Data]` — The language used to define tables and query/change rows. It is sent by the Express server, not by browser code.
71. **Relational database** `[Data]` — Data is stored in related tables; keys connect records. `rooms`, `bookings`, and `physical_rooms` are related rather than one giant file.
72. **Table, row, column** `[Data]` — A table is a kind of record; each row is one record; each column is one property. Example: each `bookings` row is one reservation.
73. **Schema** `[Data]` — The database structure: tables, column types, constraints, and relationships. `server/schema.sql` is the source for this project’s schema.
74. **Primary key** `[Data]` — A unique identifier for a row. Room IDs are text keys such as `standard`; generated IDs use PostgreSQL identity columns.
75. **Foreign key** `[Data/Integrity]` — A column reference that requires a related row. `physical_rooms.room_id` points to `rooms.id`; `bookings.room_id` also points to a room type.
76. **Referential action** `[Data/Integrity]` — What happens to related rows when a referenced row is deleted. Physical statuses cascade-delete with a room; bookings keep their history but have `room_id` set to null.
77. **Unique constraint/index** `[Data/Integrity/Performance]` — Prevents duplicate values and can speed lookups. `(room_id, unit_number)` prevents two copies of the same physical unit.
78. **Check constraint** `[Data/Integrity]` — A database rule rejecting invalid values. Examples: nonnegative rate, allowed booking/status values, and checkout after check-in.
79. **Data type** `[Data]` — Defines what a column can store and how it behaves. Examples: `date`, `timestamptz`, `numeric`, `integer`, `text`, and `jsonb`.
80. **Identity column** `[PostgreSQL]` — A database-generated numeric identifier, such as `gallery_images.id` or `bookings.id`.
81. **CRUD** `[Data/API]` — Create, Read, Update, Delete. SQL `INSERT`, `SELECT`, `UPDATE`, and `DELETE` implement it; CMS routes expose these operations.
82. **Filtering and ordering** `[SQL]` — `WHERE` selects rows matching a condition; `ORDER BY` controls result order. Booking filters use status/type; gallery uses `sort_order`.
83. **Join** `[SQL]` — Combines related rows from multiple tables. Room-status responses join `physical_rooms` to `rooms` to show each unit with its room type.
84. **Aggregate** `[SQL]` — Calculates a result over many rows using functions such as `count` and `sum`. The dashboard and reports use aggregates.
85. **Filtered aggregate** `[PostgreSQL]` — An aggregate with a per-result condition, such as `count(*) FILTER (WHERE status = 'Ready')`.
86. **JSONB** `[PostgreSQL/Data Modeling]` — PostgreSQL’s queryable JSON type. `site_content` uses one JSON object so the CMS can manage many text fields without a separate column for each label.
87. **Connection pool** `[Node/PostgreSQL]` — A reusable set of database connections. `pg.Pool` avoids opening a brand-new database connection for every API request.
88. **Parameterized query** `[SQL Security]` — SQL uses placeholders like `$1` with values supplied separately. This avoids treating user text as executable SQL and helps prevent SQL injection.
89. **Transaction** `[PostgreSQL/Reliability]` — Several database operations committed together (`BEGIN`/`COMMIT`) or undone together (`ROLLBACK`). Booking confirmation uses a transaction while checking inventory.
90. **Row lock** `[PostgreSQL/Concurrency]` — A lock such as `SELECT ... FOR UPDATE` that prevents competing operations from changing a row during a critical decision.
91. **Date, time, and timezone** `[Data/Domain]` — `date` represents a calendar day; `timestamptz` represents an instant with timezone semantics. Dashboard “today” is evaluated by PostgreSQL’s `CURRENT_DATE`.
92. **Date range and overlap** `[PostgreSQL/Booking Rules]` — A half-open date range includes check-in and excludes checkout. PostgreSQL `daterange(..., '[)')` lets the API detect conflicting room bookings.

## Tier 7: Data lifecycle and business rules

93. **Migration** `[Database Operations]` — A repeatable change to database structure/data so an existing database can adopt new code. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` safely adds room-status relationship fields.
94. **Idempotence** `[Reliability]` — Repeating an operation has the same intended effect as running it once. Schema application, default seeding, and inventory reconciliation are designed to be repeatable.
95. **Seed data** `[Development/Data]` — Initial records that make an empty database usable. Defaults include page content, rooms, gallery photos, and physical-room statuses.
96. **Backfill** `[Database Operations]` — Filling a newly added column for old records. Existing static room-status labels are matched to CMS rooms when `room_id` is added.
97. **Inventory versus physical status** `[Domain/Data]` — Inventory says how many units of a room type exist; each physical unit separately has an operational state such as Ready or Occupied.
98. **Room-type versus physical-room record** `[Domain/Data]` — `rooms` describes a sellable category (Standard, Villa); `physical_rooms` describes one actual unit within that category.
99. **Booking state** `[Domain]` — A booking moves among `Pending`, `Confirmed`, `CheckedIn`, `Completed`, or `Cancelled`; the state controls admin actions and what counts in activity reports.
100.  **Business rule** `[Domain]` — A condition imposed by the application, not just by syntax. Examples: check-out follows check-in; confirming a booking checks remaining inventory.
101.  **Availability versus request** `[Domain]` — A public form submission is a pending request, not a guaranteed reservation. Confirmation is a separate admin action that performs the inventory check.
102.  **Report semantics** `[Domain/SQL]` — The report counts confirmed bookings and sums downpayments over a selected creation-date range; understanding which statuses/dates are included is part of understanding the result.
103.  **Reconciliation** `[Data/Domain]` — Comparing desired state with stored state and applying only necessary changes. `syncPhysicalRooms()` makes active physical units agree with room inventory while preserving their statuses.

## Tier 8: CMS, files, and interface safety

104. **CMS (content management system)** `[Product/Architecture]` — Admin tools for editing site content without changing source code. This CMS writes validated content/room/gallery records through protected API routes.
105. **Allowlist** `[Validation/Security]` — The explicit set of values a request may change. `defaultContent` acts as the public-copy key allowlist for `PUT /admin/content`.
106. **DOM data hook** `[HTML/JavaScript]` — A marker such as `data-content="heroTitle"` connecting a visible element to a stored content key.
107. **File upload versus database row** `[Files/Data]` — Image bytes are stored as local files; the database stores the image path and alt text, not the binary itself.
108. **Multipart form data** `[Browser/HTTP]` — The format browsers use to send files. `FormData` and Multer carry the image to `/api/admin/upload`.
109. **Multer limits and file checks** `[Express/Security]` — Server-side rules restricting upload size and type. This project limits file size and accepts image MIME types.
110. **UUID filename** `[Files/Security]` — A random unique filename that avoids collisions and does not trust the uploaded name for the storage path.
111. **Static file serving** `[Web/Files]` — Returning a file by URL. Vite serves `public/images`; Express serves uploaded files at `/uploads/...`.
112. **Image URL versus filesystem path** `[Web/Files]` — The browser stores a web path such as `/uploads/<id>.jpg`; the server maps that URL to a local file.
113. **XSS (cross-site scripting)** `[Web Security]` — Attacker-controlled text executed as page markup/script. Dynamic CMS text is assigned through `textContent` or escaped before HTML interpolation.
114. **Accessibility** `[Frontend]` — Making controls and content understandable without relying only on sight or pointer input. Labels, accessible names, and gallery alt text are exposed in the CMS.
115. **Progressive enhancement and fallback data** `[Frontend/Reliability]` — A fallback lets some content render if the API is unavailable, but successful database loading is the normal path. Anchor: fallback arrays in `js/rooms-data.js`.

## Tier 9: Authentication, failures, and verification

116. **Authentication versus authorization** `[Security]` — Authentication establishes who signed in; authorization decides what that user may do. `requireAdmin` checks the server-side admin session before admin routes.
117. **Password hashing versus encryption** `[Security]` — Hashing is one-way verification, not reversible storage. `bcryptjs` hashes the admin password; the original password is not stored.
118. **Session** `[Web/Security]` — Server-side sign-in state associated with a browser cookie. Admin requests reuse the cookie; the server reads the session and identifies the admin.
119. **Cookie flags** `[Web/Security]` — `HttpOnly` prevents page scripts from reading the session cookie; `SameSite` limits cross-site sending; `Secure` is required when serving cookies over HTTPS. Current configuration is explicitly local-development-only.
120. **In-memory session store** `[Operations]` — Session data kept in the running Node process. Restarting Express logs admins out; this store is not appropriate for a multi-process public deployment.
121. **Secret management** `[Security/Operations]` — Keeping passwords and signing secrets in ignored environment files, not source control or frontend bundles.
122. **Validation at the server** `[Security/Reliability]` — Browser validation helps usability, but Express must repeat checks because requests can bypass the page entirely.
123. **Error logging versus user response** `[Reliability/Security]` — Logs help developers diagnose failures; public responses should avoid revealing SQL, passwords, or internal stack traces.
124. **Testing pyramid (for this project)** `[Testing]` — Syntax/build checks are cheap; API/database checks cover integration; browser workflows confirm real user paths. The project was checked at all three levels during migration.
125. **Smoke test** `[Testing]` — A small temporary operation proving a major path works, such as saving CMS content or changing inventory. Test records/files must be removed afterward.
126. **Regression test** `[Testing]` — A check ensuring an existing feature still works after changes, such as booking submission after replacing Firestore.
127. **Browser end-to-end test** `[Testing]` — A real page/form workflow exercised through the UI and its API/database effects, such as form submit → row stored → confirmation visible.
128. **Build warning versus build failure** `[Tooling]` — A warning reports a concern without stopping output; Vite currently warns about classic script tags not being bundled as ES modules, while the build still succeeds.
129. **Git ignore** `[Workflow/Security]` — `.gitignore` excludes generated/private material such as `.env`, `node_modules`, build output, and uploaded user images.
130. **Legacy artifact** `[Maintenance]` — A file that remains from an old implementation but is no longer used at runtime. `firestore.rules` and `storage.rules` are retained but the app pages no longer load Firebase.

## Fast review for panel questions

For any feature, be ready to answer these in order:

1. What starts the feature, and which browser file handles it?
2. What HTTP method/path does the browser call, and what JSON fields go over the wire?
3. Which Express route receives it, what validation/security checks happen, and what status code returns?
4. Which SQL table/columns are read or changed, and what key/constraint protects the data?
5. What does the user see on success and on failure?
6. How did you verify the complete chain?

If you can trace one public booking, one CMS edit, and one room-inventory change through those six questions without looking at the code, you understand the project’s main dependency chain.
