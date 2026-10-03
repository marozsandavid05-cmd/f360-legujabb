// Időpontfoglaló · „Állandó időpont” (ismétlődő foglalás, sorozat). Csak az adminból.
// Szerződés: Claude tesztelés\f360-allando-idopont-2026-10-01\SZERZODES.md.
//
// Elv: minden alkalom egy KÖZÖNSÉGES foglalás (bookings sor + slot_locks), a meglévő admin-úton
// (foglalas.js foglal, admin: true), plusz egy sorozat_id. Így a dupla foglalás tiltása, az emlékeztető,
// a Google Naptár-szinkron, az áthelyezés és a lemondás alkalmanként változatlanul működik, és a vendég
// lemondó linkje mindig csak az adott alkalomra szól. Alkalmanként nincs visszaigazoló levél: a sorozat
// EGY összefoglalót küld a vendégnek és EGYET a kollégának (levelek-sorozat.js, Hermes).
//
// Végpontok (functions/api/foglalo): POST sorozatok/elonezet, POST sorozatok, GET sorozatok?allapot=,
// GET sorozatok/:id, POST sorozatok/:id/leallitas. Gördítés: a 15 perces cron (sorozatGordit).
//
// Tárolás (schema.js): sorozatok (+ gorditve_ig: az utolsó feldolgozott alkalom napja, gordit_zar: a
// gördítés zárja), sorozat_kimaradt (a mentéskor vagy gördítéskor ütköző alkalmak, okkal), bookings.sorozat_id.
//
// Ütközés-okok: foglalt, szabadsag, nincs_beosztas, zarva, mult, kollega_inaktiv. Hogy egy alkalom szabad-e,
// azt a meglévő szabad-számítás (szabadIdopontok, admin-törzzsel) dönti el; az ok csak a magyarázat.

import { HttpError } from '../http.js';
import { budapestMost, datumPlusz, ervenyesDatum, hetNapja, helyiToUtc, hhmmToPerc, percToHHMM } from './ido.js';
import { szabadIdopontok } from './szabad.js';
import { szamitasiTorzs, titok, torzsBetolt } from './schema.js';
import { tokenKeszit, ujAzonosito } from './token.js';
import { aktivANapon } from './torzs-alap.js';
import { beosztasBetolt, foglal, foglaltBetolt, hivatkozasok, kivetelekBetolt, lemond, szamitasra, ugyfelBemenet } from './foglalas.js';
import { sorozatKollegaErtesito, sorozatLeallitva, sorozatVisszaigazolas } from './levelek-sorozat.js';
import { kollegaCim } from './levelek-kollega.js';
import { levelSorok, mailMod } from './mailer.js';

export const SOROZAT_MAX = 104; // legfeljebb ennyi alkalom egy sorozatban (alkalom-típusnál és dátumig is)
export const GORDIT_MAX_FUTASONKENT = 40; // egy cron-futás legfeljebb ennyi alkalmat készít (D1-hívás keret)
const GORDIT_ZAR_MS = 10 * 60e3;
const SOROZAT_ID_RE = /^R[0-9A-Z]{10}$/;
const hiba = (m) => new HttpError(400, m);
const OKOK = ['foglalt', 'szabadsag', 'nincs_beosztas', 'zarva', 'mult', 'kollega_inaktiv'];

// ---------------------------------------------------------------- bemenet

/** A közös törzs (SorozatBe) ellenőrzése. */
export function sorozatBemenet(d, torzs, most = Date.now()) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
  for (const k of ['helyszin', 'szolgaltatas', 'kollega']) if (typeof d[k] !== 'string' || !d[k]) throw hiba(`Hiányzó vagy hibás mező: ${k}.`);
  if (d.kollega === 'barki') throw hiba('Állandó időponthoz válassz szakembert.');
  const { hely, szolg } = hivatkozasok(torzs, d);
  if (!Number.isInteger(d.nap) || d.nap < 1 || d.nap > 7) throw hiba('Hibás nap (1 = hétfő ... 7 = vasárnap).');
  const kezdPerc = hhmmToPerc(d.kezd);
  if (kezdPerc == null) throw hiba('Hibás kezdés (HH:MM, 15 perces lépésben).');
  const ismetles = d.ismetles == null ? 1 : d.ismetles;
  if (ismetles !== 1 && ismetles !== 2) throw hiba('Hibás ismétlés: 1 (hetente) vagy 2 (kéthetente).');
  if (!ervenyesDatum(d.kezdoDatum)) throw hiba('Hibás kezdő dátum (ÉÉÉÉ-HH-NN).');
  const ma = budapestMost(most).datum;
  if (d.kezdoDatum < datumPlusz(ma, -365) || d.kezdoDatum > datumPlusz(ma, 365)) {
    throw hiba('A kezdő dátum legfeljebb egy évvel lehet korábbi vagy későbbi a mainál.');
  }
  const v = d.vege;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw hiba('Hibás vége: datum, alkalom vagy nyitott.');
  let vege;
  if (v.tipus === 'datum') {
    if (!ervenyesDatum(v.datum) || v.datum < d.kezdoDatum) throw hiba('Hibás záró dátum: nem lehet a kezdés előtt.');
    vege = { tipus: 'datum', datum: v.datum };
  } else if (v.tipus === 'alkalom') {
    if (!Number.isInteger(v.db) || v.db < 1 || v.db > SOROZAT_MAX) throw hiba(`Hibás alkalomszám (1 és ${SOROZAT_MAX} között).`);
    vege = { tipus: 'alkalom', db: v.db };
  } else if (v.tipus === 'nyitott') {
    vege = { tipus: 'nyitott' };
  } else {
    throw hiba('Hibás vége: datum, alkalom vagy nyitott.');
  }
  return { helyszin: d.helyszin, szolgaltatas: d.szolgaltatas, kollega: d.kollega, nap: d.nap, kezdPerc, ismetles, kezdoDatum: d.kezdoDatum, vege, hely, szolg };
}

