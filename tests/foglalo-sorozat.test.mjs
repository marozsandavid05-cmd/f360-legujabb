// Időpontfoglaló · „Állandó időpont” (ismétlődő foglalás, sorozat) · admin API és gördítés.
// Szerződés: Claude tesztelés\f360-allando-idopont-2026-10-01\SZERZODES.md. Valódi SQLite-tal.
// Tesztadat: „David teszt”. A minta-beosztásban Szegedi Botond szerdán a Mexikóiban 9-17.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import { admin, foglalj, keres, kollegaAtir, kovNap, outbox, post, sorok, szabalyAtir, tokenBol, ujEnv } from './_foglalo.mjs';
import { budapestMost, datumPlusz } from '../functions/_lib/booking/ido.js';
import { sema } from '../functions/_lib/booking/schema.js';
import { sorozatGordit } from '../functions/_lib/booking/sorozat.js';
import { foglal } from '../functions/_lib/booking/foglalas.js';

const CRON = 'cron-kulcs-'.padEnd(40, 'y');
const SZERDA = kovNap(3); // az első szerda legalább 3 nap múlva
const het = (n) => datumPlusz(SZERDA, 7 * n);

const sorozatBe = (o = {}) => ({
  helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond',
  nap: 3, kezd: '16:00', ismetles: 1, kezdoDatum: SZERDA, vege: { tipus: 'alkalom', db: 4 }, ...o,
});
const vendeg = (o = {}) => ({ nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', ...o });

const elonezet = (e, o) => admin(e, 'POST', '/api/foglalo/sorozatok/elonezet', sorozatBe(o));
async function letrehoz(e, o = {}, extra = {}) {
  return admin(e, 'POST', '/api/foglalo/sorozatok', { ...sorozatBe(o), vendeg: vendeg(), ...extra });
}
async function letrehozOk(e, o = {}, extra = {}) {
  const r = await letrehoz(e, o, extra);
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
}
const foglalasok = (e) => sorok(e, `SELECT * FROM bookings ORDER BY date, start_min`);

// ---------------------------------------------------------------- séma

test('migráció: a régi bookings tábla megkapja a sorozat_id oszlopot és az indexet, a sorozatok tábla létrejön', async () => {
  const db = fakeD1();
  db._raw.exec(`CREATE TABLE bookings (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, service_id TEXT NOT NULL, staff_id TEXT NOT NULL, date TEXT NOT NULL, start_min INTEGER NOT NULL, dur_min INTEGER NOT NULL, buffer_min INTEGER NOT NULL, price INTEGER, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'megerositett' CHECK (status IN ('megerositett', 'lemondva')), source TEXT NOT NULL DEFAULT 'web', token_salt TEXT NOT NULL, created_at INTEGER NOT NULL, cancelled_at INTEGER)`);
  db._raw.prepare(`INSERT INTO bookings (id, location_id, service_id, staff_id, date, start_min, dur_min, buffer_min, name, token_salt, created_at)
    VALUES ('F0000000001', 'mexikoi', 'gyogytorna', 'vas-luca', '2026-10-20', 600, 50, 10, 'David teszt', 'so', 1)`).run();
  await sema(db);
  const oszl = db._raw.prepare(`SELECT name FROM pragma_table_info('bookings')`).all().map((r) => r.name);
  assert.ok(oszl.includes('sorozat_id'));
  assert.equal(db._raw.prepare('SELECT sorozat_id FROM bookings').get().sorozat_id, null);
  const idx = db._raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'bookings'`).all().map((r) => r.name);
  assert.ok(idx.includes('bookings_sorozat'), idx.join(','));
  for (const t of ['sorozatok', 'sorozat_kimaradt']) {
    assert.ok(db._raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t), t);
  }
  await sema({ ...db }); // másodszor (új isolate) sem hibázik
});

// ---------------------------------------------------------------- előnézet

test('előnézet: szabad és ütköző alkalmak okkal (foglalt, szabadság, zárva), nem ír semmit', async () => {
  const e = ujEnv();
  await foglalj(e, { datum: het(1), kezd: '16:00', kollega: 'szegedi-botond' });
  assert.equal((await admin(e, 'POST', '/api/foglalo/kivetelek', { kollega: 'szegedi-botond', tol: het(2), ig: het(2), megjegyzes: 'szabadság' })).status, 201);
  assert.equal((await admin(e, 'POST', '/api/foglalo/kivetelek', { helyszin: 'mexikoi', tol: het(3), ig: het(3), kezd: '15:00', veg: '18:00' })).status, 201);
  const elotte = foglalasok(e).length;
  const outboxElotte = outbox(e).length;
  const r = await elonezet(e, { vege: { tipus: 'alkalom', db: 5 } });
  assert.equal(r.status, 200, await r.clone().text());
  const d = await r.json();
  assert.equal(d.osszes, 5);
  assert.equal(d.utkozik, 3);
  assert.deepEqual(d.alkalmak.map((a) => [a.datum, a.kezd, a.allapot, a.ok || null]), [
    [het(0), '16:00', 'szabad', null],
    [het(1), '16:00', 'utkozik', 'foglalt'],
    [het(2), '16:00', 'utkozik', 'szabadsag'],
    [het(3), '16:00', 'utkozik', 'zarva'],
    [het(4), '16:00', 'szabad', null],
  ]);
  assert.equal(d.horizontVege, datumPlusz(budapestMost().datum, 60));
  assert.equal(foglalasok(e).length, elotte);
  assert.equal(outbox(e).length, outboxElotte);
  assert.equal(sorok(e, 'SELECT * FROM sorozatok').length, 0);
});

test('előnézet: nincs_beosztas, mult és kollega_inaktiv', async () => {
  const e = ujEnv();
  // kedden Botond a Reitterben dolgozik, nem a Mexikóiban
  let d = await (await elonezet(e, { nap: 2, kezdoDatum: kovNap(2), vege: { tipus: 'alkalom', db: 2 } })).json();
  assert.deepEqual(d.alkalmak.map((a) => a.ok), ['nincs_beosztas', 'nincs_beosztas']);
  // szerdán 16:30 + 50 perc túllóg a 17:00-s beosztás-végen
  d = await (await elonezet(e, { kezd: '16:30', vege: { tipus: 'alkalom', db: 1 } })).json();
  assert.equal(d.alkalmak[0].ok, 'nincs_beosztas');
  // a múlt (SZERDA - 21 és SZERDA - 14 biztosan elmúlt, SZERDA biztosan jövőbeli)
  d = await (await elonezet(e, { kezdoDatum: datumPlusz(SZERDA, -21), vege: { tipus: 'alkalom', db: 4 } })).json();
  const okok = d.alkalmak.map((a) => (a.allapot === 'szabad' ? 'szabad' : a.ok));
  assert.deepEqual([okok[0], okok[1], okok[3]], ['mult', 'mult', 'szabad']);
  // a kolléga kilép a 2. alkalom előtt
  await kollegaAtir(e, 'szegedi-botond', { aktiv_ig: het(0) });
  d = await (await elonezet(e, { vege: { tipus: 'alkalom', db: 2 } })).json();
  assert.deepEqual(d.alkalmak.map((a) => a.allapot === 'szabad' ? 'szabad' : a.ok), ['szabad', 'kollega_inaktiv']);
});

test('előnézet: vége dátumig, kéthetente; nyitott sorozat a maxEloreNap ablakig', async () => {
  const e = ujEnv();
  let d = await (await elonezet(e, { ismetles: 2, vege: { tipus: 'datum', datum: het(5) } })).json();
  assert.deepEqual(d.alkalmak.map((a) => a.datum), [het(0), het(2), het(4)]);
  await szabalyAtir(e, { maxEloreNap: 30 });
  d = await (await elonezet(e, { vege: { tipus: 'nyitott' } })).json();
  const hatar = datumPlusz(budapestMost().datum, 30);
  assert.equal(d.horizontVege, hatar);
  assert.ok(d.alkalmak.length >= 3);
  assert.ok(d.alkalmak.every((a) => a.datum <= hatar));
  assert.equal(d.alkalmak[0].datum, SZERDA);
});

test('validáció: 400 a hibás bemenetre, 413 a túl nagy törzsre', async () => {
  const e = ujEnv();
  const rossz = [
    { kezd: '16:10' }, { nap: 8 }, { nap: 0 }, { ismetles: 3 }, { kollega: 'barki' }, { kollega: 'nincs-ilyen' },
    { szolgaltatas: 'sportmasszazs' }, // a Mexikóiban nem foglalható
    { kollega: 'vas-luca', szolgaltatas: 'relaxalo-masszazs' }, // Vas Luca nem végzi
    { kezdoDatum: datumPlusz(budapestMost().datum, 400) }, { kezdoDatum: datumPlusz(budapestMost().datum, -400) }, { kezdoDatum: '2026-02-30' },
    { vege: { tipus: 'alkalom', db: 0 } }, { vege: { tipus: 'alkalom', db: 105 } }, { vege: { tipus: 'datum', datum: datumPlusz(SZERDA, -1) } },
    { vege: { tipus: 'datum', datum: datumPlusz(SZERDA, 7 * 110) } }, { vege: { tipus: 'valami' } }, { vege: null },
  ];
  for (const o of rossz) {
    const r = await elonezet(e, o);
    assert.equal(r.status, 400, `${JSON.stringify(o)}: ${await r.text()}`);
  }
  const nagy = await admin(e, 'POST', '/api/foglalo/sorozatok', { ...sorozatBe(), vendeg: vendeg({ megjegyzes: 'x'.repeat(9000) }) });
  assert.equal(nagy.status, 413);
  assert.equal((await letrehoz(e, {}, { vendeg: { nev: 'D' } })).status, 400);
  assert.equal((await letrehoz(e, {}, { vendeg: vendeg({ email: 'nem-email' }) })).status, 400);
  assert.equal(sorok(e, 'SELECT * FROM sorozatok').length, 0);
});

// ---------------------------------------------------------------- létrehozás

test('létrehozás részleges ütközéssel: 201, a szabad alkalmak a sorozathoz kötve, egy összefoglaló levél', async () => {
  const e = ujEnv();
  await kollegaAtir(e, 'szegedi-botond', { email: 'botond@example.com' });
  await foglalj(e, { datum: het(2), kezd: '16:00', kollega: 'szegedi-botond' });
  const elotte = outbox(e).length;
  const d = await letrehozOk(e);
  assert.match(d.sorozat.id, /^R[0-9A-Z]{10}$/);
  assert.equal(d.sorozat.status, 'aktiv');
  assert.deepEqual(d.letrejott.map((a) => [a.datum, a.kezd]), [[het(0), '16:00'], [het(1), '16:00'], [het(3), '16:00']]);
  assert.ok(d.letrejott.every((a) => /^F[0-9A-Z]{10}$/.test(a.id)));
  assert.deepEqual(d.kimaradt, [{ datum: het(2), ok: 'foglalt' }]);
  const b = sorok(e, `SELECT * FROM bookings WHERE sorozat_id = ? ORDER BY date`, d.sorozat.id);
  assert.equal(b.length, 3);
  assert.ok(b.every((x) => x.source === 'admin' && x.status === 'megerositett' && x.name === 'David teszt' && x.staff_id === 'szegedi-botond'));
  // zárak: alkalmanként (50 + 10) / 15 = 4
  for (const x of b) assert.equal(sorok(e, 'SELECT * FROM slot_locks WHERE booking_id = ?', x.id).length, 4);
  // levelek: egy összefoglaló a vendégnek, egy a kollégának, egy a stúdiónak, alkalmanként semmi
  const uj = outbox(e).slice(elotte);
  assert.deepEqual(uj.map((l) => l.tipus).sort(), ['sorozat-kollega', 'sorozat-studio', 'sorozat-visszaigazolas']);
  const v = uj.find((l) => l.tipus === 'sorozat-visszaigazolas');
  assert.equal(v.cimzett, 'david.teszt@example.com');
  assert.equal(v.booking_id, d.sorozat.id);
  // minden alkalom a saját lemondó linkjével
  const linkek = [...v.szoveg.matchAll(/\/foglalas\/lemondas\?t=([A-Za-z0-9._%-]+)/g)].map((m) => decodeURIComponent(m[1]));
  assert.equal(linkek.length, 3);
  assert.deepEqual(linkek.map((t) => t.split('.')[0]).sort(), b.map((x) => x.id).sort());
  assert.equal(uj.find((l) => l.tipus === 'sorozat-kollega').cimzett, 'botond@example.com');
  assert.ok(!uj.find((l) => l.tipus === 'sorozat-kollega').szoveg.includes('lemondas?t='));
  // a kimaradt alkalom a sorozatnál is látszik
  const lista = await (await admin(e, 'GET', '/api/foglalo/sorozatok')).json();
  assert.deepEqual(lista.sorozatok[0].kimaradt, [{ datum: het(2), ok: 'foglalt' }]);
});

test('létrehozás: vendég e-mail nélkül nincs vendég-levél; kihagy és áthelyez', async () => {
  const e = ujEnv();
  await foglalj(e, { datum: het(1), kezd: '16:00', kollega: 'szegedi-botond' });
  const elotte = outbox(e).length;
  const d = await letrehozOk(e, {}, {
    vendeg: vendeg({ email: '', telefon: '' }),
    kihagy: [het(3)],
    athelyez: [{ datum: het(1), ujDatum: datumPlusz(het(1), 2), ujKezd: '10:00' }], // péntek 10:00
  });
  assert.deepEqual(d.letrejott.map((a) => [a.datum, a.kezd]), [[het(0), '16:00'], [datumPlusz(het(1), 2), '10:00'], [het(2), '16:00']]);
  assert.equal(d.letrejott[1].athelyezve, het(1));
  // a szándékos kihagyás a válaszban látszik, de a sorozat figyelmeztető listájába nem kerül
  assert.deepEqual(d.kimaradt, [{ datum: het(3), ok: 'kihagyva' }]);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM sorozat_kimaradt')[0].n, 0);
  assert.equal(sorok(e, `SELECT * FROM bookings WHERE sorozat_id = ?`, d.sorozat.id).length, 3);
  assert.ok(!outbox(e).slice(elotte).some((l) => l.tipus === 'sorozat-visszaigazolas'));
  // áthelyezés foglalt időpontra: az is kimarad
  const e2 = ujEnv();
  await foglalj(e2, { datum: het(1), kezd: '16:00', kollega: 'szegedi-botond' });
  await foglalj(e2, { datum: het(1), kezd: '10:00', kollega: 'szegedi-botond' });
  const d2 = await letrehozOk(e2, { vege: { tipus: 'alkalom', db: 2 } }, { athelyez: [{ datum: het(1), ujDatum: het(1), ujKezd: '10:00' }] });
  assert.deepEqual(d2.letrejott.map((a) => a.datum), [het(0)]);
  assert.deepEqual(d2.kimaradt, [{ datum: het(1), ok: 'foglalt' }]);
  // nem a sorozathoz tartozó dátum: 400
  assert.equal((await letrehoz(e2, {}, { kihagy: [datumPlusz(SZERDA, 1)] })).status, 400);
  assert.equal((await letrehoz(e2, {}, { athelyez: [{ datum: datumPlusz(SZERDA, 1), ujDatum: SZERDA, ujKezd: '10:00' }] })).status, 400);
});

test('létrehozás: ha egyetlen alkalom sem jön létre, 409 és nem marad sorozat', async () => {
  const e = ujEnv();
  const r = await letrehoz(e, { nap: 2, kezdoDatum: kovNap(2) }); // kedden nincs beosztás a Mexikóiban
  assert.equal(r.status, 409);
  assert.equal(sorok(e, 'SELECT * FROM sorozatok').length, 0);
  assert.equal(sorok(e, 'SELECT * FROM sorozat_kimaradt').length, 0);
  assert.equal(foglalasok(e).length, 0);
});

test('6 párhuzamos létrehozás ugyanarra az időre: minden alkalmat pontosan egy sorozat kap meg', async () => {
  const e = ujEnv();
  const rs = await Promise.all(Array.from({ length: 6 }, () => letrehoz(e, { vege: { tipus: 'alkalom', db: 3 } })));
  const st = rs.map((r) => r.status);
  assert.ok(st.every((s) => s === 201 || s === 409), st.join(','));
  const nyertes = st.filter((s) => s === 201).length;
  assert.ok(nyertes >= 1);
  // alkalmanként egy foglalás, egy zár-sorozat
  const b = foglalasok(e);
  assert.deepEqual(b.map((x) => x.date), [het(0), het(1), het(2)]);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 12);
  // a 409-es kérésből nem marad sorozat; ami megmaradt, annak van alkalma
  const s = sorok(e, 'SELECT id FROM sorozatok').map((x) => x.id);
  assert.equal(s.length, nyertes);
  assert.deepEqual([...new Set(b.map((x) => x.sorozat_id))].sort(), s.sort());
  const valaszok = await Promise.all(rs.filter((r) => r.status === 201).map((r) => r.json()));
  assert.equal(valaszok.reduce((n, v) => n + v.letrejott.length, 0), 3);
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM outbox WHERE tipus = 'sorozat-visszaigazolas'`)[0].n, nyertes);
});

