// Studio F360 · a Rólunk oldal csapat-névsora a foglaló kollégáiból (Caesar, 2026-10-03).
// Szerződés: Claude tesztelés\f360-rolunk-dinamikus-2026-10-03\SZERZODES.md.
//
// A /rolunk Pages Function (functions/rolunk.js) a statikus rolunk.html-t szolgálja ki, és HTMLRewriter-rel
// kicseréli a `[data-roster]` blokk belsejét (helyszín-alcímek és kártyák; a záró `.roster__note` marad)
// és a `.team__count` létszám-sort. Forrás: a D1 settings.torzs (ugyanaz, mint a /foglalas-api/katalogus),
// CSAK olvasva: nincs séma-létrehozás és nincs adat-migráció, egy oldalletöltés nem ír az adatbázisba.
//
// Ki jelenik meg: nem archivált, és a kilépés napja (aktiv_ig) nem múlt el (a jövőbeli aktiv_tol is
// megjelenik). Az alapítók (ALAPITOK azonosító vagy név) nem: ők a fenti alapítói blokkban vannak.
// Helyszín-csoportok: Mexikói út, Reitter; a mindkét helyen dolgozó kolléga mindkét listában, a
// „Reitter is” / „Mexikói is” jelölővel. Sorrend: a statikus oldal sorrendje (az adminban nincs
// kolléga-sorrend), az új kolléga a helyszíne végére, a törzs sorrendjében.
//
// Kártya: a statikus `dossier` szerkezet. A statikus HTML-ből (data-id + data-loc szerint) marad a
// „Területei” blokk (.skills), üres bemutatkozásnál a bemutatkozás (.cv), és amíg a kolléga szerepe,
// illetve fotója a seed-érték (Lilla nem szerkesztette), a szerep-sor és a kép is. Így a változatlan
// kolléga kártyája bájtra azonos a statikussal. Minden kolléga-szöveg HTML-escape-elve kerül be.
//
// Hibatűrés: bármilyen hiba (nincs D1-kötés, D1-hiba, hibás JSON, nincs jelölő) esetén a statikus oldal
// megy ki változatlanul, 200-zal. A Function soha nem ad 500-at.

import { SEED_TORZS } from './booking/seed.js';
import { budapestMost } from './booking/ido.js';

