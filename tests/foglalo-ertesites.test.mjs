// Időpontfoglaló · értesítések a kollégának (Lilla-kör): új foglalás, lemondás, módosítás,
// kolléga-csere, kikapcsolt beállítás. Minden csak az outboxba kerül, semmi nem megy ki.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, foglalj, kollegaAtir, NAP, outbox, post, sorok, szabalyAtir, ujEnv } from './_foglalo.mjs';

const BOTOND = 'botond.privat@example.com';
const LUCA = 'luca.privat@example.com';
const STUDIO = 'info@f360.hu';
const cimzettek = (env, tipus) => outbox(env, tipus).map((x) => x.cimzett).sort();

async function envEmaillel() {
  const e = ujEnv();
  await kollegaAtir(e, 'szegedi-botond', { email: BOTOND });
  await kollegaAtir(e, 'vas-luca', { email: LUCA });
  return e;
}

test('új foglalás: kollega-uj a kolléga privát címére, a stúdió-értesítő marad, a páciens visszaigazolást kap', async () => {
  const e = await envEmaillel();
  const f = await foglalj(e);
  assert.deepEqual(cimzettek(e, 'kollega-uj'), [BOTOND]);
  assert.deepEqual(cimzettek(e, 'studio-ertesito'), [STUDIO]);
  assert.deepEqual(cimzettek(e, 'visszaigazolas'), ['david.teszt@example.com']);
  const l = outbox(e, 'kollega-uj')[0];
  assert.equal(l.booking_id, f.azonosito);
  assert.equal(l.sent, 0);
  assert.match(l.targy, /Új foglalás/);
  assert.ok(l.html.includes('David teszt') && l.html.includes('10:00'));
  assert.ok(l.szoveg.includes('+36 30 123 4567'));
  // a kolléga levelében nincs lemondó link (az a páciensé)
  assert.ok(!l.html.includes(f.t));
});

test('kolléga e-mail nélkül: nincs kollega-uj sor, a foglalás és a többi levél rendben', async () => {
  const e = ujEnv();
  await foglalj(e);
  assert.equal(outbox(e, 'kollega-uj').length, 0);
  assert.equal(outbox(e, 'studio-ertesito').length, 1);
});

test('admin kézi felvétel: a kolléga kap kollega-uj levelet (a stúdió nem)', async () => {
  const e = await envEmaillel();
  const r = await admin(e, 'POST', '/api/foglalo/foglalasok', alap({ email: '', telefon: '', hozzajarul: undefined }));
  assert.equal(r.status, 201, await r.clone().text());
  assert.deepEqual(cimzettek(e, 'kollega-uj'), [BOTOND]);
  assert.equal(outbox(e, 'studio-ertesito').length, 0);
});

test('páciens lemond: kollega-lemondas a kollégának és a stúdiónak, egyszer (párhuzamos lemondásnál is)', async () => {
  const e = await envEmaillel();
  const f = await foglalj(e);
  const rs = await Promise.all([post(e, '/foglalas-api/lemondas', { t: f.t }), post(e, '/foglalas-api/lemondas', { t: f.t })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 410]);
  assert.deepEqual(cimzettek(e, 'kollega-lemondas'), [BOTOND, STUDIO].sort());
  assert.equal(outbox(e, 'lemondas').length, 1);
  const l = outbox(e, 'kollega-lemondas')[0];
  assert.match(l.targy, /Lemondott foglalás/);
  assert.ok(l.html.includes('David teszt') && l.html.includes('felszabadult'));
});

test('admin lemond: kollega-lemondas a kollégának és a stúdiónak', async () => {
  const e = await envEmaillel();
  const f = await foglalj(e);
  assert.equal((await admin(e, 'POST', `/api/foglalo/foglalasok/${f.azonosito}/lemondas`, {})).status, 200);
  assert.deepEqual(cimzettek(e, 'kollega-lemondas'), [BOTOND, STUDIO].sort());
});

