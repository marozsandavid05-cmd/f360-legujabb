// Időpontfoglaló · a csoportos-kör törzsadata: Barkóczy Barbara, Aczél Gabriella, Kovács Anna,
// a táplálkozási szolgáltatások (alapcsomag, kiegészítő tanácsadás, InBody), a kollégák fotója és a
// meglévő (élő) adatbázis idempotens migrációja. Valódi SQLite-tal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, get, ujEnv } from './_foglalo.mjs';
import { fakeD1 } from './_d1.mjs';
import { SEED_TORZS, SEED_BEOSZTAS } from '../functions/_lib/booking/seed.js';
import { torzsBetolt } from '../functions/_lib/booking/schema.js';
import { torzsEllenoriz } from '../functions/_lib/booking/admin.js';
import { visszaigazolas } from '../functions/_lib/booking/levelek.js';

const UJ_KOLLEGAK = ['barkoczy-barbara', 'aczel-gabriella', 'kovacs-anna'];
const UJ_SZOLG = ['taplalkozas-alapcsomag', 'taplalkozas-kiegeszito', 'inbody-770'];
const FOTOS = ['aczel-gabriella', 'adorjani-anna', 'barkoczy-barbara', 'kodacsine-labancz-agnes', 'kovacs-anna', 'osvath-bence', 'szegedi-botond', 'vas-luca'];
const MERES_ELOTT = [
  'a mérés előtt 2 órával már ne étkezz',
  'csak tiszta víz vagy ízesítetlen tea',
  'előtte pár órával ne végezz megerőltető edzést',
  'fém ékszereket vedd le',
  'a mérés fehérneműben történik',
];

/** A csoportos-kör előtti (élő) törzsadat: 6 kolléga, 11 szolgáltatás, régi szerep, fotó nélkül. */
function regiTorzs() {
  const t = structuredClone(SEED_TORZS);
  t.kollegak = t.kollegak.filter((k) => !UJ_KOLLEGAK.includes(k.id)).map(({ foto: _f, ...k }) => k);
  t.szolgaltatasok = t.szolgaltatasok.filter((s) => !UJ_SZOLG.includes(s.id))
    .map(({ leiras: _l, elokeszites: _e, idotartam_megerositendo: _i, ...s }) => s);
  t.kollegak.find((k) => k.id === 'vas-luca').szerep = 'gyógytornász, perinatális tréner';
  t.kollegak.find((k) => k.id === 'szegedi-botond').szerep = 'gyógymasszőr, nyirokmasszőr, sportmasszőr';
  return t;
}
function regiDb(torzs = regiTorzs()) {
  const db = fakeD1();
  db._raw.exec(`CREATE TABLE settings (kulcs TEXT PRIMARY KEY, ertek TEXT NOT NULL, modositva INTEGER NOT NULL)`);
  db._raw.prepare(`INSERT INTO settings VALUES ('torzs', ?, 1)`).run(JSON.stringify(torzs));
  return db;
}

test('seed: a 9 kolléga közül az új hárman a Mexikói úton, a Rólunk szerinti szereppel, saját színnel', () => {
  const k = (id) => SEED_TORZS.kollegak.find((x) => x.id === id);
  assert.equal(SEED_TORZS.kollegak.length, 9);
  assert.deepEqual({ nev: k('barkoczy-barbara').nev, szerep: k('barkoczy-barbara').szerep, h: k('barkoczy-barbara').helyszinek },
    { nev: 'Barkóczy Barbara', szerep: 'jógaoktató, aerial jóga, aerial trapéz', h: ['mexikoi'] });
  assert.deepEqual({ nev: k('aczel-gabriella').nev, szerep: k('aczel-gabriella').szerep, h: k('aczel-gabriella').helyszinek },
    { nev: 'Aczél Gabriella', szerep: 'jógaoktató, gerincjóga, Yin jóga', h: ['mexikoi'] });
  assert.deepEqual({ nev: k('kovacs-anna').nev, szerep: k('kovacs-anna').szerep, h: k('kovacs-anna').helyszinek },
    { nev: 'Kovács Anna', szerep: 'táplálkozási tanácsadó, InBody, alapító', h: ['mexikoi'] });
  assert.deepEqual(k('kovacs-anna').szolgaltatasok, UJ_SZOLG);
  assert.equal(k('vas-luca').szerep, 'gyógytornász, perinatális tréner, SEAS terapeuta');
  assert.equal(new Set(SEED_TORZS.kollegak.map((x) => x.szin)).size, 9);
  for (const id of FOTOS) assert.equal(k(id).foto, `/media/brand/csapat/${id}.jpg`, id);
  assert.ok(!k('kovacs-sebestyen').foto, 'Kovács Sebestyénnek nincs fotója');
  // Kovács Annának nincs kitalált beosztása
  assert.ok(!SEED_BEOSZTAS.some((b) => b.kollega === 'kovacs-anna'));
});

