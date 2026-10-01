// Időpontfoglaló · szabad időpontok számítása (tiszta függvény, adatbázis nélkül)
// beosztás − kivételek − foglalások (puffer is) − nyitvatartás − (+2 óra / +60 nap), 15 perces rács
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { szabadIdopontok, foglalasSlotjai } from '../functions/_lib/booking/szabad.js';

const T = {
  helyszinek: [
    { id: 'mex', nev: 'Mexikói út', nyit: 7 * 60, zar: 21 * 60 },
    { id: 'rei', nev: 'Reitter', nyit: 8 * 60, zar: 20 * 60 },
  ],
  szolgaltatasok: [
    { id: 'gy50', perc: 50, puffer: 10, helyszinek: ['mex'] },
    { id: 'ny90', perc: 90, puffer: 10, helyszinek: ['mex'] },
    { id: 'gep45', perc: 45, puffer: 10, helyszinek: ['mex', 'rei'] },
    { id: 'kin60', perc: 60, puffer: 0, helyszinek: ['rei'] },
  ],
  kollegak: [
    { id: 'a', helyszinek: ['mex'], szolgaltatasok: ['gy50', 'ny90', 'gep45'] },
    { id: 'b', helyszinek: ['mex', 'rei'], szolgaltatasok: ['gy50', 'gep45', 'kin60'] },
    { id: 'c', helyszinek: ['mex'], szolgaltatasok: ['gy50'] },
  ],
  // a kínált kezdések lépése 15 perc: ezek a tesztek a rácsot és a szabályokat nézik (a kínálás: foglalo-kinalas.test.mjs)
  szabalyok: { minEloreOra: 2, maxEloreNap: 60, kinalas: 15 },
};
const H = (h, m = 0) => h * 60 + m;
const BEOSZTAS = [
  ...[1, 2, 3, 4, 5].map((nap) => ({ kollega: 'a', nap, helyszin: 'mex', kezd: H(9), veg: H(17) })),
  { kollega: 'b', nap: 1, helyszin: 'mex', kezd: H(6), veg: H(12) }, // a nyitás előtt kezdene
  { kollega: 'b', nap: 2, helyszin: 'rei', kezd: H(10), veg: H(18) },
  { kollega: 'c', nap: 7, helyszin: 'mex', kezd: H(7), veg: H(12) },
  { kollega: 'c', nap: 1, helyszin: 'mex', kezd: H(7), veg: H(12) },
];
const VASARNAP_DELBEN = Date.parse('2026-09-27T10:00:00Z'); // helyben 12:00, vasárnap
const HETFO = '2026-09-28';

function futtat(o) {
  return szabadIdopontok({
    torzs: T, beosztas: BEOSZTAS, kivetelek: [], foglalt: [], most: VASARNAP_DELBEN,
    helyszin: 'mex', szolgaltatas: 'gy50', kollega: 'a', tol: HETFO, ig: HETFO, ...o,
  });
}
const kezdok = (r, d = HETFO) => r.napok[d].map((s) => s.kezd);

test('nyitás és zárás: a beosztás elején kezd, az utolsó kezdés még belefér a végébe', () => {
  const k = kezdok(futtat({}));
  assert.equal(k[0], '09:00');
  assert.equal(k.at(-1), '16:00'); // 16:00 + 50 perc = 16:50 ≤ 17:00; 16:15 már nem fér
  assert.equal(k.length, 29);
  assert.equal(kezdok(futtat({ szolgaltatas: 'ny90' })).at(-1), '15:30');
});

test('a helyszín nyitvatartása levágja a beosztást (b 6:00-tól lenne, a Mexikói 7-kor nyit)', () => {
  const k = kezdok(futtat({ kollega: 'b' }));
  assert.equal(k[0], '07:00');
  assert.equal(k.at(-1), '11:00');
});

test('puffer: egy 10:00-s 45 perces foglalás után 10 perc szünet kell, előtte a 9:15-ös kezdés már ütközne', () => {
  const foglalt = foglalasSlotjai({ kollega: 'a', datum: HETFO, kezd: H(10), perc: 45, puffer: 10 });
  assert.deepEqual(foglalt.map((f) => f.slot), [H(10), H(10, 15), H(10, 30), H(10, 45)]);
  const k = kezdok(futtat({ szolgaltatas: 'gep45', foglalt }));
  assert.ok(k.includes('09:00'));
  assert.ok(!k.includes('09:15')); // puffer nélkül 9:15-10:00 beleférne
  assert.ok(!k.includes('10:45'));
  assert.ok(k.includes('11:00'));
});

