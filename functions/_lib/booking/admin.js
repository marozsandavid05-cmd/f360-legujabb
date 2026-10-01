// Időpontfoglaló · admin műveletek: törzsadat, heti beosztás, kivételek
import { HttpError } from '../http.js';
import { budapestMost, ervenyesDatum, hhmmToPerc, percToHHMM } from './ido.js';
import { torzsBetolt } from './schema.js';
import { szinKioszt, szinNormal } from './szin.js';
import { KOLLEGA_UJ_MEZOK, SZABALY_UJ_ALAP, aktivSorrend, kollegaAlap, kollegaUjMezok, szabalyUjMezok, szukitoFeltetel, torzsAlap } from './torzs-alap.js';
import { beosztasBetolt, kivetelekBetolt } from './foglalas.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const hiba = (m) => new HttpError(400, m);

// egysoros szöveg (név, cím, szerep, telefon): a vezérlőkarakter és a sortörés kimarad, mert ezek a
// levelek tárgyába és fejlécébe is bekerülnek (fejléc-injekció ellen)
function str(v, mezo, max = 200, { kotelezo = true } = {}) {
  if (v == null || v === '') {
    if (kotelezo) throw hiba(`Hiányzó mező: ${mezo}.`);
    return '';
  }
  if (typeof v !== 'string' || v.length > max) throw hiba(`Hibás mező: ${mezo}.`);
  const s = v.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (!s && kotelezo) throw hiba(`Hiányzó mező: ${mezo}.`);
  return s;
}
const EMAIL_RE = /^[^\s@<>",;]{1,64}@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;
function egesz(v, mezo, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) throw hiba(`Hibás szám: ${mezo} (${min} és ${max} között).`);
  return v;
}
function idLista(v, mezo, ismert) {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !ismert.has(x))) throw hiba(`Hibás hivatkozás: ${mezo}.`);
  return [...new Set(v)];
}
function egyediId(lista, mezo) {
  const ids = new Set();
  for (const x of lista) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw hiba(`Hibás elem a listában (${mezo}).`);
    if (typeof x.id !== 'string' || !ID_RE.test(x.id)) throw hiba(`Hibás azonosító (${mezo}): csak kisbetű, szám és kötőjel.`);
    if (x.id === 'barki') throw hiba(`A „barki” azonosító foglalt (${mezo}).`);
    if (ids.has(x.id)) throw hiba(`Ismétlődő azonosító (${mezo}): ${x.id}.`);
    ids.add(x.id);
  }
  return ids;
}

