// Időpontfoglaló · rögzített kezdési perc a valódi API-n (2026-10-15): az InBody 8:50-re foglalható,
// a 9:00-s tanácsadás ütközik vele (közös 9:00-s rácspont), a rácson kívüli kezdés a módosításnál is megy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, get, post, kovNap, ujEnv } from './_foglalo.mjs';

const NAP = kovNap(1, 4); // hétfő legalább 4 nap múlva

async function annaKeszit() {
  const e = ujEnv();
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  t.szolgaltatasok = t.szolgaltatasok.map((s) => {
    if (s.id === 'inbody-770') return { ...s, perc: 15, kezdoPerc: 50 };
    if (s.id === 'taplalkozas-alapcsomag' || s.id === 'taplalkozas-kiegeszito') return { ...s, kezdoPerc: 0 };
    return s;
  });
  const m = await admin(e, 'PUT', '/api/foglalo/beallitasok', t);
  assert.equal(m.status, 200, await m.clone().text());
  const b = await admin(e, 'PUT', '/api/foglalo/beosztas?kollega=kovacs-anna', { sorok: [{ nap: 1, helyszin: 'mexikoi', kezd: '08:45', veg: '18:00' }] });
  assert.equal(b.status, 200, await b.clone().text());
  return e;
}
const szabadKezdesek = async (e, szolg) => {
  const r = await get(e, `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=${szolg}&kollega=kovacs-anna&tol=${NAP}&ig=${NAP}`);
  assert.equal(r.status, 200);
  return (await r.json()).napok[NAP].map((s) => s.kezd);
};
const anna = (o) => alap({ szolgaltatas: 'inbody-770', kollega: 'kovacs-anna', datum: NAP, kezd: '08:50', ...o });

test('API: InBody csak :50-kor kínálódik, a mentett kezdoPerc megmarad, a katalógus lépése 60', async () => {
  const e = await annaKeszit();
  const k = await szabadKezdesek(e, 'inbody-770');
  assert.equal(k[0], '08:50');
  assert.ok(k.every((x) => x.endsWith(':50')), k.join(','));
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t.szolgaltatasok.find((s) => s.id === 'inbody-770').kezdoPerc, 50);
  const kat = await (await get(e, '/foglalas-api/katalogus')).json();
  assert.equal(kat.szolgaltatasok.find((s) => s.id === 'inbody-770').lepes, 60);
  assert.deepEqual((await szabadKezdesek(e, 'taplalkozas-alapcsomag')).slice(0, 2), ['09:00', '10:00']);
});

test('API: 8:50-es InBody foglalható; a 9:00-s tanácsadás ütközik, a 9:50-es InBody nem; a 10:00 InBody 400 (nem :50)', async () => {
  const e = await annaKeszit();
  const r = await post(e, '/foglalas-api/foglalas', anna());
  assert.equal(r.status, 201, await r.clone().text());
  const d = await r.json();
  assert.equal(d.foglalas.kezd, '08:50');
  assert.equal(d.foglalas.veg, '09:05');
  const zarak = e.BOOKING_DB._raw.prepare('SELECT slot_min FROM slot_locks WHERE booking_id = ? ORDER BY slot_min').all(d.azonosito).map((x) => x.slot_min);
  assert.deepEqual(zarak, [525, 540]);
  assert.ok(!(await szabadKezdesek(e, 'taplalkozas-alapcsomag')).includes('09:00'));
  assert.equal((await post(e, '/foglalas-api/foglalas', anna({ szolgaltatas: 'taplalkozas-alapcsomag', kezd: '09:00', email: 'david.teszt2@example.com' }), { ip: '1.2.3.5' })).status, 409);
  assert.equal((await post(e, '/foglalas-api/foglalas', anna({ kezd: '09:50', email: 'david.teszt3@example.com' }), { ip: '1.2.3.6' })).status, 201);
  assert.equal((await post(e, '/foglalas-api/foglalas', anna({ kezd: '10:00', email: 'david.teszt4@example.com' }), { ip: '1.2.3.7' })).status, 400);
  // a tanácsadás :50-re sem foglalható (egész órás kezdés)
  assert.equal((await post(e, '/foglalas-api/foglalas', anna({ szolgaltatas: 'taplalkozas-alapcsomag', kezd: '10:50', email: 'david.teszt6@example.com' }), { ip: '1.2.3.9' })).status, 400);
  assert.equal((await post(e, '/foglalas-api/foglalas', anna({ kezd: '10:52', email: 'david.teszt5@example.com' }), { ip: '1.2.3.8' })).status, 400);
});

test('API: a 8:50-es InBody módosítható 10:50-re (tokenes link), utána a 8:50 újra szabad', async () => {
  const e = await annaKeszit();
  const d = await (await post(e, '/foglalas-api/foglalas', anna())).json();
  const t = new URL(d.lemondasUrl).searchParams.get('t');
  const m = await post(e, '/foglalas-api/modositas', { t, datum: NAP, kezd: '10:50', kollega: 'kovacs-anna' });
  assert.equal(m.status, 200, await m.clone().text());
  assert.ok((await szabadKezdesek(e, 'inbody-770')).includes('08:50'));
  assert.ok(!(await szabadKezdesek(e, 'inbody-770')).includes('10:50'));
});
