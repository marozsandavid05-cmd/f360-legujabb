// Időpontfoglaló · csoportos órák admin API-ja (/api/foglalo/...): lista, résztvevők, kézi felvétel,
// lemondás, elmaradás, óra felülírása, óratípusok és sablonok, generálás; emlékeztető; Access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, get, kovNap, outbox, post, sorok, tokenBol, ujEnv } from './_foglalo.mjs';
import { datumPlusz, helyiToUtc } from '../functions/_lib/booking/ido.js';
import { oraEmlekeztetoFuttat } from '../functions/_lib/booking/orak.js';
import { onRequest as middleware } from '../functions/api/_middleware.js';

const HETFO = kovNap(1);
const ugyfel = (o = {}) => ({ nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true, ...o });
async function ora(e, kezd = '18:15', nap = HETFO) {
  const d = await (await get(e, `/foglalas-api/orak?helyszin=mexikoi&tol=${nap}&ig=${nap}`)).json();
  return d.orak.find((x) => x.kezd === kezd);
}
const jelentkezz = (e, o, extra = {}, ip = '1.2.3.4') => post(e, '/foglalas-api/ora-foglalas', { ora: o.id, ...ugyfel(extra) }, { ip });

test('admin lista: GET /api/foglalo/orak foglalt létszámmal, kolléga-színnel, 92 napig', async () => {
  const e = ujEnv();
  const o = await ora(e);
  await jelentkezz(e, o);
  const r = await admin(e, 'GET', `/api/foglalo/orak?tol=${HETFO}&ig=${HETFO}`);
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  const a = d.orak.find((x) => x.id === o.id);
  assert.equal(a.foglalt, 1);
  assert.equal(a.szabad, 5);
  assert.match(a.kollega.szin, /^#[0-9a-f]{6}$/);
  assert.equal((await admin(e, 'GET', `/api/foglalo/orak?tol=${HETFO}&ig=${datumPlusz(HETFO, 91)}`)).status, 200);
  assert.equal((await admin(e, 'GET', `/api/foglalo/orak?tol=${HETFO}&ig=${datumPlusz(HETFO, 92)}`)).status, 400);
});

test('résztvevők: lista e-maillel és telefonnal, kézi felvétel (e-mail nélkül is), lemondás', async () => {
  const e = ujEnv();
  const o = await ora(e);
  await jelentkezz(e, o);
  const k = await admin(e, 'POST', `/api/foglalo/orak/${o.id}/resztvevok`, { nev: 'David teszt', email: '', telefon: '' });
  assert.equal(k.status, 201, await k.clone().text());
  const kd = await k.json();
  assert.match(kd.azonosito, /^C/);
  const l = await (await admin(e, 'GET', `/api/foglalo/orak/${o.id}/resztvevok`)).json();
  assert.equal(l.resztvevok.length, 2);
  assert.equal(l.ora.foglalt, 2);
  assert.equal(l.resztvevok[0].email, 'david.teszt@example.com');
  assert.equal(l.resztvevok.find((x) => x.azonosito === kd.azonosito).rogzites, 'admin');
  const lem = await admin(e, 'POST', `/api/foglalo/ora-foglalasok/${kd.azonosito}/lemondas`);
  assert.equal(lem.status, 200);
  assert.equal((await admin(e, 'POST', `/api/foglalo/ora-foglalasok/${kd.azonosito}/lemondas`)).status, 410);
  assert.equal((await admin(e, 'POST', `/api/foglalo/ora-foglalasok/CXXXXXXXXXX/lemondas`)).status, 404);
  assert.equal((await admin(e, 'GET', `/api/foglalo/orak/S0000000000/resztvevok`)).status, 404);
  assert.equal((await admin(e, 'GET', `/api/foglalo/orak/rossz/resztvevok`)).status, 400);
});

test('kézi felvétel: betelt órára 409 (az admin sem lépheti túl a kapacitást), a reggeli határ adminnak nem számít', async () => {
  const e = ujEnv();
  const o = await ora(e);
  for (let i = 0; i < 6; i++) await jelentkezz(e, o, { email: `david.teszt+${i}@example.com` }, `10.0.0.${i}`);
  const r = await admin(e, 'POST', `/api/foglalo/orak/${o.id}/resztvevok`, { nev: 'David teszt' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).kod, 'betelt');
});

test('elmaradás: az óra elmarad, minden résztvevő levelet kap (ora-elmarad), nem foglalható; a résztvevő áthelyezhet', async () => {
  const e = ujEnv();
  const o = await ora(e);
  const d1 = await (await jelentkezz(e, o)).json();
  await jelentkezz(e, o, { email: 'david.teszt+2@example.com' }, '10.0.0.2');
  await admin(e, 'POST', `/api/foglalo/orak/${o.id}/resztvevok`, { nev: 'David teszt' }); // e-mail nélkül
  const r = await admin(e, 'POST', `/api/foglalo/orak/${o.id}/elmarad`, { ok: 'Az oktató megbetegedett.' });
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.ertesitve, 2);
  assert.equal(d.resztvevok, 3);
  const levelek = outbox(e, 'ora-elmarad');
  assert.equal(levelek.length, 2);
  assert.ok(levelek[0].html.includes('Az oktató megbetegedett.'));
  const lista = await ora(e);
  assert.equal(lista.status, 'elmarad');
  assert.equal(lista.foglalhato, false);
  assert.equal(lista.ok, 'elmarad');
  assert.equal((await jelentkezz(e, o, { email: 'david.teszt+9@example.com' }, '10.0.9.9')).status, 409);
  assert.equal((await admin(e, 'POST', `/api/foglalo/orak/${o.id}/elmarad`, {})).status, 409);
  // a résztvevő a tokenes linkkel másik órára átjelentkezhet
  const t = tokenBol(d1.lemondasUrl);
  const info = await (await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(t)}`)).json();
  assert.equal(info.foglalas.oraAllapot, 'elmarad');
  assert.equal(info.modosithato, true);
  const masik = await ora(e, '09:00', datumPlusz(HETFO, 4));
  assert.equal((await post(e, '/foglalas-api/modositas', { t, ora: masik.id })).status, 200);
  // elmaradt órára .ics nincs
  const d3 = sorok(e, `SELECT id FROM class_bookings WHERE session_id = ? AND email = 'david.teszt+2@example.com'`, o.id)[0];
  assert.ok(d3);
});

test('óra felülírása: kapacitás, oktató, megjegyzés; a kapacitás nem lehet kisebb a jelentkezettek számánál', async () => {
  const e = ujEnv();
  const o = await ora(e);
  await jelentkezz(e, o);
  await jelentkezz(e, o, { email: 'david.teszt+2@example.com' }, '10.0.0.2');
  const r = await admin(e, 'PATCH', `/api/foglalo/orak/${o.id}`, { kapacitas: 10, kollega: 'aczel-gabriella', megjegyzes: 'Helyettesítés' });
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.kapacitas, 10);
  assert.equal(d.kollega.id, 'aczel-gabriella');
  assert.equal(d.megjegyzes, 'Helyettesítés');
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/orak/${o.id}`, { kapacitas: 1 })).status, 409);
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/orak/${o.id}`, { kollega: 'nincs' })).status, 400);
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/orak/${o.id}`, { status: 'aktiv' })).status, 400);
});

