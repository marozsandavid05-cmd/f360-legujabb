// Időpontfoglaló · csoportos órák (2026-10): óratípus → heti sablon → konkrét óra (session) →
// résztvevő. A HTTP-réteg a functions/foglalas-api és a functions/api/foglalo routerében van.
//
// Döntések:
//   - A helyfoglalás EGY utasításban atomikus: a résztvevő sora csak akkor kerül be, ha az óra
//     aktív, és a megerősített résztvevők száma kisebb a kapacitásnál (INSERT ... SELECT ... WHERE).
//     A D1 (SQLite) az írásokat sorba állítja, így az utolsó helyre párhuzamosan csak egy jut be.
//   - Egy e-mail egy órára egyszer: részleges UNIQUE index (status = 'megerositett', email != '').
//   - Az óra a kapacitást és a hosszt a létrehozáskor rögzíti; a résztvevő az árat a foglaláskor.
//   - Token: ugyanaz a HMAC-token, mint az egyéni foglalásnál, „C” előtagú azonosítóval, így a
//     meglévő /foglalas/lemondas?t= link és a lemondás, módosítás, .ics végpontok a csoportost is kezelik.
//   - Foglalási határ: a 10:00 előtt kezdődő órára az előző nap 22:00 (a weboldal szabálya), egyébként
//     a minEloreOra. Állítható: szabalyok.reggeliHatarOra, szabalyok.reggeliKezdesElott.
//   - Ha az óra elmarad, a résztvevők jelentkezése megmarad (a tokenes linkkel másik órára
//     áthelyezhetik, vagy lemondhatják); levelet kapnak róla.
//   - A stúdió (info@) csoportos jelentkezésről nem kap levelet (óránként sok lenne), az oktató igen.

import { HttpError } from '../http.js';
import { budapestMost, datumPlusz, ervenyesDatum, hetNapja, helyiToUtc, hhmmToPerc, napok, percToHHMM } from './ido.js';
import { sema, titok, torzsBetolt } from './schema.js';
import { tokenAzonosito, tokenEllenoriz, tokenKeszit, ujAzonosito, ujSo } from './token.js';
import { icsKeszit } from './ics.js';
import { kollegaCim } from './levelek-kollega.js';
import { oktatoErtesito, oraAthelyezesLevel, oraElmaradLevel, oraEmlekezteto, oraLemondasLevel, oraVisszaigazolas } from './levelek-csoportos.js';
import { mailMod } from './mailer.js';
import { forrasOlvas } from './forras.js';
import { lemondasAllapot } from './foglalas.js';
import { ORA_SABLONOK, ORA_TIPUSOK } from './orak-seed.js';

export const ORA_HETEK = 8; // ennyi hétre előre jönnek létre az órák
export const ORA_MAX_NAP = 14; // a nyilvános lista egy kérésben
const SESSION_RE = /^S[0-9A-Z]{10}$/;
const CSOPORTOS_RE = /^C[0-9A-Z]{10}$/;
const KOZBEN_MODOSULT = 'A jelentkezést közben módosították. Kérjük, töltsd újra az oldalt.';
const SEED_KULCS = 'orak:seed';
const GENERALT_KULCS = 'orak:generalva';

// ---------------------------------------------------------------- séma, kezdő adat, generálás

const seedKesz = new WeakSet();

/** Séma (a SEMA-ban) és a kezdő órarend egyszer (settings jelző; a törölt sablon nem jön vissza). */
export async function oraSema(db) {
  await sema(db);
  if (seedKesz.has(db)) return;
  const van = await db.prepare(`SELECT 1 AS x FROM settings WHERE kulcs = ?`).bind(SEED_KULCS).first('x');
  if (!van) {
    const most = Date.now();
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO settings (kulcs, ertek, modositva) VALUES (?, '1', ?)`).bind(SEED_KULCS, most),
      ...ORA_TIPUSOK.map((t) => db.prepare(
        `INSERT OR IGNORE INTO class_types (id, nev, leiras, helyszin_id, perc, ar, kapacitas, kategoria, aktiv, kapacitas_megerositendo, ar_megerositendo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(t.id, t.nev, t.leiras, t.helyszin, t.perc, t.ar, t.kapacitas, t.kategoria, t.kapacitas_megerositendo ? 1 : 0, t.ar_megerositendo ? 1 : 0, most)),
      ...ORA_SABLONOK.map((s) => db.prepare(
        `INSERT OR IGNORE INTO class_templates (id, class_type_id, kollega_id, weekday, kezd_min, ervenyes_tol, ervenyes_ig, created_at) VALUES (?, ?, ?, ?, ?, '', '', ?)`,
      ).bind(s.id, s.ora, s.kollega, s.nap, hhmmToPerc(s.kezd), most)),
    ]);
  }
  seedKesz.add(db);
}

/**
 * A sablonokból létrehozza a következő `hetek` hét óráit (a mai naptól; a már elkezdődött ma nem).
 * Idempotens: a UNIQUE (class_type_id, datum, kezd_min) miatt a meglévőt nem duplikálja és nem írja át.
 * Csak az aktív óratípus sablonja generál.
 */
