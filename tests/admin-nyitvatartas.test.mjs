// Az admin Beállítások / Helyszínek napi nyitvatartás-szerkesztője (admin/nyitvatartas.js) és a mentés hűsége:
// a felület által összerakott napiNyitvatartas a valódi admin-API-n (GET → PUT → GET) változatlanul visszajön,
// egy másik mező mentése sem viszi el, és a foglaló a mentett napi kerettel kínál időpontot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { admin, ujEnv, get } from './_foglalo.mjs';
import { budapestMost, datumPlusz, hetNapja } from '../functions/_lib/booking/ido.js';

function betolt() {
  const forras = readFileSync(new URL('../admin/nyitvatartas.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ Object, JSON, String, Number, Array, RegExp });
  ctx.window = ctx;
  vm.runInContext(forras.replace('})(window);', '})(this);'), ctx);
  assert.ok(ctx.F360Nyitva, 'a modul a window.F360Nyitva-n érhető el');
  return ctx.F360Nyitva;
}
const sima = (x) => JSON.parse(JSON.stringify(x));
const torzs = async (e) => (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();

test('napi sorok: hétfőtől vasárnapig, alap szerint, eltérő idő, zárva', () => {
  const N = betolt();
  assert.deepEqual(sima(N.NAPOK.map((n) => n[0])), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sima(N.NAPOK.map((n) => n[1])), ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap']);
  const h = { nyit: '07:00', zar: '21:00', napiNyitvatartas: { 6: { nyit: '08:00', zar: '14:00' }, 7: null } };
  assert.deepEqual(sima(N.nap(h, 1)), { nyitva: true, nyit: '07:00', zar: '21:00', sajat: false });
  assert.deepEqual(sima(N.nap(h, 6)), { nyitva: true, nyit: '08:00', zar: '14:00', sajat: true });
  assert.deepEqual(sima(N.nap(h, 7)), { nyitva: false, nyit: '07:00', zar: '21:00', sajat: true });
  assert.equal(N.osszegzes(h), 'Hétfő-péntek 07:00-21:00, szombat 08:00-14:00, vasárnap zárva');
  assert.equal(N.osszegzes({ nyit: '07:00', zar: '21:00' }), 'Hétfő-vasárnap 07:00-21:00');
});

test('beállítás: zárva = null, eltérő idő = { nyit, zar }, az alappal egyező idő és az „alapra” törli a napot', () => {
  const N = betolt();
  const h = { nyit: '07:00', zar: '21:00' };
  N.beallit(h, 6, { nyit: '08:00', zar: '13:00' });
  N.beallit(h, 7, { nyitva: false });
  assert.deepEqual(sima(h.napiNyitvatartas), { 6: { nyit: '08:00', zar: '13:00' }, 7: null });
  N.beallit(h, 6, { nyit: '07:00', zar: '21:00' }); // pont az alap: nincs külön bejegyzés
  assert.deepEqual(sima(h.napiNyitvatartas), { 7: null });
  N.beallit(h, 7, { nyitva: true }); // visszakapcsolva: az alap szerint nyitva
  assert.equal('napiNyitvatartas' in h, false, 'üresen nem marad üres objektum');
  N.beallit(h, 3, { nyitva: false });
  N.alapra(h, 3);
  assert.equal('napiNyitvatartas' in h, false);
  // csak az egyik időt átírva a másik a nap eddigi értéke marad
  N.beallit(h, 6, { zar: '12:30' });
  assert.deepEqual(sima(h.napiNyitvatartas), { 6: { nyit: '07:00', zar: '12:30' } });
});

test('ellenőrzés magyarul: a zárás legyen későbbi a nyitásnál, a zárt nap nem hiba', () => {
  const N = betolt();
  assert.equal(N.ellenoriz({ nev: 'Reitter Ferenc utca', nyit: '07:00', zar: '21:00', napiNyitvatartas: { 6: { nyit: '14:00', zar: '08:00' } } }),
    'Reitter Ferenc utca, szombat: a zárás legyen későbbi a nyitásnál.');
  assert.equal(N.ellenoriz({ nev: 'Mexikói út', nyit: '07:00', zar: '21:00', napiNyitvatartas: { 7: null } }), '');
  assert.equal(N.ellenoriz({ nev: 'Mexikói út', nyit: '07:00', zar: '21:00', napiNyitvatartas: { 6: { nyit: '08:05', zar: '12:00' } } }),
    'Mexikói út, szombat: a nyitás és a zárás negyedórás lehet (például 8:00, 8:15, 8:30).');
  assert.ok(N.IDO.includes('08:15') && N.IDO.includes('13:45') && !N.IDO.includes('08:05'), 'negyedórás lépés, mint a backend hhmmToPerc');
});

test('a backend a napi keretet negyedórás rácson fogadja el (ezért a választó 15 perces)', async () => {
  const e = ujEnv();
  const t = await torzs(e);
  t.helyszinek.find((h) => h.id === 'reitter').napiNyitvatartas = { 6: { nyit: '08:05', zar: '13:00' } };
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', t)).status, 400);
});

test('mentés-hűség a valódi admin-API-n: a felület napi kerete visszaolvasva azonos, más mező mentése sem viszi el', async () => {
  const N = betolt();
  const e = ujEnv();
  const t = await torzs(e);
  const r = t.helyszinek.find((h) => h.id === 'reitter');
  const m = t.helyszinek.find((h) => h.id === 'mexikoi');
  N.beallit(r, 6, { nyit: '08:00', zar: '13:00' });
  N.beallit(r, 7, { nyitva: false });
  N.beallit(m, 6, { nyit: '08:00', zar: '12:00' });
  N.beallit(m, 7, { nyitva: false });
  const varR = sima(r.napiNyitvatartas);
  const varM = sima(m.napiNyitvatartas);
  const v1 = await admin(e, 'PUT', '/api/foglalo/beallitasok', t);
  assert.equal(v1.status, 200, await v1.clone().text());
  const t2 = await torzs(e);
  assert.deepEqual(t2.helyszinek.find((h) => h.id === 'reitter').napiNyitvatartas, varR);
  assert.deepEqual(t2.helyszinek.find((h) => h.id === 'mexikoi').napiNyitvatartas, varM);
  // a felület második mentése (csak a nevet írja) a napi keretet megtartja
  t2.helyszinek.find((h) => h.id === 'reitter').nev = 'Reitter Ferenc utca';
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', t2)).status, 200);
  const t3 = await torzs(e);
  assert.deepEqual(t3.helyszinek.find((h) => h.id === 'reitter').napiNyitvatartas, varR);
  // a foglaló a mentett szombati 13:00-s zárással kínál: az utolsó kezdés + idő + szünet ≤ 13:00
  const szo = (() => { let d = datumPlusz(budapestMost(Date.now()).datum, 3); while (hetNapja(d) !== 6) d = datumPlusz(d, 1); return d; })();
  const kat = await (await get(e, '/foglalas-api/katalogus')).json();
  const nyitott = [];
  for (const s of kat.szolgaltatasok.filter((x) => x.helyszinek.includes('reitter'))) {
    const v = await (await get(e, `/foglalas-api/szabad?helyszin=reitter&szolgaltatas=${s.id}&kollega=barki&tol=${szo}&ig=${szo}`)).json();
    for (const x of v.napok[szo] || []) nyitott.push({ s, kezd: x.kezd });
  }
  const perc = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3);
  for (const { s, kezd } of nyitott) {
    assert.ok(perc(kezd) >= perc('08:00'), `${s.id} ${kezd} nyitás előtt`);
    assert.ok(perc(kezd) + s.perc + (s.puffer ?? 10) <= perc('13:00'), `${s.id} ${kezd} a 13:00-s zárás után ér véget`);
  }
  // a vasárnap zárva: egyik szolgáltatás sem kínál
  const vas = datumPlusz(szo, 1);
  for (const s of kat.szolgaltatasok) {
    for (const h of s.helyszinek) {
      const v = await (await get(e, `/foglalas-api/szabad?helyszin=${h}&szolgaltatas=${s.id}&kollega=barki&tol=${vas}&ig=${vas}`)).json();
      assert.equal((v.napok[vas] || []).length, 0, `${h} ${s.id} vasárnap`);
    }
  }
});
