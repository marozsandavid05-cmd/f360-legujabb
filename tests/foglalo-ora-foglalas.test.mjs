// Időpontfoglaló · csoportos óra foglalása, lemondása, áthelyezése (nyilvános, tokenes).
// Valódi SQLite-tal. Tesztadat: „David teszt”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, get, kovNap, post, sorok, tokenBol, ujEnv } from './_foglalo.mjs';
import { datumPlusz, helyiToUtc } from '../functions/_lib/booking/ido.js';
import { oraFoglal } from '../functions/_lib/booking/orak.js';

const ugyfel = (o = {}) => ({ nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true, ...o });

/** Az adott napi (alap: a következő hétfő) óra a kezdés szerint. */
async function ora(e, kezd = '18:15', nap = kovNap(1)) {
  const d = await (await get(e, `/foglalas-api/orak?helyszin=mexikoi&tol=${nap}&ig=${nap}`)).json();
  const o = d.orak.find((x) => x.kezd === kezd);
  assert.ok(o, `${nap} ${kezd}`);
  return o;
}
const jelentkezz = (e, o, extra = {}, ip = '1.2.3.4') => post(e, '/foglalas-api/ora-foglalas', { ora: o.id, ...ugyfel(extra) }, { ip });

test('ora-foglalas: 201, a szerződés szerinti válasz, a szabad helyek csökkennek, token C-vel', async () => {
  const e = ujEnv();
  const o = await ora(e);
  const r = await jelentkezz(e, o);
  assert.equal(r.status, 201, await r.clone().text());
  const d = await r.json();
  assert.match(d.azonosito, /^C[0-9A-Z]{10}$/);
  assert.match(tokenBol(d.lemondasUrl), /^C[0-9A-Z]{10}\.[A-Za-z0-9_-]{43}$/);
  assert.ok(d.lemondasUrl.includes('/foglalas/lemondas?t='));
  assert.ok(d.ics.includes('/foglalas-api/foglalas.ics?t='));
  assert.equal(d.foglalas.tipus, 'csoportos');
  assert.equal(d.foglalas.ora.nev, 'Aerial yoga trapeze');
  assert.equal(d.foglalas.kollega.nev, 'Barkóczy Barbara');
  assert.equal(d.foglalas.datum, o.datum);
  assert.equal(d.foglalas.kezd, '18:15');
  assert.equal(d.foglalas.nev, 'David teszt');
  assert.ok(!('email' in d.foglalas) && !('telefon' in d.foglalas));
  assert.equal((await ora(e)).szabad, 5);
  const [sor] = sorok(e, 'SELECT * FROM class_bookings');
  assert.equal(sor.ar, 4700);
  assert.equal(sor.rogzites, 'web');
});

test('ora-foglalas: ugyanaz az e-mail ugyanarra az órára egyszer (409 mar_jelentkezett), lemondás után újra', async () => {
  const e = ujEnv();
  const o = await ora(e);
  const d = await (await jelentkezz(e, o)).json();
  const r2 = await jelentkezz(e, o, { email: 'DAVID.teszt@example.com' });
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).kod, 'mar_jelentkezett');
  assert.equal((await post(e, '/foglalas-api/lemondas', { t: tokenBol(d.lemondasUrl) })).status, 200);
  assert.equal((await jelentkezz(e, o)).status, 201);
});

test('ora-foglalas: telt ház 409 betelt; a lemondott hely felszabadul', async () => {
  const e = ujEnv();
  const o = await ora(e); // aerial, 6 hely
  const tokenek = [];
  for (let i = 0; i < 6; i++) {
    const r = await jelentkezz(e, o, { email: `david.teszt+${i}@example.com` }, `10.0.0.${i}`);
    assert.equal(r.status, 201);
    tokenek.push(tokenBol((await r.json()).lemondasUrl));
  }
  const tele = await ora(e);
  assert.equal(tele.szabad, 0);
  assert.equal(tele.foglalhato, false);
  assert.equal(tele.ok, 'betelt');
  const r = await jelentkezz(e, o, { email: 'david.teszt+7@example.com' }, '10.0.1.1');
  assert.equal(r.status, 409);
  const hiba = await r.json();
  assert.equal(hiba.kod, 'betelt');
  assert.match(hiba.error, /Betelt/);
  await post(e, '/foglalas-api/lemondas', { t: tokenek[0] });
  assert.equal((await ora(e)).szabad, 1);
  assert.equal((await jelentkezz(e, o, { email: 'david.teszt+7@example.com' }, '10.0.1.1')).status, 201);
});