test('módosítás ugyanannál a kollégánál: kollega-modositas a régi és az új időponttal', async () => {
  const e = await envEmaillel();
  const f = await foglalj(e);
  const r = await post(e, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' });
  assert.equal(r.status, 200);
  assert.deepEqual(cimzettek(e, 'kollega-modositas'), [BOTOND]);
  const l = outbox(e, 'kollega-modositas')[0];
  assert.ok(l.html.includes('10:00') && l.html.includes('12:00'));
  assert.equal(outbox(e, 'kollega-lemondas').length, 0);
  assert.equal(outbox(e, 'kollega-uj').length, 1); // csak a foglaláskori
});

test('módosítás kolléga-cserével: a régi kolléga lemondást, az új új foglalást kap; nincs kollega-modositas', async () => {
  const e = await envEmaillel();
  const f = await foglalj(e, { szolgaltatas: 'kismama-masszazs' });
  // Vas Luca hétfőn 10-18 a Mexikóiban, és kismama-masszázst is végez
  const r = await post(e, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '14:00', kollega: 'vas-luca' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(cimzettek(e, 'kollega-lemondas'), [BOTOND]);
  assert.deepEqual(outbox(e, 'kollega-uj').map((x) => x.cimzett), [BOTOND, LUCA]);
  assert.equal(outbox(e, 'kollega-modositas').length, 0);
  // a régi kolléga levelében a régi időpont, az újéban az új szerepel
  assert.ok(outbox(e, 'kollega-lemondas')[0].html.includes('10:00'));
  assert.ok(outbox(e, 'kollega-uj')[1].html.includes('14:00'));
});

test('admin áthelyezés: a kolléga értesítést kap, a stúdió nem', async () => {
  const e = await envEmaillel();
  const f = await foglalj(e);
  const r = await admin(e, 'PATCH', `/api/foglalo/foglalasok/${f.azonosito}`, { datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' });
  assert.equal(r.status, 200);
  assert.deepEqual(cimzettek(e, 'kollega-modositas'), [BOTOND]);
  assert.equal(outbox(e, 'studio-modositas').length, 0);
});

test('ertesitKollega = false: nincs kollega-uj, -modositas és kolléga-lemondás; a stúdió lemondó értesítője marad', async () => {
  const e = await envEmaillel();
  await szabalyAtir(e, { ertesitKollega: false });
  const f = await foglalj(e);
  await post(e, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' });
  await post(e, '/foglalas-api/lemondas', { t: f.t });
  assert.equal(outbox(e, 'kollega-uj').length, 0);
  assert.equal(outbox(e, 'kollega-modositas').length, 0);
  assert.deepEqual(cimzettek(e, 'kollega-lemondas'), [STUDIO]);
});

test('beállítások: ertesitKollega, emlekeztetoBe, emlekeztetoOra alapértéke és mentése, hibás érték 400', async () => {
  const e = ujEnv();
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t.szabalyok.ertesitKollega, true);
  assert.equal(t.szabalyok.emlekeztetoBe, true);
  assert.equal(t.szabalyok.emlekeztetoOra, 30);
  const uj = { ...t, szabalyok: { ...t.szabalyok, ertesitKollega: false, emlekeztetoOra: 26 } };
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', uj)).status, 200);
  const t2 = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t2.szabalyok.ertesitKollega, false);
  assert.equal(t2.szabalyok.emlekeztetoOra, 26);
  // a régi felület (új kulcsok nélkül) nem állítja vissza őket
  const { ertesitKollega: _a, emlekeztetoBe: _b, emlekeztetoOra: _c, ...regiSz } = t2.szabalyok;
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t2, szabalyok: regiSz })).status, 200);
  assert.equal((await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json()).szabalyok.emlekeztetoOra, 26);
  for (const rossz of [{ ertesitKollega: 'igen' }, { emlekeztetoOra: 0 }, { emlekeztetoOra: 200 }, { emlekeztetoOra: 1.5 }, { emlekeztetoBe: 1 }]) {
    assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t2, szabalyok: { ...t2.szabalyok, ...rossz } })).status, 400, JSON.stringify(rossz));
  }
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM bookings')[0].n, 0);
});
