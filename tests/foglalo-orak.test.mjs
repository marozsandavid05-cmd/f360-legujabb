// Időpontfoglaló · csoportos órák: séma, kezdő órarend (seed), session-generálás, nyilvános lista.
// Valódi SQLite-tal. Tesztadat: „David teszt”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, get, kovNap, sorok, ujEnv } from './_foglalo.mjs';
import { fakeD1 } from './_d1.mjs';
import { budapestMost, datumPlusz } from '../functions/_lib/booking/ido.js';
import { ORA_TIPUSOK, ORA_SABLONOK } from '../functions/_lib/booking/orak-seed.js';
import { oraGeneral, oraSema } from '../functions/_lib/booking/orak.js';

const MA = budapestMost().datum;

test('seed: a Mexikói út órarendje a mexikoi.html táblája szerint (nap, kezdés, óra, oktató, hossz)', () => {
  const t = (id) => ORA_TIPUSOK.find((x) => x.id === id);
  const sor = ORA_SABLONOK.map((s) => `${s.nap} ${s.kezd} ${t(s.ora).nev} ${s.kollega || '-'} ${t(s.ora).perc}`).sort();
  assert.deepEqual(sor, [
    '1 09:00 Csípőnyitó jóga aczel-gabriella 60',
    '1 17:00 Gyerek core tréning vas-luca 45',
    '1 18:15 Aerial yoga trapeze barkoczy-barbara 60',
    '2 07:30 Core tréning vas-luca 60',
    '2 19:30 Slow Flow barkoczy-barbara 60',
    '3 09:30 Pilates vas-luca 60',
    '3 17:00 Gerinctorna vas-luca 60',
    '3 20:00 Gyertyafényes gerincjóga aczel-gabriella 60',
    '4 10:00 Yin jóga aczel-gabriella 90',
    '4 17:00 Funkcionális tréning - 60',
    '5 09:00 Hatha jóga aczel-gabriella 60',
    '5 18:15 Aerial yoga trapeze barkoczy-barbara 60',
    '6 10:00 Aerial slow flow barkoczy-barbara 60',
  ].sort());
  for (const o of ORA_TIPUSOK) {
    assert.equal(o.helyszin, 'mexikoi');
    assert.equal(o.kapacitas, o.kategoria === 'aerial' ? 6 : 8, o.id);
    assert.equal(o.kapacitas_megerositendo, true);
    assert.equal(o.ar, o.kategoria === 'aerial' ? 4700 : 4000, o.id);
    assert.ok(['joga', 'pilates', 'aerial', 'core', 'gerinc', 'egyeb'].includes(o.kategoria));
  }
});

test('generálás: 8 hétre létrehozza a sessionöket, idempotensen; az oktató és a kapacitás a sablonból', async () => {
  const db = fakeD1();
  await oraSema(db);
  const r1 = await oraGeneral(db, { hetek: 8 });
  const n = db._raw.prepare('SELECT COUNT(*) AS n FROM class_sessions').get().n;
  // 13 sablon, 8 hét: 56 nap alatt minden sablon 8-szor fut (a mai nap is benne, ha még nem múlt el, ezért 104 körül)
  assert.ok(n >= 13 * 8 - 2 && n <= 13 * 8 + 1, String(n));
  assert.equal(r1.letrehozva, n);
  const r2 = await oraGeneral(db, { hetek: 8 });
  assert.equal(r2.letrehozva, 0);
  assert.equal(db._raw.prepare('SELECT COUNT(*) AS n FROM class_sessions').get().n, n);
  const hetfo = kovNap(1);
  const s = db._raw.prepare(`SELECT * FROM class_sessions WHERE datum = ? ORDER BY kezd_min`).all(hetfo);
  assert.deepEqual(s.map((x) => [x.kezd_min, x.kollega_id, x.kapacitas]), [[540, 'aczel-gabriella', 8], [1020, 'vas-luca', 8], [1095, 'barkoczy-barbara', 6]]);
  // múltbeli napra nem generál
  assert.equal(db._raw.prepare('SELECT COUNT(*) AS n FROM class_sessions WHERE datum < ?').get(MA).n, 0);
});

test('seed: egyszer kerül be; ha az admin töröl egy sablont, nem jön vissza', async () => {
  const db = fakeD1();
  await oraSema(db);
  db._raw.prepare(`DELETE FROM class_templates WHERE class_type_id = 'yin-joga'`).run();
  await oraSema({ ...db });
  assert.equal(db._raw.prepare(`SELECT COUNT(*) AS n FROM class_templates WHERE class_type_id = 'yin-joga'`).get().n, 0);
  assert.equal(db._raw.prepare(`SELECT COUNT(*) AS n FROM class_types`).get().n, ORA_TIPUSOK.length);
});

