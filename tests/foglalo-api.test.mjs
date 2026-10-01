// Időpontfoglaló · nyilvános és admin API, valódi SQLite-tal (D1-utánzat: tests/_d1.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import { onRequest as publikus } from '../functions/foglalas-api/[[utvonal]].js';
import { onRequest as adminRouter } from '../functions/api/foglalo/[[utvonal]].js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { budapestMost, datumPlusz, hetNapja, percToHHMM } from '../functions/_lib/booking/ido.js';

const ORIGIN = 'https://foglalo.f360-legujabb.pages.dev';
const SECRET = 'teszt-titok-'.padEnd(48, 'x');

function ujEnv(extra = {}) { return { BOOKING_DB: fakeD1(), BOOKING_SECRET: SECRET, ...extra }; }

function keres(env, method, path, { body, origin = ORIGIN, ip = '1.2.3.4', headers = {} } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const request = new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return publikus({ request, env, params: {}, data: {} });
}
const get = (env, path, o) => keres(env, 'GET', path, o);
const post = (env, path, body, o = {}) => keres(env, 'POST', path, { ...o, body });

// admin: localhoston DEV_EMAIL-lel a valódi middleware-en át
function admin(env, method, path, body) {
  const url = 'http://127.0.0.1:8788' + path;
  const headers = { Origin: 'http://127.0.0.1:8788' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const context = { request, env: { ...env, DEV_EMAIL: 'david@teszt.hu' }, data: {}, params: {} };
  context.next = () => adminRouter(context);
  return middleware(context);
}

// Az első hétfő, ami legalább 3 nap múlva van (a MINTA beosztás hétfőn biztosan dolgozik)
function celHetfo() {
  let d = datumPlusz(budapestMost().datum, 3);
  while (hetNapja(d) !== 1) d = datumPlusz(d, 1);
  return d;
}
const NAP = celHetfo();
const alap = (o = {}) => ({
  helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: NAP, kezd: '10:00',
  nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true, ...o,
});
const tokenBol = (url) => new URL(url).searchParams.get('t');
const sorok = (env, sql, ...a) => env.BOOKING_DB._raw.prepare(sql).all(...a);

// ---------------------------------------------------------------- alap

test('kötés nélkül 503, magyar hibával', async () => {
  for (const r of [await get({}, '/foglalas-api/katalogus'), await post({}, '/foglalas-api/foglalas', alap())]) {
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /nem elérhető/);
  }
});

test('katalógus: két helyszín, MINTA szolgáltatások és kollégák, szabályok', async () => {
  const r = await get(ujEnv(), '/foglalas-api/katalogus');
  assert.equal(r.status, 200);
  const k = await r.json();
  assert.equal(k.minta, true);
  assert.deepEqual(k.helyszinek.map((h) => h.id), ['mexikoi', 'reitter']);
  assert.ok(k.helyszinek[0].cim.includes('Mexikói út 32/b'));
  const gy = k.szolgaltatasok.find((s) => s.id === 'gyogymasszazs-50');
  assert.deepEqual({ nev: gy.nev, perc: gy.perc, ar: gy.ar, helyszinek: gy.helyszinek }, { nev: 'Gyógymasszázs', perc: 50, ar: 13500, helyszinek: ['mexikoi'] });
  assert.equal(k.szolgaltatasok.length, 14); // 11 egyéni + 3 táplálkozási (csoportos-kör)
  const sb = k.kollegak.find((x) => x.id === 'szegedi-botond');
  assert.deepEqual(sb.helyszinek, ['mexikoi', 'reitter']);
  assert.ok(sb.szolgaltatasok.includes('gyogymasszazs-50'));
  assert.equal(k.szabalyok.lemondasOra, 24);
  assert.equal(k.szabalyok.minEloreOra, 2);
  assert.equal(k.szabalyok.maxEloreNap, 60);
  assert.ok(k.szabalyok.telefon);
  assert.equal(r.headers.get('Content-Type'), 'application/json; charset=utf-8');
});

test('ismeretlen út JSON 404, rossz metódus 405', async () => {
  const e = ujEnv();
  assert.equal((await get(e, '/foglalas-api/nincs-ilyen')).status, 404);
  assert.equal((await keres(e, 'DELETE', '/foglalas-api/katalogus')).status, 405);
});

