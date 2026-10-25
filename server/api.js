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
import { sendBookingConfirmation } from "./email.js";

const uploadDirectory = fileURLToPath(new URL("./uploads/", import.meta.url));
mkdirSync(uploadDirectory, { recursive: true });

const bookingColumns = `
  id, type, status, guest_name AS "guestName", guest_email AS "guestEmail", contact, notes,
  room_id AS "roomId", room_name AS "roomType",
  physical_room_id AS "physicalRoomId",
  to_char(check_in, 'YYYY-MM-DD') AS "checkIn",
  to_char(check_out, 'YYYY-MM-DD') AS "checkOut", pax,
  event_type AS "eventType",
  to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
  guest_count AS "guestCount", time_block AS "timeBlock",
  created_at AS "createdAt"`;

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

function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

async function getRoomBookingAvailability(
  queryable,
  roomId,
  checkIn,
  checkOut,
  excludedBookingId = null,
) {
  const result = await queryable.query(
    `SELECT COALESCE(max(daily.booked), 0)::int AS booked
     FROM (
       SELECT dates.stay_day::date AS date, count(booking.id)::int AS booked
       FROM generate_series(
         $2::date, $3::date - 1, interval '1 day'
       ) AS dates(stay_day)
       LEFT JOIN bookings AS booking
         ON booking.room_id = $1
        AND booking.type = 'room'
        AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
        AND daterange(booking.check_in, booking.check_out, '[)')
          @> dates.stay_day::date
        AND ($4::bigint IS NULL OR booking.id <> $4)
       GROUP BY dates.stay_day
     ) AS daily`,
    [roomId, checkIn, checkOut, excludedBookingId],
  );
  return result.rows[0].booked;
}

async function assignPhysicalRoom(
  client,
  bookingId,
  roomId,
  checkIn,
  checkOut,
) {
  const availableRoom = await client.query(
    `SELECT physical.id
     FROM physical_rooms AS physical
     WHERE physical.room_id = $1
       AND physical.active = true
       AND physical.status <> 'Needs Cleaning'
       AND (
         physical.status = 'Ready'
         OR EXISTS (
           SELECT 1 FROM bookings AS linked
           WHERE linked.physical_room_id = physical.id
             AND linked.status IN ('Pending', 'Confirmed', 'CheckedIn')
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings AS overlapping
         WHERE overlapping.physical_room_id = physical.id
           AND overlapping.id <> $2
           AND overlapping.status IN ('Pending', 'Confirmed', 'CheckedIn')
           AND daterange(overlapping.check_in, overlapping.check_out, '[)')
             && daterange($3::date, $4::date, '[)')
       )
     ORDER BY CASE WHEN physical.status = 'Ready' THEN 0 ELSE 1 END,
       physical.unit_number
     FOR UPDATE OF physical SKIP LOCKED
     LIMIT 1`,
    [roomId, bookingId, checkIn, checkOut],
  );
  const physicalRoomId = availableRoom.rows[0]?.id;
  if (!physicalRoomId) return null;

  await client.query(
    `UPDATE physical_rooms SET status = 'Occupied', last_updated = now()
     WHERE id = $1 AND EXISTS (
       SELECT 1 FROM bookings
       WHERE id = $2 AND status IN ('Confirmed', 'CheckedIn')
         AND check_in <= CURRENT_DATE AND check_out > CURRENT_DATE
     )`,
    [physicalRoomId, bookingId],
  );
  await client.query(
    "UPDATE bookings SET physical_room_id = $1 WHERE id = $2",
    [physicalRoomId, bookingId],
  );
  return physicalRoomId;
}

