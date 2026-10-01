-- Studio F360 · időpontfoglaló · migráció a Lilla-körhöz (2026-10-01)
-- A kód (schema.js, sema()) az első kérésnél magától lefuttatja, ha egy oszlop hiányzik; kézi futtatás
-- nem kötelező. Ha mégis kézzel futtatnád, ELŐTTE mentés:
--   wrangler d1 export f360-booking --remote --output f360-booking-mentes-2026-10-01.sql
--   wrangler d1 execute f360-booking --remote --file functions/_lib/booking/migracio-2026-10-01.sql
-- Mind NULL-ozható vagy alapértékes oszlop: a meglévő sorok nem változnak. Másodszori futtatásra
-- "duplicate column name" hibát ad (a SQLite ADD COLUMN-nak nincs IF NOT EXISTS ága), az ártalmatlan.

ALTER TABLE bookings ADD COLUMN emlekeztetve_at INTEGER;
ALTER TABLE bookings ADD COLUMN forras TEXT;
ALTER TABLE outbox ADD COLUMN hiba TEXT;
ALTER TABLE outbox ADD COLUMN probalkozas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN zarolva_at INTEGER;
ALTER TABLE outbox ADD COLUMN kuldve_at INTEGER;
ALTER TABLE outbox ADD COLUMN provider_id TEXT;
CREATE INDEX IF NOT EXISTS outbox_kuldendo ON outbox (sent, id);