/** A teljes törzsadat ellenőrzése és normalizálása (PUT /api/foglalo/beallitasok). */
export function torzsEllenoriz(d) {
  if (!d || typeof d !== 'object') throw hiba('Hibás kérés.');
  for (const k of ['helyszinek', 'szolgaltatasok', 'kollegak']) {
    if (!Array.isArray(d[k]) || d[k].length > 100) throw hiba(`Hiányzó vagy hibás lista: ${k}.`);
  }
  const hIds = egyediId(d.helyszinek, 'helyszín');
  const helyszinek = d.helyszinek.map((h) => {
    const nyit = str(h.nyit, 'nyitás', 5);
    const zar = str(h.zar, 'zárás', 5);
    if (hhmmToPerc(nyit) == null || hhmmToPerc(zar) == null || hhmmToPerc(nyit) >= hhmmToPerc(zar)) throw hiba(`Hibás nyitvatartás: ${h.id}.`);
    return { id: h.id, nev: str(h.nev, 'név', 100), cim: str(h.cim, 'cím', 200), nyit, zar };
  });
  const sIds = egyediId(d.szolgaltatasok, 'szolgáltatás');
  const szolgaltatasok = d.szolgaltatasok.map((s) => {
    // az időtartam nem kell a 15 perces rácsra essen (50 perces kezelés is van), csak a kezdés
    const perc = egesz(s.perc, 'időtartam', 10, 480);
    if (perc % 5 !== 0) throw hiba(`Az időtartam 5 perc többszöröse legyen: ${s.id}.`);
    return {
      id: s.id,
      nev: str(s.nev, 'név', 120),
      perc,
      ar: s.ar == null ? null : egesz(s.ar, 'ár', 0, 10000000),
      puffer: s.puffer == null ? 10 : egesz(s.puffer, 'puffer', 0, 120),
      helyszinek: idLista(s.helyszinek, 'szolgáltatás helyszínei', hIds),
    };
  });
  egyediId(d.kollegak, 'kolléga');
  const kollegak = d.kollegak.map((k) => {
    let szin = null;
    if (k.szin != null && k.szin !== '') {
      szin = szinNormal(k.szin);
      if (!szin) throw hiba(`Hibás szín (${k.id}): #rrggbb alakú hex kell, például #4f6d8a.`);
    }
    // a Lilla-kör mezői: csak ami a kérésben szerepel (a mentés a régi értéket megtartja a többire)
    const uj = kollegaUjMezok(k);
    return {
      id: k.id,
      ...(szin ? { szin } : {}),
      nev: str(k.nev, 'név', 100),
      szerep: str(k.szerep, 'szerep', 200, { kotelezo: false }),
      helyszinek: idLista(k.helyszinek, 'kolléga helyszínei', hIds),
      szolgaltatasok: idLista(k.szolgaltatasok, 'kolléga szolgáltatásai', sIds),
      ...uj,
    };
  });
  const sz = d.szabalyok || {};
  const szabalyok = {
    minEloreOra: egesz(sz.minEloreOra, 'minEloreOra', 0, 168),
    maxEloreNap: egesz(sz.maxEloreNap, 'maxEloreNap', 1, 366),
    lemondasOra: egesz(sz.lemondasOra, 'lemondasOra', 0, 168),
    telefon: str(sz.telefon, 'telefon', 30),
    studioEmail: studioCim(sz.studioEmail),
    ...szabalyUjMezok(sz),
  };
  return { minta: d.minta === true, helyszinek, szolgaltatasok, kollegak, szabalyok };
}

function studioCim(v) {
  const s = str(v, 'studioEmail', 254).toLowerCase();
  if (!EMAIL_RE.test(s)) throw hiba('A stúdió értesítési címe egyetlen érvényes e-mail-cím legyen, például info@f360.hu.');
  return s;
}

export async function beallitasokMent(db, d) {
  const be = torzsEllenoriz(d);
  // a mentett állapot nyersen is (a feltételes mentéshez): ha a beolvasás és az írás között valaki
  // módosította, 409, így a szűkítés-ellenőrzés mindig a ténylegesen felülírt állapotra vonatkozik
  const { ertek, torzs: regi } = await torzsNyersen(db);
  // a szín nélkül küldött kolléga megtartja a mentett színét; az új kolléga szabad színt kap;
  // a Lilla-kör mezői közül a meg nem küldöttek a mentett értéket tartják (régi felület se töröljön)
  const regiK = new Map(regi.kollegak.map((k) => [k.id, k]));
  const kollegak = szinKioszt(be.kollegak.map((k) => {
    const r = regiK.get(k.id) || {};
    const megtart = Object.fromEntries(KOLLEGA_UJ_MEZOK.filter((m) => !(m in k) && m in r).map((m) => [m, r[m]]));
    const egyesitett = kollegaAlap({ ...megtart, ...k, szin: k.szin || r.szin });
    aktivSorrend(egyesitett);
    return egyesitett;
  }));
  const szabalyok = { ...SZABALY_UJ_ALAP, ...Object.fromEntries(Object.keys(SZABALY_UJ_ALAP).map((m) => [m, regi.szabalyok[m]])), ...be.szabalyok };
  const torzs = { ...be, kollegak, szabalyok };
  // a teljes mentés se archiválhasson, törölhessen vagy tehesse a belépést, kilépést jövőbeli foglalás
  // mellé (ugyanaz az őrfeltétel, mint a kolléga-PATCH-nél)
  await torzsOrzottMent(db, ertek, torzs, szukitesek(regi.kollegak, kollegak));
  return torzs;
}

