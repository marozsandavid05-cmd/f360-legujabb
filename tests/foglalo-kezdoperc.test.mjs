// Időpontfoglaló · rögzített kezdési perc (2026-10-15, Kovács Anna „Foglaló adatok.docx”):
// az InBody 770 csak óra :50-kor kezdődhet (15 perc), a táplálkozási tanácsadás csak egész órakor.
//
// A szolgáltatás `kezdoPerc` mezője (0-55, 5 többszöröse): a felkínált kezdés MINDEN egész óra ennyiedik
// perce a beosztási blokkon belül (a kínálás-lépés és a hézagkitöltés erre a szolgáltatásra nem
// vonatkozik). A zárak (slot_locks) 2026-10-21 óta 5 perces rácson vannak: a 8:50-es kezdés zárai
// 8:50, 8:55, ... (a 3. adatkör, tanácsadás :05 miatt; foglalo-adatcsere3.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foglalasSlotjai, kinalasLepes, szabadIdopontok } from '../functions/_lib/booking/szabad.js';
import { kezdesPerc } from '../functions/_lib/booking/ido.js';
import { torzsEllenoriz } from '../functions/_lib/booking/admin.js';

const H = (h, m = 0) => h * 60 + m;
const T = () => ({
  helyszinek: [{ id: 'mex', nev: 'Mexikói út', nyit: H(7), zar: H(21) }],
  szolgaltatasok: [
    { id: 'inbody', perc: 15, puffer: 10, helyszinek: ['mex'], kezdoPerc: 50 },
    { id: 'tanacs', perc: 60, puffer: 10, helyszinek: ['mex'], kezdoPerc: 0 },
    { id: 's50', perc: 50, puffer: 10, helyszinek: ['mex'] },
  ],
  kollegak: [{ id: 'anna', helyszinek: ['mex'], szolgaltatasok: ['inbody', 'tanacs', 's50'] }],
  szabalyok: { minEloreOra: 2, maxEloreNap: 60 },
});
const VASARNAP_DELBEN = Date.parse('2026-09-27T10:00:00Z');
const HETFO = '2026-09-28';
const PENTEK = '2026-10-02';
const HETFOI = [{ kollega: 'anna', nap: 1, helyszin: 'mex', kezd: H(8, 45), veg: H(18) }];
// pénteken két blokk: 8:45-9:15 (csak a 8:50-es InBody fér bele) és 10:45-14:00
const PENTEKI = [
  { kollega: 'anna', nap: 5, helyszin: 'mex', kezd: H(8, 45), veg: H(9, 15) },
  { kollega: 'anna', nap: 5, helyszin: 'mex', kezd: H(10, 45), veg: H(14) },
];

function kezdok({ szolgaltatas, beosztas = HETFOI, foglalt = [], datum = HETFO }) {
  const r = szabadIdopontok({
    torzs: T(), beosztas, kivetelek: [], foglalt, most: VASARNAP_DELBEN,
    helyszin: 'mex', szolgaltatas, kollega: 'anna', tol: datum, ig: datum,
  });
  return r.napok[datum].map((s) => s.kezd);
}

test('InBody (kezdoPerc 50, 15 perc): hétfőn 8:50-től 16:50-ig óránként, a 17:50 már nem fér bele 18:00-ig', () => {
  assert.deepEqual(kezdok({ szolgaltatas: 'inbody' }),
    ['08:50', '09:50', '10:50', '11:50', '12:50', '13:50', '14:50', '15:50', '16:50']);
});

