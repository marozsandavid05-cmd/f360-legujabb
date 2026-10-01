// Időpontfoglaló · a kollégának (és a lemondásnál a stúdiónak) szóló értesítők, valamint a páciens
// emlékeztetője (Lilla-kör). Ugyanaz az arculat és keret, mint a levelek.js-ben; minden felhasználói
// adat HTML-escape-elve. A kolléga levelében nincs lemondó link: az a páciens titka.

import { esc, KEZELO_GOMB, szepDatum } from './levelek.js';

const SZIN = { ink: '#303030', accent: '#BFA18F', krem: '#EAEAEA', bezs: '#E4DBD2' };

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

const idopont = (f) => `${szepDatum(f.datum)}, ${f.kezd} és ${f.veg} között`;

function tabla(sorok) {
  const sor = ([k, v]) => `<tr><td style="padding:6px 16px 6px 0;opacity:.7;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid ${SZIN.accent};border-bottom:1px solid ${SZIN.accent};width:100%">`
    + sorok.filter(([, v]) => v).map(sor).join('') + `</table>`;
}
const szovegSorok = (sorok) => sorok.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');

/** A kolléga-levelek közös adatsorai (páciens neve és elérhetősége, megjegyzés). */
function adatok(f, { idopontCimke = 'Időpont' } = {}) {
  return [
    [idopontCimke, idopont(f)],
    ['Szolgáltatás', `${f.szolgaltatas.nev} (${f.szolgaltatas.perc} perc)`],
    ['Szakember', f.kollega.nev],
    ['Helyszín', `${f.helyszin.nev}, ${f.helyszin.cim}`],
    ['Páciens', f.nev],
    ['E-mail', f.email],
    ['Telefon', f.telefon],
    ['Megjegyzés', f.megjegyzes],
    ['Azonosító', f.azonosito],
  ];
}

function level(tipus, cimzett, targy, bevezeto, sorok, zaras = '') {
  const html = keret(targy, `<p>${esc(bevezeto)}</p>${tabla(sorok)}${zaras ? `<p>${esc(zaras)}</p>` : ''}`);
  const szoveg = `${bevezeto}\n\n${szovegSorok(sorok)}\n${zaras ? `\n${zaras}\n` : ''}`;
  return { tipus, cimzett, targy, html, szoveg };
}

/** Új foglalás a kolléga privát címére. */
export function kollegaUj(f, cimzett, { admin = false } = {}) {
  const targy = `Új foglalás · ${szepDatum(f.datum)} ${f.kezd} · ${f.szolgaltatas.nev}`;
  const bev = admin ? 'Új időpontot rögzítettek neked az adminban.' : 'Új foglalásod érkezett a weboldalról.';
  return level('kollega-uj', cimzett, targy, bev, adatok(f));
}

/** Lemondás: a kollégának és a stúdiónak (ugyanaz a tartalom, a címzett más). */
export function kollegaLemondas(f, cimzett, { admin = false } = {}) {
  const targy = `Lemondott foglalás · ${szepDatum(f.datum)} ${f.kezd} · ${f.kollega.nev}`;
  const bev = admin ? 'Az alábbi foglalást az adminban lemondták.' : `${f.nev} lemondta az alábbi foglalását.`;
  return level('kollega-lemondas', cimzett, targy, bev, adatok(f), 'Ez az időpont felszabadult.');
}

/** Módosítás ugyanannál a kollégánál: a régi és az új időpont. */
export function kollegaModositas(f, regi, cimzett) {
  const targy = `Módosított foglalás · ${szepDatum(f.datum)} ${f.kezd} · ${f.szolgaltatas.nev}`;
  const sorok = [['Korábbi időpont', idopont(regi)], ...adatok(f, { idopontCimke: 'Új időpont' })];
  return level('kollega-modositas', cimzett, targy, `${f.nev} foglalása módosult.`, sorok, 'A korábbi időpont felszabadult.');
}

/**
 * Emlékeztető a páciensnek (Lilla: kb. 30 órával előtte), a tokenes „Időpont lemondása / módosítása”
 * gombbal és a lemondási határidővel. A határidő a kezdés előtti lemondasOra óra. Ha az ütemező
 * késve fut és a határidő már elmúlt (lemondhato = false), gomb helyett a telefonszám szerepel.
 */
export function emlekezteto(f, { lemondasUrl, hataridoMs, szabalyok, lemondhato = true }) {
  const targy = `Emlékeztető · ${szepDatum(f.datum)} ${f.kezd} · Studio F360`;
  const hatarido = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(hataridoMs));
  const sorok = [
    ['Időpont', idopont(f)],
    ['Szolgáltatás', `${f.szolgaltatas.nev} (${f.szolgaltatas.perc} perc)`],
    ['Szakember', f.kollega.nev],
    ['Helyszín', `${f.helyszin.nev}, ${f.helyszin.cim}`],
    ['Azonosító', f.azonosito],
  ];
  const gomb = `<p style="margin:24px 0"><a href="${esc(lemondasUrl)}" style="display:inline-block;padding:12px 22px;background:${SZIN.accent};color:${SZIN.ink};text-decoration:none">${esc(KEZELO_GOMB)}</a></p>`;
  const kezeloHtml = lemondhato
    ? `<p>Ha mégsem tudsz jönni, vagy másik időpont kellene, ${esc(hatarido)}-ig itt lemondhatod vagy módosíthatod:</p>${gomb}`
      + `<p>Ezután telefonon tudunk segíteni: ${esc(szabalyok.telefon)}.</p>`
    : `<p>Ha mégsem tudsz jönni, kérjük, hívj minket minél előbb: ${esc(szabalyok.telefon)}.</p>`;
  const kezeloSzoveg = lemondhato
    ? `Ha mégsem tudsz jönni, vagy másik időpont kellene, ${hatarido}-ig itt lemondhatod vagy módosíthatod (${KEZELO_GOMB}):\n${lemondasUrl}\n\n`
      + `Ezután telefonon tudunk segíteni: ${szabalyok.telefon}.`
    : `Ha mégsem tudsz jönni, kérjük, hívj minket minél előbb: ${szabalyok.telefon}.`;
  const html = keret(targy, `<p>Kedves ${esc(f.nev)}!</p>`
    + `<p>Emlékeztetünk a közelgő időpontodra.</p>`
    + tabla(sorok)
    + kezeloHtml
    + `<p>Várunk szeretettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${f.nev}!\n\nEmlékeztetünk a közelgő időpontodra.\n\n${szovegSorok(sorok)}\n\n`
    + `${kezeloSzoveg}\n\nVárunk szeretettel,\na Studio F360 csapata\n`;
  return { tipus: 'emlekezteto', cimzett: f.email, targy, html, szoveg };
}

/** A kolléga privát címe a törzsadatból (üres, ha nincs, vagy ha a kolléga-értesítés ki van kapcsolva). */
export function kollegaCim(torzs, kollegaId) {
  if (torzs.szabalyok && torzs.szabalyok.ertesitKollega === false) return '';
  const k = torzs.kollegak.find((x) => x.id === kollegaId);
  return (k && k.email) || '';
}
