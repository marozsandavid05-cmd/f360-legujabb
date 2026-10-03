// Időpontfoglaló · az „Állandó időpont” levelei (levelek-sorozat.js). Tesztadat: „David teszt”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sorozatVisszaigazolas, sorozatKollegaErtesito, sorozatLeallitva, ritmus, vegeSzoveg, LISTA_MAX } from '../functions/_lib/booking/levelek-sorozat.js';

const szabalyok = { lemondasOra: 24, telefon: '+36 30 503 0578' };
const alap = () => ({
  id: 'RABCDEFGHJK',
  vendeg: { nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 000 0000', megjegyzes: 'térd' },
  helyszin: { nev: 'Mexikói út', cim: 'Mexikói út 32/b' },
  szolgaltatas: { nev: 'Gyógytorna', perc: 50, ar: 15000 },
  kollega: { nev: 'Szegedi Botond' }, nap: 3, kezd: '16:00', ismetles: 1,
  kezdoDatum: '2026-10-07', vege: { tipus: 'alkalom', db: 3 },
});
const alk = (n, link = true) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 7 + 7 * i)).toISOString().slice(0, 10);
  return { datum: d, kezd: '16:00', ...(link ? { lemondasUrl: `https://f360-legujabb.pages.dev/foglalas/kezeles?t=T${i}` } : {}) };
});
const tiltott = new RegExp(['—', '–', 'undefined', 'null', 'NaN', '\\[object', 'H' + 'ermes'].join('|'));
const tiszta = (l) => { for (const m of ['targy', 'html', 'szoveg']) assert.doesNotMatch(l[m], tiltott, `${l.tipus}.${m}`); };

test('ritmus és vége: magyarul, hetente és kéthetente', () => {
  assert.equal(ritmus({ nap: 3, kezd: '16:00', ismetles: 1 }), 'szerdánként 16:00-kor');
  assert.equal(ritmus({ nap: 3, kezd: '16:00', ismetles: 2 }), 'minden második szerdán 16:00-kor');
  assert.equal(ritmus({ nap: 7, kezd: '9:30', ismetles: 2 }), 'minden második vasárnap 9:30-kor');
  assert.equal(ritmus({ nap: 1, kezd: '8:00', ismetles: 1 }), 'hétfőnként 8:00-kor');
  assert.equal(ritmus({ nap: 0, kezd: '8:00' }), '');
  assert.equal(vegeSzoveg({ vege: { tipus: 'alkalom', db: 10 } }), '10 alkalom');
  assert.equal(vegeSzoveg({ vege: { tipus: 'nyitott' } }), 'visszavonásig');
  assert.match(vegeSzoveg({ vege: { tipus: 'datum', datum: '2026-12-16' } }), /^2026\. december 16\. \(szerda\)-ig$/);
});

test('visszaigazolás: minden alkalom a saját lemondó linkjével, cím, adatok', () => {
  const l = sorozatVisszaigazolas(alap(), { alkalmak: alk(3), szabalyok });
  assert.equal(l.tipus, 'sorozat-visszaigazolas'); assert.equal(l.cimzett, 'david.teszt@example.com');
  assert.match(l.targy, /szerdánként 16:00-kor/);
  for (let i = 0; i < 3; i++) { assert.ok(l.html.includes(`?t=T${i}`)); assert.ok(l.szoveg.includes(`?t=T${i}`)); }
  for (const x of ['Szegedi Botond', 'Gyógytorna (50 perc)', '15 000 Ft alkalmanként', '3 alkalom', 'csak arra az egy alkalomra', '+36 30 503 0578', 'emlékeztetőt']) {
    assert.ok(l.szoveg.includes(x), x);
  }
  tiszta(l);
});

test('hosszú sorozat: legfeljebb 12 alkalom név szerint, utána összesítve', () => {
  const l = sorozatVisszaigazolas({ ...alap(), vege: { tipus: 'nyitott' } }, { alkalmak: alk(20), szabalyok });
  assert.equal((l.html.match(/<li /g) || []).length, LISTA_MAX);
  assert.match(l.szoveg, /És még 8 alkalom/);
  assert.match(l.szoveg, /visszavonásig érvényes/);
  tiszta(l);
});

test('kolléga-értesítő: vendég adatai benne, a vendég lemondó linkje NINCS benne', () => {
  for (const esemeny of ['uj', 'leallitva']) {
    const l = sorozatKollegaErtesito(alap(), 'botond@example.com', { alkalmak: alk(3), esemeny });
    assert.equal(l.tipus, 'sorozat-kollega'); assert.equal(l.esemeny, esemeny); assert.equal(l.cimzett, 'botond@example.com');
    assert.doesNotMatch(l.html + l.szoveg, /\?t=T/);
    assert.ok(l.szoveg.includes('David teszt') && l.szoveg.includes('+36 30 000 0000'));
    assert.doesNotMatch(l.szoveg, /Ár:/);
    tiszta(l);
  }
});

test('stúdió-értesítő: saját típus, a kolléga neve a tárgyban, nincs vendég-link', () => {
  for (const esemeny of ['uj', 'leallitva']) {
    const l = sorozatKollegaErtesito(alap(), 'info@f360.hu', { alkalmak: alk(2), esemeny, studio: true });
    assert.equal(l.tipus, 'sorozat-studio'); assert.equal(l.cimzett, 'info@f360.hu');
    assert.match(l.targy, /Szegedi Botond/);
    assert.doesNotMatch(l.szoveg, /hozzád/); assert.doesNotMatch(l.html + l.szoveg, /\?t=T/);
    tiszta(l);
  }
  assert.equal(sorozatKollegaErtesito(alap(), 'b@x.hu', { esemeny: 'uj' }).tipus, 'sorozat-kollega');
});

test('leállítás: lemondott és megmaradt alkalmak külön, csak a megmaradtak kapnak linket', () => {
  const l = sorozatLeallitva(alap(), { lemondott: alk(2, true), maradt: [{ datum: '2026-10-07', kezd: '16:00', lemondasUrl: 'https://x/kezeles?t=MARAD' }], szabalyok });
  assert.equal(l.tipus, 'sorozat-leallitva');
  assert.match(l.szoveg, /Ezeket az alkalmakat lemondtuk/); assert.match(l.szoveg, /Ezek az alkalmak megmaradnak/);
  assert.ok(l.html.includes('t=MARAD')); assert.doesNotMatch(l.html, /\?t=T0/);
  tiszta(l);
});

test('biztonság: a vendég adatai escape-elve, a tárgy és a szöveg egysoros', () => {
  const s = alap();
  s.vendeg = { nev: 'David teszt<script>alert(1)</script>\r\nBcc: x@y.hu', email: '', telefon: '"><img src=x onerror=1>', megjegyzes: "a'b" };
  s.kollega = { nev: 'Botond<b>' };
  const ls = [sorozatVisszaigazolas(s, { alkalmak: alk(1), szabalyok }), sorozatKollegaErtesito(s, 'k@example.com', { alkalmak: alk(1) }),
    sorozatLeallitva(s, { lemondott: alk(1), maradt: [], szabalyok })];
  for (const l of ls) {
    assert.doesNotMatch(l.html, /<script|<img|<b>/); assert.doesNotMatch(l.targy, /[\r\n]/);
    assert.doesNotMatch(l.szoveg, /\r\nBcc:|\nBcc:/);
  }
  assert.equal(ls[0].cimzett, '');
});