test('óratípusok: lista, létrehozás, módosítás (inaktív típus a nyilvános listából eltűnik); hibás 400', async () => {
  const e = ujEnv();
  const l = await (await admin(e, 'GET', '/api/foglalo/ora-tipusok')).json();
  assert.equal(l.tipusok.length, 12);
  assert.equal(l.tipusok.find((t) => t.id === 'yin-joga').kapacitas_megerositendo, true);
  const uj = await admin(e, 'POST', '/api/foglalo/ora-tipusok', { nev: 'David teszt jóga', helyszin: 'mexikoi', perc: 60, ar: 4000, kapacitas: 8, kategoria: 'joga' });
  assert.equal(uj.status, 201, await uj.clone().text());
  assert.equal((await uj.json()).id, 'david-teszt-joga');
  for (const rossz of [{ kategoria: 'tanc' }, { perc: 7 }, { kapacitas: 0 }, { helyszin: 'nincs' }, { nev: '' }, { aktiv: 'igen' }, { mas: 1 }]) {
    const r = await admin(e, 'POST', '/api/foglalo/ora-tipusok', { nev: 'X', helyszin: 'mexikoi', perc: 60, ar: 1, kapacitas: 8, kategoria: 'joga', ...rossz });
    assert.equal(r.status, 400, JSON.stringify(rossz));
  }
  const m = await admin(e, 'PATCH', '/api/foglalo/ora-tipusok/yin-joga', { aktiv: false, kapacitas: 12 });
  assert.equal(m.status, 200);
  assert.equal((await m.json()).kapacitas, 12);
  const csut = kovNap(4);
  const lista = await (await get(e, `/foglalas-api/orak?helyszin=mexikoi&tol=${csut}&ig=${csut}`)).json();
  assert.ok(!lista.orak.some((o) => o.ora.id === 'yin-joga'));
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/ora-tipusok/nincs', { aktiv: true })).status, 404);
});

