// Időpontfoglaló · a kolléga SAJÁT Google Naptárának figyelése (foglaltság, 2026-10-21).
//
// Mit csinál: ha egy kolléga a saját naptárába beír valamit (magánprogram, máshol vállalt munka,
// szabadság), az a sáv a foglalóban nem foglalható. A naptárak a kolléga `foglaltsagNaptarak`
// mezőjében vannak (0-3 naptár-azonosító); a globális kapcsoló `szabalyok.foglaltsagFigyeles`.
//
// Döntések (Hermes, 2026-10-21, a felület szerződése):
//   - Hozzáférés: a kolléga a naptárát a szolgáltatásfiók címével „Csak a szabad/foglalt időpontok
//     megtekintése (részletek elrejtése)” joggal osztja meg; a freeBusy.query csak az időszakokat adja.
//     Hatókör: calendar.readonly (a szinkron írása külön, calendar.events tokennel megy).
//   - A saját eseményeink nem számítanak kétszer: ha a figyelt naptár egyben az, ahova a foglaló ír
//     (egy kolléga naptar_id-ja vagy a stúdiónaptár), freeBusy helyett events.list megy, és a mi
//     (determinisztikus azonosítójú) eseményeink, az „átlátszó” (szabad) esemény, a törölt és a kolléga
//     által elutasított meghívó kimarad. Csak szabad/foglalt joggal ez nem megy: állapot „hiba”.
//   - Gyorsítótár a D1-ben (gcal_foglaltsag): naptáranként és naponként csak az időszakok (perc-párok)
//     és a lekérdezés ideje; cím, leírás soha. Friss 5 percig; Google-hiba esetén legfeljebb 60 perces
//     régi adat számít, utána a figyelés kiesik, a foglaló működik tovább.
//   - Foglaláskor (vendég-foglalás, vendég-módosítás) friss lekérdezés gyorsítótár nélkül; ütközésnél
//     409. Google-hiba esetén a foglalás megy, és az admin látja, hogy az ellenőrzés nem futott le.
//   - Az egész napos esemény a Google szerint alapból „szabad”: a freeBusy nem számolja, és mi sem
//     írjuk felül (az events.list ágon is csak a „Foglalt” egész napos esemény számít).
//   - Kulcs (GOOGLE_SA_KEY) nélkül, vagy kikapcsolt figyelésnél semmi nem fut: a régi működés.

import { HttpError } from '../http.js';
import { budapestMost, datumPlusz, ervenyesDatum, helyiToUtc, napok, percToHHMM } from './ido.js';
import { apiAlap, bekotve, googleToken, saBetolt } from './naptar.js';
import { sema, torzsBetolt } from './schema.js';

export const FOGLALTSAG_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const IDOKORLAT = 4000; // ms: a nyilvános oldal nem várhat sokat a Google-re
export const FRISS_MS = 5 * 60e3; // ennyi ideig friss a gyorsítótár
export const REGI_MAX_MS = 60 * 60e3; // Google-hiba esetén legfeljebb ennyi idős adat számít
const VISSZATART_ATMENETI_MS = 60e3; // átmeneti hiba után ennyi ideig nem kérdezünk újra (gyorsítótáras ágon)
const VISSZATART_TARTOS_MS = 5 * 60e3; // jog- vagy beállítási hiba után
const FREEBUSY_MAX = 50; // naptár egy freeBusy-kérésben (Google-korlát)
const MAX_OLDAL = 5; // events.list lapozás
// Google-hívás egy kérésben (a token-kérést is számolva). A vendég-foglalás kérésében a levelek (legfeljebb
// 20) és a naptár-szinkron (legfeljebb 25 + 2) is fut: 20 + 27 + 3 = 50, a Workers Free határa.
export const KERET_KINALAT = 8;
export const KERET_FRISS = 3;
export const KERET_ADMIN = 12;

export const UZENET_KOZBEN = 'Ez az időpont közben foglalt lett, kérjük, válassz másikat.';
export const UZENET_NEM_FUTOTT = 'A naptár-ellenőrzés nem futott le.';
export const UZENET_NEM_RESZLET = 'Ehhez a naptárhoz ugyanide ír a foglaló is: adj „Események részleteinek megtekintése” jogot, vagy használj külön naptárt.';
const UZENET_ATMENETI = 'A Google Naptár átmenetileg nem érhető el, a foglaltságot később újra ellenőrizzük.';
const UZENET_NINCS_BEKOTVE = 'A Google Naptár nincs bekötve (hiányzik a GOOGLE_SA_KEY titok), a kolléga naptárát a foglaló most nem figyeli.';
const UZENET_KIKAPCSOLVA = 'A foglaltság-figyelés ki van kapcsolva a beállításokban.';
const nincsHozzaferes = (cal) => `A rendszer nem látja a(z) „${cal}” naptár foglaltságát. A kolléga ossza meg a naptárát a szolgáltatásfiók címével, „Csak a szabad/foglalt időpontok megtekintése (részletek elrejtése)” joggal, és ellenőrizd az azonosítót.`;

