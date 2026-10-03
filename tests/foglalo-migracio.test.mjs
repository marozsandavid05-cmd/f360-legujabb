// Időpontfoglaló · séma-migráció a meglévő D1-hez (Lilla-kör, 2026-10-01), valódi SQLite-tal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeD1 } from './_d1.mjs';
import { MIGRACIO, sema } from '../functions/_lib/booking/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// a 2026-09-28-as (éles előtti) séma két érintett táblája, ahogy a meglévő D1-ben van
const REGI = [
  `CREATE TABLE bookings (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, service_id TEXT NOT NULL, staff_id TEXT NOT NULL, date TEXT NOT NULL, start_min INTEGER NOT NULL, dur_min INTEGER NOT NULL, buffer_min INTEGER NOT NULL, price INTEGER, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'megerositett' CHECK (status IN ('megerositett', 'lemondva')), source TEXT NOT NULL DEFAULT 'web', token_salt TEXT NOT NULL, created_at INTEGER NOT NULL, cancelled_at INTEGER)`,
  `CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT, tipus TEXT NOT NULL, cimzett TEXT NOT NULL, targy TEXT NOT NULL, html TEXT NOT NULL, szoveg TEXT NOT NULL, ics TEXT, sent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
];
const oszlopok = (db, t) => db._raw.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name);

test('migráció: a régi bookings és outbox tábla megkapja az új oszlopokat, a meglévő sor érintetlen', async () => {
  const db = fakeD1();
  for (const s of REGI) db._raw.exec(s);
  db._raw.prepare(`INSERT INTO bookings (id, location_id, service_id, staff_id, date, start_min, dur_min, buffer_min, name, token_salt, created_at)
    VALUES ('F0000000001', 'mexikoi', 'gyogytorna', 'vas-luca', '2026-10-20', 600, 50, 10, 'David teszt', 'so', 1)`).run();
  db._raw.prepare(`INSERT INTO outbox (booking_id, tipus, cimzett, targy, html, szoveg, created_at) VALUES ('F0000000001', 'visszaigazolas', 'a@b.hu', 't', 'h', 's', 1)`).run();
  await sema(db);
  for (const [t, o] of MIGRACIO) assert.ok(oszlopok(db, t).includes(o), `${t}.${o}`);
  const b = db._raw.prepare('SELECT * FROM bookings').get();
  assert.equal(b.name, 'David teszt');
  assert.equal(b.emlekeztetve_at, null);
  assert.equal(b.forras, null);
  const o = db._raw.prepare('SELECT * FROM outbox').get();
  assert.equal(o.probalkozas, 0);
  assert.equal(o.sent, 0);
  // másodszor (új kötés-objektum, mint egy új isolate) sem hibázik
  await sema({ ...db });
});

test('migráció: a friss séma már tartalmazza az oszlopokat (nincs ALTER)', async () => {
  const db = fakeD1();
  await sema(db);
  for (const [t, o] of MIGRACIO) assert.ok(oszlopok(db, t).includes(o), `${t}.${o}`);
});

test('a kézi migrációs SQL ugyanazokat az ALTER-eket tartalmazza', () => {
  const sql = ['migracio-2026-10-01.sql', 'migracio-sorozat.sql']
    .map((f) => fs.readFileSync(path.join(ROOT, 'functions/_lib/booking', f), 'utf8')).join(' ');
  for (const [, , alter] of MIGRACIO) assert.ok(sql.includes(`${alter};`), alter);
});