// ---------------------------------------------------------------- kolléga létrehozása, módosítása, archiválása

const KOLLEGA_MEZOK = new Set(['id', 'nev', 'szerep', 'helyszinek', 'szolgaltatasok', 'szin', ...KOLLEGA_UJ_MEZOK]);

/** Név → azonosító (ékezet nélkül, kisbetű, kötőjel), legfeljebb 50 karakter. */
export function nevbolAzonosito(nev) {
  const s = String(nev).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
  return s && s !== 'barki' ? s : 'kollega';
}

/**
 * A törzsadat feltételes mentése: csak akkor ír, ha közben senki nem módosította (különben 409),
 * így egy párhuzamos beállítás-mentést nem ír felül.
 */
async function torzsFeltetelesMent(db, regiErtek, uj) {
  const r = await db.prepare(`UPDATE settings SET ertek = ?, modositva = ? WHERE kulcs = 'torzs' AND ertek = ?`)
    .bind(JSON.stringify(uj), Date.now(), regiErtek).run();
  if (!Number(r.meta && r.meta.changes)) throw new HttpError(409, 'A beállításokat közben módosították. Töltsd újra az oldalt.');
}

async function torzsNyersen(db) {
  await torzsBetolt(db); // séma, seed és szín-pótlás, ha kell
  const ertek = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).first('ertek');
  return { ertek, torzs: torzsAlap(JSON.parse(ertek)) };
}

/** Egy kolléga mezőinek ellenőrzése a meglévő törzsadat hivatkozásaival. */
function kollegaMezok(d, torzs, { reszleges }) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
  for (const k of Object.keys(d)) if (!KOLLEGA_MEZOK.has(k)) throw hiba(`Ismeretlen mező: ${k}.`);
  const ki = {};
  if (!reszleges || 'nev' in d) ki.nev = str(d.nev, 'név', 100);
  if ('szerep' in d) ki.szerep = str(d.szerep, 'szerep', 200, { kotelezo: false });
  const hIds = new Set(torzs.helyszinek.map((h) => h.id));
  const sIds = new Set(torzs.szolgaltatasok.map((s) => s.id));
  if (!reszleges || 'helyszinek' in d) ki.helyszinek = idLista(d.helyszinek, 'kolléga helyszínei', hIds);
  if (!reszleges || 'szolgaltatasok' in d) ki.szolgaltatasok = idLista(d.szolgaltatasok, 'kolléga szolgáltatásai', sIds);
  if ('szin' in d && d.szin !== '' && d.szin != null) {
    ki.szin = szinNormal(d.szin);
    if (!ki.szin) throw hiba('Hibás szín: #rrggbb alakú hex kell, például #4f6d8a.');
  }
  return { ...ki, ...kollegaUjMezok(d) };
}

/** Jövőbeli, megerősített foglalások száma egy kollégánál, egy szűkítő feltétellel (szukitoFeltetel). */
async function jovobeliFoglalasok(db, kollega, felt) {
  const ma = budapestMost().datum;
  return Number(await db.prepare(
    `SELECT COUNT(*) AS n FROM bookings WHERE staff_id = ? AND status = 'megerositett' AND date >= ? AND (${felt.sql})`,
  ).bind(kollega, ma, ...felt.args).first('n')) || 0;
}

function foglalasUtkozes(n, mit) {
  return new HttpError(409, `A kollégának ${n} jövőbeli foglalása van, ami ${mit}. Előbb helyezd át vagy mondd le ${n > 1 ? 'ezeket' : 'ezt'}.`, { jovobeli: n });
}

/**
 * A régi és az új kolléga-listából: azok a kollégák, akiknél a változás jövőbeli foglalást érinthet.
 * A listából törölt kolléga archiválásnak számít (minden jövőbeli foglalása érintett).
 */