/** A gördítés határa: ma + maxEloreNap (a nyilvános foglalás ablaka). */
export function horizont(torzs, most = Date.now()) {
  return datumPlusz(budapestMost(most).datum, torzs.szabalyok.maxEloreNap ?? 60);
}

/**
 * Az alkalmak dátumai: az első a kezdő napon vagy utána, a sorozat napjára esik, utána 7 vagy 14
 * naponként. `alkalom`: N darab (az ütközők is beleszámítanak), `datum`: a záró napig (azt is
 * beleértve), `nyitott`: a horizontig. Több mint SOROZAT_MAX alkalom: 400.
 */
export function alkalomDatumok(be, hor) {
  let d = be.kezdoDatum;
  while (hetNapja(d) !== be.nap) d = datumPlusz(d, 1);
  const out = [];
  for (;; d = datumPlusz(d, 7 * be.ismetles)) {
    if (be.vege.tipus === 'alkalom' && out.length >= be.vege.db) break;
    if (be.vege.tipus === 'datum' && d > be.vege.datum) break;
    if (be.vege.tipus === 'nyitott' && d > hor) break;
    if (out.length >= SOROZAT_MAX) throw hiba(`Egy állandó időpontnak legfeljebb ${SOROZAT_MAX} alkalma lehet. Válassz korábbi záró dátumot.`);
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------- ütközés-számítás

/** Az előnézethez és a mentéshez szükséges adatok egyszerre a teljes időszakra. */
async function kornyezet(db, torzs, tol, ig) {
  const [beosztas, kivetelek, foglalt] = await Promise.all([beosztasBetolt(db), kivetelekBetolt(db, tol, ig), foglaltBetolt(db, tol, ig)]);
  return { torzs, szTorzs: szamitasiTorzs(szamitasra(torzs, { admin: true })), beosztas, kivetelek, foglalt };
}

const atfed = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/**
 * Miért nem foglalható az alkalom (null: szabad). A szabad/nem szabad döntést a meglévő
 * szabadIdopontok hozza (admin-törzs: nincs minEloreOra, maxEloreNap, bármely 15 perces kezdés),
 * így ugyanazt mondja, mint a foglal(). Az ok sorrendje: mult, kollega_inaktiv, zarva, szabadsag,
 * nincs_beosztas, foglalt.
 */
export function alkalomOk(k, be, datum, kezdPerc, most = Date.now()) {
  const kezd = percToHHMM(kezdPerc);
  const napi = szabadIdopontok({
    torzs: k.szTorzs, beosztas: k.beosztas, kivetelek: k.kivetelek, foglalt: k.foglalt, most,
    helyszin: be.helyszin, szolgaltatas: be.szolgaltatas, kollega: be.kollega, tol: datum, ig: datum,
  }).napok[datum] || [];
  if (napi.some((s) => s.kezd === kezd && s.kollegak.includes(be.kollega))) return null;
  const veg = kezdPerc + be.szolg.perc;
  if (helyiToUtc(datum, kezdPerc) < most) return 'mult';
  const koll = k.torzs.kollegak.find((x) => x.id === be.kollega);
  if (!koll || !aktivANapon(koll, datum)) return 'kollega_inaktiv';
  if (kezdPerc < hhmmToPerc(be.hely.nyit) || veg > hhmmToPerc(be.hely.zar)) return 'zarva';
  const kiv = k.kivetelek.filter((x) => datum >= x.tol && datum <= x.ig && (x.kezd == null || x.veg == null || atfed(kezdPerc, veg, x.kezd, x.veg)));
  if (kiv.some((x) => !x.kollega && x.helyszin === be.helyszin)) return 'zarva';
  if (kiv.some((x) => x.kollega === be.kollega && (!x.helyszin || x.helyszin === be.helyszin))) return 'szabadsag';
  const nap = hetNapja(datum);
  if (!k.beosztas.some((b) => b.kollega === be.kollega && b.nap === nap && b.helyszin === be.helyszin && b.kezd <= kezdPerc && veg <= b.veg)) return 'nincs_beosztas';
  return 'foglalt';
}

// ---------------------------------------------------------------- előnézet

/** POST /api/foglalo/sorozatok/elonezet: nem ír semmit. */
export async function sorozatElonezet(db, d, { most = Date.now() } = {}) {
  const torzs = await torzsBetolt(db);
  const be = sorozatBemenet(d, torzs, most);
  const hor = horizont(torzs, most);
  const datumok = alkalomDatumok(be, hor);
  const kezd = percToHHMM(be.kezdPerc);
  if (!datumok.length) return { alkalmak: [], osszes: 0, utkozik: 0, horizontVege: hor };
  const k = await kornyezet(db, torzs, datumok[0], datumok[datumok.length - 1]);
  const alkalmak = datumok.map((datum) => {
    const ok = alkalomOk(k, be, datum, be.kezdPerc, most);
    return ok ? { datum, kezd, allapot: 'utkozik', ok } : { datum, kezd, allapot: 'szabad' };
  });
  return { alkalmak, osszes: alkalmak.length, utkozik: alkalmak.filter((a) => a.allapot === 'utkozik').length, horizontVege: hor };
}

// ---------------------------------------------------------------- nézet

function vegeNezet(s) {
  if (s.vege_tipus === 'datum') return { tipus: 'datum', datum: s.vege_datum };
  if (s.vege_tipus === 'alkalom') return { tipus: 'alkalom', db: s.alkalmak_szama };
  return { tipus: 'nyitott' };
}

/** A sorozat nézete (az admin listának és a leveleknek). */
export function sorozatNezet(s, torzs) {
  const h = torzs.helyszinek.find((x) => x.id === s.location_id) || { id: s.location_id, nev: s.location_id, cim: '' };
  const sz = torzs.szolgaltatasok.find((x) => x.id === s.service_id) || { id: s.service_id, nev: s.service_id };
  const k = torzs.kollegak.find((x) => x.id === s.staff_id) || { id: s.staff_id, nev: s.staff_id };
  return {
    id: s.id,
    vendeg: { nev: s.name, email: s.email, telefon: s.phone, megjegyzes: s.note },
    helyszin: { id: h.id, nev: h.nev, cim: h.cim },
    szolgaltatas: { id: sz.id, nev: sz.nev, perc: sz.perc, ar: sz.ar ?? null },
    kollega: { id: k.id, nev: k.nev, ...(k.szin ? { szin: k.szin } : {}) },
    nap: s.weekday,
    kezd: percToHHMM(s.start_min),
    ismetles: s.interval_het,
    kezdoDatum: s.kezdo_datum,
    vege: vegeNezet(s),
    status: s.status,
    letrehozva: new Date(s.created_at).toISOString(),
    leallitva: s.leallitva_at ? new Date(s.leallitva_at).toISOString() : null,
  };
}

const sorozatSor = (db, id) => db.prepare(`SELECT * FROM sorozatok WHERE id = ?`).bind(id).first();

async function sorozatAzonositoval(db, id) {
  const s = SOROZAT_ID_RE.test(String(id || '')) ? await sorozatSor(db, id) : null;
  if (!s) throw new HttpError(404, 'Nincs ilyen állandó időpont.');
  return s;
}

/** A sorozat összesítése: következő alkalom, jövőbeli és lemondott darabszám, kimaradt alkalmak. */
function osszesites(alkalmak, kimaradt, most) {
  const jov = alkalmak.filter((b) => b.status === 'megerositett' && helyiToUtc(b.date, b.start_min) > most);
  return {
    kovetkezo: jov[0] ? { datum: jov[0].date, kezd: percToHHMM(jov[0].start_min) } : null,
    jovobeli: jov.length,
    lemondott: alkalmak.filter((b) => b.status === 'lemondva').length,
    kimaradt: kimaradt.map((x) => ({ datum: x.datum, ok: x.ok })),
  };
}

/** GET /api/foglalo/sorozatok?allapot=aktiv|leallitva|mind (alap: aktiv) */
export async function sorozatLista(db, q, { most = Date.now() } = {}) {
  const torzs = await torzsBetolt(db);
  const allapot = q.get('allapot') || 'aktiv';
  if (!['aktiv', 'leallitva', 'mind'].includes(allapot)) throw hiba('Hibás állapot: aktiv, leallitva vagy mind.');
  const felt = allapot === 'mind' ? '1' : 'status = ?';
  const args = allapot === 'mind' ? [] : [allapot];
  const { results: sorok } = await db.prepare(`SELECT * FROM sorozatok WHERE ${felt} ORDER BY weekday, start_min, name LIMIT 500`).bind(...args).all();
  const ma = budapestMost(most).datum;
  const { results: alk } = await db.prepare(
    `SELECT sorozat_id, date, start_min, status FROM bookings WHERE sorozat_id IN (SELECT id FROM sorozatok WHERE ${felt}) ORDER BY date, start_min`,
  ).bind(...args).all();
  const { results: km } = await db.prepare(
    `SELECT sorozat_id, datum, ok FROM sorozat_kimaradt WHERE datum >= ? AND sorozat_id IN (SELECT id FROM sorozatok WHERE ${felt}) ORDER BY datum`,
  ).bind(ma, ...args).all();
  const csoport = (lista, kulcs) => {
    const m = new Map();
    for (const x of lista || []) m.set(x[kulcs], [...(m.get(x[kulcs]) || []), x]);
    return m;
  };
  const alkM = csoport(alk, 'sorozat_id');
  const kmM = csoport(km, 'sorozat_id');
  return {
    sorozatok: (sorok || []).map((s) => ({ ...sorozatNezet(s, torzs), ...osszesites(alkM.get(s.id) || [], kmM.get(s.id) || [], most) })),
  };
}

/** GET /api/foglalo/sorozatok/:id  a lista egy eleme + az összes alkalom. */
export async function sorozatReszletek(db, id, { most = Date.now() } = {}) {
  const torzs = await torzsBetolt(db);
  const s = await sorozatAzonositoval(db, id);
  const { results: alk } = await db.prepare(`SELECT id, date, start_min, status FROM bookings WHERE sorozat_id = ? ORDER BY date, start_min`).bind(s.id).all();
  const { results: km } = await db.prepare(`SELECT datum, ok FROM sorozat_kimaradt WHERE sorozat_id = ? AND datum >= ? ORDER BY datum`)
    .bind(s.id, budapestMost(most).datum).all();
  return {
    ...sorozatNezet(s, torzs),
    ...osszesites(alk || [], km || [], most),
    alkalmak: (alk || []).map((b) => ({ id: b.id, datum: b.date, kezd: percToHHMM(b.start_min), allapot: b.status === 'lemondva' ? 'lemondva' : 'megerositett' })),
  };
}

// ---------------------------------------------------------------- létrehozás

function datumLista(v, mezo) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > SOROZAT_MAX) throw hiba(`Hibás mező: ${mezo}.`);
  return v;
}