// ---------------------------------------------------------------- szabad

test('szabad: a tartomány minden napja szerepel, a hétfői 10:00 szabad Botondnál', async () => {
  const e = ujEnv();
  const ig = datumPlusz(NAP, 6);
  const r = await get(e, `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&kollega=szegedi-botond&tol=${NAP}&ig=${ig}`);
  assert.equal(r.status, 200);
  const { napok } = await r.json();
  assert.equal(Object.keys(napok).length, 7);
  const s = napok[NAP].find((x) => x.kezd === '10:00');
  assert.deepEqual(s.kollegak, ['szegedi-botond']);
  assert.deepEqual(napok[datumPlusz(NAP, 1)], []); // kedden a Reitterben van
});

test('szabad: hibás kérések 400 (több mint 14 nap, rossz dátum, ismeretlen helyszín)', async () => {
  const e = ujEnv();
  const q = (o) => new URLSearchParams({ helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', tol: NAP, ig: NAP, ...o });
  assert.equal((await get(e, `/foglalas-api/szabad?${q({ ig: datumPlusz(NAP, 14) })}`)).status, 400);
  assert.equal((await get(e, `/foglalas-api/szabad?${q({ tol: '2026-02-30' })}`)).status, 400);
  assert.equal((await get(e, `/foglalas-api/szabad?${q({ helyszin: 'nincs' })}`)).status, 400);
  assert.equal((await get(e, `/foglalas-api/szabad?${q({ ig: datumPlusz(NAP, -1) })}`)).status, 400);
  assert.equal((await get(e, `/foglalas-api/szabad?${q({ ig: datumPlusz(NAP, 13) })}`)).status, 200);
});

// ---------------------------------------------------------------- foglalás

test('foglalás: 201, azonosító, lemondó link, .ics, levél-előnézet; a három levélből kettő az outboxban', async () => {
  const e = ujEnv();
  const r = await post(e, '/foglalas-api/foglalas', alap());
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.match(d.azonosito, /^F[0-9A-Z]{10}$/);
  assert.ok(d.lemondasUrl.startsWith(`${ORIGIN}/foglalas/lemondas?t=`));
  assert.ok(d.ics.startsWith(`${ORIGIN}/foglalas-api/foglalas.ics?t=`));
  assert.match(d.level.targy, /Studio F360/);
  assert.ok(d.level.html.includes(d.lemondasUrl.replace(/&/g, '&amp;')));
  assert.equal(d.foglalas.kollega.id, 'szegedi-botond');
  assert.equal(d.foglalas.kezd, '10:00');
  assert.equal(d.foglalas.veg, '10:50');
  const ob = sorok(e, 'SELECT tipus, cimzett, sent FROM outbox ORDER BY tipus');
  assert.deepEqual(ob.map((x) => [x.tipus, x.sent]), [['studio-ertesito', 0], ['visszaigazolas', 0]]);
  assert.equal(ob.find((x) => x.tipus === 'visszaigazolas').cimzett, 'david.teszt@example.com');
  // 50 perc + 10 perc puffer = 4 rácspont
  assert.deepEqual(sorok(e, 'SELECT slot_min FROM slot_locks ORDER BY slot_min').map((x) => x.slot_min), [600, 615, 630, 645]);
  const sz = await (await get(e, `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&kollega=szegedi-botond&tol=${NAP}&ig=${NAP}`)).json();
  const kezdok = sz.napok[NAP].map((x) => x.kezd);
  assert.ok(!kezdok.includes('10:00') && !kezdok.includes('09:15'));
  assert.ok(kezdok.includes('09:00') && kezdok.includes('11:00'));
});

test('két párhuzamos foglalás ugyanarra: egy 201, egy 409, egy foglalás marad', async () => {
  const e = ujEnv();
  const [a, b] = await Promise.all([
    post(e, '/foglalas-api/foglalas', alap({ nev: 'David teszt' })),
    post(e, '/foglalas-api/foglalas', alap({ nev: 'David teszt' }), { ip: '5.6.7.8' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const vesztes = a.status === 409 ? a : b;
  assert.equal((await vesztes.json()).error, 'Ezt az időpontot közben lefoglalták. Kérjük, válassz másikat.');
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM bookings')[0].n, 1);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM outbox')[0].n, 2);
});

test('átfedő, de nem azonos időpont is ütközik (10:00 után 10:30)', async () => {
  const e = ujEnv();
  assert.equal((await post(e, '/foglalas-api/foglalas', alap())).status, 201);
  assert.equal((await post(e, '/foglalas-api/foglalas', alap({ kezd: '10:30' }))).status, 409);
  assert.equal((await post(e, '/foglalas-api/foglalas', alap({ kezd: '11:00' }))).status, 201);
});

test('„bárki”: párhuzamosan két kolléga osztozik a 12:00-n, a harmadik 409', async () => {
  const e = ujEnv();
  const b = alap({ szolgaltatas: 'gyogytorna', kollega: 'barki', kezd: '12:00' });
  const rs = await Promise.all([1, 2, 3].map((i) => post(e, '/foglalas-api/foglalas', b, { ip: `9.9.9.${i}` })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 201, 409]);
  const kollegak = sorok(e, 'SELECT staff_id FROM bookings ORDER BY staff_id').map((x) => x.staff_id);
  assert.deepEqual(kollegak, ['kodacsine-labancz-agnes', 'vas-luca']);
});

test('ellenőrzés: hozzájárulás, e-mail, rács, ismeretlen szolgáltatás 400; beosztáson kívül 409', async () => {
  const e = ujEnv();
  const p = (o) => post(e, '/foglalas-api/foglalas', alap(o));
  assert.equal((await p({ hozzajarul: false })).status, 400);
  assert.equal((await p({ hozzajarul: 'true' })).status, 400);
  assert.equal((await p({ email: 'nem-email' })).status, 400);
  assert.equal((await p({ nev: ' ' })).status, 400);
  assert.equal((await p({ telefon: 'abc' })).status, 400);
  assert.equal((await p({ kezd: '10:10' })).status, 400);
  assert.equal((await p({ szolgaltatas: 'nincs' })).status, 400);
  assert.equal((await p({ megjegyzes: 'x'.repeat(1001) })).status, 400);
  const kivul = await p({ kezd: '06:00' });
  assert.equal(kivul.status, 409);
  assert.match((await kivul.json()).error, /nem foglalható/);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM bookings')[0].n, 0);
});

test('idegen Origin vagy Origin nélkül 403, nem JSON 415', async () => {
  const e = ujEnv();
  assert.equal((await post(e, '/foglalas-api/foglalas', alap(), { origin: 'https://gonosz.example' })).status, 403);
  assert.equal((await post(e, '/foglalas-api/foglalas', alap(), { origin: null })).status, 403);
  const r = await publikus({ env: e, request: new Request(ORIGIN + '/foglalas-api/foglalas', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: 'x' }) });
  assert.equal(r.status, 415);
});

test('honeypot: kitöltött `web` mező 200-at ad, de semmi nem mentődik', async () => {
  const e = ujEnv();
  const r = await post(e, '/foglalas-api/foglalas', alap({ web: 'http://spam.example' }));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.azonosito, undefined);
  // a honeypot ágon még a séma sem jön létre: semmi nem íródik az adatbázisba
  assert.equal(sorok(e, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")[0].n, 0);
  // meglévő adatbázisnál sem ment semmit
  assert.equal((await post(e, '/foglalas-api/foglalas', alap())).status, 201);
  assert.equal((await post(e, '/foglalas-api/foglalas', alap({ kezd: '12:00', web: 'x' }))).status, 200);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM bookings')[0].n, 1);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM outbox')[0].n, 2);
  assert.equal(sorok(e, 'SELECT SUM(n) AS n FROM foglalas_korlat')[0].n, 1);
});

test('napi IP-korlát: a 21. foglalási kísérlet 429, másik IP-ről megy tovább', async () => {
  const e = ujEnv();
  for (let i = 0; i < 20; i++) {
    assert.equal((await post(e, '/foglalas-api/foglalas', alap({ kezd: '06:00' }), { ip: '7.7.7.7' })).status, 409);
  }
  assert.equal((await post(e, '/foglalas-api/foglalas', alap(), { ip: '7.7.7.7' })).status, 429);
  assert.equal((await post(e, '/foglalas-api/foglalas', alap(), { ip: '8.8.8.8' })).status, 201);
  // nyers IP nem kerül tárolásra
  assert.ok(!JSON.stringify(sorok(e, 'SELECT * FROM foglalas_korlat')).includes('7.7.7.7'));
});

// ---------------------------------------------------------------- lemondás

test('lemondás tokennel: GET adatot ad (nem mond le), POST lemond, a hely újra szabad, levél az outboxba', async () => {
  const e = ujEnv();
  const d = await (await post(e, '/foglalas-api/foglalas', alap())).json();
  const t = tokenBol(d.lemondasUrl);
  const g = await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`);
  assert.equal(g.status, 200);
  const gd = await g.json();
  assert.equal(gd.allapot, 'megerositett');
  assert.equal(gd.lemondhato, true);
  assert.equal(gd.azonosito, d.azonosito);
  assert.equal(gd.foglalas.szolgaltatas.nev, 'Gyógymasszázs');
  assert.equal(sorok(e, "SELECT status FROM bookings")[0].status, 'megerositett');

  const p = await post(e, '/foglalas-api/lemondas', { t });
  assert.equal(p.status, 200);
  assert.equal((await p.json()).allapot, 'lemondva');
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 0);
  assert.deepEqual(sorok(e, "SELECT cimzett FROM outbox WHERE tipus = 'lemondas'").map((x) => x.cimzett), ['david.teszt@example.com']);
  // egyszer használható: másodszor 410, és nem megy ki második levél
  assert.equal((await post(e, '/foglalas-api/lemondas', { t })).status, 410);
  assert.equal(sorok(e, "SELECT COUNT(*) AS n FROM outbox WHERE tipus = 'lemondas'")[0].n, 1);
  assert.equal((await (await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`)).json()).allapot, 'lemondva');
  // ugyanaz az időpont újra foglalható
  assert.equal((await post(e, '/foglalas-api/foglalas', alap())).status, 201);
});