function szukitesek(regiKollegak, ujKollegak) {
  const regiK = new Map(regiKollegak.map((k) => [k.id, kollegaAlap(k)]));
  const ujIds = new Set(ujKollegak.map((k) => k.id));
  const torolt = regiKollegak.filter((k) => !ujIds.has(k.id)).map((k) => ({ id: k.id, felt: { sql: '1', args: [] }, archival: true }));
  return [...torolt, ...ujKollegak.flatMap((k) => {
    const r = regiK.get(k.id);
    const felt = r && szukitoFeltetel(r, k);
    return felt ? [{ id: k.id, felt, archival: k.archivalt === true && r.archivalt !== true }] : [];
  })];
}

// egy mentésben legfeljebb ennyi kolléga szűkülhet (a D1 100-as paraméterkorlátja miatt)
const MAX_SZUKITES = 20;

/**
 * A törzsadat mentése EGY utasításban, két őrfeltétellel: (1) csak akkor ír, ha közben senki nem
 * módosította (ertek = a beolvasott); (2) egyik szűkített kollégának sincs a szűkítés által érintett
 * jövőbeli foglalása. Mivel a feltétel és az írás egy utasítás, egy közben beérkező foglalás nem
 * csúszhat be a számolás és a mentés közé. Sikertelenségnél kideríti az okot: 409 a darabszámmal,
 * vagy 409 „közben módosították”.
 */
async function torzsOrzottMent(db, regiErtek, uj, szukites) {
  // a D1 egy utasításban legfeljebb 100 paramétert fogad; egy őr legfeljebb 4-et köt
  if (szukites.length > MAX_SZUKITES) {
    throw hiba(`Egyszerre legfeljebb ${MAX_SZUKITES} kolléga törölhető, archiválható vagy kaphat új belépési, kilépési dátumot. Mentsd több lépésben.`);
  }
  const ma = budapestMost().datum;
  const felt = [`kulcs = 'torzs'`];
  const args = [JSON.stringify(uj), Date.now()];
  if (regiErtek != null) { felt.push('ertek = ?'); args.push(regiErtek); }
  for (const s of szukites) {
    felt.push(`NOT EXISTS (SELECT 1 FROM bookings WHERE staff_id = ? AND status = 'megerositett' AND date >= ? AND (${s.felt.sql}))`);
    args.push(s.id, ma, ...s.felt.args);
  }
  const r = await db.prepare(`UPDATE settings SET ertek = ?, modositva = ? WHERE ${felt.join(' AND ')}`).bind(...args).run();
  if (Number(r.meta && r.meta.changes)) return;
  for (const s of szukites) {
    const n = await jovobeliFoglalasok(db, s.id, s.felt);
    if (n) throw foglalasUtkozes(n, s.archival ? 'archiválás után gazdátlan maradna' : 'a belépés előtt vagy a kilépés után esik');
  }
  throw new HttpError(409, 'A beállításokat közben módosították. Töltsd újra az oldalt.');
}

/** POST /api/foglalo/kollegak: új kolléga (201). */
export async function kollegaLetrehoz(db, d) {
  const { ertek, torzs } = await torzsNyersen(db);
  const mezok = kollegaMezok(d, torzs, { reszleges: false });
  let id;
  if (d.id != null && d.id !== '') {
    if (typeof d.id !== 'string' || !ID_RE.test(d.id) || d.id === 'barki') throw hiba('Hibás azonosító: csak kisbetű, szám és kötőjel.');
    if (torzs.kollegak.some((k) => k.id === d.id)) throw new HttpError(409, 'Ilyen azonosítójú kolléga már van.');
    id = d.id;
  } else {
    const alap = nevbolAzonosito(mezok.nev);
    id = alap;
    for (let i = 2; torzs.kollegak.some((k) => k.id === id); i++) id = `${alap}-${i}`;
  }
  const uj = kollegaAlap({ id, szerep: '', ...mezok });
  aktivSorrend(uj);
  const kollegak = szinKioszt([...torzs.kollegak, uj]);
  await torzsFeltetelesMent(db, ertek, { ...torzs, kollegak });
  return kollegak[kollegak.length - 1];
}

/**
 * PATCH /api/foglalo/kollegak/:id: csak a küldött mezők változnak. Ha a kilépés vagy a belépés
 * napja, vagy az archiválás miatt egy jövőbeli foglalás foglalhatatlanná válna, 409.
 */
