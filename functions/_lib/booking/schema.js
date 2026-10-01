// Időpontfoglaló · séma, törzsadat-betöltés, titok
import { SEED_TORZS, SEED_BEOSZTAS } from './seed.js';
import { hhmmToPerc } from './ido.js';
import { szinKioszt, szinNormal } from './szin.js';
import { torzsAlap } from './torzs-alap.js';

// Ugyanaz, mint a schema.sql (a tests/foglalo-egyseg.test.mjs összeveti)
export const SEMA = [
  `CREATE TABLE IF NOT EXISTS settings (kulcs TEXT PRIMARY KEY, ertek TEXT NOT NULL, modositva INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS schedule (staff_id TEXT NOT NULL, weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), location_id TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, CHECK (start_min < end_min), PRIMARY KEY (staff_id, weekday, location_id, start_min))`,
  `CREATE TABLE IF NOT EXISTS exceptions (id TEXT PRIMARY KEY, staff_id TEXT, location_id TEXT, date_from TEXT NOT NULL, date_to TEXT NOT NULL, start_min INTEGER, end_min INTEGER, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, service_id TEXT NOT NULL, staff_id TEXT NOT NULL, date TEXT NOT NULL, start_min INTEGER NOT NULL, dur_min INTEGER NOT NULL, buffer_min INTEGER NOT NULL, price INTEGER, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'megerositett' CHECK (status IN ('megerositett', 'lemondva')), source TEXT NOT NULL DEFAULT 'web', token_salt TEXT NOT NULL, created_at INTEGER NOT NULL, cancelled_at INTEGER, emlekeztetve_at INTEGER, forras TEXT)`,
  `CREATE INDEX IF NOT EXISTS bookings_date ON bookings (date, start_min)`,
  `CREATE TABLE IF NOT EXISTS slot_locks (staff_id TEXT NOT NULL, date TEXT NOT NULL, slot_min INTEGER NOT NULL, booking_id TEXT NOT NULL, PRIMARY KEY (staff_id, date, slot_min))`,
  `CREATE INDEX IF NOT EXISTS slot_locks_booking ON slot_locks (booking_id)`,
  `CREATE INDEX IF NOT EXISTS slot_locks_date ON slot_locks (date)`,
  `CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT, tipus TEXT NOT NULL, cimzett TEXT NOT NULL, targy TEXT NOT NULL, html TEXT NOT NULL, szoveg TEXT NOT NULL, ics TEXT, sent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, hiba TEXT, probalkozas INTEGER NOT NULL DEFAULT 0, zarolva_at INTEGER, kuldve_at INTEGER, provider_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS outbox_kuldendo ON outbox (sent, id)`,
  `CREATE TABLE IF NOT EXISTS foglalas_korlat (iph TEXT NOT NULL, nap TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (iph, nap))`,
  `CREATE TABLE IF NOT EXISTS titkok (nev TEXT PRIMARY KEY, ertek TEXT NOT NULL)`,
];

/**
 * Migráció a meglévő adatbázisokhoz (Lilla-kör, 2026-10-01): a CREATE TABLE IF NOT EXISTS a már
 * létező táblát nem bővíti, ezért a hiányzó oszlopok ADD COLUMN-nal kerülnek be. Csak NULL-ozható
 * vagy alapértékes oszlop, a meglévő sorok érintetlenek. Ugyanez kézi futtatásra:
 * functions/_lib/booking/migracio-2026-10-01.sql.
 */
export const MIGRACIO = [
  ['bookings', 'emlekeztetve_at', `ALTER TABLE bookings ADD COLUMN emlekeztetve_at INTEGER`],
  ['bookings', 'forras', `ALTER TABLE bookings ADD COLUMN forras TEXT`],
  ['outbox', 'hiba', `ALTER TABLE outbox ADD COLUMN hiba TEXT`],
  ['outbox', 'probalkozas', `ALTER TABLE outbox ADD COLUMN probalkozas INTEGER NOT NULL DEFAULT 0`],
  ['outbox', 'zarolva_at', `ALTER TABLE outbox ADD COLUMN zarolva_at INTEGER`],
  ['outbox', 'kuldve_at', `ALTER TABLE outbox ADD COLUMN kuldve_at INTEGER`],
  ['outbox', 'provider_id', `ALTER TABLE outbox ADD COLUMN provider_id TEXT`],
];

// A kész sémájú adatbázisok (isolate-on belül, kötés-objektumonként)
const kesz = new WeakSet();

export async function sema(db) {
  if (kesz.has(db)) return;
  await db.batch(SEMA.map((s) => db.prepare(s)));
  await migral(db);
  kesz.add(db);
}

