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


-- Csoportos órák (2026-10). Óratípus → heti sablon → konkrét óra (session) → résztvevő.
-- A sablonból a generálás (orak.js oraGeneral) a következő 8 hétre hozza létre az órákat; a
-- UNIQUE (class_type_id, datum, kezd_min) miatt idempotens. Az óra a kapacitást és a hosszt a
-- létrehozáskor rögzíti (a típus későbbi módosítása a már létrehozott órákat nem írja át).
CREATE TABLE IF NOT EXISTS class_types (id TEXT PRIMARY KEY, nev TEXT NOT NULL, leiras TEXT NOT NULL DEFAULT '', helyszin_id TEXT NOT NULL, perc INTEGER NOT NULL, ar INTEGER, kapacitas INTEGER NOT NULL CHECK (kapacitas BETWEEN 1 AND 100), kategoria TEXT NOT NULL CHECK (kategoria IN ('joga', 'pilates', 'aerial', 'core', 'gerinc', 'egyeb')), aktiv INTEGER NOT NULL DEFAULT 1, kapacitas_megerositendo INTEGER NOT NULL DEFAULT 0, ar_megerositendo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS class_templates (id TEXT PRIMARY KEY, class_type_id TEXT NOT NULL, kollega_id TEXT, weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), kezd_min INTEGER NOT NULL, ervenyes_tol TEXT NOT NULL DEFAULT '', ervenyes_ig TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS class_sessions (id TEXT PRIMARY KEY, class_type_id TEXT NOT NULL, kollega_id TEXT, datum TEXT NOT NULL, kezd_min INTEGER NOT NULL, perc INTEGER NOT NULL, kapacitas INTEGER NOT NULL CHECK (kapacitas BETWEEN 1 AND 100), status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'elmarad')), megjegyzes TEXT NOT NULL DEFAULT '', template_id TEXT, created_at INTEGER NOT NULL, UNIQUE (class_type_id, datum, kezd_min));

CREATE INDEX IF NOT EXISTS class_sessions_datum ON class_sessions (datum, kezd_min);

-- A helyfoglalás a beszúrás feltételében atomikus: csak akkor kerül be a sor, ha a megerősített
-- résztvevők száma kisebb a kapacitásnál és az óra aktív. Egy e-mail egy órára egyszer (részleges UNIQUE).
CREATE TABLE IF NOT EXISTS class_bookings (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, nev TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', telefon TEXT NOT NULL DEFAULT '', megjegyzes TEXT NOT NULL DEFAULT '', ar INTEGER, status TEXT NOT NULL DEFAULT 'megerositett' CHECK (status IN ('megerositett', 'lemondva')), rogzites TEXT NOT NULL DEFAULT 'web', forras TEXT, so TEXT NOT NULL, created_at INTEGER NOT NULL, lemondva_at INTEGER, emlekeztetve_at INTEGER);

CREATE INDEX IF NOT EXISTS class_bookings_session ON class_bookings (session_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS class_bookings_egy ON class_bookings (session_id, email) WHERE status = 'megerositett' AND email != '';

-- Google Naptár szinkron (naptar.js): elem (F... foglalás, S... óra) + cél → a Google-esemény, és a várakozó sor
CREATE TABLE IF NOT EXISTS gcal_esemeny (elem_id TEXT NOT NULL, cel TEXT NOT NULL CHECK (cel IN ('kollega', 'studio')), naptar_id TEXT NOT NULL, esemeny_id TEXT NOT NULL, frissitve INTEGER NOT NULL, PRIMARY KEY (elem_id, cel, naptar_id));

CREATE TABLE IF NOT EXISTS gcal_sor (elem_id TEXT PRIMARY KEY, verzio INTEGER NOT NULL DEFAULT 1, probalkozas INTEGER NOT NULL DEFAULT 0, hiba TEXT, zarolva_at INTEGER, letrehozva INTEGER NOT NULL, frissitve INTEGER NOT NULL);
