CREATE TABLE IF NOT EXISTS site_content (
  content_key text PRIMARY KEY,
  content_value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  name text NOT NULL,
  capacity text NOT NULL,
  rate numeric(10, 2) NOT NULL CHECK (rate >= 0),
  inclusions text NOT NULL DEFAULT '',
  inventory integer NOT NULL DEFAULT 1 CHECK (inventory > 0),
  image text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gallery_images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('room', 'event')),
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Confirmed', 'Cancelled', 'Completed', 'CheckedIn')),
  guest_name text NOT NULL,
  contact text NOT NULL,
  notes text NOT NULL DEFAULT '',
  room_id text REFERENCES rooms(id) ON DELETE SET NULL,
  room_name text,
  check_in date,
  check_out date,
  pax integer,
  event_type text,
  event_date date,
  guest_count integer,
  time_block text,
  downpayment_amount numeric(10, 2),
  downpayment_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (type = 'room' AND check_in IS NOT NULL AND check_out > check_in)
    OR (type = 'event' AND event_date IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS physical_rooms (
  id text PRIMARY KEY,
  room_id text REFERENCES rooms(id) ON DELETE CASCADE,
  unit_number integer,
  room_label text NOT NULL,
  status text NOT NULL DEFAULT 'Ready'
    CHECK (status IN ('Ready', 'Occupied', 'Needs Cleaning')),
  last_updated timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE physical_rooms
  ADD COLUMN IF NOT EXISTS room_id text REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE physical_rooms ADD COLUMN IF NOT EXISTS unit_number integer;
ALTER TABLE physical_rooms
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS physical_rooms_room_unit_unique
  ON physical_rooms (room_id, unit_number);

CREATE TABLE IF NOT EXISTS admins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);