/** Egy alkalom foglalása a meglévő admin-úton; 409-re null (az alkalom közben foglalt lett). */
async function alkalomFoglal(env, db, be, vendeg, datum, kezdPerc, { origin, most, sorozatId }) {
  try {
    const r = await foglal(env, db, {
      helyszin: be.helyszin, szolgaltatas: be.szolgaltatas, kollega: be.kollega, datum, kezdPerc,
      nev: vendeg.nev, email: vendeg.email, telefon: vendeg.telefon, megjegyzes: vendeg.megjegyzes, forras: null,
    }, { origin, admin: true, most, sorozatId });
    return { id: r.azonosito, datum, kezd: percToHHMM(kezdPerc), lemondasUrl: r.lemondasUrl };
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return null;
    throw e;
  }
}

/**
 * POST /api/foglalo/sorozatok. A sorozat sora előbb kerül be (a foglalás batch-e csak aktív sorozathoz
 * köt), utána alkalmanként a foglal(). Ha egy alkalom sem jön létre, a sorozat törlődik és 409.
 * `kihagy`: szándékos kihagyás (a válaszban ok: 'kihagyva', a figyelmeztető listába nem kerül);
 * `athelyez`: csak ütköző alkalomra, az új időpontnak szabadnak kell lennie (különben az is kimarad).
 */
