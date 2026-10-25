import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  defaultContent,
  defaultGallery,
  defaultHeroImages,
  defaultRooms,
} from "./default-content.js";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));

export async function initializeDatabase(pool) {
  const schema = await readFile(schemaPath, "utf8");
  await pool.query(schema);

  await pool.query(
    `INSERT INTO site_content (content_key, content_value)
     VALUES ('public', $1::jsonb)
     ON CONFLICT (content_key) DO NOTHING`,
    [JSON.stringify(defaultContent)],
  );

  await pool.query(
    `UPDATE site_content
     SET content_value = jsonb_set(content_value, '{heroTagline}', to_jsonb($1::text))
     WHERE content_key = 'public'
       AND content_value->>'heroTagline' = $2`,
    [
      defaultContent.heroTagline,
      "Your fun and peaceful escape from the everyday rush.",
    ],
  );

  const localSiteImages = [
    ["heroImage", "photo-1540541338287-41700207dee6", "/images/hero.jpg"],
    ["eventsImage", "photo-1519225421980-715cb0215aed", "/images/events.jpg"],
  ];
  for (const [key, sourceId, localPath] of localSiteImages) {
    await pool.query(
      `UPDATE site_content
       SET content_value = jsonb_set(content_value, '{${key}}', to_jsonb($1::text))
       WHERE content_key = 'public' AND content_value->>'${key}' LIKE $2`,
      [localPath, `%${sourceId}%`],
    );
  }

  const localRoomImages = [
    [
      "standard",
      "photo-1618773928121-c32242fa11f5",
      "/images/room-standard.png",
    ],
    ["twin", "photo-1598928506311-c55dd580e5cb", "/images/room-twin.png"],
    ["couple", "photo-1522771739844-6a9f6d5f14af", "/images/room-couple.png"],
    ["family", "photo-1586023492125-27b2c045efd7", "/images/room-family.png"],
    ["villa", "photo-1582268611958-ebfd161ef9cf", "/images/Garden.jpg"],
  ];
  for (const [id, sourceId, localPath] of localRoomImages) {
    const legacyPath =
      id === "villa" ? "/images/room-villa.jpg" : localPath.replace(".png", ".jpg");
    await pool.query(
      `UPDATE rooms SET image = $1
       WHERE id = $2 AND (image LIKE $3 OR image = $4)`,
      [localPath, id, `%${sourceId}%`, legacyPath],
    );
  }

  const localGalleryImages = [
    ["photo-1571896349842-33c89424de2d", "/images/gallery-01.jpg"],
    ["photo-1576013551627-1140e6c64147", "/images/gallery-02.jpg"],
    ["photo-1582719478250-c89cae4dc85b", "/images/gallery-03.jpg"],
    ["photo-1530103862676-de8892bf309c", "/images/gallery-04.jpg"],
    ["photo-1499696010180-025ef6e1a8f9", "/images/gallery-05.jpg"],
    ["photo-1540541338287-41700207dee6", "/images/hero.jpg"],
    ["photo-1618773928121-c32242fa11f5", "/images/room-standard.png"],
    ["photo-1519225421980-715cb0215aed", "/images/events.jpg"],
  ];
  for (const [sourceId, localPath] of localGalleryImages) {
    await pool.query(
      "UPDATE gallery_images SET url = $1 WHERE url LIKE $2 OR url = $3",
      [localPath, `%${sourceId}%`, localPath.replace(".png", ".jpg")],
    );
  }

  const roomCount = await pool.query(
    "SELECT count(*)::int AS count FROM rooms",
  );
  if (roomCount.rows[0].count === 0) {
    for (const [index, room] of defaultRooms.entries()) {
      await pool.query(
        `INSERT INTO rooms (id, name, capacity, rate, inclusions, inventory, image, sort_order)
         VALUES ($1, $2, $3, $4, COALESCE($5, ''), $6, $7, $8)`,
        [
          room.id,
          room.name,
          room.capacity,
          room.rate,
          room.inclusions,
          room.inventory,
          room.image,
          index,
        ],
      );
    }
  }

  const galleryCount = await pool.query(
    "SELECT count(*)::int AS count FROM gallery_images",
  );
  if (galleryCount.rows[0].count === 0) {
    for (const [index, url] of defaultGallery.entries()) {
      await pool.query(
        "INSERT INTO gallery_images (url, alt_text, sort_order) VALUES ($1, $2, $3)",
        [url, `Citi Cabana gallery photo ${index + 1}`, index + 1],
      );
    }
  }

  const heroImageCount = await pool.query(
    "SELECT count(*)::int AS count FROM hero_images",
  );
  if (heroImageCount.rows[0].count === 0) {
    for (const [index, image] of defaultHeroImages.entries()) {
      await pool.query(
        "INSERT INTO hero_images (url, alt_text, sort_order) VALUES ($1, $2, $3)",
        [image.url, image.alt, index + 1],
      );
    }
  }

  const villaPlaceholderSeed = await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ('villa-carousel-placeholders-v1', 'applied')
     ON CONFLICT (setting_key) DO NOTHING
     RETURNING setting_key`,
  );
  if (villaPlaceholderSeed.rowCount) {
    const villa = await pool.query(
      "SELECT id FROM rooms WHERE id = 'villa' AND active = true",
    );
    if (villa.rowCount) {
      for (const [index, image] of [
        "/images/gallery-01.jpg",
        "/images/gallery-02.jpg",
      ].entries()) {
        await pool.query(
          `INSERT INTO room_images (room_id, url, alt_text, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [
            villa.rows[0].id,
            image,
            `Villa image placeholder ${index + 1}`,
            index + 1,
          ],
        );
      }
    }
  }
  await syncPhysicalRooms(pool);
  await pool.query(
    `UPDATE physical_rooms AS physical
     SET status = 'Ready', last_updated = now()
     WHERE physical.status = 'Occupied'
       AND NOT EXISTS (
         SELECT 1 FROM bookings
         WHERE physical_room_id = physical.id
           AND status IN ('Confirmed', 'CheckedIn')
           AND check_in <= CURRENT_DATE
           AND check_out > CURRENT_DATE
       )`,
  );
  await syncRoomBookingAssignments(pool);
  await pool.query(
    `UPDATE physical_rooms AS physical
     SET status = 'Occupied', last_updated = now()
     WHERE EXISTS (
       SELECT 1 FROM bookings
       WHERE physical_room_id = physical.id
         AND status IN ('Confirmed', 'CheckedIn')
         AND check_in <= CURRENT_DATE
         AND check_out > CURRENT_DATE
     )`,
  );
}

