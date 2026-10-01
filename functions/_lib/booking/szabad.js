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

/** Az adott kollégára, helyszínre és napra vonatkozó kivételek (az időponttól függetlenül). */
function napiKivetelek(kivetelek, { kollega, helyszin, datum }) {
  return kivetelek.filter((k) => {
    if (k.kollega && k.kollega !== kollega) return false;
    if (k.helyszin && k.helyszin !== helyszin) return false;
    if (!k.kollega && !k.helyszin) return false;
    return datum >= k.tol && datum <= k.ig;
  });
}

function kivetelUtkozik(kivetelek, { kollega, helyszin, datum, kezd, veg }) {
  return napiKivetelek(kivetelek, { kollega, helyszin, datum })
    .some((k) => k.kezd == null || k.veg == null || atfed(kezd, veg, k.kezd, k.veg));
}

/**
 * A felkínált kezdések lépése percben. A szolgáltatás `kinalas` mezője erősebb (null vagy hiányzó:
 * a globális szabalyok.kinalas, annak alapja 'igazitott'). 'igazitott' = időtartam + puffer, felfelé
 * a 15 perces rács többszörösére (50 + 10 = 60; 90 + 10 = 100 → 105; 20 + 10 = 30). A belső rács és a
 * zárak ettől függetlenül 15 percesek maradnak.
 */
export function kinalasLepes(szolg, szabalyok = {}) {
  const k = szolg.kinalas ?? szabalyok.kinalas ?? 'igazitott';
  if (Number.isInteger(k) && k >= RACS && k <= 240 && k % RACS === 0) return k;
  return Math.max(RACS, Math.ceil((szolg.perc + (szolg.puffer ?? 10)) / RACS) * RACS);
}

/** A [tol, ig) szakasz azon részei, amelyeket egyik részleges kivétel sem fed; egész napos kivételnél üres. */
function szabadSzakaszok(tol, ig, kivetelek) {
  let szakaszok = [[tol, ig]];
  for (const k of kivetelek) {
    if (k.kezd == null || k.veg == null) return [];
    szakaszok = szakaszok.flatMap(([a, b]) => {
      if (!atfed(a, b, k.kezd, k.veg)) return [[a, b]];
      return [[a, Math.min(b, k.kezd)], [Math.max(a, k.veg), b]].filter(([x, y]) => x < y);
    });
  }
  return szakaszok;
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
  const lepes = kinalasLepes(szolg, szabalyok);

  for (const datum of osszesNap) {
    if (datum > utolsoNap) continue;
    if (helyiToUtc(datum, 24 * 60) <= legkorabbiMs) continue; // az egész nap a határ előtt van
    const nap = hetNapja(datum);
    const kezdesek = new Map(); // perc → [kolléga-id]
    // belépés előtt és kilépés után a kolléga nem foglalható (a „bárki” sem osztja rá)
    for (const kid of jeloltek.filter((k) => aktivANapon(k, datum)).map((k) => k.id)) {
      const napiKiv = napiKivetelek(kivetelek, { kollega: kid, helyszin, datum });
      // a kolléga aznapi foglalásainak vége: egy zár-sorozat utolsó rácspontja utáni rácspont
      const foglalasVegek = foglalt
        .filter((f) => f.kollega === kid && f.datum === datum && !foglaltSet.has(`${kid}|${datum}|${f.slot + RACS}`))
        .map((f) => f.slot + RACS);
      for (const b of beosztas) {
        if (b.kollega !== kid || b.nap !== nap || b.helyszin !== helyszin) continue;
        // a rács horgonya a beosztási blokk, illetve a részleges kivétel utáni szabad szakasz eleje
        for (const [tol0, ig0] of szabadSzakaszok(Math.max(b.kezd, hely.nyit), Math.min(b.veg, hely.zar), napiKiv)) {
          const elso = Math.ceil(tol0 / RACS) * RACS;
          const jelolt = new Set();
          for (let k = elso; k + szolg.perc <= ig0; k += lepes) jelolt.add(k);
          // hézagkitöltés: a foglalás vége utáni első rácspont is, ha a kezelés belefér
          for (const v of foglalasVegek) if (v >= elso && v + szolg.perc <= ig0) jelolt.add(v);
          for (const k of jelolt) {
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
    }
    eredmeny[datum] = [...kezdesek.keys()].sort((a, b) => a - b)
      .map((k) => ({ kezd: percToHHMM(k), kollegak: kezdesek.get(k).sort() }));
  }
  return { napok: eredmeny };
}