// ---------------------------------------------------------------- lista, részletek, foglalás-nézet

test('lista, részletek és a foglalás-nézet sorozat mezője', async () => {
  const e = ujEnv();
  const d = await letrehozOk(e, { vege: { tipus: 'alkalom', db: 3 } });
  const lista = await (await admin(e, 'GET', '/api/foglalo/sorozatok')).json();
  assert.equal(lista.sorozatok.length, 1);
  const s = lista.sorozatok[0];
  assert.equal(s.id, d.sorozat.id);
  assert.deepEqual(s.vendeg, { nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '' });
  assert.equal(s.helyszin.id, 'mexikoi');
  assert.equal(s.szolgaltatas.id, 'gyogymasszazs-50');
  assert.equal(s.kollega.id, 'szegedi-botond');
  assert.match(s.kollega.szin, /^#[0-9a-f]{6}$/);
  assert.equal(s.nap, 3);
  assert.equal(s.kezd, '16:00');
  assert.equal(s.ismetles, 1);
  assert.equal(s.kezdoDatum, SZERDA);
  assert.deepEqual(s.vege, { tipus: 'alkalom', db: 3 });
  assert.equal(s.status, 'aktiv');
  assert.deepEqual(s.kovetkezo, { datum: het(0), kezd: '16:00' });
  assert.equal(s.jovobeli, 3);
  assert.equal(s.lemondott, 0);
  // egy alkalom lemondása: a sorozat többi része marad
  assert.equal((await admin(e, 'POST', `/api/foglalo/foglalasok/${d.letrejott[0].id}/lemondas`)).status, 200);
  const r = await (await admin(e, 'GET', `/api/foglalo/sorozatok/${d.sorozat.id}`)).json();
  assert.equal(r.jovobeli, 2);
  assert.equal(r.lemondott, 1);
  assert.deepEqual(r.kovetkezo, { datum: het(1), kezd: '16:00' });
  assert.deepEqual(r.alkalmak.map((a) => [a.datum, a.allapot]), [[het(0), 'lemondva'], [het(1), 'megerositett'], [het(2), 'megerositett']]);
  assert.ok(r.alkalmak.every((a) => /^F/.test(a.id) && a.kezd === '16:00'));
  // a foglalás-nézetben a sorozat mező
  const fl = await (await admin(e, 'GET', `/api/foglalo/foglalasok?tol=${het(0)}&ig=${het(2)}`)).json();
  assert.equal(fl.foglalasok.length, 3);
  assert.ok(fl.foglalasok.every((f) => f.sorozat && f.sorozat.id === d.sorozat.id && f.sorozat.nap === 3 && f.sorozat.kezd === '16:00'));
  // a sima foglalásnál null
  await foglalj(e, { datum: het(0), kezd: '10:00', kollega: 'szegedi-botond' });
  const fl2 = await (await admin(e, 'GET', `/api/foglalo/foglalasok?tol=${het(0)}&ig=${het(0)}`)).json();
  assert.equal(fl2.foglalasok.find((f) => f.kezd === '10:00').sorozat, null);
  // szűrés és ismeretlen azonosító
  assert.equal((await (await admin(e, 'GET', '/api/foglalo/sorozatok?allapot=leallitva')).json()).sorozatok.length, 0);
  assert.equal((await admin(e, 'GET', '/api/foglalo/sorozatok?allapot=valami')).status, 400);
  assert.equal((await admin(e, 'GET', '/api/foglalo/sorozatok/R0000000000')).status, 404);
  assert.equal((await admin(e, 'GET', `/api/foglalo/sorozatok/${encodeURIComponent("' OR 1=1 --")}`)).status, 404);
});

// ---------------------------------------------------------------- leállítás

test('leállítás a tol naptól: a későbbi alkalmak lemondva, a korábbiak maradnak, egy összefoglaló levél', async () => {
  const e = ujEnv();
  await kollegaAtir(e, 'szegedi-botond', { email: 'botond@example.com' });
  const d = await letrehozOk(e);
  const elotte = outbox(e).length;
  const r = await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, { tol: het(2) });
  assert.equal(r.status, 200, await r.clone().text());
  const v = await r.json();
  assert.equal(v.sorozat.status, 'leallitva');
  assert.deepEqual(v.lemondott.map((x) => x.datum), [het(2), het(3)]);
  const b = sorok(e, `SELECT date, status FROM bookings WHERE sorozat_id = ? ORDER BY date`, d.sorozat.id);
  assert.deepEqual(b.map((x) => [x.date, x.status]), [[het(0), 'megerositett'], [het(1), 'megerositett'], [het(2), 'lemondva'], [het(3), 'lemondva']]);
  // a lemondott alkalmak zárai felszabadultak
  for (const x of v.lemondott) assert.equal(sorok(e, 'SELECT * FROM slot_locks WHERE booking_id = ?', x.id).length, 0);
  const uj = outbox(e).slice(elotte);
  assert.deepEqual(uj.map((l) => l.tipus).sort(), ['sorozat-kollega', 'sorozat-leallitva', 'sorozat-studio']);
  // a megmaradt alkalmak linkje a vendég levelében
  const lev = uj.find((l) => l.tipus === 'sorozat-leallitva');
  assert.equal([...lev.szoveg.matchAll(/lemondas\?t=/g)].length, 2);
  // másodszor, nem korábbi nappal: már le van állítva (a korábbi nap kiterjeszt: foglalo-sorozat-studio.test.mjs)
  assert.equal((await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, { tol: het(3) })).status, 409);
  const lista = await (await admin(e, 'GET', '/api/foglalo/sorozatok?allapot=leallitva')).json();
  assert.equal(lista.sorozatok.length, 1);
  assert.equal((await (await admin(e, 'GET', '/api/foglalo/sorozatok')).json()).sorozatok.length, 0, 'az alap szűrő: aktív');
  assert.equal((await (await admin(e, 'GET', '/api/foglalo/sorozatok?allapot=mind')).json()).sorozatok.length, 1);
});