test('seed: a táplálkozási szolgáltatások az Árak oldal szerint, megerősítendő időtartammal', () => {
  const s = (id) => SEED_TORZS.szolgaltatasok.find((x) => x.id === id);
  assert.deepEqual([s('taplalkozas-alapcsomag').perc, s('taplalkozas-alapcsomag').ar], [60, 60000]);
  assert.deepEqual([s('taplalkozas-kiegeszito').perc, s('taplalkozas-kiegeszito').ar], [45, 10000]);
  assert.deepEqual([s('inbody-770').perc, s('inbody-770').ar], [20, 10000]);
  for (const id of UJ_SZOLG) {
    assert.equal(s(id).idotartam_megerositendo, true, id);
    assert.deepEqual(s(id).helyszinek, ['mexikoi']);
  }
  assert.equal(s('taplalkozas-alapcsomag').nev, 'Táplálkozási alapcsomag (felmérés + InBody + 3 konzultáció)');
  assert.equal(s('taplalkozas-alapcsomag').leiras, 'Az alapcsomag további 3 konzultációját az első alkalmon egyeztetjük.');
  assert.equal(s('taplalkozas-kiegeszito').nev, 'Kiegészítő tanácsadás');
  assert.equal(s('inbody-770').nev, 'InBody 770 testösszetétel-elemzés, önálló');
  assert.deepEqual(s('inbody-770').elokeszites, MERES_ELOTT);
  assert.deepEqual(s('taplalkozas-alapcsomag').elokeszites, MERES_ELOTT);
});

test('admin-mentés: a szolgáltatás leírása, előkészítése és megerősítendő jelzése megmarad, a hibás 400', async () => {
  const be = structuredClone(SEED_TORZS);
  const ki = torzsEllenoriz(be);
  const s = ki.szolgaltatasok.find((x) => x.id === 'inbody-770');
  assert.deepEqual(s.elokeszites, MERES_ELOTT);
  assert.equal(s.idotartam_megerositendo, true);
  assert.equal(ki.szolgaltatasok.find((x) => x.id === 'taplalkozas-alapcsomag').leiras.length > 10, true);
  for (const rossz of [{ leiras: 5 }, { leiras: 'x'.repeat(1001) }, { elokeszites: 'nem lista' }, { elokeszites: ['x'.repeat(201)] },
    { elokeszites: Array(11).fill('a') }, { idotartam_megerositendo: 'igen' }]) {
    const t = structuredClone(SEED_TORZS);
    Object.assign(t.szolgaltatasok.find((x) => x.id === 'inbody-770'), rossz);
    assert.throws(() => torzsEllenoriz(t), /Hibás|Túl hosszú/, JSON.stringify(rossz));
  }
  // a valódi PUT-tal is: a mentés után visszaolvasva megvan
  const e = ujEnv();
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  t.szolgaltatasok.find((x) => x.id === 'inbody-770').leiras = 'Teszt leírás.';
  const r = await admin(e, 'PUT', '/api/foglalo/beallitasok', t);
  assert.equal(r.status, 200, await r.clone().text());
  const vissza = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const ib = vissza.szolgaltatasok.find((x) => x.id === 'inbody-770');
  assert.equal(ib.leiras, 'Teszt leírás.');
  assert.deepEqual(ib.elokeszites, MERES_ELOTT);
});