async function syncRoomBookingAssignments(pool) {
  const bookings = await pool.query(
    `SELECT id, room_id, check_in, check_out, status
     FROM bookings
     WHERE type = 'room'
       AND status IN ('Pending', 'Confirmed', 'CheckedIn')
       AND physical_room_id IS NULL
       AND room_id IS NOT NULL
     ORDER BY CASE WHEN status = 'Pending' THEN 1 ELSE 0 END,
       check_in, id`,
  );
  let unassigned = 0;

  for (const booking of bookings.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
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
        [booking.room_id, booking.id, booking.check_in, booking.check_out],
      );
      const physicalRoomId = result.rows[0]?.id;
      if (!physicalRoomId) {
        await client.query("ROLLBACK");
        unassigned += 1;
        continue;
      }

      await client.query(
        `UPDATE physical_rooms SET status = 'Occupied', last_updated = now()
         WHERE id = $1 AND EXISTS (
           SELECT 1 FROM bookings
           WHERE id = $2 AND status IN ('Confirmed', 'CheckedIn')
             AND check_in <= CURRENT_DATE AND check_out > CURRENT_DATE
         )`,
        [physicalRoomId, booking.id],
      );
      await client.query(
        "UPDATE bookings SET physical_room_id = $1 WHERE id = $2",
        [physicalRoomId, booking.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (unassigned > 0) {
    console.error(
      `Could not assign ${unassigned} active room booking(s) to physical units. Check room inventory, date overlaps, and room cleaning status.`,
    );
  }
}

export async function syncPhysicalRooms(pool, roomId = null) {
  await pool.query(
    `UPDATE physical_rooms AS physical
     SET room_id = room.id,
         unit_number = COALESCE(
           NULLIF(substring(physical.id FROM '([0-9]+)$'), '')::integer,
           1
         )
     FROM rooms AS room
     WHERE physical.room_id IS NULL
       AND (
         regexp_replace(physical.room_label, ' [0-9]+$', '') = room.name
         OR lower(physical.room_label) = lower(split_part(room.name, ' ', 1))
       )`,
  );
  await pool.query(
    "UPDATE physical_rooms SET active = false WHERE room_id IS NULL",
  );

  const values = roomId ? [roomId] : [];
  const filter = roomId ? "WHERE id = $1" : "";
  const rooms = await pool.query(
    `SELECT id, name, inventory, active FROM rooms ${filter} ORDER BY name`,
    values,
  );

  for (const room of rooms.rows) {
    if (!room.active) {
      await pool.query(
        "UPDATE physical_rooms SET active = false WHERE room_id = $1",
        [room.id],
      );
      continue;
    }

    await pool.query(
      "UPDATE physical_rooms SET active = false WHERE room_id = $1 AND unit_number > $2",
      [room.id, room.inventory],
    );

    for (let unitNumber = 1; unitNumber <= room.inventory; unitNumber += 1) {
      const roomLabel = `${room.name} ${unitNumber}`;
      await pool.query(
        `INSERT INTO physical_rooms (id, room_id, unit_number, room_label, status)
         VALUES ($1, $2, $3, $4, 'Ready')
         ON CONFLICT (room_id, unit_number)
         DO UPDATE SET room_label = EXCLUDED.room_label, active = true`,
        [`${room.id}-${unitNumber}`, room.id, unitNumber, roomLabel],
      );
    }
  }
}
