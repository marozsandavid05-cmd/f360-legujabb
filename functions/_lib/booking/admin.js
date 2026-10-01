// Időpontfoglaló · admin műveletek: törzsadat, heti beosztás, kivételek
import { HttpError } from '../http.js';
import { ervenyesDatum, hhmmToPerc, percToHHMM } from './ido.js';
import { torzsBetolt } from './schema.js';
import { szinKioszt, szinNormal } from './szin.js';
import { beosztasBetolt, kivetelekBetolt } from './foglalas.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const hiba = (m) => new HttpError(400, m);

function str(v, mezo, max = 200, { kotelezo = true } = {}) {
  if (v == null || v === '') {
    if (kotelezo) throw hiba(`Hiányzó mező: ${mezo}.`);
    return '';
  }
  if (typeof v !== 'string' || v.length > max) throw hiba(`Hibás mező: ${mezo}.`);
  return v.trim();
}
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
    return {
      id: k.id,
      ...(szin ? { szin } : {}),
      nev: str(k.nev, 'név', 100),
      szerep: str(k.szerep, 'szerep', 200, { kotelezo: false }),
      helyszinek: idLista(k.helyszinek, 'kolléga helyszínei', hIds),
      szolgaltatasok: idLista(k.szolgaltatasok, 'kolléga szolgáltatásai', sIds),
    };
  });
  const sz = d.szabalyok || {};
  const szabalyok = {
    minEloreOra: egesz(sz.minEloreOra, 'minEloreOra', 0, 168),
    maxEloreNap: egesz(sz.maxEloreNap, 'maxEloreNap', 1, 366),
    lemondasOra: egesz(sz.lemondasOra, 'lemondasOra', 0, 168),
    telefon: str(sz.telefon, 'telefon', 30),
    studioEmail: str(sz.studioEmail, 'studioEmail', 254),
  };
  return { minta: d.minta === true, helyszinek, szolgaltatasok, kollegak, szabalyok };
}

export async function beallitasokMent(db, d) {
  const be = torzsEllenoriz(d);
  const regi = await torzsBetolt(db); // séma + seed, ha még nincs
  // a szín nélkül küldött kolléga megtartja a mentett színét; az új kolléga szabad színt kap
  const regiSzin = new Map(regi.kollegak.map((k) => [k.id, k.szin]));
  const kollegak = szinKioszt(be.kollegak.map((k) => (k.szin ? k : { ...k, szin: regiSzin.get(k.id) })));
  const torzs = { ...be, kollegak };
  await db.prepare(`UPDATE settings SET ertek = ?, modositva = ? WHERE kulcs = 'torzs'`).bind(JSON.stringify(torzs), Date.now()).run();
  return torzs;
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
