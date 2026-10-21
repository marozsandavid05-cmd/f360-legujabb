// Időpontfoglaló · 3. adatkör (2026-10-21, Lilla 2026-10-20-i válaszai) motor-oldali követelményei.
//
//  8. pont: Kovács Annánál a tanácsadás óra 5 perckor kezdődik (kezdoPerc 5), az InBody :50-kor (15 perc).
//     A 8:50-es InBody (8:50-9:05) és a 9:05-ös tanácsadás nem ütközhet. A régi 15 perces zár-rács ezt nem
//     tudta: mindkettő a 9:00-s rácspontot zárta. A zár-rács ezért 5 perces.
//  9. pont: szombaton a helyszín rövidebb ideig van nyitva (Reitter 8-14, Mexikói út 8-12), vasárnap zárva.
//     A helyszín `napiNyitvatartas` mezője (hét napja 1-7 → { nyit, zar } vagy null) felülírja az alap
//     nyit/zar értéket; ami nincs benne, arra az alap érvényes.
//  4. pont: az eszközös kezelés alatt a gyógytornász foglalt (a foglalás az ő idejét zárja).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foglalasSlotjai, szabadIdopontok } from '../functions/_lib/booking/szabad.js';
import { torzsEllenoriz } from '../functions/_lib/booking/admin.js';
import { szamitasiTorzs } from '../functions/_lib/booking/schema.js';

const H = (h, m = 0) => h * 60 + m;
const VASARNAP_DELBEN = Date.parse('2026-09-27T10:00:00Z');
const HETFO = '2026-09-28';
const SZOMBAT = '2026-10-03';
const VASARNAP = '2026-10-04';

// ---------------------------------------------------------------- 8. InBody :50 + tanácsadás :05
const TANACS = () => ({
  helyszinek: [{ id: 'mex', nev: 'Mexikói út', nyit: H(7), zar: H(21) }],
  szolgaltatasok: [
    { id: 'inbody', perc: 15, puffer: 0, helyszinek: ['mex'], kezdoPerc: 50 },
    { id: 'tanacs', perc: 50, puffer: 0, helyszinek: ['mex'], kezdoPerc: 5 },
  ],
  kollegak: [{ id: 'anna', helyszinek: ['mex'], szolgaltatasok: ['inbody', 'tanacs'] }],
  szabalyok: { minEloreOra: 2, maxEloreNap: 60 },
});
const ANNA_HETFO = [{ kollega: 'anna', nap: 1, helyszin: 'mex', kezd: H(8, 45), veg: H(18) }];
const zarak = (kezd, perc, puffer = 0) => foglalasSlotjai({ kollega: 'anna', datum: HETFO, kezd, perc, puffer })
  .map((s) => ({ kollega: 'anna', datum: HETFO, slot: s.slot }));
const annaKezd = (szolgaltatas, foglalt = []) => szabadIdopontok({
  torzs: TANACS(), beosztas: ANNA_HETFO, kivetelek: [], foglalt, most: VASARNAP_DELBEN,
  helyszin: 'mex', szolgaltatas, kollega: 'anna', tol: HETFO, ig: HETFO,
}).napok[HETFO].map((s) => s.kezd);

test('8. tanácsadás (kezdoPerc 5, 50 perc): óra 5 perckor, 9:05-től 17:05-ig', () => {
  assert.deepEqual(annaKezd('tanacs'), ['09:05', '10:05', '11:05', '12:05', '13:05', '14:05', '15:05', '16:05', '17:05']);
});

test('8. a 8:50-es InBody (8:50-9:05) mellett a 9:05-ös tanácsadás szabad marad', () => {
  assert.ok(annaKezd('tanacs', zarak(H(8, 50), 15)).includes('09:05'));
});

test('8. a 9:05-ös tanácsadás mellett a 8:50-es InBody szabad marad, a 9:50-es nem (9:05-9:55)', () => {
  const ib = annaKezd('inbody', zarak(H(9, 5), 50));
  assert.ok(ib.includes('08:50'));
  assert.ok(!ib.includes('09:50'));
  assert.ok(ib.includes('10:50'));
});

test('zárak 5 perces rácson: a foglalás pontosan a saját idejét (és a pufferét) zárja', () => {
  assert.deepEqual(zarak(H(8, 50), 15).map((z) => z.slot), [H(8, 50), H(8, 55), H(9)]);
  assert.deepEqual(zarak(H(9, 5), 50).map((z) => z.slot), Array.from({ length: 10 }, (_, i) => H(9, 5) + i * 5));
  // 50 perc + 10 perc puffer 9:00-tól: 9:00-9:55 (12 zár), a 10:00 már szabad
  assert.deepEqual(zarak(H(9), 50, 10).map((z) => z.slot).at(-1), H(9, 55));
  assert.equal(zarak(H(9), 50, 10).length, 12);
});

test('a valódi átfedés továbbra is ütközik (9:05-ös tanácsadás alatt a 9:50-es InBody, puffer nélkül is)', () => {
  const foglalt = zarak(H(9, 5), 50);
  assert.ok(!annaKezd('tanacs', foglalt).includes('09:05'));
});

