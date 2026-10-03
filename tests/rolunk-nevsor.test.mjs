// Rólunk oldal: a csapat-névsor a foglaló kollégáiból (Caesar, 2026-10-03).
// Szerződés: Claude tesztelés\f360-rolunk-dinamikus-2026-10-03\SZERZODES.md.
// A valódi rolunk.html-en és a valódi seed-törzzsel fut; a D1 valódi SQLite (node:sqlite). Tesztadat: „David teszt”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeD1 } from './_d1.mjs';
import { SEED_TORZS } from '../functions/_lib/booking/seed.js';
import { CACHE_CONTROL, rolunkHtml, rolunkValasz } from '../functions/_lib/rolunk.js';
import { onRequest } from '../functions/rolunk.js';

const GY = join(import.meta.dirname, '..');
const HTML = readFileSync(join(GY, 'rolunk.html'), 'utf8');
const MA = '2026-10-03';
const torzs = (fn = (k) => k) => ({ ...structuredClone(SEED_TORZS), kollegak: structuredClone(SEED_TORZS.kollegak).map(fn).filter(Boolean) });
const plusz = (...uj) => ({ ...torzs(), kollegak: [...torzs().kollegak, ...uj] });

/** A [data-roster] blokk kártyái: [{ id, loc, nev, html }]. */
function kartyak(html) {
  const r = html.match(/<div class="roster" data-roster>([\s\S]*?)<p class="roster__note"/);
  assert.ok(r, 'van data-roster blokk');
  return [...r[1].matchAll(/<details class="dossier"[^>]*>[\s\S]*?<\/details>/g)].map((m) => ({
    id: (m[0].match(/data-id="([^"]*)"/) || [])[1],
    loc: (m[0].match(/data-loc="([^"]*)"/) || [])[1],
    nev: (m[0].match(/<span class="nm">([\s\S]*?)<\/span>/) || [])[1],
    html: m[0],
  }));
}
const szekciok = (html) => [...html.match(/<div class="roster" data-roster>([\s\S]*?)<p class="roster__note"/)[1].matchAll(/<h3 class="([^"]*)">([^<]*)<\/h3>/g)].map((m) => m[2]);
const letszam = (html) => html.match(/<p class="team__count">([\s\S]*?)<\/p>/)[1];

// ---------------------------------------------------------------- generálás (tiszta függvény)

test('seed-törzs: az alapító (Kovács Anna) nincs a névsorban, a többi kártya bájtra azonos a statikussal, a számok 8 / 5 / 4', () => {
  const ki = rolunkHtml(HTML, torzs(), MA);
  assert.ok(ki);
  const elotte = kartyak(HTML).filter((k) => k.id !== 'kovacs-anna');
  const utana = kartyak(ki);
  assert.deepEqual(utana.map((k) => `${k.id}|${k.loc}`), elotte.map((k) => `${k.id}|${k.loc}`));
  for (let i = 0; i < elotte.length; i++) assert.equal(utana[i].html, elotte[i].html, elotte[i].id);
  assert.deepEqual(szekciok(ki), ['Mexikói út · XIV. kerület', 'Reitter Ferenc utca · XIII. kerület']);
  assert.equal(letszam(ki), '<b data-n="team">8</b> szakember · <b data-n="mex">5</b> a Mexikói úton · <b data-n="reit">4</b> a Reitter Ferenc utcában · egy kolléga mindkét helyszínen');
  // a blokkon kívül semmi nem változik
  const ki2 = ki.replace(/<div class="roster" data-roster>[\s\S]*?<p class="roster__note"/, '').replace(/<p class="team__count">[\s\S]*?<\/p>/, '');
  const be2 = HTML.replace(/<div class="roster" data-roster>[\s\S]*?<p class="roster__note"/, '').replace(/<p class="team__count">[\s\S]*?<\/p>/, '');
  assert.equal(ki2, be2);
  assert.ok(ki.includes('<section class="team" id="csapat"'), 'a #csapat horgony megvan');
});

test('ha az alapító nincs a törzsben, a teljes statikus blokk (Anna nélkül) bájtra azonos: a sorköz és a behúzás is', () => {
  const ki = rolunkHtml(HTML, torzs((k) => (k.id === 'kovacs-anna' ? null : k)), MA);
  const blokk = (h) => h.replace(/\r\n/g, '\n').match(/<div class="roster" data-roster>[\s\S]*?<p class="roster__note"/)[0];
  const anna = kartyak(HTML.replace(/\r\n/g, '\n')).find((k) => k.id === 'kovacs-anna').html;
  assert.equal(blokk(ki), blokk(HTML).replace(`    ${anna}\n`, ''));
});

