// Időpontfoglaló · foglalás módosítása (páciens tokennel, admin áthelyezés), valódi SQLite-tal
//
//   POST  /foglalas-api/modositas            { t, datum, kezd, kollega }
//   GET   /foglalas-api/szabad?t=...         a saját foglalás ideje szabadnak számít
//   PATCH /api/foglalo/foglalasok/:id        { datum, kezd, kollega }  (határidő nélkül)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import { onRequest as publikus } from '../functions/foglalas-api/[[utvonal]].js';
import { onRequest as adminRouter } from '../functions/api/foglalo/[[utvonal]].js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { budapestMost, datumPlusz, hetNapja } from '../functions/_lib/booking/ido.js';

const ORIGIN = 'https://foglalo.f360-legujabb.pages.dev';
const SECRET = 'teszt-titok-'.padEnd(48, 'x');

function ujEnv(extra = {}) { return { BOOKING_DB: fakeD1(), BOOKING_SECRET: SECRET, ...extra }; }

function keres(env, method, path, { body, origin = ORIGIN, ip = '1.2.3.4' } = {}) {
  const h = { 'CF-Connecting-IP': ip };
  if (origin) h.Origin = origin;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const request = new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return publikus({ request, env, params: {}, data: {} });
}
const get = (env, path, o) => keres(env, 'GET', path, o);
const post = (env, path, body, o = {}) => keres(env, 'POST', path, { ...o, body });

