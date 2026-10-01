// Időpontfoglaló · kolléga-törzs (Lilla-kör): új mezők, létrehozás, módosítás, archiválás,
// belépés/kilépés dátuma a szabad időpontokban. Valódi SQLite-tal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, foglalj, get, NAP, post, sorok, TESZT_NEV, ujEnv } from './_foglalo.mjs';
import { budapestMost, datumPlusz } from '../functions/_lib/booking/ido.js';

const ujKollega = (o = {}) => ({
  nev: TESZT_NEV, szerep: 'gyógymasszőr', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogymasszazs-50'],
  email: 'david.teszt.kollega@example.com', aktiv_tol: '', aktiv_ig: '', foto: 'https://f360.hu/media/csapat/teszt.jpg',
  bemutatkozas: 'Teszt bemutatkozás.', ...o,
});
const beosztas = (env, kollega) => admin(env, 'PUT', `/api/foglalo/beosztas?kollega=${kollega}`, {
  sorok: [1, 2, 3, 4, 5].map((nap) => ({ nap, helyszin: 'mexikoi', kezd: '09:00', veg: '17:00' })),
});
const szabadNap = async (env, kollega, nap = NAP) => {
  const r = await get(env, `/foglalas-api/szabad?helyszin=mexikoi&szolgaltatas=gyogymasszazs-50&kollega=${kollega}&tol=${nap}&ig=${nap}`);
  return { status: r.status, napok: r.status === 200 ? (await r.json()).napok[nap] : null };
};

test('POST /api/foglalo/kollegak: 201, az új mezőkkel, azonosító a névből, szín a palettából', async () => {
  const e = ujEnv();
  const r = await admin(e, 'POST', '/api/foglalo/kollegak', ujKollega());
  assert.equal(r.status, 201, await r.clone().text());
  const k = await r.json();
  assert.equal(k.id, 'david-teszt');
  assert.equal(k.nev, TESZT_NEV);
  assert.equal(k.email, 'david.teszt.kollega@example.com');
  assert.equal(k.foto, 'https://f360.hu/media/csapat/teszt.jpg');
  assert.equal(k.bemutatkozas, 'Teszt bemutatkozás.');
  assert.equal(k.aktiv_tol, '');
  assert.equal(k.aktiv_ig, '');
  assert.equal(k.archivalt, false);
  assert.match(k.szin, /^#[0-9a-f]{6}$/);
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.ok(t.kollegak.some((x) => x.id === 'david-teszt' && x.email === 'david.teszt.kollega@example.com'));
  // ugyanazzal a névvel másodszor: egyedi azonosító
  const r2 = await admin(e, 'POST', '/api/foglalo/kollegak', ujKollega());
  assert.equal(r2.status, 201);
  assert.equal((await r2.json()).id, 'david-teszt-2');
});

test('kolléga-validáció: hibás e-mail, dátum, fotó-URL, ismeretlen helyszín vagy szolgáltatás 400', async () => {
  const e = ujEnv();
  const rossz = [
    { email: 'nem-email' }, { aktiv_tol: '2026-02-30' }, { aktiv_ig: 'holnap' },
    { aktiv_tol: '2027-01-10', aktiv_ig: '2027-01-01' }, { foto: 'javascript:alert(1)' }, { foto: 'http://f360.hu/x.jpg' },
    { helyszinek: ['nincs'] }, { szolgaltatasok: ['nincs'] }, { nev: '' }, { nev: 'x'.repeat(101) },
    { bemutatkozas: 'x'.repeat(2001) }, { szin: 'piros' }, { id: 'Rossz Azonosito' }, { id: 'barki' },
  ];
  for (const o of rossz) {
    const r = await admin(e, 'POST', '/api/foglalo/kollegak', ujKollega(o));
    assert.equal(r.status, 400, JSON.stringify(o));
  }
  // relatív fotó-út elfogadott, üres e-mail is
  const ok = await admin(e, 'POST', '/api/foglalo/kollegak', ujKollega({ foto: '/media/csapat/teszt.jpg', email: '' }));
  assert.equal(ok.status, 201);
  // létező azonosító 409
  assert.equal((await admin(e, 'POST', '/api/foglalo/kollegak', ujKollega({ id: 'szegedi-botond' }))).status, 409);
});

test('PATCH /api/foglalo/kollegak/:id: csak a küldött mezők változnak; ismeretlen 404', async () => {
  const e = ujEnv();
  const r = await admin(e, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { email: 'botond.privat@example.com', bemutatkozas: 'Szia.' });
  assert.equal(r.status, 200, await r.clone().text());
  const k = await r.json();
  assert.equal(k.email, 'botond.privat@example.com');
  assert.equal(k.bemutatkozas, 'Szia.');
  assert.equal(k.nev, 'Szegedi Botond');
  assert.equal(k.szin, '#5b7d55');
  assert.equal(k.szolgaltatasok.length, 7);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/nincs-ilyen', { email: '' })).status, 404);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { email: 'rossz' })).status, 400);
  // az azonosító nem írható át
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { id: 'mas' })).status, 400);
  // a régi, szín-PATCH (?kollega=) továbbra is működik
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak?kollega=szegedi-botond', { szin: '#4f6d8a' })).status, 200);
});

