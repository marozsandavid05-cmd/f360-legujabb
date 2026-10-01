// Időpontfoglaló · a három levél szövege (magyar, a Studio F360 arculati színeivel, gondolatjel nélkül)
// Arculat: Anthracite #303030, greige #BFA18F, krém #EAEAEA, bézs #E4DBD2, Sky Blue #CCD6D9.
// Minden felhasználói adat HTML-escape-elve kerül a levélbe.

import { googleNaptarUrl } from './ics.js';

const SZIN = { ink: '#303030', accent: '#BFA18F', krem: '#EAEAEA', bezs: '#E4DBD2', kek: '#CCD6D9' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NAPNEV = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const HONAP = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

export function szepDatum(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  const nap = NAPNEV[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}. ${HONAP[m - 1]} ${d}. (${nap})`;
}

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

function adatTabla(f) {
  const sor = (k, v) => `<tr><td style="padding:6px 16px 6px 0;color:${SZIN.ink};opacity:.7;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid ${SZIN.accent};border-bottom:1px solid ${SZIN.accent};width:100%">`
    + sor('Időpont', `${szepDatum(f.datum)}, ${f.kezd} és ${f.veg} között`)
    + sor('Szolgáltatás', `${f.szolgaltatas.nev} (${f.szolgaltatas.perc} perc)`)
    + sor('Szakember', f.kollega.nev)
    + sor('Helyszín', `${f.helyszin.nev}, ${f.helyszin.cim}`)
    + (f.szolgaltatas.ar != null ? sor('Ár', `${ft(f.szolgaltatas.ar)}, a helyszínen fizetendő`) : '')
    + sor('Azonosító', f.azonosito)
    + `</table>`;
}

const adatSzoveg = (f) => [
  `Időpont: ${szepDatum(f.datum)}, ${f.kezd} és ${f.veg} között`,
  `Szolgáltatás: ${f.szolgaltatas.nev} (${f.szolgaltatas.perc} perc)`,
  `Szakember: ${f.kollega.nev}`,
  `Helyszín: ${f.helyszin.nev}, ${f.helyszin.cim}`,
  f.szolgaltatas.ar != null ? `Ár: ${ft(f.szolgaltatas.ar)}, a helyszínen fizetendő` : '',
  `Azonosító: ${f.azonosito}`,
].filter(Boolean).join('\n');

const gomb = (url, felirat) => `<p style="margin:24px 0"><a href="${esc(url)}" style="display:inline-block;padding:12px 22px;background:${SZIN.accent};color:${SZIN.ink};text-decoration:none">${esc(felirat)}</a></p>`;

/** A páciens leveleiben a tokenes link gombja (lemondás és módosítás ugyanott). */
export const KEZELO_GOMB = 'Időpont lemondása / módosítása';

const kezeloHtml = (lemondasUrl, szabalyok) => `<p>Ha mégsem tudsz jönni, vagy másik időpont kellene, a kezdés előtt ${szabalyok.lemondasOra} óráig itt lemondhatod vagy módosíthatod:</p>`
  + gomb(lemondasUrl, KEZELO_GOMB)
  + `<p>${szabalyok.lemondasOra} órán belül telefonon tudunk segíteni: ${esc(szabalyok.telefon)}.</p>`;
const kezeloSzoveg = (lemondasUrl, szabalyok) => `Ha mégsem tudsz jönni, vagy másik időpont kellene, a kezdés előtt ${szabalyok.lemondasOra} óráig itt lemondhatod vagy módosíthatod (${KEZELO_GOMB}):\n${lemondasUrl}\n\n`
  + `${szabalyok.lemondasOra} órán belül telefonon tudunk segíteni: ${szabalyok.telefon}.`;
const naptarHtml = (icsUrl, googleUrl) => `<p>A naptáradhoz a csatolt fájllal vagy <a href="${esc(icsUrl)}" style="color:${SZIN.ink}">ezzel a linkkel</a> adhatod hozzá.`
  + ` Ha Google Naptárat használsz: <a href="${esc(googleUrl)}" style="color:${SZIN.ink}">hozzáadás a Google Naptárhoz</a>.</p>`;
const naptarSzoveg = (icsUrl, googleUrl) => `Naptárhoz adás: ${icsUrl}\nGoogle Naptárhoz: ${googleUrl}`;
const regiIdopont = (r) => `${szepDatum(r.datum)}, ${r.kezd} és ${r.veg} között, ${r.kollega.nev}`;

/** Visszaigazolás az ügyfélnek, lemondó és módosító linkkel és .ics csatolmánnyal. */
export function visszaigazolas(f, { lemondasUrl, icsUrl, szabalyok, ics }) {
  const targy = `Időpontfoglalás visszaigazolása · ${szepDatum(f.datum)} ${f.kezd} · Studio F360`;
  const html = keret(targy, `<p>Kedves ${esc(f.nev)}!</p>`
    + `<p>Köszönjük a foglalásodat, az időpontodat rögzítettük.</p>`
    + adatTabla(f)
    + naptarHtml(icsUrl, googleNaptarUrl(f, { lemondasUrl }))
    + kezeloHtml(lemondasUrl, szabalyok)
    + `<p>Várunk szeretettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${f.nev}!\n\nKöszönjük a foglalásodat, az időpontodat rögzítettük.\n\n${adatSzoveg(f)}\n\n`
    + `${naptarSzoveg(icsUrl, googleNaptarUrl(f, { lemondasUrl }))}\n\n${kezeloSzoveg(lemondasUrl, szabalyok)}\n\nVárunk szeretettel,\na Studio F360 csapata\n`;
  return { tipus: 'visszaigazolas', cimzett: f.email, targy, html, szoveg, ics };
}

/** Visszaigazolás a módosításról az ügyfélnek: a régi és az új időpont, új .ics, ugyanaz a link. */
export function modositasLevel(f, { regi, lemondasUrl, icsUrl, szabalyok, ics }) {
  const targy = `Időpont módosítva · ${szepDatum(f.datum)} ${f.kezd} · Studio F360`;
  const html = keret(targy, `<p>Kedves ${esc(f.nev)}!</p>`
    + `<p>Az időpontodat módosítottuk. A korábbi időpont (${esc(regiIdopont(regi))}) már nem érvényes, az új:</p>`
    + adatTabla(f)
    + naptarHtml(icsUrl, googleNaptarUrl(f, { lemondasUrl }))
    + `<p>Ha a naptáradban a korábbi időpont is szerepel, azt töröld.</p>`
    + kezeloHtml(lemondasUrl, szabalyok)
    + `<p>Várunk szeretettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${f.nev}!\n\nAz időpontodat módosítottuk. A korábbi időpont (${regiIdopont(regi)}) már nem érvényes, az új:\n\n${adatSzoveg(f)}\n\n`
    + `${naptarSzoveg(icsUrl, googleNaptarUrl(f, { lemondasUrl }))}\nHa a naptáradban a korábbi időpont is szerepel, azt töröld.\n\n${kezeloSzoveg(lemondasUrl, szabalyok)}\n\nVárunk szeretettel,\na Studio F360 csapata\n`;
  return { tipus: 'modositas', cimzett: f.email, targy, html, szoveg, ics };
}

/** Értesítő a stúdiónak, ha a páciens a linkkel módosította a foglalását. */
export function studioModositas(f, { regi, szabalyok }) {
  const targy = `Módosított foglalás · ${f.helyszin.nev} · ${szepDatum(f.datum)} ${f.kezd} · ${f.kollega.nev}`;
  const kapcsolat = [f.email && `E-mail: ${f.email}`, f.telefon && `Telefon: ${f.telefon}`].filter(Boolean);
  const html = keret(targy, `<p><strong>${esc(f.nev)}</strong> módosította a foglalását a weboldalon.</p>`
    + `<p>Korábbi időpont: ${esc(regiIdopont(regi))}. Ez az időpont felszabadult.</p>`
    + `<p>Új időpont:</p>`
    + adatTabla(f)
    + `<p>${kapcsolat.map(esc).join('<br>')}</p>`);
  const szoveg = `${f.nev} módosította a foglalását a weboldalon.\n\nKorábbi időpont: ${regiIdopont(regi)}. Ez az időpont felszabadult.\n\n`
    + `Új időpont:\n${adatSzoveg(f)}\n\n${kapcsolat.join('\n')}\n`;
  return { tipus: 'studio-modositas', cimzett: szabalyok.studioEmail, targy, html, szoveg };
}

/** Értesítő a stúdiónak az új foglalásról. */
export function studioErtesito(f, { szabalyok }) {
  const targy = `Új foglalás · ${f.helyszin.nev} · ${szepDatum(f.datum)} ${f.kezd} · ${f.kollega.nev}`;
  const kapcsolat = [f.email && `E-mail: ${f.email}`, f.telefon && `Telefon: ${f.telefon}`].filter(Boolean);
  const html = keret(targy, `<p>Új foglalás érkezett a weboldalról.</p>`
    + adatTabla(f)
    + `<p><strong>${esc(f.nev)}</strong><br>${kapcsolat.map(esc).join('<br>')}</p>`
    + (f.megjegyzes ? `<p>Megjegyzés: ${esc(f.megjegyzes)}</p>` : ''));
  const szoveg = `Új foglalás érkezett a weboldalról.\n\n${adatSzoveg(f)}\n\nVendég: ${f.nev}\n${kapcsolat.join('\n')}\n`
    + (f.megjegyzes ? `Megjegyzés: ${f.megjegyzes}\n` : '');
  return { tipus: 'studio-ertesito', cimzett: szabalyok.studioEmail, targy, html, szoveg };
}

/** Visszaigazolás a lemondásról az ügyfélnek. */
export function lemondasLevel(f, { szabalyok }) {
  const targy = `Időpont lemondva · ${szepDatum(f.datum)} ${f.kezd} · Studio F360`;
  const html = keret(targy, `<p>Kedves ${esc(f.nev)}!</p>`
    + `<p>Az alábbi időpontodat lemondtuk.</p>`
    + adatTabla(f)
    + `<p>Ha új időpontot szeretnél, a weboldalon foglalhatsz, vagy hívj minket: ${esc(szabalyok.telefon)}.</p>`
    + `<p>Üdvözlettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${f.nev}!\n\nAz alábbi időpontodat lemondtuk.\n\n${adatSzoveg(f)}\n\n`
    + `Ha új időpontot szeretnél, a weboldalon foglalhatsz, vagy hívj minket: ${szabalyok.telefon}.\n\nÜdvözlettel,\na Studio F360 csapata\n`;
  return { tipus: 'lemondas', cimzett: f.email, targy, html, szoveg };
}
