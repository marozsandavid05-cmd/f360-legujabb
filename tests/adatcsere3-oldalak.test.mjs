// Statikus oldalak a 3. adatkör szerint (2026-10-21, Lilla 2026-10-20-i válaszai):
//  1. a Reitter-felmérés neve „Állapotfelmérés (1. alkalom)”, a régi „Sportrehabilitációs állapotfelmérés” sehol
//  9. a kiírt nyitvatartás: hétfő-péntek 7:00-21:00, szombat Reitter 8:00-14:00, Mexikói út 8:00-12:00, vasárnap zárva
// 10. Árak: nyirokmasszázs (választott testrész, 50 perc) 18 000 Ft; posztnatális rehabilitáció 14 500 Ft
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const olvas = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const szoveg = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const HTML = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).concat(['foglalas/koszonjuk.html']);
const SHELL_OLDAL = HTML.filter((f) => !/http-equiv="refresh"/.test(olvas(f)));

test('1. a régi név („Sportrehabilitációs állapotfelmérés”) sehol: oldalak, foglaló-mock, seed', () => {
  for (const f of [...HTML, 'js/foglalo-mock.js', 'functions/_lib/booking/seed.js']) {
    assert.ok(!/Sportrehabilitációs állapotfelmérés/i.test(olvas(f)), f);
  }
});

test('1. Árak: „Állapotfelmérés (1. alkalom)” 50 perc 20 000 Ft a Reitter-táblában', () => {
  assert.match(szoveg(olvas('arak.html')), /Állapotfelmérés \(1\. alkalom\) 50 perc[^F]*20 000 Ft/);
});

test('10. Árak: nyirokmasszázs, választott testrész 50 perc 18 000 Ft (nem 15 000)', () => {
  const t = szoveg(olvas('arak.html'));
  assert.match(t, /Nyirokmasszázs · választott testrész 50 perc 18 000 Ft/);
  assert.doesNotMatch(t, /választott testrész 50 perc 15 000 Ft/);
});

test('10. Árak: posztnatális rehabilitáció 14 500 Ft a gyógytorna mellett', () => {
  const t = szoveg(olvas('arak.html'));
  assert.match(t, /Gyógytorna kezelés mozgáson keresztül 14 500 Ft Posztnatális rehabilitáció [^F]*állapotfelmérés[^F]*14 500 Ft/);
});

test('9. Kapcsolat: mindkét helyszín kiírt nyitvatartása a szombattal és a vasárnappal', () => {
  const t = szoveg(olvas('kapcsolat.html'));
  assert.match(t, /Mexikói út .*?Nyitvatartás Hétfő-péntek: 7:00-21:00 Szombat: 8:00-12:00 Vasárnap: zárva/);
  assert.match(t, /Reitter Ferenc utca .*?Nyitvatartás Hétfő-péntek: 7:00-21:00 Szombat: 8:00-14:00 Vasárnap: zárva/);
});

test('9. Mexikói út oldal: mindkét kiírt nyitvatartásban szombat 8:00-12:00', () => {
  const t = szoveg(olvas('mexikoi.html'));
  assert.equal((t.match(/Nyitvatartás H-P: 7:00-21:00 · Szo: 8:00-12:00/g) || []).length, 2);
});

test('9. lábléc minden oldalon: hétköznap és szombat helyszínenként', () => {
  for (const f of SHELL_OLDAL) {
    const t = olvas(f);
    assert.ok(t.includes('<span class="footer__hours">H-P: 7:00-21:00 · Szo: Reitter 8:00-14:00, Mexikói út 8:00-12:00</span>'), f);
    assert.ok(!t.includes('<span class="footer__hours">H-P: 7:00-21:00</span>'), f);
  }
});

test('gondolatjel (U+2013, U+2014) a kiírt nyitvatartásban nincs', () => {
  for (const f of HTML) assert.doesNotMatch(olvas(f), /Hétfő–péntek|07:00–21:00/, f);
});