test('GET /foglalas-api/orak: a szerződés szerinti alak (ora, kollega, szabad, foglalhato, ok), tartomány ellenőrizve', async () => {
  const e = ujEnv();
  const hetfo = kovNap(1);
  const r = await get(e, `/foglalas-api/orak?helyszin=mexikoi&tol=${hetfo}&ig=${datumPlusz(hetfo, 6)}`);
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.orak.length, 13);
  const aerial = d.orak.find((o) => o.datum === hetfo && o.kezd === '18:15');
  assert.deepEqual(aerial.ora, { id: 'aerial-yoga-trapeze', nev: 'Aerial yoga trapeze', kategoria: 'aerial', perc: 60, ar: 4700, leiras: '' });
  assert.equal(aerial.kollega.id, 'barkoczy-barbara');
  assert.equal(aerial.kollega.nev, 'Barkóczy Barbara');
  assert.equal(aerial.kollega.foto, '/media/brand/csapat/barkoczy-barbara.jpg');
  assert.ok(!('email' in aerial.kollega));
  assert.equal(aerial.veg, '19:15');
  assert.equal(aerial.kapacitas, 6);
  assert.equal(aerial.szabad, 6);
  assert.equal(aerial.foglalhato, true);
  assert.equal(aerial.ok, null);
  assert.equal(aerial.status, 'aktiv');
  assert.equal(aerial.helyszin.id, 'mexikoi');
  assert.match(aerial.id, /^S[0-9A-Z]{10}$/);
  const funk = d.orak.find((o) => o.ora.nev === 'Funkcionális tréning');
  assert.equal(funk.kollega, null);
  const kulcs = d.orak.map((o) => `${o.datum} ${o.kezd}`);
  assert.deepEqual(kulcs, [...kulcs].sort());
  assert.ok(d.szabalyok.telefon);
  for (const q of ['tol=x&ig=y', `tol=${hetfo}&ig=${datumPlusz(hetfo, -1)}`, `tol=${hetfo}&ig=${datumPlusz(hetfo, 14)}`, `helyszin=nincs&tol=${hetfo}&ig=${hetfo}`]) {
    assert.equal((await get(e, `/foglalas-api/orak?${q}`)).status, 400, q);
  }
  assert.equal((await get(e, `/foglalas-api/orak?tol=${hetfo}&ig=${datumPlusz(hetfo, 13)}`)).status, 200);
  assert.equal((await (await get(e, `/foglalas-api/orak?tol=${hetfo}&ig=${hetfo}`)).json()).orak.length, 3);
  assert.equal((await (await get(e, `/foglalas-api/orak?helyszin=reitter&tol=${hetfo}&ig=${datumPlusz(hetfo, 6)}`)).json()).orak.length, 0);
});

test('reggeli szabály: a 10:00 előtt kezdődő órára az előző nap 22:00 a foglalási határ, máskor minEloreOra', async () => {
  const { oraHatarido } = await import('../functions/_lib/booking/orak.js');
  const { helyiToUtc } = await import('../functions/_lib/booking/ido.js');
  const sz = { minEloreOra: 2, reggeliHatarOra: 22, reggeliKezdesElott: 10 };
  const d = '2026-10-20';
  assert.equal(oraHatarido(d, 9 * 60 + 30, sz), helyiToUtc('2026-10-19', 22 * 60));
  assert.equal(oraHatarido(d, 7 * 60 + 30, sz), helyiToUtc('2026-10-19', 22 * 60));
  assert.equal(oraHatarido(d, 10 * 60, sz), helyiToUtc(d, 10 * 60) - 2 * 3600e3);
  assert.equal(oraHatarido(d, 18 * 60 + 15, sz), helyiToUtc(d, 18 * 60 + 15) - 2 * 3600e3);
  // téli-nyári váltás napján is helyi 22:00 (2026-10-25 vasárnap hajnalban vált)
  assert.equal(oraHatarido('2026-10-26', 9 * 60, sz), helyiToUtc('2026-10-25', 22 * 60));
});

test('a nyilvános lista a határidőn túli órát nem foglalhatónak jelzi', async () => {
  const e = ujEnv();
  const ma = await (await get(e, `/foglalas-api/orak?tol=${MA}&ig=${datumPlusz(MA, 1)}`)).json();
  const most = Date.now();
  for (const o of ma.orak) {
    const ok = Date.parse(o.hatarido) > most && o.szabad > 0 && o.status === 'aktiv';
    assert.equal(o.foglalhato, ok, `${o.datum} ${o.kezd}`);
    assert.ok(ok ? o.ok === null : ['hatarido', 'mult'].includes(o.ok), `${o.datum} ${o.kezd} ${o.ok}`);
  }
  // az admin tábla is létrejött
  assert.ok(sorok(e, `SELECT name FROM sqlite_master WHERE name = 'class_bookings'`).length === 1);
  assert.equal((await admin(e, 'GET', `/api/foglalo/orak?tol=${MA}&ig=${datumPlusz(MA, 6)}`)).status, 200);
});
