// A tesztekben és a böngészős mockban minden kitalált foglaló neve „David teszt” (David kérése,
// 2026-10-01). A „Hermes” név tesztadatként sehol nem szerepelhet, és kitalált, valódinak látszó
// személy (név vagy gmail-cím) sem kerülhet a mockba, mert az admin bemutatón az látszana.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GYOKER = join(dirname(fileURLToPath(import.meta.url)), '..');
const tesztFajlok = readdirSync(join(GYOKER, 'tests')).filter((f) => f.endsWith('.mjs') && f !== 'teszt-adatok.test.mjs');
const mock = readFileSync(join(GYOKER, 'js', 'foglalo-mock.js'), 'utf8');
const olvas = (f) => readFileSync(join(GYOKER, 'tests', f), 'utf8');

test('tesztadat: „Hermes” sehol nincs a tesztekben és a mockban', () => {
  for (const f of tesztFajlok) assert.ok(!/hermes/i.test(olvas(f)), f);
  assert.ok(!/hermes/i.test(mock), 'js/foglalo-mock.js');
});

test('tesztadat: a foglalók neve a tesztekben „David teszt” (más kitalált név nincs)', () => {
  const tiltott = /Minta Vendég|Kiss Éva|Kiss <b>Éva|Farkas Dóra|vendeg@example\.com|eva@example\.com|nev: '(Első|Második|Más|Másik|Versenyző)'/;
  for (const f of tesztFajlok) {
    const m = olvas(f).match(tiltott);
    assert.equal(m, null, `${f}: ${m && m[0]}`);
  }
});

test('tesztadat: a mock minden kitalált foglalója „David teszt”, valódinak látszó név és gmail-cím nélkül', () => {
  assert.ok(!/Farkas Dóra|dora\.farkas|@gmail\.com'/.test(mock));
  assert.ok(!/var VEZ = \[|var KER = \[/.test(mock), 'a véletlen névgenerátor tömbjei');
  // a kitalált foglalók: ahol a név szöveg-literál vagy kifejezés (nem egy már meglévő sor mezője)
  const nevek = [...mock.matchAll(/nev: ('[^']*'|[^,}]*\+[^,}]*), email:/g)].map((m) => m[1].trim());
  assert.ok(nevek.length >= 2, nevek.join(' | '));
  for (const n of nevek) assert.equal(n, "'David teszt'");
});