export const CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const ALAPITO_ID = new Set(['kovacs-anna', 'tringer-lilla']);
const ALAPITO_NEV = new Set(['tringer lilla', 'kovács anna']);
const HELYSZINEK = [
  { id: 'mexikoi', loc: 'mex', cim: 'Mexikói út · XIV. kerület', sec: 'roster__sec', mas: 'Reitter is' },
  { id: 'reitter', loc: 'reit', cim: 'Reitter Ferenc utca · XIII. kerület', sec: 'roster__sec roster__sec--reit', mas: 'Mexikói is' },
];
const SZAMNEV = ['nulla', 'egy', 'két', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc', 'tíz'];
const ROSTER_NYITO = '<div class="roster" data-roster>';
const seedKollega = new Map(SEED_TORZS.kollegak.map((k) => [k.id, k]));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const attr = (tag, nev) => (tag.match(new RegExp(`\\s${nev}="([^"]*)"`)) || [])[1] || null;

/**
 * A statikus roster blokk: a belseje (start, end indexek a html-ben), a záró rész (.roster__note sora
 * a blokk végéig) és a kártyák [{ id, loc, pf, rl, cv, skills }]. null, ha nincs jelölő vagy nem értelmezhető.
 */
function statikusBlokk(html) {
  html = html.replace(/\r\n/g, '\n'); // LF-en dolgozunk, a hívó visszaállítja a forrás sorvégét
  const nyit = html.indexOf(ROSTER_NYITO);
  if (nyit < 0) return null;
  const start = nyit + ROSTER_NYITO.length;
  const note = html.indexOf('<p class="roster__note"', start);
  if (note < 0) return null;
  const noteVeg = html.indexOf('</p>', note);
  const end = noteVeg < 0 ? -1 : html.indexOf('</div>', noteVeg);
  if (end < 0) return null;
  const sorKezd = html.lastIndexOf('\n', note) + 1;
  const kartyak = [];
  for (const m of html.slice(start, sorKezd).matchAll(/<details class="dossier"[^>]*>[\s\S]*?<\/details>/g)) {
    const blokk = m[0];
    const nyito = blokk.match(/^<details[^>]*>/)[0];
    const id = attr(nyito, 'data-id');
    const loc = attr(nyito, 'data-loc');
    if (!id || !loc) continue;
    kartyak.push({
      id, loc,
      pf: (blokk.match(/<img class="pf"[^>]*>|<span class="pf pf--none"[^>]*>[\s\S]*?<\/span>/) || [''])[0],
      rl: (blokk.match(/<span class="rl">([\s\S]*?)<\/span>\s*<span class="plus"/) || [null, ''])[1],
      cv: (blokk.match(/<div class="cv">([\s\S]*?)<\/div>/) || [null, ''])[1],
      skills: (blokk.match(/<div class="skills">[\s\S]*?<\/div>/) || [''])[0],
    });
  }
  return { start, end, tail: html.slice(sorKezd, end), kartyak };
}

/** Látszik-e a kolléga a Rólunk oldalon (`ma`: budapesti dátum). */
function lathato(k, ma) {
  if (!k || typeof k.id !== 'string' || !k.id || typeof k.nev !== 'string' || !k.nev.trim()) return false;
  if (k.archivalt === true) return false;
  if (typeof k.aktiv_ig === 'string' && k.aktiv_ig && k.aktiv_ig < ma) return false;
  return !ALAPITO_ID.has(k.id) && !ALAPITO_NEV.has(k.nev.trim().toLocaleLowerCase('hu'));
}

/** Fotó csak https:// vagy a weboldalon belüli /út lehet (mint az admin-ellenőrzésnél). */
function fotoUrl(f) {
  if (typeof f !== 'string') return '';
  return /^https:\/\/[^\s"'<>\\]+$/.test(f) || /^\/(?![/\\])[^\s"'<>\\]*$/.test(f) ? f : '';
}

const monogram = (nev) => nev.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('').toLocaleUpperCase('hu');
const bekezdesek = (s) => s.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean).map((x) => `          <p>${esc(x)}</p>`).join('\n');
const mindketHelyen = (k) => HELYSZINEK.every((h) => k.helyszinek.includes(h.id));

function kartya(k, h, pontos, barmely) {
  const seed = seedKollega.get(k.id);
  const foto = typeof k.foto === 'string' ? k.foto : '';
  const szerep = typeof k.szerep === 'string' ? k.szerep : '';
  const mindket = mindketHelyen(k);
  let pf;
  if (pontos && pontos.pf && seed && (seed.foto || '') === foto) pf = pontos.pf;
  else {
    const url = fotoUrl(foto);
    pf = url
      ? `<img class="pf" src="${esc(url)}" alt="" width="360" height="360" loading="lazy">`
      : `<span class="pf pf--none" aria-hidden="true">${esc(monogram(k.nev))}</span>`;
  }
  let rl;
  if (pontos && seed && (seed.szerep || '') === szerep && pontos.rl.includes('class="loc-b"') === mindket) rl = pontos.rl;
  else {
    const reszek = szerep.split(',').map((x) => x.trim()).filter(Boolean);
    rl = esc(reszek.join(' · ')) + (mindket ? `${reszek.length ? ' ' : ''}<span class="loc-b">${h.mas}</span>` : '');
  }
  const bem = typeof k.bemutatkozas === 'string' ? k.bemutatkozas.trim() : '';
  const cv = bem ? `\n${bekezdesek(bem)}\n        ` : (barmely ? barmely.cv : '');
  const skills = barmely && barmely.skills ? `\n        ${barmely.skills}` : '';
  return `    <details class="dossier" data-loc="${h.loc}" data-id="${esc(k.id)}">
      <summary>
        ${pf}
        <span class="nm">${esc(k.nev.trim())}</span>
        <span class="rl">${rl}</span>
        <span class="plus" aria-hidden="true">+</span>
      </summary>
      <div class="dossier__body">
        <div class="cv">${cv}</div>${skills}
      </div>
    </details>
`;
}

/** A létszám-sor belseje (a statikus szerkezettel azonos). */
function letszamSor({ team, mex, reit, mindket }) {
  const veg = mindket > 0 ? ` · ${SZAMNEV[mindket] || mindket} kolléga mindkét helyszínen` : '';
  return `<b data-n="team">${team}</b> szakember · <b data-n="mex">${mex}</b> a Mexikói úton · <b data-n="reit">${reit}</b> a Reitter Ferenc utcában${veg}`;
}

/**
 * A cserélendő részek: a `[data-roster]` új belseje és a `.team__count` új belseje.
 * null, ha az oldalon nincs jelölő (ilyenkor a statikus oldal megy ki).
 */
export function rolunkReszek(html, torzs, ma) {
  const st = statikusBlokk(html);
  if (!st) return null;
  const kollegak = torzs.kollegak.filter((k) => lathato(k, ma)).map((k) => ({ ...k, helyszinek: Array.isArray(k.helyszinek) ? k.helyszinek : [] }));
  const pontosan = new Map(st.kartyak.map((c) => [`${c.id}|${c.loc}`, c]));
  const elso = new Map();
  for (const c of st.kartyak) if (!elso.has(c.id)) elso.set(c.id, c);
  const hely = (id, loc) => {
    const i = st.kartyak.findIndex((c) => c.id === id && c.loc === loc);
    return i < 0 ? Infinity : i;
  };
  let roster = '\n';
  const szamok = { team: 0, mex: 0, reit: 0, mindket: 0 };
  const latott = new Set();
  for (const h of HELYSZINEK) {
    const itt = kollegak.map((k, i) => ({ k, i })).filter(({ k }) => k.helyszinek.includes(h.id))
      .sort((a, b) => (hely(a.k.id, h.loc) - hely(b.k.id, h.loc)) || (a.i - b.i));
    szamok[h.loc] = itt.length;
    if (!itt.length) continue;
    roster += `    <h3 class="${h.sec}">${h.cim}</h3>\n`;
    for (const { k } of itt) {
      const pontos = pontosan.get(`${k.id}|${h.loc}`) || null;
      roster += kartya(k, h, pontos, pontos || elso.get(k.id) || null);
      latott.add(k.id);
    }
    roster += '\n';
  }
  szamok.team = latott.size;
  szamok.mindket = kollegak.filter(mindketHelyen).length;
  // a generált rész sorvége a forrásé (a repóban LF, a Windowsos munkamásolatban CRLF)
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  return { st, roster: (roster + st.tail).replace(/\n/g, nl), letszam: letszamSor(szamok) };
}

/** Ugyanaz szövegként (tesztekhez, és ha a futtatókörnyezetben nincs HTMLRewriter). null: nincs jelölő. */
export function rolunkHtml(html, torzs, ma) {
  const r = rolunkReszek(html, torzs, ma);
  if (!r) return null;
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  const lf = html.replace(/\r\n/g, '\n');
  const ki = (lf.slice(0, r.st.start) + r.roster.replace(/\r\n/g, '\n') + lf.slice(r.st.end)).replace(/\n/g, nl);
  return ki.replace(/(<p class="team__count">)[\s\S]*?(<\/p>)/, (_, a, b) => a + r.letszam + b);
}

/** A törzs CSAK olvasva. null: nincs használható adat. */
async function torzsOlvas(db) {
  const sor = await db.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).first();
  if (!sor || typeof sor.ertek !== 'string') return null;
  const t = JSON.parse(sor.ertek);
  return t && Array.isArray(t.kollegak) && t.kollegak.length ? t : null;
}

