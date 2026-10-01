// Időpontfoglaló · kampány-forrás (UTM) a foglaláshoz és az összesítő riport (Lilla-kör).
//
// A foglalás-kérés opcionális `forras` objektuma (a felület a látogató első érkezésekor gyűjti):
//   { utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, landing, referrer }
// Csak ezek a kulcsok tárolódnak (a többi kimarad), mind szöveg, levágva a mérethatárra, vezérlő-
// karakter nélkül; a `referrer` csak http(s) cím lehet. Üres eredmény: NULL. A bookings.forras
// oszlopba JSON-ként kerül (a régi bookings.source = 'web'/'admin' jelentése nem változik).

import { HttpError } from '../http.js';
import { budapestMost, datumPlusz, ervenyesDatum, napok } from './ido.js';
import { torzsBetolt } from './schema.js';

export const FORRAS_KULCSOK = Object.freeze({
  utm_source: 200, utm_medium: 200, utm_campaign: 200, utm_content: 200, utm_term: 200,
  gclid: 300, fbclid: 300, landing: 500, referrer: 500,
});

/** A bemenet ellenőrzése; null, ha nincs mit tárolni. Nem objektum vagy nem szöveg érték: 400. */
export function forrasBemenet(v) {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Hibás kérés: forras.');
  const ki = {};
  for (const [k, max] of Object.entries(FORRAS_KULCSOK)) {
    if (v[k] == null) continue;
    if (typeof v[k] !== 'string') throw new HttpError(400, `Hibás kérés: forras.${k}.`);
    const s = v[k].replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
    if (!s) continue;
    if (k === 'referrer' && !/^https?:\/\//i.test(s)) continue;
    ki[k] = s;
  }
  return Object.keys(ki).length ? ki : null;
}

export function forrasOlvas(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

/** A riport „forrás” oszlopa: utm_source, vagy kattintás-azonosítóból következtetve, vagy közvetlen. */
function forrasNev(k) {
  if (!k) return '(közvetlen)';
  if (k.utm_source) return k.utm_source;
  if (k.gclid) return 'google (gclid)';
  if (k.fbclid) return 'facebook (fbclid)';
  if (k.referrer) {
    try { return new URL(k.referrer).hostname; } catch { /* hibás cím */ }
  }
  return '(közvetlen)';
}

/**
 * GET /api/foglalo/riport/forrasok?tol=&ig=  foglalások száma forrás, kampány és szolgáltatás szerint.
 * A dátum a foglalt időpont napja. Alapértelmezés: 30 nappal ezelőttől 60 nap múlva. Legfeljebb 400 nap.
 */
export async function forrasRiport(db, q) {
  const torzs = await torzsBetolt(db);
  const ma = budapestMost().datum;
  const tol = q.get('tol') || datumPlusz(ma, -30);
  const ig = q.get('ig') || datumPlusz(ma, 60);
  if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw new HttpError(400, 'Hibás dátum-tartomány.');
  if (napok(tol, ig, 401).length > 400) throw new HttpError(400, 'Egyszerre legfeljebb 400 nap kérhető le.');
  const { results } = await db.prepare(
    `SELECT service_id, status, forras FROM bookings WHERE date >= ? AND date <= ?`,
  ).bind(tol, ig).all();
  const csoport = new Map();
  const osszesen = { foglalasok: 0, lemondva: 0 };
  for (const r of results || []) {
    const k = forrasOlvas(r.forras);
    const forras = forrasNev(k);
    const kampany = (k && k.utm_campaign) || '';
    const kulcs = JSON.stringify([forras, kampany, r.service_id]);
    if (!csoport.has(kulcs)) {
      const szolg = torzs.szolgaltatasok.find((s) => s.id === r.service_id);
      csoport.set(kulcs, {
        forras, medium: (k && k.utm_medium) || '', kampany,
        szolgaltatas: { id: r.service_id, nev: szolg ? szolg.nev : r.service_id, perc: szolg ? szolg.perc : null },
        foglalasok: 0, lemondva: 0,
      });
    }
    const c = csoport.get(kulcs);
    if (!c.medium && k && k.utm_medium) c.medium = k.utm_medium;
    if (r.status === 'lemondva') { c.lemondva++; osszesen.lemondva++; } else { c.foglalasok++; osszesen.foglalasok++; }
  }
  const sorok = [...csoport.values()].sort((a, b) => b.foglalasok - a.foglalasok || b.lemondva - a.lemondva
    || a.forras.localeCompare(b.forras, 'hu') || a.kampany.localeCompare(b.kampany, 'hu') || a.szolgaltatas.nev.localeCompare(b.szolgaltatas.nev, 'hu'));
  return { tol, ig, osszesen, sorok };
}