test('katalógus: Kovács Anna szolgáltatásai látszanak leírással, de beosztás nélkül vanBeosztas = false', async () => {
  const e = ujEnv();
  const k = await (await get(e, '/foglalas-api/katalogus')).json();
  const ib = k.szolgaltatasok.find((x) => x.id === 'inbody-770');
  assert.equal(ib.vanBeosztas, false);
  assert.deepEqual(ib.elokeszites, MERES_ELOTT);
  assert.equal(k.szolgaltatasok.find((x) => x.id === 'taplalkozas-alapcsomag').leiras, 'Az alapcsomag további 3 konzultációját az első alkalmon egyeztetjük.');
  assert.equal(k.szolgaltatasok.find((x) => x.id === 'gyogymasszazs-50').vanBeosztas, true);
  const anna = k.kollegak.find((x) => x.id === 'kovacs-anna');
  assert.equal(anna.foto, '/media/brand/csapat/kovacs-anna.jpg');
  assert.ok(!('email' in anna));
  // beosztás után már van
  const b = await admin(e, 'PUT', '/api/foglalo/beosztas?kollega=kovacs-anna', { sorok: [{ nap: 2, helyszin: 'mexikoi', kezd: '09:00', veg: '12:00' }] });
  assert.equal(b.status, 200, await b.clone().text());
  const k2 = await (await get(e, '/foglalas-api/katalogus')).json();
  assert.equal(k2.szolgaltatasok.find((x) => x.id === 'inbody-770').vanBeosztas, true);
});

test('InBody visszaigazolás: a „Mérés előtt” lista a levélben (HTML és szöveg)', () => {
  const f = {
    azonosito: 'F0123456789', datum: '2026-10-20', kezd: '09:00', veg: '09:20', kezdPerc: 540, nev: 'David teszt', email: 'david.teszt@example.com',
    helyszin: { id: 'mexikoi', nev: 'Mexikói út', cim: 'Mexikói út 32/b' },
    szolgaltatas: { id: 'inbody-770', nev: 'InBody 770 testösszetétel-elemzés, önálló', perc: 20, ar: 10000, elokeszites: MERES_ELOTT },
    kollega: { id: 'kovacs-anna', nev: 'Kovács Anna' },
  };
  const l = visszaigazolas(f, { lemondasUrl: 'https://x/l?t=a', icsUrl: 'https://x/i', szabalyok: SEED_TORZS.szabalyok, ics: 'ICS' });
  assert.match(l.html, /Mérés előtt/);
  assert.match(l.szoveg, /Mérés előtt/);
  for (const p of MERES_ELOTT) {
    assert.ok(l.html.includes(p), p);
    assert.ok(l.szoveg.includes(p), p);
  }
  // más szolgáltatásnál nincs ilyen blokk
  const m = visszaigazolas({ ...f, szolgaltatas: { ...f.szolgaltatas, elokeszites: undefined } }, { lemondasUrl: 'https://x', icsUrl: 'https://x', szabalyok: SEED_TORZS.szabalyok });
  assert.doesNotMatch(m.html, /Mérés előtt/);
});

test('InBody foglalás: a valódi foglalás visszaigazoló levelében benne a mérés előtti lista', async () => {
  const e = ujEnv();
  await admin(e, 'PUT', '/api/foglalo/beosztas?kollega=kovacs-anna', { sorok: [1, 2, 3, 4, 5].map((nap) => ({ nap, helyszin: 'mexikoi', kezd: '09:00', veg: '12:00' })) });
  const { NAP, alap, post } = await import('./_foglalo.mjs');
  const r = await post(e, '/foglalas-api/foglalas', alap({ szolgaltatas: 'inbody-770', kollega: 'kovacs-anna', kezd: '09:00' }));
  assert.equal(r.status, 201, await r.clone().text());
  const d = await r.json();
  assert.ok(d.level.html.includes('fém ékszereket vedd le'));
  assert.equal(d.foglalas.datum, NAP);
});