test('két párhuzamos lemondás: egy 200, egy 410, egy lemondó levél', async () => {
  const e = ujEnv();
  const t = tokenBol((await (await post(e, '/foglalas-api/foglalas', alap())).json()).lemondasUrl);
  const rs = await Promise.all([post(e, '/foglalas-api/lemondas', { t }), post(e, '/foglalas-api/lemondas', { t })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 410]);
  assert.equal(sorok(e, "SELECT COUNT(*) AS n FROM outbox WHERE tipus = 'lemondas'")[0].n, 1);
});

test('rossz token 404: hamisított aláírás, más titok, szemét', async () => {
  const e = ujEnv();
  const t = tokenBol((await (await post(e, '/foglalas-api/foglalas', alap())).json()).lemondasUrl);
  const [id, sig] = t.split('.');
  const hamis = `${id}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  for (const x of [hamis, `${id}`, 'szemet', '', `${id}.${sig}.x`]) {
    assert.equal((await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(x)}`)).status, 404, x);
    assert.equal((await post(e, '/foglalas-api/lemondas', { t: x })).status, 404, x);
  }
  // más titokkal aláírt token sem jó
  const e2 = { ...e, BOOKING_SECRET: 'masik-titok-'.padEnd(48, 'y') };
  assert.equal((await get(e2, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`)).status, 404);
  assert.equal(sorok(e, "SELECT status FROM bookings")[0].status, 'megerositett');
});

test('lejárt token (az időpont már elmúlt): GET és POST 410', async () => {
  const e = ujEnv();
  const t = tokenBol((await (await post(e, '/foglalas-api/foglalas', alap())).json()).lemondasUrl);
  e.BOOKING_DB._raw.prepare('UPDATE bookings SET date = ?').run(datumPlusz(budapestMost().datum, -1));
  assert.equal((await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`)).status, 410);
  assert.equal((await post(e, '/foglalas-api/lemondas', { t })).status, 410);
});