test('leállítás: tol nélkül ma (minden jövőbeli alkalom), hibás tol 400, ismeretlen sorozat 404', async () => {
  const e = ujEnv();
  const d = await letrehozOk(e, { vege: { tipus: 'alkalom', db: 2 } });
  assert.equal((await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, { tol: '2026-13-01' })).status, 400);
  assert.equal((await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, { tol: datumPlusz(budapestMost().datum, -1) })).status, 400);
  assert.equal((await admin(e, 'POST', '/api/foglalo/sorozatok/R0000000000/leallitas', {})).status, 404);
  const r = await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, {});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).lemondott.length, 2);
});

// ---------------------------------------------------------------- vendég linkje

test('a vendég linkje csak az adott alkalmat kezeli: lemondás és áthelyezés', async () => {
  const e = ujEnv();
  const d = await letrehozOk(e);
  const v = outbox(e, 'sorozat-visszaigazolas')[0];
  const tokenek = [...v.szoveg.matchAll(/(https?:\/\/\S+\/foglalas\/lemondas\?t=\S+)/g)].map((m) => tokenBol(m[1]));
  assert.equal(tokenek.length, 4);
  const elsoId = tokenek[0].split('.')[0];
  const r = await post(e, '/foglalas-api/lemondas', { t: tokenek[0] });
  assert.equal(r.status, 200, await r.clone().text());
  const b = sorok(e, `SELECT id, status, date FROM bookings WHERE sorozat_id = ? ORDER BY date`, d.sorozat.id);
  assert.deepEqual(b.map((x) => x.status), ['lemondva', 'megerositett', 'megerositett', 'megerositett']);
  assert.equal(b[0].id, elsoId);
  // a második alkalom áthelyezése a saját tokennel (péntek 10:00): csak az mozdul, a sorozathoz tartozik tovább
  const m = await post(e, '/foglalas-api/modositas', { t: tokenek[1], datum: datumPlusz(het(1), 2), kezd: '10:00', kollega: 'szegedi-botond' });
  assert.equal(m.status, 200, await m.clone().text());
  const b2 = sorok(e, `SELECT date, start_min, status FROM bookings WHERE sorozat_id = ? ORDER BY date`, d.sorozat.id);
  assert.deepEqual(b2.map((x) => [x.date, x.start_min, x.status]), [
    [het(0), 960, 'lemondva'], [datumPlusz(het(1), 2), 600, 'megerositett'], [het(2), 960, 'megerositett'], [het(3), 960, 'megerositett'],
  ]);
  assert.equal(sorok(e, 'SELECT * FROM sorozatok')[0].status, 'aktiv');
});

