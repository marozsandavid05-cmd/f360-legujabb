// Időpontfoglaló · üzleti logika (adatbázis-hozzáférés + szabályok). A HTTP-réteg a
// functions/foglalas-api és functions/api/foglalo alatti routerekben van.

import { HttpError } from '../http.js';
import { budapestMost, datumPlusz, ervenyesDatum, helyiToUtc, hhmmToPerc, napok, percToHHMM } from './ido.js';
import { foglalasSlotjai, szabadIdopontok } from './szabad.js';
import { sema, szamitasiTorzs, titok, torzsBetolt } from './schema.js';
import { tokenAzonosito, tokenEllenoriz, tokenKeszit, ujAzonosito, ujSo } from './token.js';
import { icsKeszit } from './ics.js';
import { lemondasLevel, studioErtesito, visszaigazolas } from './levelek.js';
import { levelSorok, mailMod } from './mailer.js';

export const NAPI_KORLAT = 20; // foglalási kísérlet IP-nként naponta
export const MAX_NAP_EGY_KERESBEN = 14;
const UTKOZES = 'Ezt az időpontot közben lefoglalták. Kérjük, válassz másikat.';
const NEM_FOGLALHATO = 'Ez az időpont nem foglalható. Kérjük, válassz a szabad időpontok közül.';

export function dbVagy503(env) {
  if (!env.BOOKING_DB) throw new HttpError(503, 'Az időpontfoglalás most nem elérhető. Kérjük, hívj minket telefonon.');
  return env.BOOKING_DB;
}

// ---------------------------------------------------------------- beolvasás

export async function beosztasBetolt(db) {
  const { results } = await db.prepare(
    `SELECT staff_id, weekday, location_id, start_min, end_min FROM schedule ORDER BY staff_id, weekday, start_min`,
  ).all();
  return (results || []).map((r) => ({ kollega: r.staff_id, nap: r.weekday, helyszin: r.location_id, kezd: r.start_min, veg: r.end_min }));
}

export async function kivetelekBetolt(db, tol, ig) {
  const { results } = await db.prepare(
    `SELECT id, staff_id, location_id, date_from, date_to, start_min, end_min, note FROM exceptions
     WHERE date_to >= ? AND date_from <= ? ORDER BY date_from, start_min`,
  ).bind(tol, ig).all();
  return (results || []).map((r) => ({
    id: r.id, kollega: r.staff_id, helyszin: r.location_id, tol: r.date_from, ig: r.date_to, kezd: r.start_min, veg: r.end_min, megjegyzes: r.note,
  }));
}

async function foglaltBetolt(db, tol, ig) {
  const { results } = await db.prepare(
    `SELECT staff_id, date, slot_min FROM slot_locks WHERE date >= ? AND date <= ?`,
  ).bind(tol, ig).all();
  return (results || []).map((r) => ({ kollega: r.staff_id, datum: r.date, slot: r.slot_min }));
}

// ---------------------------------------------------------------- katalógus és szabad időpontok

export async function katalogus(db) {
  const t = await torzsBetolt(db);
  return {
    minta: t.minta === true,
    helyszinek: t.helyszinek.map(({ id, nev, cim, nyit, zar }) => ({ id, nev, cim, nyit, zar })),
    szolgaltatasok: t.szolgaltatasok.map(({ id, nev, perc, ar, helyszinek }) => ({ id, nev, perc, ar, helyszinek })),
    kollegak: t.kollegak.map(({ id, nev, szerep, helyszinek, szolgaltatasok }) => ({ id, nev, szerep, helyszinek, szolgaltatasok })),
    szabalyok: {
      lemondasOra: t.szabalyok.lemondasOra, minEloreOra: t.szabalyok.minEloreOra, maxEloreNap: t.szabalyok.maxEloreNap, telefon: t.szabalyok.telefon,
    },
  };
}

