// Időpontfoglaló · az „Állandó időpont” (ismétlődő foglalás) levelei (Hermes, 2026-10-01).
// Szerződés: Claude tesztelés\f360-allando-idopont-2026-10-01\SZERZODES.md („Levelek” rész).
// Ugyanaz az arculat és keret, mint a levelek.js-ben; minden felhasználói adat HTML-escape-elve,
// a tárgyba és a szöveges változatba csak egysoros (sortörés nélküli) érték kerül.
//
// A sorozat nézete („s”):
//   { id, vendeg: { nev, email, telefon, megjegyzes }, helyszin: { nev, cim }, szolgaltatas: { nev, perc, ar },
//     kollega: { nev }, nap: 1..7 (1 = hétfő), kezd: 'HH:MM', ismetles: 1 | 2,
//     kezdoDatum: 'YYYY-MM-DD', vege: { tipus: 'datum', datum } | { tipus: 'alkalom', db } | { tipus: 'nyitott' } }
// Egy alkalom: { datum: 'YYYY-MM-DD', kezd: 'HH:MM', lemondasUrl? } (a lemondó link mindig CSAK erre az alkalomra szól).
// Levéltípusok: sorozat-visszaigazolas, sorozat-kollega, sorozat-studio, sorozat-leallitva (az admin Levelek fül szűrőjéhez).

import { esc, KEZELO_GOMB, szepDatum } from './levelek.js';

const SZIN = { ink: '#303030', accent: '#BFA18F', krem: '#EAEAEA', bezs: '#E4DBD2' };
const egysor = (s) => String(s ?? '').replace(/[\r\n\t\u2028\u2029]+/g, ' ').trim();
const ft = (n) => (n == null ? '' : `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Ft`);
export const LISTA_MAX = 12; // ennyi alkalom kerül a levélbe név szerint, a többi „és még N alkalom”

const NAPOKON = ['', 'hétfőnként', 'keddenként', 'szerdánként', 'csütörtökönként', 'péntekenként', 'szombatonként', 'vasárnaponként'];
const NAPON = ['', 'hétfőn', 'kedden', 'szerdán', 'csütörtökön', 'pénteken', 'szombaton', 'vasárnap'];

/** „szerdánként 16:00-kor” vagy „minden második szerdán 16:00-kor” */
export function ritmus(s) {
  const nap = Number(s.nap);
  if (!(nap >= 1 && nap <= 7)) return '';
  return Number(s.ismetles) === 2 ? `minden második ${NAPON[nap]} ${s.kezd}-kor` : `${NAPOKON[nap]} ${s.kezd}-kor`;
}

/** A sorozat vége emberi nyelven. */
export function vegeSzoveg(s) {
  const v = s.vege || {};
  if (v.tipus === 'datum' && v.datum) return `${szepDatum(v.datum)}-ig`;
  if (v.tipus === 'alkalom' && Number.isInteger(v.db)) return `${v.db} alkalom`;
  return 'visszavonásig';
}

function keret(cim, torzs) {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(cim)}</title></head>`
    + `<body style="margin:0;background:${SZIN.bezs};color:${SZIN.ink};font-family:Georgia,'Times New Roman',serif">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SZIN.bezs}"><tr><td align="center" style="padding:32px 16px">`
    + `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${SZIN.krem}">`
    + `<tr><td style="padding:28px 32px 8px;border-bottom:1px solid ${SZIN.accent};font-size:13px;letter-spacing:.14em;text-transform:uppercase">Studio F360</td></tr>`
    + `<tr><td style="padding:24px 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">${torzs}</td></tr>`
    + `<tr><td style="padding:16px 32px;background:${SZIN.ink};color:${SZIN.krem};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6">`
    + `Studio F360 · Mexikói út 32/b · Reitter Ferenc utca 48. · Budapest</td></tr>`
    + `</table></td></tr></table></body></html>`;
}

function tabla(sorok) {
  const sor = ([k, v]) => `<tr><td style="padding:6px 16px 6px 0;opacity:.7;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid ${SZIN.accent};border-bottom:1px solid ${SZIN.accent};width:100%">`
    + sorok.filter(([, v]) => v).map(sor).join('') + `</table>`;
}
const szovegSorok = (sorok) => sorok.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');