// ---------------------------------------------------------------- biztonság

test('XSS és SQLi a vendégmezőkben: tárolva szó szerint, a levélben escape-elve, a táblák épek', async () => {
  const e = ujEnv();
  const gonosz = `<script>alert(1)</script>'); DROP TABLE bookings;--`;
  const d = await letrehozOk(e, { vege: { tipus: 'alkalom', db: 2 } }, {
    vendeg: vendeg({ nev: `${gonosz}\nX-Fejlec: be`, megjegyzes: `<img src=x onerror=alert(1)>" OR 1=1 --` }),
  });
  const s = sorok(e, 'SELECT * FROM sorozatok')[0];
  assert.equal(s.name, `${gonosz} X-Fejlec: be`); // egysorosítva
  assert.equal(s.note, `<img src=x onerror=alert(1)>" OR 1=1 --`);
  assert.equal(foglalasok(e).length, 2);
  for (const l of outbox(e)) {
    assert.ok(!l.html.includes('<script>'), l.tipus);
    assert.ok(!l.html.includes('<img src=x'), l.tipus);
    assert.ok(!/[\r\n]/.test(l.targy), l.tipus);
  }
  const lista = await (await admin(e, 'GET', `/api/foglalo/sorozatok/${d.sorozat.id}`)).json();
  assert.equal(lista.vendeg.nev, `${gonosz} X-Fejlec: be`);
  // a helyszín, szolgáltatás és kolléga mező sem injektálható
  assert.equal((await elonezet(e, { kollega: "szegedi-botond' OR '1'='1" })).status, 400);
  assert.equal((await elonezet(e, { helyszin: { $gt: '' } })).status, 400);
});

