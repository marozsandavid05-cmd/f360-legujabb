// Időpontfoglaló · emlékeztető a páciensnek (Lilla-kör: kb. 30 órával a kezdés előtt).
//
// Ki kap: a megerősített foglalás, ha
//   - a kezdése a [most, most + emlekeztetoOra] ablakban van,
//   - még nem kapott emlékeztetőt (bookings.emlekeztetve_at IS NULL),
//   - és nem az ablakon belül foglalták vagy helyezték át (a közelebbi időpontra foglaló a
//     visszaigazolást épp most kapta meg, neki nem kell külön emlékeztető).
// Egyszer, idempotensen: az emlekeztetve_at feltételes UPDATE-je és a levél beszúrása egy
// batch-ben van, a levél csak akkor kerül be, ha ez a futás állította be az időbélyeget
// (changes() = 1), így párhuzamos vagy ismételt futás sem ír két levelet.
// Módosításkor (foglalas.js modosit) az emlekeztetve_at nullázódik: az új időpontra újra jár.

import { budapestMost, datumPlusz, helyiToUtc } from './ido.js';
import { nezet } from './foglalas.js';
import { titok, torzsBetolt } from './schema.js';
import { tokenKeszit } from './token.js';
import { emlekezteto } from './levelek-kollega.js';
import { lemondasAllapot } from './foglalas.js';

const ORA = 3600e3;
export const MAX_EGY_FUTASBAN = 25; // egy futás legfeljebb ennyi levelet ír (15 percenként fut)

export async function emlekeztetoFuttat(env, db, { origin, most = Date.now() }) {
  const torzs = await torzsBetolt(db);
  const sz = torzs.szabalyok;
  if (sz.emlekeztetoBe === false) return { kikapcsolva: true, emlekeztetve: 0, jeloltek: 0 };
  const ablakMs = sz.emlekeztetoOra * ORA;
  const tol = budapestMost(most).datum;
  const ig = datumPlusz(budapestMost(most + ablakMs).datum, 1);
  // a foglalás „ideje”: a létrehozás, vagy ha később áthelyezték, az utolsó módosító levél ideje
  const { results } = await db.prepare(
    `SELECT b.*, COALESCE((SELECT MAX(o.created_at) FROM outbox o WHERE o.booking_id = b.id AND o.tipus = 'modositas'), b.created_at) AS foglalva_at
     FROM bookings b
     WHERE b.status = 'megerositett' AND b.emlekeztetve_at IS NULL AND b.email != '' AND b.date >= ? AND b.date <= ?
     ORDER BY b.date, b.start_min LIMIT 500`,
  ).bind(tol, ig).all();
  const jeloltek = (results || []).filter((r) => {
    const kezd = helyiToUtc(r.date, r.start_min);
    return kezd > most && kezd - most <= ablakMs && kezd - Number(r.foglalva_at) > ablakMs;
  }).slice(0, MAX_EGY_FUTASBAN);
  if (!jeloltek.length) return { kikapcsolva: false, emlekeztetve: 0, jeloltek: 0 };

  const secret = await titok(env, db);
  const stmts = [];
  for (const row of jeloltek) {
    const token = await tokenKeszit(secret, row.id, row.token_salt);
    const lemondasUrl = `${origin}/foglalas/lemondas?t=${encodeURIComponent(token)}`;
    const a = lemondasAllapot(row, torzs, most);
    const l = emlekezteto(nezet(row, torzs), { lemondasUrl, hataridoMs: a.hataridoMs, szabalyok: sz, lemondhato: a.lemondhato });
    stmts.push(
      db.prepare(`UPDATE bookings SET emlekeztetve_at = ? WHERE id = ? AND emlekeztetve_at IS NULL AND status = 'megerositett' AND date = ? AND start_min = ?`)
        .bind(most, row.id, row.date, row.start_min),
      db.prepare(
        `INSERT INTO outbox (booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at)
         SELECT ?, ?, ?, ?, ?, ?, NULL, 0, ? WHERE changes() = 1`,
      ).bind(row.id, l.tipus, l.cimzett, l.targy, l.html, l.szoveg, most),
    );
  }
  const eredmeny = await db.batch(stmts);
  const emlekeztetve = eredmeny.filter((_, i) => i % 2 === 0).reduce((n, r) => n + (Number(r.meta && r.meta.changes) === 1 ? 1 : 0), 0);
  return { kikapcsolva: false, emlekeztetve, jeloltek: jeloltek.length };
}