export async function oraGeneral(db, { hetek = ORA_HETEK, most = Date.now() } = {}) {
  await oraSema(db);
  const { results } = await db.prepare(
    `SELECT s.id, s.class_type_id, s.kollega_id, s.weekday, s.kezd_min, s.ervenyes_tol, s.ervenyes_ig, t.perc, t.kapacitas
     FROM class_templates s JOIN class_types t ON t.id = s.class_type_id WHERE t.aktiv = 1`,
  ).all();
  const sablonok = results || [];
  const ma = budapestMost(most).datum;
  const stmts = [];
  for (const d of napok(ma, datumPlusz(ma, hetek * 7 - 1))) {
    const nap = hetNapja(d);
    for (const s of sablonok) {
      if (s.weekday !== nap) continue;
      if (s.ervenyes_tol && d < s.ervenyes_tol) continue;
      if (s.ervenyes_ig && d > s.ervenyes_ig) continue;
      if (helyiToUtc(d, s.kezd_min) <= most) continue;
      // egy sablonból egy napon legfeljebb egy óra: ha aznapra már van (például elmaradt, vagy
      // résztvevős, és közben a sablon időpontja változott), nem jön létre mellé új
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO class_sessions (id, class_type_id, kollega_id, datum, kezd_min, perc, kapacitas, status, megjegyzes, template_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, 'aktiv', '', ?, ? WHERE NOT EXISTS (SELECT 1 FROM class_sessions WHERE template_id = ? AND datum = ?)`,
      ).bind(ujAzonosito('S'), s.class_type_id, s.kollega_id ?? null, d, s.kezd_min, s.perc, s.kapacitas, s.id, most, s.id, d));
    }
  }
  let letrehozva = 0;
  // a D1 egy batch-ben is sok utasítást fogad, de óvatosan darabolunk
  for (let i = 0; i < stmts.length; i += 100) {
    const r = await db.batch(stmts.slice(i, i + 100));
    letrehozva += r.reduce((n, x) => n + Number((x.meta && x.meta.changes) || 0), 0);
  }
  await db.prepare(`INSERT INTO settings (kulcs, ertek, modositva) VALUES (?, ?, ?) ON CONFLICT(kulcs) DO UPDATE SET ertek = excluded.ertek, modositva = excluded.modositva`)
    .bind(GENERALT_KULCS, ma, most).run();
  return { letrehozva, hetek };
}

/** Naponta egyszer generál (az első kérés vagy a cron); utána csak egy settings-olvasás. */
export async function oraGeneralHaKell(db, { most = Date.now() } = {}) {
  await oraSema(db);
  const ma = budapestMost(most).datum;
  const utolso = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = ?`).bind(GENERALT_KULCS).first('ertek');
  if (utolso === ma) return { letrehozva: 0, hetek: ORA_HETEK, kihagyva: true };
  return oraGeneral(db, { most });
}

// ---------------------------------------------------------------- szabályok, nézetek

/** A foglalási határ (UTC ms): reggeli óránál (alap: 10:00 előtt) az előző nap 22:00, egyébként minEloreOra. */
export function oraHatarido(datum, kezdMin, sz = {}) {
  const normal = helyiToUtc(datum, kezdMin) - (sz.minEloreOra ?? 2) * 3600e3;
  if (kezdMin < (sz.reggeliKezdesElott ?? 10) * 60) {
    return Math.min(normal, helyiToUtc(datumPlusz(datum, -1), (sz.reggeliHatarOra ?? 22) * 60));
  }
  return normal;
}

function kollegaNezet(torzs, id) {
  if (!id) return null;
  const k = torzs.kollegak.find((x) => x.id === id);
  if (!k) return null;
  return { id: k.id, nev: k.nev, szerep: k.szerep || '', foto: k.foto || '' };
}

function helyNezet(torzs, id) {
  const h = torzs.helyszinek.find((x) => x.id === id) || { id, nev: id, cim: '' };
  return { id: h.id, nev: h.nev, cim: h.cim };
}

const SESSION_SQL = `SELECT s.id, s.class_type_id, s.kollega_id, s.datum, s.kezd_min, s.perc, s.kapacitas, s.status, s.megjegyzes, s.template_id,
    t.nev AS ora_nev, t.kategoria, t.ar, t.leiras, t.helyszin_id, t.aktiv,
    (SELECT COUNT(*) FROM class_bookings b WHERE b.session_id = s.id AND b.status = 'megerositett') AS foglalt
  FROM class_sessions s JOIN class_types t ON t.id = s.class_type_id`;

/** Egy óra (session) nézete; `ok`: miért nem foglalható (elmarad, mult, hatarido, betelt) vagy null. */
function oraNezet(r, torzs, most) {
  const hatarido = oraHatarido(r.datum, r.kezd_min, torzs.szabalyok);
  const szabad = Math.max(0, r.kapacitas - r.foglalt);
  let ok = null;
  if (r.status === 'elmarad') ok = 'elmarad';
  else if (helyiToUtc(r.datum, r.kezd_min) <= most) ok = 'mult';
  else if (most >= hatarido) ok = 'hatarido';
  else if (szabad <= 0) ok = 'betelt';
  return {
    id: r.id,
    ora: { id: r.class_type_id, nev: r.ora_nev, kategoria: r.kategoria, perc: r.perc, ar: r.ar, leiras: r.leiras || '' },
    kollega: kollegaNezet(torzs, r.kollega_id),
    helyszin: helyNezet(torzs, r.helyszin_id),
    datum: r.datum,
    kezd: percToHHMM(r.kezd_min),
    veg: percToHHMM(r.kezd_min + r.perc),
    kapacitas: r.kapacitas,
    szabad,
    status: r.status,
    megjegyzes: r.megjegyzes || '',
    hatarido: new Date(hatarido).toISOString(),
    foglalhato: ok === null,
    ok,
  };
}

async function sessionSor(db, id) {
  if (!SESSION_RE.test(String(id || ''))) throw new HttpError(400, 'Hibás óra-azonosító.');
  const r = await db.prepare(`${SESSION_SQL} WHERE s.id = ?`).bind(id).first();
  if (!r) throw new HttpError(404, 'Nincs ilyen óra.');
  return r;
}

/** GET /foglalas-api/orak (nyilvános: max 14 nap, csak aktív óratípus) és GET /api/foglalo/orak (admin: max 92 nap). */
export async function oraLista(db, q, { admin = false, most = Date.now() } = {}) {
  await oraGeneralHaKell(db, { most });
  const torzs = await torzsBetolt(db);
  const tol = q.get('tol');
  const ig = q.get('ig');
  if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw new HttpError(400, 'Hibás dátum-tartomány.');
  const max = admin ? 92 : ORA_MAX_NAP;
  if (napok(tol, ig, max + 1).length > max) throw new HttpError(400, `Egyszerre legfeljebb ${max} nap kérhető le.`);
  const helyszin = q.get('helyszin');
  if (helyszin && !torzs.helyszinek.some((h) => h.id === helyszin)) throw new HttpError(400, 'Ismeretlen helyszín.');
  const felt = ['s.datum >= ?', 's.datum <= ?'];
  const args = [tol, ig];
  if (helyszin) { felt.push('t.helyszin_id = ?'); args.push(helyszin); }
  if (!admin) felt.push('t.aktiv = 1');
  const { results } = await db.prepare(`${SESSION_SQL} WHERE ${felt.join(' AND ')} ORDER BY s.datum, s.kezd_min, t.nev LIMIT 2000`).bind(...args).all();
  const orak = (results || []).map((r) => {
    const n = oraNezet(r, torzs, most);
    return admin ? { ...n, foglalt: r.foglalt, sablon: r.template_id, kollega: n.kollega && { ...n.kollega, szin: (torzs.kollegak.find((k) => k.id === r.kollega_id) || {}).szin } } : n;
  });
  return {
    tol, ig, orak,
    szabalyok: { telefon: torzs.szabalyok.telefon, lemondasOra: torzs.szabalyok.lemondasOra },
  };
}

// ---------------------------------------------------------------- csoportos jelentkezés nézete

const FOGLALAS_SQL = `SELECT b.*, s.class_type_id, s.kollega_id, s.datum, s.kezd_min, s.perc, s.kapacitas, s.status AS ora_status,
    t.nev AS ora_nev, t.kategoria, t.helyszin_id
  FROM class_bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types t ON t.id = s.class_type_id`;

async function oraFoglalasSor(db, id) {
  return db.prepare(`${FOGLALAS_SQL} WHERE b.id = ?`).bind(id).first();
}

/** A levelek és a nézetek közös alakja („cf”, a levelek-csoportos.js bemenete). */
function cfNezet(row, torzs) {
  return {
    azonosito: row.id,
    allapot: row.status,
    oraAllapot: row.ora_status,
    session: row.session_id,
    nev: row.nev, email: row.email, telefon: row.telefon, megjegyzes: row.megjegyzes,
    datum: row.datum, kezd: percToHHMM(row.kezd_min), veg: percToHHMM(row.kezd_min + row.perc), kezdPerc: row.kezd_min,
    ora: { id: row.class_type_id, nev: row.ora_nev, perc: row.perc, ar: row.ar, kategoria: row.kategoria },
    kollega: kollegaNezet(torzs, row.kollega_id),
    helyszin: helyNezet(torzs, row.helyszin_id),
  };
}

/** Az ügyfélnek visszaadható rész (e-mail, telefon és megjegyzés nélkül). */
function oraPublikus(cf) {
  return {
    tipus: 'csoportos', azonosito: cf.azonosito, allapot: cf.allapot, oraAllapot: cf.oraAllapot, ora: cf.ora, session: cf.session,
    kollega: cf.kollega && { id: cf.kollega.id, nev: cf.kollega.nev }, helyszin: cf.helyszin,
    datum: cf.datum, kezd: cf.kezd, veg: cf.veg, nev: cf.nev,
  };
}

/** Az .ics és a Google-link az egyéni foglalás nézetét várja: az óra a „szolgáltatás”. */
const icsNezet = (cf) => ({
  azonosito: cf.azonosito, datum: cf.datum, kezdPerc: cf.kezdPerc, helyszin: cf.helyszin,
  szolgaltatas: { nev: cf.ora.nev, perc: cf.ora.perc }, kollega: { nev: (cf.kollega && cf.kollega.nev) || 'Studio F360' },
});

const linkek = (origin, token) => ({
  lemondasUrl: `${origin}/foglalas/lemondas?t=${encodeURIComponent(token)}`,
  icsUrl: `${origin}/foglalas-api/foglalas.ics?t=${encodeURIComponent(token)}`,
});

// a levelek feltételes beszúrása: csak ha a foglalás sora a batch-ben valóban létrejött / megváltozott
function outboxHa(db, bookingId, l, most, feltetel, ...args) {
  return db.prepare(
    `INSERT INTO outbox (booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, 0, ? WHERE ${feltetel}`,
  ).bind(bookingId, l.tipus, l.cimzett, l.targy, l.html, l.szoveg, l.ics ?? null, most, ...args);
}

// ---------------------------------------------------------------- jelentkezés

function betelt() {
  return new HttpError(409, 'Betelt: erre az órára már nincs szabad hely. Kérjük, válassz másik órát.', { kod: 'betelt' });
}
function marJelentkezett() {
  return new HttpError(409, 'Erre az órára ezzel az e-mail-címmel már jelentkeztél.', { kod: 'mar_jelentkezett' });
}
function hataridoHiba(r, torzs) {
  const reggeli = r.kezd_min < (torzs.szabalyok.reggeliKezdesElott ?? 10) * 60;
  const szoveg = reggeli
    ? `A reggeli órákra az előző este ${String(torzs.szabalyok.reggeliHatarOra ?? 22).padStart(2, '0')}:00-ig beérkezett foglalásokat tudjuk jóváhagyni.`
    : `Erre az órára a kezdés előtt ${torzs.szabalyok.minEloreOra ?? 2} órával lezárult a jelentkezés.`;
  return new HttpError(409, `${szoveg} Kérjük, hívj minket: ${torzs.szabalyok.telefon}.`, { kod: 'hatarido', telefon: torzs.szabalyok.telefon });
}

/** Foglalhatóság-ellenőrzés (a végleges kapacitás-ellenőrzés az adatbázisban történik). */
function foglalhatoE(r, torzs, { admin, most }) {
  if (r.status === 'elmarad') throw new HttpError(409, 'Ez az óra elmarad. Kérjük, válassz másikat.', { kod: 'elmarad' });
  if (!admin && r.aktiv !== 1) throw new HttpError(404, 'Nincs ilyen óra.');
  if (helyiToUtc(r.datum, r.kezd_min) <= most) throw new HttpError(409, 'Ez az óra már elkezdődött vagy elmúlt.', { kod: 'mult' });
  if (!admin && most >= oraHatarido(r.datum, r.kezd_min, torzs.szabalyok)) throw hataridoHiba(r, torzs);
  if (r.foglalt >= r.kapacitas) throw betelt();
}

/**
 * Jelentkezés egy órára. `be`: { ora, nev, email, telefon, megjegyzes, forras } (ugyfelBemenet + ora).
 * Egy batch: a résztvevő sora (feltételesen: aktív óra, van hely) és a levelek (csak ha a sor bekerült).
 */
export async function oraFoglal(env, db, be, { origin, admin = false, most = Date.now() }) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const r = await sessionSor(db, be.ora);
  foglalhatoE(r, torzs, { admin, most });

  const id = ujAzonosito('C');
  const so = ujSo();
  const token = await tokenKeszit(await titok(env, db), id, so);
  const { lemondasUrl, icsUrl } = linkek(origin, token);
  const row = {
    id, session_id: r.id, nev: be.nev, email: be.email, telefon: be.telefon, megjegyzes: be.megjegyzes, ar: r.ar ?? null,
    status: 'megerositett', rogzites: admin ? 'admin' : 'web', forras: be.forras ? JSON.stringify(be.forras) : null, so, created_at: most,
  };
  const cf = cfNezet({ ...row, ...pick(r), ora_status: r.status }, torzs);
  const ics = icsKeszit(icsNezet(cf), { host: new URL(origin).host, most, lemondasUrl });
  // a vendég levele a válaszba is bekerül (a felület előnézete), akkor is, ha nincs e-mail-címe
  const vendeg = oraVisszaigazolas(cf, { lemondasUrl, icsUrl, szabalyok: torzs.szabalyok, ics });
  const levelek = [
    vendeg,
    oktatoErtesito(cf, kollegaCim(torzs, r.kollega_id), { esemeny: 'uj', allapot: { foglalt: r.foglalt + 1, kapacitas: r.kapacitas }, admin }),
  ].filter((l) => l.cimzett);
  const cols = Object.keys(row);
  const stmts = [
    db.prepare(`INSERT INTO class_bookings (${cols.join(', ')}) SELECT ${cols.map(() => '?').join(', ')}
      WHERE (SELECT COUNT(*) FROM class_bookings WHERE session_id = ? AND status = 'megerositett')
          < (SELECT kapacitas FROM class_sessions WHERE id = ? AND status = 'aktiv')`)
      .bind(...cols.map((c) => row[c] ?? null), r.id, r.id),
    ...levelek.map((l) => outboxHa(db, id, l, most, 'EXISTS (SELECT 1 FROM class_bookings WHERE id = ?)', id)),
  ];
  mailMod(env);
  let eredmeny;
  try {
    eredmeny = await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE constraint failed: class_bookings\.session_id, class_bookings\.email/.test(String(e && e.message))) throw marJelentkezett();
    throw e;
  }
  if (Number(eredmeny[0].meta && eredmeny[0].meta.changes) !== 1) {
    const friss = await sessionSor(db, r.id);
    if (friss.status === 'elmarad') throw new HttpError(409, 'Ez az óra elmarad. Kérjük, válassz másikat.', { kod: 'elmarad' });
    throw betelt();
  }
  return { azonosito: id, lemondasUrl, ics: icsUrl, level: vendegLevel(vendeg), foglalas: oraPublikus(cf) };
}