test('a teljes beállítás-mentés (PUT) megőrzi az új mezőket, ha a kérés nem küldi őket', async () => {
  const e = ujEnv();
  await admin(e, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { email: 'botond.privat@example.com', aktiv_tol: '2020-01-01' });
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  // régi felület: a kollégák új mezők nélkül mennek vissza
  const regi = { ...t, kollegak: t.kollegak.map(({ id, nev, szerep, helyszinek, szolgaltatasok, szin }) => ({ id, nev, szerep, helyszinek, szolgaltatasok, szin })) };
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', regi)).status, 200);
  const utana = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const b = utana.kollegak.find((k) => k.id === 'szegedi-botond');
  assert.equal(b.email, 'botond.privat@example.com');
  assert.equal(b.aktiv_tol, '2020-01-01');
  // kifejezetten üresre állítva törlődik
  const urit = { ...utana, kollegak: utana.kollegak.map((k) => (k.id === 'szegedi-botond' ? { ...k, email: '' } : k)) };
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', urit)).status, 200);
  assert.equal((await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json()).kollegak.find((k) => k.id === 'szegedi-botond').email, '');
});

test('belépés és kilépés dátuma: ezen kívül nincs szabad időpont, a „bárki” sem osztja rá, foglalás 409', async () => {
  const e = ujEnv();
  const k = await (await admin(e, 'POST', '/api/foglalo/kollegak', ujKollega({ aktiv_tol: datumPlusz(NAP, 1) }))).json();
  assert.equal((await beosztas(e, k.id)).status, 200);
  // belépés előtt: nincs szabad időpontja, és a bárki-listában sem szerepel
  assert.deepEqual((await szabadNap(e, k.id)).napok, []);
  assert.ok((await szabadNap(e, 'barki')).napok.every((s) => !s.kollegak.includes(k.id)));
  const r = await post(e, '/foglalas-api/foglalas', alap({ kollega: k.id }));
  assert.equal(r.status, 409);
  // a belépés napján már foglalható
  const kovNap = datumPlusz(NAP, 1);
  assert.ok((await szabadNap(e, k.id, kovNap)).napok.length > 0);
  // kilépés: aznap még foglalható, utána nem
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/kollegak/${k.id}`, { aktiv_tol: '', aktiv_ig: NAP })).status, 200);
  assert.ok((await szabadNap(e, k.id)).napok.length > 0);
  assert.deepEqual((await szabadNap(e, k.id, kovNap)).napok, []);
  assert.ok((await szabadNap(e, 'barki', kovNap)).napok.every((s) => !s.kollegak.includes(k.id)));
});

test('katalógus: a kilépett és az archivált kolléga nem látszik; a privát e-mail soha', async () => {
  const e = ujEnv();
  const tegnap = datumPlusz(budapestMost().datum, -1);
  await admin(e, 'PATCH', '/api/foglalo/kollegak/vas-luca', { aktiv_ig: tegnap });
  await admin(e, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { email: 'botond.privat@example.com', bemutatkozas: 'Szia.' });
  const kat = await (await get(e, '/foglalas-api/katalogus')).json();
  const ids = kat.kollegak.map((k) => k.id);
  assert.ok(!ids.includes('vas-luca'));
  const b = kat.kollegak.find((k) => k.id === 'szegedi-botond');
  assert.equal(b.bemutatkozas, 'Szia.');
  assert.ok('foto' in b);
  assert.ok(!JSON.stringify(kat).includes('botond.privat'));
});

test('archiválás: jövőbeli foglalás miatt 409, utána archiválható; nem foglalható, de a beállításokban megmarad', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  const r = await admin(e, 'POST', '/api/foglalo/kollegak/szegedi-botond/archivalas', {});
  assert.equal(r.status, 409);
  const hiba = await r.json();
  assert.equal(hiba.jovobeli, 1);
  assert.match(hiba.error, /1 jövőbeli foglalás/);
  // a kilépés dátuma sem tehető a meglévő foglalás elé
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { aktiv_ig: datumPlusz(NAP, -1) })).status, 409);
  assert.equal((await admin(e, 'POST', `/api/foglalo/foglalasok/${f.azonosito}/lemondas`, {})).status, 200);
  const a = await admin(e, 'POST', '/api/foglalo/kollegak/szegedi-botond/archivalas', {});
  assert.equal(a.status, 200, await a.clone().text());
  assert.equal((await a.json()).archivalt, true);
  assert.equal((await szabadNap(e, 'szegedi-botond')).status, 400);
  assert.equal((await post(e, '/foglalas-api/foglalas', alap(), { ip: '9.9.9.9' })).status, 400);
  assert.ok(!(await (await get(e, '/foglalas-api/katalogus')).json()).kollegak.some((k) => k.id === 'szegedi-botond'));
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t.kollegak.find((k) => k.id === 'szegedi-botond').archivalt, true);
  // a régi foglalás továbbra is olvasható a listában a kolléga nevével
  const lista = await (await admin(e, 'GET', `/api/foglalo/foglalasok?tol=${NAP}&ig=${NAP}`)).json();
  assert.equal(lista.foglalasok[0].kollega.nev, 'Szegedi Botond');
  // visszaállítás
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { archivalt: false })).status, 200);
  assert.ok((await szabadNap(e, 'szegedi-botond')).napok.length > 0);
  assert.equal(sorok(e, "SELECT COUNT(*) AS n FROM bookings WHERE status = 'megerositett'")[0].n, 0);
});
