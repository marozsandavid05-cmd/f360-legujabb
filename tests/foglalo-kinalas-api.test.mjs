// Időpontfoglaló · a kínált kezdések beállítása az API-n át (valódi SQLite, D1-utánzat)
//   GET|PATCH /api/foglalo/beallitasok          szabalyok.kinalas: 'igazitott' (alap) | 15 | 30 | 60
//   PATCH     /api/foglalo/szolgaltatasok/:id   kinalas: null | 'igazitott' | 15 többszöröse 15 és 240 között
//   katalógus: a szolgáltatásnál a tényleges lépés (lepes, perc)
// A nyilvános foglalás és módosítás csak a felkínált kezdésre megy; az admin bármely 15 perces rácspontra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAP, admin, alap, foglalj, get, post, sorok, ujEnv } from './_foglalo.mjs';

const SZABAD = `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&kollega=szegedi-botond&tol=${NAP}&ig=${NAP}`;
const kezdok = async (e, url = SZABAD) => (await (await get(e, url)).json()).napok[NAP].map((s) => s.kezd);
const ORANKENT = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

test('alapból igazított: Szegedi Botond hétfő 9-17, 50 + 10 perces gyógymasszázs óránként', async () => {
  const e = ujEnv();
  assert.deepEqual(await kezdok(e), ORANKENT);
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t.szabalyok.kinalas, 'igazitott');
});

test('katalógus: a szolgáltatás tényleges lépése (lepes) percben', async () => {
  const e = ujEnv();
  const k = await (await get(e, '/foglalas-api/katalogus')).json();
  const lepes = (id) => k.szolgaltatasok.find((s) => s.id === id).lepes;
  assert.equal(lepes('gyogymasszazs-50'), 60);
  assert.equal(lepes('gyogymasszazs-90'), 105);
  assert.equal(lepes('inbody-770'), 30);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-50', { kinalas: 30 })).status, 200);
  assert.equal((await (await get(e, '/foglalas-api/katalogus')).json()).szolgaltatasok.find((s) => s.id === 'gyogymasszazs-50').lepes, 30);
});

test('PATCH beallitasok: globális 30, a szabad időpontok félóránként; rossz érték 400 és nem ment', async () => {
  const e = ujEnv();
  const r = await admin(e, 'PATCH', '/api/foglalo/beallitasok', { kinalas: 30 });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).szabalyok.kinalas, 30);
  const k = await kezdok(e);
  assert.equal(k[0], '09:00');
  assert.equal(k[1], '09:30');
  assert.equal(k.at(-1), '16:00');
  for (const rossz of [45, 0, 120, '30', 'barmi', null, 15.5]) {
    assert.equal((await admin(e, 'PATCH', '/api/foglalo/beallitasok', { kinalas: rossz })).status, 400, `kinalas: ${rossz}`);
  }
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/beallitasok', { minEloreOra: 1 })).status, 400); // csak a kinalas javítható így
  assert.equal((await admin(e, 'GET', '/api/foglalo/beallitasok').then((x) => x.json())).szabalyok.kinalas, 30);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/beallitasok', { kinalas: 'igazitott' })).status, 200);
  assert.deepEqual(await kezdok(e), ORANKENT);
});

test('PATCH szolgaltatasok/:id: egyedi felülírás, null örököl, rossz érték 400, ismeretlen 404', async () => {
  const e = ujEnv();
  await admin(e, 'PATCH', '/api/foglalo/beallitasok', { kinalas: 30 });
  const r = await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-50', { kinalas: 75 });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).kinalas, 75);
  assert.deepEqual(await kezdok(e), ['09:00', '10:15', '11:30', '12:45', '14:00', '15:15']);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-50', { kinalas: null })).status, 200);
  assert.equal((await kezdok(e))[1], '09:30'); // a globális 30-at követi
  for (const rossz of [70, 0, 255, 300, '60', 'x', 30.5, true]) {
    assert.equal((await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-50', { kinalas: rossz })).status, 400, `kinalas: ${rossz}`);
  }
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-50', { kinalas: 240 })).status, 200);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-50', { nev: 'más' })).status, 400);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/nincs-ilyen', { kinalas: 30 })).status, 404);
});