export async function sorozatLetrehoz(env, db, d, { origin, most = Date.now() }) {
  const torzs = await torzsBetolt(db);
  const be = sorozatBemenet(d, torzs, most);
  if (!d.vendeg || typeof d.vendeg !== 'object' || Array.isArray(d.vendeg)) throw hiba('Hiányzó mező: vendeg.');
  const vendeg = ugyfelBemenet(d.vendeg, { admin: true });
  const hor = horizont(torzs, most);
  const datumok = alkalomDatumok(be, hor);
  const kihagy = new Set();
  for (const x of datumLista(d.kihagy, 'kihagy')) {
    if (!datumok.includes(x)) throw hiba('A kihagyott dátum nem tartozik az állandó időponthoz.');
    kihagy.add(x);
  }
  const athelyez = new Map();
  for (const a of datumLista(d.athelyez, 'athelyez')) {
    if (!a || typeof a !== 'object' || !datumok.includes(a.datum)) throw hiba('Az áthelyezett dátum nem tartozik az állandó időponthoz.');
    const kp = hhmmToPerc(a.ujKezd);
    if (!ervenyesDatum(a.ujDatum) || kp == null) throw hiba('Hibás áthelyezés (ujDatum, ujKezd).');
    if (a.ujDatum < datumPlusz(budapestMost(most).datum, -1) || a.ujDatum > datumPlusz(budapestMost(most).datum, 366 * 2)) throw hiba('Hibás áthelyezés: ujDatum.');
    athelyez.set(a.datum, { datum: a.ujDatum, kezdPerc: kp });
  }
  if (!datumok.length) throw new HttpError(409, 'A megadott időszakban nincs ilyen nap.', { kimaradt: [] });

  const id = ujAzonosito('R');
  const sor = {
    id, location_id: be.helyszin, service_id: be.szolgaltatas, staff_id: be.kollega, weekday: be.nap, start_min: be.kezdPerc,
    interval_het: be.ismetles, kezdo_datum: be.kezdoDatum, vege_tipus: be.vege.tipus, vege_datum: be.vege.datum ?? null,
    alkalmak_szama: be.vege.db ?? null, name: vendeg.nev, email: vendeg.email, phone: vendeg.telefon, note: vendeg.megjegyzes,
    status: 'aktiv', created_at: most, leallitva_at: null,
    // a nyitott sorozatot a horizontig most elkészítjük, a gördítés onnan folytatja
    gorditve_ig: be.vege.tipus === 'nyitott' ? hor : datumok[datumok.length - 1], gordit_zar: null,
  };
  const cols = Object.keys(sor);
  await db.prepare(`INSERT INTO sorozatok (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => sor[c])).run();

  const ujNapok = [...athelyez.values()].map((x) => x.datum);
  const tol = [datumok[0], ...ujNapok].sort()[0];
  const ig = [datumok[datumok.length - 1], ...ujNapok].sort().pop();
  const k = await kornyezet(db, torzs, tol, ig);
  const letrejott = [];
  const kimaradt = [];
  try {
    for (const datum of datumok) {
      if (kihagy.has(datum)) { kimaradt.push({ datum, ok: 'kihagyva' }); continue; }
      const ok = alkalomOk(k, be, datum, be.kezdPerc, most);
      const at = ok ? athelyez.get(datum) : null;
      if (ok && !at) { kimaradt.push({ datum, ok }); continue; }
      const cel = at || { datum, kezdPerc: be.kezdPerc };
      if (at) {
        const ujOk = alkalomOk(k, be, at.datum, at.kezdPerc, most);
        if (ujOk) { kimaradt.push({ datum, ok: ujOk }); continue; }
      }
      const a = await alkalomFoglal(env, db, be, vendeg, cel.datum, cel.kezdPerc, { origin, most, sorozatId: id });
      if (!a) { kimaradt.push({ datum, ok: 'foglalt' }); continue; }
      letrejott.push(at ? { ...a, athelyezve: datum } : a);
    }
  } catch (e) {
    // váratlan hiba (D1, keret): minden visszaáll, hogy az újramentés ne adjon félkész, duplikált sorozatot.
    // Az alkalmak még sehova nem jutottak ki: levél nincs (sorozatnál alkalmanként nem is lenne), a Google
    // Naptár-szinkront a router csak sikeres válasz után indítja.
    await sorozatTorol(db, id).catch((t) => console.error('[sorozat] visszagörgetés sikertelen:', id, t && t.message));
    throw e;
  }
  if (!letrejott.length) {
    await db.prepare(`DELETE FROM sorozatok WHERE id = ?`).bind(id).run();
    throw new HttpError(409, 'Egyetlen alkalom sem foglalható. Válassz másik napot, időpontot vagy szakembert.', { kimaradt });
  }
  const s = sorozatNezet(sor, torzs);
  const alkalmak = [...letrejott].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0))
    .map(({ datum, kezd, lemondasUrl }) => ({ datum, kezd, lemondasUrl }));
  const rovid = alkalmak.map(({ datum, kezd }) => ({ datum, kezd }));
  const levelek = [
    sorozatVisszaigazolas(s, { alkalmak, szabalyok: torzs.szabalyok }),
    sorozatKollegaErtesito(s, kollegaCim(torzs, be.kollega), { alkalmak: rovid, esemeny: 'uj' }),
    // a stúdió címére (üres cím: levelSorok kihagyja)
    sorozatKollegaErtesito(s, torzs.szabalyok.studioEmail || '', { alkalmak: rovid, esemeny: 'uj', studio: true }),
  ];
  mailMod(env);
  const vegso = [
    ...kimaradt.filter((x) => x.ok !== 'kihagyva').map((x) => db.prepare(
      `INSERT OR IGNORE INTO sorozat_kimaradt (sorozat_id, datum, ok, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(id, x.datum, x.ok, most)),
    ...levelSorok(db, id, levelek, most),
  ];
  // a D1 az üres batch-et elutasítja (e-mail és kolléga-cím nélkül, ütközés nélkül nincs mit írni)
  if (vegso.length) await db.batch(vegso);
  return {
    sorozat: s,
    letrejott: letrejott.map(({ id: fid, datum, kezd, athelyezve }) => ({ id: fid, datum, kezd, ...(athelyezve ? { athelyezve } : {}) })),
    kimaradt,
  };
}