test('párhuzamos foglalás az utolsó helyre: pontosan egy nyer', async () => {
  const e = ujEnv();
  const o = await ora(e);
  for (let i = 0; i < 5; i++) await jelentkezz(e, o, { email: `david.teszt+${i}@example.com` }, `10.0.0.${i}`);
  const r = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => jelentkezz(e, o, { email: `david.teszt+p${i}@example.com` }, `10.0.2.${i}`)));
  const st = r.map((x) => x.status).sort();
  assert.deepEqual(st, [201, 409, 409, 409, 409, 409]);
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM class_bookings WHERE status = 'megerositett'`)[0].n, 6);
});

test('a kapacitás az adatbázisban is véd: közvetlen, egymásra futó beszúrásból sem lesz több résztvevő', async () => {
  const e = ujEnv();
  const o = await ora(e);
  // a függvényt közvetlenül, a HTTP-réteg nélkül, 10-szer egyszerre
  const be = (i) => ({ ora: o.id, nev: 'David teszt', email: `david.teszt+d${i}@example.com`, telefon: '+36 30 123 4567', megjegyzes: '', forras: null });
  const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => oraFoglal(e, e.BOOKING_DB, be(i), { origin: 'https://x.pages.dev' })));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 6);
  assert.ok(r.filter((x) => x.status === 'rejected').every((x) => x.reason.status === 409));
});

test('foglalási határ: a reggeli órára az előző este 22:00 után 409 hatarido, a telefonszámmal', async () => {
  const e = ujEnv();
  const kedd = kovNap(2);
  const o = await ora(e, '07:30', kedd);
  const db = e.BOOKING_DB;
  const be = { ora: o.id, nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', forras: null };
  const hatar = helyiToUtc(datumPlusz(kedd, -1), 22 * 60);
  await assert.rejects(oraFoglal(e, db, be, { origin: 'https://x', most: hatar + 60e3 }), (err) => err.status === 409 && err.extra.kod === 'hatarido' && /22:00/.test(err.message));
  const ok = await oraFoglal(e, db, be, { origin: 'https://x', most: hatar - 60e3 });
  assert.match(ok.azonosito, /^C/);
});

test('ora-foglalas bemenet: hiányzó óra 400, ismeretlen 404, hozzájárulás nélkül 400, idegen Origin 403, honeypot', async () => {
  const e = ujEnv();
  const o = await ora(e);
  assert.equal((await post(e, '/foglalas-api/ora-foglalas', ugyfel())).status, 400);
  assert.equal((await post(e, '/foglalas-api/ora-foglalas', { ora: 'S0000000000', ...ugyfel() })).status, 404);
  assert.equal((await post(e, '/foglalas-api/ora-foglalas', { ora: '../x', ...ugyfel() })).status, 400);
  assert.equal((await jelentkezz(e, o, { hozzajarul: false })).status, 400);
  assert.equal((await jelentkezz(e, o, { email: 'rossz' })).status, 400);
  assert.equal((await post(e, '/foglalas-api/ora-foglalas', { ora: o.id, ...ugyfel() }, { origin: 'https://gonosz.example' })).status, 403);
  const hp = await post(e, '/foglalas-api/ora-foglalas', { ora: o.id, ...ugyfel(), web: 'http://spam' });
  assert.equal(hp.status, 200);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM class_bookings')[0].n, 0);
});

test('tokenes végpontok csoportos tokennel: lemondas GET/POST, foglalas?t=, .ics; második lemondás 410', async () => {
  const e = ujEnv();
  const o = await ora(e);
  const d = await (await jelentkezz(e, o)).json();
  const t = tokenBol(d.lemondasUrl);
  const info = await (await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`)).json();
  assert.equal(info.tipus, 'csoportos');
  assert.equal(info.lemondhato, true);
  assert.equal(info.modosithato, true);
  assert.equal(info.foglalas.ora.nev, 'Aerial yoga trapeze');
  const k = await (await get(e, `/foglalas-api/foglalas?t=${encodeURIComponent(t)}`)).json();
  assert.equal(k.foglalas.tipus, 'csoportos');
  assert.equal(k.meres.ar, 4700);
  const ics = await get(e, `/foglalas-api/foglalas.ics?t=${encodeURIComponent(t)}`);
  assert.equal(ics.status, 200);
  const it = await ics.text();
  assert.match(it, /BEGIN:VEVENT/);
  assert.match(it, /SUMMARY:Aerial yoga trapeze · Studio F360/);
  assert.match(it, new RegExp(`UID:${d.azonosito}@`));
  const l = await post(e, '/foglalas-api/lemondas', { t });
  assert.equal(l.status, 200, await l.clone().text());
  assert.equal((await l.json()).allapot, 'lemondva');
  assert.equal((await post(e, '/foglalas-api/lemondas', { t })).status, 410);
  assert.equal((await get(e, `/foglalas-api/foglalas.ics?t=${encodeURIComponent(t)}`)).status, 410);
  // hamis aláírás 404
  const hamis = `${t.slice(0, 12)}${'A'.repeat(43)}`;
  assert.equal((await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(hamis)}`)).status, 404);
});

test('lemondás a lemondasOra határon belül 409 a telefonszámmal', async () => {
  const e = ujEnv();
  const o = await ora(e);
  const db = e.BOOKING_DB;
  const { oraLemond, oraTokenFoglalas } = await import('../functions/_lib/booking/orak.js');
  const d = await (await jelentkezz(e, o)).json();
  const row = await oraTokenFoglalas(e, db, tokenBol(d.lemondasUrl));
  const kezd = helyiToUtc(o.datum, 18 * 60 + 15);
  await assert.rejects(oraLemond(e, db, row, { most: kezd - 23 * 3600e3 }), (err) => err.status === 409 && /hívj/.test(err.message));
  // az admin a határon belül is lemondhat
  const r = await admin(e, 'POST', `/api/foglalo/ora-foglalasok/${d.azonosito}/lemondas`);
  assert.equal(r.status, 200, await r.clone().text());
});

test('áthelyezés: POST /foglalas-api/modositas {t, ora}; ugyanaz a token, a régi hely felszabadul; betelt 409', async () => {
  const e = ujEnv();
  const hetfo = kovNap(1);
  const o1 = await ora(e, '18:15', hetfo);
  const o2 = await ora(e, '09:00', datumPlusz(hetfo, 4)); // péntek Hatha
  const d = await (await jelentkezz(e, o1)).json();
  const t = tokenBol(d.lemondasUrl);
  const r = await post(e, '/foglalas-api/modositas', { t, ora: o2.id });
  assert.equal(r.status, 200, await r.clone().text());
  const m = await r.json();
  assert.equal(m.azonosito, d.azonosito);
  assert.equal(m.modositva, true);
  assert.equal(m.foglalas.ora.nev, 'Hatha jóga');
  assert.equal(tokenBol(m.lemondasUrl), t);
  assert.equal((await ora(e, '18:15', hetfo)).szabad, 6);
  assert.equal((await ora(e, '09:00', datumPlusz(hetfo, 4))).szabad, 7);
  const [sor] = sorok(e, 'SELECT ar, session_id FROM class_bookings');
  assert.equal(sor.ar, 4000);
  assert.equal(sor.session_id, o2.id);
  // ugyanoda 400
  assert.equal((await post(e, '/foglalas-api/modositas', { t, ora: o2.id })).status, 400);
  // betelt órára 409 betelt, és a foglalás marad
  for (let i = 0; i < 6; i++) await jelentkezz(e, o1, { email: `david.teszt+${i}@example.com` }, `10.0.3.${i}`);
  const b = await post(e, '/foglalas-api/modositas', { t, ora: o1.id });
  assert.equal(b.status, 409);
  assert.equal((await b.json()).kod, 'betelt');
  assert.equal(sorok(e, 'SELECT session_id FROM class_bookings WHERE id = ?', d.azonosito)[0].session_id, o2.id);
  // egyéni időpont-paraméterekkel csoportos tokenre 400
  assert.equal((await post(e, '/foglalas-api/modositas', { t, datum: hetfo, kezd: '10:00' })).status, 400);
});

test('egyéni tokennel az ora mező 400, a régi egyéni módosítás változatlan', async () => {
  const e = ujEnv();
  const { foglalj } = await import('./_foglalo.mjs');
  const f = await foglalj(e);
  const o = await ora(e);
  assert.equal((await post(e, '/foglalas-api/modositas', { t: f.t, ora: o.id })).status, 400);
});

test('párhuzamos áthelyezés az utolsó szabad helyre: pontosan egy jut be, a többiek a régi órán maradnak', async () => {
  const e = ujEnv();
  const hetfo = kovNap(1);
  const cel = await ora(e, '18:15', hetfo); // aerial, 6 hely
  for (let i = 0; i < 5; i++) await jelentkezz(e, cel, { email: `david.teszt+c${i}@example.com` }, `10.0.4.${i}`);
  const forras = await ora(e, '09:00', datumPlusz(hetfo, 4));
  const tokenek = [];
  for (let i = 0; i < 4; i++) {
    const d = await (await jelentkezz(e, forras, { email: `david.teszt+m${i}@example.com` }, `10.0.5.${i}`)).json();
    tokenek.push(tokenBol(d.lemondasUrl));
  }
  const r = await Promise.all(tokenek.map((t, i) => post(e, '/foglalas-api/modositas', { t, ora: cel.id }, { ip: `10.0.6.${i}` })));
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409, 409, 409]);
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM class_bookings WHERE session_id = ? AND status = 'megerositett'`, cel.id)[0].n, 6);
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM class_bookings WHERE session_id = ? AND status = 'megerositett'`, forras.id)[0].n, 3);
});