const vendegLevel = (l) => ({ targy: l.targy, html: l.html, szoveg: l.szoveg });

// a session-sor mezői a cfNezet-hez
const pick = (r) => ({
  class_type_id: r.class_type_id, kollega_id: r.kollega_id, datum: r.datum, kezd_min: r.kezd_min, perc: r.perc, kapacitas: r.kapacitas,
  ora_nev: r.ora_nev, kategoria: r.kategoria, helyszin_id: r.helyszin_id,
});

export function oraBemenet(d) {
  if (typeof d.ora !== 'string' || !d.ora) throw new HttpError(400, 'Hiányzik az óra.');
  if (!SESSION_RE.test(d.ora)) throw new HttpError(400, 'Hibás óra-azonosító.');
  return d.ora;
}

// ---------------------------------------------------------------- token, lemondás, áthelyezés

/** Csoportos token-e (az azonosító „C” előtagú). */
export const csoportosToken = (token) => CSOPORTOS_RE.test(tokenAzonosito(token) || '');

export async function oraTokenFoglalas(env, db, token) {
  await oraSema(db);
  const id = tokenAzonosito(token);
  const nincs = new HttpError(404, 'Ez a lemondó link érvénytelen.');
  if (!id || !CSOPORTOS_RE.test(id)) throw nincs;
  const row = await oraFoglalasSor(db, id);
  if (!row || !(await tokenEllenoriz(await titok(env, db), token, row.so))) throw nincs;
  return row;
}