/** A létrehozás visszagörgetése: a sorozat, az alkalmai és a záraik egy batch-ben. */
async function sorozatTorol(db, id) {
  await db.batch([
    db.prepare(`DELETE FROM slot_locks WHERE booking_id IN (SELECT id FROM bookings WHERE sorozat_id = ?)`).bind(id),
    db.prepare(`DELETE FROM outbox WHERE booking_id IN (SELECT id FROM bookings WHERE sorozat_id = ?)`).bind(id),
    db.prepare(`DELETE FROM bookings WHERE sorozat_id = ?`).bind(id),
    db.prepare(`DELETE FROM sorozat_kimaradt WHERE sorozat_id = ?`).bind(id),
    db.prepare(`DELETE FROM sorozatok WHERE id = ?`).bind(id),
  ]);
}

// ---------------------------------------------------------------- leállítás

/**
 * POST /api/foglalo/sorozatok/:id/leallitas { tol }: a sorozat leállt, a tol napon vagy utána lévő minden
 * jövőbeli, megerősített alkalom lemondva (a meglévő admin-lemondással, alkalmanként levél nélkül; a
 * Google Naptárból a háttér-szinkron törli). A vendég és a kolléga egy-egy összefoglalót kap.
 *
 * Először az állapot vált (status = 'leallitva', leallitva_tol = tol), így a gördítés és a foglal() batch-e
 * (csak aktív sorozathoz köt) azonnal megáll. Ha a lemondások közben hiba jön, az újrapróbálás FOLYTATJA
 * (a tárolt tol szerint), nem 409: 409 csak akkor, ha nincs több lemondandó alkalom és az összefoglaló
 * már kiment. Az összefoglaló a leállításkor lemondott összes alkalmat felsorolja, és sorozatonként egyszer
 * kerül az outboxba (feltételes beszúrás). A stúdió is kap egy összefoglalót (sorozat-studio), ha van címe.
 *
 * Utólag korábbi naptól: ha a sorozat már le van állítva, és a kérésben MEGADOTT tol korábbi a tárolt
 * leallitva_tol-nál (Lilla túl késői napot adott meg), a leállítás kiterjed: a leallitva_tol és a
 * leallitva_at frissül (feltételes UPDATE), a tol és a régi nap közötti megerősített, jövőbeli alkalmak is
 * lemondva, és az összefoglalók újra kimennek, csak az újonnan lemondott alkalmakkal (üres listánál nem).
 * A tol nélküli hívás (ma) ilyenkor sem terjeszt ki, az csak folytat. Nem korábbi tol: a szokásos 409.
 */
