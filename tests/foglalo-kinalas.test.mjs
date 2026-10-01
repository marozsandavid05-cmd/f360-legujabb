// Időpontfoglaló · a kínált kezdések lépése (tiszta függvény, adatbázis nélkül)
//
// A belső rács marad 15 perc (slot_locks, ütközésvédelem). Csak a FELKÍNÁLT kezdések ritkulnak:
//   kinalas = 'igazitott' (alap): lépés = perc + puffer, felfelé a 15 többszörösére
//   kinalas = 15 | 30 | 60 | egyedi (15 többszöröse, 15-240) a szolgáltatásnál
// A rács horgonya a beosztási blokk (és a szabadság utáni szabad szakasz) eleje. Hézagkitöltés: egy
// meglévő foglalás zárai utáni első 15 perces rácspont is felkínálódik, ha belefér.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foglalasSlotjai, kinalasLepes, szabadIdopontok } from '../functions/_lib/booking/szabad.js';

const H = (h, m = 0) => h * 60 + m;
const T = (szabalyok = {}, szolgExtra = {}) => ({
  helyszinek: [{ id: 'mex', nev: 'Mexikói út', nyit: H(7), zar: H(21) }],
  szolgaltatasok: [
    { id: 's50', perc: 50, puffer: 10, helyszinek: ['mex'], ...(szolgExtra.s50 || {}) },
    { id: 's90', perc: 90, puffer: 10, helyszinek: ['mex'], ...(szolgExtra.s90 || {}) },
    { id: 's20', perc: 20, puffer: 10, helyszinek: ['mex'], ...(szolgExtra.s20 || {}) },
  ],
  kollegak: [
    { id: 'a', helyszinek: ['mex'], szolgaltatasok: ['s50', 's90', 's20'] },
    { id: 'b', helyszinek: ['mex'], szolgaltatasok: ['s50'] },
  ],
  szabalyok: { minEloreOra: 2, maxEloreNap: 60, ...szabalyok },
});
const VASARNAP_DELBEN = Date.parse('2026-09-27T10:00:00Z');
const HETFO = '2026-09-28';
const DELUTAN = [{ kollega: 'a', nap: 1, helyszin: 'mex', kezd: H(12), veg: H(17) }];

function futtat({ torzs = T(), beosztas = DELUTAN, ...o } = {}) {
  return szabadIdopontok({
    torzs, beosztas, kivetelek: [], foglalt: [], most: VASARNAP_DELBEN,
    helyszin: 'mex', szolgaltatas: 's50', kollega: 'a', tol: HETFO, ig: HETFO, ...o,
  });
}
const kezdok = (r, d = HETFO) => r.napok[d].map((s) => s.kezd);

test('kinalasLepes: igazított = perc + puffer felfelé a 15 többszörösére', () => {
  assert.equal(kinalasLepes({ perc: 50, puffer: 10 }, {}), 60);
  assert.equal(kinalasLepes({ perc: 90, puffer: 10 }, {}), 105);
  assert.equal(kinalasLepes({ perc: 20, puffer: 10 }, {}), 30);
  assert.equal(kinalasLepes({ perc: 45, puffer: 0 }, {}), 45);
  assert.equal(kinalasLepes({ perc: 50 }, {}), 60); // a puffer alapja 10
  assert.equal(kinalasLepes({ perc: 50, puffer: 10 }, { kinalas: 'igazitott' }), 60);
});

test('kinalasLepes: globális 30, egyedi felülírás 60, a null és a hiányzó a globálisat követi', () => {
  assert.equal(kinalasLepes({ perc: 50, puffer: 10 }, { kinalas: 30 }), 30);
  assert.equal(kinalasLepes({ perc: 50, puffer: 10, kinalas: 60 }, { kinalas: 30 }), 60);
  assert.equal(kinalasLepes({ perc: 50, puffer: 10, kinalas: null }, { kinalas: 30 }), 30);
  assert.equal(kinalasLepes({ perc: 50, puffer: 10, kinalas: 'igazitott' }, { kinalas: 15 }), 60);
  assert.equal(kinalasLepes({ perc: 50, puffer: 10, kinalas: 75 }, { kinalas: 30 }), 75);
  assert.equal(kinalasLepes({ perc: 90, puffer: 10, kinalas: 15 }, {}), 15);
  // kézzel elrontott tárolt érték (240 fölött, nem egész, szöveg): az igazított lépés jön
  assert.equal(kinalasLepes({ perc: 50, puffer: 10, kinalas: 300 }, {}), 60);
  assert.equal(kinalasLepes({ perc: 50, puffer: 10, kinalas: '30' }, {}), 60);
});