function hivatkozasok(torzs, { helyszin, szolgaltatas, kollega }) {
  const hely = torzs.helyszinek.find((h) => h.id === helyszin);
  if (!hely) throw new HttpError(400, 'Ismeretlen helyszín.');
  const szolg = torzs.szolgaltatasok.find((s) => s.id === szolgaltatas);
  if (!szolg || !szolg.helyszinek.includes(helyszin)) throw new HttpError(400, 'Ez a szolgáltatás ezen a helyszínen nem foglalható.');
  let koll = null;
  if (kollega !== 'barki') {
    koll = torzs.kollegak.find((k) => k.id === kollega);
    if (!koll) throw new HttpError(400, 'Ismeretlen szakember.');
    if (!koll.helyszinek.includes(helyszin) || !koll.szolgaltatasok.includes(szolgaltatas)) {
      throw new HttpError(400, 'A kiválasztott szakember ezt a szolgáltatást ezen a helyszínen nem végzi.');
    }
  }
  return { hely, szolg, koll };
}

export async function szabad(db, q, most = Date.now()) {
  const tol = q.get('tol');
  const ig = q.get('ig');
  if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw new HttpError(400, 'Hibás dátum-tartomány.');
  if (napok(tol, ig, MAX_NAP_EGY_KERESBEN + 1).length > MAX_NAP_EGY_KERESBEN) {
    throw new HttpError(400, `Egyszerre legfeljebb ${MAX_NAP_EGY_KERESBEN} nap kérhető le.`);
  }
  const torzs = await torzsBetolt(db);
  const kollega = q.get('kollega') || 'barki';
  const p = { helyszin: q.get('helyszin'), szolgaltatas: q.get('szolgaltatas'), kollega };
  hivatkozasok(torzs, p);
  const [beosztas, kivetelek, foglalt] = await Promise.all([beosztasBetolt(db), kivetelekBetolt(db, tol, ig), foglaltBetolt(db, tol, ig)]);
  return szabadIdopontok({ torzs: szamitasiTorzs(torzs), beosztas, kivetelek, foglalt, most, ...p, tol, ig });
}

// ---------------------------------------------------------------- bemenet ellenőrzése

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const TEL_RE = /^[+0-9 ()/.-]{6,24}$/;

function szoveg(v, max) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new HttpError(400, 'Hibás kérés.');
  const s = v.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (s.length > max) throw new HttpError(400, `Túl hosszú szöveg (legfeljebb ${max} karakter).`);
  return s;
}

export function foglalasBemenet(d, { admin = false } = {}) {
  const nev = szoveg(d.nev, 100);
  const email = szoveg(d.email, 254).toLowerCase();
  const telefon = szoveg(d.telefon, 24);
  const megjegyzes = szoveg(d.megjegyzes, 1000);
  if (nev.length < 2) throw new HttpError(400, 'Kérjük, add meg a neved.');
  if (!admin || email) {
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Kérjük, adj meg egy érvényes e-mail-címet.');
  }
  if (!admin || telefon) {
    if (!TEL_RE.test(telefon) || telefon.replace(/\D/g, '').length < 6) throw new HttpError(400, 'Kérjük, adj meg egy érvényes telefonszámot.');
  }
  if (!admin && d.hozzajarul !== true) throw new HttpError(400, 'A foglaláshoz el kell fogadnod az adatkezelési tájékoztatót.');
  if (!ervenyesDatum(d.datum)) throw new HttpError(400, 'Hibás dátum.');
  const kezdPerc = hhmmToPerc(d.kezd);
  if (kezdPerc == null) throw new HttpError(400, 'Hibás időpont.');
  for (const k of ['helyszin', 'szolgaltatas']) if (typeof d[k] !== 'string') throw new HttpError(400, 'Hibás kérés.');
  const kollega = d.kollega == null || d.kollega === '' ? 'barki' : d.kollega;
  if (typeof kollega !== 'string') throw new HttpError(400, 'Hibás kérés.');
  return { helyszin: d.helyszin, szolgaltatas: d.szolgaltatas, kollega, datum: d.datum, kezdPerc, nev, email, telefon, megjegyzes };
}

// ---------------------------------------------------------------- nézetek