const allapotSor = (row) => ({ date: row.datum, start_min: row.kezd_min, status: row.status });

export async function oraLemondasInfo(env, db, token, most = Date.now()) {
  const row = await oraTokenFoglalas(env, db, token);
  const torzs = await torzsBetolt(db);
  const a = lemondasAllapot(allapotSor(row), torzs, most);
  if (a.elmult) throw new HttpError(410, 'Ez az óra már elmúlt, a link lejárt.');
  return {
    tipus: 'csoportos',
    azonosito: row.id,
    allapot: row.status,
    lemondhato: a.lemondhato,
    // elmaradt óráról a lemondási határon belül is át lehet jelentkezni
    modosithato: row.status === 'megerositett' && (a.lemondhato || row.ora_status === 'elmarad'),
    hatarido: new Date(a.hataridoMs).toISOString(),
    telefon: torzs.szabalyok.telefon,
    foglalas: oraPublikus(cfNezet(row, torzs)),
  };
}

/** Lemondás: egy batch, a levelek csak ha ez a kérés mondta le (changes() = 1 lánc). */
export async function oraLemond(env, db, row, { admin = false, most = Date.now() } = {}) {
  const torzs = await torzsBetolt(db);
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a jelentkezést már lemondták.');
  const a = lemondasAllapot(allapotSor(row), torzs, most);
  if (!admin) {
    if (a.elmult) throw new HttpError(410, 'Ez az óra már elmúlt, a link lejárt.');
    if (!a.lemondhato && row.ora_status !== 'elmarad') {
      throw new HttpError(409, `A kezdés előtti ${torzs.szabalyok.lemondasOra} órán belül a link már nem mond le. Kérjük, hívj minket: ${torzs.szabalyok.telefon}.`, { telefon: torzs.szabalyok.telefon });
    }
  }
  const cf = cfNezet({ ...row, status: 'lemondva' }, torzs);
  const foglalt = Number(await db.prepare(`SELECT COUNT(*) AS n FROM class_bookings WHERE session_id = ? AND status = 'megerositett'`).bind(row.session_id).first('n')) || 0;
  const levelek = [
    oraLemondasLevel(cf, { szabalyok: torzs.szabalyok }),
    // elmaradt óránál az oktatót nem értesítjük a lemondásról
    ...(row.ora_status === 'elmarad' ? [] : [oktatoErtesito(cf, kollegaCim(torzs, row.kollega_id), { esemeny: 'lemondas', allapot: { foglalt: Math.max(0, foglalt - 1), kapacitas: row.kapacitas }, admin })]),
  ].filter((l) => l.cimzett);
  const stmts = [
    db.prepare(`UPDATE class_bookings SET status = 'lemondva', lemondva_at = ? WHERE id = ? AND status = 'megerositett' AND session_id = ?`)
      .bind(most, row.id, row.session_id),
    ...levelek.map((l) => outboxHa(db, row.id, l, most, 'changes() = 1')),
  ];
  mailMod(env);
  const eredmeny = await db.batch(stmts);
  if (Number(eredmeny[0].meta && eredmeny[0].meta.changes) !== 1) {
    const friss = await oraFoglalasSor(db, row.id);
    if (friss && friss.status === 'megerositett') throw new HttpError(409, KOZBEN_MODOSULT);
    throw new HttpError(410, 'Ezt a jelentkezést már lemondták.');
  }
  return { tipus: 'csoportos', azonosito: row.id, allapot: 'lemondva' };
}

export async function oraAdminLemond(env, db, id, most = Date.now()) {
  await oraSema(db);
  const row = CSOPORTOS_RE.test(String(id || '')) ? await oraFoglalasSor(db, id) : null;
  if (!row) throw new HttpError(404, 'Nincs ilyen jelentkezés.');
  return oraLemond(env, db, row, { admin: true, most });
}

