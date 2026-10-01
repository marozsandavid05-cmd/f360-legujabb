// Időpontfoglaló · kampány-forrás (UTM) tárolása és riport, valamint a köszönő oldal publikus nézete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, foglalj, get, NAP, post, sorok, ujEnv } from './_foglalo.mjs';
import { datumPlusz } from '../functions/_lib/booking/ido.js';

const FORRAS = {
  utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'gerinc-osz', utm_content: 'video-a', utm_term: 'hátfájás',
  gclid: '', fbclid: 'IwAR0abc', landing: '/gerinc?utm_source=facebook', referrer: 'https://l.facebook.com/',
};

test('forras: a foglalással a bookings.forras JSON-ba kerül, az admin listában látszik', async () => {
  const e = ujEnv();
  const f = await foglalj(e, { forras: FORRAS });
  const tarolt = JSON.parse(sorok(e, 'SELECT forras FROM bookings WHERE id = ?', f.azonosito)[0].forras);
  // az üres értékű kulcs (gclid: '') nem tárolódik
  const { gclid: _g, ...vart } = FORRAS;
  assert.deepEqual(tarolt, vart);
  const lista = await (await admin(e, 'GET', `/api/foglalo/foglalasok?tol=${NAP}&ig=${NAP}`)).json();
  const b = lista.foglalasok[0];
  assert.equal(b.forras, 'web'); // a régi mező (web/admin) jelentése nem változik
  assert.equal(b.kampany.utm_campaign, 'gerinc-osz');
  assert.equal(b.kampany.fbclid, 'IwAR0abc');
  // a publikus válaszban nincs
  assert.equal(f.foglalas.kampany, undefined);
});

test('forras nélkül, null-lal vagy üres objektummal: NULL; a lista kampany mezője null', async () => {
  const e = ujEnv();
  await foglalj(e);
  await foglalj(e, { kezd: '12:00', forras: null }, '2.2.2.2');
  await foglalj(e, { kezd: '14:00', forras: {} }, '3.3.3.3');
  assert.deepEqual(sorok(e, 'SELECT forras FROM bookings').map((x) => x.forras), [null, null, null]);
  const lista = await (await admin(e, 'GET', `/api/foglalo/foglalasok?tol=${NAP}&ig=${NAP}`)).json();
  assert.ok(lista.foglalasok.every((b) => b.kampany === null));
});

test('forras validáció: ismeretlen kulcs kimarad, a túl hosszú érték levágva, nem szöveg 400, nem objektum 400', async () => {
  const e = ujEnv();
  const f = await foglalj(e, { forras: { utm_source: '  google  ', gonosz: 'x', utm_campaign: 'k'.repeat(500), landing: 'l'.repeat(2000), referrer: 'javascript:alert(1)' } });
  const t = JSON.parse(sorok(e, 'SELECT forras FROM bookings WHERE id = ?', f.azonosito)[0].forras);
  assert.equal(t.utm_source, 'google');
  assert.equal(t.gonosz, undefined);
  assert.equal(t.utm_campaign.length, 200);
  assert.equal(t.landing.length, 500);
  assert.equal(t.referrer, undefined); // csak http(s) hivatkozó
  for (const [i, rossz] of [{ utm_source: 5 }, { utm_source: { a: 1 } }, 'facebook', ['a'], 7].entries()) {
    const r = await post(e, '/foglalas-api/foglalas', alap({ kezd: '14:00', forras: rossz }), { ip: `5.5.5.${i}` });
    assert.equal(r.status, 400, JSON.stringify(rossz));
  }
  // vezérlőkarakter kiszűrve
  const g = await foglalj(e, { kezd: '15:00', forras: { utm_source: 'fb\u0000\u0007ok' } }, '6.6.6.6');
  assert.equal(JSON.parse(sorok(e, 'SELECT forras FROM bookings WHERE id = ?', g.azonosito)[0].forras).utm_source, 'fbok');
});

