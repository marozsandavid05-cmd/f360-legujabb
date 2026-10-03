-- Studio F360 · időpontfoglaló · migráció az „Állandó időpont” körhöz (2026-10-03)
-- A kód (schema.js, sema()) az első kérésnél magától lefuttatja; kézi futtatás nem kötelező.
-- Ha mégis kézzel futtatnád, ELŐTTE mentés:
--   wrangler d1 export f360-booking --remote --output f360-booking-mentes-sorozat.sql
--   wrangler d1 execute f360-booking --remote --file functions/_lib/booking/migracio-sorozat.sql
-- Az új oszlop NULL-ozható: a meglévő foglalások nem változnak. Másodszori futtatásra az ALTER
-- "duplicate column name" hibát ad, az ártalmatlan.

CREATE TABLE IF NOT EXISTS sorozatok (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, service_id TEXT NOT NULL, staff_id TEXT NOT NULL, weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), start_min INTEGER NOT NULL, interval_het INTEGER NOT NULL CHECK (interval_het IN (1, 2)), kezdo_datum TEXT NOT NULL, vege_tipus TEXT NOT NULL CHECK (vege_tipus IN ('datum', 'alkalom', 'nyitott')), vege_datum TEXT, alkalmak_szama INTEGER, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'leallitva')), created_at INTEGER NOT NULL, leallitva_at INTEGER, leallitva_tol TEXT, gorditve_ig TEXT NOT NULL DEFAULT '', gordit_zar INTEGER);
CREATE INDEX IF NOT EXISTS sorozatok_allapot ON sorozatok (status, vege_tipus);
CREATE TABLE IF NOT EXISTS sorozat_kimaradt (sorozat_id TEXT NOT NULL, datum TEXT NOT NULL, ok TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (sorozat_id, datum));
ALTER TABLE bookings ADD COLUMN sorozat_id TEXT;
CREATE INDEX IF NOT EXISTS bookings_sorozat ON bookings (sorozat_id, date);
