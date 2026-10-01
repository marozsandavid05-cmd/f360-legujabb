// Időpontfoglaló · emlékeztető a páciensnek (Lilla: kb. 30 órával előtte), outboxba.
//   POST /foglalas-api/cron/emlekezteto   X-Cron-Kulcs: <CRON_SECRET>  (nincs beállítva: 503, rossz: 401)
//   POST /api/foglalo/emlekezteto/futtat  (admin, kézi indítás)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, foglalj, keres, NAP, ORIGIN, outbox, post, sorok, szabalyAtir, ujEnv } from './_foglalo.mjs';
import { emlekeztetoFuttat } from '../functions/_lib/booking/emlekezteto.js';
import { helyiToUtc, datumPlusz } from '../functions/_lib/booking/ido.js';

const ORA = 3600e3;
const S = helyiToUtc(NAP, 600); // a teszt-foglalás kezdése (NAP 10:00, Budapest)
const futtat = (e, most) => emlekeztetoFuttat(e, e.BOOKING_DB, { origin: ORIGIN, most });
const CRON = 'cron-titok-'.padEnd(40, 'y');
const cron = (e, kulcs) => keres(e, 'POST', '/foglalas-api/cron/emlekezteto', { origin: null, headers: kulcs == null ? {} : { 'X-Cron-Kulcs': kulcs } });

test('emlékeztető-ablak: 30,1 órával előtte még nem, pontosan 30 és 29,9 órával előtte igen', async () => {
  const e = ujEnv();
  await foglalj(e);
  assert.equal((await futtat(e, S - 30.1 * ORA)).emlekeztetve, 0);
  assert.equal(outbox(e, 'emlekezteto').length, 0);
  assert.equal((await futtat(e, S - 30 * ORA)).emlekeztetve, 1);
  assert.equal(outbox(e, 'emlekezteto').length, 1);
  const e2 = ujEnv();
  await foglalj(e2);
  assert.equal((await futtat(e2, S - 29.9 * ORA)).emlekeztetve, 1);
});

test('emlékeztető tartalma: a páciensnek, „Időpont lemondása / módosítása” gomb a tokenes linkre, határidő', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  await futtat(e, S - 29 * ORA);
  const [l] = outbox(e, 'emlekezteto');
  assert.equal(l.cimzett, 'david.teszt@example.com');
  assert.equal(l.booking_id, f.azonosito);
  assert.equal(l.sent, 0);
  assert.match(l.targy, /Emlékeztető/);
  assert.ok(l.html.includes('>Időpont lemondása / módosítása</a>'));
  assert.ok(l.html.includes(`href="${f.lemondasUrl.replace(/&/g, '&amp;')}"`));
  assert.ok(l.szoveg.includes(f.lemondasUrl));
  // a határidő: 24 órával a kezdés előtt (NAP előtti nap 10:00)
  const hatarido = new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(S - 24 * ORA));
  assert.ok(l.html.includes(hatarido), hatarido);
  assert.ok(l.html.includes('David teszt') && l.html.includes('10:00'));
  assert.ok(sorok(e, 'SELECT emlekeztetve_at FROM bookings')[0].emlekeztetve_at > 0);
});

test('idempotens: másodszor és párhuzamosan futtatva is egy levél', async () => {
  const e = ujEnv();
  await foglalj(e);
  const r = await Promise.all([futtat(e, S - 29 * ORA), futtat(e, S - 29 * ORA), futtat(e, S - 28 * ORA)]);
  assert.equal(r.reduce((a, x) => a + x.emlekeztetve, 0), 1);
  assert.equal((await futtat(e, S - 25 * ORA)).emlekeztetve, 0);
  assert.equal(outbox(e, 'emlekezteto').length, 1);
});

test('nem küld: lemondott, elmúlt, és a 30 órán belül foglalt (közelebbi) időpontra', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  await post(e, '/foglalas-api/lemondas', { t: f.t });
  assert.equal((await futtat(e, S - 29 * ORA)).emlekeztetve, 0);
  const g = await foglalj(e, { kezd: '12:00' }, '2.2.2.2');
  const S2 = helyiToUtc(NAP, 720);
  // úgy, mintha 20 órával a kezdés előtt foglalták volna
  e.BOOKING_DB._raw.prepare('UPDATE bookings SET created_at = ? WHERE id = ?').run(S2 - 20 * ORA, g.azonosito);
  assert.equal((await futtat(e, S2 - 19 * ORA)).emlekeztetve, 0);
  assert.equal((await futtat(e, S2 + 60e3)).emlekeztetve, 0); // már elkezdődött
  assert.equal(outbox(e, 'emlekezteto').length, 0);
});

