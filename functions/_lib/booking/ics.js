// Időpontfoglaló · .ics naptárfájl (RFC 5545). Az idő UTC-ben (Z), a sorvég CRLF,
// a 75 bájtnál hosszabb sorok hajtogatva.
import { helyiToUtc } from './ido.js';

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function hajtogat(sor) {
  const bytes = new TextEncoder().encode(sor);
  if (bytes.length <= 75) return sor;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of sor) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * Google Naptár „esemény hozzáadása” link (a .ics-t a Google webes felülete nem nyitja meg magától).
 * A dátum UTC-ben (YYYYMMDDTHHMMSSZ), a helyiToUtc szerint, így a téli és a nyári idő is helyes.
 * @param f  a foglalás nézete (datum, kezdPerc vagy kezd, szolgaltatas.perc, nev, kollega, helyszin)
 */
export function googleNaptarUrl(f, { lemondasUrl = '' } = {}) {
  const kezdPerc = Number.isInteger(f.kezdPerc) ? f.kezdPerc : Number(String(f.kezd).slice(0, 2)) * 60 + Number(String(f.kezd).slice(3, 5));
  const kezd = helyiToUtc(f.datum, kezdPerc);
  const veg = kezd + f.szolgaltatas.perc * 60000;
  const reszlet = [
    `${f.szolgaltatas.nev}, ${f.kollega.nev}`,
    `Azonosító: ${f.azonosito}`,
    lemondasUrl ? `Időpont lemondása / módosítása: ${lemondasUrl}` : '',
  ].filter(Boolean).join('\n');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${f.szolgaltatas.nev} · Studio F360`,
    dates: `${utc(kezd)}/${utc(veg)}`,
    details: reszlet,
    location: `Studio F360, ${f.helyszin.cim}`,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** @param f  a foglalás nézete (lásd foglalas.js nezet()) */
export function icsKeszit(f, { host = 'f360', most = Date.now(), lemondasUrl = '' } = {}) {
  const kezd = helyiToUtc(f.datum, f.kezdPerc);
  const veg = kezd + f.szolgaltatas.perc * 60000;
  const leiras = [
    `${f.szolgaltatas.nev}, ${f.kollega.nev}`,
    `Azonosító: ${f.azonosito}`,
    lemondasUrl ? `Lemondás: ${lemondasUrl}` : '',
  ].filter(Boolean).join('\n');
  const sorok = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Studio F360//Idopontfoglalo//HU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${f.azonosito}@${host}`,
    `DTSTAMP:${utc(most)}`,
    // a módosításkor ugyanaz a UID megy ki; a növekvő SEQUENCE miatt a naptár frissíti az eseményt, nem duplikálja
    `SEQUENCE:${Math.floor(most / 1000)}`,
    `DTSTART:${utc(kezd)}`,
    `DTEND:${utc(veg)}`,
    `SUMMARY:${esc(`${f.szolgaltatas.nev} · Studio F360`)}`,
    `LOCATION:${esc(`Studio F360, ${f.helyszin.cim}`)}`,
    `DESCRIPTION:${esc(leiras)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${sorok.map(hajtogat).join('\r\n')}\r\n`;
}
