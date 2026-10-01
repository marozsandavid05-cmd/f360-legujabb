// Időpontfoglaló · kollégánkénti szín (paletta, alapszín-kiosztás, adat-migráció, admin API)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import { onRequest as publikus } from '../functions/foglalas-api/[[utvonal]].js';
import { onRequest as adminRouter } from '../functions/api/foglalo/[[utvonal]].js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { PALETTA, szinKioszt, szinNormal } from '../functions/_lib/booking/szin.js';
import { SEED_TORZS } from '../functions/_lib/booking/seed.js';
import { torzsBetolt } from '../functions/_lib/booking/schema.js';
import { budapestMost, datumPlusz, hetNapja } from '../functions/_lib/booking/ido.js';

const ORIGIN = 'https://foglalo.f360-legujabb.pages.dev';
const SECRET = 'teszt-titok-'.padEnd(48, 'x');
const HEX = /^#[0-9a-f]{6}$/;

const ujEnv = () => ({ BOOKING_DB: fakeD1(), BOOKING_SECRET: SECRET });

function admin(env, method, path, body) {
  const url = 'http://127.0.0.1:8788' + path;
  const headers = { Origin: 'http://127.0.0.1:8788' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const context = { request, env: { ...env, DEV_EMAIL: 'david@teszt.hu' }, data: {}, params: {} };
  context.next = () => adminRouter(context);
  return middleware(context);
}
function foglalPublikus(env, body) {
  const request = new Request(ORIGIN + '/foglalas-api/foglalas', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return publikus({ request, env, params: {}, data: {} });
}
function celHetfo() {
  let d = datumPlusz(budapestMost().datum, 3);
  while (hetNapja(d) !== 1) d = datumPlusz(d, 1);
  return d;
}
const NAP = celHetfo();
const foglalas = (o = {}) => ({
  helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: NAP, kezd: '10:00',
  nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true, ...o,
});
const kollegaMinta = (n) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, nev: `Kolléga ${i}` }));

// ---------------------------------------------------------------- paletta és kiosztás

test('paletta: 10 különböző, kisbetűs #rrggbb szín', () => {
  assert.equal(PALETTA.length, 10);
  for (const p of PALETTA) assert.match(p.hex, HEX, p.nev);
  assert.equal(new Set(PALETTA.map((p) => p.hex)).size, 10);
});

test('szinNormal: #RRGGBB kisbetűsre, minden más null', () => {
  assert.equal(szinNormal('#4F6D8A'), '#4f6d8a');
  assert.equal(szinNormal(' #4f6d8a '), '#4f6d8a');
  for (const rossz of ['4f6d8a', '#fff', '#12345g', '#4f6d8a00', 'red', '', null, undefined, 123, {}]) {
    assert.equal(szinNormal(rossz), null, String(rossz));
  }
});

test('seed: minden MINTA kollégának saját, a palettából vett szín', () => {
  const szinek = SEED_TORZS.kollegak.map((k) => k.szin);
  for (const s of szinek) assert.ok(PALETTA.some((p) => p.hex === s), s);
  assert.equal(new Set(szinek).size, szinek.length);
});

test('kiosztás: 10 kollégáig mind különböző, ismétlődés csak a 11.-től', () => {
  const tiz = szinKioszt(kollegaMinta(10));
  assert.equal(new Set(tiz.map((k) => k.szin)).size, 10);
  const tizenketto = szinKioszt(kollegaMinta(12));
  assert.equal(new Set(tizenketto.slice(0, 10).map((k) => k.szin)).size, 10);
  for (const k of tizenketto) assert.match(k.szin, HEX);
  // a 11. és 12. a legkevésbé használt színt kapja, tehát kettő különböző
  assert.notEqual(tizenketto[10].szin, tizenketto[11].szin);
});