test('migráció: a régi (élő) törzshöz hozzáadja az új kollégákat, szolgáltatásokat, fotókat és a szerepet, egyszer', async () => {
  const db = regiDb();
  const t = await torzsBetolt(db);
  assert.equal(t.kollegak.length, 9);
  for (const id of UJ_KOLLEGAK) assert.ok(t.kollegak.some((k) => k.id === id), id);
  for (const id of UJ_SZOLG) assert.ok(t.szolgaltatasok.some((s) => s.id === id), id);
  const k = (id) => t.kollegak.find((x) => x.id === id);
  assert.equal(k('vas-luca').szerep, 'gyógytornász, perinatális tréner, SEAS terapeuta');
  assert.equal(k('szegedi-botond').szerep, SEED_TORZS.kollegak.find((x) => x.id === 'szegedi-botond').szerep);
  for (const id of FOTOS) assert.equal(k(id).foto, `/media/brand/csapat/${id}.jpg`, id);
  assert.equal(new Set(t.kollegak.map((x) => x.szin)).size, 9, 'a színek egyediek maradnak');
  // ténylegesen el is mentette (nem csak a válaszban)
  const mentett = JSON.parse(db._raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
  assert.equal(mentett.kollegak.length, 9);
  // második betöltés: nem duplikál
  const t2 = await torzsBetolt({ ...db });
  assert.equal(t2.kollegak.length, 9);
  assert.equal(t2.szolgaltatasok.length, 14);
});

test('migráció: a meglévő (Lilla által szerkesztett) adatot nem írja felül', async () => {
  const regi = regiTorzs();
  const vl = regi.kollegak.find((k) => k.id === 'vas-luca');
  vl.szerep = 'Lilla saját szövege';
  vl.foto = 'https://f360.hu/sajat.jpg';
  vl.nev = 'Vas Luca (szerkesztett)';
  regi.kollegak.push({ id: 'kovacs-anna', nev: 'Kovács Anna (Lilla)', szerep: 'saját', szin: '#3b4580', helyszinek: ['mexikoi'], szolgaltatasok: [] });
  const db = regiDb(regi);
  const t = await torzsBetolt(db);
  const k = (id) => t.kollegak.find((x) => x.id === id);
  assert.equal(k('vas-luca').szerep, 'Lilla saját szövege');
  assert.equal(k('vas-luca').foto, 'https://f360.hu/sajat.jpg');
  assert.equal(k('vas-luca').nev, 'Vas Luca (szerkesztett)');
  assert.equal(k('kovacs-anna').nev, 'Kovács Anna (Lilla)');
  assert.equal(k('kovacs-anna').szerep, 'saját');
  assert.equal(k('kovacs-anna').szin, '#3b4580');
  // a hiányzó fotót a meglévő kollégánál is pótolja
  assert.equal(k('kovacs-anna').foto, '/media/brand/csapat/kovacs-anna.jpg');
  assert.equal(t.kollegak.filter((x) => x.id === 'kovacs-anna').length, 1);
});

test('migráció: ha Lilla utána töröl egy új kollégát vagy szolgáltatást, nem jön vissza', async () => {
  const e = { ...ujEnv(), BOOKING_DB: regiDb() };
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  t.szolgaltatasok = t.szolgaltatasok.filter((s) => s.id !== 'taplalkozas-kiegeszito');
  t.kollegak = t.kollegak.filter((k) => k.id !== 'aczel-gabriella')
    .map((k) => ({ ...k, szolgaltatasok: k.szolgaltatasok.filter((s) => s !== 'taplalkozas-kiegeszito') }));
  const r = await admin(e, 'PUT', '/api/foglalo/beallitasok', t);
  assert.equal(r.status, 200, await r.clone().text());
  const ujra = await torzsBetolt({ ...e.BOOKING_DB });
  assert.ok(!ujra.kollegak.some((k) => k.id === 'aczel-gabriella'));
  assert.ok(!ujra.szolgaltatasok.some((s) => s.id === 'taplalkozas-kiegeszito'));
});