export async function sorozatLeallit(env, db, id, d, { origin, most = Date.now() }) {
  const torzs = await torzsBetolt(db);
  let s0 = await sorozatAzonositoval(db, id);
  const ma = budapestMost(most).datum;
  const megadott = d && d.tol != null && d.tol !== '';
  const kertTol = megadott ? d.tol : ma;
  if (!ervenyesDatum(kertTol)) throw hiba('Hibás dátum: tol (ÉÉÉÉ-HH-NN).');
  if (kertTol < ma) throw hiba('A leállítás napja nem lehet a múltban.');
  const r = await db.prepare(`UPDATE sorozatok SET status = 'leallitva', leallitva_at = ?, leallitva_tol = ? WHERE id = ? AND status = 'aktiv'`)
    .bind(most, kertTol, s0.id).run();
  const elso = Number(r.meta && r.meta.changes) === 1;
  let kiterjesztes = false;
  if (!elso && megadott) {
    // már leállították: ha a megadott nap korábbi a tároltnál, a leállítás kiterjed (új leállítási időpont)
    const k = await db.prepare(`UPDATE sorozatok SET leallitva_at = ?, leallitva_tol = ? WHERE id = ? AND status = 'leallitva' AND leallitva_tol > ?`)
      .bind(most, kertTol, s0.id, kertTol).run();
    kiterjesztes = Number(k.meta && k.meta.changes) === 1;
  }
  const uj = elso || kiterjesztes;
  if (!uj) s0 = await sorozatSor(db, s0.id); // már leállították: a tárolt tol és időpont szerint folytatjuk
  const tol = uj ? kertTol : (s0.leallitva_tol || kertTol);
  const leallitvaAt = uj ? most : Number(s0.leallitva_at || most);

  const { results } = await db.prepare(`SELECT * FROM bookings WHERE sorozat_id = ? AND status = 'megerositett' ORDER BY date, start_min`).bind(s0.id).all();
  const jovobeli = (results || []).filter((b) => helyiToUtc(b.date, b.start_min) > most);
  const hatra = jovobeli.filter((x) => x.date >= tol);
  // a létrehozáskori kolléga- és stúdió-levél típusa ugyanaz, a tárgya „Új állandó időpont”-tal kezdődik
  const levelVan = !uj && await db.prepare(`SELECT 1 AS x FROM outbox WHERE booking_id = ? AND tipus IN ('sorozat-leallitva', 'sorozat-kollega', 'sorozat-studio')
      AND targy NOT LIKE 'Új állandó időpont%' AND created_at >= ? LIMIT 1`)
    .bind(s0.id, leallitvaAt).first('x');
  if (!uj && !hatra.length && levelVan) throw new HttpError(409, 'Ez az állandó időpont már le van állítva.');

  for (const b of hatra) {
    try {
      await lemond(env, db, b, { admin: true, most, levelNelkul: true });
    } catch (e) {
      // közben lemondták vagy áthelyezték: nem a leállítás hibája
      if (!(e instanceof HttpError && (e.status === 409 || e.status === 410))) throw e;
    }
  }
  // a leállítás óta lemondott alkalmak (egy félbeszakadt korábbi futáséi is)
  const { results: lemondottak } = await db.prepare(
    `SELECT id, date, start_min FROM bookings WHERE sorozat_id = ? AND status = 'lemondva' AND date >= ? AND cancelled_at >= ? ORDER BY date, start_min`,
  ).bind(s0.id, tol, leallitvaAt).all();
  const lemondott = lemondottak || [];
  const secret = await titok(env, db);
  const maradt = [];
  for (const b of jovobeli.filter((x) => x.date < tol)) {
    const token = await tokenKeszit(secret, b.id, b.token_salt);
    maradt.push({ datum: b.date, kezd: percToHHMM(b.start_min), lemondasUrl: `${origin}/foglalas/lemondas?t=${encodeURIComponent(token)}` });
  }
  const s = sorozatNezet({ ...s0, status: 'leallitva', leallitva_at: leallitvaAt }, torzs);
  const lem = lemondott.map((b) => ({ datum: b.date, kezd: percToHHMM(b.start_min) }));
  // kiterjesztésnél csak akkor megy levél, ha tényleg lett újonnan lemondott alkalom
  const levelek = kiterjesztes && !lem.length ? [] : [
    sorozatLeallitva(s, { lemondott: lem, maradt, szabalyok: torzs.szabalyok }),
    sorozatKollegaErtesito(s, kollegaCim(torzs, s0.staff_id), { alkalmak: lem, esemeny: 'leallitva' }),
    sorozatKollegaErtesito(s, torzs.szabalyok.studioEmail || '', { alkalmak: lem, esemeny: 'leallitva', studio: true }),
  ].filter((l) => l.cimzett);
  mailMod(env);
  if (levelek.length) {
    // leállításonként egyszer: csak ha erről a leállításról még nincs ugyanilyen levél (a létrehozáskori,
    // azonos típusú kolléga- és stúdió-levelet a tárgy különbözteti meg)
    await db.batch(levelek.map((l) => db.prepare(
      `INSERT INTO outbox (booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at)
       SELECT ?, ?, ?, ?, ?, ?, NULL, 0, ? WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE booking_id = ? AND tipus = ? AND cimzett = ? AND targy = ? AND created_at >= ?)`,
    ).bind(s0.id, l.tipus, l.cimzett, l.targy, l.html, l.szoveg, most, s0.id, l.tipus, l.cimzett, l.targy, leallitvaAt)));
  }
  return { sorozat: s, lemondott: lemondott.map((b) => ({ id: b.id, datum: b.date })) };
}