/**
 * Áthelyezés másik órára (ugyanaz a token és azonosító). Egy utasítás teszi át, feltételesen:
 * a jelentkezés még a beolvasott órán van és megerősített, az új óra aktív, és van rajta hely.
 * A levelek csak akkor kerülnek be, ha az áthelyezés megtörtént (changes() = 1 lánc).
 */
export async function oraModosit(env, db, row, ujOra, { origin, admin = false, most = Date.now() }) {
  const torzs = await torzsBetolt(db);
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a jelentkezést már lemondták, nem módosítható.');
  const a = lemondasAllapot(allapotSor(row), torzs, most);
  if (a.elmult) throw new HttpError(410, 'Ez az óra már elmúlt, a link lejárt.');
  if (!admin && !a.lemondhato && row.ora_status !== 'elmarad') {
    throw new HttpError(409, `A kezdés előtti ${torzs.szabalyok.lemondasOra} órán belül a link már nem módosít. Kérjük, hívj minket: ${torzs.szabalyok.telefon}.`, { telefon: torzs.szabalyok.telefon });
  }
  if (ujOra === row.session_id) throw new HttpError(400, 'Erre az órára már jelentkeztél. Válassz másikat.');
  const r = await sessionSor(db, ujOra);
  foglalhatoE(r, torzs, { admin, most });

  const token = await tokenKeszit(await titok(env, db), row.id, row.so);
  const { lemondasUrl, icsUrl } = linkek(origin, token);
  const regi = cfNezet(row, torzs);
  const cf = cfNezet({ ...row, session_id: r.id, ar: r.ar ?? null, ...pick(r), ora_status: r.status }, torzs);
  const ics = icsKeszit(icsNezet(cf), { host: new URL(origin).host, most, lemondasUrl });
  const regiFoglalt = Number(await db.prepare(`SELECT COUNT(*) AS n FROM class_bookings WHERE session_id = ? AND status = 'megerositett'`).bind(row.session_id).first('n')) || 0;
  const vendeg = oraAthelyezesLevel(cf, { regi: { datum: regi.datum, kezd: regi.kezd, ora: { nev: regi.ora.nev } }, lemondasUrl, icsUrl, szabalyok: torzs.szabalyok, ics });
  const levelek = [
    vendeg,
    ...(row.ora_status === 'elmarad' ? [] : [oktatoErtesito(regi, kollegaCim(torzs, row.kollega_id), { esemeny: 'lemondas', allapot: { foglalt: Math.max(0, regiFoglalt - 1), kapacitas: row.kapacitas }, admin })]),
    oktatoErtesito(cf, kollegaCim(torzs, r.kollega_id), { esemeny: 'uj', allapot: { foglalt: r.foglalt + 1, kapacitas: r.kapacitas }, admin }),
  ].filter((l) => l.cimzett);
  const stmts = [
    db.prepare(`UPDATE class_bookings SET session_id = ?, ar = ?, emlekeztetve_at = NULL
      WHERE id = ? AND status = 'megerositett' AND session_id = ?
        AND (SELECT COUNT(*) FROM class_bookings WHERE session_id = ? AND status = 'megerositett')
          < (SELECT kapacitas FROM class_sessions WHERE id = ? AND status = 'aktiv')`)
      .bind(r.id, r.ar ?? null, row.id, row.session_id, r.id, r.id),
    ...levelek.map((l) => outboxHa(db, row.id, l, most, 'changes() = 1')),
  ];
  mailMod(env);
  let eredmeny;
  try {
    eredmeny = await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE constraint failed: class_bookings\.session_id, class_bookings\.email/.test(String(e && e.message))) throw marJelentkezett();
    throw e;
  }
  if (Number(eredmeny[0].meta && eredmeny[0].meta.changes) !== 1) {
    const friss = await oraFoglalasSor(db, row.id);
    if (!friss || friss.status !== 'megerositett') throw new HttpError(410, 'Ezt a jelentkezést közben lemondták.');
    if (friss.session_id !== row.session_id) throw new HttpError(409, KOZBEN_MODOSULT);
    const s = await sessionSor(db, r.id);
    if (s.status === 'elmarad') throw new HttpError(409, 'Ez az óra elmarad. Kérjük, válassz másikat.', { kod: 'elmarad' });
    throw betelt();
  }
  return { tipus: 'csoportos', azonosito: row.id, lemondasUrl, ics: icsUrl, modositva: true, level: vendegLevel(vendeg), foglalas: oraPublikus(cf) };
}

/** A köszönő oldal adatai tokennel (GET /foglalas-api/foglalas?t=). */
export async function oraFoglalasTokennel(env, db, token, origin) {
  const row = await oraTokenFoglalas(env, db, token);
  const torzs = await torzsBetolt(db);
  const k = forrasOlvas(row.forras) || {};
  const { lemondasUrl, icsUrl } = linkek(origin, token);
  return {
    tipus: 'csoportos', azonosito: row.id, lemondasUrl, ics: icsUrl, foglalas: oraPublikus(cfNezet(row, torzs)),
    meres: {
      szolgaltatas: row.class_type_id, helyszin: row.helyszin_id, ar: row.ar,
      ...Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].filter((x) => k[x]).map((x) => [x, k[x]])),
    },
  };
}

export async function oraIcsTokennel(env, db, token, origin) {
  const row = await oraTokenFoglalas(env, db, token);
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a jelentkezést lemondták.');
  if (row.ora_status === 'elmarad') throw new HttpError(410, 'Ez az óra elmarad.');
  const torzs = await torzsBetolt(db);
  return { azonosito: row.id, ics: icsKeszit(icsNezet(cfNezet(row, torzs)), { host: new URL(origin).host, lemondasUrl: linkek(origin, token).lemondasUrl }) };
}

// ---------------------------------------------------------------- emlékeztető (a 30 órás logikával)

const ORA_MS = 3600e3;
export const ORA_MAX_EGY_FUTASBAN = 25;

