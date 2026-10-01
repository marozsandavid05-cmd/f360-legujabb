// Időpontfoglaló · a csoportos órák levelei (Hermes, 2026-10-01, a t_5d5623ee gyorsítására).
// Ugyanaz az arculat és keret, mint a levelek.js-ben; minden felhasználói adat HTML-escape-elve,
// a tárgyba és a szöveges változatba csak egysoros (sortörés nélküli) érték kerül.
//
// A bemenet a csoportos foglalás nézete („cf”):
//   { azonosito, nev, email, telefon, megjegyzes, datum: 'YYYY-MM-DD', kezd: 'HH:MM', veg: 'HH:MM', kezdPerc?,
//     ora: { id, nev, perc, ar, kategoria }, kollega: { id, nev } | null, helyszin: { nev, cim } }
// A levéltípusok (tipus) a meglévő admin-szűrők miatt ugyanazok, mint az egyéni foglalásnál
// (visszaigazolas, lemondas, modositas, emlekezteto, kollega-uj, kollega-lemondas), plusz az új „ora-elmarad”.
// Minden levélben ott a „csoportos: true” jelző, ha a felület külön akarja jelölni.

import { esc, KEZELO_GOMB, szepDatum } from './levelek.js';
import { googleNaptarUrl } from './ics.js';

const SZIN = { ink: '#303030', accent: '#BFA18F', krem: '#EAEAEA', bezs: '#E4DBD2' };
const egysor = (s) => String(s ?? '').replace(/[\r\n\t\u2028\u2029]+/g, ' ').trim();
const ft = (n) => (n == null ? '' : `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Ft`);

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
const gomb = (url, felirat) => `<p style="margin:24px 0"><a href="${esc(url)}" style="display:inline-block;padding:12px 22px;background:${SZIN.accent};color:${SZIN.ink};text-decoration:none">${esc(felirat)}</a></p>`;

const idopont = (cf) => `${szepDatum(cf.datum)}, ${cf.kezd} és ${cf.veg} között`;
const oktato = (cf) => (cf.kollega && cf.kollega.nev ? egysor(cf.kollega.nev) : '');

/** Az óra adatsorai a vendégnek. */
function oraSorok(cf, { idopontCimke = 'Időpont' } = {}) {
  return [
    [idopontCimke, idopont(cf)],
    ['Óra', `${egysor(cf.ora.nev)} (${cf.ora.perc} perc)`],
    ['Oktató', oktato(cf)],
    ['Helyszín', `${egysor(cf.helyszin.nev)}, ${egysor(cf.helyszin.cim)}`],
    ['Ár', cf.ora.ar != null ? `${ft(cf.ora.ar)}, a helyszínen fizetendő` : ''],
    ['Azonosító', cf.azonosito],
  ];
}

// a googleNaptarUrl az egyéni foglalás nézetét várja: az órát szolgáltatásként adjuk át
const gNezet = (cf) => ({
  ...cf, szolgaltatas: { nev: egysor(cf.ora.nev), perc: cf.ora.perc },
  kollega: { nev: oktato(cf) || 'Studio F360' },
});
const naptarHtml = (cf, icsUrl, lemondasUrl) => `<p>A naptáradhoz a csatolt fájllal vagy <a href="${esc(icsUrl)}" style="color:${SZIN.ink}">ezzel a linkkel</a> adhatod hozzá.`
  + ` Ha Google Naptárat használsz: <a href="${esc(googleNaptarUrl(gNezet(cf), { lemondasUrl }))}" style="color:${SZIN.ink}">hozzáadás a Google Naptárhoz</a>.</p>`;
const naptarSzoveg = (cf, icsUrl, lemondasUrl) => `Naptárhoz adás: ${icsUrl}\nGoogle Naptárhoz: ${googleNaptarUrl(gNezet(cf), { lemondasUrl })}`;

const kezeloHtml = (lemondasUrl, szabalyok) => `<p>Ha mégsem tudsz jönni, vagy másik órára mennél, a kezdés előtt ${szabalyok.lemondasOra} óráig itt lemondhatod vagy áthelyezheted:</p>`
  + gomb(lemondasUrl, KEZELO_GOMB)
  + `<p>Ha lemondasz, a helyed felszabadul, és más jelentkezhet az órára. ${szabalyok.lemondasOra} órán belül telefonon tudunk segíteni: ${esc(szabalyok.telefon)}.</p>`;
const kezeloSzoveg = (lemondasUrl, szabalyok) => `Ha mégsem tudsz jönni, vagy másik órára mennél, a kezdés előtt ${szabalyok.lemondasOra} óráig itt lemondhatod vagy áthelyezheted (${KEZELO_GOMB}):\n${lemondasUrl}\n\n`
  + `Ha lemondasz, a helyed felszabadul, és más jelentkezhet az órára. ${szabalyok.lemondasOra} órán belül telefonon tudunk segíteni: ${szabalyok.telefon}.`;

