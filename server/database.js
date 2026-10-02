import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  defaultContent,
  defaultGallery,
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
      "/images/room-standard.jpg",
    ],
    ["twin", "photo-1598928506311-c55dd580e5cb", "/images/room-twin.jpg"],
    ["couple", "photo-1522771739844-6a9f6d5f14af", "/images/room-couple.jpg"],
    ["family", "photo-1586023492125-27b2c045efd7", "/images/room-family.jpg"],
    ["villa", "photo-1582268611958-ebfd161ef9cf", "/images/room-villa.jpg"],
  ];
  for (const [id, sourceId, localPath] of localRoomImages) {
    await pool.query(
      "UPDATE rooms SET image = $1 WHERE id = $2 AND image LIKE $3",
      [localPath, id, `%${sourceId}%`],
    );
  }

  const localGalleryImages = [
    ["photo-1571896349842-33c89424de2d", "/images/gallery-01.jpg"],
    ["photo-1576013551627-1140e6c64147", "/images/gallery-02.jpg"],
    ["photo-1582719478250-c89cae4dc85b", "/images/gallery-03.jpg"],
    ["photo-1530103862676-de8892bf309c", "/images/gallery-04.jpg"],
    ["photo-1499696010180-025ef6e1a8f9", "/images/gallery-05.jpg"],
    ["photo-1540541338287-41700207dee6", "/images/hero.jpg"],
    ["photo-1618773928121-c32242fa11f5", "/images/room-standard.jpg"],
    ["photo-1519225421980-715cb0215aed", "/images/events.jpg"],
  ];
  for (const [sourceId, localPath] of localGalleryImages) {
    await pool.query("UPDATE gallery_images SET url = $1 WHERE url LIKE $2", [
      localPath,
      `%${sourceId}%`,
    ]);
  }

  const roomCount = await pool.query(
    "SELECT count(*)::int AS count FROM rooms",
  );
  if (roomCount.rows[0].count === 0) {
    for (const [index, room] of defaultRooms.entries()) {
      await pool.query(
        `INSERT INTO rooms (id, name, capacity, rate, inclusions, inventory, image, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

  await syncPhysicalRooms(pool);
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
    `SELECT id, name, inventory FROM rooms ${filter} ORDER BY name`,
    values,
  );

  for (const room of rooms.rows) {
    await pool.query(
      "UPDATE physical_rooms SET active = (unit_number <= $2) WHERE room_id = $1",
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
