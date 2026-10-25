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
import {
  isBlockingStatus,
  propertyToday,
  validDate,
  validStay,
} from "./booking-rules.js";

const uploadDirectory = fileURLToPath(new URL("./uploads/", import.meta.url));
mkdirSync(uploadDirectory, { recursive: true });

const bookingColumns = `
  id, type, status, guest_name AS "guestName", guest_email AS "guestEmail", contact, notes,
  room_id AS "roomId", room_id AS "physicalRoomId",
  room_type_id AS "roomTypeId", room_name AS "roomType",
  source,
  to_char(check_in, 'YYYY-MM-DD') AS "checkIn",
  to_char(check_out, 'YYYY-MM-DD') AS "checkOut", pax,
  event_type AS "eventType",
  to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
  guest_count AS "guestCount", time_block AS "timeBlock",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

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

function noRoomAvailableMessage(roomName) {
  const typeName = String(roomName || "Room").replace(/\s+room$/i, "");
  return `No ${typeName} room free for these dates.`;
}

async function getRoomBookingAvailability(
  queryable,
  roomId,
  checkIn,
  checkOut,
  excludedBookingId = null,
) {
  const result = await queryable.query(
    `SELECT COALESCE(max(daily.booked + daily.blocked), 0)::int AS booked
     FROM (
       SELECT dates.stay_day::date AS date,
         (SELECT count(*)::int
          FROM bookings AS booking
          WHERE booking.room_type_id = $1 AND booking.type = 'room'
            AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
            AND daterange(booking.check_in, booking.check_out, '[)')
              @> dates.stay_day::date
            AND ($4::bigint IS NULL OR booking.id <> $4)) AS booked,
         (SELECT count(DISTINCT physical.id)::int
          FROM room_blocks AS block
          JOIN physical_rooms AS physical ON physical.id = block.room_id
          WHERE physical.room_id = $1 AND physical.active = true
            AND daterange(block.start_date, block.end_date, '[)')
              @> dates.stay_day::date) AS blocked
       FROM generate_series(
         $2::date, $3::date - 1, interval '1 day'
       ) AS dates(stay_day)
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
  requestedPhysicalRoomId = null,
) {
  const availableRoom = await client.query(
    `SELECT physical.id
     FROM physical_rooms AS physical
     WHERE physical.room_id = $1
       AND physical.active = true
       AND ($5::text IS NULL OR physical.id = $5)
       AND NOT EXISTS (
         SELECT 1 FROM bookings AS overlapping
         WHERE overlapping.room_id = physical.id
           AND overlapping.id <> $2
           AND overlapping.status IN ('Pending', 'Confirmed', 'CheckedIn')
           AND daterange(overlapping.check_in, overlapping.check_out, '[)')
             && daterange($3::date, $4::date, '[)')
       )
       AND NOT EXISTS (
         SELECT 1 FROM room_blocks AS block
         WHERE block.room_id = physical.id
           AND daterange(block.start_date, block.end_date, '[)')
             && daterange($3::date, $4::date, '[)')
       )
     ORDER BY physical.unit_number
     FOR UPDATE OF physical SKIP LOCKED
     LIMIT 1`,
    [roomId, bookingId, checkIn, checkOut, requestedPhysicalRoomId],
  );
  const physicalRoomId = availableRoom.rows[0]?.id;
  if (!physicalRoomId) return null;

  await client.query(
    "UPDATE bookings SET room_id = $1 WHERE id = $2",
    [physicalRoomId, bookingId],
  );
  return physicalRoomId;
}