test('24 órán belül a link nem mond le: 409, a hibában a telefonszám', async () => {
  const e = ujEnv();
  const t = tokenBol((await (await post(e, '/foglalas-api/foglalas', alap())).json()).lemondasUrl);
  const m = budapestMost(Date.now() + 5 * 3600e3);
  e.BOOKING_DB._raw.prepare('UPDATE bookings SET date = ?, start_min = ?').run(m.datum, Math.floor(m.perc / 15) * 15);
  const g = await (await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`)).json();
  assert.equal(g.lemondhato, false);
  assert.ok(g.telefon);
  const p = await post(e, '/foglalas-api/lemondas', { t });
  assert.equal(p.status, 409);
  const pd = await p.json();
  assert.match(pd.error, /24 órán belül/);
  assert.ok(pd.telefon);
  assert.equal(sorok(e, "SELECT status FROM bookings")[0].status, 'megerositett');
});

test('lemondás idegen Originről 403', async () => {
  const e = ujEnv();
  const t = tokenBol((await (await post(e, '/foglalas-api/foglalas', alap())).json()).lemondasUrl);
  assert.equal((await post(e, '/foglalas-api/lemondas', { t }, { origin: 'https://gonosz.example' })).status, 403);
});

test('BOOKING_SECRET nélkül a D1-ben tárolt véletlen titokkal működik, a token stabil', async () => {
  const e = ujEnv({ BOOKING_SECRET: undefined });
  const d = await (await post(e, '/foglalas-api/foglalas', alap())).json();
  const t = tokenBol(d.lemondasUrl);
  assert.equal((await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`)).status, 200);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM titkok')[0].n, 1);
});