export async function kollegaModosit(db, id, d) {
  const { ertek, torzs } = await torzsNyersen(db);
  const regi = torzs.kollegak.find((k) => k.id === id);
  if (!regi) throw new HttpError(404, 'Ismeretlen szakember.');
  if (d && typeof d === 'object' && 'id' in d) throw hiba('Az azonosító nem módosítható.');
  const mezok = kollegaMezok(d, torzs, { reszleges: true });
  const uj = kollegaAlap({ ...regi, ...mezok });
  aktivSorrend(uj);
  const kollegak = szinKioszt(torzs.kollegak.map((k) => (k.id === id ? uj : k)));
  await torzsOrzottMent(db, ertek, { ...torzs, kollegak }, szukitesek([regi], [uj]));
  return kollegak.find((k) => k.id === id);
}

/** POST /api/foglalo/kollegak/:id/archivalas: jövőbeli foglalás esetén 409 (a darabszámmal). */
export async function kollegaArchival(db, id) {
  return kollegaModosit(db, id, { archivalt: true });
}

/**
 * Egy kolléga színének módosítása (PATCH /api/foglalo/kollegak?kollega=) a teljes törzsadat
 * újraküldése nélkül. Csak a szín változik; a mentés feltételes, így egy közben érkezett
 * beállítás-mentést nem ír felül (ütközéskor 409, a felület újratölt).
 */
export async function kollegaSzinMent(db, kollega, d) {
  if (!kollega) throw hiba('Hiányzó paraméter: kollega.');
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
  const szin = szinNormal(d.szin);
  if (!szin) throw hiba('Hibás szín: #rrggbb alakú hex kell, például #4f6d8a.');
  await torzsBetolt(db); // séma, seed és szín-pótlás, ha kell
  const regi = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).first('ertek');
  const torzs = JSON.parse(regi);
  if (!torzs.kollegak.some((k) => k.id === kollega)) throw new HttpError(404, 'Ismeretlen szakember.');
  const uj = { ...torzs, kollegak: szinKioszt(torzs.kollegak.map((k) => (k.id === kollega ? { ...k, szin } : k))) };
  const r = await db.prepare(`UPDATE settings SET ertek = ?, modositva = ? WHERE kulcs = 'torzs' AND ertek = ?`)
    .bind(JSON.stringify(uj), Date.now(), regi).run();
  if (!Number(r.meta && r.meta.changes)) throw new HttpError(409, 'A beállításokat közben módosították. Töltsd újra az oldalt.');
  return { id: kollega, szin };
}

// ---------------------------------------------------------------- beosztás

const kiBeosztas = (b) => ({ nap: b.nap, helyszin: b.helyszin, kezd: percToHHMM(b.kezd), veg: percToHHMM(b.veg) });

export async function beosztasLekerd(db, kollega) {
  const torzs = await torzsBetolt(db);
  const osszes = await beosztasBetolt(db);
  if (!kollega) {
    return { kollegak: torzs.kollegak.map((k) => ({ id: k.id, nev: k.nev, szin: k.szin, sorok: osszes.filter((b) => b.kollega === k.id).map(kiBeosztas) })) };
  }
  if (!torzs.kollegak.some((k) => k.id === kollega)) throw hiba('Ismeretlen szakember.');
  return { kollega, sorok: osszes.filter((b) => b.kollega === kollega).map(kiBeosztas) };
}