async function getRoomBookingConflicts(
  queryable,
  roomTypeId,
  checkIn,
  checkOut,
  excludedBookingId,
) {
  const result = await queryable.query(
    `SELECT booking.id, booking.guest_name AS "guestName",
       to_char(booking.check_in, 'YYYY-MM-DD') AS "checkIn",
       to_char(booking.check_out, 'YYYY-MM-DD') AS "checkOut",
       booking.status, physical.room_label AS "unitLabel"
     FROM bookings AS booking
     LEFT JOIN physical_rooms AS physical ON physical.id = booking.room_id
     WHERE booking.room_type_id = $1
       AND booking.type = 'room'
       AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
       AND booking.id <> $4
       AND daterange(booking.check_in, booking.check_out, '[)')
         && daterange($2::date, $3::date, '[)')
     ORDER BY booking.check_in, booking.id`,
    [roomTypeId, checkIn, checkOut, excludedBookingId],
  );
  return result.rows;
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
        !validStay(checkIn, checkOut) ||
        checkIn < propertyToday()
      ) {
        return response.status(400).json({
          error: "Choose a room and dates with check-in today or later.",
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
          const reservedPhysicalRoom = await client.query(
            `SELECT physical.room_label
             FROM physical_rooms AS physical
             WHERE physical.room_id = $1 AND physical.active = true
               AND (NOT $2::boolean OR physical.unit_number > $3)
               AND (
                 EXISTS (
                   SELECT 1 FROM bookings
                   WHERE room_id = physical.id
                     AND status IN ('Pending', 'Confirmed', 'CheckedIn')
                     AND check_out > (now() AT TIME ZONE 'Asia/Manila')::date
                 )
                 OR EXISTS (
                   SELECT 1 FROM room_blocks
                   WHERE room_id = physical.id
                     AND end_date > (now() AT TIME ZONE 'Asia/Manila')::date
                 )
               )
             LIMIT 1`,
            [id, active, inventory],
          );
          if (reservedPhysicalRoom.rowCount) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: `${reservedPhysicalRoom.rows[0].room_label} has an upcoming booking or maintenance block.`,
            });
          }
          const blockingRooms = await client.query(
            `SELECT room_label, housekeeping_status FROM physical_rooms
             WHERE room_id = $1 AND active = true
               AND (NOT $2::boolean OR unit_number > $3)
               AND housekeeping_status = 'Dirty'
             LIMIT 1`,
            [id, active, inventory],
          );
          if (blockingRooms.rowCount) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: `${blockingRooms.rows[0].room_label} is Dirty. Mark it Clean before reducing inventory or archiving this room type.`,
            });
          }
          if (!active) {
            const upcoming = await client.query(
              `SELECT EXISTS (
                 SELECT 1 FROM bookings
                 WHERE room_type_id = $1 AND status IN ('Pending', 'Confirmed', 'CheckedIn')
                   AND check_out >= (now() AT TIME ZONE 'Asia/Manila')::date
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
              `WITH reserved_days AS (
                 SELECT generate_series(
                   GREATEST(booking.check_in, (now() AT TIME ZONE 'Asia/Manila')::date),
                   booking.check_out - 1,
                   interval '1 day'
                 )::date AS date
                 FROM bookings AS booking
                 WHERE booking.room_type_id = $1
                   AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
                   AND booking.check_out > (now() AT TIME ZONE 'Asia/Manila')::date
                 UNION
                 SELECT generate_series(
                   GREATEST(block.start_date, (now() AT TIME ZONE 'Asia/Manila')::date),
                   block.end_date - 1,
                   interval '1 day'
                 )::date
                 FROM room_blocks AS block
                 JOIN physical_rooms AS physical ON physical.id = block.room_id
                 WHERE physical.room_id = $1 AND physical.active = true
                   AND block.end_date > (now() AT TIME ZONE 'Asia/Manila')::date
               )
               SELECT reserved_days.date
               FROM reserved_days
               LEFT JOIN bookings AS booking
                 ON booking.room_type_id = $1
                AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
                AND daterange(booking.check_in, booking.check_out, '[)')
                  @> reserved_days.date
               LEFT JOIN room_blocks AS block
                 ON daterange(block.start_date, block.end_date, '[)')
                   @> reserved_days.date
               LEFT JOIN physical_rooms AS physical
                 ON physical.id = block.room_id
                AND physical.room_id = $1 AND physical.active = true
               GROUP BY reserved_days.date
               HAVING count(DISTINCT booking.id) + count(DISTINCT physical.id) > $2
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
      const reservedPhysicalRoom = await pool.query(
        `SELECT physical.room_label
         FROM physical_rooms AS physical
         WHERE physical.room_id = $1 AND physical.active = true
           AND (
             EXISTS (
               SELECT 1 FROM bookings
               WHERE room_id = physical.id
                 AND status IN ('Pending', 'Confirmed', 'CheckedIn')
                 AND check_out > (now() AT TIME ZONE 'Asia/Manila')::date
             )
             OR EXISTS (
               SELECT 1 FROM room_blocks
               WHERE room_id = physical.id
                 AND end_date > (now() AT TIME ZONE 'Asia/Manila')::date
             )
           )
         LIMIT 1`,
        [request.params.id],
      );
      if (reservedPhysicalRoom.rowCount) {
        return response.status(409).json({
          error: `${reservedPhysicalRoom.rows[0].room_label} has an upcoming booking or maintenance block.`,
        });
      }
      const blockingRooms = await pool.query(
        `SELECT room_label, housekeeping_status FROM physical_rooms
         WHERE room_id = $1 AND active = true
           AND housekeeping_status = 'Dirty' LIMIT 1`,
        [request.params.id],
      );
      if (blockingRooms.rowCount) {
        return response.status(409).json({
          error: `${blockingRooms.rows[0].room_label} is Dirty. Mark it Clean before archiving this room type.`,
        });
      }
      const upcoming = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM bookings
           WHERE room_type_id = $1 AND status IN ('Pending', 'Confirmed', 'CheckedIn')
             AND check_out >= (now() AT TIME ZONE 'Asia/Manila')::date
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
          !validStay(booking.checkIn, booking.checkOut) ||
          booking.checkIn < propertyToday()
        ) {
          return response.status(400).json({
            error: "Choose valid dates with check-in today or later.",
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
            [booking.roomTypeId || booking.roomId || ""],
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
                "Room no longer available",
            });
          }

          result = await client.query(
            `INSERT INTO bookings (type, guest_name, guest_email, contact, notes, room_type_id, room_name, check_in, check_out, pax, source)
             VALUES ('room', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'public')
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
      const result = await pool.query(
        `SELECT ${bookingColumns},
           (SELECT physical.room_label FROM physical_rooms AS physical
            WHERE physical.id = bookings.room_id) AS "unitLabel"
         FROM bookings
         ORDER BY created_at DESC, id DESC`,
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
          !validStay(booking.checkIn, booking.checkOut) ||
          booking.checkIn < propertyToday()
        ) {
          return response
            .status(400)
            .json({ error: "Choose valid dates with check-in today or later." });
        }
        const client = await pool.connect();
        let result;
        try {
          await client.query("BEGIN");
          const roomResult = await client.query(
            `SELECT id, name, inventory FROM rooms
             WHERE active = true AND (id = $1 OR name = $1)
             FOR UPDATE`,
            [booking.roomTypeId || booking.roomId || booking.roomType || ""],
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
              .json({ error: "Room no longer available" });
          }
          result = await client.query(
            `INSERT INTO bookings (type, status, guest_name, guest_email, contact, room_type_id, room_name, check_in, check_out, pax, source)
             VALUES ('room', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'admin')
             RETURNING ${bookingColumns}`,
            [
              ["Pending", "Confirmed"].includes(booking.status)
                ? booking.status
                : "Confirmed",
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
          if (result.rows[0].status === "Confirmed") {
            const physicalRoomId = await assignPhysicalRoom(
              client,
              result.rows[0].id,
              room.id,
              booking.checkIn,
              booking.checkOut,
              booking.unitId ||
                (booking.roomTypeId
                  ? booking.roomId
                  : booking.physicalRoomId) ||
                null,
            );
            if (!physicalRoomId) {
              const conflicts = await getRoomBookingConflicts(
                client,
                room.id,
                booking.checkIn,
                booking.checkOut,
                result.rows[0].id,
              );
              await client.query("ROLLBACK");
              return response.status(409).json({
                error: noRoomAvailableMessage(room.name),
                conflicts,
              });
            }
            result.rows[0].roomId = physicalRoomId;
            result.rows[0].physicalRoomId = physicalRoomId;
          }
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
          `INSERT INTO bookings (type, status, guest_name, guest_email, contact, event_type, event_date, guest_count, source)
         VALUES ('event', 'Confirmed', $1, $2, $3, $4, $5, $6, 'admin') RETURNING ${bookingColumns}`,
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
        `SELECT ${bookingColumns},
           (SELECT room_label FROM physical_rooms WHERE id = bookings.room_id) AS "unitLabel"
         FROM bookings WHERE id = $1`,
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
      const client = await pool.connect();
      let updated;
      let checkedOutRoomId = null;
      let movedFromRoomId = null;
      let emailDelivery = null;
      try {
        await client.query("BEGIN");
        const currentResult = await client.query(
          `SELECT *, to_char(check_in, 'YYYY-MM-DD') AS check_in_date,
             to_char(check_out, 'YYYY-MM-DD') AS check_out_date
           FROM bookings WHERE id = $1 FOR UPDATE`,
          [request.params.id],
        );
        const current = currentResult.rows[0];
        if (!current) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Booking not found" });
        }

        const status = request.body.status || current.status;
        const allowedTransitions = {
          Pending: ["Confirmed", "Rejected", "Cancelled"],
          Confirmed: ["CheckedIn", "Cancelled", "NoShow"],
          CheckedIn: ["CheckedOut"],
          CheckedOut: [],
          Cancelled: [],
          Rejected: [],
          NoShow: [],
        };
        if (
          status !== current.status &&
          !allowedTransitions[current.status]?.includes(status)
        ) {
          await client.query("ROLLBACK");
          return response.status(400).json({
            error: `Cannot change a ${current.status} booking to ${status}.`,
          });
        }

        const isRoomBooking = current.type === "room";
        const requestedRoomTypeId =
          request.body.roomTypeId ||
          (request.body.physicalRoomId !== undefined
            ? request.body.roomId
            : current.room_type_id);
        const requestedUnitId =
          request.body.unitId ||
          (request.body.roomTypeId
            ? request.body.roomId
            : request.body.physicalRoomId);
        const editsDatesOrRoom =
          request.body.roomTypeId !== undefined ||
          request.body.roomId !== undefined ||
          request.body.physicalRoomId !== undefined ||
          request.body.checkIn !== undefined ||
          request.body.checkOut !== undefined;
        if (editsDatesOrRoom && (!isRoomBooking || !["Confirmed", "CheckedIn"].includes(current.status))) {
          await client.query("ROLLBACK");
          return response.status(400).json({
            error: "Only confirmed or checked-in room bookings can be edited.",
          });
        }

        let roomTypeId = requestedRoomTypeId;
        let roomName = current.room_name;
        let checkIn = request.body.checkIn || current.check_in_date;
        let checkOut = request.body.checkOut || current.check_out_date;
        if (
          status === "Confirmed" &&
          current.status === "Pending" &&
          checkOut < propertyToday()
        ) {
          await client.query("ROLLBACK");
          return response.status(400).json({
            error: "Dates have passed. This Pending booking can only be rejected.",
          });
        }
        if (
          isRoomBooking &&
          !validStay(
            String(checkIn).slice(0, 10),
            String(checkOut).slice(0, 10),
          )
        ) {
          await client.query("ROLLBACK");
          return response.status(400).json({
            error: "Choose valid dates with check-out after check-in.",
          });
        }
        if (isRoomBooking) {
          checkIn = String(checkIn).slice(0, 10);
          checkOut = String(checkOut).slice(0, 10);
          if (
            (request.body.checkIn &&
              request.body.checkIn !== current.check_in_date &&
              checkIn < propertyToday()) ||
            (request.body.checkOut &&
              request.body.checkOut !== current.check_out_date &&
              checkOut < propertyToday())
          ) {
            await client.query("ROLLBACK");
            return response.status(400).json({
              error:
                "Bookings in the past are read-only except for status corrections.",
            });
          }
          const roomIds = [...new Set([current.room_type_id, roomTypeId])].sort();
          const roomsResult = await client.query(
            `SELECT id, name, inventory, active FROM rooms
             WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
            [roomIds],
          );
          const roomsById = new Map(
            roomsResult.rows.map((room) => [room.id, room]),
          );
          const room = roomsById.get(roomTypeId);
          if (!room || (!room.active && isBlockingStatus(status))) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: "This room type is no longer available for booking.",
            });
          }
          roomName = room.name;

          if (isBlockingStatus(status)) {
            const booked = await getRoomBookingAvailability(
              client,
              roomTypeId,
              checkIn,
              checkOut,
              current.id,
            );
            if (booked >= room.inventory) {
              const conflicts = await getRoomBookingConflicts(
                client,
                roomTypeId,
                checkIn,
                checkOut,
                current.id,
              );
              await client.query("ROLLBACK");
              return response.status(409).json({
                error: noRoomAvailableMessage(room.name),
                conflicts,
              });
            }
          }
        } else {
          roomTypeId = current.room_type_id;
          roomName = current.room_name;
          checkIn = null;
          checkOut = null;
        }

        let physicalRoomId = current.room_id;
        const shouldAssignRoom =
          isRoomBooking && isBlockingStatus(status);
        const confirmingPending =
          status === "Confirmed" && current.status === "Pending";
        if (
          shouldAssignRoom &&
          (editsDatesOrRoom || confirmingPending)
        ) {
          physicalRoomId = await assignPhysicalRoom(
            client,
            current.id,
            roomTypeId,
            checkIn,
            checkOut,
            requestedUnitId || null,
          );
          if (!physicalRoomId) {
            const conflicts = await getRoomBookingConflicts(
              client,
              roomTypeId,
              checkIn,
              checkOut,
              current.id,
            );
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: noRoomAvailableMessage(roomName),
              conflicts,
            });
          }
          if (
            current.status === "CheckedIn" &&
            physicalRoomId !== current.room_id
          ) {
            movedFromRoomId = current.room_id;
          }
        } else if (shouldAssignRoom && !current.room_id) {
          physicalRoomId = await assignPhysicalRoom(
            client,
            current.id,
            roomTypeId,
            checkIn,
            checkOut,
          );
          if (!physicalRoomId) {
            const conflicts = await getRoomBookingConflicts(
              client,
              roomTypeId,
              checkIn,
              checkOut,
              current.id,
            );
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: noRoomAvailableMessage(roomName),
              conflicts,
            });
          }
        }

        let finalCheckOut = checkOut;
        if (status === "CheckedOut" && status !== current.status) {
          finalCheckOut =
            request.body.checkOut ||
            (await client.query(
            "SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today",
          )).rows[0].today;
          if (finalCheckOut <= checkIn) {
            await client.query("ROLLBACK");
            return response.status(400).json({
              error: "Check-out must be after check-in.",
            });
          }
          checkedOutRoomId = current.room_id;
        }

        const result = await client.query(
          `UPDATE bookings
           SET status = $1, room_type_id = $2, room_name = $3,
             room_id = $4, check_in = $5::date, check_out = $6::date,
             updated_at = now()
           WHERE id = $7 RETURNING ${bookingColumns}`,
          [
            status,
            roomTypeId,
            roomName,
            physicalRoomId,
            checkIn,
            finalCheckOut,
            request.params.id,
          ],
        );
        const roomToMarkDirty = checkedOutRoomId || movedFromRoomId;
        if (roomToMarkDirty) {
          await client.query(
            `UPDATE physical_rooms
             SET housekeeping_status = 'Dirty', housekeeping_updated_at = now()
             WHERE id = $1`,
            [roomToMarkDirty],
          );
        }
        await client.query("COMMIT");
        updated = result.rows[0];
        if (status === "Confirmed" && current.status !== "Confirmed") {
          emailDelivery = await deliverConfirmation(updated);
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      response.json({ ...updated, emailDelivery });
    }),
  );

  router.post(
    "/admin/bookings/:id/undo",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query(
          `SELECT *, to_char(check_in, 'YYYY-MM-DD') AS check_in_date,
             to_char(check_out, 'YYYY-MM-DD') AS check_out_date
           FROM bookings WHERE id = $1 FOR UPDATE`,
          [request.params.id],
        );
        const current = selected.rows[0];
        if (!current) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Booking not found" });
        }
        const expectedTimestamp = new Date(request.body.expectedUpdatedAt).getTime();
        if (
          !Number.isFinite(expectedTimestamp) ||
          expectedTimestamp !== new Date(current.updated_at).getTime()
        ) {
          await client.query("ROLLBACK");
          return response.status(409).json({
            error: "This booking changed after the action. Refresh before undoing it.",
          });
        }

        const undoableStatuses = {
          Confirmed: ["Pending"],
          Rejected: ["Pending"],
          Cancelled: ["Pending", "Confirmed"],
          NoShow: ["Confirmed"],
          CheckedIn: ["Confirmed"],
          CheckedOut: ["CheckedIn"],
        };
        const previousStatus = request.body.previousStatus;
        if (!undoableStatuses[current.status]?.includes(previousStatus)) {
          await client.query("ROLLBACK");
          return response.status(400).json({
            error: `The ${current.status} action cannot be undone.`,
          });
        }
        if (
          previousStatus === "Pending" &&
          current.type === "room" &&
          current.check_out_date < propertyToday()
        ) {
          await client.query("ROLLBACK");
          return response.status(400).json({
            error: "Past-date Pending bookings can only be rejected.",
          });
        }

        let checkOut = current.check_out_date;
        if (previousStatus === "CheckedIn") {
          checkOut = request.body.previousCheckOut;
          if (!validStay(current.check_in_date, checkOut)) {
            await client.query("ROLLBACK");
            return response.status(400).json({
              error: "The original stay dates are invalid.",
            });
          }
        }

        let roomId = previousStatus === "Pending" ? null : current.room_id;
        if (current.type === "room" && isBlockingStatus(previousStatus)) {
          const roomResult = await client.query(
            "SELECT id, inventory FROM rooms WHERE id = $1 FOR UPDATE",
            [current.room_type_id],
          );
          const room = roomResult.rows[0];
          const booked = await getRoomBookingAvailability(
            client,
            current.room_type_id,
            current.check_in_date,
            checkOut,
            current.id,
          );
          if (!room || booked >= room.inventory) {
            await client.query("ROLLBACK");
            return response.status(409).json({
              error: "Room no longer available; this action cannot be undone.",
            });
          }
          if (previousStatus !== "Pending") {
            const assigned = await assignPhysicalRoom(
              client,
              current.id,
              current.room_type_id,
              current.check_in_date,
              checkOut,
              request.body.previousRoomId || current.room_id || null,
            );
            if (!assigned) {
              const conflicts = await getRoomBookingConflicts(
                client,
                current.room_type_id,
                current.check_in_date,
                checkOut,
                current.id,
              );
              await client.query("ROLLBACK");
              return response.status(409).json({
                error: `${noRoomAvailableMessage(current.room_name)} This action cannot be undone.`,
                conflicts,
              });
            }
            roomId = assigned;
          }
        }

        const result = await client.query(
          `UPDATE bookings
           SET status = $1, room_id = $2, check_out = $3::date, updated_at = now()
           WHERE id = $4 RETURNING ${bookingColumns}`,
          [previousStatus, roomId, checkOut, request.params.id],
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
       count(*) FILTER (WHERE type = 'room' AND check_in = (now() AT TIME ZONE 'Asia/Manila')::date AND status IN ('Pending', 'Confirmed'))::int AS checkins,
       count(*) FILTER (WHERE type = 'room' AND check_out = (now() AT TIME ZONE 'Asia/Manila')::date AND status = 'CheckedIn')::int AS checkouts
       FROM bookings`,
        ),
        pool.query(
          `SELECT id, guest_name AS "guestName", room_name AS "roomName", status
           FROM bookings
           WHERE type = 'room'
             AND check_in = (now() AT TIME ZONE 'Asia/Manila')::date
             AND status IN ('Pending', 'Confirmed')
           ORDER BY check_in, guest_name`,
        ),
        pool.query(
          `SELECT id, guest_name AS "guestName", room_name AS "roomName", status
           FROM bookings
           WHERE type = 'room'
             AND check_out <= (now() AT TIME ZONE 'Asia/Manila')::date
             AND status = 'CheckedIn'
           ORDER BY check_out, guest_name`,
        ),
        pool.query(
          `SELECT count(*)::int AS total,
             count(*) FILTER (WHERE physical.housekeeping_status = 'Clean')::int AS ready,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM bookings
               WHERE room_id = physical.id
                 AND status IN ('Pending', 'Confirmed', 'CheckedIn')
                 AND check_in <= (now() AT TIME ZONE 'Asia/Manila')::date
                 AND check_out > (now() AT TIME ZONE 'Asia/Manila')::date
             ))::int AS occupied,
             count(*) FILTER (WHERE physical.housekeeping_status = 'Dirty')::int AS needs_cleaning
           FROM physical_rooms AS physical
           WHERE physical.active = true`,
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
      const [summary, bookings] = await Promise.all([
        pool.query(
          `SELECT count(*)::int AS total_bookings,
         count(*) FILTER (WHERE type = 'room')::int AS room_bookings,
         count(*) FILTER (WHERE type = 'event')::int AS event_bookings,
         count(*) FILTER (WHERE status = 'Pending')::int AS pending_bookings,
         count(*) FILTER (WHERE status = 'Confirmed')::int AS confirmed_bookings,
         count(*) FILTER (WHERE status = 'CheckedIn')::int AS checked_in_bookings,
         count(*) FILTER (WHERE status = 'Completed')::int AS completed_bookings,
         count(*) FILTER (WHERE status = 'Cancelled')::int AS cancelled_bookings
         FROM bookings WHERE created_at::date BETWEEN $1::date AND $2::date`,
          [start, end],
        ),
        pool.query(
          `SELECT ${bookingColumns} FROM bookings
           WHERE created_at::date BETWEEN $1::date AND $2::date
           ORDER BY created_at DESC, id DESC`,
          [start, end],
        ),
      ]);
      response.json({ ...summary.rows[0], bookings: bookings.rows });
    }),
  );

  router.get(
    "/admin/room-status",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const start = request.query.start || (await pool.query(
        "SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today",
      )).rows[0].today;
      const days = Number(request.query.days || 14);
      if (!validDate(start) || ![7, 14, 30].includes(days)) {
        return response.status(400).json({
          error: "Choose a valid start date and a 7, 14, or 30 day window.",
        });
      }

      const [rooms, unassignedBookings, stats] = await Promise.all([
        pool.query(
          `SELECT physical.id, physical.room_id AS "roomId",
             physical.unit_number AS "unitNumber", physical.room_label AS "roomLabel",
             room.name AS "roomType", room.sort_order AS "sortOrder",
             physical.housekeeping_status AS "housekeepingStatus",
             physical.housekeeping_updated_at AS "housekeepingUpdatedAt",
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id', booking.id,
                 'guestName', booking.guest_name,
                 'roomId', booking.room_type_id,
                 'roomTypeId', booking.room_type_id,
                 'physicalRoomId', booking.room_id,
                 'checkIn', to_char(booking.check_in, 'YYYY-MM-DD'),
                 'checkOut', to_char(booking.check_out, 'YYYY-MM-DD'),
                 'status', booking.status,
                 'source', booking.source,
                 'createdAt', booking.created_at
               ) ORDER BY booking.check_in, booking.id)
               FROM bookings AS booking
               WHERE booking.room_id = physical.id
                 AND booking.type = 'room'
                 AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn', 'CheckedOut')
                 AND booking.check_in < $1::date + $2::integer
                 AND (
                   booking.check_out > $1::date
                   OR (booking.status = 'CheckedIn' AND booking.check_out <= $1::date)
                 )
             ), '[]'::json) AS bookings,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'id', block.id,
                 'startDate', to_char(block.start_date, 'YYYY-MM-DD'),
                 'endDate', to_char(block.end_date, 'YYYY-MM-DD'),
                 'reason', block.reason
               ) ORDER BY block.start_date, block.id)
               FROM room_blocks AS block
               WHERE block.room_id = physical.id
                 AND daterange(block.start_date, block.end_date, '[)')
                   && daterange($1::date, $1::date + $2::integer, '[)')
             ), '[]'::json) AS blocks
           FROM physical_rooms AS physical
           JOIN rooms AS room ON room.id = physical.room_id
           WHERE physical.active = true AND room.active = true
           ORDER BY room.sort_order, room.name, physical.unit_number`,
          [start, days],
        ),
        pool.query(
          `SELECT booking.id, booking.guest_name AS "guestName",
             booking.room_type_id AS "roomTypeId",
             booking.room_name AS "roomType",
             to_char(booking.check_in, 'YYYY-MM-DD') AS "checkIn",
             to_char(booking.check_out, 'YYYY-MM-DD') AS "checkOut",
             booking.status
           FROM bookings AS booking
           WHERE booking.type = 'room'
             AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
             AND booking.room_id IS NULL
             AND booking.check_in < $1::date + $2::integer
             AND (
               booking.check_out > $1::date
               OR (booking.status = 'CheckedIn' AND booking.check_out <= $1::date)
             )
           ORDER BY booking.check_in, booking.id`,
          [start, days],
        ),
        pool.query(
          `WITH today AS (
             SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS date
           )
           SELECT
             (SELECT count(*)::int FROM bookings AS booking, today
              WHERE booking.type = 'room'
                AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
                AND booking.check_in <= today.date
                AND booking.check_out > today.date) AS occupied,
             (SELECT count(*)::int FROM bookings, today
              WHERE type = 'room' AND check_in = today.date
                AND status IN ('Pending', 'Confirmed')) AS arriving,
             (SELECT count(*)::int FROM bookings, today
              WHERE type = 'room' AND check_out = today.date
                AND status = 'CheckedIn') AS departing,
             (SELECT count(*)::int FROM physical_rooms
              WHERE active = true AND housekeeping_status = 'Dirty') AS dirty,
             (SELECT COALESCE(sum(GREATEST(
               0,
               room.inventory
               - (SELECT count(*) FROM bookings AS booking, today
                  WHERE booking.room_type_id = room.id
                    AND booking.type = 'room'
                    AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
                    AND booking.check_in <= today.date
                    AND booking.check_out > today.date)
               - (SELECT count(DISTINCT physical.id)
                  FROM physical_rooms AS physical
                  JOIN room_blocks AS block ON block.room_id = physical.id
                  CROSS JOIN today
                  WHERE physical.room_id = room.id AND physical.active = true
                    AND block.start_date <= today.date
                    AND block.end_date > today.date
                    AND NOT EXISTS (
                      SELECT 1 FROM bookings AS booking
                      WHERE booking.room_id = physical.id
                        AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
                        AND booking.check_in <= today.date
                        AND booking.check_out > today.date
                    ))
             )), 0)::int FROM rooms AS room WHERE room.active = true) AS available`,
        ),
      ]);
      response.json({
        rooms: rooms.rows,
        unassignedBookings: unassignedBookings.rows,
        stats: stats.rows[0],
        startDate: start,
        days,
      });
    }),
  );

  router.get(
    "/admin/room-status/:id/bookings",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        `SELECT physical.id, physical.room_label AS "roomLabel",
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', booking.id,
               'guestName', booking.guest_name,
               'checkIn', to_char(booking.check_in, 'YYYY-MM-DD'),
               'checkOut', to_char(booking.check_out, 'YYYY-MM-DD'),
               'status', booking.status,
               'createdAt', booking.created_at
             ) ORDER BY booking.created_at DESC, booking.id DESC)
             FROM bookings AS booking
             WHERE booking.room_id = physical.id
           ), '[]'::json) AS reservations
         FROM physical_rooms AS physical
         WHERE physical.id = $1 AND physical.active = true`,
        [request.params.id],
      );
      if (!result.rowCount) {
        return response.status(404).json({ error: "Room unit not found" });
      }
      response.json(result.rows[0]);
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
      const housekeepingStatus = request.body.housekeepingStatus;
      if (!["Clean", "Dirty"].includes(housekeepingStatus)) {
        return response
          .status(400)
          .json({ error: "Housekeeping status must be Clean or Dirty." });
      }
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
        const result = await client.query(
          `UPDATE physical_rooms
           SET housekeeping_status = $1, housekeeping_updated_at = now()
           WHERE id = $2
           RETURNING id, room_label AS "roomLabel",
             housekeeping_status AS "housekeepingStatus",
             housekeeping_updated_at AS "housekeepingUpdatedAt"`,
          [housekeepingStatus, request.params.id],
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

  router.post(
    "/admin/room-blocks",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const { roomId, startDate, endDate, reason } = request.body;
      if (
        !validText(roomId, 80) ||
        !validDate(startDate) ||
        !validDate(endDate) ||
        startDate < propertyToday() ||
        endDate <= startDate ||
        !validText(reason, 300)
      ) {
        return response.status(400).json({
          error: "Choose a room, dates starting today or later, and a reason.",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const roomType = await client.query(
          `SELECT id FROM rooms
           WHERE id = (SELECT room_id FROM physical_rooms
             WHERE id = $1 AND active = true)
             AND active = true
           FOR UPDATE`,
          [roomId],
        );
        if (!roomType.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Room not found." });
        }
        const room = await client.query(
          "SELECT id FROM physical_rooms WHERE id = $1 AND active = true FOR UPDATE",
          [roomId],
        );
        if (!room.rowCount) {
          await client.query("ROLLBACK");
          return response.status(404).json({ error: "Room not found." });
        }

        const conflict = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM bookings
            WHERE (
              room_id = $1
              OR (
                room_id IS NULL
                AND room_type_id = (SELECT room_id FROM physical_rooms WHERE id = $1)
              )
            )
              AND status IN ('Pending', 'Confirmed', 'CheckedIn')
               AND daterange(check_in, check_out, '[)')
                 && daterange($2::date, $3::date, '[)')
           ) AS booking,
           EXISTS (
             SELECT 1 FROM room_blocks
             WHERE room_id = $1
               AND daterange(start_date, end_date, '[)')
                 && daterange($2::date, $3::date, '[)')
           ) AS block`,
          [roomId, startDate, endDate],
        );
        if (conflict.rows[0].booking || conflict.rows[0].block) {
          await client.query("ROLLBACK");
          return response.status(409).json({
            error: conflict.rows[0].booking
              ? "A booking already holds these dates. Move or cancel it first."
              : "This room already has a maintenance block during those dates.",
          });
        }

        const created = await client.query(
          `INSERT INTO room_blocks (room_id, start_date, end_date, reason)
           VALUES ($1, $2, $3, $4)
           RETURNING id, room_id AS "roomId",
             to_char(start_date, 'YYYY-MM-DD') AS "startDate",
             to_char(end_date, 'YYYY-MM-DD') AS "endDate", reason`,
          [roomId, startDate, endDate, reason.trim()],
        );
        await client.query("COMMIT");
        response.status(201).json(created.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  router.delete(
    "/admin/room-blocks/:id",
    requireAdmin,
    asyncRoute(async (request, response) => {
      const result = await pool.query(
        "DELETE FROM room_blocks WHERE id = $1 RETURNING id",
        [request.params.id],
      );
      if (!result.rowCount) {
        return response.status(404).json({ error: "Room block not found." });
      }
      response.status(204).end();
    }),
  );

  router.use((error, _request, response, _next) => {
    console.error("API request failed:", error);
    if (error.code === "23P01") {
      return response
        .status(409)
        .json({ error: "Room no longer available" });
    }
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
