CREATE TABLE IF NOT EXISTS site_content (
  content_key text PRIMARY KEY,
  content_value jsonb NOT NULL
);

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key text PRIMARY KEY,
  setting_value text NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  name text NOT NULL,
  capacity text NOT NULL,
  rate numeric(10, 2) NOT NULL CHECK (rate >= 0),
  inclusions text NOT NULL DEFAULT '',
  inventory integer NOT NULL DEFAULT 1 CHECK (inventory > 0),
  image text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS room_images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gallery_images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hero_images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('room', 'event')),
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Confirmed', 'CheckedIn', 'CheckedOut', 'Rejected', 'Cancelled', 'NoShow')),
  guest_name text NOT NULL,
  guest_email text NOT NULL DEFAULT '',
  contact text NOT NULL,
  notes text NOT NULL DEFAULT '',
  room_type_id text REFERENCES rooms(id) ON DELETE SET NULL,
  room_id text,
  room_name text,
  check_in date,
  check_out date,
  pax integer,
  event_type text,
  event_date date,
  guest_count integer,
  time_block text,
  source text NOT NULL DEFAULT 'public' CHECK (source IN ('public', 'admin')),
  downpayment_amount numeric(10, 2),
  downpayment_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (type = 'room' AND check_in IS NOT NULL AND check_out > check_in)
    OR (type = 'event' AND event_date IS NOT NULL)
  )
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_email text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'public';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_type_id text REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_allowed;
UPDATE bookings SET status = 'CheckedOut' WHERE status = 'Completed';
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_allowed
  CHECK (status IN ('Pending', 'Confirmed', 'CheckedIn', 'CheckedOut', 'Rejected', 'Cancelled', 'NoShow'));
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_source_check CHECK (source IN ('public', 'admin'));

CREATE TABLE IF NOT EXISTS physical_rooms (
  id text PRIMARY KEY,
  room_id text REFERENCES rooms(id) ON DELETE CASCADE,
  unit_number integer,
  room_label text NOT NULL,
  housekeeping_status text NOT NULL DEFAULT 'Clean'
    CHECK (housekeeping_status IN ('Clean', 'Dirty')),
  housekeeping_updated_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE physical_rooms
  ADD COLUMN IF NOT EXISTS room_id text REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE physical_rooms ADD COLUMN IF NOT EXISTS unit_number integer;
ALTER TABLE physical_rooms
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE physical_rooms
  ADD COLUMN IF NOT EXISTS housekeeping_status text NOT NULL DEFAULT 'Clean';
ALTER TABLE physical_rooms
  ADD COLUMN IF NOT EXISTS housekeeping_updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'physical_rooms' AND column_name = 'status'
  ) THEN
    EXECUTE $migration$
      UPDATE physical_rooms
      SET housekeeping_status = CASE
        WHEN status = 'Needs Cleaning' THEN 'Dirty'
        ELSE 'Clean'
      END
    $migration$;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'physical_rooms' AND column_name = 'last_updated'
    ) THEN
      EXECUTE 'UPDATE physical_rooms SET housekeeping_updated_at = COALESCE(last_updated, now())';
    END IF;
    ALTER TABLE physical_rooms DROP COLUMN status;
    ALTER TABLE physical_rooms DROP COLUMN IF EXISTS last_updated;
  END IF;
END
$$;
ALTER TABLE physical_rooms DROP CONSTRAINT IF EXISTS physical_rooms_housekeeping_status_check;
ALTER TABLE physical_rooms
  ADD CONSTRAINT physical_rooms_housekeeping_status_check
  CHECK (housekeeping_status IN ('Clean', 'Dirty'));
CREATE UNIQUE INDEX IF NOT EXISTS physical_rooms_room_unit_unique
  ON physical_rooms (room_id, unit_number);

CREATE TABLE IF NOT EXISTS room_blocks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id text NOT NULL REFERENCES physical_rooms(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS room_blocks_room_dates_idx
  ON room_blocks (room_id, start_date, end_date);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings' AND column_name = 'physical_room_id'
  ) THEN
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_physical_room_no_overlap;
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_id_fkey;
    UPDATE bookings
    SET room_type_id = COALESCE(room_type_id, room_id),
        room_id = physical_room_id
    WHERE type = 'room';
    UPDATE bookings SET room_id = NULL WHERE status = 'Pending';
    ALTER TABLE bookings DROP COLUMN physical_room_id;
  END IF;
  UPDATE bookings AS booking
  SET room_type_id = room.id
  FROM rooms AS room
  WHERE booking.type = 'room'
    AND booking.room_type_id IS NULL
    AND lower(booking.room_name) = lower(room.name);
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_id_fkey;
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES physical_rooms(id) ON DELETE SET NULL;
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_type_id_fkey;
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_room_type_id_fkey
    FOREIGN KEY (room_type_id) REFERENCES rooms(id) ON DELETE SET NULL;
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_type_required;
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_room_type_required
    CHECK (type <> 'room' OR room_type_id IS NOT NULL);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_physical_room_no_overlap'
      AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_physical_room_no_overlap
      EXCLUDE USING gist (
        room_id WITH =,
        daterange(check_in, check_out, '[)') WITH &&
      )
      WHERE (
        type = 'room'
        AND room_id IS NOT NULL
        AND status IN ('Pending', 'Confirmed', 'CheckedIn')
      );
  END IF;
END
$$;
DROP INDEX IF EXISTS bookings_physical_room_id_idx;
CREATE INDEX IF NOT EXISTS bookings_room_id_idx
  ON bookings (room_id)
  WHERE room_id IS NOT NULL;
DROP INDEX IF EXISTS bookings_room_dates_active_idx;
CREATE INDEX IF NOT EXISTS bookings_room_dates_active_idx
  ON bookings (room_type_id, check_in, check_out)
  WHERE type = 'room' AND status IN ('Pending', 'Confirmed', 'CheckedIn');

CREATE TABLE IF NOT EXISTS admins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);