test('a gomb a 30 és 24 óra közötti ablakban végig ott van, 24 órán belül telefonszám', async () => {
  const gombos = async (oraElotte) => {
    const e = ujEnv();
    await foglalj(e);
    assert.equal((await futtat(e, S - oraElotte * ORA)).emlekeztetve, 1, `${oraElotte} óra`);
    const [l] = outbox(e, 'emlekezteto');
    return { gomb: l.html.includes('>Időpont lemondása / módosítása</a>'), tel: l.html.includes('hívj minket minél előbb') };
  };
  for (const o of [30, 28, 25, 24.01]) assert.deepEqual(await gombos(o), { gomb: true, tel: false }, `${o} óra`);
  for (const o of [24, 23.9, 2]) assert.deepEqual(await gombos(o), { gomb: false, tel: true }, `${o} óra`);
});

test('a lemondási határidő után (késve futó ütemező): elmegy, de gomb helyett a telefonszám', async () => {
  const e = ujEnv();
  await foglalj(e);
  assert.equal((await futtat(e, S - 20 * ORA)).emlekeztetve, 1);
  const [l] = outbox(e, 'emlekezteto');
  assert.ok(!l.html.includes('>Időpont lemondása / módosítása</a>'));
  assert.ok(l.html.includes('+36 30 503 0578'));
});

test('beállítások: emlekeztetoBe = false semmit nem ír; emlekeztetoOra = 48 a 48 órás ablakot használja', async () => {
  const e = ujEnv();
  await foglalj(e);
  await szabalyAtir(e, { emlekeztetoBe: false });
  const r = await futtat(e, S - 29 * ORA);
  assert.equal(r.kikapcsolva, true);
  assert.equal(r.emlekeztetve, 0);
  assert.equal(sorok(e, 'SELECT emlekeztetve_at FROM bookings')[0].emlekeztetve_at, null);
  await szabalyAtir(e, { emlekeztetoBe: true, emlekeztetoOra: 48 });
  assert.equal((await futtat(e, S - 48.1 * ORA)).emlekeztetve, 0);
  assert.equal((await futtat(e, S - 47.9 * ORA)).emlekeztetve, 1);
});

test('módosítás után az új időpontra újra jár emlékeztető; közeli időpontra áthelyezve nem', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  await futtat(e, S - 29 * ORA);
  const HET = datumPlusz(NAP, 7);
  assert.equal((await post(e, '/foglalas-api/modositas', { t: f.t, datum: HET, kezd: '10:00', kollega: 'szegedi-botond' })).status, 200);
  assert.equal(sorok(e, 'SELECT emlekeztetve_at FROM bookings')[0].emlekeztetve_at, null);
  const S3 = helyiToUtc(HET, 600);
  assert.equal((await futtat(e, S3 - 29 * ORA)).emlekeztetve, 1);
  assert.equal(outbox(e, 'emlekezteto').length, 2);
  // ha a módosítás az ablakon belül történt (a módosító levél ideje 10 órával a kezdés előtt), nincs emlékeztető
  const HET2 = datumPlusz(NAP, 14);
  assert.equal((await post(e, '/foglalas-api/modositas', { t: f.t, datum: HET2, kezd: '10:00', kollega: 'szegedi-botond' })).status, 200);
  const S4 = helyiToUtc(HET2, 600);
  e.BOOKING_DB._raw.prepare(`UPDATE outbox SET created_at = ? WHERE tipus = 'modositas' AND id = (SELECT MAX(id) FROM outbox WHERE tipus = 'modositas')`).run(S4 - 10 * ORA);
  assert.equal((await futtat(e, S4 - 9 * ORA)).emlekeztetve, 0);
});

test('cron végpont: CRON_SECRET nélkül 503, kulcs nélkül és rossz kulccsal 401, jó kulccsal 200', async () => {
  const e = ujEnv();
  assert.equal((await cron(e, CRON)).status, 503);
  const e2 = ujEnv({ CRON_SECRET: CRON });
  assert.equal((await cron(e2, null)).status, 401);
  assert.equal((await cron(e2, 'rossz')).status, 401);
  assert.equal((await cron(e2, CRON.slice(0, -1) + 'z')).status, 401);
  const r = await cron(e2, CRON);
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(typeof d.emlekeztetve, 'number');
  assert.equal(d.mod, 'outbox');
  assert.equal((await keres(e2, 'GET', '/foglalas-api/cron/emlekezteto', { headers: { 'X-Cron-Kulcs': CRON } })).status, 405);
  // túl rövid titok is kikapcsolt állapotnak számít
  assert.equal((await cron(ujEnv({ CRON_SECRET: 'rovid' }), 'rovid')).status, 503);
});

test('admin kézi indítás: POST /api/foglalo/emlekezteto/futtat 200, a számokkal', async () => {
  const e = ujEnv();
  const r = await admin(e, 'POST', '/api/foglalo/emlekezteto/futtat', {});
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.emlekeztetve, 0);
  assert.equal(d.kikapcsolva, false);
  assert.equal((await admin(e, 'GET', '/api/foglalo/emlekezteto/futtat')).status, 405);
});