function admin(env, method, path, body) {
  const url = 'http://127.0.0.1:8788' + path;
  const headers = { Origin: 'http://127.0.0.1:8788' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const context = { request, env: { ...env, DEV_EMAIL: 'david@teszt.hu' }, data: {}, params: {} };
  context.next = () => adminRouter(context);
  return middleware(context);
}

function celHetfo() {
  let d = datumPlusz(budapestMost().datum, 3);
  while (hetNapja(d) !== 1) d = datumPlusz(d, 1);
  return d;
}
const NAP = celHetfo();
const HETFO2 = datumPlusz(NAP, 7);
const alap = (o = {}) => ({
  helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: NAP, kezd: '10:00',
  nev: 'Minta Vendég', email: 'vendeg@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true, ...o,
});
const tokenBol = (url) => new URL(url).searchParams.get('t');
const sorok = (env, sql, ...a) => env.BOOKING_DB._raw.prepare(sql).all(...a);
const zarak = (env, id) => sorok(env, 'SELECT staff_id, date, slot_min FROM slot_locks WHERE booking_id = ? ORDER BY slot_min', id)
  .map((x) => `${x.staff_id}|${x.date}|${x.slot_min}`);
const foglalasRow = (env, id) => ({ ...sorok(env, 'SELECT staff_id, date, start_min, status FROM bookings WHERE id = ?', id)[0] });

async function foglalj(env, o = {}, ip = '1.2.3.4') {
  const r = await post(env, '/foglalas-api/foglalas', alap(o), { ip });
  assert.equal(r.status, 201);
  const d = await r.json();
  return { ...d, t: tokenBol(d.lemondasUrl) };
}
const modosit = (env, body, o) => post(env, '/foglalas-api/modositas', body, o);

// ---------------------------------------------------------------- sikeres módosítás

test('módosítás: 200, ugyanaz az azonosító és token, a zárak cserélődnek, két levél az outboxba', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  const r = await modosit(e, { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.modositva, true);
  assert.equal(d.azonosito, f.azonosito);
  assert.equal(d.lemondasUrl, f.lemondasUrl);
  assert.equal(d.ics, f.ics);
  assert.equal(d.foglalas.kezd, '12:00');
  assert.equal(d.foglalas.veg, '12:50');
  assert.equal(d.foglalas.kollega.id, 'szegedi-botond');
  assert.equal(d.foglalas.email, undefined); // publikus nézet
  assert.match(d.level.targy, /módos/i);
  assert.ok(d.level.html.includes('12:00'));
  assert.ok(d.level.html.includes('10:00')); // a régi időpont is szerepel
  // a zárak az új időpontra kerültek (50 perc + 10 puffer = 4 rácspont)
  assert.deepEqual(zarak(e, f.azonosito), [720, 735, 750, 765].map((s) => `szegedi-botond|${NAP}|${s}`));
  assert.deepEqual(foglalasRow(e, f.azonosito), { staff_id: 'szegedi-botond', date: NAP, start_min: 720, status: 'megerositett' });
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM bookings')[0].n, 1);
  // levelek: páciens + stúdió, a páciensé .ics-szel; semmi nem ment ki
  const ob = sorok(e, "SELECT tipus, cimzett, ics, sent FROM outbox WHERE tipus IN ('modositas', 'studio-modositas') ORDER BY tipus");
  assert.deepEqual(ob.map((x) => [x.tipus, x.sent]), [['modositas', 0], ['studio-modositas', 0]]);
  assert.equal(ob[0].cimzett, 'vendeg@example.com');
  assert.ok(ob[0].ics.includes('BEGIN:VEVENT'));
  assert.ok(ob[1].cimzett);
  // a régi 10:00 újra szabad, a token továbbra is működik és az új időpontot mutatja
  assert.equal((await post(e, '/foglalas-api/foglalas', alap({ nev: 'Más' }), { ip: '2.2.2.2' })).status, 201);
  const info = await (await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(f.t)}`)).json();
  assert.equal(info.foglalas.kezd, '12:00');
  assert.equal(info.modosithato, true);
  const ics = await (await get(e, `/foglalas-api/foglalas.ics?t=${encodeURIComponent(f.t)}`)).text();
  assert.ok(ics.includes(`UID:${f.azonosito}@`));
  // a módosított foglalás tokennel lemondható, a zárai felszabadulnak
  assert.equal((await post(e, '/foglalas-api/lemondas', { t: f.t })).status, 200);
  assert.deepEqual(zarak(e, f.azonosito), []);
});

test('módosítás a saját időpontjával átfedő időre (10:00 → 10:30) és másik napra, másik kollégához', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  assert.equal((await modosit(e, { t: f.t, datum: NAP, kezd: '10:30', kollega: 'szegedi-botond' })).status, 200);
  assert.deepEqual(zarak(e, f.azonosito), [630, 645, 660, 675].map((s) => `szegedi-botond|${NAP}|${s}`));
  // „bárki”: a következő hétfőn bárki, aki ezt végzi a Mexikóiban
  const r = await modosit(e, { t: f.t, datum: HETFO2, kezd: '11:00', kollega: 'barki' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.foglalas.datum, HETFO2);
  assert.equal(zarak(e, f.azonosito).length, 4);
  assert.ok(zarak(e, f.azonosito).every((z) => z.includes(`|${HETFO2}|`)));
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 4);
});

// ---------------------------------------------------------------- ütközés, szabályok

test('foglalt új időpont: 409, a régi foglalás és a zárai érintetlenek, nincs új levél', async () => {
  const e = ujEnv();
  const a = await foglalj(e);
  await foglalj(e, { kezd: '12:00', nev: 'Másik' }, '2.2.2.2');
  const elotte = sorok(e, 'SELECT COUNT(*) AS n FROM outbox')[0].n;
  const r = await modosit(e, { t: a.t, datum: NAP, kezd: '12:30', kollega: 'szegedi-botond' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /nem foglalható|lefoglalták/);
  assert.deepEqual(foglalasRow(e, a.azonosito), { staff_id: 'szegedi-botond', date: NAP, start_min: 600, status: 'megerositett' });
  assert.deepEqual(zarak(e, a.azonosito), [600, 615, 630, 645].map((s) => `szegedi-botond|${NAP}|${s}`));
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM outbox')[0].n, elotte);
});

test('a lemondási határon belül 409 a telefonszámmal; a foglalás nem változik', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  const m = budapestMost(Date.now() + 5 * 3600e3);
  e.BOOKING_DB._raw.prepare('UPDATE bookings SET date = ?, start_min = ?').run(m.datum, Math.floor(m.perc / 15) * 15);
  const r = await modosit(e, { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' });
  assert.equal(r.status, 409);
  const d = await r.json();
  assert.match(d.error, /24 órán belül/);
  assert.ok(d.telefon);
  assert.equal((await (await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(f.t)}`)).json()).modosithato, false);
  assert.equal(foglalasRow(e, f.azonosito).date, m.datum);
});