// ---------------------------------------------------------------- gördítés (nyitott sorozat)

/**
 * A „visszavonásig” sorozatok meghosszabbítása a horizontig (ma + maxEloreNap); a 15 perces cron hívja.
 * Sorozatonként zár (gordit_zar, feltételes UPDATE): két párhuzamos futás közül csak az egyik dolgozik
 * rajta. A már elkészült napot (bármilyen állapotú alkalom, vagy kimaradtként naplózott) kihagyja, így
 * egy félbeszakadt futás után sem duplikál; a gorditve_ig a feldolgozott napig nő. Ütköző alkalom
 * kimarad, a sorozat_kimaradt táblába kerül (okkal), és nem írja felül a meglévő foglalást. Alkalmanként
 * nincs levél (az emlékeztető a szokásos úton megy).
 * @returns {{ letrejott: number, kimaradt: number, hibas: number, ids: string[] }}
 */
export async function sorozatGordit(env, db, { origin, most = Date.now(), max = GORDIT_MAX_FUTASONKENT } = {}) {
  const torzs = await torzsBetolt(db);
  const hor = horizont(torzs, most);
  const ma = budapestMost(most).datum;
  const ered = { letrejott: 0, kimaradt: 0, hibas: 0, ids: [] };
  const { results: sorozatok } = await db.prepare(
    `SELECT * FROM sorozatok WHERE status = 'aktiv' AND vege_tipus = 'nyitott' AND gorditve_ig < ? ORDER BY gorditve_ig LIMIT 200`,
  ).bind(hor).all();
  const kor = { keret: max };
  for (const s of sorozatok || []) {
    if (kor.keret <= 0) break;
    const zar = Date.now();
    const sajat = await db.prepare(
      `UPDATE sorozatok SET gordit_zar = ? WHERE id = ? AND status = 'aktiv' AND (gordit_zar IS NULL OR gordit_zar < ?) RETURNING gorditve_ig`,
    ).bind(zar, s.id, zar - GORDIT_ZAR_MS).first();
    if (!sajat) continue; // egy másik futás dolgozik rajta
    const allapot = { kesz: sajat.gorditve_ig };
    try {
      await egySorozatGordit(env, db, s, allapot, { torzs, hor, ma, most, origin, kor, ered });
    } catch (e) {
      // egy hibás sorozat ne állítsa meg a többit és a cron többi lépését (levélküldés, naptár): a
      // gorditve_ig csak a sikeresen feldolgozott napig nő, a következő futás innen próbálja újra
      ered.hibas += 1;
      console.error('[sorozat] gördítési hiba:', s.id, e && e.message);
    } finally {
      await db.prepare(`UPDATE sorozatok SET gorditve_ig = MAX(gorditve_ig, ?), gordit_zar = NULL WHERE id = ? AND gordit_zar = ?`)
        .bind(allapot.kesz, s.id, zar).run();
    }
  }
  return ered;
}