async function deliverConfirmation(booking) {
  if (!booking.guestEmail) {
    return {
      sent: false,
      message: "No customer email is saved for this booking.",
    };
  }
  try {
    await sendBookingConfirmation(booking);
    return { sent: true };
  } catch (error) {
    console.error("Booking confirmation email failed:", error);
    return {
      sent: false,
      message: error.message || "Could not send booking confirmation email.",
    };
  }
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
      const [contentResult, roomResult, galleryResult, heroImageResult] =
        await Promise.all([
          pool.query(
            "SELECT content_value FROM site_content WHERE content_key = 'public'",
          ),
          pool.query(
            `SELECT room.id, room.name, room.capacity, room.rate, room.inclusions,
             room.inventory, room.image,
             COALESCE(json_agg(json_build_object(
               'id', image.id, 'url', image.url, 'alt', image.alt_text,
               'sort_order', image.sort_order
             ) ORDER BY image.sort_order, image.id)
             FILTER (WHERE image.id IS NOT NULL), '[]') AS images
           FROM rooms AS room
           LEFT JOIN room_images AS image ON image.room_id = room.id
           WHERE room.active = true
           GROUP BY room.id
           ORDER BY CASE
             WHEN room.id = 'villa' OR room.name ILIKE '%villa%' THEN 1
             ELSE 0
           END, room.sort_order, room.name`,
          ),
          pool.query(
            "SELECT id, url, alt_text AS alt, sort_order FROM gallery_images ORDER BY sort_order, id",
          ),
          pool.query(
            "SELECT id, url, alt_text AS alt, sort_order FROM hero_images ORDER BY sort_order, id",
          ),
        ]);

      response.json({
        content: { ...defaultContent, ...contentResult.rows[0]?.content_value },
        rooms: roomResult.rows,
        gallery: galleryResult.rows,
        heroImages: heroImageResult.rows,
      });
    }),
  );

  router.get(
    "/room-availability",
    asyncRoute(async (request, response) => {
      const { roomId, checkIn, checkOut } = request.query;
      if (
        !validText(roomId, 80) ||
        !validDate(checkIn) ||
        !validDate(checkOut) ||
        checkOut <= checkIn
      ) {
        return response.status(400).json({
          error: "Choose a room and valid check-in/check-out dates",
        });
      }

      const roomResult = await pool.query(
        "SELECT id, inventory FROM rooms WHERE id = $1 AND active = true",
        [roomId],
      );
      const room = roomResult.rows[0];
      if (!room) {
        return response.status(404).json({ error: "Room type not found" });
      }

      const booked = await getRoomBookingAvailability(
        pool,
        room.id,
        checkIn,
        checkOut,
      );
      const availableRooms = Math.max(room.inventory - booked, 0);
      response.json({
        available: availableRooms > 0,
        availableRooms,
        inventory: room.inventory,
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
        `SELECT room.*,
           COALESCE(json_agg(json_build_object(
             'id', image.id, 'url', image.url, 'alt', image.alt_text,
             'sort_order', image.sort_order
           ) ORDER BY image.sort_order, image.id)
           FILTER (WHERE image.id IS NOT NULL), '[]') AS images
         FROM rooms AS room LEFT JOIN room_images AS image ON image.room_id = room.id
         GROUP BY room.id ORDER BY room.sort_order, room.name`,
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
      const active = room.active !== false;
      if (
        !validText(room.name, 120) ||
        !validText(room.capacity, 120) ||
        !validText(room.image, 1000) ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        !Number.isInteger(inventory) ||
        inventory < 1 ||
        (room.active !== undefined && typeof room.active !== "boolean")
      ) {
        return response.status(400).json({
          error:
            "Enter a name, capacity, image, non-negative rate, and positive inventory",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const currentResult = await client.query(
          "SELECT id, inventory, active FROM rooms WHERE id = $1 FOR UPDATE",
          [id],
        );
        const current = currentResult.rows[0];
        if (
          current &&
          current.active &&
          (!active || inventory < current.inventory)
        ) {
          const blockingRooms = await client.query(
            `SELECT room_label, status FROM physical_rooms
             WHERE room_id = $1 AND active = true
               AND (NOT $2::boolean OR unit_number > $3)
               AND status <> 'Ready'
             LIMIT 1`,
            [id, active, inventory],
          );
          if (blockingRooms.rowCount) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: `${blockingRooms.rows[0].room_label} is ${blockingRooms.rows[0].status}. Set it to Ready before reducing inventory or archiving this room type.`,
            });
          }
          if (!active) {
            const upcoming = await client.query(
              `SELECT EXISTS (
                 SELECT 1 FROM bookings
                 WHERE room_id = $1 AND status IN ('Pending', 'Confirmed', 'CheckedIn')
                   AND check_out >= CURRENT_DATE
               ) AS exists`,
              [id],
            );
            if (upcoming.rows[0].exists) {
              await client.query("ROLLBACK");
              return response.status(409).json({
                error:
                  "This room type has upcoming pending or confirmed bookings and cannot be archived yet.",
              });
            }
          } else if (inventory < current.inventory) {
            const overCapacity = await client.query(
              `SELECT stay_day::date AS date, count(*)::int AS bookings
               FROM bookings AS booking
               CROSS JOIN LATERAL generate_series(
                 GREATEST(booking.check_in, CURRENT_DATE),
                 booking.check_out - 1,
                 interval '1 day'
               ) AS stay_day
               WHERE booking.room_id = $1
                 AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
                 AND booking.check_out > CURRENT_DATE
               GROUP BY stay_day
               HAVING count(*) > $2
               LIMIT 1`,
              [id, inventory],
            );
            if (overCapacity.rowCount) {
              await client.query("ROLLBACK");
              return response.status(409).json({
                error: `Confirmed bookings exceed the new inventory on ${overCapacity.rows[0].date}.`,
              });
            }
          }
        }

        const result = await client.query(
          `INSERT INTO rooms (id, name, capacity, rate, inclusions, inventory, image, active, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             COALESCE((SELECT max(sort_order) + 1 FROM rooms), 0))
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
             capacity = EXCLUDED.capacity, rate = EXCLUDED.rate,
             inclusions = EXCLUDED.inclusions, inventory = EXCLUDED.inventory,
             image = EXCLUDED.image, active = EXCLUDED.active
           RETURNING *`,
          [
            id,
            room.name.trim(),
            room.capacity.trim(),
            rate,
            room.inclusions || "",
            inventory,
            room.image,
            active,
          ],
        );
        await syncPhysicalRooms(client, id);
        await client.query("COMMIT");
        response.status(current ? 200 : 201).json(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  router.delete(
    "/admin/rooms/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const room = await pool.query(
        "SELECT id, inventory, active FROM rooms WHERE id = $1",
        [request.params.id],
      );
      if (!room.rowCount)
        return response.status(404).json({ error: "Room not found" });
      const blockingRooms = await pool.query(
        `SELECT room_label, status FROM physical_rooms
         WHERE room_id = $1 AND active = true AND status <> 'Ready' LIMIT 1`,
        [request.params.id],
      );
      if (blockingRooms.rowCount) {
        return response.status(409).json({
          error: `${blockingRooms.rows[0].room_label} is ${blockingRooms.rows[0].status}. Set it to Ready before archiving this room type.`,
        });
      }
      const upcoming = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM bookings
           WHERE room_id = $1 AND status IN ('Pending', 'Confirmed', 'CheckedIn')
             AND check_out >= CURRENT_DATE
         ) AS exists`,
        [request.params.id],
      );
      if (upcoming.rows[0].exists) {
        return response.status(409).json({
          error:
            "This room type has upcoming pending or confirmed bookings and cannot be archived yet.",
        });
      }
      await pool.query("UPDATE rooms SET active = false WHERE id = $1", [
        request.params.id,
      ]);
      await syncPhysicalRooms(pool, request.params.id);
      response.status(204).end();
    }),
  );

  router.get(
    "/admin/rooms/:id/images",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        `SELECT id, url, alt_text AS alt, sort_order
         FROM room_images WHERE room_id = $1 ORDER BY sort_order, id`,
        [request.params.id],
      );
      response.json(result.rows);
    }),
  );

  router.post(
    "/admin/rooms/:id/images",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const { url, alt = "" } = request.body;
      if (
        !validText(url, 1000) ||
        typeof alt !== "string" ||
        alt.length > 300
      ) {
        return response
          .status(400)
          .json({
            error: "A valid image URL and alternative text are required",
          });
      }
      const result = await pool.query(
        `INSERT INTO room_images (room_id, url, alt_text, sort_order)
         SELECT room.id, $2, $3,
           COALESCE((SELECT max(sort_order) + 1 FROM room_images WHERE room_id = room.id), 0)
         FROM rooms AS room WHERE room.id = $1 AND room.active = true
         RETURNING id, room_id AS "roomId", url, alt_text AS alt, sort_order`,
        [request.params.id, url, alt.trim()],
      );
      if (!result.rowCount)
        return response
          .status(404)
          .json({ error: "Active room type not found" });
      response.status(201).json(result.rows[0]);
    }),
  );

  router.delete(
    "/admin/rooms/:id/images/:imageId",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        "DELETE FROM room_images WHERE id = $1 AND room_id = $2 RETURNING id",
        [request.params.imageId, request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Room image not found" });
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

  router.get(
    "/admin/hero-images",
    requireAdmin,
    asyncRoute(async (_request, response) => {
      const result = await pool.query(
        "SELECT id, url, alt_text AS alt, sort_order FROM hero_images ORDER BY sort_order, id",
      );
      response.json(result.rows);
    }),
  );

  router.post(
    "/admin/hero-images",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const { url, alt = "", sort_order: sortOrder } = request.body;
      if (
        !validText(url, 1000) ||
        typeof alt !== "string" ||
        alt.length > 300 ||
        (sortOrder != null && !Number.isInteger(Number(sortOrder)))
      ) {
        return response.status(400).json({
          error:
            "A valid image URL, alternative text, and sort order are required",
        });
      }
      const result = await pool.query(
        `INSERT INTO hero_images (url, alt_text, sort_order)
         VALUES ($1, $2, COALESCE($3, (SELECT COALESCE(max(sort_order), 0) + 1 FROM hero_images)))
         RETURNING id, url, alt_text AS alt, sort_order`,
        [url, alt.trim(), sortOrder == null ? null : Number(sortOrder)],
      );
      response.status(201).json(result.rows[0]);
    }),
  );

  router.patch(
    "/admin/hero-images/:id",
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
      if (sortOrder !== null && !Number.isInteger(sortOrder)) {
        return response
          .status(400)
          .json({ error: "Sort order must be a whole number" });
      }
      const result = await pool.query(
        `UPDATE hero_images
         SET sort_order = COALESCE($1, sort_order), alt_text = COALESCE($2, alt_text)
         WHERE id = $3
         RETURNING id, url, alt_text AS alt, sort_order`,
        [sortOrder, alt, request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Hero image not found" });
      response.json(result.rows[0]);
    }),
  );

  router.delete(
    "/admin/hero-images/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        "DELETE FROM hero_images WHERE id = $1 RETURNING id",
        [request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Hero image not found" });
      response.status(204).end();
    }),
  );

  router.post(
    "/bookings",
    asyncRoute(async (request, response) => {
      const booking = request.body;
      if (
        !validText(booking.guestName, 160) ||
        !validText(booking.contact, 80) ||
        !validEmail(booking.guestEmail)
      ) {
        return response
          .status(400)
          .json({
            error: "Name, contact number, and a valid email are required",
          });
      }

      if (booking.type === "room") {
        if (
          !validDate(booking.checkIn) ||
          !validDate(booking.checkOut) ||
          booking.checkOut <= booking.checkIn
        ) {
          return response.status(400).json({
            error: "Choose a room and valid check-in/check-out dates",
          });
        }
        const client = await pool.connect();
        let result;
        try {
          await client.query("BEGIN");
          const roomResult = await client.query(
            `SELECT id, name, inventory FROM rooms
             WHERE active = true AND id = $1
             FOR UPDATE`,
            [booking.roomId || ""],
          );
          const room = roomResult.rows[0];
          if (!room) {
            await client.query("ROLLBACK");
            return response.status(400).json({
              error: "Choose an active room type",
            });
          }

          const booked = await getRoomBookingAvailability(
            client,
            room.id,
            booking.checkIn,
            booking.checkOut,
          );
          if (booked >= room.inventory) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error:
                "This room type is fully booked for the selected dates. Please choose different dates or another room.",
            });
          }

          result = await client.query(
            `INSERT INTO bookings (type, guest_name, guest_email, contact, notes, room_id, room_name, check_in, check_out, pax)
             VALUES ('room', $1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING ${bookingColumns}`,
            [
              booking.guestName.trim(),
              booking.guestEmail.trim().toLowerCase(),
              booking.contact.trim(),
              booking.notes || "",
              room.id,
              room.name,
              booking.checkIn,
              booking.checkOut,
              Number(booking.pax) || 1,
            ],
          );
          const physicalRoomId = await assignPhysicalRoom(
            client,
            result.rows[0].id,
            room.id,
            booking.checkIn,
            booking.checkOut,
          );
          if (!physicalRoomId) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error:
                "No physical room unit is available for those dates. Please choose another room or date range.",
            });
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        return response.status(201).json(result.rows[0]);
      }

      if (
        booking.type === "event" &&
        validEmail(booking.guestEmail) &&
        validText(booking.eventType, 80) &&
        booking.eventDate &&
        Number(booking.guestCount) > 0 &&
        validText(booking.timeBlock, 40)
      ) {
        const result = await pool.query(
          `INSERT INTO bookings (type, guest_name, guest_email, contact, notes, event_type, event_date, guest_count, time_block)
         VALUES ('event', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${bookingColumns}`,
          [
            booking.guestName.trim(),
            booking.guestEmail.trim().toLowerCase(),
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
        !validText(booking.contact, 80) ||
        (booking.guestEmail && !validEmail(booking.guestEmail))
      ) {
        return response
          .status(400)
          .json({ error: "Name and contact number are required" });
      }
      if (booking.type === "room") {
        if (
          !booking.checkIn ||
          !booking.checkOut ||
          !validDate(booking.checkIn) ||
          !validDate(booking.checkOut) ||
          booking.checkOut <= booking.checkIn
        ) {
          return response
            .status(400)
            .json({ error: "Choose a room and valid dates" });
        }
        const client = await pool.connect();
        let result;
        try {
          await client.query("BEGIN");
          const roomResult = await client.query(
            `SELECT id, name, inventory FROM rooms
             WHERE active = true AND (id = $1 OR name = $1)
             FOR UPDATE`,
            [booking.roomId || booking.roomType || ""],
          );
          const room = roomResult.rows[0];
          if (!room) {
            await client.query("ROLLBACK");
            return response
              .status(400)
              .json({ error: "Choose an active room type" });
          }
          const booked = await getRoomBookingAvailability(
            client,
            room.id,
            booking.checkIn,
            booking.checkOut,
          );
          if (booked >= room.inventory) {
            await client.query("ROLLBACK");
            return response
              .status(409)
              .json({ error: "No inventory remains for these dates" });
          }
          result = await client.query(
            `INSERT INTO bookings (type, status, guest_name, guest_email, contact, room_id, room_name, check_in, check_out, pax)
             VALUES ('room', 'Confirmed', $1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING ${bookingColumns}`,
            [
              booking.guestName.trim(),
              booking.guestEmail?.trim().toLowerCase() || "",
              booking.contact.trim(),
              room.id,
              room.name,
              booking.checkIn,
              booking.checkOut,
              Number(booking.pax) || 1,
            ],
          );
          const physicalRoomId = await assignPhysicalRoom(
            client,
            result.rows[0].id,
            room.id,
            booking.checkIn,
            booking.checkOut,
          );
          if (!physicalRoomId) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: "No physical room unit is available for those dates.",
            });
          }
          result.rows[0].physicalRoomId = physicalRoomId;
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        const emailDelivery = await deliverConfirmation(result.rows[0]);
        return response.status(201).json({ ...result.rows[0], emailDelivery });
      }
      if (
        booking.type === "event" &&
        validText(booking.eventType, 80) &&
        booking.eventDate
      ) {
        const result = await pool.query(
          `INSERT INTO bookings (type, status, guest_name, guest_email, contact, event_type, event_date, guest_count)
         VALUES ('event', 'Confirmed', $1, $2, $3, $4, $5, $6) RETURNING ${bookingColumns}`,
          [
            booking.guestName.trim(),
            booking.guestEmail?.trim().toLowerCase() || "",
            booking.contact.trim(),
            booking.eventType,
            booking.eventDate,
            Number(booking.guestCount) || 1,
          ],
        );
        const emailDelivery = await deliverConfirmation(result.rows[0]);
        return response.status(201).json({ ...result.rows[0], emailDelivery });
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
      const { status } = request.body;
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

        const bookingReservesRoom = [
          "Pending",
          "Confirmed",
          "CheckedIn",
        ].includes(status);
        if (bookingReservesRoom && current.type === "room") {
          const roomResult = await client.query(
            "SELECT inventory, active FROM rooms WHERE id = $1 FOR UPDATE",
            [current.room_id],
          );
          if (!roomResult.rows[0]?.active) {
            await client.query("ROLLBACK");
            return response
              .status(409)
              .json({
                error: "This room type is no longer available for booking.",
              });
          }
          const inventory = roomResult.rows[0]?.inventory || 0;
          const booked = await getRoomBookingAvailability(
            client,
            current.room_id,
            current.check_in,
            current.check_out,
            current.id,
          );
          if (booked >= inventory) {
            await client.query("ROLLBACK");
            return response
              .status(409)
              .json({ error: "No inventory remains for these dates" });
          }
        }

        const bookingIsActive = ["Confirmed", "CheckedIn"].includes(status);
        let physicalRoomId = current.physical_room_id;
        if (
          bookingReservesRoom &&
          current.type === "room" &&
          !current.physical_room_id
        ) {
          physicalRoomId = await assignPhysicalRoom(
            client,
            current.id,
            current.room_id,
            current.check_in,
            current.check_out,
          );
          if (!physicalRoomId) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: "No physical room unit is available for those dates.",
            });
          }
        }

        const result = await client.query(
          `UPDATE bookings
           SET status = $1,
               physical_room_id = CASE
                 WHEN $2::boolean THEN physical_room_id
                 ELSE NULL
               END
           WHERE id = $3 RETURNING ${bookingColumns}`,
          [status, bookingReservesRoom, request.params.id],
        );
        if (bookingIsActive && current.type === "room" && physicalRoomId) {
          await client.query(
            `UPDATE physical_rooms SET status = 'Occupied', last_updated = now()
             WHERE id = $1 AND EXISTS (
               SELECT 1 FROM bookings
               WHERE id = $2 AND status IN ('Confirmed', 'CheckedIn')
                 AND check_in <= CURRENT_DATE AND check_out > CURRENT_DATE
             )`,
            [physicalRoomId, current.id],
          );
        }
        if (!bookingIsActive && current.physical_room_id) {
          await client.query(
            `UPDATE physical_rooms AS physical
             SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM bookings AS linked
                 WHERE linked.physical_room_id = physical.id
                   AND linked.status IN ('Confirmed', 'CheckedIn')
                   AND linked.check_in <= CURRENT_DATE
                   AND linked.check_out > CURRENT_DATE
               ) THEN 'Occupied'
               WHEN $2 = 'Completed' AND $3::date <= CURRENT_DATE
                 THEN 'Needs Cleaning'
               ELSE 'Ready'
             END,
             last_updated = now()
             WHERE physical.id = $1`,
            [current.physical_room_id, status, current.check_in],
          );
        }
        await client.query("COMMIT");

        let emailDelivery = null;
        if (status === "Confirmed" && current.status !== "Confirmed") {
          emailDelivery = await deliverConfirmation(result.rows[0]);
        }
        response.json({ ...result.rows[0], emailDelivery });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/admin/bookings/:id/resend-confirmation",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        `SELECT ${bookingColumns} FROM bookings WHERE id = $1 AND status = 'Confirmed'`,
        [request.params.id],
      );
      if (!result.rowCount)
        return response
          .status(404)
          .json({ error: "Confirmed booking not found" });
      const emailDelivery = await deliverConfirmation(result.rows[0]);
      response.json({ emailDelivery });
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
           FROM (
             SELECT physical.id,
               CASE
                 WHEN EXISTS (
                   SELECT 1 FROM bookings
                   WHERE physical_room_id = physical.id
                     AND status IN ('Confirmed', 'CheckedIn')
                     AND check_in <= CURRENT_DATE
                     AND check_out > CURRENT_DATE
                 ) THEN 'Occupied'
                 WHEN physical.status = 'Occupied' THEN 'Ready'
                 ELSE physical.status
               END AS status
             FROM physical_rooms AS physical
             WHERE physical.active = true
           ) AS current_room_status`,
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
      if (!validDate(start) || !validDate(end) || start > end) {
        return response
          .status(400)
          .json({
            error: "Enter a valid date range with start on or before end",
          });
      }
      const result = await pool.query(
        `SELECT count(*)::int AS total_bookings,
       count(*) FILTER (WHERE type = 'room')::int AS room_bookings,
       count(*) FILTER (WHERE type = 'event')::int AS event_bookings
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
      const [rooms, unassignedBookings] = await Promise.all([
        pool.query(
        `SELECT physical.id, physical.room_id AS "roomId",
           physical.unit_number AS "unitNumber", physical.room_label AS "roomLabel",
           CASE
             WHEN EXISTS (
               SELECT 1 FROM bookings AS active_stay
               WHERE active_stay.physical_room_id = physical.id
                 AND active_stay.status IN ('Confirmed', 'CheckedIn')
                 AND active_stay.check_in <= CURRENT_DATE
                 AND active_stay.check_out > CURRENT_DATE
             ) THEN 'Occupied'
             WHEN physical.status = 'Occupied' THEN 'Ready'
             ELSE physical.status
           END AS status,
           physical.last_updated AS "lastUpdated", room.name AS "roomType",
           COALESCE((
             SELECT json_agg(json_build_object(
               'guestName', booking.guest_name,
               'checkIn', to_char(booking.check_in, 'YYYY-MM-DD'),
               'checkOut', to_char(booking.check_out, 'YYYY-MM-DD'),
               'status', booking.status
             ) ORDER BY booking.check_in, booking.id)
             FROM bookings AS booking
             WHERE booking.physical_room_id = physical.id
               AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
           ), '[]'::json) AS reservations
         FROM physical_rooms AS physical
         JOIN rooms AS room ON room.id = physical.room_id
         WHERE physical.active = true
         ORDER BY room.sort_order, physical.unit_number`,
        ),
        pool.query(
          `SELECT booking.id, booking.guest_name AS "guestName",
             booking.room_name AS "roomType",
             to_char(booking.check_in, 'YYYY-MM-DD') AS "checkIn",
             to_char(booking.check_out, 'YYYY-MM-DD') AS "checkOut",
             booking.status
           FROM bookings AS booking
           WHERE booking.type = 'room'
             AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
             AND booking.physical_room_id IS NULL
           ORDER BY booking.check_in, booking.id`,
        ),
      ]);
      response.json({
        rooms: rooms.rows,
        unassignedBookings: unassignedBookings.rows,
      });
    }),
  );

  router.patch(
    "/admin/bookings/:id/email",
    requireAdmin,
    asyncRoute(async (request, response) => {
      if (!validEmail(request.body.guestEmail)) {
        return response
          .status(400)
          .json({ error: "Enter a valid customer email address" });
      }
      const result = await pool.query(
        `UPDATE bookings SET guest_email = $1 WHERE id = $2
         RETURNING id, guest_email AS "guestEmail"`,
        [request.body.guestEmail.trim().toLowerCase(), request.params.id],
      );
      if (!result.rowCount)
        return response.status(404).json({ error: "Booking not found" });
      response.json(result.rows[0]);
    }),
  );

  router.patch(
    "/admin/room-status/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const allowed = new Set(["Ready", "Occupied", "Needs Cleaning"]);
      if (!allowed.has(request.body.status))
        return response.status(400).json({ error: "Invalid room status" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const room = await client.query(
          "SELECT id FROM physical_rooms WHERE id = $1 FOR UPDATE",
          [request.params.id],
        );
        if (!room.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Room not found" });
        }
        const activeBooking = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM bookings
             WHERE physical_room_id = $1
               AND status IN ('Confirmed', 'CheckedIn')
               AND check_in <= CURRENT_DATE
               AND check_out > CURRENT_DATE
           ) AS exists`,
          [request.params.id],
        );
        if (
          activeBooking.rows[0].exists &&
          request.body.status !== "Occupied"
        ) {
          await client.query("ROLLBACK");
          return response.status(409).json({
            error:
              "This room is assigned to an active booking. Update the booking status before changing its room status.",
          });
        }
        if (
          !activeBooking.rows[0].exists &&
          request.body.status === "Occupied"
        ) {
          await client.query("ROLLBACK");
          return response.status(409).json({
            error: "Occupied status is set automatically for active stays.",
          });
        }
        const result = await client.query(
          `UPDATE physical_rooms SET status = $1, last_updated = now()
           WHERE id = $2
           RETURNING id, room_label AS "roomLabel", status,
             last_updated AS "lastUpdated"`,
          [request.body.status, request.params.id],
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