test('riport: foglalások száma forrás, kampány és szolgáltatás szerint, dátumtartományra; lemondott külön', async () => {
  const e = ujEnv();
  await foglalj(e, { forras: FORRAS });
  await foglalj(e, { kezd: '12:00', forras: FORRAS }, '2.2.2.2');
  await foglalj(e, { kezd: '14:00', szolgaltatas: 'relaxalo-masszazs', forras: { utm_source: 'google', utm_campaign: 'brand' } }, '3.3.3.3');
  const l = await foglalj(e, { kezd: '15:00', forras: { utm_source: 'google', utm_campaign: 'brand' } }, '4.4.4.4');
  await post(e, '/foglalas-api/lemondas', { t: l.t });
  await foglalj(e, { kezd: '16:00' }, '7.7.7.7'); // közvetlen
  const r = await admin(e, 'GET', `/api/foglalo/riport/forrasok?tol=${NAP}&ig=${NAP}`);
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.tol, NAP);
  assert.equal(d.ig, NAP);
  const sor = (forras, kampany, szolg) => d.sorok.find((x) => x.forras === forras && x.kampany === kampany && x.szolgaltatas.id === szolg);
  assert.deepEqual([sor('facebook', 'gerinc-osz', 'gyogymasszazs-50').foglalasok, sor('facebook', 'gerinc-osz', 'gyogymasszazs-50').lemondva], [2, 0]);
  assert.equal(sor('facebook', 'gerinc-osz', 'gyogymasszazs-50').medium, 'paid');
  assert.equal(sor('facebook', 'gerinc-osz', 'gyogymasszazs-50').szolgaltatas.nev, 'Gyógymasszázs');
  assert.deepEqual([sor('google', 'brand', 'relaxalo-masszazs').foglalasok, sor('google', 'brand', 'gyogymasszazs-50').lemondva], [1, 1]);
  assert.equal(sor('google', 'brand', 'gyogymasszazs-50').foglalasok, 0);
  assert.equal(sor('(közvetlen)', '', 'gyogymasszazs-50').foglalasok, 1);
  assert.deepEqual(d.osszesen, { foglalasok: 4, lemondva: 1 });
  // a sorok foglalásszám szerint csökkenőben
  assert.equal(d.sorok[0].foglalasok, 2);
  // a dátumszűrő a foglalás napjára vonatkozik
  const masnap = await (await admin(e, 'GET', `/api/foglalo/riport/forrasok?tol=${datumPlusz(NAP, 1)}&ig=${datumPlusz(NAP, 5)}`)).json();
  assert.deepEqual(masnap.sorok, []);
  // gclid / fbclid utm nélkül: a forrás ebből következik
  await foglalj(e, { kezd: '11:00', forras: { gclid: 'Cj0abc' } }, '8.8.8.8');
  const d2 = await (await admin(e, 'GET', `/api/foglalo/riport/forrasok?tol=${NAP}&ig=${NAP}`)).json();
  assert.ok(d2.sorok.some((x) => x.forras === 'google (gclid)'));
  // hibás tartomány 400, túl hosszú 400
  assert.equal((await admin(e, 'GET', '/api/foglalo/riport/forrasok?tol=2026-13-01&ig=2026-12-01')).status, 400);
  assert.equal((await admin(e, 'GET', '/api/foglalo/riport/forrasok?tol=2026-01-01&ig=2027-06-01')).status, 400);
  // alapértelmezés: az elmúlt 30 nap és a következő 60 (paraméter nélkül is 200)
  assert.equal((await admin(e, 'GET', '/api/foglalo/riport/forrasok')).status, 200);
});

test('köszönő oldal: GET /foglalas-api/foglalas?t= a publikus nézetet adja; rossz token 404, lemondott is olvasható', async () => {
  const e = ujEnv();
  const f = await foglalj(e, { forras: FORRAS });
  const r = await get(e, `/foglalas-api/foglalas?t=${encodeURIComponent(f.t)}`);
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.azonosito, f.azonosito);
  assert.equal(d.lemondasUrl, f.lemondasUrl);
  assert.equal(d.ics, f.ics);
  assert.equal(d.foglalas.kezd, '10:00');
  assert.equal(d.foglalas.szolgaltatas.nev, 'Gyógymasszázs');
  assert.equal(d.foglalas.email, undefined);
  assert.equal(d.foglalas.telefon, undefined);
  // a köszönő oldal mérési eseményéhez: szolgáltatás, ár, és a kampány (érzékeny adat nélkül)
  assert.equal(d.meres.szolgaltatas, 'gyogymasszazs-50');
  assert.equal(d.meres.ar, 13500);
  assert.equal(d.meres.utm_campaign, 'gerinc-osz');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal((await get(e, '/foglalas-api/foglalas?t=szemet')).status, 404);
  await post(e, '/foglalas-api/lemondas', { t: f.t });
  const l = await (await get(e, `/foglalas-api/foglalas?t=${encodeURIComponent(f.t)}`)).json();
  assert.equal(l.foglalas.allapot, 'lemondva');
});