test('kiosztás: a meglévő szín marad, az új kolléga nem kap foglalt színt', () => {
  const lista = [
    { id: 'a', nev: 'A', szin: PALETTA[0].hex },
    { id: 'b', nev: 'B', szin: '#123456' },
    { id: 'c', nev: 'C' },
    { id: 'd', nev: 'D', szin: 'nem-szin' },
  ];
  const ki = szinKioszt(lista);
  assert.equal(ki[0].szin, PALETTA[0].hex);
  assert.equal(ki[1].szin, '#123456');
  assert.notEqual(ki[2].szin, PALETTA[0].hex);
  assert.notEqual(ki[3].szin, ki[2].szin);
  assert.ok(ki.every((k) => HEX.test(k.szin)));
  assert.equal(lista[2].szin, undefined, 'a bemenetet nem módosítja');
});

// ---------------------------------------------------------------- adat-migráció

test('migráció: a szín nélküli, már szerkesztett törzsadat színt kap, minden más adat megmarad', async () => {
  const db = fakeD1();
  // előbb a régi alakú adatbázis: séma + seed szín nélkül + szerkesztett ár + egy foglalás
  const env = { BOOKING_DB: db, BOOKING_SECRET: SECRET };
  assert.equal((await foglalPublikus(env, foglalas())).status, 201);
  const regi = JSON.parse(db._raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
  for (const k of regi.kollegak) delete k.szin;
  regi.szolgaltatasok.find((s) => s.id === 'gyogymasszazs-50').ar = 14100;
  regi.kollegak.push({ id: 'uj-kollega', nev: 'Új Kolléga', szerep: '', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'] });
  db._raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(regi));

  // új isolate (új kötés-objektum ugyanarra az adatra): a séma-gyorsítótár ne számítson
  const db2 = { ...db, prepare: db.prepare, batch: db.batch };
  const t = await torzsBetolt(db2);
  assert.equal(t.kollegak.length, regi.kollegak.length);
  for (const k of t.kollegak) assert.match(k.szin, HEX, k.id);
  assert.equal(new Set(t.kollegak.map((k) => k.szin)).size, t.kollegak.length);
  assert.equal(t.szolgaltatasok.find((s) => s.id === 'gyogymasszazs-50').ar, 14100);
  assert.deepEqual(t.kollegak.map((k) => k.id), regi.kollegak.map((k) => k.id));
  assert.equal(db._raw.prepare(`SELECT COUNT(*) AS n FROM bookings`).get().n, 1);
  assert.ok(db._raw.prepare(`SELECT COUNT(*) AS n FROM schedule`).get().n > 0);

  // a színek el vannak mentve, a második betöltés ugyanazt adja
  const mentett = JSON.parse(db._raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
  assert.deepEqual(mentett.kollegak.map((k) => k.szin), t.kollegak.map((k) => k.szin));
  assert.deepEqual((await torzsBetolt(db2)).kollegak.map((k) => k.szin), t.kollegak.map((k) => k.szin));
});

// ---------------------------------------------------------------- admin API

test('admin: a beállítások, a beosztás és a foglalás-lista visszaadja a kolléga színét', async () => {
  const e = ujEnv();
  assert.equal((await foglalPublikus(e, foglalas())).status, 201);
  const b = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const botond = b.kollegak.find((k) => k.id === 'szegedi-botond');
  assert.match(botond.szin, HEX);
  const bo = await (await admin(e, 'GET', '/api/foglalo/beosztas')).json();
  assert.equal(bo.kollegak.find((k) => k.id === 'szegedi-botond').szin, botond.szin);
  const l = await (await admin(e, 'GET', `/api/foglalo/foglalasok?tol=${NAP}&ig=${NAP}`)).json();
  assert.equal(l.foglalasok.length, 1);
  assert.equal(l.foglalasok[0].kollega.szin, botond.szin);
});

test('admin PATCH /kollegak: érvényes hex mentődik (kisbetűsre), hibás 400, ismeretlen kolléga 404', async () => {
  const e = ujEnv();
  const ok = await admin(e, 'PATCH', '/api/foglalo/kollegak?kollega=vas-luca', { szin: '#A0553C' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: 'vas-luca', szin: '#a0553c' });
  const b = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(b.kollegak.find((k) => k.id === 'vas-luca').szin, '#a0553c');

  for (const szin of ['piros', '#fff', '#12345g', '', null, 42]) {
    const r = await admin(e, 'PATCH', '/api/foglalo/kollegak?kollega=vas-luca', { szin });
    assert.equal(r.status, 400, String(szin));
    assert.match((await r.json()).error, /szín/i);
  }
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak?kollega=nincs-ilyen', { szin: '#a0553c' })).status, 404);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak', { szin: '#a0553c' })).status, 400);
  // a hibás kérések nem írták felül
  const b2 = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(b2.kollegak.find((k) => k.id === 'vas-luca').szin, '#a0553c');
});

test('admin PATCH /kollegak: ha közben más mentette a beállításokat, 409 és nem ír felül', async () => {
  const e = ujEnv();
  await admin(e, 'GET', '/api/foglalo/beallitasok'); // seed
  const db = e.BOOKING_DB;
  // a feltételes UPDATE előtt egy „másik admin” átírja a törzsadatot
  const koztes = {
    ...db,
    prepare: (sql) => {
      const st = db.prepare(sql);
      if (!/AND ertek = \?/.test(sql)) return st;
      return { ...st, bind: (...a) => {
        const b = st.bind(...a);
        return { ...b, run: async () => {
          const t = JSON.parse(db._raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
          t.szabalyok.telefon = '+36 1 000 0000';
          db._raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(t));
          return b.run();
        } };
      } };
    },
  };
  const r = await admin({ ...e, BOOKING_DB: koztes }, 'PATCH', '/api/foglalo/kollegak?kollega=vas-luca', { szin: '#3b4580' });
  assert.equal(r.status, 409);
  const t = JSON.parse(db._raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
  assert.equal(t.szabalyok.telefon, '+36 1 000 0000');
  assert.notEqual(t.kollegak.find((k) => k.id === 'vas-luca').szin, '#3b4580');
});

test('admin PUT /beallitasok: hibás szín 400, hiányzó szín esetén a régi marad, új kolléga szabad színt kap', async () => {
  const e = ujEnv();
  const b = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const regiSzinek = Object.fromEntries(b.kollegak.map((k) => [k.id, k.szin]));

  const rossz = structuredClone(b);
  rossz.kollegak[0].szin = 'kék';
  const r = await admin(e, 'PUT', '/api/foglalo/beallitasok', rossz);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /szín/i);

  const szinNelkul = structuredClone(b);
  for (const k of szinNelkul.kollegak) delete k.szin;
  szinNelkul.kollegak[0].szin = ''; // az üres mező a felületről: nincs megadva, a régi marad
  szinNelkul.kollegak.push({ id: 'uj-kollega', nev: 'Új Kolléga', szerep: '', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'] });
  const p = await admin(e, 'PUT', '/api/foglalo/beallitasok', szinNelkul);
  assert.equal(p.status, 200);
  const uj = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  for (const k of uj.kollegak.filter((x) => x.id !== 'uj-kollega')) assert.equal(k.szin, regiSzinek[k.id], k.id);
  const ujSzin = uj.kollegak.find((k) => k.id === 'uj-kollega').szin;
  assert.match(ujSzin, HEX);
  assert.ok(!Object.values(regiSzinek).includes(ujSzin));
});

test('nyilvános katalógus: a kolléga színe nem kerül ki (csak az adminban kell)', async () => {
  const e = ujEnv();
  const request = new Request(ORIGIN + '/foglalas-api/katalogus', { headers: { Origin: ORIGIN } });
  const k = await (await publikus({ request, env: e, params: {}, data: {} })).json();
  assert.ok(k.kollegak.length > 0);
  for (const x of k.kollegak) assert.equal(x.szin, undefined);
  // a vendég foglalás-válaszában és a lemondó nézetben sincs szín
  const f = await foglalPublikus(e, foglalas());
  assert.equal(f.status, 201);
  const fd = await f.json();
  assert.equal(fd.foglalas.kollega.szin, undefined);
  assert.equal(fd.foglalas.kollega.nev, 'Szegedi Botond');
});
