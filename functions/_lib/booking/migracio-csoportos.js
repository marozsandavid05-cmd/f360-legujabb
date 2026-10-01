// Időpontfoglaló · adat-migráció a csoportos-körhöz (2026-10): a meglévő (élő) törzsadatba bekerül
// Barkóczy Barbara, Aczél Gabriella, Kovács Anna, a három táplálkozási szolgáltatás, a kollégák
// Rólunk-oldali fotója (csak ahol üres), és Vas Luca, Szegedi Botond szerepe (csak ahol még a régi
// seed-szöveg áll). A már meglévő azonosítójú kollégát vagy szolgáltatást NEM írja felül.
//
// Egyszer fut: a settings táblában a `migracio:csoportos-2026-10` sor jelzi, hogy lefutott. Így ha
// Lilla utána töröl egy új kollégát vagy szolgáltatást, az nem jön vissza. A jelző és a törzsadat
// írása egy batch-ben, feltételesen (csak ha közben senki nem módosította a törzsadatot).

import { SEED_TORZS } from './seed.js';
import { szinKioszt } from './szin.js';

export const MIGRACIO_KULCS = 'migracio:csoportos-2026-10';
const UJ_KOLLEGAK = ['barkoczy-barbara', 'aczel-gabriella', 'kovacs-anna'];
const UJ_SZOLGALTATASOK = ['taplalkozas-alapcsomag', 'taplalkozas-kiegeszito', 'inbody-770'];
const FOTOS = new Set(['aczel-gabriella', 'adorjani-anna', 'barkoczy-barbara', 'kodacsine-labancz-agnes', 'kovacs-anna', 'osvath-bence', 'szegedi-botond', 'vas-luca']);
// a régi seed-szöveg → az új (ha Lilla már átírta, marad az övé)
const SZEREP = {
  'vas-luca': ['gyógytornász, perinatális tréner', 'gyógytornász, perinatális tréner, SEAS terapeuta'],
  'szegedi-botond': ['gyógymasszőr, nyirokmasszőr, sportmasszőr', 'gyógymasszőr, nyirokmasszőr (Mexikói út), sportmasszőr (Reitter)'],
};

/** Tiszta függvény: a régi törzsből az új (a bemenetet nem módosítja). */
export function csoportosMigracio(torzs) {
  const kollegak = Array.isArray(torzs.kollegak) ? torzs.kollegak : [];
  const szolgaltatasok = Array.isArray(torzs.szolgaltatasok) ? torzs.szolgaltatasok : [];
  const kIds = new Set(kollegak.map((k) => k.id));
  const sIds = new Set(szolgaltatasok.map((s) => s.id));
  const ujSzolg = SEED_TORZS.szolgaltatasok.filter((s) => UJ_SZOLGALTATASOK.includes(s.id) && !sIds.has(s.id)).map((s) => structuredClone(s));
  const megvanSzolg = new Set([...sIds, ...ujSzolg.map((s) => s.id)]);
  const ujKoll = SEED_TORZS.kollegak.filter((k) => UJ_KOLLEGAK.includes(k.id) && !kIds.has(k.id)).map((k) => {
    // a szín a meglévőkhöz igazodik (szinKioszt), a szolgáltatás csak ha létezik
    const { szin: _s, ...uj } = structuredClone(k);
    return { ...uj, szolgaltatasok: uj.szolgaltatasok.filter((s) => megvanSzolg.has(s)) };
  });
  const regiek = kollegak.map((k) => {
    const uj = { ...k };
    if (!uj.foto && FOTOS.has(uj.id)) uj.foto = `/media/brand/csapat/${uj.id}.jpg`;
    const sz = SZEREP[uj.id];
    if (sz && uj.szerep === sz[0]) uj.szerep = sz[1];
    return uj;
  });
  return { ...torzs, szolgaltatasok: [...szolgaltatasok, ...ujSzolg], kollegak: szinKioszt([...regiek, ...ujKoll]) };
}

/**
 * Lefuttatja, ha még nem futott. Visszaadja a (friss) törzs JSON-szövegét. Párhuzamos futásnál a
 * feltételes UPDATE miatt csak egy ír; a másik újraolvas.
 */
export async function csoportosMigral(db, ertek) {
  for (let i = 0; i < 3; i++) {
    const jelzo = await db.prepare(`SELECT 1 AS x FROM settings WHERE kulcs = ?`).bind(MIGRACIO_KULCS).first('x');
    if (jelzo) return ertek;
    const uj = JSON.stringify(csoportosMigracio(JSON.parse(ertek)));
    const most = Date.now();
    const [r] = await db.batch([
      db.prepare(`UPDATE settings SET ertek = ?, modositva = ? WHERE kulcs = 'torzs' AND ertek = ?
        AND NOT EXISTS (SELECT 1 FROM settings WHERE kulcs = ?)`).bind(uj, most, ertek, MIGRACIO_KULCS),
      db.prepare(`INSERT OR IGNORE INTO settings (kulcs, ertek, modositva) SELECT ?, '1', ? WHERE changes() = 1`).bind(MIGRACIO_KULCS, most),
    ]);
    if (Number(r.meta && r.meta.changes)) return uj;
    ertek = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).first('ertek');
  }
  return ertek;
}
