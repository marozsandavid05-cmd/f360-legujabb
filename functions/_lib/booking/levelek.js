// Időpontfoglaló · a három levél szövege (magyar, a Studio F360 arculati színeivel, gondolatjel nélkül)
// Arculat: Anthracite #303030, greige #BFA18F, krém #EAEAEA, bézs #E4DBD2, Sky Blue #CCD6D9.
// Minden felhasználói adat HTML-escape-elve kerül a levélbe.

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

/** Visszaigazolás az ügyfélnek, lemondó linkkel és .ics csatolmánnyal. */
export function visszaigazolas(f, { lemondasUrl, icsUrl, szabalyok, ics }) {
  const targy = `Időpontfoglalás visszaigazolása · ${szepDatum(f.datum)} ${f.kezd} · Studio F360`;
  const html = keret(targy, `<p>Kedves ${esc(f.nev)}!</p>`
    + `<p>Köszönjük a foglalásodat, az időpontodat rögzítettük.</p>`
    + adatTabla(f)
    + `<p>A naptáradhoz a csatolt fájllal vagy <a href="${esc(icsUrl)}" style="color:${SZIN.ink}">ezzel a linkkel</a> adhatod hozzá.</p>`
    + `<p>Ha mégsem tudsz jönni, a kezdés előtt ${szabalyok.lemondasOra} óráig itt mondhatod le:</p>`
    + gomb(lemondasUrl, 'Időpont lemondása')
    + `<p>${szabalyok.lemondasOra} órán belül telefonon tudunk segíteni: ${esc(szabalyok.telefon)}.</p>`
    + `<p>Várunk szeretettel,<br>a Studio F360 csapata</p>`);
  const szoveg = `Kedves ${f.nev}!\n\nKöszönjük a foglalásodat, az időpontodat rögzítettük.\n\n${adatSzoveg(f)}\n\n`
    + `Naptárhoz adás: ${icsUrl}\n\nHa mégsem tudsz jönni, a kezdés előtt ${szabalyok.lemondasOra} óráig itt mondhatod le:\n${lemondasUrl}\n\n`
    + `${szabalyok.lemondasOra} órán belül telefonon tudunk segíteni: ${szabalyok.telefon}.\n\nVárunk szeretettel,\na Studio F360 csapata\n`;
  return { tipus: 'visszaigazolas', cimzett: f.email, targy, html, szoveg, ics };
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