/** Ugyanaz a szabály, mint az egyéni emlékeztetőnél (emlekezteto.js); elmaradt órára nem megy. */
export async function oraEmlekeztetoFuttat(env, db, { origin, most = Date.now() }) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const sz = torzs.szabalyok;
  if (sz.emlekeztetoBe === false) return { kikapcsolva: true, emlekeztetve: 0, jeloltek: 0 };
  const ablakMs = sz.emlekeztetoOra * ORA_MS;
  const tol = budapestMost(most).datum;
  const ig = datumPlusz(budapestMost(most + ablakMs).datum, 1);
  const { results } = await db.prepare(
    `${FOGLALAS_SQL.replace('SELECT b.*,', `SELECT b.*, COALESCE((SELECT MAX(o.created_at) FROM outbox o WHERE o.booking_id = b.id AND o.tipus = 'modositas'), b.created_at) AS foglalva_at,`)}
     WHERE b.status = 'megerositett' AND s.status = 'aktiv' AND b.emlekeztetve_at IS NULL AND b.email != '' AND s.datum >= ? AND s.datum <= ?
     ORDER BY s.datum, s.kezd_min LIMIT 500`,
  ).bind(tol, ig).all();
  const jeloltek = (results || []).filter((r) => {
    const kezd = helyiToUtc(r.datum, r.kezd_min);
    return kezd > most && kezd - most <= ablakMs && kezd - Number(r.foglalva_at) > ablakMs;
  }).slice(0, ORA_MAX_EGY_FUTASBAN);
  if (!jeloltek.length) return { kikapcsolva: false, emlekeztetve: 0, jeloltek: 0 };
  const secret = await titok(env, db);
  const stmts = [];
  for (const row of jeloltek) {
    const token = await tokenKeszit(secret, row.id, row.so);
    const a = lemondasAllapot(allapotSor(row), torzs, most);
    const l = oraEmlekezteto(cfNezet(row, torzs), { lemondasUrl: linkek(origin, token).lemondasUrl, hataridoMs: a.hataridoMs, szabalyok: sz, lemondhato: a.lemondhato });
    stmts.push(
      db.prepare(`UPDATE class_bookings SET emlekeztetve_at = ? WHERE id = ? AND emlekeztetve_at IS NULL AND status = 'megerositett' AND session_id = ?`)
        .bind(most, row.id, row.session_id),
      outboxHa(db, row.id, l, most, 'changes() = 1'),
    );
  }
  const eredmeny = await db.batch(stmts);
  const emlekeztetve = eredmeny.filter((_, i) => i % 2 === 0).reduce((n, r) => n + (Number(r.meta && r.meta.changes) === 1 ? 1 : 0), 0);
  return { kikapcsolva: false, emlekeztetve, jeloltek: jeloltek.length };
}

// ---------------------------------------------------------------- admin: résztvevők, elmaradás, óra módosítása

export async function oraResztvevok(db, id) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const r = await sessionSor(db, id);
  const { results } = await db.prepare(`SELECT * FROM class_bookings WHERE session_id = ? ORDER BY status, created_at`).bind(id).all();
  return {
    ora: { ...oraNezet(r, torzs, Date.now()), foglalt: r.foglalt },
    resztvevok: (results || []).map((b) => ({
      azonosito: b.id, nev: b.nev, email: b.email, telefon: b.telefon, megjegyzes: b.megjegyzes, allapot: b.status, ar: b.ar,
      rogzites: b.rogzites, kampany: forrasOlvas(b.forras),
      letrehozva: new Date(b.created_at).toISOString(), lemondva: b.lemondva_at ? new Date(b.lemondva_at).toISOString() : null,
    })),
  };
}

const MEGJ_MAX = 300;
const megjegyzesSzoveg = (v) => {
  if (v == null) return '';
  if (typeof v !== 'string') throw new HttpError(400, 'Hibás mező: megjegyzés.');
  const s = v.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (s.length > MEGJ_MAX) throw new HttpError(400, `Túl hosszú megjegyzés (legfeljebb ${MEGJ_MAX} karakter).`);
  return s;
};

/**
 * Az óra elmarad (admin): állapot → elmarad, és levél minden megerősített résztvevőnek (akinek van
 * e-mail-címe). A frissítés csak akkor fut le, ha közben nem jött új résztvevő (különben 409, újra).
 */
export async function oraElmarad(env, db, id, d = {}, { most = Date.now() } = {}) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const r = await sessionSor(db, id);
  if (r.status === 'elmarad') throw new HttpError(409, 'Ez az óra már elmaradtként van jelölve.');
  if (helyiToUtc(r.datum, r.kezd_min) <= most) throw new HttpError(409, 'Elkezdődött vagy elmúlt órát nem lehet elmaradtnak jelölni.');
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'Hibás kérés.');
  const ok = megjegyzesSzoveg(d.ok);
  const { results } = await db.prepare(`${FOGLALAS_SQL} WHERE b.session_id = ? AND b.status = 'megerositett' ORDER BY b.id`).bind(id).all();
  const resztvevok = results || [];
  // ujjlenyomat: pontosan ugyanazok a résztvevők (nem csak ugyanannyian), különben 409
  const ujjlenyomat = resztvevok.length ? resztvevok.map((b) => b.id).join(',') : null;
  const levelek = resztvevok.filter((b) => b.email).map((b) => [b.id, oraElmaradLevel(cfNezet({ ...b, ora_status: 'elmarad' }, torzs), { szabalyok: torzs.szabalyok, ok })]);
  const stmts = [
    db.prepare(`UPDATE class_sessions SET status = 'elmarad', megjegyzes = ? WHERE id = ? AND status = 'aktiv'
      AND (SELECT group_concat(id, ',') FROM (SELECT id FROM class_bookings WHERE session_id = ? AND status = 'megerositett' ORDER BY id)) IS ?`).bind(ok, id, id, ujjlenyomat),
    ...levelek.map(([bid, l]) => outboxHa(db, bid, l, most, 'changes() = 1')),
  ];
  mailMod(env);
  const e = await db.batch(stmts);
  if (Number(e[0].meta && e[0].meta.changes) !== 1) throw new HttpError(409, 'Az órát közben módosították. Töltsd újra az oldalt.');
  return { id, status: 'elmarad', ertesitve: levelek.length, resztvevok: resztvevok.length };
}

/** PATCH /api/foglalo/orak/:id {kapacitas?, kollega?, megjegyzes?}: egy óra felülírása. */
export async function oraModositAdmin(db, id, d) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const r = await sessionSor(db, id);
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'Hibás kérés.');
  for (const k of Object.keys(d)) if (!['kapacitas', 'kollega', 'megjegyzes'].includes(k)) throw new HttpError(400, `Ismeretlen mező: ${k}.`);
  const kapacitas = 'kapacitas' in d ? d.kapacitas : r.kapacitas;
  if (!Number.isInteger(kapacitas) || kapacitas < 1 || kapacitas > 100) throw new HttpError(400, 'Hibás szám: kapacitás (1 és 100 között).');
  let kollega = r.kollega_id;
  if ('kollega' in d) {
    kollega = d.kollega === '' || d.kollega == null ? null : d.kollega;
    if (kollega && !torzs.kollegak.some((k) => k.id === kollega)) throw new HttpError(400, 'Ismeretlen szakember.');
  }
  const megjegyzes = 'megjegyzes' in d ? megjegyzesSzoveg(d.megjegyzes) : r.megjegyzes;
  const u = await db.prepare(`UPDATE class_sessions SET kapacitas = ?, kollega_id = ?, megjegyzes = ? WHERE id = ?
    AND (SELECT COUNT(*) FROM class_bookings WHERE session_id = ? AND status = 'megerositett') <= ?`).bind(kapacitas, kollega, megjegyzes, id, id, kapacitas).run();
  if (!Number(u.meta && u.meta.changes)) throw new HttpError(409, 'A kapacitás nem lehet kevesebb a már jelentkezettek számánál.');
  return { ...oraNezet(await sessionSor(db, id), torzs, Date.now()) };
}