/** Fut-e a figyelés: van érvényes kulcs, és a beállítás nincs kikapcsolva. */
export function figyelesBe(env, torzs) {
  return bekotve(env) && !!(torzs && torzs.szabalyok) && torzs.szabalyok.foglaltsagFigyeles !== false;
}

// ---------------------------------------------------------------- időszakok

const PERC = 60e3;

// a budapesti eltolás percben egy UTC-pillanatban (a téli-nyári váltás keresésére)
const eltolasPerc = (ms) => {
  const helyi = budapestMost(ms).perc;
  const u = Math.floor(ms / PERC) % 1440;
  return (((helyi - u) % 1440) + 1440) % 1440;
};

/** Egy eltolás-állandó [a, b) darab napokra bontva (a vég az utolsó perc + 1, így a váltás és az éjfél sem torzít). */
function darabNapokra(a, b, ki) {
  for (let lepes = 0; a < b && lepes < 400; lepes++) {
    const { datum, perc } = budapestMost(a);
    const v = Math.min(b, helyiToUtc(datumPlusz(datum, 1), 0));
    const vegPerc = budapestMost(v - PERC).perc + 1;
    if (vegPerc > perc) ki.push({ datum, kezd: perc, veg: vegPerc });
    a = v;
  }
}

/**
 * Egy UTC-időszak (RFC3339) budapesti helyi napokra bontva: [{ datum, kezd, veg }] (perc, 0-1440).
 * A kezdés lefelé, a vég felfelé kerekít egész percre; az éjfélen átnyúló időszak napokra bomlik. A téli-nyári
 * váltásnál a darabolás a váltás pillanatánál történik (az október végi ismétlődő óra mindkét fele megmarad).
 * `tartomany` ({ tol, ig } helyi napok): az időszak erre vágva (a nagyon hosszú esemény sem fut végig).
 */
export function helyiSavok(startIso, endIso, tartomany = null) {
  let a = Math.floor(Date.parse(startIso) / PERC) * PERC;
  let b = Math.ceil(Date.parse(endIso) / PERC) * PERC;
  const ki = [];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ki;
  if (tartomany) {
    a = Math.max(a, helyiToUtc(tartomany.tol, 0));
    b = Math.min(b, helyiToUtc(datumPlusz(tartomany.ig, 1), 0));
  }
  if (b <= a) return ki;
  // eltolás-váltás keresése (bináris kereséssel, percre pontosan), és darabolás ott
  const vagas = (x, y) => {
    if (y - x <= PERC || eltolasPerc(x) === eltolasPerc(y - PERC)) { darabNapokra(x, y, ki); return; }
    let lo = x;
    let hi = y - PERC; // eltolas(lo) != eltolas(hi)
    while (hi - lo > PERC) {
      const m = lo + Math.floor((hi - lo) / PERC / 2) * PERC;
      if (eltolasPerc(m) === eltolasPerc(lo)) lo = m; else hi = m;
    }
    darabNapokra(x, hi, ki);
    vagas(hi, y);
  };
  vagas(a, b);
  return ki;
}

/** Egész napos esemény (start.date, end.date kizáró): minden érintett nap teljes egészében, a tartományra vágva. */
function egeszNapos(tol, ig, tartomany) {
  const ki = [];
  const elso = tol > tartomany.tol ? tol : tartomany.tol;
  const utan = datumPlusz(tartomany.ig, 1);
  const vege = ig < utan ? ig : utan;
  for (let d = elso; d < vege && ki.length < 400; d = datumPlusz(d, 1)) ki.push({ datum: d, kezd: 0, veg: 1440 });
  return ki;
}

/** Időszakok összevonása naponként: Map(datum → [[kezd, veg], ...]) rendezve, átfedés nélkül. */
function napokra(savok, tol, ig) {
  const m = new Map(napok(tol, ig).map((d) => [d, []]));
  for (const s of savok) if (m.has(s.datum)) m.get(s.datum).push([s.kezd, s.veg]);
  for (const [d, l] of m) {
    l.sort((x, y) => x[0] - y[0]);
    const o = [];
    for (const [k, v] of l) {
      if (o.length && k <= o[o.length - 1][1]) o[o.length - 1][1] = Math.max(o[o.length - 1][1], v);
      else o.push([k, v]);
    }
    m.set(d, o);
  }
  return m;
}