async function migral(db) {
  const oszlopok = {};
  for (const tabla of new Set(MIGRACIO.map(([t]) => t))) {
    const { results } = await db.prepare(`SELECT name FROM pragma_table_info(?)`).bind(tabla).all();
    oszlopok[tabla] = new Set((results || []).map((r) => r.name));
  }
  for (const [tabla, oszlop, sql] of MIGRACIO) {
    if (oszlopok[tabla].has(oszlop)) continue;
    try {
      await db.prepare(sql).run();
    } catch (e) {
      // egy párhuzamos első kérés (másik isolate) közben hozzáadhatta: az nem hiba
      if (!/duplicate column name/i.test(String(e && e.message))) throw e;
    }
  }
}

/**
 * A törzsadat (helyszínek, szolgáltatások, kollégák, szabályok) a settings táblában, JSON-ként.
 * Ha még nincs, a MINTA seed kerül be a heti minta-beosztással együtt (INSERT OR IGNORE, így két
 * párhuzamos első kérés sem duplikál, és a már szerkesztett adatot soha nem írja felül).
 */
export async function torzsBetolt(db) {
  await sema(db);
  const sor = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).first();
  if (sor) return szinPotlas(db, sor.ertek);
  const most = Date.now();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO settings (kulcs, ertek, modositva) VALUES ('torzs', ?, ?)`).bind(JSON.stringify(SEED_TORZS), most),
    ...SEED_BEOSZTAS.map((b) => db.prepare(
      `INSERT OR IGNORE INTO schedule (staff_id, weekday, location_id, start_min, end_min) VALUES (?, ?, ?, ?, ?)`,
    ).bind(b.kollega, b.nap, b.helyszin, hhmmToPerc(b.kezd), hhmmToPerc(b.veg))),
  ]);
  const ujra = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).first();
  return szinPotlas(db, ujra.ertek);
}

/**
 * Adat-migráció a kolléga-színhez: a kollégák a settings.torzs JSON-ban élnek (nincs külön tábla,
 * ezért ALTER TABLE sem kell). Ha egy kollégának nincs érvényes színe (a szín előtti adatbázis),
 * a palettából kap egyet, és a törzsadat visszaíródik. A mentés feltételes (csak ha közben senki nem
 * írta át), így egy párhuzamos admin-mentést nem ír felül; ütközéskor a friss adatot olvassa újra.
 */
async function szinPotlas(db, ertek) {
  const torzs = JSON.parse(ertek);
  const kollegak = Array.isArray(torzs.kollegak) ? torzs.kollegak : [];
  // a Lilla-kör új mezői (email, aktiv_tol, ..., emlekeztetoOra) a régi adatban hiányoznak:
  // betöltéskor alapértéket kapnak (torzsAlap), ehhez írás sem kell
  if (kollegak.every((k) => szinNormal(k.szin) === k.szin)) return torzsAlap(torzs);
  const uj = { ...torzs, kollegak: szinKioszt(kollegak) };
  const r = await db.prepare(`UPDATE settings SET ertek = ?, modositva = ? WHERE kulcs = 'torzs' AND ertek = ?`)
    .bind(JSON.stringify(uj), Date.now(), ertek).run();
  if (Number(r.meta && r.meta.changes)) return torzsAlap(uj);
  const friss = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).first();
  const t = JSON.parse(friss.ertek);
  // a közben mentett változatnak is lehet szín nélküli kollégája: válaszban pótoljuk, a következő betöltés menti
  return torzsAlap({ ...t, kollegak: szinKioszt(Array.isArray(t.kollegak) ? t.kollegak : []) });
}

/** A számításhoz használt alak: nyitvatartás percben. */
export function szamitasiTorzs(torzs) {
  return {
    ...torzs,
    helyszinek: torzs.helyszinek.map((h) => ({ ...h, nyit: hhmmToPerc(h.nyit), zar: hhmmToPerc(h.zar) })),
  };
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A lemondó-token és az IP-hash kulcsa. Élesben BOOKING_SECRET env (Pages secret).
 * Bemutatóban, ha nincs env, egy véletlen kulcs a D1-ben (első használatkor jön létre).
 * FIGYELEM: ha később beállítják a BOOKING_SECRET-et, a korábban kiadott lemondó linkek érvénytelenek lesznek.
 */
export async function titok(env, db) {
  if (env.BOOKING_SECRET && String(env.BOOKING_SECRET).length >= 16) return String(env.BOOKING_SECRET);
  await sema(db);
  const uj = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare(`INSERT OR IGNORE INTO titkok (nev, ertek) VALUES ('lemondas', ?)`).bind(uj).run();
  return db.prepare(`SELECT ertek FROM titkok WHERE nev = 'lemondas'`).first('ertek');
}