// ---------------------------------------------------------------- admin: óratípusok és sablonok

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const KATEGORIAK = ['joga', 'pilates', 'aerial', 'core', 'gerinc', 'egyeb'];
const hiba = (m) => new HttpError(400, m);

function egysoros(v, mezo, max, kotelezo = true) {
  if (v == null || v === '') { if (kotelezo) throw hiba(`Hiányzó mező: ${mezo}.`); return ''; }
  if (typeof v !== 'string' || v.length > max) throw hiba(`Hibás mező: ${mezo}.`);
  const s = v.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (!s && kotelezo) throw hiba(`Hiányzó mező: ${mezo}.`);
  return s;
}
const egeszSzam = (v, mezo, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max) throw hiba(`Hibás szám: ${mezo} (${min} és ${max} között).`);
  return v;
};
const logikai = (v, mezo) => { if (typeof v !== 'boolean') throw hiba(`Hibás mező: ${mezo} (true vagy false).`); return v; };

const tipusKi = (t) => ({
  id: t.id, nev: t.nev, leiras: t.leiras, helyszin: t.helyszin_id, perc: t.perc, ar: t.ar, kapacitas: t.kapacitas, kategoria: t.kategoria,
  aktiv: t.aktiv === 1, kapacitas_megerositendo: t.kapacitas_megerositendo === 1, ar_megerositendo: t.ar_megerositendo === 1,
});

export async function oraTipusLista(db) {
  await oraSema(db);
  const { results } = await db.prepare(`SELECT * FROM class_types ORDER BY nev`).all();
  return { tipusok: (results || []).map(tipusKi) };
}

function tipusMezok(d, torzs, { reszleges }) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
  const ismert = ['id', 'nev', 'leiras', 'helyszin', 'perc', 'ar', 'kapacitas', 'kategoria', 'aktiv', 'kapacitas_megerositendo', 'ar_megerositendo'];
  for (const k of Object.keys(d)) if (!ismert.includes(k)) throw hiba(`Ismeretlen mező: ${k}.`);
  const ki = {};
  const kell = (k) => !reszleges || k in d;
  if (kell('nev')) ki.nev = egysoros(d.nev, 'név', 120);
  if ('leiras' in d) {
    if (d.leiras != null && typeof d.leiras !== 'string') throw hiba('Hibás mező: leírás.');
    const l = String(d.leiras ?? '').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (l.length > 1000) throw hiba('Túl hosszú: leírás (legfeljebb 1000 karakter).');
    ki.leiras = l;
  }
  if (kell('helyszin')) {
    if (!torzs.helyszinek.some((h) => h.id === d.helyszin)) throw hiba('Ismeretlen helyszín.');
    ki.helyszin_id = d.helyszin;
  }
  if (kell('perc')) {
    ki.perc = egeszSzam(d.perc, 'időtartam', 10, 480);
    if (ki.perc % 5 !== 0) throw hiba('Az időtartam 5 perc többszöröse legyen.');
  }
  if ('ar' in d) ki.ar = d.ar == null ? null : egeszSzam(d.ar, 'ár', 0, 10000000);
  if (kell('kapacitas')) ki.kapacitas = egeszSzam(d.kapacitas, 'kapacitás', 1, 100);
  if (kell('kategoria')) {
    if (!KATEGORIAK.includes(d.kategoria)) throw hiba(`Hibás kategória (${KATEGORIAK.join(', ')}).`);
    ki.kategoria = d.kategoria;
  }
  for (const k of ['aktiv', 'kapacitas_megerositendo', 'ar_megerositendo']) if (k in d) ki[k] = logikai(d[k], k) ? 1 : 0;
  return ki;
}

export async function oraTipusLetrehoz(db, d) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const m = tipusMezok(d, torzs, { reszleges: false });
  let id = d.id;
  if (id != null && id !== '') {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw hiba('Hibás azonosító: csak kisbetű, szám és kötőjel.');
  } else {
    id = String(m.nev).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'ora';
    for (let i = 2; await db.prepare(`SELECT 1 AS x FROM class_types WHERE id = ?`).bind(id).first('x'); i++) id = `${id.replace(/-\d+$/, '')}-${i}`;
  }
  const r = await db.prepare(`INSERT OR IGNORE INTO class_types (id, nev, leiras, helyszin_id, perc, ar, kapacitas, kategoria, aktiv, kapacitas_megerositendo, ar_megerositendo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, m.nev, m.leiras ?? '', m.helyszin_id, m.perc, m.ar ?? null, m.kapacitas, m.kategoria,
    m.aktiv ?? 1, m.kapacitas_megerositendo ?? 0, m.ar_megerositendo ?? 0, Date.now()).run();
  if (!Number(r.meta && r.meta.changes)) throw new HttpError(409, 'Ilyen azonosítójú óratípus már van.');
  return tipusKi(await db.prepare(`SELECT * FROM class_types WHERE id = ?`).bind(id).first());
}

/** A típus módosítása a már létrehozott órák hosszát és kapacitását nem írja át (azok az órán állíthatók). */
export async function oraTipusModosit(db, id, d) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  if (!(await db.prepare(`SELECT 1 AS x FROM class_types WHERE id = ?`).bind(String(id)).first('x'))) throw new HttpError(404, 'Nincs ilyen óratípus.');
  if (d && typeof d === 'object' && 'id' in d) throw hiba('Az azonosító nem módosítható.');
  const m = tipusMezok(d, torzs, { reszleges: true });
  const k = Object.keys(m);
  if (k.length) await db.prepare(`UPDATE class_types SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).bind(...k.map((x) => m[x]), id).run();
  return tipusKi(await db.prepare(`SELECT * FROM class_types WHERE id = ?`).bind(id).first());
}

const sablonKi = (s) => ({
  id: s.id, ora: s.class_type_id, kollega: s.kollega_id, nap: s.weekday, kezd: percToHHMM(s.kezd_min), ervenyes_tol: s.ervenyes_tol, ervenyes_ig: s.ervenyes_ig,
});

export async function oraSablonLista(db) {
  await oraSema(db);
  const { results } = await db.prepare(`SELECT * FROM class_templates ORDER BY weekday, kezd_min`).all();
  return { sablonok: (results || []).map(sablonKi) };
}