const ZARAS_HTML = `<p>Várunk szeretettel,<br>a Studio F360 csapata</p>`;
const ZARAS = `Várunk szeretettel,\na Studio F360 csapata\n`;
const kedves = (cf) => egysor(cf.nev);

/** Visszaigazolás a vendégnek: jelentkezés egy csoportos órára. */
export function oraVisszaigazolas(cf, { lemondasUrl, icsUrl, szabalyok, ics }) {
  const targy = `Jelentkezés visszaigazolása · ${egysor(cf.ora.nev)} · ${szepDatum(cf.datum)} ${cf.kezd} · Studio F360`;
  const bev = 'Köszönjük a jelentkezésedet, a helyedet lefoglaltuk az órára.';
  const html = keret(targy, `<p>Kedves ${esc(kedves(cf))}!</p><p>${bev}</p>${tabla(oraSorok(cf))}`
    + `<p>Kérjük, pár perccel a kezdés előtt érkezz, hogy nyugodtan át tudj öltözni.</p>`
    + naptarHtml(cf, icsUrl, lemondasUrl) + kezeloHtml(lemondasUrl, szabalyok) + ZARAS_HTML);
  const szoveg = `Kedves ${kedves(cf)}!\n\n${bev}\n\n${szovegSorok(oraSorok(cf))}\n\nKérjük, pár perccel a kezdés előtt érkezz, hogy nyugodtan át tudj öltözni.\n\n`
    + `${naptarSzoveg(cf, icsUrl, lemondasUrl)}\n\n${kezeloSzoveg(lemondasUrl, szabalyok)}\n\n${ZARAS}`;
  return { tipus: 'visszaigazolas', csoportos: true, cimzett: cf.email, targy, html, szoveg, ics };
}

/** Áthelyezés másik órára: a korábbi és az új óra. A link (token) ugyanaz marad. */
export function oraAthelyezesLevel(cf, { regi, lemondasUrl, icsUrl, szabalyok, ics }) {
  const regiSzoveg = `${egysor(regi.ora.nev)}, ${szepDatum(regi.datum)} ${regi.kezd}`;
  const targy = `Óra áthelyezve · ${egysor(cf.ora.nev)} · ${szepDatum(cf.datum)} ${cf.kezd} · Studio F360`;
  const bev = `A jelentkezésedet áthelyeztük. A korábbi óra (${regiSzoveg}) már nem érvényes, az új:`;
  const html = keret(targy, `<p>Kedves ${esc(kedves(cf))}!</p><p>${esc(bev)}</p>${tabla(oraSorok(cf))}`
    + naptarHtml(cf, icsUrl, lemondasUrl) + `<p>Ha a naptáradban a korábbi óra is szerepel, azt töröld.</p>`
    + kezeloHtml(lemondasUrl, szabalyok) + ZARAS_HTML);
  const szoveg = `Kedves ${kedves(cf)}!\n\n${bev}\n\n${szovegSorok(oraSorok(cf))}\n\n${naptarSzoveg(cf, icsUrl, lemondasUrl)}\n`
    + `Ha a naptáradban a korábbi óra is szerepel, azt töröld.\n\n${kezeloSzoveg(lemondasUrl, szabalyok)}\n\n${ZARAS}`;
  return { tipus: 'modositas', csoportos: true, cimzett: cf.email, targy, html, szoveg, ics };
}

/** A vendég (vagy az admin) lemondta a jelentkezést. */
export function oraLemondasLevel(cf, { szabalyok }) {
  const targy = `Jelentkezés lemondva · ${egysor(cf.ora.nev)} · ${szepDatum(cf.datum)} ${cf.kezd} · Studio F360`;
  const bev = 'Az alábbi órára szóló jelentkezésedet lemondtuk, a helyed felszabadult.';
  const vege = `Ha másik órára jelentkeznél, a weboldalon megteheted, vagy hívj minket: ${egysor(szabalyok.telefon)}.`;
  const html = keret(targy, `<p>Kedves ${esc(kedves(cf))}!</p><p>${bev}</p>${tabla(oraSorok(cf))}<p>${esc(vege)}</p><p>Üdvözlettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${kedves(cf)}!\n\n${bev}\n\n${szovegSorok(oraSorok(cf))}\n\n${vege}\n\nÜdvözlettel,\na Studio F360 csapata\n`;
  return { tipus: 'lemondas', csoportos: true, cimzett: cf.email, targy, html, szoveg };
}

/**
 * Emlékeztető a vendégnek (a meglévő 30 órás logikával). Ha a lemondási határidő már elmúlt
 * (lemondhato = false), gomb helyett a telefonszám szerepel.
 */
export function oraEmlekezteto(cf, { lemondasUrl, hataridoMs, szabalyok, lemondhato = true }) {
  const targy = `Emlékeztető · ${egysor(cf.ora.nev)} · ${szepDatum(cf.datum)} ${cf.kezd} · Studio F360`;
  const hatarido = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(hataridoMs));
  const kezH = lemondhato
    ? `<p>Ha mégsem tudsz jönni, ${esc(hatarido)}-ig itt lemondhatod vagy áthelyezheted, így a helyed másnak felszabadul:</p>${gomb(lemondasUrl, KEZELO_GOMB)}`
      + `<p>Ezután telefonon tudunk segíteni: ${esc(szabalyok.telefon)}.</p>`
    : `<p>Ha mégsem tudsz jönni, kérjük, hívj minket minél előbb: ${esc(szabalyok.telefon)}.</p>`;
  const kezSz = lemondhato
    ? `Ha mégsem tudsz jönni, ${hatarido}-ig itt lemondhatod vagy áthelyezheted, így a helyed másnak felszabadul (${KEZELO_GOMB}):\n${lemondasUrl}\n\nEzután telefonon tudunk segíteni: ${szabalyok.telefon}.`
    : `Ha mégsem tudsz jönni, kérjük, hívj minket minél előbb: ${szabalyok.telefon}.`;
  const html = keret(targy, `<p>Kedves ${esc(kedves(cf))}!</p><p>Emlékeztetünk a közelgő órádra.</p>${tabla(oraSorok(cf))}${kezH}${ZARAS_HTML}`);
  const szoveg = `Kedves ${kedves(cf)}!\n\nEmlékeztetünk a közelgő órádra.\n\n${szovegSorok(oraSorok(cf))}\n\n${kezSz}\n\n${ZARAS}`;
  return { tipus: 'emlekezteto', csoportos: true, cimzett: cf.email, targy, html, szoveg };
}