// ---------------------------------------------------------------- .ics

test('.ics: text/calendar, UTC idő, CRLF sorvég; rossz tokenre 404', async () => {
  const e = ujEnv();
  const d = await (await post(e, '/foglalas-api/foglalas', alap())).json();
  const r = await get(e, new URL(d.ics).pathname + new URL(d.ics).search);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /^text\/calendar/);
  const s = await r.text();
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(s.includes('BEGIN:VEVENT\r\n'));
  const nyar = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Budapest', timeZoneName: 'shortOffset' }).formatToParts(new Date(`${NAP}T12:00:00Z`)).find((x) => x.type === 'timeZoneName').value.replace('GMT', ''));
  const utcOra = String(10 - nyar).padStart(2, '0');
  assert.ok(s.includes(`DTSTART:${NAP.replace(/-/g, '')}T${utcOra}0000Z`), s);
  assert.ok(s.includes(`DTEND:${NAP.replace(/-/g, '')}T${utcOra}5000Z`));
  assert.ok(!/[^\r]\n/.test(s));
  assert.equal((await get(e, '/foglalas-api/foglalas.ics?t=rossz')).status, 404);
});

// ---------------------------------------------------------------- admin

test('admin végpont Access nélkül (éles host): 401, a router nem fut', async () => {
  let futott = false;
  const request = new Request('https://f360-legujabb.pages.dev/api/foglalo/foglalasok');
  const context = { request, env: { ...ujEnv(), ACCESS_TEAM_DOMAIN: 'https://x.cloudflareaccess.com', ACCESS_AUD: 'a' }, data: {}, params: {} };
  context.next = async () => { futott = true; return new Response('{}'); };
  const r = await middleware(context);
  assert.equal(r.status, 401);
  assert.equal(futott, false);
});

test('admin: kötés nélkül 503', async () => {
  assert.equal((await admin({}, 'GET', '/api/foglalo/foglalasok')).status, 503);
});

test('admin beállítások: GET, PUT árváltozás megjelenik a katalógusban, hibás hivatkozás 400', async () => {
  const e = ujEnv();
  const b = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(b.minta, true);
  b.szolgaltatasok.find((s) => s.id === 'gyogymasszazs-50').ar = 14000;
  const p = await admin(e, 'PUT', '/api/foglalo/beallitasok', b);
  assert.equal(p.status, 200);
  const k = await (await get(e, '/foglalas-api/katalogus')).json();
  assert.equal(k.szolgaltatasok.find((s) => s.id === 'gyogymasszazs-50').ar, 14000);
  const rossz = structuredClone(b);
  rossz.szolgaltatasok[0].helyszinek = ['nincs-ilyen'];
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', rossz)).status, 400);
  const rossz2 = structuredClone(b);
  rossz2.szolgaltatasok[0].perc = 7;
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', rossz2)).status, 400);
});