test('új kolléga („David teszt”) a Reitterbe bemutatkozással: a Reitter végén, monogrammal, bekezdésekkel, „Területei” nélkül; a számok nőnek', () => {
  const ki = rolunkHtml(HTML, plusz({ id: 'david-teszt', nev: 'David teszt', szerep: 'gyógytornász, sportrehabilitáció', helyszinek: ['reitter'], szolgaltatasok: [], foto: '', bemutatkozas: 'Első bekezdés.\n\nMásodik bekezdés.' }), MA);
  const k = kartyak(ki);
  assert.deepEqual(k.filter((x) => x.loc === 'reit').map((x) => x.id), ['adorjani-anna', 'osvath-bence', 'szegedi-botond', 'kovacs-sebestyen', 'david-teszt']);
  const d = k.find((x) => x.id === 'david-teszt').html;
  assert.match(d, /<span class="pf pf--none" aria-hidden="true">DT<\/span>/);
  assert.match(d, /<span class="nm">David teszt<\/span>/);
  assert.match(d, /<span class="rl">gyógytornász · sportrehabilitáció<\/span>/);
  assert.match(d, /<div class="cv">\s*<p>Első bekezdés\.<\/p>\s*<p>Második bekezdés\.<\/p>\s*<\/div>/);
  assert.ok(!d.includes('class="skills"'));
  assert.match(letszam(ki), /<b data-n="team">9<\/b> szakember · <b data-n="mex">5<\/b> a Mexikói úton · <b data-n="reit">5<\/b>/);
});

test('archivált kolléga eltűnik, lejárt aktiv_ig eltűnik; a mai aktiv_ig és a jövőbeli aktiv_tol marad', () => {
  const t = torzs((k) => {
    if (k.id === 'vas-luca') return { ...k, archivalt: true };
    if (k.id === 'osvath-bence') return { ...k, aktiv_ig: '2026-10-02' };
    if (k.id === 'adorjani-anna') return { ...k, aktiv_ig: MA };
    if (k.id === 'kovacs-sebestyen') return { ...k, aktiv_tol: '2026-12-01' };
    return k;
  });
  const ids = kartyak(rolunkHtml(HTML, t, MA)).map((k) => k.id);
  assert.ok(!ids.includes('vas-luca'));
  assert.ok(!ids.includes('osvath-bence'));
  assert.ok(ids.includes('adorjani-anna'));
  assert.ok(ids.includes('kovacs-sebestyen'));
});

test('alapítók: sem a kovacs-anna azonosító, sem a Tringer Lilla nevű kolléga nem kerül a névsorba', () => {
  const ki = rolunkHtml(HTML, plusz({ id: 'lilla', nev: 'Tringer Lilla', szerep: 'gyógytornász', helyszinek: ['mexikoi'], szolgaltatasok: [] }), MA);
  const nevek = kartyak(ki).map((k) => k.nev);
  assert.ok(!nevek.includes('Kovács Anna'));
  assert.ok(!nevek.includes('Tringer Lilla'));
});

test('bemutatkozás: üresen a statikus szöveg marad (id és helyszín szerint), kitöltve a törzsé, a „Területei” blokk marad', () => {
  const stat = kartyak(HTML).find((k) => k.id === 'vas-luca').html;
  const cv = (h) => h.match(/<div class="cv">([\s\S]*?)<\/div>/)[1];
  const skills = (h) => h.match(/<div class="skills">[\s\S]*?<\/div>/)[0];
  const ures = kartyak(rolunkHtml(HTML, torzs((k) => (k.id === 'vas-luca' ? { ...k, bemutatkozas: '   ' } : k)), MA)).find((k) => k.id === 'vas-luca').html;
  assert.equal(cv(ures), cv(stat));
  const kit = kartyak(rolunkHtml(HTML, torzs((k) => (k.id === 'vas-luca' ? { ...k, bemutatkozas: 'Új bemutatkozás.' } : k)), MA)).find((k) => k.id === 'vas-luca').html;
  assert.match(cv(kit), /^\s*<p>Új bemutatkozás\.<\/p>\s*$/);
  assert.equal(skills(kit), skills(stat));
  // a két helyszínes kolléga: mindkét kártya a saját helyszíne szerinti statikus szövegét kapja
  const b = kartyak(rolunkHtml(HTML, torzs(), MA)).filter((k) => k.id === 'szegedi-botond');
  assert.ok(b.find((x) => x.loc === 'reit').html.includes('A Reitterben sportmasszázs'));
  assert.ok(b.find((x) => x.loc === 'mex').html.includes('Vendéglátós-szakács'));
});

