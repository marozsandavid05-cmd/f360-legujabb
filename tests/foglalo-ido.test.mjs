// Időpontfoglaló · időkezelés (Europe/Budapest helyi idő, DST-váltás)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  helyiToUtc, budapestMost, datumPlusz, hetNapja, percToHHMM, hhmmToPerc, napok, ervenyesDatum,
} from '../functions/_lib/booking/ido.js';

const iso = (ms) => new Date(ms).toISOString();

test('helyi idő → UTC: télen +1, nyáron +2 óra', () => {
  assert.equal(iso(helyiToUtc('2026-01-15', 9 * 60)), '2026-01-15T08:00:00.000Z');
  assert.equal(iso(helyiToUtc('2026-07-15', 9 * 60)), '2026-07-15T07:00:00.000Z');
});

test('DST márc: a váltás előtti és utáni napon is helyes UTC', () => {
  // 2026-03-29 hajnalban 02:00-ról 03:00-ra ugrik az óra
  assert.equal(iso(helyiToUtc('2026-03-28', 9 * 60)), '2026-03-28T08:00:00.000Z');
  assert.equal(iso(helyiToUtc('2026-03-29', 9 * 60)), '2026-03-29T07:00:00.000Z');
  assert.equal(iso(helyiToUtc('2026-03-29', 1 * 60)), '2026-03-29T00:00:00.000Z');
});

test('DST okt: a váltás előtti és utáni napon is helyes UTC', () => {
  // 2026-10-25 hajnalban 03:00-ról 02:00-ra áll vissza
  assert.equal(iso(helyiToUtc('2026-10-24', 9 * 60)), '2026-10-24T07:00:00.000Z');
  assert.equal(iso(helyiToUtc('2026-10-25', 9 * 60)), '2026-10-25T08:00:00.000Z');
});

test('budapestMost: UTC pillanatból helyi dátum és perc, DST-vel', () => {
  assert.deepEqual(budapestMost(Date.parse('2026-03-29T05:00:00Z')), { datum: '2026-03-29', perc: 7 * 60 });
  assert.deepEqual(budapestMost(Date.parse('2026-03-28T23:30:00Z')), { datum: '2026-03-29', perc: 30 });
  assert.deepEqual(budapestMost(Date.parse('2026-10-25T05:00:00Z')), { datum: '2026-10-25', perc: 6 * 60 });
  assert.deepEqual(budapestMost(Date.parse('2026-12-31T23:10:00Z')), { datum: '2027-01-01', perc: 10 });
});

test('dátum-segédek: plusz nap, hét napja (hétfő = 1), napok listája', () => {
  assert.equal(datumPlusz('2026-02-27', 2), '2026-03-01');
  assert.equal(datumPlusz('2026-10-24', 1), '2026-10-25');
  assert.equal(hetNapja('2026-09-28'), 1); // hétfő
  assert.equal(hetNapja('2026-10-04'), 7); // vasárnap
  assert.deepEqual(napok('2026-09-29', '2026-10-01'), ['2026-09-29', '2026-09-30', '2026-10-01']);
  assert.deepEqual(napok('2026-10-02', '2026-10-01'), []);
});

test('óra:perc átalakítás, 15 perces rácsra kötve', () => {
  assert.equal(percToHHMM(9 * 60 + 15), '09:15');
  assert.equal(hhmmToPerc('09:15'), 555);
  assert.equal(hhmmToPerc('9:15'), null);
  assert.equal(hhmmToPerc('09:10'), null); // nincs a rácson
  assert.equal(hhmmToPerc('24:00'), null);
  assert.equal(hhmmToPerc('abc'), null);
});

test('érvényes dátum: formátum és naptári létezés', () => {
  assert.equal(ervenyesDatum('2026-02-28'), true);
  assert.equal(ervenyesDatum('2026-02-30'), false);
  assert.equal(ervenyesDatum('2026-2-3'), false);
  assert.equal(ervenyesDatum("2026-01-01' OR 1=1"), false);
});
