import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import multer from "multer";
import { defaultContent } from "./default-content.js";
import { syncPhysicalRooms } from "./database.js";

const uploadDirectory = fileURLToPath(new URL("./uploads/", import.meta.url));
mkdirSync(uploadDirectory, { recursive: true });

const bookingColumns = `
  id, type, status, guest_name AS "guestName", contact, notes,
  room_id AS "roomId", room_name AS "roomType",
  to_char(check_in, 'YYYY-MM-DD') AS "checkIn",
  to_char(check_out, 'YYYY-MM-DD') AS "checkOut", pax,
  event_type AS "eventType",
  to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
  guest_count AS "guestCount", time_block AS "timeBlock",
  downpayment_amount AS "downpaymentAmount",
  downpayment_method AS "downpaymentMethod", created_at AS "createdAt"`;

const asyncRoute = (handler) => (request, response, next) =>
  Promise.resolve(handler(request, response, next)).catch(next);

function requireAdmin(request, response, next) {
  if (!request.session.admin) {
    return response.status(401).json({ error: "Admin sign-in required" });
  }
  next();
}

function validText(value, maxLength = 5000) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => {
      callback(
        null,
        `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`,
      );
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith("image/")) callback(null, true);
    else callback(new Error("Only image files can be uploaded"));
  },
});