test('sablonok: létrehozás generál, oktatócsere átvezetődik, időpont-változás újragenerál, törlés; résztvevős óra marad', async () => {
  const e = ujEnv();
  const l = await (await admin(e, 'GET', '/api/foglalo/ora-sablonok')).json();
  assert.equal(l.sablonok.length, 13);
  const uj = await admin(e, 'POST', '/api/foglalo/ora-sablonok', { ora: 'hatha-joga', kollega: 'aczel-gabriella', nap: 7, kezd: '10:00' });
  assert.equal(uj.status, 201, await uj.clone().text());
  const s = await uj.json();
  assert.ok(s.letrehozva >= 7);
  const vas = kovNap(7);
  const o = (await (await get(e, `/foglalas-api/orak?tol=${vas}&ig=${vas}`)).json()).orak.find((x) => x.kezd === '10:00');
  assert.ok(o);
  await jelentkezz(e, o);
  // oktatócsere minden jövőbeli órára
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/ora-sablonok/${s.id}`, { kollega: 'vas-luca' })).status, 200);
  assert.equal((await (await get(e, `/foglalas-api/orak?tol=${vas}&ig=${vas}`)).json()).orak.find((x) => x.id === o.id).kollega.id, 'vas-luca');
  // időpont-változás: a résztvevős óra marad (aznap nem jön mellé új), a többi hét átkerül 11:00-ra
  const m = await admin(e, 'PATCH', `/api/foglalo/ora-sablonok/${s.id}`, { kezd: '11:00' });
  assert.equal(m.status, 200, await m.clone().text());
  const nap = (await (await get(e, `/foglalas-api/orak?tol=${vas}&ig=${vas}`)).json()).orak;
  assert.deepEqual(nap.map((x) => [x.id === o.id, x.kezd]), [[true, '10:00']]);
  const kov = datumPlusz(vas, 7);
  const kovNapOrak = (await (await get(e, `/foglalas-api/orak?tol=${kov}&ig=${kov}`)).json()).orak;
  assert.deepEqual(kovNapOrak.map((x) => x.kezd), ['11:00']);
  // törlés
  const t = await admin(e, 'DELETE', `/api/foglalo/ora-sablonok/${s.id}`);
  assert.equal(t.status, 200);
  const td = await t.json();
  assert.equal(td.resztvevosOrakMaradtak, 1);
  assert.equal((await (await get(e, `/foglalas-api/orak?tol=${kov}&ig=${kov}`)).json()).orak.length, 0);
  for (const rossz of [{ ora: 'nincs', nap: 1, kezd: '10:00' }, { ora: 'pilates', nap: 8, kezd: '10:00' }, { ora: 'pilates', nap: 1, kezd: '10:10' }, { ora: 'pilates', nap: 1, kezd: '10:00', kollega: 'nincs' }]) {
    assert.equal((await admin(e, 'POST', '/api/foglalo/ora-sablonok', rossz)).status, 400, JSON.stringify(rossz));
  }
  assert.equal((await admin(e, 'DELETE', `/api/foglalo/ora-sablonok/${s.id}`)).status, 404);
});

test('generálás kézzel: POST /api/foglalo/orak/general idempotens', async () => {
  const e = ujEnv();
  await get(e, `/foglalas-api/orak?tol=${HETFO}&ig=${HETFO}`);
  const r = await admin(e, 'POST', '/api/foglalo/orak/general', {});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).letrehozva, 0);
});

test('emlékeztető: 30 órán belüli óra résztvevője egyszer kap; elmaradt órára nem', async () => {
  const e = ujEnv();
  const o = await ora(e);
  await jelentkezz(e, o);
  const S = helyiToUtc(HETFO, 18 * 60 + 15);
  const fut = (most) => oraEmlekeztetoFuttat(e, e.BOOKING_DB, { origin: 'https://x.pages.dev', most });
  assert.equal((await fut(S - 31 * 3600e3)).emlekeztetve, 0);
  assert.equal((await fut(S - 29 * 3600e3)).emlekeztetve, 1);
  assert.equal((await fut(S - 28 * 3600e3)).emlekeztetve, 0);
  const [l] = outbox(e, 'emlekezteto');
  assert.ok(l.html.includes('Aerial yoga trapeze'));
  assert.ok(l.html.includes('/foglalas/lemondas?t=C'));
  const e2 = ujEnv();
  const o2 = await ora(e2);
  await jelentkezz(e2, o2);
  await admin(e2, 'POST', `/api/foglalo/orak/${o2.id}/elmarad`, {});
  assert.equal((await oraEmlekeztetoFuttat(e2, e2.BOOKING_DB, { origin: 'https://x', most: S - 29 * 3600e3 })).emlekeztetve, 0);
});

test('oktatói értesítő: ha a kolléga e-mailje meg van adva, új jelentkezésről levelet kap a létszámmal', async () => {
  const e = ujEnv();
  await admin(e, 'PATCH', '/api/foglalo/kollegak/barkoczy-barbara', { email: 'david.teszt.oktato@example.com' });
  const o = await ora(e);
  await jelentkezz(e, o);
  const l = outbox(e, 'kollega-uj');
  assert.equal(l.length, 1);
  assert.equal(l[0].cimzett, 'david.teszt.oktato@example.com');
  assert.ok(l[0].html.includes('1 / 6'));
  // a vendég lemondó linkje nincs benne
  assert.ok(!l[0].html.includes('/foglalas/lemondas'));
});

test('az új admin végpontok Access nélkül (élesben) 401-et adnak', async () => {
  const e = ujEnv({ ACCESS_TEAM_DOMAIN: 'teszt.cloudflareaccess.com', ACCESS_AUD: 'aud' });
  for (const [m, p] of [['GET', `/api/foglalo/orak?tol=${HETFO}&ig=${HETFO}`], ['GET', '/api/foglalo/ora-tipusok'], ['POST', '/api/foglalo/orak/general'], ['DELETE', '/api/foglalo/ora-sablonok/x']]) {
    const request = new Request(`https://f360.example${p}`, { method: m, headers: { Origin: 'https://f360.example' } });
    const ctx = { request, env: e, data: {}, params: {}, next: () => new Response('átjutott') };
    const r = await middleware(ctx);
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

// ---- független review javításai (regressziós tesztek)

test('review 1: sablon-időpont változásakor az elmaradt óra elmaradt marad, az aznapi új óra nem jön létre', async () => {
  const e = ujEnv();
  const o = await ora(e, '18:15', HETFO);
  assert.equal((await admin(e, 'POST', `/api/foglalo/orak/${o.id}/elmarad`, { ok: 'David teszt' })).status, 200);
  const sablon = (await (await admin(e, 'GET', '/api/foglalo/ora-sablonok')).json()).sablonok.find((s) => s.nap === 1 && s.kezd === '18:15');
  assert.equal((await admin(e, 'PATCH', `/api/foglalo/ora-sablonok/${sablon.id}`, { kezd: '18:30' })).status, 200);
  const nap = (await (await get(e, `/foglalas-api/orak?tol=${HETFO}&ig=${HETFO}`)).json()).orak.filter((x) => x.ora.id === 'aerial-yoga-trapeze');
  assert.deepEqual(nap.map((x) => [x.kezd, x.status]), [['18:15', 'elmarad']]);
  // a következő héten már az új időpont
  const kov = datumPlusz(HETFO, 7);
  const k = (await (await get(e, `/foglalas-api/orak?tol=${kov}&ig=${kov}`)).json()).orak.filter((x) => x.ora.id === 'aerial-yoga-trapeze');
  assert.deepEqual(k.map((x) => [x.kezd, x.status]), [['18:30', 'aktiv']]);
});

test('review 1b: a lemondott jelentkezésű óra a sablon változásakor sem törlődik (a lemondó link nem lesz 404)', async () => {
  const e = ujEnv();
  const o = await ora(e, '18:15', HETFO);
  const d = await (await jelentkezz(e, o)).json();
  await post(e, '/foglalas-api/lemondas', { t: tokenBol(d.lemondasUrl) });
  const sablon = (await (await admin(e, 'GET', '/api/foglalo/ora-sablonok')).json()).sablonok.find((s) => s.nap === 1 && s.kezd === '18:15');
  await admin(e, 'PATCH', `/api/foglalo/ora-sablonok/${sablon.id}`, { kezd: '18:30' });
  assert.equal((await get(e, `/foglalas-api/lemondas?t=${encodeURIComponent(tokenBol(d.lemondasUrl))}`)).status, 200);
});

test('review 2: áthelyezés e-mail nélküli (admin) jelentkezésnél nem 500, és a válasz levele az áthelyezésről szól', async () => {
  const e = ujEnv();
  const o = await ora(e);
  const k = await (await admin(e, 'POST', `/api/foglalo/orak/${o.id}/resztvevok`, { nev: 'David teszt' })).json();
  const masik = await ora(e, '09:00', datumPlusz(HETFO, 4));
  const r = await post(e, '/foglalas-api/modositas', { t: tokenBol(k.lemondasUrl), ora: masik.id });
  assert.equal(r.status, 200, await r.clone().text());
  // oktatói címmel: a válasz levele a vendégé (áthelyezés), nem az oktatói értesítő
  const e2 = ujEnv();
  await admin(e2, 'PATCH', '/api/foglalo/kollegak/aczel-gabriella', { email: 'david.teszt.oktato@example.com' });
  const o2 = await ora(e2);
  const d2 = await (await jelentkezz(e2, o2)).json();
  const m2 = await ora(e2, '09:00', datumPlusz(HETFO, 4));
  const r2 = await (await post(e2, '/foglalas-api/modositas', { t: tokenBol(d2.lemondasUrl), ora: m2.id })).json();
  assert.match(r2.level.targy, /^Óra áthelyezve/);
  // kézi felvétel e-mail nélkül, oktatói címmel: a válasz levele nem az oktatóé
  const k2 = await (await admin(e2, 'POST', `/api/foglalo/orak/${m2.id}/resztvevok`, { nev: 'David teszt' })).json();
  assert.doesNotMatch(k2.level.targy || '', /Új jelentkezés/);
});

test('review 3: ha az elmaradás közben kicserélődik egy résztvevő (azonos létszám), 409, és rossz címzett nem kap levelet', async () => {
  const e = ujEnv();
  const o = await ora(e);
  await jelentkezz(e, o, { email: 'david.teszt+a@example.com' }, '10.0.7.1');
  const raw = e.BOOKING_DB._raw;
  const eredeti = e.BOOKING_DB.batch;
  let egyszer = true;
  // a résztvevők beolvasása és a batch között: A lemond, B jelentkezik (a létszám ugyanaz)
  e.BOOKING_DB.batch = async (list) => {
    if (egyszer && list.length >= 2) {
      egyszer = false;
      raw.prepare(`UPDATE class_bookings SET status = 'lemondva' WHERE email = 'david.teszt+a@example.com'`).run();
      raw.prepare(`INSERT INTO class_bookings (id, session_id, nev, email, status, so, created_at) VALUES ('CBBBBBBBBBB', ?, 'David teszt', 'david.teszt+b@example.com', 'megerositett', 'so', 1)`).run(o.id);
    }
    return eredeti(list);
  };
  const r = await admin(e, 'POST', `/api/foglalo/orak/${o.id}/elmarad`, {});
  assert.equal(r.status, 409, await r.clone().text());
  assert.equal(outbox(e, 'ora-elmarad').length, 0);
  e.BOOKING_DB.batch = eredeti;
  const r2 = await admin(e, 'POST', `/api/foglalo/orak/${o.id}/elmarad`, {});
  assert.equal(r2.status, 200);
  assert.deepEqual(outbox(e, 'ora-elmarad').map((l) => l.cimzett), ['david.teszt+b@example.com']);
});

test('review: múltbeli órát nem lehet elmaradtnak jelölni (409)', async () => {
  const e = ujEnv();
  await get(e, `/foglalas-api/orak?tol=${HETFO}&ig=${HETFO}`);
  e.BOOKING_DB._raw.prepare(`INSERT INTO class_sessions (id, class_type_id, kollega_id, datum, kezd_min, perc, kapacitas, status, created_at) VALUES ('SMULT000000', 'pilates', NULL, '2020-01-06', 600, 60, 8, 'aktiv', 1)`).run();
  assert.equal((await admin(e, 'POST', '/api/foglalo/orak/SMULT000000/elmarad', {})).status, 409);
});