async function sablonMezok(db, d, torzs, { reszleges }) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
  for (const k of Object.keys(d)) if (!['ora', 'kollega', 'nap', 'kezd', 'ervenyes_tol', 'ervenyes_ig'].includes(k)) throw hiba(`Ismeretlen mező: ${k}.`);
  const ki = {};
  const kell = (k) => !reszleges || k in d;
  if (kell('ora')) {
    if (typeof d.ora !== 'string' || !(await db.prepare(`SELECT 1 AS x FROM class_types WHERE id = ?`).bind(d.ora).first('x'))) throw hiba('Ismeretlen óratípus.');
    ki.class_type_id = d.ora;
  }
  if ('kollega' in d) {
    const k = d.kollega === '' || d.kollega == null ? null : d.kollega;
    if (k && !torzs.kollegak.some((x) => x.id === k)) throw hiba('Ismeretlen szakember.');
    ki.kollega_id = k;
  }
  if (kell('nap')) ki.weekday = egeszSzam(d.nap, 'nap (1 = hétfő, 7 = vasárnap)', 1, 7);
  if (kell('kezd')) {
    const p = hhmmToPerc(d.kezd);
    if (p == null) throw hiba('Hibás kezdés (HH:MM, 15 perces lépésben).');
    ki.kezd_min = p;
  }
  for (const k of ['ervenyes_tol', 'ervenyes_ig']) {
    if (!(k in d)) continue;
    const v = d[k] == null ? '' : d[k];
    if (v !== '' && !ervenyesDatum(v)) throw hiba(`Hibás dátum: ${k} (ÉÉÉÉ-HH-NN).`);
    ki[k] = v;
  }
  return ki;
}

export async function oraSablonLetrehoz(db, d) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const m = await sablonMezok(db, d, torzs, { reszleges: false });
  if (m.ervenyes_tol && m.ervenyes_ig && m.ervenyes_tol > m.ervenyes_ig) throw hiba('Az érvényesség kezdete nem lehet a vége után.');
  const id = ujAzonosito('T');
  await db.prepare(`INSERT INTO class_templates (id, class_type_id, kollega_id, weekday, kezd_min, ervenyes_tol, ervenyes_ig, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, m.class_type_id, m.kollega_id ?? null, m.weekday, m.kezd_min, m.ervenyes_tol ?? '', m.ervenyes_ig ?? '', Date.now()).run();
  const gen = await oraGeneral(db);
  return { ...sablonKi(await db.prepare(`SELECT * FROM class_templates WHERE id = ?`).bind(id).first()), letrehozva: gen.letrehozva };
}

// a sablonból létrehozott jövőbeli, aktív, jelentkezés nélküli órák (ezeket a sablon változása
// újragenerálja). Az elmaradt óra és az az óra, amelyre valaha jelentkeztek (lemondott jelentkezéssel
// is), megmarad: így az elmaradás nem tűnik el, és a régi lemondó linkek sem lesznek 404-esek.
const URES_JOVOBELI = `template_id = ? AND datum >= ? AND status = 'aktiv' AND NOT EXISTS (SELECT 1 FROM class_bookings b WHERE b.session_id = class_sessions.id)`;

/**
 * Sablon módosítása. Az oktató cseréje minden jövőbeli órájára átvezetődik; az időpont, nap, típus
 * vagy érvényesség változásakor a jövőbeli, résztvevő nélküli órák törlődnek és újragenerálódnak.
 * A résztvevős órák maradnak (az admin elmaradtnak jelölheti őket).
 */
export async function oraSablonModosit(db, id, d) {
  await oraSema(db);
  const torzs = await torzsBetolt(db);
  const regi = await db.prepare(`SELECT * FROM class_templates WHERE id = ?`).bind(String(id)).first();
  if (!regi) throw new HttpError(404, 'Nincs ilyen sablon.');
  const m = await sablonMezok(db, d, torzs, { reszleges: true });
  const uj = { ...regi, ...m };
  if (uj.ervenyes_tol && uj.ervenyes_ig && uj.ervenyes_tol > uj.ervenyes_ig) throw hiba('Az érvényesség kezdete nem lehet a vége után.');
  const ma = budapestMost().datum;
  const idoValtozott = ['class_type_id', 'weekday', 'kezd_min', 'ervenyes_tol', 'ervenyes_ig'].some((k) => k in m && m[k] !== regi[k]);
  const stmts = [
    db.prepare(`UPDATE class_templates SET class_type_id = ?, kollega_id = ?, weekday = ?, kezd_min = ?, ervenyes_tol = ?, ervenyes_ig = ? WHERE id = ?`)
      .bind(uj.class_type_id, uj.kollega_id ?? null, uj.weekday, uj.kezd_min, uj.ervenyes_tol, uj.ervenyes_ig, id),
  ];
  if ('kollega_id' in m) stmts.push(db.prepare(`UPDATE class_sessions SET kollega_id = ? WHERE template_id = ? AND datum >= ?`).bind(uj.kollega_id ?? null, id, ma));
  if (idoValtozott) {
    stmts.push(db.prepare(`DELETE FROM class_sessions WHERE ${URES_JOVOBELI}`).bind(id, ma));
    // ha az újragenerálás elbukna, a következő kérés (nem csak a holnapi) pótolja
    stmts.push(db.prepare(`DELETE FROM settings WHERE kulcs = ?`).bind(GENERALT_KULCS));
  }
  await db.batch(stmts);
  const gen = idoValtozott ? await oraGeneral(db) : { letrehozva: 0 };
  return { ...sablonKi(await db.prepare(`SELECT * FROM class_templates WHERE id = ?`).bind(id).first()), letrehozva: gen.letrehozva };
}

/** Sablon törlése: a jövőbeli, résztvevő nélküli órái is törlődnek; a résztvevősek maradnak (darabszám a válaszban). */
export async function oraSablonTorol(db, id) {
  await oraSema(db);
  if (!(await db.prepare(`SELECT 1 AS x FROM class_templates WHERE id = ?`).bind(String(id)).first('x'))) throw new HttpError(404, 'Nincs ilyen sablon.');
  const ma = budapestMost().datum;
  const [, torolt] = await db.batch([
    db.prepare(`DELETE FROM class_templates WHERE id = ?`).bind(id),
    db.prepare(`DELETE FROM class_sessions WHERE ${URES_JOVOBELI}`).bind(id, ma),
  ]);
  const maradt = Number(await db.prepare(`SELECT COUNT(*) AS n FROM class_sessions WHERE template_id = ? AND datum >= ?`).bind(id, ma).first('n')) || 0;
  return { torolve: id, toroltOrak: Number(torolt.meta && torolt.meta.changes) || 0, resztvevosOrakMaradtak: maradt };
}
