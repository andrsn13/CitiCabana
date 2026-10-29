-- Restore CMS image selections to the bundled defaults.
-- This does not delete uploaded files or change bookings, room types, rates,
-- housekeeping, or other site text. Back up the database before running.

BEGIN;

INSERT INTO site_content (content_key, content_value)
VALUES (
  'public',
  jsonb_build_object(
    'heroImage', '/images/hero.jpg',
    'eventsImage', '/images/events.jpg'
  )
)
ON CONFLICT (content_key) DO UPDATE
SET content_value = site_content.content_value || EXCLUDED.content_value;

UPDATE rooms AS room
SET image = defaults.image
FROM (
  VALUES
    ('standard', '/images/room-standard.png'),
    ('twin', '/images/room-twin.png'),
    ('couple', '/images/room-couple.png'),
    ('family', '/images/room-family.png'),
    ('villa', '/images/Garden.jpg')
) AS defaults(id, image)
WHERE room.id = defaults.id;

DELETE FROM room_images;

INSERT INTO room_images (room_id, url, alt_text, sort_order)
SELECT room.id, defaults.url, defaults.alt_text, defaults.sort_order
FROM rooms AS room
CROSS JOIN (
  VALUES
    ('/images/gallery-01.jpg', 'Villa image placeholder 1', 1),
    ('/images/gallery-02.jpg', 'Villa image placeholder 2', 2)
) AS defaults(url, alt_text, sort_order)
WHERE room.id = 'villa' AND room.active = true;

DELETE FROM gallery_images;

INSERT INTO gallery_images (url, alt_text, sort_order)
VALUES
  ('/images/gallery-01.jpg', 'Citi Cabana gallery photo 1', 1),
  ('/images/gallery-02.jpg', 'Citi Cabana gallery photo 2', 2),
  ('/images/gallery-03.jpg', 'Citi Cabana gallery photo 3', 3),
  ('/images/gallery-04.jpg', 'Citi Cabana gallery photo 4', 4),
  ('/images/gallery-05.jpg', 'Citi Cabana gallery photo 5', 5),
  ('/images/hero.jpg', 'Citi Cabana gallery photo 6', 6),
  ('/images/room-standard.png', 'Citi Cabana gallery photo 7', 7),
  ('/images/events.jpg', 'Citi Cabana gallery photo 8', 8);

DELETE FROM hero_images;

INSERT INTO hero_images (url, alt_text, sort_order)
VALUES
  ('/images/Pool.jpg', 'Citi Cabana swimming pool', 1),
  ('/images/Garden.jpg', 'Citi Cabana garden', 2);

COMMIT;

SELECT
  (SELECT count(*) FROM room_images) AS room_images,
  (SELECT count(*) FROM gallery_images) AS gallery_images,
  (SELECT count(*) FROM hero_images) AS hero_images;