/** A statikus fájlt feltételes fejlécek nélkül kérjük, hogy 304 helyett mindig a teljes oldal jöjjön. */
function feltetelNelkul(request) {
  const h = new Headers(request.headers);
  for (const k of ['If-None-Match', 'If-Modified-Since', 'If-Match', 'If-Unmodified-Since', 'If-Range', 'Range']) h.delete(k);
  return new Request(request.url, { method: 'GET', headers: h });
}

/**
 * A /rolunk kérés. Csak GET-et ír át, minden más metódus a statikus kiszolgálásra megy tovább.
 * `Rewriter`: a workerd HTMLRewriter; ha nincs (Node-teszt), a szöveges csere fut, ugyanazzal az eredménnyel.
 */
export async function rolunkValasz(context, { Rewriter = globalThis.HTMLRewriter, most = Date.now() } = {}) {
  const { request, env } = context;
  if (request.method !== 'GET') return context.next();
  const statikus = await context.next(feltetelNelkul(request));
  if (statikus.status !== 200 || !(statikus.headers.get('Content-Type') || '').includes('text/html')) return statikus;
  if (!env || !env.BOOKING_DB) return statikus;
  // a statikus oldalt egyszer olvassuk be; hibánál ugyanezt adjuk vissza változatlanul
  const html = await statikus.text();
  const valtozatlan = () => new Response(html, { status: 200, headers: statikus.headers });
  try {
    const torzs = await torzsOlvas(env.BOOKING_DB);
    if (!torzs) return valtozatlan();
    const ma = budapestMost(most).datum;
    const r = rolunkReszek(html, torzs, ma);
    if (!r) return valtozatlan();
    const headers = new Headers(statikus.headers);
    for (const k of ['ETag', 'Last-Modified', 'Content-Length', 'Age']) headers.delete(k);
    headers.set('Cache-Control', CACHE_CONTROL);
    if (typeof Rewriter !== 'function') return new Response(rolunkHtml(html, torzs, ma), { status: 200, headers });
    return new Rewriter()
      .on('[data-roster]', { element(el) { el.setInnerContent(r.roster, { html: true }); } })
      .on('.team__count', { element(el) { el.setInnerContent(r.letszam, { html: true }); } })
      .transform(new Response(html, { status: 200, headers }));
  } catch (e) {
    console.error('[rolunk] a dinamikus névsor kimarad, a statikus oldal megy ki:', e && e.message);
    return valtozatlan();
  }
}
