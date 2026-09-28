// Időpontfoglaló · időkezelés
// Minden időpont Europe/Budapest helyi idő: `datum` ('YYYY-MM-DD') + `perc` (éjfél óta eltelt perc).
// UTC-t csak az .ics fájl és a „most” meghatározása használ. A téli-nyári váltást az Intl kezeli,
// saját DST-táblát szándékosan nem tartunk.

export const TZ = 'Europe/Budapest';
export const RACS = 15; // perc

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function reszek(ms) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

/** Egy UTC-pillanat budapesti dátuma és perce. */
export function budapestMost(ms = Date.now()) {
  const p = reszek(ms);
  return { datum: `${p.year}-${p.month}-${p.day}`, perc: Number(p.hour) * 60 + Number(p.minute) };
}

// A budapesti eltolás percben egy adott UTC-pillanatban (+60 télen, +120 nyáron)
function eltolas(ms) {
  const p = reszek(ms);
  const helyiMintUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((helyiMintUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Budapesti helyi dátum + perc → UTC ezredmásodperc. */
export function helyiToUtc(datum, perc) {
  const [y, m, d] = datum.split('-').map(Number);
  const naiv = Date.UTC(y, m - 1, d, 0, perc);
  let ms = naiv - eltolas(naiv) * 60000;
  ms = naiv - eltolas(ms) * 60000; // második kör: a váltás körüli órákra
  return ms;
}

export function ervenyesDatum(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function datumPlusz(datum, n) {
  const [y, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A hét napja, hétfő = 1 ... vasárnap = 7. */
export function hetNapja(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

/** A két dátum közötti napok (mindkét vég benne), legfeljebb `max` darab. */
export function napok(tol, ig, max = 400) {
  const out = [];
  for (let d = tol; d <= ig && out.length < max; d = datumPlusz(d, 1)) out.push(d);
  return out;
}

export function percToHHMM(p) {
  return `${String(Math.floor(p / 60)).padStart(2, '0')}:${String(p % 60).padStart(2, '0')}`;
}

/** 'HH:MM' → perc; csak a 15 perces rácson lévő, napon belüli időt fogadja el, egyébként null. */
export function hhmmToPerc(s) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
  if (!m) return null;
  const p = Number(m[1]) * 60 + Number(m[2]);
  return p % RACS === 0 ? p : null;
}