test('admin beosztás: GET kollégánként, PUT felülírja, a szabad időpontok követik', async () => {
  const e = ujEnv();
  const g = await (await admin(e, 'GET', '/api/foglalo/beosztas?kollega=szegedi-botond')).json();
  assert.ok(g.sorok.some((s) => s.nap === 1 && s.helyszin === 'mexikoi'));
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/beallitasok', { kinalas: 15 })).status, 200); // negyedórás kínálás
  const p = await admin(e, 'PUT', '/api/foglalo/beosztas?kollega=szegedi-botond', { sorok: [{ nap: 1, helyszin: 'mexikoi', kezd: '14:00', veg: '16:00' }] });
  assert.equal(p.status, 200);
  const sz = await (await get(e, `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&kollega=szegedi-botond&tol=${NAP}&ig=${NAP}`)).json();
  assert.deepEqual(sz.napok[NAP].map((x) => x.kezd), ['14:00', '14:15', '14:30', '14:45', '15:00']);
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beosztas?kollega=szegedi-botond', { sorok: [{ nap: 8, helyszin: 'mexikoi', kezd: '14:00', veg: '16:00' }] })).status, 400);
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beosztas?kollega=nincs', { sorok: [] })).status, 400);
});

test('admin kivételek: POST után a nap üres, DELETE után újra szabad', async () => {
  const e = ujEnv();
  const url = `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&kollega=szegedi-botond&tol=${NAP}&ig=${NAP}`;
  const p = await admin(e, 'POST', '/api/foglalo/kivetelek', { kollega: 'szegedi-botond', tol: NAP, ig: NAP, megjegyzes: 'szabadság' });
  assert.equal(p.status, 201);
  const { id } = await p.json();
  assert.deepEqual((await (await get(e, url)).json()).napok[NAP], []);
  const lista = await (await admin(e, 'GET', '/api/foglalo/kivetelek')).json();
  assert.equal(lista.kivetelek.length, 1);
  assert.equal((await admin(e, 'DELETE', `/api/foglalo/kivetelek?id=${id}`)).status, 200);
  assert.ok((await (await get(e, url)).json()).napok[NAP].length > 0);
  assert.equal((await admin(e, 'POST', '/api/foglalo/kivetelek', { tol: NAP, ig: NAP })).status, 400);
});

test('admin foglalások: lista, kézi felvétel (ütközés 409), lemondás azonosítóval', async () => {
  const e = ujEnv();
  await post(e, '/foglalas-api/foglalas', alap());
  const k = await admin(e, 'POST', '/api/foglalo/foglalasok', { ...alap({ kezd: '12:00', email: '' }), hozzajarul: undefined });
  assert.equal(k.status, 201);
  const kd = await k.json();
  assert.equal((await admin(e, 'POST', '/api/foglalo/foglalasok', alap({ kezd: '12:30' }))).status, 409);
  const l = await (await admin(e, 'GET', `/api/foglalo/foglalasok?tol=${NAP}&ig=${NAP}&helyszin=mexikoi`)).json();
  assert.equal(l.foglalasok.length, 2);
  assert.deepEqual(l.foglalasok.map((x) => x.kezd), ['10:00', '12:00']);
  assert.equal(l.foglalasok[1].forras, 'admin');
  const c = await admin(e, 'POST', `/api/foglalo/foglalasok/${kd.azonosito}/lemondas`, {});
  assert.equal(c.status, 200);
  assert.equal((await admin(e, 'POST', `/api/foglalo/foglalasok/${kd.azonosito}/lemondas`, {})).status, 410);
  assert.equal((await admin(e, 'POST', '/api/foglalo/foglalasok/FNINCSILYEN0/lemondas', {})).status, 404);
  assert.equal((await admin(e, 'POST', '/api/foglalo/foglalasok', alap({ kezd: '12:30' }))).status, 201);
});

test('admin outbox: az elkészült, el nem küldött levelek előnézettel', async () => {
  const e = ujEnv();
  await post(e, '/foglalas-api/foglalas', alap({ nev: 'David teszt <script>alert(1)</script>' }));
  const o = await (await admin(e, 'GET', '/api/foglalo/outbox')).json();
  assert.equal(o.mod, 'outbox');
  assert.equal(o.levelek.length, 2);
  const v = o.levelek.find((x) => x.tipus === 'visszaigazolas');
  assert.equal(v.elkuldve, false);
  assert.ok(v.html.includes('&lt;script&gt;'));
  assert.ok(!v.html.includes('<script>'));
  assert.ok(v.szoveg.length > 50);
  assert.ok(v.ics.includes('BEGIN:VEVENT'));
});