// ---------------------------------------------------------------- 9. szombati nyitvatartás
const SZOMBATI = () => ({
  helyszinek: [
    { id: 'reitter', nev: 'Reitter', nyit: '07:00', zar: '21:00', napiNyitvatartas: { 6: { nyit: '08:00', zar: '14:00' }, 7: null } },
    { id: 'mexikoi', nev: 'Mexikói út', nyit: '07:00', zar: '21:00', napiNyitvatartas: { 6: { nyit: '08:00', zar: '12:00' }, 7: null } },
  ],
  szolgaltatasok: [
    { id: 'edzes', perc: 50, puffer: 10, helyszinek: ['reitter'] },
    { id: 'gy', perc: 50, puffer: 10, helyszinek: ['mexikoi'] },
  ],
  kollegak: [
    { id: 'bence', helyszinek: ['reitter'], szolgaltatasok: ['edzes'] },
    { id: 'luca', helyszinek: ['mexikoi'], szolgaltatasok: ['gy'] },
  ],
  szabalyok: { minEloreOra: 2, maxEloreNap: 60, kinalas: 15 },
});
const HOSSZU = [6, 7, 1].flatMap((nap) => [
  { kollega: 'bence', nap, helyszin: 'reitter', kezd: H(6), veg: H(20) },
  { kollega: 'luca', nap, helyszin: 'mexikoi', kezd: H(6), veg: H(20) },
]);
const nyitKezd = (helyszin, szolgaltatas, datum) => szabadIdopontok({
  torzs: szamitasiTorzs(SZOMBATI()), beosztas: HOSSZU, kivetelek: [], foglalt: [], most: VASARNAP_DELBEN,
  helyszin, szolgaltatas, tol: datum, ig: datum,
}).napok[datum].map((s) => s.kezd);

test('9. szombaton a Reitter 8:00-14:00: első kezdés 8:00, utolsó 13:10 előtti rácspont (13:00)', () => {
  const k = nyitKezd('reitter', 'edzes', SZOMBAT);
  assert.equal(k[0], '08:00');
  assert.equal(k.at(-1), '13:00');
});

test('9. szombaton a Mexikói út 8:00-12:00', () => {
  const k = nyitKezd('mexikoi', 'gy', SZOMBAT);
  assert.equal(k[0], '08:00');
  assert.equal(k.at(-1), '11:00');
});

test('9. vasárnap zárva (null), hétköznap az alap 7:00-21:00 marad', () => {
  assert.deepEqual(nyitKezd('reitter', 'edzes', VASARNAP), []);
  const h = nyitKezd('reitter', 'edzes', '2026-10-05');
  assert.equal(h[0], '07:00');
  assert.equal(h.at(-1), '19:00'); // a beosztás 20:00-ig tart
});

test('9. admin mentés: a napiNyitvatartas megmarad és ellenőrzött', () => {
  const alap = {
    helyszinek: [{ id: 'reitter', nev: 'Reitter', cim: 'x', nyit: '07:00', zar: '21:00', napiNyitvatartas: { 6: { nyit: '08:00', zar: '14:00' }, 7: null } }],
    szolgaltatasok: [], kollegak: [],
    szabalyok: { minEloreOra: 2, maxEloreNap: 60, lemondasOra: 24, telefon: '+36 30 503 0578', studioEmail: 'info@f360.hu' },
  };
  assert.deepEqual(torzsEllenoriz(alap).helyszinek[0].napiNyitvatartas, { 6: { nyit: '08:00', zar: '14:00' }, 7: null });
  const nelkul = structuredClone(alap); delete nelkul.helyszinek[0].napiNyitvatartas;
  assert.equal('napiNyitvatartas' in torzsEllenoriz(nelkul).helyszinek[0], false);
  for (const rossz of [{ 8: null }, { 6: { nyit: '14:00', zar: '08:00' } }, { 6: { nyit: '8:00', zar: '14:00' } }, { 6: 'zárva' }, [], { 6: { nyit: ['08:00'], zar: '14:00' } }, JSON.parse('{"__proto__": null}')]) {
    const r = structuredClone(alap); r.helyszinek[0].napiNyitvatartas = rossz;
    assert.throws(() => torzsEllenoriz(r), /nyitvatartás/i);
  }
});

// ---------------------------------------------------------------- 4. eszközös kezelés alatt a gyógytornász foglalt
test('4. a 10:00-s 30 perces ultrahang alatt ugyanaz a gyógytornász nem foglalható más kezelésre', () => {
  const t = {
    helyszinek: [{ id: 'reitter', nev: 'Reitter', nyit: H(7), zar: H(21) }],
    szolgaltatasok: [
      { id: 'ultrahang', perc: 15, puffer: 10, helyszinek: ['reitter'] },
      { id: 'rehab', perc: 50, puffer: 10, helyszinek: ['reitter'] },
    ],
    kollegak: [{ id: 'anna', helyszinek: ['reitter'], szolgaltatasok: ['ultrahang', 'rehab'] }],
    szabalyok: { minEloreOra: 2, maxEloreNap: 60, kinalas: 15 },
  };
  const foglalt = foglalasSlotjai({ kollega: 'anna', datum: HETFO, kezd: H(10), perc: 15, puffer: 10 })
    .map((s) => ({ kollega: 'anna', datum: HETFO, slot: s.slot }));
  const k = szabadIdopontok({
    torzs: t, beosztas: [{ kollega: 'anna', nap: 1, helyszin: 'reitter', kezd: H(9), veg: H(13) }], kivetelek: [], foglalt, most: VASARNAP_DELBEN,
    helyszin: 'reitter', szolgaltatas: 'rehab', kollega: 'anna', tol: HETFO, ig: HETFO,
  }).napok[HETFO].map((s) => s.kezd);
  assert.ok(!k.includes('09:15')); // 9:15-10:05 belelógna
  assert.ok(!k.includes('10:00'));
  assert.ok(k.includes('10:30')); // 10:00 + 15 + 10 puffer = 10:25, a következő 15-ös rácspont
});