// ---------------------------------------------------------------- gördítés (nyitott sorozat)

test('gördítés: a nyitott sorozat a cronnal a maxEloreNap ablakig nő, kétszer futtatva sem duplikál, az ütköző kimarad és naplózódik', async () => {
  const e = ujEnv({ CRON_SECRET: CRON });
  await szabalyAtir(e, { maxEloreNap: 21 });
  const d = await letrehozOk(e, { vege: { tipus: 'nyitott' } });
  const hatar1 = datumPlusz(budapestMost().datum, 21);
  const db1 = sorok(e, `SELECT * FROM bookings WHERE sorozat_id = ?`, d.sorozat.id).length;
  assert.ok(db1 >= 2 && sorok(e, `SELECT MAX(date) AS m FROM bookings`)[0].m <= hatar1);
  // az ablak kitolódik (mintha napok teltek volna el)
  await szabalyAtir(e, { maxEloreNap: 60 });
  const hatar2 = datumPlusz(budapestMost().datum, 60);
  // egy későbbi alkalmat közben valaki más lefoglal: az kimarad
  const utkozo = [...Array(12).keys()].map(het).find((x) => x > hatar1 && x <= hatar2);
  assert.ok(utkozo);
  await admin(e, 'POST', '/api/foglalo/foglalasok', { helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: utkozo, kezd: '16:00', nev: 'David teszt' });
  const elotte = outbox(e).length;
  const cron = () => keres(e, 'POST', '/foglalas-api/cron/emlekezteto', { origin: null, headers: { 'X-Cron-Kulcs': CRON } });
  const r1 = await cron();
  assert.equal(r1.status, 200, await r1.clone().text());
  const j1 = await r1.json();
  const varhato = [...Array(12).keys()].map(het).filter((x) => x > hatar1 && x <= hatar2);
  assert.equal(j1.sorozat.letrejott, varhato.length - 1);
  assert.equal(j1.sorozat.kimaradt, 1);
  const utana = sorok(e, `SELECT date FROM bookings WHERE sorozat_id = ? AND status = 'megerositett' ORDER BY date`, d.sorozat.id).map((x) => x.date);
  assert.equal(utana.length, db1 + varhato.length - 1);
  assert.ok(!utana.includes(utkozo));
  assert.deepEqual(sorok(e, 'SELECT datum, ok FROM sorozat_kimaradt').map((x) => [x.datum, x.ok]), [[utkozo, 'foglalt']]);
  // gördítéskor alkalmanként nincs levél
  assert.ok(!outbox(e).slice(elotte).some((l) => /^(visszaigazolas|kollega-uj|sorozat-)/.test(l.tipus)));
  // másodszor: semmi új
  const j2 = await (await cron()).json();
  assert.equal(j2.sorozat.letrejott, 0);
  assert.equal(j2.sorozat.kimaradt, 0);
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM bookings WHERE sorozat_id = ?`, d.sorozat.id)[0].n, utana.length);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM sorozat_kimaradt')[0].n, 1);
  const lista = await (await admin(e, 'GET', `/api/foglalo/sorozatok/${d.sorozat.id}`)).json();
  assert.deepEqual(lista.kimaradt, [{ datum: utkozo, ok: 'foglalt' }]);
});

test('gördítés: két párhuzamos futás sem duplikál; leállított és nem nyitott sorozatot nem gördít', async () => {
  const e = ujEnv();
  await szabalyAtir(e, { maxEloreNap: 14 });
  const nyitott = await letrehozOk(e, { vege: { tipus: 'nyitott' } });
  const leallitott = await letrehozOk(e, { kezd: '10:00', vege: { tipus: 'nyitott' } });
  const veges = await letrehozOk(e, { kezd: '12:00', vege: { tipus: 'datum', datum: het(1) } });
  assert.equal((await admin(e, 'POST', `/api/foglalo/sorozatok/${leallitott.sorozat.id}/leallitas`, {})).status, 200);
  await szabalyAtir(e, { maxEloreNap: 60 });
  const env = { ...e };
  const [a, b] = await Promise.all([sorozatGordit(env, e.BOOKING_DB, { origin: 'https://x.hu' }), sorozatGordit(env, e.BOOKING_DB, { origin: 'https://x.hu' })]);
  const hatar = datumPlusz(budapestMost().datum, 60);
  const varhato = [...Array(12).keys()].map(het).filter((x) => x <= hatar);
  const n = (id) => sorok(e, `SELECT COUNT(*) AS n FROM bookings WHERE sorozat_id = ? AND status = 'megerositett'`, id)[0].n;
  assert.equal(n(nyitott.sorozat.id), varhato.length);
  assert.equal(a.letrejott + b.letrejott, varhato.length - nyitott.letrejott.length);
  assert.equal(n(leallitott.sorozat.id), 0);
  assert.equal(n(veges.sorozat.id), 2);
  // a datum-dupla ellenőrzése: egy napon egy alkalom, és a párhuzamos futás nem naplóz hamis ütközést
  const napok = sorok(e, `SELECT date FROM bookings WHERE sorozat_id = ?`, nyitott.sorozat.id).map((x) => x.date);
  assert.equal(new Set(napok).size, napok.length);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM sorozat_kimaradt')[0].n, 0);
  assert.equal(a.kimaradt + b.kimaradt, 0);
});

test('leállított sorozathoz a foglalás batch-e nem köt alkalmat (a leállítás és a gördítés versenye)', async () => {
  const e = ujEnv();
  const d = await letrehozOk(e, { vege: { tipus: 'alkalom', db: 1 } });
  assert.equal((await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, {})).status, 200);
  const elotte = foglalasok(e).length;
  await assert.rejects(
    foglal(e, e.BOOKING_DB, {
      helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: het(1), kezdPerc: 960,
      nev: 'David teszt', email: '', telefon: '', megjegyzes: '', forras: null,
    }, { origin: 'https://x.hu', admin: true, sorozatId: d.sorozat.id }),
    (err) => err.status === 409,
  );
  assert.equal(foglalasok(e).length, elotte);
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM slot_locks WHERE date = ?`, het(1))[0].n, 0);
});