// ---------------------------------------------------------------- Google-hívások

class FoglaltsagHiba extends Error {
  constructor(uzenet, { tartos = false, keret = false, allapot = 'hiba' } = {}) {
    super(uzenet);
    this.tartos = tartos;
    this.keret = keret;
    this.allapot = allapot;
  }
}

async function gHivas(env, kor, method, ut, { body, query } = {}) {
  for (let proba = 0; proba < 2; proba++) {
    let token;
    try {
      token = await googleToken(env, { scope: FOGLALTSAG_SCOPE, kor, friss: proba > 0 });
    } catch (e) {
      if (e && e.keret) throw new FoglaltsagHiba('keret', { keret: true });
      throw new FoglaltsagHiba(String((e && e.message) || UZENET_ATMENETI), { tartos: !(e && e.atmeneti) });
    }
    if (kor.hasznalt >= kor.max) throw new FoglaltsagHiba('keret', { keret: true });
    kor.hasznalt += 1;
    let r;
    try {
      r = await globalThis.fetch(`${apiAlap(env)}${ut}${query ? `?${new URLSearchParams(query)}` : ''}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(IDOKORLAT),
      });
    } catch {
      throw new FoglaltsagHiba(UZENET_ATMENETI);
    }
    if (r.status === 401 && proba === 0 && kor.hasznalt + 2 <= kor.max) continue;
    let d = null;
    try { d = await r.json(); } catch { /* nem JSON */ }
    if (r.ok) return d || {};
    const e = new FoglaltsagHiba(UZENET_ATMENETI, { tartos: r.status >= 400 && r.status < 500 && r.status !== 429 });
    e.status = r.status;
    throw e;
  }
  throw new FoglaltsagHiba('A Google nem fogadta el a hozzáférési tokent.', { tartos: true });
}

/** freeBusy.query egy naptár-csoportra (legfeljebb 50): Map(naptár → { savok } | { hiba }). */
async function freeBusy(env, kor, naptarak, tol, ig) {
  const d = await gHivas(env, kor, 'POST', 'freeBusy', {
    body: {
      timeMin: new Date(helyiToUtc(tol, 0)).toISOString(),
      timeMax: new Date(helyiToUtc(datumPlusz(ig, 1), 0)).toISOString(),
      items: naptarak.map((id) => ({ id })),
    },
  });
  const ki = new Map();
  for (const cal of naptarak) {
    const c = d.calendars && d.calendars[cal];
    if (!c) { ki.set(cal, { hiba: new FoglaltsagHiba(UZENET_ATMENETI) }); continue; }
    if (Array.isArray(c.errors) && c.errors.length) {
      const okok = c.errors.map((x) => x && x.reason).join(',');
      ki.set(cal, { hiba: /notFound|forbidden|accessDenied/i.test(okok)
        ? new FoglaltsagHiba(nincsHozzaferes(cal), { tartos: true, allapot: 'nincs-hozzaferes' })
        : new FoglaltsagHiba(UZENET_ATMENETI) });
      continue;
    }
    ki.set(cal, { savok: (Array.isArray(c.busy) ? c.busy : []).flatMap((b) => helyiSavok(b.start, b.end, { tol, ig })) });
  }
  return ki;
}

const SAJAT_ESEMENY_RE = /^f360[0-9a-f]+[ks]$/;

/** Számít-e foglaltnak egy esemény a saját (a foglaló által is írt) naptárban. */
export function esemenyFoglalt(e) {
  if (!e || e.status === 'cancelled') return false;
  if (e.transparency === 'transparent') return false;
  const p = e.extendedProperties && e.extendedProperties.private;
  if (p && (p.f360Foglalas || p.f360Ora)) return false;
  if (typeof e.id === 'string' && SAJAT_ESEMENY_RE.test(e.id)) return false;
  if (Array.isArray(e.attendees) && e.attendees.some((a) => a && a.self && a.responseStatus === 'declined')) return false;
  return true;
}

/** events.list egy saját naptárra (ahova a foglaló is ír): csak a foglaltnak számító események időszakai. */
async function esemenyLista(env, kor, cal, tol, ig) {
  const savok = [];
  let pageToken = '';
  for (let oldal = 0; oldal < MAX_OLDAL; oldal++) {
    let d;
    try {
      d = await gHivas(env, kor, 'GET', `calendars/${encodeURIComponent(cal)}/events`, {
        query: {
          timeMin: new Date(helyiToUtc(tol, 0)).toISOString(),
          timeMax: new Date(helyiToUtc(datumPlusz(ig, 1), 0)).toISOString(),
          singleEvents: 'true', showDeleted: 'false', maxResults: '2500',
          fields: 'accessRole,nextPageToken,items(id,status,transparency,start,end,attendees(self,responseStatus),extendedProperties)',
          ...(pageToken ? { pageToken } : {}),
        },
      });
    } catch (e) {
      if (e.status === 403 || e.status === 404) throw new FoglaltsagHiba(nincsHozzaferes(cal), { tartos: true, allapot: 'nincs-hozzaferes' });
      throw e;
    }
    if (d.accessRole === 'freeBusyReader') throw new FoglaltsagHiba(UZENET_NEM_RESZLET, { tartos: true });
    for (const e of d.items || []) {
      if (!esemenyFoglalt(e) || !e.start || !e.end) continue;
      if (e.start.dateTime && e.end.dateTime) savok.push(...helyiSavok(e.start.dateTime, e.end.dateTime, { tol, ig }));
      else if (e.start.date && e.end.date && ervenyesDatum(e.start.date) && ervenyesDatum(e.end.date)) savok.push(...egeszNapos(e.start.date, e.end.date, { tol, ig }));
    }
    if (!d.nextPageToken) return savok;
    pageToken = d.nextPageToken;
  }
  // a lapozás nem ért végére: a részleges eredmény nem megbízható, hibaként kezeljük (régi adat vagy kiesés)
  throw new FoglaltsagHiba('A naptárban túl sok esemény van ebben az időszakban, a foglaltságot nem sikerült teljesen lekérdezni.');
}

// ---------------------------------------------------------------- lekérdezés gyorsítótárral

/** Azok a naptárak, ahova a foglaló is ír (kolléga naptar_id, stúdiónaptár): ezeknél events.list megy. */
function sajatNaptarak(torzs) {
  const s = new Set(torzs.kollegak.map((k) => k.naptar_id).filter(Boolean));
  if (torzs.szabalyok && torzs.szabalyok.studioNaptarId) s.add(torzs.szabalyok.studioNaptarId);
  return s;
}

async function gyorsitotarOlvas(db, naptarak, tol, ig) {
  const { results } = await db.prepare(
    `SELECT naptar_id, datum, savok, lekerdezve, forras FROM gcal_foglaltsag WHERE naptar_id IN (SELECT value FROM json_each(?)) AND datum >= ? AND datum <= ?`,
  ).bind(JSON.stringify(naptarak), tol, ig).all();
  const { results: all } = await db.prepare(
    `SELECT naptar_id, allapot, uzenet, ellenorizve, frissitve, tartos FROM gcal_foglaltsag_allapot WHERE naptar_id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(naptarak)).all();
  const sorok = new Map();
  for (const r of results || []) {
    if (!sorok.has(r.naptar_id)) sorok.set(r.naptar_id, new Map());
    let savok = [];
    try { savok = JSON.parse(r.savok); } catch { /* sérült sor: üres */ }
    sorok.get(r.naptar_id).set(r.datum, { savok, lekerdezve: Number(r.lekerdezve), forras: r.forras });
  }
  return { sorok, allapot: new Map((all || []).map((r) => [r.naptar_id, r])) };
}

/**
 * A naptár napjai egy korhatáron belül (minden nap megvan, elég friss, és ugyanabból a forrásból jött:
 * 'fb' freeBusy vagy 'ev' events.list; szerepváltás után a régi forrás nem számít): Map(datum → savok) vagy null.
 */
function gyorsitotarbol(sorok, cal, nap, hatar, forras) {
  const m = sorok.get(cal);
  if (!m) return null;
  const ki = new Map();
  for (const d of nap) {
    const s = m.get(d);
    if (!s || s.lekerdezve < hatar || s.forras !== forras) return null;
    ki.set(d, s.savok);
  }
  return ki;
}

async function eredmenyIr(db, most, sikeres, hibak) {
  const stmts = [];
  if (sikeres.length) {
    stmts.push(db.prepare(
      `INSERT INTO gcal_foglaltsag (naptar_id, datum, savok, lekerdezve, forras)
       SELECT json_extract(j.value, '$.n'), json_extract(j.value, '$.d'), json_extract(j.value, '$.s'), ?, json_extract(j.value, '$.f') FROM json_each(?) j WHERE true
       ON CONFLICT(naptar_id, datum) DO UPDATE SET savok = excluded.savok, lekerdezve = excluded.lekerdezve, forras = excluded.forras
       WHERE excluded.lekerdezve >= gcal_foglaltsag.lekerdezve`,
    ).bind(most, JSON.stringify(sikeres.flatMap(({ cal, napok: m, forras }) => [...m].map(([d, s]) => ({ n: cal, d, s: JSON.stringify(s), f: forras }))))));
    stmts.push(db.prepare(
      `INSERT INTO gcal_foglaltsag_allapot (naptar_id, allapot, uzenet, ellenorizve, frissitve, tartos)
       SELECT j.value, 'ok', '', ?, ?, 0 FROM json_each(?) j WHERE true
       ON CONFLICT(naptar_id) DO UPDATE SET allapot = 'ok', uzenet = '', ellenorizve = excluded.ellenorizve, frissitve = excluded.frissitve, tartos = 0`,
    ).bind(most, most, JSON.stringify(sikeres.map((x) => x.cal))));
    // a tegnapnál régebbi napok kikerülnek (a gyorsítótár csak a jövőre kell), és a 7 napja nem frissített
    // állapot-sorok is (a már nem figyelt naptárak)
    stmts.push(db.prepare(`DELETE FROM gcal_foglaltsag WHERE datum < ?`).bind(datumPlusz(budapestMost(most).datum, -1)));
    stmts.push(db.prepare(`DELETE FROM gcal_foglaltsag_allapot WHERE frissitve < ?`).bind(most - 7 * 864e5));
  }
  if (hibak.length) {
    stmts.push(db.prepare(
      `INSERT INTO gcal_foglaltsag_allapot (naptar_id, allapot, uzenet, ellenorizve, frissitve, tartos)
       SELECT json_extract(j.value, '$.n'), json_extract(j.value, '$.a'), json_extract(j.value, '$.u'), NULL, ?, json_extract(j.value, '$.t') FROM json_each(?) j WHERE true
       ON CONFLICT(naptar_id) DO UPDATE SET allapot = excluded.allapot, uzenet = excluded.uzenet, frissitve = excluded.frissitve, tartos = excluded.tartos`,
    ).bind(most, JSON.stringify(hibak.map(({ cal, hiba }) => ({ n: cal, a: hiba.allapot, u: String(hiba.message).slice(0, 500), t: hiba.tartos ? 1 : 0 })))));
  }
  if (stmts.length) await db.batch(stmts);
}

/**
 * A naptárak foglalt időszakai a [tol, ig] napokra. `friss`: gyorsítótár nélkül (foglaláskor).
 * Vissza: { savok: Map(naptár → Map(datum → [[kezd, veg]])), ellenorizetlen: Set(naptár), hianyos }.
 * Az `ellenorizetlen` naptárnál a lekérdezés most nem sikerült (Google-hiba, hiányzó jog, elfogyott
 * keret); ha volt legfeljebb 60 perces adata, az a `savok`-ban van. Kulcs nélkül nem hívható.
 */
export async function foglaltsagLekerd(env, db, { naptarak, tol, ig, most = Date.now(), keret = KERET_KINALAT, friss = false, torzs = null } = {}) {
  await sema(db);
  const lista = [...new Set((naptarak || []).filter(Boolean))];
  const ki = { savok: new Map(), regiSavok: new Map(), ellenorizetlen: new Set(), hianyos: false };
  if (!lista.length) return ki;
  const t = torzs || await torzsBetolt(db);
  const sajat = sajatNaptarak(t);
  const nap = napok(tol, ig);
  const { sorok, allapot } = await gyorsitotarOlvas(db, lista, tol, ig);
  const forrasa = (cal) => (sajat.has(cal) ? 'ev' : 'fb');
  // Google-hiba után a legfeljebb 60 perces régi adat: a kínálatban tilt; foglaláskor (friss) NEM tilt, csak
  // a hézag-kezdéseket adja (a foglalás Google-hiba esetén megy, jelölve)
  const regiAdat = (cal) => {
    const r = gyorsitotarbol(sorok, cal, nap, most - REGI_MAX_MS, forrasa(cal));
    if (r) (friss ? ki.regiSavok : ki.savok).set(cal, r);
    ki.ellenorizetlen.add(cal);
  };
  const kerdezendo = [];
  for (const cal of lista) {
    if (!friss) {
      const g = gyorsitotarbol(sorok, cal, nap, most - FRISS_MS, forrasa(cal));
      if (g) { ki.savok.set(cal, g); continue; }
      const a = allapot.get(cal);
      if (a && a.allapot !== 'ok' && Number(a.frissitve) >= most - (Number(a.tartos) ? VISSZATART_TARTOS_MS : VISSZATART_ATMENETI_MS)) { regiAdat(cal); continue; }
    }
    kerdezendo.push(cal);
  }
  if (!kerdezendo.length) { ki.hianyos = ki.ellenorizetlen.size > 0; return ki; }

  const kor = { hasznalt: 0, max: Math.max(1, keret) };
  const sikeres = [];
  const hibak = [];
  const fb = kerdezendo.filter((c) => !sajat.has(c));
  const ev = kerdezendo.filter((c) => sajat.has(c));
  const kezel = (cal, eredmeny) => {
    if (eredmeny.hiba) {
      if (!eredmeny.hiba.keret) hibak.push({ cal, hiba: eredmeny.hiba });
      regiAdat(cal);
    } else {
      const m = napokra(eredmeny.savok, tol, ig);
      ki.savok.set(cal, m);
      sikeres.push({ cal, napok: m, forras: forrasa(cal) });
    }
  };
  let leall = null;
  for (let i = 0; i < fb.length; i += FREEBUSY_MAX) {
    const csoport = fb.slice(i, i + FREEBUSY_MAX);
    if (leall) { for (const c of csoport) kezel(c, { hiba: leall }); continue; }
    try {
      const m = await freeBusy(env, kor, csoport, tol, ig);
      for (const c of csoport) kezel(c, m.get(c));
    } catch (e) {
      const h = e instanceof FoglaltsagHiba ? e : new FoglaltsagHiba(UZENET_ATMENETI);
      if (h.keret || h.tartos) leall = h; // token-hiba vagy elfogyott keret: a többi naptárnak sincs értelme
      for (const c of csoport) kezel(c, { hiba: h });
    }
  }
  for (const cal of ev) {
    if (leall) { kezel(cal, { hiba: leall }); continue; }
    try {
      kezel(cal, { savok: await esemenyLista(env, kor, cal, tol, ig) });
    } catch (e) {
      const h = e instanceof FoglaltsagHiba ? e : new FoglaltsagHiba(UZENET_ATMENETI);
      if (h.keret) leall = h;
      kezel(cal, { hiba: h });
    }
  }
  try {
    await eredmenyIr(db, most, sikeres, hibak);
  } catch (e) {
    console.error('[foglaltsag] gyorsítótár-írás:', e && e.message);
  }
  ki.hianyos = ki.ellenorizetlen.size > 0;
  return ki;
}

/** A lekérdezés eredménye kollégákra vetítve: [{ kollega, datum, kezd, veg }] (a szabad-számítás bemenete). */
export function kollegaSavok(eredmeny, kollegak, mezo = 'savok') {
  const ki = [];
  for (const k of kollegak) {
    for (const cal of k.foglaltsagNaptarak || []) {
      const m = eredmeny[mezo].get(cal);
      if (!m) continue;
      for (const [datum, l] of m) for (const [kezd, veg] of l) ki.push({ kollega: k.id, datum, kezd, veg });
    }
  }
  return ki;
}

const atfed = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/** Ütközik-e a [kezd, veg) szakasz a kolléga foglalt idejével azon a napon. */
export function savUtkozik(savok, { kollega, datum, kezd, veg }) {
  return savok.some((s) => s.kollega === kollega && s.datum === datum && atfed(kezd, veg, s.kezd, s.veg));
}

/**
 * A kínálathoz: a jelölt kollégák foglalt sávjai (gyorsítótárral). Figyelés nélkül, vagy ha senkinek
 * nincs naptára, üres lista és Google-hívás nincs.
 */
export async function kinalatSavok(env, db, torzs, { kollegak, tol, ig, most = Date.now() }) {
  if (!figyelesBe(env, torzs)) return [];
  const erintett = kollegak.filter((k) => (k.foglaltsagNaptarak || []).length);
  if (!erintett.length) return [];
  try {
    const e = await foglaltsagLekerd(env, db, { naptarak: erintett.flatMap((k) => k.foglaltsagNaptarak), tol, ig, most, torzs });
    return kollegaSavok(e, erintett);
  } catch (e) {
    console.error('[foglaltsag] kínálat:', e && e.message);
    return [];
  }
}

/**
 * Foglaláskor a kolléga saját naptárának friss ellenőrzése (gyorsítótár nélkül) a jelölt kollégákra,
 * EGY lekérdezéssel. Vissza: { savok (tilt), hezagSavok (régi adat: nem tilt, csak hézag-kezdést ad),
 * ellenorizetlen: Set(kolléga) }; figyelés nélkül üres.
 */
export async function frissEllenorzes(env, db, torzs, { kollegak, datum, most = Date.now(), friss = true, keret = KERET_FRISS }) {
  const erintett = torzs.kollegak.filter((k) => kollegak.includes(k.id) && (k.foglaltsagNaptarak || []).length);
  if (!figyelesBe(env, torzs) || !erintett.length) return { savok: [], hezagSavok: [], ellenorizetlen: new Set() };
  try {
    const e = await foglaltsagLekerd(env, db, { naptarak: erintett.flatMap((k) => k.foglaltsagNaptarak), tol: datum, ig: datum, most, keret, friss, torzs });
    return {
      savok: kollegaSavok(e, erintett),
      hezagSavok: kollegaSavok(e, erintett, 'regiSavok'),
      ellenorizetlen: new Set(erintett.filter((k) => k.foglaltsagNaptarak.some((c) => e.ellenorizetlen.has(c))).map((k) => k.id)),
    };
  } catch (e) {
    console.error('[foglaltsag] friss ellenőrzés:', e && e.message);
    return { savok: [], hezagSavok: [], ellenorizetlen: new Set(erintett.map((k) => k.id)) };
  }
}

/** Az admin kézi felvételének és áthelyezésének figyelmeztetése (nem tilt): szöveg vagy undefined. */
export async function adminFigyelmeztetes(env, db, torzs, { kollega, datum, kezd, veg, most = Date.now() }) {
  const { savok } = await frissEllenorzes(env, db, torzs, { kollegak: [kollega], datum, most, friss: false, keret: KERET_FRISS });
  if (!savUtkozik(savok, { kollega, datum, kezd, veg })) return undefined;
  const k = torzs.kollegak.find((x) => x.id === kollega);
  return `Figyelem: ${k ? k.nev : 'a szakember'} saját naptárában foglalt ez az időpont. A foglalás elkészült, de egyeztess vele.`;
}

/** A foglalás naptár-jelölésének utasítása a foglalás batch-éhez: 'nem-futott' jel, vagy a jel törlése. */
export function ellenorzesJelSql(db, foglalasId, ellenorizetlen, most = Date.now()) {
  if (ellenorizetlen) {
    return db.prepare(`INSERT INTO foglalas_naptar_jel (booking_id, jel, letrehozva) VALUES (?, 'nem-futott', ?)
      ON CONFLICT(booking_id) DO UPDATE SET jel = excluded.jel, letrehozva = excluded.letrehozva`).bind(foglalasId, most);
  }
  return db.prepare(`DELETE FROM foglalas_naptar_jel WHERE booking_id = ?`).bind(foglalasId);
}

/** Az adott foglalások jelölései: Map(azonosító → jel). */
export async function ellenorzesJelek(db, ids) {
  if (!ids.length) return new Map();
  const { results } = await db.prepare(`SELECT booking_id, jel FROM foglalas_naptar_jel WHERE booking_id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids)).all();
  return new Map((results || []).map((r) => [r.booking_id, r.jel]));
}

// ---------------------------------------------------------------- admin: állapot és ütközések

const SULY = { 'nincs-hozzaferes': 3, hiba: 2, ok: 1 };

/** A GET /api/foglalo/naptar/allapot kiegészítése kollégánként: foglaltsag { allapot, uzenet, ellenorizve }. */
export async function foglaltsagAllapot(env, db, alapAllapot, { most = Date.now() } = {}) {
  const torzs = await torzsBetolt(db);
  const aktiv = torzs.kollegak.filter((k) => k.archivalt !== true);
  const be = figyelesBe(env, torzs);
  const osszes = [...new Set(aktiv.flatMap((k) => k.foglaltsagNaptarak || []))];
  let allapot = new Map();
  if (be && osszes.length) {
    const ma = budapestMost(most).datum;
    try {
      await foglaltsagLekerd(env, db, { naptarak: osszes, tol: ma, ig: ma, most, keret: KERET_ADMIN, torzs });
    } catch (e) {
      console.error('[foglaltsag] állapot:', e && e.message);
    }
    allapot = (await gyorsitotarOlvas(db, osszes, ma, ma)).allapot;
  }
  const kollegaAllapot = (k) => {
    const n = k.foglaltsagNaptarak || [];
    if (!n.length) return { allapot: 'nincs-beallitva', uzenet: '', ellenorizve: null };
    if (!bekotve(env)) {
      let uzenet = UZENET_NINCS_BEKOTVE;
      try { saBetolt(env); } catch (e) { uzenet = e.message; } // hibás (nem hiányzó) kulcs: annak az üzenete
      return { allapot: 'hiba', uzenet, ellenorizve: null };
    }
    if (!be) return { allapot: 'nincs-beallitva', uzenet: UZENET_KIKAPCSOLVA, ellenorizve: null };
    let legrosszabb = 'ok';
    const uzenetek = [];
    let ell = Infinity;
    for (const cal of n) {
      const a = allapot.get(cal);
      const all = a ? a.allapot : 'hiba';
      if (SULY[all] > SULY[legrosszabb]) legrosszabb = all;
      if (all !== 'ok') uzenetek.push(a ? a.uzenet : UZENET_ATMENETI);
      ell = Math.min(ell, a && a.ellenorizve != null ? Number(a.ellenorizve) : -1);
    }
    return { allapot: legrosszabb, uzenet: [...new Set(uzenetek)].join(' '), ellenorizve: ell > 0 && ell !== Infinity ? new Date(ell).toISOString() : null };
  };
  const kMap = new Map(aktiv.map((k) => [k.id, k]));
  return {
    ...alapAllapot,
    foglaltsagFigyeles: torzs.szabalyok.foglaltsagFigyeles !== false,
    kollegak: alapAllapot.kollegak.map((x) => {
      const k = kMap.get(x.id) || { foglaltsagNaptarak: [] };
      return { ...x, foglaltsagNaptarak: k.foglaltsagNaptarak || [], foglaltsag: kollegaAllapot(k) };
    }),
  };
}

const UTKOZES_MAX_NAP = 62;

/**
 * GET /api/foglalo/naptar/utkozesek?tol=&ig=: a jövőbeli élő foglalások és aktív csoportos órák, amelyek
 * ütköznek a kolléga saját naptárának foglalt idejével (a kolléga utólag írt be valamit). Csak jelez:
 * semmit nem töröl és nem mozgat. Kulcs nélkül vagy kikapcsolt figyelésnél üres lista.
 */
export async function utkozesek(env, db, q, { most = Date.now() } = {}) {
  const ma = budapestMost(most).datum;
  const tol0 = q.get('tol') || ma;
  const ig = q.get('ig') || datumPlusz(tol0, 13);
  if (!ervenyesDatum(tol0) || !ervenyesDatum(ig) || ig < tol0) throw new HttpError(400, 'Hibás dátum-tartomány.');
  if (napok(tol0, ig, UTKOZES_MAX_NAP + 1).length > UTKOZES_MAX_NAP) throw new HttpError(400, `Egyszerre legfeljebb ${UTKOZES_MAX_NAP} nap kérhető le.`);
  await sema(db);
  const torzs = await torzsBetolt(db);
  const tol = tol0 < ma ? ma : tol0;
  if (!figyelesBe(env, torzs) || ig < tol) return { tol: tol0, ig, utkozesek: [] };
  const erintett = torzs.kollegak.filter((k) => (k.foglaltsagNaptarak || []).length);
  if (!erintett.length) return { tol: tol0, ig, utkozesek: [] };
  const ids = JSON.stringify(erintett.map((k) => k.id));
  const { results: fogl } = await db.prepare(
    `SELECT id, staff_id, date, start_min, dur_min FROM bookings WHERE status = 'megerositett' AND date >= ? AND date <= ?
     AND staff_id IN (SELECT value FROM json_each(?)) ORDER BY date, start_min LIMIT 2000`,
  ).bind(tol, ig, ids).all();
  const { results: orak } = await db.prepare(
    `SELECT id, kollega_id, datum, kezd_min, perc FROM class_sessions WHERE status = 'aktiv' AND datum >= ? AND datum <= ?
     AND kollega_id IN (SELECT value FROM json_each(?)) ORDER BY datum, kezd_min LIMIT 2000`,
  ).bind(tol, ig, ids).all();
  const elemek = [
    ...(fogl || []).map((r) => ({ azonosito: r.id, tipus: 'foglalas', kollega: r.staff_id, datum: r.date, kezd: r.start_min, veg: r.start_min + r.dur_min })),
    ...(orak || []).map((r) => ({ azonosito: r.id, tipus: 'ora', kollega: r.kollega_id, datum: r.datum, kezd: r.kezd_min, veg: r.kezd_min + r.perc })),
  ];
  // csak azoknak a kollégáknak a naptára kell, akiknek van elemük a tartományban
  const kellK = erintett.filter((k) => elemek.some((e) => e.kollega === k.id));
  if (!kellK.length) return { tol: tol0, ig, utkozesek: [] };
  const e = await foglaltsagLekerd(env, db, { naptarak: kellK.flatMap((k) => k.foglaltsagNaptarak), tol, ig, most, keret: KERET_ADMIN, torzs });
  const savok = kollegaSavok(e, kellK);
  const nev = new Map(torzs.kollegak.map((k) => [k.id, k.nev]));
  const lista = elemek.filter((x) => helyiToUtc(x.datum, x.kezd) > most && savUtkozik(savok, x))
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.kezd - b.kezd))
    .map((x) => ({ azonosito: x.azonosito, tipus: x.tipus, kollega: { id: x.kollega, nev: nev.get(x.kollega) || x.kollega }, datum: x.datum, kezd: percToHHMM(x.kezd), veg: percToHHMM(x.veg) }));
  return { tol: tol0, ig, utkozesek: lista, ...(e.hianyos ? { hianyos: true } : {}) };
}
