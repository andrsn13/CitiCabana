-- Inserts 120 synthetic bookings for local testing.
-- Run after the app has initialized its PostgreSQL schema and default rooms.
-- Safe to run more than once: each demo email is inserted at most once.

BEGIN;

INSERT INTO rooms (id, name, capacity, rate, inclusions, inventory, image, sort_order)
VALUES
  ('standard', 'Standard Room', '2 pax (double bed)', 1000, 'Aircon, TV, private bathroom', 5, '/images/room-standard.png', 0),
  ('twin', 'Twin Room', '2-4 pax (2 separate beds)', 1500, 'Aircon, TV, private bathroom', 1, '/images/room-twin.png', 1),
  ('couple', 'Couple Room', '2 pax (queen bed)', 1500, 'Aircon, TV, private bathroom', 4, '/images/room-couple.png', 2),
  ('family', 'Family Room', '4-6 pax (2 double beds)', 2300, 'Aircon, TV, private bathroom', 2, '/images/room-family.png', 3),
  ('villa', 'Villa (private pool)', '10 pax', 9000, 'Aircon, TV, private bathroom, private pool', 1, '/images/Garden.jpg', 4)
ON CONFLICT (id) DO NOTHING;

WITH numbered AS (
  SELECT generate_series(1, 120) AS n
),
typed AS (
  SELECT
    n,
    CASE WHEN n % 4 = 0 THEN 'event' ELSE 'room' END AS type
  FROM numbered
),
classified AS (
  SELECT
    n,
    type,
    CASE
      WHEN type = 'room' AND n IN (1, 31, 61) THEN 'CheckedIn'
      WHEN type = 'event' THEN
        CASE (n / 4) % 4
          WHEN 0 THEN 'CheckedOut'
          WHEN 1 THEN 'Confirmed'
          WHEN 2 THEN 'Pending'
          ELSE 'Cancelled'
        END
      ELSE
        CASE ((n - 1) / 4) % 4
          WHEN 0 THEN 'CheckedOut'
          WHEN 1 THEN 'Confirmed'
          WHEN 2 THEN 'Pending'
          ELSE 'Cancelled'
        END
    END AS status
  FROM typed
),
seed_rows AS (
  SELECT
    n,
    type,
    status,
    CASE
      WHEN status IN ('CheckedOut', 'Cancelled')
        THEN current_timestamp - (125 + n % 60) * interval '1 day'
      WHEN status = 'CheckedIn'
        THEN current_timestamp - (n % 3) * interval '1 day'
      ELSE current_timestamp - (n % 90) * interval '1 day'
    END AS created_at,
    (ARRAY[
      'Maria', 'Jose', 'Ana', 'Miguel', 'Angela', 'Carlos', 'Sofia',
      'Daniel', 'Isabella', 'Gabriel', 'Patricia', 'Rafael', 'Camille',
      'Andres', 'Mikaela', 'Paolo', 'Nicole', 'Joshua', 'Bea', 'Enzo'
    ])[((n - 1) % 20) + 1]
      || ' ' ||
    (ARRAY[
      'Santos', 'Reyes', 'Cruz', 'Garcia', 'Mendoza', 'Ramos'
    ])[((n - 1) / 20) + 1] AS guest_name,
    CASE (n - 1) % 5
      WHEN 0 THEN 'standard'
      WHEN 1 THEN 'twin'
      WHEN 2 THEN 'couple'
      WHEN 3 THEN 'family'
      ELSE 'villa'
    END AS room_id
  FROM classified
)
INSERT INTO bookings (
  type, status, guest_name, guest_email, contact, notes, room_type_id, room_name,
  check_in, check_out, pax, event_type, event_date, guest_count, time_block,
  created_at
)
SELECT
  seed.type,
  seed.status,
  seed.guest_name,
  'demo.guest.' || lpad(seed.n::text, 3, '0') || '@example.com',
  '+63 900 555 ' || lpad(seed.n::text, 4, '0'),
  CASE seed.n % 5
    WHEN 0 THEN 'Sample booking for local testing; guest requested a quiet room.'
    WHEN 1 THEN 'Sample booking for local testing; arriving in the afternoon.'
    WHEN 2 THEN 'Sample booking for local testing; please prepare extra towels.'
    WHEN 3 THEN 'Sample booking for local testing; celebrating a family occasion.'
    ELSE 'Sample booking for local testing; dietary and arrival details to confirm.'
  END,
  CASE WHEN seed.type = 'room' THEN room.id END,
  CASE WHEN seed.type = 'room' THEN room.name END,
  CASE
    WHEN seed.type <> 'room' THEN NULL
    WHEN seed.status = 'CheckedIn' THEN current_date
    WHEN seed.status IN ('CheckedOut', 'Cancelled') THEN current_date - (1 + seed.n % 60)
    ELSE current_date + (2 + seed.n % 60)
  END,
  CASE
    WHEN seed.type <> 'room' THEN NULL
    WHEN seed.status = 'CheckedIn' THEN current_date + 1
    WHEN seed.status IN ('CheckedOut', 'Cancelled')
      THEN current_date - (1 + seed.n % 60) + (1 + seed.n % 3)
    ELSE current_date + (2 + seed.n % 60) + (1 + seed.n % 3)
  END,
  CASE room.id
    WHEN 'standard' THEN 1 + seed.n % 2
    WHEN 'twin' THEN 2 + seed.n % 3
    WHEN 'couple' THEN 1 + seed.n % 2
    WHEN 'family' THEN 4 + seed.n % 3
    WHEN 'villa' THEN 6 + seed.n % 5
  END,
  CASE
    WHEN seed.type <> 'event' THEN NULL
    ELSE (ARRAY['Wedding', 'Birthday', 'Baptism', 'Family Reunion', 'Corporate Gathering'])
      [((seed.n - 1) % 5) + 1]
  END,
  CASE
    WHEN seed.type <> 'event' THEN NULL
    WHEN seed.status IN ('CheckedOut', 'Cancelled') THEN current_date - (1 + seed.n % 60)
    ELSE current_date + (2 + seed.n % 60)
  END,
  CASE WHEN seed.type = 'event' THEN 20 + (seed.n * 7) % 181 END,
  CASE
    WHEN seed.type <> 'event' THEN NULL
    ELSE (ARRAY['Morning', 'Afternoon', 'Evening', 'Full Day'])
      [((seed.n - 1) % 4) + 1]
  END,
  seed.created_at