test('gördítés: a kilépett kolléga alkalmai kimaradnak (kollega_inaktiv), a gördítés nem akad el', async () => {
  const e = ujEnv();
  await szabalyAtir(e, { maxEloreNap: 14 });
  const d = await letrehozOk(e, { vege: { tipus: 'nyitott' } });
  await kollegaAtir(e, 'szegedi-botond', { aktiv_ig: datumPlusz(budapestMost().datum, 20) });
  await szabalyAtir(e, { maxEloreNap: 45 });
  const r = await sorozatGordit({ ...e }, e.BOOKING_DB, { origin: 'https://x.hu' });
  const hatar = datumPlusz(budapestMost().datum, 20);
  const km = sorok(e, `SELECT datum, ok FROM sorozat_kimaradt WHERE sorozat_id = ?`, d.sorozat.id);
  assert.ok(km.length >= 1);
  assert.ok(km.every((x) => x.ok === 'kollega_inaktiv' && x.datum > hatar));
  assert.ok(sorok(e, `SELECT date FROM bookings WHERE sorozat_id = ?`, d.sorozat.id).every((x) => x.date <= hatar));
  assert.equal(r.kimaradt, km.length);
  assert.equal(sorok(e, 'SELECT gorditve_ig FROM sorozatok')[0].gorditve_ig, datumPlusz(budapestMost().datum, 45));
});

