-- Replace this script's synthetic demo records with exactly 120 realistic
-- sample bookings: 96 room stays and 24 events.
-- Run after the app has initialized the schema, rooms, physical rooms, and blocks.
-- The transaction changes only bookings marked with demo.guest.NNN@example.com.

BEGIN;

DELETE FROM bookings
WHERE guest_email ~ '^demo\.guest\.[0-9]{3}@example\.com$';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rooms WHERE active = true) THEN
    RAISE EXCEPTION 'No active room types found. Start the app once before seeding demo bookings.';
  END IF;
END
$$;

WITH property_clock AS (
  SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS today
),
active_types AS (
  SELECT
    id,
    name,
    row_number() OVER (ORDER BY sort_order, id)::integer AS type_number,
    count(*) OVER ()::integer AS type_count
  FROM rooms
  WHERE active = true
),
room_numbers AS (
  SELECT
    n,
    n - n / 5 AS room_number
  FROM generate_series(1, 120) AS generated(n)
  WHERE n % 5 <> 0
),
room_type_assignment AS (
  SELECT
    room_numbers.n,
    room_numbers.room_number,
    active_types.id AS room_type_id,
    active_types.name AS room_name,
    active_types.type_number,
    row_number() OVER (
      PARTITION BY active_types.id
      ORDER BY room_numbers.room_number
    )::integer AS room_sequence
  FROM room_numbers
  JOIN active_types
    ON active_types.type_number =
      ((room_numbers.room_number - 1) % active_types.type_count) + 1
),
room_statuses AS (
  SELECT
    assignment.*,
    clock.today,
    CASE
      WHEN room_sequence <= 4 THEN 'CheckedOut'
      WHEN room_sequence = 5 THEN 'Cancelled'
      WHEN room_sequence = 6 THEN 'Rejected'
      WHEN room_sequence = 7 THEN 'NoShow'
      WHEN room_sequence = 8 THEN 'Pending'
      WHEN room_sequence = 9 THEN 'CheckedIn'
      WHEN room_sequence = 10 THEN 'Confirmed'
      WHEN room_sequence = 11 THEN 'Pending'
      WHEN room_sequence % 2 = 0 THEN 'Confirmed'
      ELSE 'Pending'
    END AS status,
    CASE
      WHEN room_sequence <= 4
        THEN clock.today - (60 - room_sequence * 7)
      WHEN room_sequence = 5 THEN clock.today - 26
      WHEN room_sequence = 6 THEN clock.today - 19
      WHEN room_sequence = 7 THEN clock.today - 12
      WHEN room_sequence = 8 THEN clock.today - 6
      WHEN room_sequence = 9 THEN
        CASE assignment.type_number % 3
          WHEN 1 THEN clock.today
          WHEN 2 THEN clock.today - 1
          ELSE clock.today + 1
        END - 2
      WHEN room_sequence = 10 THEN
        GREATEST(
          clock.today,
          CASE assignment.type_number % 3
            WHEN 1 THEN clock.today
            WHEN 2 THEN clock.today - 1
            ELSE clock.today + 1
          END
        )
      WHEN room_sequence = 11 THEN
        GREATEST(
          clock.today + 2,
          CASE assignment.type_number % 3
            WHEN 1 THEN clock.today
            WHEN 2 THEN clock.today - 1
            ELSE clock.today + 1
          END + 2
        )
      ELSE clock.today + 7 + (room_sequence - 12) * 5
    END AS check_in,
    CASE
      WHEN room_sequence <= 4
        THEN clock.today - (60 - room_sequence * 7) + 2 + room_sequence % 2
      WHEN room_sequence BETWEEN 5 AND 7
        THEN CASE room_sequence
          WHEN 5 THEN clock.today - 24
          WHEN 6 THEN clock.today - 17
          ELSE clock.today - 10
        END
      WHEN room_sequence = 8 THEN clock.today - 4
      WHEN room_sequence = 9 THEN
        CASE assignment.type_number % 3
          WHEN 1 THEN clock.today
          WHEN 2 THEN clock.today - 1
          ELSE clock.today + 1
        END
      WHEN room_sequence IN (10, 11) THEN
        CASE
          WHEN room_sequence = 10 THEN
            GREATEST(
              clock.today,
              CASE assignment.type_number % 3
                WHEN 1 THEN clock.today
                WHEN 2 THEN clock.today - 1
                ELSE clock.today + 1
              END
            ) + 2
          ELSE
            GREATEST(
              clock.today + 2,
              CASE assignment.type_number % 3
                WHEN 1 THEN clock.today
                WHEN 2 THEN clock.today - 1
                ELSE clock.today + 1
              END + 2
            ) + 2
        END
      ELSE clock.today + 7 + (room_sequence - 12) * 5
        + 2 + room_sequence % 2
    END AS check_out
  FROM room_type_assignment AS assignment
  CROSS JOIN property_clock AS clock
)
INSERT INTO bookings (
  type, status, guest_name, guest_email, contact, notes,
  room_type_id, room_name, check_in, check_out, pax, source,
  created_at, updated_at
)
SELECT
  'room',
  status,
  (ARRAY[
    'Maria', 'Jose', 'Ana', 'Miguel', 'Angela', 'Carlos', 'Sofia',
    'Daniel', 'Isabella', 'Gabriel', 'Patricia', 'Rafael', 'Camille',
    'Andres', 'Mikaela', 'Paolo', 'Nicole', 'Joshua', 'Bea', 'Enzo'
  ])[((n - 1) % 20) + 1]
    || ' ' ||
  (ARRAY[
    'Santos', 'Reyes', 'Cruz', 'Garcia', 'Mendoza', 'Ramos'
  ])[((n - 1) / 20) + 1],
  'demo.guest.' || lpad(n::text, 3, '0') || '@example.com',
  '+63 917 555 ' || lpad(n::text, 4, '0'),
  CASE room_sequence % 5
    WHEN 0 THEN 'DEMO DATA: late afternoon arrival; please note the requested check-in time.'
    WHEN 1 THEN 'DEMO DATA: family stay; guest requested extra towels.'
    WHEN 2 THEN 'DEMO DATA: returning guest; quiet room requested if available.'
    WHEN 3 THEN 'DEMO DATA: celebration stay; arrival details to be confirmed.'
    ELSE 'DEMO DATA: sample reservation for front-desk workflow testing.'
  END,
  room_type_id,
  room_name,
  check_in,
  check_out,
  CASE lower(room_type_id)
    WHEN 'standard' THEN 1 + n % 2
    WHEN 'twin' THEN 2 + n % 3
    WHEN 'couple' THEN 1 + n % 2
    WHEN 'family' THEN 4 + n % 3
    WHEN 'villa' THEN 6 + n % 5
    ELSE 2
  END,
  'admin',
  CASE
    WHEN status IN ('CheckedOut', 'Cancelled', 'Rejected', 'NoShow')
      THEN (check_in - 7)::timestamp AT TIME ZONE 'Asia/Manila'
    WHEN room_sequence = 8 THEN (today - 8)::timestamp AT TIME ZONE 'Asia/Manila'
    WHEN status = 'CheckedIn' THEN (today - 2)::timestamp AT TIME ZONE 'Asia/Manila'
    ELSE (today - (room_sequence % 9))::timestamp AT TIME ZONE 'Asia/Manila'
  END,
  CASE
    WHEN status IN ('CheckedOut', 'Cancelled', 'Rejected', 'NoShow')
      THEN (check_in - 7)::timestamp AT TIME ZONE 'Asia/Manila'
    WHEN room_sequence = 8 THEN (today - 8)::timestamp AT TIME ZONE 'Asia/Manila'
    WHEN status = 'CheckedIn' THEN (today - 2)::timestamp AT TIME ZONE 'Asia/Manila'
    ELSE (today - (room_sequence % 9))::timestamp AT TIME ZONE 'Asia/Manila'
  END