export function nezet(row, torzs) {
  const hely = torzs.helyszinek.find((h) => h.id === row.location_id) || { id: row.location_id, nev: row.location_id, cim: '' };
  const szolg = torzs.szolgaltatasok.find((s) => s.id === row.service_id) || { id: row.service_id, nev: row.service_id };
  const koll = torzs.kollegak.find((k) => k.id === row.staff_id) || { id: row.staff_id, nev: row.staff_id };
  return {
    azonosito: row.id,
    allapot: row.status,
    helyszin: { id: hely.id, nev: hely.nev, cim: hely.cim },
    szolgaltatas: { id: szolg.id, nev: szolg.nev, perc: row.dur_min, ar: row.price },
    kollega: { id: koll.id, nev: koll.nev },
    datum: row.date,
    kezd: percToHHMM(row.start_min),
    veg: percToHHMM(row.start_min + row.dur_min),
    kezdPerc: row.start_min,
    nev: row.name,
    email: row.email,
    telefon: row.phone,
    megjegyzes: row.note,
    forras: row.source,
  };
}

/** Az ügyfélnek visszaadható rész (e-mail, telefon és megjegyzés nélkül). */
export function publikusNezet(f) {
  const { azonosito, allapot, helyszin, szolgaltatas, kollega, datum, kezd, veg, nev } = f;
  return { azonosito, allapot, helyszin, szolgaltatas, kollega, datum, kezd, veg, nev };
}

// ---------------------------------------------------------------- IP-korlát

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function ipKorlat(env, db, request) {
  await sema(db);
  const nap = budapestMost().datum;
  const ip = request.headers.get('CF-Connecting-IP') || 'ismeretlen';
  const iph = (await sha256hex(`${nap}|${ip}|${await titok(env, db)}`)).slice(0, 32);
  const n = await db.prepare(
    `INSERT INTO foglalas_korlat (iph, nap, n) VALUES (?, ?, 1)
     ON CONFLICT(iph, nap) DO UPDATE SET n = n + 1 RETURNING n`,
  ).bind(iph, nap).first('n');
  await db.prepare(`DELETE FROM foglalas_korlat WHERE nap < ?`).bind(datumPlusz(nap, -2)).run();
  if (Number(n) > NAPI_KORLAT) throw new HttpError(429, 'Ma már túl sok foglalási kísérlet érkezett erről a hálózatról. Kérjük, hívj minket telefonon.');
}

// ---------------------------------------------------------------- foglalás

const linkek = (origin, token) => ({
  lemondasUrl: `${origin}/foglalas/lemondas?t=${encodeURIComponent(token)}`,
  icsUrl: `${origin}/foglalas-api/foglalas.ics?t=${encodeURIComponent(token)}`,
});

/**
 * Foglalás. A dupla foglalást az adatbázis zárja ki: a foglalás minden 15 perces rácspontja egy
 * slot_locks sor (PRIMARY KEY staff_id, date, slot_min), és a foglalás, a zárak és a levelek egy
 * batch-ben (egy tranzakcióban) kerülnek be. Ütközéskor az egész batch visszagörgetődik.
 * „Bárki” választásnál a jelöltek sorban próbálkoznak, az elsőként sikerülő kapja.
 */