test('gördítés félbeszakadt futás után: a már létrejött alkalmat nem foglalja újra és nem naplózza ütközésnek', async () => {
  const e = ujEnv();
  await szabalyAtir(e, { maxEloreNap: 30 });
  const d = await letrehozOk(e, { vege: { tipus: 'nyitott' } });
  const elotte = sorok(e, `SELECT COUNT(*) AS n FROM bookings WHERE sorozat_id = ?`, d.sorozat.id)[0].n;
  // mintha a futás a foglalások után, a gorditve_ig írása előtt állt volna le
  e.BOOKING_DB._raw.prepare(`UPDATE sorozatok SET gorditve_ig = ''`).run();
  const r = await sorozatGordit({ ...e }, e.BOOKING_DB, { origin: 'https://x.hu' });
  assert.equal(r.letrejott, 0);
  assert.equal(r.kimaradt, 0);
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM bookings WHERE sorozat_id = ?`, d.sorozat.id)[0].n, elotte);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM sorozat_kimaradt')[0].n, 0);
});

test('létrehozás e-mail nélküli vendéggel, kolléga-cím nélkül, stúdió-cím nélkül, ütközés nélkül: 201 (nincs üres D1-batch)', async () => {
  const e = ujEnv();
  await szabalyAtir(e, { studioEmail: '' });
  const r = await letrehoz(e, { vege: { tipus: 'alkalom', db: 2 } }, { vendeg: vendeg({ email: '', telefon: '' }) });
  assert.equal(r.status, 201, await r.clone().text());
  assert.equal(sorok(e, `SELECT COUNT(*) AS n FROM outbox`)[0].n, 0);
  const d = await r.json();
  const le = await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, {});
  assert.equal(le.status, 200, await le.clone().text());
});

// ---------------------------------------------------------------- hibatűrés (független review, 2026-10-03)

function hibasBatch(e, list, sorozatId) {
  return list.some((st) => st._sql && st._sql.startsWith('INSERT INTO bookings') && (st._args || []).includes(sorozatId));
}

/** A D1-utánzat batch-e a megadott sorszámú (1-től) hívásnál dob, ha a feltétel teljesül. */
function batchHiba(db, felt) {
  const eredeti = db.batch;
  let n = 0;
  db.batch = async (list) => {
    n += 1;
    if (felt(n, list)) throw new Error('D1_ERROR: szimulált hiba');
    return eredeti(list);
  };
  return () => { db.batch = eredeti; };
}

test('leállítás félbeszakad: az újrapróbálás befejezi (nem 409), a maradék alkalmak lemondva, a levél egyszer megy ki', async () => {
  const e = ujEnv();
  const d = await letrehozOk(e);
  // a lemondás a 2. alkalomnál elhasal (a leállítás batch-ei közül a 2.)
  const vissza = batchHiba(e.BOOKING_DB, (n) => n === 2);
  const r1 = await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, { tol: het(1) });
  vissza();
  assert.equal(r1.status, 500);
  const r2 = await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, { tol: het(1) });
  assert.equal(r2.status, 200, await r2.clone().text());
  const b = sorok(e, `SELECT date, status FROM bookings WHERE sorozat_id = ? ORDER BY date`, d.sorozat.id);
  assert.deepEqual(b.map((x) => x.status), ['megerositett', 'lemondva', 'lemondva', 'lemondva']);
  assert.equal(outbox(e, 'sorozat-leallitva').length, 1);
  // a levél a teljes lemondott listát tartalmazza (a félbeszakadt futásban lemondottat is): 3 tétel, link nélkül
  const lev = outbox(e, 'sorozat-leallitva')[0].szoveg;
  const lemondottResz = lev.split('Ezek az alkalmak megmaradnak')[0];
  assert.equal((lemondottResz.match(/^- /gm) || []).length, 3);
  // harmadszor: tényleg nincs mit tenni
  assert.equal((await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, {})).status, 409);
  assert.equal(outbox(e, 'sorozat-leallitva').length, 1);
});

test('létrehozás félbeszakad: minden visszaáll (nincs félkész sorozat), az újramentés egy teljes sorozatot ad', async () => {
  const e = ujEnv();
  // a 3. alkalom foglalása elhasal
  let foglalasBatch = 0;
  const vissza = batchHiba(e.BOOKING_DB, (n, list) => list.some((st) => st._sql && st._sql.startsWith('INSERT INTO bookings')) && ++foglalasBatch === 3);
  const r1 = await letrehoz(e);
  vissza();
  assert.equal(foglalasBatch, 3, 'a 3. alkalom foglalásánál hasalt el');
  assert.equal(r1.status, 500);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM sorozatok')[0].n, 0);
  assert.equal(foglalasok(e).length, 0);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 0);
  const d = await letrehozOk(e);
  assert.equal(d.letrejott.length, 4);
  assert.deepEqual(d.kimaradt, []);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM sorozatok')[0].n, 1);
});

test('gördítés: egy hibás sorozat nem állítja meg a többit, és a cron (levélküldés) sem bukik el', async () => {
  const e = ujEnv({ CRON_SECRET: CRON });
  await szabalyAtir(e, { maxEloreNap: 14 });
  const a = await letrehozOk(e, { kezd: '10:00', vege: { tipus: 'nyitott' } });
  const b = await letrehozOk(e, { kezd: '12:00', vege: { tipus: 'nyitott' } });
  await szabalyAtir(e, { maxEloreNap: 45 });
  // az elsőként sorra kerülő sorozat minden foglalás-batch-e elhasal
  const hibas = sorok(e, 'SELECT id FROM sorozatok ORDER BY gorditve_ig, id')[0].id;
  const jo = hibas === a.sorozat.id ? b.sorozat.id : a.sorozat.id;
  const vissza = batchHiba(e.BOOKING_DB, (n, list) => hibasBatch(e, list, hibas));
  const r = await keres(e, 'POST', '/foglalas-api/cron/emlekezteto', { origin: null, headers: { 'X-Cron-Kulcs': CRON } });
  vissza();
  assert.equal(r.status, 200, await r.clone().text());
  const n = (id) => sorok(e, `SELECT COUNT(*) AS n FROM bookings WHERE sorozat_id = ?`, id)[0].n;
  assert.ok(n(jo) > (jo === a.sorozat.id ? a : b).letrejott.length, 'a jó sorozat gördült');
  assert.equal(n(hibas), (hibas === a.sorozat.id ? a : b).letrejott.length, 'a hibás nem nőtt');
  // a hibás sorozat a következő futásban újrapróbálható (a gorditve_ig nem ugrott a horizontra)
  assert.ok(sorok(e, 'SELECT gorditve_ig FROM sorozatok WHERE id = ?', hibas)[0].gorditve_ig < datumPlusz(budapestMost().datum, 45));
});

test('leállítás: a folytató hívás (még volt lemondandó alkalom) nem küld második összefoglalót', async () => {
  const e = ujEnv();
  await kollegaAtir(e, 'szegedi-botond', { email: 'botond@example.com' });
  const d = await letrehozOk(e);
  assert.equal((await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, { tol: het(2) })).status, 200);
  // egy már leállított sorozat alkalma valahogy megerősítve maradt (pl. egy félbeszakadt lemondás után)
  e.BOOKING_DB._raw.prepare(`UPDATE bookings SET status = 'megerositett', cancelled_at = NULL WHERE sorozat_id = ? AND date = ?`).run(d.sorozat.id, het(3));
  const r = await admin(e, 'POST', `/api/foglalo/sorozatok/${d.sorozat.id}/leallitas`, {});
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(sorok(e, `SELECT status FROM bookings WHERE sorozat_id = ? AND date = ?`, d.sorozat.id, het(3))[0].status, 'lemondva');
  assert.equal(outbox(e, 'sorozat-leallitva').length, 1);
  assert.equal(outbox(e, 'sorozat-kollega').filter((l) => l.targy.startsWith('Leállt')).length, 1);
});