/** A kolléga TELJES heti mintáját cseréli (egy batch: törlés + beszúrás). */
export async function beosztasMent(db, kollega, d) {
  const torzs = await torzsBetolt(db);
  const k = torzs.kollegak.find((x) => x.id === kollega);
  if (!k) throw hiba('Ismeretlen szakember.');
  if (!d || !Array.isArray(d.sorok) || d.sorok.length > 50) throw hiba('Hiányzó vagy hibás lista: sorok.');
  const sorok = d.sorok.map((s) => {
    const nap = egesz(s && s.nap, 'nap (1 = hétfő, 7 = vasárnap)', 1, 7);
    if (!k.helyszinek.includes(s.helyszin)) throw hiba('A szakember ezen a helyszínen nem dolgozik.');
    const kezd = hhmmToPerc(s.kezd);
    const veg = s.veg === '24:00' ? 1440 : hhmmToPerc(s.veg);
    if (kezd == null || veg == null || kezd >= veg) throw hiba('Hibás idősáv (HH:MM, 15 perces lépésben, a kezdés a vég előtt).');
    return { nap, helyszin: s.helyszin, kezd, veg };
  });
  for (const a of sorok) {
    for (const b of sorok) {
      if (a !== b && a.nap === b.nap && a.kezd < b.veg && b.kezd < a.veg) throw hiba('Egy napon belül átfedő idősávok.');
    }
  }
  await db.batch([
    db.prepare(`DELETE FROM schedule WHERE staff_id = ?`).bind(kollega),
    ...sorok.map((s) => db.prepare(
      `INSERT INTO schedule (staff_id, weekday, location_id, start_min, end_min) VALUES (?, ?, ?, ?, ?)`,
    ).bind(kollega, s.nap, s.helyszin, s.kezd, s.veg)),
  ]);
  return { kollega, sorok: sorok.map(kiBeosztas) };
}

// ---------------------------------------------------------------- kivételek

const kiKivetel = (k) => ({
  id: k.id, kollega: k.kollega, helyszin: k.helyszin, tol: k.tol, ig: k.ig,
  kezd: k.kezd == null ? null : percToHHMM(k.kezd), veg: k.veg == null ? null : percToHHMM(k.veg), megjegyzes: k.megjegyzes,
});

export async function kivetelLista(db, q) {
  await torzsBetolt(db);
  const tol = q.get('tol') || '0000-01-01';
  const ig = q.get('ig') || '9999-12-31';
  return { kivetelek: (await kivetelekBetolt(db, tol, ig)).map(kiKivetel) };
}

export async function kivetelFelvesz(db, d) {
  const torzs = await torzsBetolt(db);
  const kollega = d.kollega || null;
  const helyszin = d.helyszin || null;
  if (!kollega && !helyszin) throw hiba('Add meg a szakembert vagy a helyszínt (vagy mindkettőt).');
  if (kollega && !torzs.kollegak.some((k) => k.id === kollega)) throw hiba('Ismeretlen szakember.');
  if (helyszin && !torzs.helyszinek.some((h) => h.id === helyszin)) throw hiba('Ismeretlen helyszín.');
  if (!ervenyesDatum(d.tol) || !ervenyesDatum(d.ig) || d.ig < d.tol) throw hiba('Hibás dátum-tartomány.');
  let kezd = null;
  let veg = null;
  if (d.kezd != null || d.veg != null) {
    kezd = hhmmToPerc(d.kezd);
    veg = d.veg === '24:00' ? 1440 : hhmmToPerc(d.veg);
    if (kezd == null || veg == null || kezd >= veg) throw hiba('Hibás idősáv (HH:MM, 15 perces lépésben).');
  }
  const id = crypto.randomUUID();
  const megjegyzes = str(d.megjegyzes, 'megjegyzés', 300, { kotelezo: false });
  await db.prepare(
    `INSERT INTO exceptions (id, staff_id, location_id, date_from, date_to, start_min, end_min, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, kollega, helyszin, d.tol, d.ig, kezd, veg, megjegyzes, Date.now()).run();
  return kiKivetel({ id, kollega, helyszin, tol: d.tol, ig: d.ig, kezd, veg, megjegyzes });
}

export async function kivetelTorol(db, id) {
  await torzsBetolt(db);
  if (!/^[0-9a-f-]{36}$/.test(String(id || ''))) throw hiba('Hibás azonosító.');
  const r = await db.prepare(`DELETE FROM exceptions WHERE id = ?`).bind(id).run();
  if (!Number(r.meta && r.meta.changes)) throw new HttpError(404, 'Nincs ilyen kivétel.');
  return { torolve: id };
}
