// Időpontfoglaló · szabad időpontok számítása (tiszta függvény, nincs benne adatbázis-hívás)
//
// Szabad = a kolléga heti beosztása az adott helyszínen
//          ∩ a helyszín nyitvatartása
//          − kivételek (szabadság, helyszín zárva, egész napra vagy órákra)
//          − már foglalt 15 perces rácspontok (a foglalás hossza + puffer, felfelé kerekítve)
//          − a „most + minEloreOra” előtti és a „ma + maxEloreNap” utáni időpontok.
// A kezdések 15 perces rácson vannak; a szolgáltatásnak a beosztáson és a nyitvatartáson
// belül be kell fejeződnie (a puffer átlóghat a zárás utánra).

import { RACS, budapestMost, datumPlusz, hetNapja, helyiToUtc, napok, percToHHMM } from './ido.js';
import { aktivANapon } from './torzs-alap.js';

/** Egy foglalás által lefoglalt rácspontok (ezekből lesz a slot_locks sor). */
export function foglalasSlotjai({ kollega, datum, kezd, perc, puffer = 0 }) {
  const db = Math.ceil((perc + puffer) / RACS);
  return Array.from({ length: db }, (_, i) => ({ kollega, datum, slot: kezd + i * RACS }));
}

const atfed = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

function kivetelUtkozik(kivetelek, { kollega, helyszin, datum, kezd, veg }) {
  return kivetelek.some((k) => {
    if (k.kollega && k.kollega !== kollega) return false;
    if (k.helyszin && k.helyszin !== helyszin) return false;
    if (!k.kollega && !k.helyszin) return false;
    if (datum < k.tol || datum > k.ig) return false;
    if (k.kezd == null || k.veg == null) return true; // egész nap
    return atfed(kezd, veg, k.kezd, k.veg);
  });
}

/**
 * @returns {{ napok: Record<string, {kezd: string, kollegak: string[]}[]> }}
 *   A kért tartomány minden napja szerepel, üres tömbbel is.
 */
export function szabadIdopontok({ torzs, beosztas, kivetelek = [], foglalt = [], most = Date.now(), helyszin, szolgaltatas, kollega = 'barki', tol, ig }) {
  const hely = torzs.helyszinek.find((h) => h.id === helyszin);
  const szolg = torzs.szolgaltatasok.find((s) => s.id === szolgaltatas);
  const eredmeny = {};
  const osszesNap = napok(tol, ig);
  for (const d of osszesNap) eredmeny[d] = [];
  if (!hely || !szolg || !(szolg.helyszinek || []).includes(helyszin)) return { napok: eredmeny };

  const jeloltek = torzs.kollegak
    .filter((k) => (kollega === 'barki' || k.id === kollega)
      && k.archivalt !== true
      && (k.helyszinek || []).includes(helyszin)
      && (k.szolgaltatasok || []).includes(szolgaltatas))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!jeloltek.length) return { napok: eredmeny };

  const szabalyok = torzs.szabalyok || {};
  const legkorabbiMs = most + (szabalyok.minEloreOra ?? 2) * 3600e3;
  const utolsoNap = datumPlusz(budapestMost(most).datum, szabalyok.maxEloreNap ?? 60);
  const foglaltSet = new Set(foglalt.map((f) => `${f.kollega}|${f.datum}|${f.slot}`));
  const puffer = szolg.puffer ?? 10;

  for (const datum of osszesNap) {
    if (datum > utolsoNap) continue;
    if (helyiToUtc(datum, 24 * 60) <= legkorabbiMs) continue; // az egész nap a határ előtt van
    const nap = hetNapja(datum);
    const kezdesek = new Map(); // perc → [kolléga-id]
    // belépés előtt és kilépés után a kolléga nem foglalható (a „bárki” sem osztja rá)
    for (const kid of jeloltek.filter((k) => aktivANapon(k, datum)).map((k) => k.id)) {
      for (const b of beosztas) {
        if (b.kollega !== kid || b.nap !== nap || b.helyszin !== helyszin) continue;
        const tol0 = Math.max(b.kezd, hely.nyit);
        const ig0 = Math.min(b.veg, hely.zar);
        const elso = Math.ceil(tol0 / RACS) * RACS;
        for (let k = elso; k + szolg.perc <= ig0; k += RACS) {
          if (helyiToUtc(datum, k) < legkorabbiMs) continue;
          if (kivetelUtkozik(kivetelek, { kollega: kid, helyszin, datum, kezd: k, veg: k + szolg.perc })) continue;
          const slotok = foglalasSlotjai({ kollega: kid, datum, kezd: k, perc: szolg.perc, puffer });
          if (slotok.some((s) => foglaltSet.has(`${kid}|${datum}|${s.slot}`))) continue;
          const lista = kezdesek.get(k) || [];
          if (!lista.includes(kid)) lista.push(kid);
          kezdesek.set(k, lista);
        }
      }
    }
    eredmeny[datum] = [...kezdesek.keys()].sort((a, b) => a - b)
      .map((k) => ({ kezd: percToHHMM(k), kollegak: kezdesek.get(k).sort() }));
  }
  return { napok: eredmeny };
}