test('puffer 0: közvetlenül egymás után foglalható', () => {
  const foglalt = foglalasSlotjai({ kollega: 'b', datum: '2026-09-29', kezd: H(11), perc: 60, puffer: 0 });
  const k = kezdok(futtat({ helyszin: 'rei', szolgaltatas: 'kin60', kollega: 'b', tol: '2026-09-29', ig: '2026-09-29', foglalt }), '2026-09-29');
  assert.ok(k.includes('10:00'));
  assert.ok(!k.includes('10:15'));
  assert.ok(k.includes('12:00'));
});

test('más kolléga foglalása nem veszi el az időpontot', () => {
  const foglalt = foglalasSlotjai({ kollega: 'c', datum: HETFO, kezd: H(10), perc: 50, puffer: 10 });
  assert.equal(kezdok(futtat({ foglalt })).length, 29);
});

test('kivétel: egész napos szabadság, részleges kivétel és helyszín-zárás', () => {
  assert.deepEqual(futtat({ kivetelek: [{ kollega: 'a', tol: HETFO, ig: HETFO }] }).napok[HETFO], []);
  const k = kezdok(futtat({ kivetelek: [{ kollega: 'a', tol: HETFO, ig: HETFO, kezd: H(12), veg: H(13) }] }));
  assert.ok(k.includes('11:00'));
  assert.ok(!k.includes('11:15')); // 12:05-ig tartana
  assert.ok(!k.includes('12:45'));
  assert.ok(k.includes('13:00'));
  const zar = futtat({ kollega: 'barki', kivetelek: [{ helyszin: 'mex', tol: HETFO, ig: '2026-09-29' }] });
  assert.deepEqual(zar.napok[HETFO], []);
  // más helyszín zárása nem számít
  assert.equal(kezdok(futtat({ kivetelek: [{ helyszin: 'rei', tol: HETFO, ig: HETFO }] })).length, 29);
});

test('múlt és +2 óra: ma 10:00-kor a legkorábbi kezdés 12:00, a tegnapi nap üres', () => {
  const most = Date.parse('2026-09-28T08:00:00Z'); // helyben 10:00
  const r = futtat({ most, tol: '2026-09-25', ig: HETFO });
  assert.deepEqual(r.napok['2026-09-25'], []);
  assert.equal(kezdok(r)[0], '12:00');
});

test('+60 nap: az utolsó foglalható nap a mai + 60, utána üres', () => {
  const r = futtat({ tol: '2026-11-26', ig: '2026-11-27' });
  assert.equal(kezdok(r, '2026-11-26').length, 29); // csütörtök
  assert.deepEqual(r.napok['2026-11-27'], []); // péntek, de már 61. nap
});

test('„bárki”: az összes alkalmas kolléga, időpontonként a szabad kollégák listájával', () => {
  const r = futtat({ kollega: 'barki' });
  const n = Object.fromEntries(r.napok[HETFO].map((s) => [s.kezd, s.kollegak]));
  assert.deepEqual(n['07:00'], ['b', 'c']);
  assert.deepEqual(n['09:00'], ['a', 'b', 'c']);
  assert.deepEqual(n['16:00'], ['a']);
  assert.equal(n['06:45'], undefined);
});

test('rossz összerendelés (a kolléga nem végzi, vagy a szolgáltatás nincs a helyszínen): üres', () => {
  assert.deepEqual(futtat({ szolgaltatas: 'kin60' }).napok[HETFO], []);
  assert.deepEqual(futtat({ helyszin: 'rei', kollega: 'b' }).napok[HETFO], []);
});

test('DST márc (2026-03-29): a „most” helyi ideje a nyári eltolással számol', () => {
  // 05:00 UTC = 07:00 nyári idő, +2 óra = 09:00. Téli eltolással 08:00 jönne ki.
  const r = futtat({ kollega: 'c', most: Date.parse('2026-03-29T05:00:00Z'), tol: '2026-03-29', ig: '2026-03-30' });
  assert.equal(kezdok(r, '2026-03-29')[0], '09:00');
  assert.equal(kezdok(r, '2026-03-30')[0], '07:00');
});

test('DST okt (2026-10-25): a „most” helyi ideje a téli eltolással számol', () => {
  // 06:00 UTC = 07:00 téli idő, +2 óra = 09:00. Nyári eltolással 10:00 jönne ki.
  const r = futtat({ kollega: 'c', most: Date.parse('2026-10-25T06:00:00Z'), tol: '2026-10-25', ig: '2026-10-25' });
  assert.equal(kezdok(r, '2026-10-25')[0], '09:00');
  assert.equal(kezdok(r, '2026-10-25').at(-1), '11:00');
});