/** A sorozat adatsorai. */
function sorozatSorok(s) {
  const sz = s.szolgaltatas || {};
  return [
    ['Állandó időpont', ritmus(s)],
    ['Kezdés', s.kezdoDatum ? szepDatum(s.kezdoDatum) : ''],
    ['Időtartam', vegeSzoveg(s)],
    ['Szolgáltatás', sz.nev ? `${egysor(sz.nev)}${sz.perc ? ` (${sz.perc} perc)` : ''}` : ''],
    ['Szakember', egysor(s.kollega && s.kollega.nev)],
    ['Helyszín', s.helyszin ? `${egysor(s.helyszin.nev)}, ${egysor(s.helyszin.cim)}` : ''],
    ['Ár', sz.ar != null ? `${ft(sz.ar)} alkalmanként, a helyszínen fizetendő` : ''],
  ];
}

const alkalomSzoveg = (a) => `${szepDatum(a.datum)}, ${a.kezd}`;

/** Az alkalmak listája: legfeljebb LISTA_MAX tétel, a többi összesítve. Lemondó linkkel, ha van. */
function alkalomListaHtml(alkalmak, { linkkel = true } = {}) {
  const lat = alkalmak.slice(0, LISTA_MAX);
  const tobb = alkalmak.length - lat.length;
  const li = (a) => `<li style="margin:0 0 6px">${esc(alkalomSzoveg(a))}`
    + (linkkel && a.lemondasUrl ? ` · <a href="${esc(a.lemondasUrl)}" style="color:${SZIN.ink}">lemondás vagy módosítás</a>` : '') + `</li>`;
  return `<ul style="margin:8px 0 16px;padding-left:20px">${lat.map(li).join('')}</ul>`
    + (tobb > 0 ? `<p>És még ${tobb} alkalom, mindegyik ugyanebben az időpontban.</p>` : '');
}
function alkalomListaSzoveg(alkalmak, { linkkel = true } = {}) {
  const lat = alkalmak.slice(0, LISTA_MAX);
  const tobb = alkalmak.length - lat.length;
  return lat.map((a) => `- ${alkalomSzoveg(a)}${linkkel && a.lemondasUrl ? `\n  lemondás vagy módosítás: ${a.lemondasUrl}` : ''}`).join('\n')
    + (tobb > 0 ? `\nÉs még ${tobb} alkalom, mindegyik ugyanebben az időpontban.` : '');
}

const ZARAS_HTML = `<p>Várunk szeretettel,<br>a Studio F360 csapata</p>`;
const ZARAS = `Várunk szeretettel,\na Studio F360 csapata\n`;

/**
 * Visszaigazolás a vendégnek: állandó időpontot kapott. EGY levél a teljes sorozatról, alkalmanként nincs külön levél.
 * @param alkalmak  a létrejött alkalmak, időrendben, alkalmanként a saját lemondó linkkel
 */
export function sorozatVisszaigazolas(s, { alkalmak = [], szabalyok }) {
  const v = s.vendeg || {};
  const targy = `Állandó időpontod a Studio F360-ban · ${ritmus(s)}`;
  const bev = 'Rögzítettük az állandó időpontodat. Az alábbi alkalmakra a helyed le van foglalva.';
  const kezelo = `Ha egy alkalomra mégsem tudsz jönni, a kezdés előtt ${szabalyok.lemondasOra} óráig az adott alkalom melletti linkkel lemondhatod vagy áthelyezheted. A link mindig csak arra az egy alkalomra vonatkozik, a többi időpontod megmarad.`;
  const telefon = `${szabalyok.lemondasOra} órán belül, vagy ha az egész állandó időpontot módosítanád, hívj minket: ${egysor(szabalyok.telefon)}.`;
  const emlek = 'Minden alkalom előtt küldünk emlékeztetőt.';
  const nyitott = (s.vege || {}).tipus === 'nyitott' ? '<p>Az állandó időpontod visszavonásig érvényes: a további alkalmakat folyamatosan rögzítjük.</p>' : '';
  const nyitottSz = (s.vege || {}).tipus === 'nyitott' ? 'Az állandó időpontod visszavonásig érvényes: a további alkalmakat folyamatosan rögzítjük.\n\n' : '';
  const html = keret(targy, `<p>Kedves ${esc(egysor(v.nev))}!</p><p>${bev}</p>${tabla(sorozatSorok(s))}`
    + `<p><strong>Alkalmak</strong></p>${alkalomListaHtml(alkalmak)}${nyitott}`
    + `<p>${esc(kezelo)}</p><p>${esc(telefon)}</p><p>${emlek}</p>${ZARAS_HTML}`);
  const szoveg = `Kedves ${egysor(v.nev)}!\n\n${bev}\n\n${szovegSorok(sorozatSorok(s))}\n\nAlkalmak:\n${alkalomListaSzoveg(alkalmak)}\n\n${nyitottSz}`
    + `${kezelo}\n${telefon}\n${emlek}\n\n${ZARAS}`;
  return { tipus: 'sorozat-visszaigazolas', sorozat: true, cimzett: v.email || '', targy, html, szoveg, kezeloGomb: KEZELO_GOMB };
}