test('tanácsadás (kezdoPerc 0, 60 perc): egész órakor 9:00-tól 17:00-ig, 8:45 nem', () => {
  assert.deepEqual(kezdok({ szolgaltatas: 'tanacs' }),
    ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
});

test('péntek: InBody 8:50, 10:50, 11:50, 12:50; tanácsadás 11, 12, 13 (Anna fix időpontjai)', () => {
  assert.deepEqual(kezdok({ szolgaltatas: 'inbody', beosztas: PENTEKI, datum: PENTEK }), ['08:50', '10:50', '11:50', '12:50']);
  assert.deepEqual(kezdok({ szolgaltatas: 'tanacs', beosztas: PENTEKI, datum: PENTEK }), ['11:00', '12:00', '13:00']);
});

test('kezdoPerc nélküli szolgáltatás változatlan (igazított lépés a blokk elejétől)', () => {
  assert.deepEqual(kezdok({ szolgaltatas: 's50' }).slice(0, 3), ['08:45', '09:45', '10:45']);
});

test('a rácson kívüli kezdés zárai az 5 perces zár-rácson (8:50 + 15 + 10 perc: 8:50-9:10)', () => {
  assert.deepEqual(foglalasSlotjai({ kollega: 'anna', datum: HETFO, kezd: H(8, 50), perc: 15, puffer: 10 }).map((s) => s.slot), [H(8, 50), H(8, 55), H(9), H(9, 5), H(9, 10)]);
  // rácson lévő kezdésnél ugyanaz, mint eddig
  assert.deepEqual(foglalasSlotjai({ kollega: 'a', datum: HETFO, kezd: H(9), perc: 50, puffer: 10 }).map((s) => s.slot), Array.from({ length: 12 }, (_, i) => H(9) + i * 5));
  assert.deepEqual(foglalasSlotjai({ kollega: 'a', datum: HETFO, kezd: H(9), perc: 20, puffer: 0 }).map((s) => s.slot), [H(9), H(9, 5), H(9, 10), H(9, 15)]);
});

test('a 8:50-es InBody foglalás ütközik a 9:00-s tanácsadással, a 9:50-es InBody szabad marad', () => {
  const foglalt = foglalasSlotjai({ kollega: 'anna', datum: HETFO, kezd: H(8, 50), perc: 15, puffer: 10 }).map((s) => ({ kollega: 'anna', datum: HETFO, slot: s.slot }));
  assert.ok(!kezdok({ szolgaltatas: 'tanacs', foglalt }).includes('09:00'));
  assert.ok(kezdok({ szolgaltatas: 'tanacs', foglalt }).includes('10:00'));
  const ib = kezdok({ szolgaltatas: 'inbody', foglalt });
  assert.ok(!ib.includes('08:50'));
  assert.ok(ib.includes('09:50'));
});

test('kezdoPerc mellett nincs hézagkitöltés: a 9:00-s tanácsadás vége (10:15) után sem kínál 10:15-öt', () => {
  const foglalt = foglalasSlotjai({ kollega: 'anna', datum: HETFO, kezd: H(9), perc: 60, puffer: 10 }).map((s) => ({ kollega: 'anna', datum: HETFO, slot: s.slot }));
  const t = kezdok({ szolgaltatas: 'tanacs', foglalt });
  assert.ok(!t.includes('10:15'));
  assert.ok(!t.includes('10:00')); // 10:00-10:10 még a puffer
  assert.ok(t.includes('11:00'));
  assert.ok(kezdok({ szolgaltatas: 'inbody', foglalt }).every((k) => k.endsWith(':50')));
});

test('kinalasLepes kezdoPerc mellett 60 (a katalógus „lepes” mezője)', () => {
  assert.equal(kinalasLepes({ perc: 15, puffer: 10, kezdoPerc: 50 }, {}), 60);
});

test('kezdesPerc: 5 perces pontosságú időt fogad (08:50), a rossz alakot nem', () => {
  assert.equal(kezdesPerc('08:50'), H(8, 50));
  assert.equal(kezdesPerc('10:00'), H(10));
  assert.equal(kezdesPerc('08:52'), null);
  assert.equal(kezdesPerc('8:50'), null);
  assert.equal(kezdesPerc('24:00'), null);
});

test('admin mentés: a kezdoPerc megmarad és ellenőrzött (0-55, 5 többszöröse)', () => {
  const alap = {
    helyszinek: [{ id: 'mexikoi', nev: 'Mexikói út', cim: 'x', nyit: '07:00', zar: '21:00' }],
    szolgaltatasok: [{ id: 'inbody-770', nev: 'InBody', perc: 15, ar: 10000, puffer: 10, helyszinek: ['mexikoi'], kezdoPerc: 50 }],
    kollegak: [],
    szabalyok: { minEloreOra: 2, maxEloreNap: 60, lemondasOra: 24, telefon: '+36 30 503 0578', studioEmail: 'info@f360.hu' },
  };
  assert.equal(torzsEllenoriz(alap).szolgaltatasok[0].kezdoPerc, 50);
  const nelkul = structuredClone(alap); delete nelkul.szolgaltatasok[0].kezdoPerc;
  assert.equal('kezdoPerc' in torzsEllenoriz(nelkul).szolgaltatasok[0], false);
  for (const rossz of [53, 60, -5, '50']) {
    const r = structuredClone(alap); r.szolgaltatasok[0].kezdoPerc = rossz;
    assert.throws(() => torzsEllenoriz(r), /kezdési perc/i);
  }
});