test('szerkesztett szerep és fotó: a törzs értéke látszik („ · ”-tal), a két helyszínes kolléga jelölővel', () => {
  const ki = rolunkHtml(HTML, torzs((k) => (k.id === 'szegedi-botond' ? { ...k, szerep: 'gyógymasszőr, sportmasszőr', foto: '/media/brand/csapat/uj.jpg' } : k)), MA);
  const b = kartyak(ki).filter((k) => k.id === 'szegedi-botond');
  assert.match(b.find((x) => x.loc === 'mex').html, /<span class="rl">gyógymasszőr · sportmasszőr <span class="loc-b">Reitter is<\/span><\/span>/);
  assert.match(b.find((x) => x.loc === 'reit').html, /<span class="rl">gyógymasszőr · sportmasszőr <span class="loc-b">Mexikói is<\/span><\/span>/);
  for (const x of b) assert.match(x.html, /<img class="pf" src="\/media\/brand\/csapat\/uj\.jpg" alt="" width="360" height="360" loading="lazy">/);
});

test('XSS: a név, a szerep és a bemutatkozás escape-elve, a nem engedett fotó-cím helyett monogram', () => {
  const ki = rolunkHtml(HTML, plusz({
    id: 'x"><script>', nev: '<script>alert(1)</script> David teszt', szerep: '<img src=x onerror=alert(1)>',
    helyszinek: ['mexikoi'], szolgaltatasok: [], foto: 'javascript:alert(1)', bemutatkozas: '</p><script>alert(2)</script>',
  }), MA);
  const blokk = ki.match(/<div class="roster" data-roster>[\s\S]*?<p class="roster__note"/)[0];
  assert.ok(!blokk.includes('<script>'));
  assert.ok(!blokk.includes('<img src=x'));
  assert.ok(!blokk.includes('javascript:'));
  assert.ok(blokk.includes('&lt;script&gt;alert(1)&lt;/script&gt; David teszt'));
  assert.ok(blokk.includes('data-id="x&quot;&gt;&lt;script&gt;"'));
  for (const rossz of ['//gonosz.example/x.jpg', 'http://gonosz.example/x.jpg', 'data:image/png;base64,AA']) {
    const k = kartyak(rolunkHtml(HTML, plusz({ id: 'f', nev: 'David teszt', szerep: '', helyszinek: ['mexikoi'], szolgaltatasok: [], foto: rossz }), MA)).find((x) => x.id === 'f');
    assert.match(k.html, /pf--none/, rossz);
  }
});

test('jelölő nélküli oldal (nincs data-roster): null, a hívó a statikus oldalt adja', () => {
  assert.equal(rolunkHtml(HTML.replace(' data-roster>', '>'), torzs(), MA), null);
});

// ---------------------------------------------------------------- a Function

function ctx({ env, html = HTML, status = 200, ct = 'text/html; charset=utf-8', method = 'GET', headers = {} } = {}) {
  const kertek = [];
  const request = new Request('https://f360.example/rolunk', { method, headers });
  return {
    kertek,
    context: {
      request, env, params: {}, data: {},
      next: async (r) => {
        kertek.push(r || request);
        return new Response(method === 'HEAD' ? null : html, {
          status, headers: { 'Content-Type': ct, ETag: '"abc"', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' },
        });
      },
    },
  };
}
function dbTorzzsel(t) {
  const db = fakeD1();
  db._raw.exec(`CREATE TABLE settings (kulcs TEXT PRIMARY KEY, ertek TEXT NOT NULL, modositva INTEGER NOT NULL)`);
  if (t !== undefined) db._raw.prepare(`INSERT INTO settings VALUES ('torzs', ?, 1)`).run(typeof t === 'string' ? t : JSON.stringify(t));
  return db;
}
const most = Date.parse('2026-10-03T10:00:00Z');

test('Function: friss névsor a D1-ből, 200, Cache-Control s-maxage=300, a biztonsági fejlécek maradnak, ETag nincs', async () => {
  const db = dbTorzzsel(plusz({ id: 'david-teszt', nev: 'David teszt', szerep: '', helyszinek: ['reitter'], szolgaltatasok: [] }));
  const { context } = ctx({ env: { BOOKING_DB: db } });
  const r = await rolunkValasz(context, { most });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), CACHE_CONTROL);
  assert.equal(CACHE_CONTROL, 'public, max-age=60, s-maxage=300');
  assert.equal(r.headers.get('Content-Security-Policy'), "default-src 'self'");
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(r.headers.get('ETag'), null);
  const t = await r.text();
  assert.ok(kartyak(t).some((k) => k.id === 'david-teszt'));
  assert.ok(!kartyak(t).some((k) => k.id === 'kovacs-anna'));
});