FROM seed_rows AS seed
LEFT JOIN rooms AS room ON room.id = seed.room_id
WHERE NOT EXISTS (
  SELECT 1
  FROM bookings AS existing
  WHERE existing.guest_email =
    'demo.guest.' || lpad(seed.n::text, 3, '0') || '@example.com'
);

DO $$
DECLARE
  booking_row record;
  assigned_room_id text;
BEGIN
  FOR booking_row IN
    SELECT id, room_type_id, check_in, check_out
    FROM bookings
    WHERE guest_email LIKE 'demo.guest.%@example.com'
      AND type = 'room'
      AND status IN ('Confirmed', 'CheckedIn')
      AND room_id IS NULL
    ORDER BY check_in, id
  LOOP
    assigned_room_id := NULL;
    SELECT physical.id INTO assigned_room_id
    FROM physical_rooms AS physical
    WHERE physical.room_id = booking_row.room_type_id
      AND physical.active = true
      AND NOT EXISTS (
        SELECT 1
        FROM bookings AS overlapping
        WHERE overlapping.room_id = physical.id
          AND overlapping.status IN ('Pending', 'Confirmed', 'CheckedIn')
          AND daterange(overlapping.check_in, overlapping.check_out, '[)')
            && daterange(booking_row.check_in, booking_row.check_out, '[)')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM room_blocks AS block
        WHERE block.room_id = physical.id
          AND daterange(block.start_date, block.end_date, '[)')
            && daterange(booking_row.check_in, booking_row.check_out, '[)')
      )
    ORDER BY physical.unit_number
    LIMIT 1
    FOR UPDATE OF physical SKIP LOCKED;

    IF assigned_room_id IS NOT NULL THEN
      UPDATE bookings SET room_id = assigned_room_id WHERE id = booking_row.id;
    END IF;
  END LOOP;
END
$$;

SELECT count(*) AS demo_bookings
FROM bookings
WHERE guest_email LIKE 'demo.guest.%@example.com';

COMMIT;
