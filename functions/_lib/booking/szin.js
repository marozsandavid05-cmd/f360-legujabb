// Időpontfoglaló · kollégánkénti szín az admin naptárához.
// A paletta 10 visszafogott, egymástól jól megkülönböztethető szín; mind legalább 4,5:1 kontrasztú
// fehér szöveggel (WCAG AA), így a naptár-blokkban a név fehérrel olvasható. A felület (Aurora)
// ugyanezt a palettát használja. 10 kollégáig minden szín egyedi, utána a legkevésbé használt jön.

export const PALETTA = Object.freeze([
  { hex: '#4f6d8a', nev: 'acélkék' },
  { hex: '#a0553c', nev: 'terrakotta' },
  { hex: '#5b7d55', nev: 'zsályazöld' },
  { hex: '#7d5a8e', nev: 'szilva' },
  { hex: '#8c6b2a', nev: 'okker' },
  { hex: '#2f6e6e', nev: 'petrol' },
  { hex: '#94485e', nev: 'bordó-rózsa' },
  { hex: '#5a5f30', nev: 'olíva' },
  { hex: '#3b4580', nev: 'indigó' },
  { hex: '#5e4b44', nev: 'mokka' },
]);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Érvényes #rrggbb szín kisbetűsen, minden más esetben null. */
export function szinNormal(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return HEX_RE.test(s) ? s.toLowerCase() : null;
}

/**
 * Színt ad minden kollégának, akinek nincs érvényes színe. A meglévő érvényes szín marad.
 * Az új szín a palettából a legkevésbé használt (holtversenyben a paletta-sorrend szerinti első),
 * így 10 kollégáig nincs ismétlődés. Determinisztikus: ugyanarra a bemenetre ugyanazt adja.
 * Új tömböt ad vissza, a bemenetet nem módosítja.
 */
export function szinKioszt(kollegak) {
  const hasznalat = new Map(PALETTA.map((p) => [p.hex, 0]));
  const ki = kollegak.map((k) => ({ ...k, szin: szinNormal(k.szin) }));
  for (const k of ki) if (k.szin && hasznalat.has(k.szin)) hasznalat.set(k.szin, hasznalat.get(k.szin) + 1);
  for (const k of ki) {
    if (k.szin) continue;
    let legjobb = PALETTA[0].hex;
    for (const p of PALETTA) if (hasznalat.get(p.hex) < hasznalat.get(legjobb)) legjobb = p.hex;
    k.szin = legjobb;
    hasznalat.set(legjobb, hasznalat.get(legjobb) + 1);
  }
  return ki;
}
