-- Studio F360 · időpontfoglaló · D1 séma (kötés: BOOKING_DB, adatbázis: f360-booking)
-- Ugyanez a tartalom a functions/_lib/booking/schema.js SEMA tömbjében: a kód az első kérésnél
-- CREATE TABLE IF NOT EXISTS-szel létrehozza, kézi futtatás nem kötelező.
-- Kézi futtatás (opcionális): wrangler d1 execute f360-booking --remote --file functions/_lib/booking/schema.sql
-- A tests/foglalo-egyseg.test.mjs ellenőrzi, hogy a két helyen ugyanaz áll.
--
-- Idő: minden időpont Europe/Budapest helyi idő, date = 'YYYY-MM-DD', *_min = éjfél óta eltelt perc.
-- Törlés helyett állapot: a lemondott foglalás megmarad (status = 'lemondva').

CREATE TABLE IF NOT EXISTS settings (kulcs TEXT PRIMARY KEY, ertek TEXT NOT NULL, modositva INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS schedule (staff_id TEXT NOT NULL, weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), location_id TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, CHECK (start_min < end_min), PRIMARY KEY (staff_id, weekday, location_id, start_min));

CREATE TABLE IF NOT EXISTS exceptions (id TEXT PRIMARY KEY, staff_id TEXT, location_id TEXT, date_from TEXT NOT NULL, date_to TEXT NOT NULL, start_min INTEGER, end_min INTEGER, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);

-- emlekeztetve_at: mikor ment ki (outboxba) a páciens emlékeztetője; forras: kampány-adatok JSON-ban (UTM).
CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, service_id TEXT NOT NULL, staff_id TEXT NOT NULL, date TEXT NOT NULL, start_min INTEGER NOT NULL, dur_min INTEGER NOT NULL, buffer_min INTEGER NOT NULL, price INTEGER, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'megerositett' CHECK (status IN ('megerositett', 'lemondva')), source TEXT NOT NULL DEFAULT 'web', token_salt TEXT NOT NULL, created_at INTEGER NOT NULL, cancelled_at INTEGER, emlekeztetve_at INTEGER, forras TEXT);

CREATE INDEX IF NOT EXISTS bookings_date ON bookings (date, start_min);

-- Dupla foglalás tiltása: egy foglalás minden érintett 15 perces rácspontja (hossz + puffer) egy sor.
-- A PRIMARY KEY miatt ugyanarra a kollégára, napra és rácspontra két sor nem kerülhet be.
CREATE TABLE IF NOT EXISTS slot_locks (staff_id TEXT NOT NULL, date TEXT NOT NULL, slot_min INTEGER NOT NULL, booking_id TEXT NOT NULL, PRIMARY KEY (staff_id, date, slot_min));

CREATE INDEX IF NOT EXISTS slot_locks_booking ON slot_locks (booking_id);

CREATE INDEX IF NOT EXISTS slot_locks_date ON slot_locks (date);

-- Elkészült, de (bemutatóban) el nem küldött levelek. sent = 0 amíg nincs e-mail-szolgáltató.
-- sent: 0 = küldendő, 1 = elküldve, 2 = végleg sikertelen (hiba mezőben az ok). A küldő (mailer.js)
-- zarolva_at-tal foglalja le a sort, probalkozas számolja az újrapróbálást.
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT, tipus TEXT NOT NULL, cimzett TEXT NOT NULL, targy TEXT NOT NULL, html TEXT NOT NULL, szoveg TEXT NOT NULL, ics TEXT, sent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, hiba TEXT, probalkozas INTEGER NOT NULL DEFAULT 0, zarolva_at INTEGER, kuldve_at INTEGER, provider_id TEXT);

CREATE INDEX IF NOT EXISTS outbox_kuldendo ON outbox (sent, id);

-- Napi foglalási korlát IP-nként. Az IP csak napi sóval hash-elve kerül ide, 2 nap után törlődik.
CREATE TABLE IF NOT EXISTS foglalas_korlat (iph TEXT NOT NULL, nap TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (iph, nap));

-- Bemutató-tartalék: ha nincs BOOKING_SECRET env, a lemondó-token kulcsa itt él (véletlen, 32 bájt).
CREATE TABLE IF NOT EXISTS titkok (nev TEXT PRIMARY KEY, ertek TEXT NOT NULL);