test('PUT beallitasok: a kinalas ellenőrzött, és a meg nem küldött érték megmarad', async () => {
  const e = ujEnv();
  await admin(e, 'PATCH', '/api/foglalo/beallitasok', { kinalas: 60 });
  await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-90', { kinalas: 120 });
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  // régi felület: kinalas nélkül küldi vissza
  const regi = structuredClone(t);
  delete regi.szabalyok.kinalas;
  regi.szolgaltatasok = regi.szolgaltatasok.map(({ kinalas: _k, ...s }) => s);
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', regi)).status, 200);
  const t2 = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t2.szabalyok.kinalas, 60);
  assert.equal(t2.szolgaltatasok.find((s) => s.id === 'gyogymasszazs-90').kinalas, 120);
  // rossz érték a PUT-ban is 400
  const rossz1 = structuredClone(t2);
  rossz1.szabalyok.kinalas = 45;
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', rossz1)).status, 400);
  const rossz2 = structuredClone(t2);
  rossz2.szolgaltatasok[0].kinalas = 70;
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', rossz2)).status, 400);
  // null küldve: törli a felülírást
  const nul = structuredClone(t2);
  nul.szolgaltatasok = nul.szolgaltatasok.map((s) => (s.id === 'gyogymasszazs-90' ? { ...s, kinalas: null } : s));
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', nul)).status, 200);
  const t3 = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t3.szolgaltatasok.find((s) => s.id === 'gyogymasszazs-90').kinalas ?? null, null);
});

test('nyilvános foglalás csak felkínált kezdésre: 10:15 409, 10:00 201', async () => {
  const e = ujEnv();
  assert.equal((await post(e, '/foglalas-api/foglalas', alap({ kezd: '10:15' }))).status, 409);
  assert.equal((await post(e, '/foglalas-api/foglalas', alap({ kezd: '10:00' }))).status, 201);
});

test('admin kézi felvétel bármely 15 perces rácspontra (10:15), az ütközés továbbra is 409', async () => {
  const e = ujEnv();
  // akkor is, ha a szolgáltatásnak saját (ritkább) kínálása van
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/szolgaltatasok/gyogymasszazs-50', { kinalas: 120 })).status, 200);
  const r = await admin(e, 'POST', '/api/foglalo/foglalasok', { ...alap({ kezd: '10:15', email: '' }), hozzajarul: undefined });
  assert.equal(r.status, 201, await r.clone().text());
  assert.equal((await admin(e, 'POST', '/api/foglalo/foglalasok', { ...alap({ kezd: '10:45', email: '' }), hozzajarul: undefined })).status, 409);
  // az admin áthelyezés-választója is 15 perces
  const sz = await (await admin(e, 'GET', `/api/foglalo/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&kollega=szegedi-botond&tol=${NAP}&ig=${NAP}`)).json();
  assert.ok(sz.napok[NAP].some((s) => s.kezd === '09:15'));
});

test('hézagkitöltés: egy 10:15-ös foglalás után a 11:15 felkínálódik és nyilvánosan foglalható', async () => {
  const e = ujEnv();
  await admin(e, 'POST', '/api/foglalo/foglalasok', { ...alap({ kezd: '10:15', email: '' }), hozzajarul: undefined });
  const k = await kezdok(e);
  // 09:00 + 50 + 10 perc = 10:00-ig zár, nem ütközik a 10:15-össel
  assert.deepEqual(k, ['09:00', '11:15', '12:00', '13:00', '14:00', '15:00', '16:00']);
  const r = await post(e, '/foglalas-api/foglalas', alap({ kezd: '11:15' }));
  assert.equal(r.status, 201, await r.clone().text());
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM slot_locks WHERE staff_id = 'szegedi-botond'`)[0].n, 8);
});

test('lemondás után a kínálat visszaáll az óránkénti rácsra', async () => {
  const e = ujEnv();
  const k = await admin(e, 'POST', '/api/foglalo/foglalasok', { ...alap({ kezd: '10:15', email: '' }), hozzajarul: undefined });
  const { azonosito } = await k.json();
  assert.notDeepEqual(await kezdok(e), ORANKENT);
  assert.equal((await admin(e, 'POST', `/api/foglalo/foglalasok/${azonosito}/lemondas`, {})).status, 200);
  assert.deepEqual(await kezdok(e), ORANKENT);
});

test('nyilvános módosítás csak felkínált kezdésre (10:00 → 10:30 409, → 11:00 200)', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  assert.equal((await post(e, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '10:30', kollega: 'szegedi-botond' })).status, 409);
  assert.equal((await post(e, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '11:00', kollega: 'szegedi-botond' })).status, 200);
});