export async function foglal(env, db, be, { origin, admin = false, most = Date.now() }) {
  const torzs = await torzsBetolt(db);
  const { hely, szolg } = hivatkozasok(torzs, be);
  const szTorzs = szamitasiTorzs(admin ? { ...torzs, szabalyok: { ...torzs.szabalyok, minEloreOra: 0, maxEloreNap: 3660 } } : torzs);
  const [beosztas, kivetelek, foglalt] = await Promise.all([
    beosztasBetolt(db), kivetelekBetolt(db, be.datum, be.datum), foglaltBetolt(db, be.datum, be.datum),
  ]);
  const kezd = percToHHMM(be.kezdPerc);
  const alap = { torzs: szTorzs, beosztas, kivetelek, most, helyszin: be.helyszin, szolgaltatas: be.szolgaltatas, kollega: be.kollega, tol: be.datum, ig: be.datum };
  // a beosztás szerint alkalmas kollégák (foglalások nélkül): ha itt nincs, az időpont eleve nem foglalható
  const beosztasSzerint = (szabadIdopontok({ ...alap, foglalt: [] }).napok[be.datum] || []).find((s) => s.kezd === kezd);
  if (!beosztasSzerint) throw new HttpError(409, NEM_FOGLALHATO);
  const mostSzabad = new Set(((szabadIdopontok({ ...alap, foglalt }).napok[be.datum] || []).find((s) => s.kezd === kezd) || { kollegak: [] }).kollegak);
  // előbb a most szabadnak látszók, utána a többi (hátha közben felszabadult)
  const jeloltek = [...beosztasSzerint.kollegak].sort((a, b) => Number(mostSzabad.has(b)) - Number(mostSzabad.has(a)));

  const secret = await titok(env, db);
  const puffer = szolg.puffer ?? 10;
  for (const kollega of jeloltek) {
    const id = ujAzonosito();
    const so = ujSo();
    const token = await tokenKeszit(secret, id, so);
    const { lemondasUrl, icsUrl } = linkek(origin, token);
    const row = {
      id, location_id: hely.id, service_id: szolg.id, staff_id: kollega, date: be.datum, start_min: be.kezdPerc,
      dur_min: szolg.perc, buffer_min: puffer, price: szolg.ar ?? null, name: be.nev, email: be.email, phone: be.telefon,
      note: be.megjegyzes, status: 'megerositett', source: admin ? 'admin' : 'web', token_salt: so, created_at: most,
    };
    const f = nezet(row, torzs);
    const ics = icsKeszit(f, { host: new URL(origin).host, most, lemondasUrl });
    const levelek = [visszaigazolas(f, { lemondasUrl, icsUrl, szabalyok: torzs.szabalyok, ics })];
    if (!admin) levelek.push(studioErtesito(f, { szabalyok: torzs.szabalyok }));
    const cols = Object.keys(row);
    const stmts = [
      db.prepare(`INSERT INTO bookings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c] ?? null)),
      ...foglalasSlotjai({ kollega, datum: be.datum, kezd: be.kezdPerc, perc: szolg.perc, puffer }).map((s) => db.prepare(
        `INSERT INTO slot_locks (staff_id, date, slot_min, booking_id) VALUES (?, ?, ?, ?)`,
      ).bind(kollega, s.datum, s.slot, id)),
      ...levelSorok(db, id, levelek, most),
    ];
    mailMod(env);
    try {
      await db.batch(stmts);
    } catch (e) {
      if (/UNIQUE constraint failed: slot_locks/.test(String(e && e.message))) continue; // közben lefoglalták
      throw e;
    }
    return { azonosito: id, lemondasUrl, ics: icsUrl, level: { targy: levelek[0].targy, html: levelek[0].html, szoveg: levelek[0].szoveg }, foglalas: publikusNezet(f) };
  }
  throw new HttpError(409, UTKOZES);
}

// ---------------------------------------------------------------- lemondás

async function foglalasSor(db, id) {
  return db.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
}

/** Token → foglalás-sor; rossz vagy ismeretlen token esetén 404 (nem áruljuk el, melyik). */
export async function tokenFoglalas(env, db, token) {
  await sema(db);
  const id = tokenAzonosito(token);
  const nincs = new HttpError(404, 'Ez a lemondó link érvénytelen.');
  if (!id) throw nincs;
  const row = await foglalasSor(db, id);
  if (!row || !(await tokenEllenoriz(await titok(env, db), token, row.token_salt))) throw nincs;
  return row;
}

export function lemondasAllapot(row, torzs, most = Date.now()) {
  const kezdMs = helyiToUtc(row.date, row.start_min);
  const hataridoMs = kezdMs - torzs.szabalyok.lemondasOra * 3600e3;
  return { kezdMs, hataridoMs, elmult: kezdMs <= most, lemondhato: row.status === 'megerositett' && most < hataridoMs };
}

export async function lemondasInfo(env, db, token, most = Date.now()) {
  const row = await tokenFoglalas(env, db, token);
  const torzs = await torzsBetolt(db);
  const a = lemondasAllapot(row, torzs, most);
  if (a.elmult) throw new HttpError(410, 'Ez az időpont már elmúlt, a link lejárt.');
  return {
    azonosito: row.id,
    allapot: row.status,
    lemondhato: a.lemondhato,
    hatarido: new Date(a.hataridoMs).toISOString(),
    telefon: torzs.szabalyok.telefon,
    foglalas: publikusNezet(nezet(row, torzs)),
  };
}

/**
 * Lemondás. Egy batch: állapot → lemondva (csak ha még megerősített), a zárak törlése, lemondó levél.
 * A levél csak akkor kerül be, ha ez a kérés váltotta át az állapotot (changes() = 1), így két
 * párhuzamos lemondásból sem lesz két levél.
 */
export async function lemond(env, db, row, { admin = false, most = Date.now() } = {}) {
  const torzs = await torzsBetolt(db);
  const a = lemondasAllapot(row, torzs, most);
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a foglalást már lemondták.');
  if (!admin) {
    if (a.elmult) throw new HttpError(410, 'Ez az időpont már elmúlt, a link lejárt.');
    if (!a.lemondhato) {
      throw new HttpError(409, `A kezdés előtti ${torzs.szabalyok.lemondasOra} órán belül a link már nem mond le. Kérjük, hívj minket: ${torzs.szabalyok.telefon}.`, { telefon: torzs.szabalyok.telefon });
    }
  }
  const f = nezet({ ...row, status: 'lemondva' }, torzs);
  const level = lemondasLevel(f, { szabalyok: torzs.szabalyok });
  const stmts = [
    db.prepare(`UPDATE bookings SET status = 'lemondva', cancelled_at = ? WHERE id = ? AND status = 'megerositett'`).bind(most, row.id),
  ];
  if (level.cimzett) {
    stmts.push(db.prepare(
      `INSERT INTO outbox (booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at)
       SELECT ?, ?, ?, ?, ?, ?, NULL, 0, ? WHERE changes() = 1`,
    ).bind(row.id, level.tipus, level.cimzett, level.targy, level.html, level.szoveg, most));
  }
  stmts.push(db.prepare(`DELETE FROM slot_locks WHERE booking_id = ?`).bind(row.id));
  mailMod(env);
  const eredmeny = await db.batch(stmts);
  if (!eredmeny[0] || Number(eredmeny[0].meta && eredmeny[0].meta.changes) !== 1) throw new HttpError(410, 'Ezt a foglalást már lemondták.');
  return { azonosito: row.id, allapot: 'lemondva' };
}

export async function adminLemond(env, db, id, most = Date.now()) {
  await sema(db);
  const row = /^F[0-9A-Z]{10}$/.test(id) ? await foglalasSor(db, id) : null;
  if (!row) throw new HttpError(404, 'Nincs ilyen foglalás.');
  return lemond(env, db, row, { admin: true, most });
}

export async function icsTokennel(env, db, token, origin) {
  const row = await tokenFoglalas(env, db, token);
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a foglalást lemondták.');
  const torzs = await torzsBetolt(db);
  const f = nezet(row, torzs);
  return { azonosito: row.id, ics: icsKeszit(f, { host: new URL(origin).host, lemondasUrl: linkek(origin, token).lemondasUrl }) };
}

// ---------------------------------------------------------------- admin lista

export async function foglalasLista(db, q) {
  const torzs = await torzsBetolt(db);
  const ma = budapestMost().datum;
  const tol = q.get('tol') || ma;
  const ig = q.get('ig') || datumPlusz(tol, 6);
  if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw new HttpError(400, 'Hibás dátum-tartomány.');
  if (napok(tol, ig, 93).length > 92) throw new HttpError(400, 'Egyszerre legfeljebb 92 nap kérhető le.');
  const felt = ['date >= ?', 'date <= ?'];
  const args = [tol, ig];
  for (const [p, col] of [['helyszin', 'location_id'], ['kollega', 'staff_id'], ['allapot', 'status']]) {
    const v = q.get(p);
    if (v) { felt.push(`${col} = ?`); args.push(v); }
  }
  const { results } = await db.prepare(
    `SELECT * FROM bookings WHERE ${felt.join(' AND ')} ORDER BY date, start_min, staff_id LIMIT 2000`,
  ).bind(...args).all();
  return {
    tol, ig,
    foglalasok: (results || []).map((r) => {
      const { kezdPerc: _k, ...f } = nezet(r, torzs);
      return { ...f, letrehozva: new Date(r.created_at).toISOString(), lemondva: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null };
    }),
  };
}