/** Az óra elmarad (az admin jelölte): a résztvevőnek. Az „ok” opcionális, egysoros. */
export function oraElmaradLevel(cf, { szabalyok, ok = '' }) {
  const targy = `Az óra elmarad · ${egysor(cf.ora.nev)} · ${szepDatum(cf.datum)} ${cf.kezd} · Studio F360`;
  const okSor = egysor(ok);
  const bev = 'Sajnos az alábbi óra elmarad. Elnézést kérünk a kellemetlenségért.';
  const vege = `Másik órára a weboldalon jelentkezhetsz, vagy hívj minket: ${egysor(szabalyok.telefon)}.`;
  const sorok = oraSorok(cf).filter(([k]) => k !== 'Ár');
  const html = keret(targy, `<p>Kedves ${esc(kedves(cf))}!</p><p>${bev}</p>${okSor ? `<p>${esc(okSor)}</p>` : ''}${tabla(sorok)}<p>${esc(vege)}</p><p>Üdvözlettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${kedves(cf)}!\n\n${bev}\n${okSor ? `${okSor}\n` : ''}\n${szovegSorok(sorok)}\n\n${vege}\n\nÜdvözlettel,\na Studio F360 csapata\n`;
  return { tipus: 'ora-elmarad', csoportos: true, cimzett: cf.email, targy, html, szoveg };
}

/**
 * Értesítő az oktatónak (kolléga privát címe, ha van és be van kapcsolva) új jelentkezésről vagy lemondásról,
 * a kitöltöttséggel. A vendég lemondó linkje NEM kerül bele (az a vendég titka).
 * @param esemeny  'uj' | 'lemondas'
 * @param allapot  { foglalt, kapacitas }
 */
export function oktatoErtesito(cf, cimzett, { esemeny = 'uj', allapot = {}, admin = false } = {}) {
  const uj = esemeny === 'uj';
  const targy = `${uj ? 'Új jelentkezés' : 'Lemondott jelentkezés'} · ${egysor(cf.ora.nev)} · ${szepDatum(cf.datum)} ${cf.kezd}`;
  const bev = uj
    ? (admin ? 'Új résztvevőt vettek fel az órádra az adminban.' : 'Új jelentkezés érkezett az órádra a weboldalról.')
    : (admin ? 'Az adminban lemondták egy résztvevő jelentkezését az órádra.' : 'Egy résztvevő lemondta a jelentkezését az órádra.');
  const telitettseg = Number.isInteger(allapot.foglalt) && Number.isInteger(allapot.kapacitas) ? `${allapot.foglalt} / ${allapot.kapacitas} hely foglalt` : '';
  const sorok = [
    ['Időpont', idopont(cf)],
    ['Óra', `${egysor(cf.ora.nev)} (${cf.ora.perc} perc)`],
    ['Helyszín', `${egysor(cf.helyszin.nev)}, ${egysor(cf.helyszin.cim)}`],
    ['Résztvevő', egysor(cf.nev)],
    ['E-mail', egysor(cf.email)],
    ['Telefon', egysor(cf.telefon)],
    ['Megjegyzés', egysor(cf.megjegyzes)],
    ['Létszám', telitettseg],
    ['Azonosító', cf.azonosito],
  ];
  const html = keret(targy, `<p>${esc(bev)}</p>${tabla(sorok)}`);
  const szoveg = `${bev}\n\n${szovegSorok(sorok)}\n`;
  return { tipus: uj ? 'kollega-uj' : 'kollega-lemondas', csoportos: true, cimzett, targy, html, szoveg };
}