test('Function: a D1 csak olvasva (egyetlen SELECT, semmi írás és séma-létrehozás)', async () => {
  const db = dbTorzzsel(torzs());
  const sqlek = [];
  const eredeti = db.prepare;
  db.prepare = (sql) => { sqlek.push(sql); return eredeti(sql); };
  db.batch = async () => { throw new Error('írás nem lehet'); };
  const r = await rolunkValasz(ctx({ env: { BOOKING_DB: db } }).context, { most });
  assert.equal(r.status, 200);
  assert.equal(sqlek.length, 1);
  assert.match(sqlek[0], /^SELECT ertek FROM settings WHERE kulcs = 'torzs'$/);
});

test('Function hibatűrés: D1-hiba, nincs kötés, nincs törzs, hibás JSON, üres kolléga-lista esetén a statikus oldal megy ki 200-zal', async () => {
  const hibas = fakeD1();
  hibas.prepare = () => { throw new Error('D1_ERROR: szimulált'); };
  const lassuHiba = fakeD1();
  lassuHiba.prepare = () => ({ bind: () => ({}), first: async () => { throw new Error('D1_ERROR: network'); } });
  for (const [nev, env] of [
    ['D1-hiba (prepare)', { BOOKING_DB: hibas }],
    ['D1-hiba (first)', { BOOKING_DB: lassuHiba }],
    ['nincs kötés', {}],
    ['nincs env', undefined],
    ['nincs törzs', { BOOKING_DB: dbTorzzsel() }],
    ['nincs settings tábla', { BOOKING_DB: fakeD1() }],
    ['hibás JSON', { BOOKING_DB: dbTorzzsel('{nem json') }],
    ['üres kolléga-lista', { BOOKING_DB: dbTorzzsel({ kollegak: [] }) }],
  ]) {
    const r = await rolunkValasz(ctx({ env }).context, { most });
    assert.equal(r.status, 200, nev);
    assert.equal(await r.text(), HTML, nev);
  }
});

test('Function: nem HTML, nem 200 (pl. 304) és HEAD esetén változatlanul továbbad; a statikus kérés feltételes fejlécek nélkül megy', async () => {
  const db = dbTorzzsel(torzs());
  const nem = await rolunkValasz(ctx({ env: { BOOKING_DB: db }, ct: 'text/plain' }).context, { most });
  assert.equal(await nem.text(), HTML);
  const r304 = await rolunkValasz(ctx({ env: { BOOKING_DB: db }, status: 304, html: null }).context, { most });
  assert.equal(r304.status, 304);
  const { context, kertek } = ctx({ env: { BOOKING_DB: db }, headers: { 'If-None-Match': '"abc"', 'If-Modified-Since': 'x', Range: 'bytes=0-10' } });
  const r = await rolunkValasz(context, { most });
  assert.equal(r.status, 200);
  assert.equal(kertek.length, 1);
  for (const h of ['If-None-Match', 'If-Modified-Since', 'Range']) assert.equal(kertek[0].headers.get(h), null, h);
  const head = await rolunkValasz(ctx({ env: { BOOKING_DB: db }, method: 'HEAD' }).context, { most });
  assert.equal(head.status, 200);
});

test('functions/rolunk.js: a Pages belépési pont a rolunkValasz-t hívja; a _routes.json-ban /rolunk szerepel, a /rolunk.html nem', async () => {
  const r = await onRequest(ctx({ env: { BOOKING_DB: dbTorzzsel(torzs()) } }).context);
  assert.equal(r.status, 200);
  assert.ok(!kartyak(await r.text()).some((k) => k.id === 'kovacs-anna'));
  const routes = JSON.parse(readFileSync(join(GY, '_routes.json'), 'utf8'));
  assert.ok(routes.include.includes('/rolunk'));
  assert.ok(!routes.include.some((x) => x.startsWith('/rolunk.')), 'a /rolunk.html átirányítását a statikus kiszolgálás végzi');
  assert.ok(!routes.include.includes('/*'));
});