/** Egy nyitott sorozat gördítése; az `allapot.kesz` az utolsó feldolgozott nap (hiba esetén is ez íródik vissza). */
async function egySorozatGordit(env, db, s, allapot, { torzs, hor, ma, most, origin, kor, ered }) {
  const be = {
    helyszin: s.location_id, szolgaltatas: s.service_id, kollega: s.staff_id, nap: s.weekday, kezdPerc: s.start_min,
    ismetles: s.interval_het, kezdoDatum: s.kezdo_datum, vege: { tipus: 'nyitott' },
  };
  const datumok = alkalomDatumokNyitott(be, allapot.kesz, hor).filter((x) => x >= ma);
  if (!datumok.length) { allapot.kesz = hor; return; }
  let hiv = null;
  try { hiv = hivatkozasok(torzs, be); } catch (e) { if (!(e instanceof HttpError)) throw e; }
  if (!hiv) {
    // a helyszín, a szolgáltatás vagy a kolléga hozzárendelése közben megszűnt: az alkalmak kimaradnak,
    // a napló mutatja (a sorozat adatai nem változnak, a gördítés továbblép)
    for (const datum of datumok) await kimaradtIr(db, s.id, datum, 'kollega_inaktiv', most, ered);
    allapot.kesz = hor;
    return;
  }
  Object.assign(be, hiv);
  const vendeg = { nev: s.name, email: s.email, telefon: s.phone, megjegyzes: s.note };
  // már feldolgozott nap: van alkalma (bármilyen állapotban) vagy kimaradtként naplózott
  const { results: meglevo } = await db.prepare(`SELECT date FROM bookings WHERE sorozat_id = ? AND date >= ?`).bind(s.id, datumok[0]).all();
  const { results: naplo } = await db.prepare(`SELECT datum FROM sorozat_kimaradt WHERE sorozat_id = ? AND datum >= ?`).bind(s.id, datumok[0]).all();
  const voltMar = new Set([...(meglevo || []).map((x) => x.date), ...(naplo || []).map((x) => x.datum)]);
  const k = await kornyezet(db, torzs, datumok[0], datumok[datumok.length - 1]);
  for (const datum of datumok) {
    if (voltMar.has(datum)) { allapot.kesz = datum; continue; }
    if (kor.keret <= 0) return; // a keret elfogyott: a következő futás folytatja
    kor.keret -= 1;
    const ok = alkalomOk(k, be, datum, be.kezdPerc, most);
    const a = ok ? null : await alkalomFoglal(env, db, be, vendeg, datum, be.kezdPerc, { origin, most, sorozatId: s.id });
    if (a) {
      ered.letrejott += 1;
      ered.ids.push(a.id);
    } else {
      // közben leállították: nem naplózunk kimaradást, és nem lépünk tovább
      const st = await db.prepare(`SELECT status FROM sorozatok WHERE id = ?`).bind(s.id).first('status');
      if (st !== 'aktiv') return;
      await kimaradtIr(db, s.id, datum, ok || 'foglalt', most, ered);
    }
    allapot.kesz = datum;
  }
  allapot.kesz = hor;
}

async function kimaradtIr(db, sorozatId, datum, ok, most, ered) {
  if (!OKOK.includes(ok)) ok = 'foglalt';
  const r = await db.prepare(`INSERT OR IGNORE INTO sorozat_kimaradt (sorozat_id, datum, ok, created_at) VALUES (?, ?, ?, ?)`)
    .bind(sorozatId, datum, ok, most).run();
  if (Number(r.meta && r.meta.changes)) {
    ered.kimaradt += 1;
    console.warn(`[sorozat] ${sorozatId} ${datum} kimaradt: ${ok}`);
  }
}

/** A nyitott sorozat `utan` utáni, a horizontig tartó alkalom-dátumai (a sorozat ritmusában). */
function alkalomDatumokNyitott(be, utan, hor) {
  let d = be.kezdoDatum;
  while (hetNapja(d) !== be.nap) d = datumPlusz(d, 1);
  const out = [];
  for (; d <= hor; d = datumPlusz(d, 7 * be.ismetles)) if (!utan || d > utan) out.push(d);
  return out;
}