test('50 + 10 perces kezelés 12:00-17:00 beosztással: 12, 13, 14, 15, 16 (és semmi más)', () => {
  assert.deepEqual(kezdok(futtat()), ['12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('90 + 10 perces kezelés: 12:00, 13:45, 15:30 (105 perces lépés)', () => {
  assert.deepEqual(kezdok(futtat({ szolgaltatas: 's90' })), ['12:00', '13:45', '15:30']);
});

test('globális 30: félóránként; a szolgáltatás 60-as felülírása erősebb; null örököl', () => {
  assert.deepEqual(kezdok(futtat({ torzs: T({ kinalas: 30 }) })),
    ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
  assert.deepEqual(kezdok(futtat({ torzs: T({ kinalas: 30 }, { s50: { kinalas: 60 } }) })),
    ['12:00', '13:00', '14:00', '15:00', '16:00']);
  assert.deepEqual(kezdok(futtat({ torzs: T({ kinalas: 30 }, { s50: { kinalas: null } }) })),
    ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
});

test('kinalas 15: a régi viselkedés (minden negyedóra, ami belefér)', () => {
  const k = kezdok(futtat({ torzs: T({ kinalas: 15 }) }));
  assert.equal(k[0], '12:00');
  assert.equal(k.at(-1), '16:00');
  assert.equal(k.length, 17);
});

test('hézagkitöltés: egy 12:15-ös (50 + 10 perces) foglalás után a 13:15 is felkínálódik', () => {
  const foglalt = foglalasSlotjai({ kollega: 'a', datum: HETFO, kezd: H(12, 15), perc: 50, puffer: 10 });
  assert.deepEqual(kezdok(futtat({ foglalt })), ['13:15', '14:00', '15:00', '16:00']);
});

test('hézagkitöltés: csak ha a kezelés belefér (a nap végén nem kínál túllógó kezdést)', () => {
  // 15:30-as foglalás zárai 15:30-16:15; a 16:30-as kezdés 17:20-ig tartana, a beosztás 17:00-kor véget ér
  const foglalt = foglalasSlotjai({ kollega: 'a', datum: HETFO, kezd: H(15, 30), perc: 50, puffer: 10 });
  assert.deepEqual(kezdok(futtat({ foglalt })), ['12:00', '13:00', '14:00']);
});

test('hézagkitöltés: más kolléga foglalása nem ad hézag-kezdést', () => {
  const foglalt = foglalasSlotjai({ kollega: 'b', datum: HETFO, kezd: H(12, 15), perc: 50, puffer: 10 });
  assert.deepEqual(kezdok(futtat({ foglalt })), ['12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('lemondás után (a zárak eltűnnek) a kínálat visszaáll a rácsra', () => {
  const foglalt = foglalasSlotjai({ kollega: 'a', datum: HETFO, kezd: H(12, 15), perc: 50, puffer: 10 });
  assert.notDeepEqual(kezdok(futtat({ foglalt })), kezdok(futtat({ foglalt: [] })));
  assert.deepEqual(kezdok(futtat({ foglalt: [] })), ['12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('két blokk egy napon (8-12, 14-18): mindkét blokk elejéről indul', () => {
  const beosztas = [
    { kollega: 'a', nap: 1, helyszin: 'mex', kezd: H(8), veg: H(12) },
    { kollega: 'a', nap: 1, helyszin: 'mex', kezd: H(14), veg: H(18) },
  ];
  assert.deepEqual(kezdok(futtat({ beosztas })), ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00']);
  // 90 + 10: a második blokk is 14:00-tól, nem az első blokk rácsát folytatja (12:15 → 14:00 helyett 14:00)
  assert.deepEqual(kezdok(futtat({ beosztas, szolgaltatas: 's90' })), ['08:00', '09:45', '14:00', '15:45']);
});

test('szabadság a blokk közepén: a rács a szabad szakasz elejéről indul újra', () => {
  const beosztas = [{ kollega: 'a', nap: 1, helyszin: 'mex', kezd: H(9), veg: H(17) }];
  const kivetelek = [{ kollega: 'a', tol: HETFO, ig: HETFO, kezd: H(11), veg: H(12, 30) }];
  assert.deepEqual(kezdok(futtat({ beosztas, kivetelek })), ['09:00', '10:00', '12:30', '13:30', '14:30', '15:30']);
});

test('szabadság a blokk elején és a helyszín részleges zárása is új horgony', () => {
  const beosztas = [{ kollega: 'a', nap: 1, helyszin: 'mex', kezd: H(9), veg: H(17) }];
  const eleje = [{ kollega: 'a', tol: HETFO, ig: HETFO, kezd: H(9), veg: H(10, 15) }];
  assert.deepEqual(kezdok(futtat({ beosztas, kivetelek: eleje })), ['10:15', '11:15', '12:15', '13:15', '14:15', '15:15']);
  const zar = [{ helyszin: 'mex', tol: HETFO, ig: HETFO, kezd: H(13), veg: H(14) }];
  assert.deepEqual(kezdok(futtat({ beosztas, kivetelek: zar })), ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00']);
  // más kolléga szabadsága nem mozdítja a horgonyt
  const mas = [{ kollega: 'b', tol: HETFO, ig: HETFO, kezd: H(9), veg: H(10, 15) }];
  assert.deepEqual(kezdok(futtat({ beosztas, kivetelek: mas })), ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('„bárki”: kollégánként számolva, a kezdések uniója a szabad kollégákkal', () => {
  const beosztas = [...DELUTAN, { kollega: 'b', nap: 1, helyszin: 'mex', kezd: H(12, 30), veg: H(17) }];
  const r = futtat({ beosztas, kollega: 'barki' });
  assert.deepEqual(r.napok[HETFO], [
    { kezd: '12:00', kollegak: ['a'] }, { kezd: '12:30', kollegak: ['b'] },
    { kezd: '13:00', kollegak: ['a'] }, { kezd: '13:30', kollegak: ['b'] },
    { kezd: '14:00', kollegak: ['a'] }, { kezd: '14:30', kollegak: ['b'] },
    { kezd: '15:00', kollegak: ['a'] }, { kezd: '15:30', kollegak: ['b'] },
    { kezd: '16:00', kollegak: ['a'] },
  ]);
});

test('a +2 órás határ nem tolja el a rácsot (ma 13:10-kor a kínálat 16:00, nem 15:15)', () => {
  const most = Date.parse('2026-09-28T11:10:00Z'); // helyben 13:10, a határ 15:10
  assert.deepEqual(kezdok(futtat({ most })), ['16:00']);
});