export function registerApi(app, pool) {
  app.use(
    session({
      name: "citicabana.sid",
      secret:
        process.env.SESSION_SECRET ||
        "local-citicabana-session-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.use("/uploads", express.static(uploadDirectory, { fallthrough: false }));

  const router = express.Router();

  router.get(
    "/public-content",
    asyncRoute(async (_request, response) => {
      const [contentResult, roomResult, galleryResult] = await Promise.all([
        pool.query(
          "SELECT content_value FROM site_content WHERE content_key = 'public'",
        ),
        pool.query(
          "SELECT id, name, capacity, rate, inclusions, inventory, image FROM rooms ORDER BY sort_order, name",
        ),
        pool.query(
          "SELECT id, url, alt_text AS alt, sort_order FROM gallery_images ORDER BY sort_order, id",
        ),
      ]);

      response.json({
        content: { ...defaultContent, ...contentResult.rows[0]?.content_value },
        rooms: roomResult.rows,
        gallery: galleryResult.rows,
      });
    }),
  );

  router.get(
    "/admin/setup-status",
    asyncRoute(async (_request, response) => {
      const result = await pool.query(
        "SELECT EXISTS (SELECT 1 FROM admins) AS configured",
      );
      response.json({ configured: result.rows[0].configured });
    }),
  );

  router.post(
    "/admin/setup",
    asyncRoute(async (request, response) => {
      const email =
        typeof request.body.email === "string"
          ? request.body.email.trim().toLowerCase()
          : "";
      const password = request.body.password;
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== "string" ||
        password.length < 10
      ) {
        return response.status(400).json({
          error: "Enter a valid email and a password of at least 10 characters",
        });
      }

      const client = await pool.connect();
      let admin;
      try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE admins IN EXCLUSIVE MODE");
        const existing = await client.query("SELECT id FROM admins LIMIT 1");
        if (existing.rowCount) {
          await client.query("ROLLBACK");
          return response
            .status(409)
            .json({ error: "An administrator has already been created" });
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await client.query(
          "INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id, email",
          [email, passwordHash],
        );
        admin = result.rows[0];
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") {
          return response
            .status(409)
            .json({ error: "That email is already registered" });
        }
        throw error;
      } finally {
        client.release();
      }

      await new Promise((resolve, reject) => {
        request.session.regenerate((error) =>
          error ? reject(error) : resolve(),
        );
      });
      request.session.admin = { id: admin.id, email: admin.email };
      response.status(201).json({ email: admin.email });
    }),
  );

  router.post(
    "/admin/login",
    asyncRoute(async (request, response) => {
      const email =
        typeof request.body.email === "string"
          ? request.body.email.trim().toLowerCase()
          : "";
      const password = request.body.password;
      if (!email || typeof password !== "string") {
        return response
          .status(400)
          .json({ error: "Email and password are required" });
      }

      const result = await pool.query(
        "SELECT id, email, password_hash FROM admins WHERE email = $1",
        [email],
      );
      const admin = result.rows[0];
      if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
        return response
          .status(401)
          .json({ error: "Email or password is incorrect" });
      }

      await new Promise((resolve, reject) => {
        request.session.regenerate((error) =>
          error ? reject(error) : resolve(),
        );
      });
      request.session.admin = { id: admin.id, email: admin.email };
      response.json({ email: admin.email });
    }),
  );

  router.get("/admin/session", (request, response) => {
    response.json({ admin: request.session.admin || null });
  });

  router.post("/admin/logout", requireAdmin, (request, response, next) => {
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie("citicabana.sid").status(204).end();
    });
  });

  router.post(
    "/admin/upload",
    requireAdmin,
    upload.single("image"),
    (request, response) => {
      if (!request.file)
        return response
          .status(400)
          .json({ error: "Choose an image to upload" });
      response.status(201).json({ url: `/uploads/${request.file.filename}` });
    },
  );

  router.put(
    "/admin/content",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const content = request.body;
      const allowedKeys = new Set(Object.keys(defaultContent));
      if (!content || typeof content !== "object" || Array.isArray(content)) {
        return response
          .status(400)
          .json({ error: "Content must be an object" });
      }
      for (const [key, value] of Object.entries(content)) {
        if (
          !allowedKeys.has(key) ||
          typeof value !== "string" ||
          value.length > 5000
        ) {
          return response
            .status(400)
            .json({ error: `Invalid content field: ${key}` });
        }
      }

      await pool.query(
        `INSERT INTO site_content (content_key, content_value)
       VALUES ('public', $1::jsonb)
       ON CONFLICT (content_key) DO UPDATE SET content_value = EXCLUDED.content_value`,
        [JSON.stringify({ ...defaultContent, ...content })],
      );
      response.json({ saved: true });
    }),
  );

  router.get(
    "/admin/rooms",
    requireAdmin,
    asyncRoute(async (_request, response) => {
      const result = await pool.query(
        "SELECT * FROM rooms ORDER BY sort_order, name",
      );
      response.json(result.rows);
    }),
  );

  router.post(
    "/admin/rooms",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const room = request.body;
      const id = validText(room.id, 80)
        ? slugify(room.id)
        : slugify(room.name || "");
      const rate = Number(room.rate);
      const inventory = Number(room.inventory);
      if (
        !validText(room.name, 120) ||
        !validText(room.capacity, 120) ||
        !validText(room.image, 1000) ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        !Number.isInteger(inventory) ||
        inventory < 1
      ) {
        return response.status(400).json({
          error:
            "Enter a name, capacity, image, non-negative rate, and positive inventory",
        });
      }

      const result = await pool.query(
        `INSERT INTO rooms (id, name, capacity, rate, inclusions, inventory, image, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE((SELECT max(sort_order) + 1 FROM rooms), 0))
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity,
         rate = EXCLUDED.rate, inclusions = EXCLUDED.inclusions, inventory = EXCLUDED.inventory,
         image = EXCLUDED.image
       RETURNING *`,
        [
          id,
          room.name.trim(),
          room.capacity.trim(),
          rate,
          room.inclusions || "",
          inventory,
          room.image,
        ],
      );
      await syncPhysicalRooms(pool, id);
      response.status(201).json(result.rows[0]);
    }),
  );

  router.delete(
    "/admin/rooms/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        "DELETE FROM rooms WHERE id = $1 RETURNING id",
        [request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Room not found" });
      response.status(204).end();
    }),
  );

  router.get(
    "/admin/gallery",
    requireAdmin,
    asyncRoute(async (_request, response) => {
      const result = await pool.query(
        "SELECT id, url, alt_text AS alt, sort_order FROM gallery_images ORDER BY sort_order, id",
      );
      response.json(result.rows);
    }),
  );

  router.post(
    "/admin/gallery",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const { url, alt = "", sort_order: sortOrder = 0 } = request.body;
      if (!validText(url, 1000) || !Number.isInteger(Number(sortOrder))) {
        return response
          .status(400)
          .json({ error: "A valid image URL and sort order are required" });
      }
      const result = await pool.query(
        "INSERT INTO gallery_images (url, alt_text, sort_order) VALUES ($1, $2, $3) RETURNING id, url, alt_text AS alt, sort_order",
        [url, alt, Number(sortOrder)],
      );
      response.status(201).json(result.rows[0]);
    }),
  );

  router.patch(
    "/admin/gallery/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const sortOrder =
        request.body.sort_order == null
          ? null
          : Number(request.body.sort_order);
      const alt =
        request.body.alt == null
          ? null
          : String(request.body.alt).slice(0, 300);
      if (sortOrder !== null && !Number.isInteger(sortOrder))
        return response
          .status(400)
          .json({ error: "Sort order must be a whole number" });
      const result = await pool.query(
        "UPDATE gallery_images SET sort_order = COALESCE($1, sort_order), alt_text = COALESCE($2, alt_text) WHERE id = $3 RETURNING id, url, alt_text AS alt, sort_order",
        [sortOrder, alt, request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Image not found" });
      response.json(result.rows[0]);
    }),
  );

  router.delete(
    "/admin/gallery/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        "DELETE FROM gallery_images WHERE id = $1 RETURNING id",
        [request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Image not found" });
      response.status(204).end();
    }),
  );

  router.post(
    "/bookings",
    asyncRoute(async (request, response) => {
      const booking = request.body;
      if (
        !validText(booking.guestName, 160) ||
        !validText(booking.contact, 80)
      ) {
        return response
          .status(400)
          .json({ error: "Name and contact number are required" });
      }

      if (booking.type === "room") {
        const roomResult = await pool.query(
          "SELECT id, name FROM rooms WHERE id = $1 OR name = $1 LIMIT 1",
          [booking.roomId || booking.roomType || ""],
        );
        const room = roomResult.rows[0];
        if (
          !room ||
          !booking.checkIn ||
          !booking.checkOut ||
          booking.checkOut <= booking.checkIn
        ) {
          return response.status(400).json({
            error: "Choose a room and valid check-in/check-out dates",
          });
        }
        const result = await pool.query(
          `INSERT INTO bookings (type, guest_name, contact, notes, room_id, room_name, check_in, check_out, pax)
         VALUES ('room', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${bookingColumns}`,
          [
            booking.guestName.trim(),
            booking.contact.trim(),
            booking.notes || "",
            room.id,
            room.name,
            booking.checkIn,
            booking.checkOut,
            Number(booking.pax) || 1,
          ],
        );
        return response.status(201).json(result.rows[0]);
      }

      if (
        booking.type === "event" &&
        validText(booking.eventType, 80) &&
        booking.eventDate &&
        Number(booking.guestCount) > 0 &&
        validText(booking.timeBlock, 40)
      ) {
        const result = await pool.query(
          `INSERT INTO bookings (type, guest_name, contact, notes, event_type, event_date, guest_count, time_block)
         VALUES ('event', $1, $2, $3, $4, $5, $6, $7) RETURNING ${bookingColumns}`,
          [
            booking.guestName.trim(),
            booking.contact.trim(),
            booking.notes || "",
            booking.eventType,
            booking.eventDate,
            Number(booking.guestCount),
            booking.timeBlock,
          ],
        );
        return response.status(201).json(result.rows[0]);
      }

      response
        .status(400)
        .json({ error: "Booking details are incomplete or invalid" });
    }),
  );

  router.get(
    "/admin/bookings",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const values = [];
      const conditions = [];
      if (request.query.status && request.query.status !== "All") {
        values.push(request.query.status);
        conditions.push(`status = $${values.length}`);
      }
      if (request.query.type && request.query.type !== "All") {
        values.push(request.query.type);
        conditions.push(`type = $${values.length}`);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const result = await pool.query(
        `SELECT ${bookingColumns} FROM bookings ${where} ORDER BY created_at DESC`,
        values,
      );
      response.json(result.rows);
    }),
  );

  router.post(
    "/admin/bookings",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const booking = request.body;
      if (
        !validText(booking.guestName, 160) ||
        !validText(booking.contact, 80)
      ) {
        return response
          .status(400)
          .json({ error: "Name and contact number are required" });
      }
      if (booking.type === "room") {
        const roomResult = await pool.query(
          "SELECT id, name FROM rooms WHERE id = $1 OR name = $1 LIMIT 1",
          [booking.roomId || booking.roomType || ""],
        );
        const room = roomResult.rows[0];
        if (
          !room ||
          !booking.checkIn ||
          !booking.checkOut ||
          booking.checkOut <= booking.checkIn
        ) {
          return response
            .status(400)
            .json({ error: "Choose a room and valid dates" });
        }
        const result = await pool.query(
          `INSERT INTO bookings (type, status, guest_name, contact, room_id, room_name, check_in, check_out, pax)
         VALUES ('room', 'Confirmed', $1, $2, $3, $4, $5, $6, $7) RETURNING ${bookingColumns}`,
          [
            booking.guestName.trim(),
            booking.contact.trim(),
            room.id,
            room.name,
            booking.checkIn,
            booking.checkOut,
            Number(booking.pax) || 1,
          ],
        );
        return response.status(201).json(result.rows[0]);
      }
      if (
        booking.type === "event" &&
        validText(booking.eventType, 80) &&
        booking.eventDate
      ) {
        const result = await pool.query(
          `INSERT INTO bookings (type, status, guest_name, contact, event_type, event_date, guest_count)
         VALUES ('event', 'Confirmed', $1, $2, $3, $4, $5) RETURNING ${bookingColumns}`,
          [
            booking.guestName.trim(),
            booking.contact.trim(),
            booking.eventType,
            booking.eventDate,
            Number(booking.guestCount) || 1,
          ],
        );
        return response.status(201).json(result.rows[0]);
      }
      response
        .status(400)
        .json({ error: "Booking details are incomplete or invalid" });
    }),
  );

  router.get(
    "/admin/bookings/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        `SELECT ${bookingColumns} FROM bookings WHERE id = $1`,
        [request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Booking not found" });
      response.json(result.rows[0]);
    }),
  );

  router.patch(
    "/admin/bookings/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const { status, downpaymentAmount, downpaymentMethod } = request.body;
      const allowedStatuses = new Set([
        "Pending",
        "Confirmed",
        "Cancelled",
        "Completed",
        "CheckedIn",
      ]);
      if (!allowedStatuses.has(status))
        return response.status(400).json({ error: "Invalid booking status" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const currentResult = await client.query(
          "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
          [request.params.id],
        );
        const current = currentResult.rows[0];
        if (!current) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Booking not found" });
        }

        if (status === "Confirmed" && current.type === "room") {
          const roomResult = await client.query(
            "SELECT inventory FROM rooms WHERE id = $1 FOR UPDATE",
            [current.room_id],
          );
          const inventory = roomResult.rows[0]?.inventory || 0;
          const overlap = await client.query(
            `SELECT count(*)::int AS count FROM bookings
           WHERE room_id = $1 AND id <> $2 AND status IN ('Confirmed', 'CheckedIn')
             AND daterange(check_in, check_out, '[)') && daterange($3::date, $4::date, '[)')`,
            [current.room_id, current.id, current.check_in, current.check_out],
          );
          if (overlap.rows[0].count >= inventory) {
            await client.query("ROLLBACK");
            return response
              .status(409)
              .json({ error: "No inventory remains for these dates" });
          }
        }

        const result = await client.query(
          `UPDATE bookings SET status = $1,
           downpayment_amount = COALESCE($2, downpayment_amount),
           downpayment_method = COALESCE($3, downpayment_method)
         WHERE id = $4 RETURNING ${bookingColumns}`,
          [
            status,
            downpaymentAmount == null ? null : Number(downpaymentAmount),
            downpaymentMethod || null,
            request.params.id,
          ],
        );
        await client.query("COMMIT");
        response.json(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/admin/dashboard",
    requireAdmin,
    asyncRoute(async (_request, response) => {
      const [summary, arrivals, departures, roomStatus] = await Promise.all([
        pool.query(
          `SELECT count(*) FILTER (WHERE status = 'Pending')::int AS pending,
       count(*) FILTER (WHERE type = 'room' AND check_in = CURRENT_DATE AND status IN ('Confirmed', 'CheckedIn'))::int AS checkins,
       count(*) FILTER (WHERE type = 'room' AND check_out = CURRENT_DATE AND status IN ('Confirmed', 'CheckedIn'))::int AS checkouts
       FROM bookings`,
        ),
        pool.query(
          `SELECT id, guest_name AS "guestName", room_name AS "roomName", status
           FROM bookings
           WHERE type = 'room' AND check_in = CURRENT_DATE
             AND status IN ('Confirmed', 'CheckedIn')
           ORDER BY check_in, guest_name`,
        ),
        pool.query(
          `SELECT id, guest_name AS "guestName", room_name AS "roomName", status
           FROM bookings
           WHERE type = 'room' AND check_out = CURRENT_DATE
             AND status IN ('Confirmed', 'CheckedIn')
           ORDER BY check_out, guest_name`,
        ),
        pool.query(
          `SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'Ready')::int AS ready,
             count(*) FILTER (WHERE status = 'Occupied')::int AS occupied,
             count(*) FILTER (WHERE status = 'Needs Cleaning')::int AS needs_cleaning
           FROM physical_rooms WHERE active = true`,
        ),
      ]);
      response.json({
        ...summary.rows[0],
        arrivals: arrivals.rows,
        departures: departures.rows,
        roomStatus: roomStatus.rows[0],
      });
    }),
  );

  router.get(
    "/admin/reports",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const start = request.query.start;
      const end = request.query.end;
      if (!start || !end)
        return response
          .status(400)
          .json({ error: "Start and end dates are required" });
      const result = await pool.query(
        `SELECT count(*)::int AS total_bookings,
       COALESCE(sum(downpayment_amount), 0)::numeric(10, 2) AS total_downpayments
       FROM bookings WHERE status = 'Confirmed' AND created_at::date BETWEEN $1::date AND $2::date`,
        [start, end],
      );
      response.json(result.rows[0]);
    }),
  );

  router.get(
    "/admin/room-status",
    requireAdmin,
    asyncRoute(async (_request, response) => {
      const result = await pool.query(
        `SELECT physical.id, physical.room_id AS "roomId",
           physical.unit_number AS "unitNumber", physical.room_label AS "roomLabel",
           physical.status, physical.last_updated AS "lastUpdated", room.name AS "roomType"
         FROM physical_rooms AS physical
         JOIN rooms AS room ON room.id = physical.room_id
         WHERE physical.active = true
         ORDER BY room.sort_order, physical.unit_number`,
      );
      response.json(result.rows);
    }),
  );

  router.patch(
    "/admin/room-status/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const allowed = new Set(["Ready", "Occupied", "Needs Cleaning"]);
      if (!allowed.has(request.body.status))
        return response.status(400).json({ error: "Invalid room status" });
      const result = await pool.query(
        `UPDATE physical_rooms SET status = $1, last_updated = now()
       WHERE id = $2 RETURNING id, room_label AS \"roomLabel\", status, last_updated AS \"lastUpdated\"`,
        [request.body.status, request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Room not found" });
      response.json(result.rows[0]);
    }),
  );

  router.use((error, _request, response, _next) => {
    console.error("API request failed:", error);
    if (error instanceof multer.MulterError) {
      return response.status(400).json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "Images must be 10 MB or smaller"
            : error.message,
      });
    }
    response
      .status(500)
      .json({ error: "The server could not complete the request" });
  });

  app.use("/api", router);
}