test('lemondott foglalás 410, elmúlt 410, rossz token 404', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  const body = { datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' };
  const [id, sig] = f.t.split('.');
  const hamis = `${id}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  for (const t of [hamis, 'szemet', '', id]) assert.equal((await modosit(e, { ...body, t })).status, 404, t);
  assert.equal((await modosit(e, { ...body, t: 123 })).status, 404);

  const g = await foglalj(e, { kezd: '14:00' }, '3.3.3.3');
  e.BOOKING_DB._raw.prepare('UPDATE bookings SET date = ? WHERE id = ?').run(datumPlusz(budapestMost().datum, -1), g.azonosito);
  assert.equal((await modosit(e, { ...body, t: g.t })).status, 410);

  assert.equal((await post(e, '/foglalas-api/lemondas', { t: f.t })).status, 200);
  const r = await modosit(e, { ...body, t: f.t });
  assert.equal(r.status, 410);
  assert.match((await r.json()).error, /lemondták/);
  assert.equal(foglalasRow(e, f.azonosito).status, 'lemondva');
  assert.deepEqual(zarak(e, f.azonosito), []);
});

test('az új időpontra a minEloreOra és a maxEloreNap érvényes; hibás bemenet 400; idegen Origin 403', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  // maxEloreNap (60) utáni hétfő
  let tavol = datumPlusz(budapestMost().datum, 61);
  while (hetNapja(tavol) !== 1) tavol = datumPlusz(tavol, 1);
  const r = await modosit(e, { t: f.t, datum: tavol, kezd: '10:00', kollega: 'szegedi-botond' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /nem foglalható/);
  // minEloreOra: a holnaputáni-közeli első H/Sze/P 12:00 (Botond a Mexikóiban) 168 órás előrefoglalással nem fér bele
  let kozel = datumPlusz(budapestMost().datum, 1);
  while (![1, 3, 5].includes(hetNapja(kozel))) kozel = datumPlusz(kozel, 1);
  const torzs = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...torzs, szabalyok: { ...torzs.szabalyok, minEloreOra: 168 } })).status, 200);
  const kozelR = await modosit(e, { t: f.t, datum: kozel, kezd: '12:00', kollega: 'szegedi-botond' });
  assert.equal(kozelR.status, 409);
  assert.match((await kozelR.json()).error, /nem foglalható/);
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', torzs)).status, 200);
  for (const b of [{ datum: '2026-02-30', kezd: '10:00' }, { datum: NAP, kezd: '10:10' }, { datum: NAP, kezd: '10:00', kollega: 5 }, { datum: NAP, kezd: '10:00', kollega: 'nincs-ilyen' }]) {
    assert.equal((await modosit(e, { kollega: 'szegedi-botond', ...b, t: f.t })).status, 400, JSON.stringify(b));
  }
  // ugyanaz az időpont: 400, nincs levél
  const ugyanaz = await modosit(e, { t: f.t, datum: NAP, kezd: '10:00', kollega: 'szegedi-botond' });
  assert.equal(ugyanaz.status, 400);
  assert.equal((await modosit(e, { t: f.t, datum: NAP, kezd: '12:00' }, { origin: 'https://gonosz.example' })).status, 403);
  assert.deepEqual(foglalasRow(e, f.azonosito), { staff_id: 'szegedi-botond', date: NAP, start_min: 600, status: 'megerositett' });
  assert.equal(sorok(e, "SELECT COUNT(*) AS n FROM outbox WHERE tipus LIKE '%modositas'")[0].n, 0);
});

// ---------------------------------------------------------------- párhuzamosság

test('párhuzamos módosítás és új foglalás ugyanarra a slotra: csak egy nyer, az adat konzisztens', async () => {
  for (let i = 0; i < 6; i++) {
    const e = ujEnv();
    const a = await foglalj(e);
    const [m, b] = await Promise.all([
      modosit(e, { t: a.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' }),
      post(e, '/foglalas-api/foglalas', alap({ kezd: '12:00', nev: 'Versenyző' }), { ip: '4.4.4.4' }),
    ]);
    assert.ok([200, 409].includes(m.status) && [201, 409].includes(b.status), `${m.status} ${b.status}`);
    const nyertes = [m.status === 200, b.status === 201].filter(Boolean).length;
    assert.equal(nyertes, 1, `${m.status} ${b.status}`);
    // minden élő foglalásnak pontosan 4 zárja van, és mindegyik a saját foglalása idejét fedi
    const elo = sorok(e, "SELECT COUNT(*) AS n FROM bookings WHERE status = 'megerositett'")[0].n;
    const zarSorok = sorok(e, 'SELECT s.slot_min, b.start_min FROM slot_locks s JOIN bookings b ON b.id = s.booking_id');
    assert.equal(zarSorok.length, 4 * elo);
    assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 4 * elo);
    assert.ok(zarSorok.every((z) => z.slot_min >= z.start_min && z.slot_min < z.start_min + 60));
    const aRow = foglalasRow(e, a.azonosito);
    assert.equal(aRow.start_min, m.status === 200 ? 720 : 600);
  }
});

test('két párhuzamos módosítás ugyanarra a foglalásra: egy 200, egy 409, a zárak a nyertes időpontját fedik', async () => {
  const e = ujEnv();
  const a = await foglalj(e);
  const rs = await Promise.all([
    modosit(e, { t: a.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' }),
    modosit(e, { t: a.t, datum: NAP, kezd: '14:00', kollega: 'szegedi-botond' }, { ip: '6.6.6.6' }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const row = foglalasRow(e, a.azonosito);
  assert.deepEqual(zarak(e, a.azonosito), [0, 15, 30, 45].map((p) => `szegedi-botond|${NAP}|${row.start_min + p}`));
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 4);
  assert.equal(sorok(e, "SELECT COUNT(*) AS n FROM outbox WHERE tipus = 'modositas'")[0].n, 1);
});

test('párhuzamos módosítás és lemondás: a foglalás vagy lemondva zár nélkül, vagy módosítva 4 zárral', async () => {
  for (let i = 0; i < 4; i++) {
    const e = ujEnv();
    const a = await foglalj(e);
    const [m, l] = await Promise.all([
      modosit(e, { t: a.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' }),
      post(e, '/foglalas-api/lemondas', { t: a.t }),
    ]);
    assert.equal(l.status, 200);
    assert.ok([200, 410].includes(m.status), String(m.status));
    assert.equal(foglalasRow(e, a.azonosito).status, 'lemondva');
    assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 0);
  }
});

// ---------------------------------------------------------------- szabad időpontok tokennel

test('szabad ?t=: a saját foglalás ideje szabadnak számít; helyszín és szolgáltatás a foglalásból jön', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  await foglalj(e, { kezd: '12:00', nev: 'Másik' }, '2.2.2.2');
  const q = `kollega=szegedi-botond&tol=${NAP}&ig=${NAP}`;
  const nelkul = await (await get(e, `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&${q}`)).json();
  assert.ok(!nelkul.napok[NAP].some((s) => s.kezd === '10:00'));
  const r = await get(e, `/foglalas-api/szabad?t=${encodeURIComponent(f.t)}&${q}`);
  assert.equal(r.status, 200);
  const kezdok = (await r.json()).napok[NAP].map((s) => s.kezd);
  assert.ok(kezdok.includes('10:00') && kezdok.includes('10:30'));
  assert.ok(!kezdok.includes('12:00')); // a másik foglalás továbbra is foglalt
  // egyező helyszín és szolgáltatás megadható, eltérő 400
  assert.equal((await get(e, `/foglalas-api/szabad?t=${encodeURIComponent(f.t)}&helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&${q}`)).status, 200);
  assert.equal((await get(e, `/foglalas-api/szabad?t=${encodeURIComponent(f.t)}&helyszin=reitter&${q}`)).status, 400);
  assert.equal((await get(e, `/foglalas-api/szabad?t=szemet&${q}`)).status, 404);
  assert.equal((await post(e, '/foglalas-api/lemondas', { t: f.t })).status, 200);
  assert.equal((await get(e, `/foglalas-api/szabad?t=${encodeURIComponent(f.t)}&${q}`)).status, 410);
});

// ---------------------------------------------------------------- admin áthelyezés

test('admin PATCH: a lemondási határon belül is áthelyez, ütközésre 409, lemondottra 410, ismeretlenre 404', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  await foglalj(e, { kezd: '14:00', nev: 'Másik' }, '2.2.2.2');
  const m = budapestMost(Date.now() + 5 * 3600e3);
  e.BOOKING_DB._raw.prepare('UPDATE bookings SET date = ?, start_min = ? WHERE id = ?').run(m.datum, Math.floor(m.perc / 15) * 15, f.azonosito);
  e.BOOKING_DB._raw.prepare('UPDATE slot_locks SET date = ? WHERE booking_id = ?').run(m.datum, f.azonosito);
  assert.equal((await modosit(e, { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' })).status, 409);

  // admin szabad: a határon belüli saját időpont is választható (minEloreOra nélkül), a saját idő szabad
  const sz = await admin(e, 'GET', `/api/foglalo/szabad?foglalas=${f.azonosito}&kollega=szegedi-botond&tol=${NAP}&ig=${NAP}`);
  assert.equal(sz.status, 200);
  const szKezdok = (await sz.json()).napok[NAP].map((x) => x.kezd);
  assert.ok(szKezdok.includes('12:00') && !szKezdok.includes('14:00'));
  assert.equal((await admin(e, 'GET', `/api/foglalo/szabad?foglalas=FNINCSILYEN0&tol=${NAP}&ig=${NAP}`)).status, 404);

  const r = await admin(e, 'PATCH', `/api/foglalo/foglalasok/${f.azonosito}`, { datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.modositva, true);
  assert.equal(d.azonosito, f.azonosito);
  assert.equal(d.lemondasUrl.split('?t=')[1], encodeURIComponent(f.t)); // ugyanaz a token
  assert.deepEqual(zarak(e, f.azonosito), [720, 735, 750, 765].map((s) => `szegedi-botond|${NAP}|${s}`));
  // admin áthelyezésnél csak a páciens kap levelet (ahogy a kézi felvételnél is)
  assert.deepEqual(sorok(e, "SELECT tipus FROM outbox WHERE tipus LIKE '%modositas'").map((x) => x.tipus), ['modositas']);

  assert.equal((await admin(e, 'PATCH', `/api/foglalo/foglalasok/${f.azonosito}`, { datum: NAP, kezd: '14:00', kollega: 'szegedi-botond' })).status, 409);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/foglalasok/FNINCSILYEN0', { datum: NAP, kezd: '16:00', kollega: 'szegedi-botond' })).status, 404);
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/foglalasok/${f.azonosito}`, { datum: NAP, kezd: '10:10' })).status, 400);
  assert.equal((await admin(e, 'POST', `/api/foglalo/foglalasok/${f.azonosito}/lemondas`, {})).status, 200);
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/foglalasok/${f.azonosito}`, { datum: NAP, kezd: '16:00', kollega: 'szegedi-botond' })).status, 410);
  assert.equal((await admin(e, 'GET', `/api/foglalo/foglalasok/${f.azonosito}`)).status, 405);
});

// ---------------------------------------------------------------- levelek

test('a visszaigazoló és a módosító levél gombja: „Időpont lemondása / módosítása” a tokenes linkre', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  const gombFelirat = 'Időpont lemondása / módosítása';
  const link = f.lemondasUrl.replace(/&/g, '&amp;');
  assert.ok(f.level.html.includes(`>${gombFelirat}</a>`));
  const d = await (await modosit(e, { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' })).json();
  assert.ok(d.level.html.includes(`>${gombFelirat}</a>`));
  assert.ok(d.level.html.includes(`href="${link}"`));
  assert.ok(d.level.szoveg.includes(f.lemondasUrl));
  const studio = sorok(e, "SELECT html FROM outbox WHERE tipus = 'studio-modositas'")[0].html;
  assert.ok(studio.includes('Minta Vendég') && studio.includes('12:00') && studio.includes('10:00'));
});

// ---------------------------------------------------------------- review-javítások

test('.ics: módosítás után ugyanaz a UID, de nagyobb SEQUENCE (a naptár frissít, nem duplikál)', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  const seq = (ics) => Number((/\r\nSEQUENCE:(\d+)\r\n/.exec(ics) || [])[1]);
  const elso = sorok(e, "SELECT ics FROM outbox WHERE tipus = 'visszaigazolas'")[0].ics;
  assert.ok(Number.isInteger(seq(elso)), 'van SEQUENCE');
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await modosit(e, { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' })).status, 200);
  const masodik = sorok(e, "SELECT ics FROM outbox WHERE tipus = 'modositas'")[0].ics;
  assert.ok(seq(masodik) > seq(elso), `${seq(masodik)} > ${seq(elso)}`);
  assert.equal(/UID:(\S+)/.exec(masodik)[1], /UID:(\S+)/.exec(elso)[1]);
});

test('lemondás elavult sorral (közben módosították): 409, a foglalás él, nem megy ki régi időpontos lemondó levél', async () => {
  const { lemond } = await import('../functions/_lib/booking/foglalas.js');
  const e = ujEnv();
  const f = await foglalj(e);
  const elavult = { ...sorok(e, 'SELECT * FROM bookings')[0] };
  assert.equal((await modosit(e, { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' })).status, 200);
  await assert.rejects(() => lemond(e, e.BOOKING_DB, elavult), (err) => err.status === 409 && /közben módosították/.test(err.message));
  assert.equal(foglalasRow(e, f.azonosito).status, 'megerositett');
  assert.equal(zarak(e, f.azonosito).length, 4);
  assert.equal(sorok(e, "SELECT COUNT(*) AS n FROM outbox WHERE tipus = 'lemondas'")[0].n, 0);
});