FROM room_statuses;

WITH property_clock AS (
  SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS today
),
event_rows AS (
  SELECT
    n,
    row_number() OVER (ORDER BY n)::integer AS event_sequence
  FROM generate_series(1, 120) AS generated(n)
  WHERE n % 5 = 0
),
event_details AS (
  SELECT
    event_rows.*,
    clock.today,
    CASE event_sequence % 6
      WHEN 1 THEN 'CheckedOut'
      WHEN 2 THEN 'Confirmed'
      WHEN 3 THEN 'Pending'
      WHEN 4 THEN 'Cancelled'
      WHEN 5 THEN 'Rejected'
      ELSE 'NoShow'
    END AS status
  FROM event_rows
  CROSS JOIN property_clock AS clock
)
INSERT INTO bookings (
  type, status, guest_name, guest_email, contact, notes,
  event_type, event_date, guest_count, time_block, source,
  created_at, updated_at
)
SELECT
  'event',
  status,
  (ARRAY[
    'Maria', 'Jose', 'Ana', 'Miguel', 'Angela', 'Carlos', 'Sofia',
    'Daniel', 'Isabella', 'Gabriel', 'Patricia', 'Rafael', 'Camille',
    'Andres', 'Mikaela', 'Paolo', 'Nicole', 'Joshua', 'Bea', 'Enzo'
  ])[((n - 1) % 20) + 1]
    || ' ' ||
  (ARRAY[
    'Santos', 'Reyes', 'Cruz', 'Garcia', 'Mendoza', 'Ramos'
  ])[((n - 1) / 20) + 1],
  'demo.guest.' || lpad(n::text, 3, '0') || '@example.com',
  '+63 917 555 ' || lpad(n::text, 4, '0'),
  'DEMO DATA: sample event inquiry for front-desk workflow testing.',
  (ARRAY[
    'Wedding Reception', 'Birthday Celebration', 'Baptism Reception',
    'Family Reunion', 'Corporate Gathering', 'Anniversary Celebration'
  ])[((event_sequence - 1) % 6) + 1],
  CASE
    WHEN status IN ('CheckedOut', 'Cancelled', 'Rejected', 'NoShow')
      THEN today - (5 + event_sequence * 2)
    ELSE today + (3 + event_sequence * 2)
  END,
  25 + (event_sequence * 7) % 176,
  (ARRAY['Morning', 'Afternoon', 'Evening', 'Full Day'])
    [((event_sequence - 1) % 4) + 1],
  'admin',
  CASE
    WHEN status IN ('CheckedOut', 'Cancelled', 'Rejected', 'NoShow')
      THEN ((today - (12 + event_sequence * 2))::timestamp AT TIME ZONE 'Asia/Manila')
    ELSE ((today - (event_sequence % 10))::timestamp AT TIME ZONE 'Asia/Manila')
  END,
  CASE
    WHEN status IN ('CheckedOut', 'Cancelled', 'Rejected', 'NoShow')
      THEN ((today - (12 + event_sequence * 2))::timestamp AT TIME ZONE 'Asia/Manila')
    ELSE ((today - (event_sequence % 10))::timestamp AT TIME ZONE 'Asia/Manila')
  END