/**
 * Értesítő a kollégának (privát cím) vagy a stúdiónak (studio: true, a stúdió e-mail-címére): új állandó időpont, vagy leállt.
 * A vendég lemondó linkjei NEM kerülnek bele. A stúdió-változat típusa 'sorozat-studio', a tárgyban a kolléga neve is szerepel.
 * @param esemeny  'uj' | 'leallitva'
 */
export function sorozatKollegaErtesito(s, cimzett, { alkalmak = [], esemeny = 'uj', studio = false } = {}) {
  const v = s.vendeg || {};
  const uj = esemeny === 'uj';
  const kinel = egysor(s.kollega && s.kollega.nev);
  const targy = `${uj ? 'Új állandó időpont' : 'Leállt állandó időpont'} · ${egysor(v.nev)} · ${ritmus(s)}${studio && kinel ? ` · ${kinel}` : ''}`;
  const bev = uj
    ? (studio ? `Új állandó időpontot vettek fel az adminban${kinel ? `, ${kinel} kollégához` : ''}.` : 'Új állandó időpontot vettek fel hozzád az adminban.')
    : 'Az adminban leállították egy vendég állandó időpontját. Az alábbi alkalmakat lemondtuk.';
  const sorok = [
    ...sorozatSorok(s).filter(([k]) => k !== 'Ár'),
    ['Vendég', egysor(v.nev)], ['E-mail', egysor(v.email)], ['Telefon', egysor(v.telefon)], ['Megjegyzés', egysor(v.megjegyzes)],
  ];
  const html = keret(targy, `<p>${esc(bev)}</p>${tabla(sorok)}`
    + (alkalmak.length ? `<p><strong>${uj ? 'Alkalmak' : 'Lemondott alkalmak'}</strong></p>${alkalomListaHtml(alkalmak, { linkkel: false })}` : ''));
  const szoveg = `${bev}\n\n${szovegSorok(sorok)}\n`
    + (alkalmak.length ? `\n${uj ? 'Alkalmak' : 'Lemondott alkalmak'}:\n${alkalomListaSzoveg(alkalmak, { linkkel: false })}\n` : '');
  return { tipus: studio ? 'sorozat-studio' : 'sorozat-kollega', sorozat: true, esemeny: uj ? 'uj' : 'leallitva', cimzett, targy, html, szoveg };
}

/**
 * A vendégnek: az állandó időpontja leállt.
 * @param lemondott  a lemondott (jövőbeli) alkalmak
 * @param maradt     a megmaradt alkalmak (a leállítás napja előttiek, ha még nem múltak el), lemondó linkkel
 */
export function sorozatLeallitva(s, { lemondott = [], maradt = [], szabalyok }) {
  const v = s.vendeg || {};
  const targy = `Az állandó időpontod véget ért · Studio F360`;
  const bev = `Az állandó időpontod (${ritmus(s)}, ${egysor(s.kollega && s.kollega.nev)}) véget ért.`;
  const hivj = `Ha kérdésed van, vagy újra állandó időpontot szeretnél, hívj minket: ${egysor(szabalyok.telefon)}.`;
  const html = keret(targy, `<p>Kedves ${esc(egysor(v.nev))}!</p><p>${esc(bev)}</p>`
    + (lemondott.length ? `<p><strong>Ezeket az alkalmakat lemondtuk</strong></p>${alkalomListaHtml(lemondott, { linkkel: false })}` : '')
    + (maradt.length ? `<p><strong>Ezek az alkalmak megmaradnak</strong></p>${alkalomListaHtml(maradt)}` : '')
    + `<p>${esc(hivj)}</p><p>Üdvözlettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${egysor(v.nev)}!\n\n${bev}\n\n`
    + (lemondott.length ? `Ezeket az alkalmakat lemondtuk:\n${alkalomListaSzoveg(lemondott, { linkkel: false })}\n\n` : '')
    + (maradt.length ? `Ezek az alkalmak megmaradnak:\n${alkalomListaSzoveg(maradt)}\n\n` : '')
    + `${hivj}\n\nÜdvözlettel,\na Studio F360 csapata\n`;
  return { tipus: 'sorozat-leallitva', sorozat: true, cimzett: v.email || '', targy, html, szoveg };
}