FROM event_details;

DO $$
DECLARE
  booking_row record;
  assigned_room_id text;
BEGIN
  FOR booking_row IN
    SELECT id, room_type_id, check_in, check_out
    FROM bookings
    WHERE guest_email ~ '^demo\.guest\.[0-9]{3}@example\.com$'
      AND type = 'room'
      AND status IN ('Confirmed', 'CheckedIn')
      AND room_id IS NULL
    ORDER BY check_in, id
  LOOP
    SELECT physical.id
    INTO assigned_room_id
    FROM physical_rooms AS physical
    WHERE physical.room_id = booking_row.room_type_id
      AND physical.active = true
      AND NOT EXISTS (
        SELECT 1
        FROM bookings AS overlapping
        WHERE overlapping.room_id = physical.id
          AND overlapping.id <> booking_row.id
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

    IF assigned_room_id IS NULL THEN
      RAISE EXCEPTION
        'Could not assign demo booking % to an available unit of type %; no demo bookings were committed.',
        booking_row.id,
        booking_row.room_type_id;
    END IF;

    UPDATE bookings
    SET room_id = assigned_room_id
    WHERE id = booking_row.id;
  END LOOP;

  IF EXISTS (
    WITH booked_nights AS (
      SELECT
        booking.room_type_id,
        nights.night::date AS night,
        count(*)::integer AS booking_count
      FROM bookings AS booking
      CROSS JOIN LATERAL generate_series(
        booking.check_in::timestamp,
        (booking.check_out - 1)::timestamp,
        interval '1 day'
      ) AS nights(night)
      WHERE booking.type = 'room'
        AND booking.status IN ('Pending', 'Confirmed', 'CheckedIn')
      GROUP BY booking.room_type_id, nights.night::date
    ),
    blocked_nights AS (
      SELECT
        physical.room_id AS room_type_id,
        nights.night::date AS night,
        count(DISTINCT physical.id)::integer AS block_count
      FROM room_blocks AS block
      JOIN physical_rooms AS physical
        ON physical.id = block.room_id AND physical.active = true
      CROSS JOIN LATERAL generate_series(
        block.start_date::timestamp,
        (block.end_date - 1)::timestamp,
        interval '1 day'
      ) AS nights(night)
      GROUP BY physical.room_id, nights.night::date
    )
    SELECT 1
    FROM rooms AS room
    LEFT JOIN booked_nights AS booked
      ON booked.room_type_id = room.id
    LEFT JOIN blocked_nights AS blocked
      ON blocked.room_type_id = room.id
      AND blocked.night = booked.night
    WHERE room.active = true
      AND COALESCE(booked.booking_count, 0)
        + COALESCE(blocked.block_count, 0) > room.inventory
  ) THEN
    RAISE EXCEPTION
      'Demo stays exceed room-type capacity or overlap a maintenance block. No demo bookings were committed.';
  END IF;

  IF (
    SELECT count(*)
    FROM bookings
    WHERE guest_email ~ '^demo\.guest\.[0-9]{3}@example\.com$'
  ) <> 120 THEN
    RAISE EXCEPTION 'Expected exactly 120 demo bookings; seed transaction was rolled back.';
  END IF;
END
$$;

COMMIT;

SELECT
  type,
  status,
  count(*) AS bookings
FROM bookings
WHERE guest_email ~ '^demo\.guest\.[0-9]{3}@example\.com$'
GROUP BY type, status
ORDER BY type, status;
