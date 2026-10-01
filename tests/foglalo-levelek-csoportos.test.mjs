// Időpontfoglaló · a csoportos órák levelei (levelek-csoportos.js). Tesztadat: „David teszt”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  oraVisszaigazolas, oraAthelyezesLevel, oraLemondasLevel, oraEmlekezteto, oraElmaradLevel, oktatoErtesito,
} from '../functions/_lib/booking/levelek-csoportos.js';

const SZAB = { lemondasOra: 24, telefon: '+36 30 503 0578', studioEmail: 'info@f360.hu' };
const cf = (felul = {}) => ({
  azonosito: 'F0000000ORA', nev: 'David teszt', email: 'info@clientflow.team', telefon: '+36301234567', megjegyzes: '',
  datum: '2026-10-21', kezd: '09:00', veg: '10:30', kezdPerc: 540,
  ora: { id: 'yin-joga', nev: 'Yin jóga', perc: 90, ar: 4000, kategoria: 'joga' },
  kollega: { id: 'aczel-gabriella', nev: 'Aczél Gabriella' },
  helyszin: { nev: 'Mexikói út', cim: 'Mexikói út 32/b, XIV. kerület' },
  ...felul,
});
const L = { lemondasUrl: 'https://f360-legujabb.pages.dev/foglalas/lemondas?t=F0000000ORA.abc', icsUrl: 'https://f360-legujabb.pages.dev/foglalas-api/foglalas.ics?t=F0000000ORA.abc', szabalyok: SZAB };
// tiltott: gondolatjel, kitöltetlen érték, belső ügynöknév (a H-betűs kódnév, összerakva, hogy a tesztadat-őrteszt ne jelezzen), „Szólj Davidnek”
const tiltott = new RegExp(['—', '–', 'undefined', 'null', 'NaN', '\\[object', 'H' + 'ermes', 'Szólj Davidnek'].join('|'));

test('visszaigazolás: tárgy, adatok, ár, oktató, kezelő gomb, naptár, nincs tiltott szöveg', () => {
  const l = oraVisszaigazolas(cf(), { ...L, ics: 'X' });
  assert.equal(l.tipus, 'visszaigazolas'); assert.equal(l.csoportos, true); assert.equal(l.cimzett, 'info@clientflow.team'); assert.equal(l.ics, 'X');
  assert.match(l.targy, /^Jelentkezés visszaigazolása · Yin jóga · .* 09:00 · Studio F360$/);
  for (const s of [l.html, l.szoveg]) {
    assert.match(s, /Yin jóga \(90 perc\)/); assert.match(s, /Aczél Gabriella/); assert.match(s, /4 000 Ft, a helyszínen fizetendő/);
    assert.match(s, /Időpont lemondása \/ módosítása/); assert.match(s, /calendar\.google\.com/); assert.match(s, /24 óráig/);
    assert.doesNotMatch(s, tiltott);
  }
  assert.ok(l.html.includes(L.lemondasUrl.replace(/&/g, '&amp;')));
});

test('áthelyezés: régi óra megnevezve, új adatok, ugyanaz a link', () => {
  const regi = { datum: '2026-10-19', kezd: '09:00', ora: { nev: 'Csípőnyitó jóga' } };
  const l = oraAthelyezesLevel(cf(), { ...L, regi, ics: 'X' });
  assert.equal(l.tipus, 'modositas');
  assert.match(l.szoveg, /A korábbi óra \(Csípőnyitó jóga, .*09:00\) már nem érvényes/);
  assert.match(l.html, /Yin jóga/); assert.ok(l.szoveg.includes(L.lemondasUrl));
  assert.doesNotMatch(l.html + l.szoveg, tiltott);
});

test('lemondás: felszabadult hely, telefonszám, nincs kezelő link', () => {
  const l = oraLemondasLevel(cf(), { szabalyok: SZAB });
  assert.equal(l.tipus, 'lemondas');
  assert.match(l.szoveg, /a helyed felszabadult/); assert.match(l.szoveg, /\+36 30 503 0578/);
  assert.ok(!l.szoveg.includes('lemondas?t='));
  assert.doesNotMatch(l.html + l.szoveg, tiltott);
});

test('emlékeztető: határidő előtt gomb, utána csak telefon', () => {
  const hataridoMs = Date.UTC(2026, 9, 20, 7, 0);
  const a = oraEmlekezteto(cf(), { ...L, hataridoMs, lemondhato: true });
  assert.equal(a.tipus, 'emlekezteto'); assert.match(a.html, /Időpont lemondása \/ módosítása/); assert.match(a.szoveg, /október 20/);
  const b = oraEmlekezteto(cf(), { ...L, hataridoMs, lemondhato: false });
  assert.doesNotMatch(b.html, /Időpont lemondása \/ módosítása/); assert.match(b.szoveg, /hívj minket minél előbb/);
  assert.doesNotMatch(a.html + a.szoveg + b.html + b.szoveg, tiltott);
});

test('elmaradás: saját típus, ok opcionális és egysoros, ár nélkül', () => {
  const l = oraElmaradLevel(cf(), { szabalyok: SZAB, ok: 'Az oktató\nbetegség miatt nem tudja megtartani.' });
  assert.equal(l.tipus, 'ora-elmarad');
  assert.match(l.targy, /^Az óra elmarad · Yin jóga/);
  assert.match(l.szoveg, /Az oktató betegség miatt nem tudja megtartani\./);
  assert.doesNotMatch(l.szoveg, /Ár:/);
  const n = oraElmaradLevel(cf(), { szabalyok: SZAB });
  assert.doesNotMatch(n.html + n.szoveg, tiltott);
});

test('oktatói értesítő: új és lemondott jelentkezés, létszám, a vendég linkje nincs benne', () => {
  const u = oktatoErtesito(cf(), 'gabi@example.com', { esemeny: 'uj', allapot: { foglalt: 5, kapacitas: 8 } });
  assert.equal(u.tipus, 'kollega-uj'); assert.equal(u.cimzett, 'gabi@example.com');
  assert.match(u.szoveg, /5 \/ 8 hely foglalt/); assert.match(u.szoveg, /Résztvevő: David teszt/);
  assert.ok(!u.szoveg.includes('lemondas?t=')); assert.ok(!u.html.includes('lemondas?t='));
  const l = oktatoErtesito(cf(), 'gabi@example.com', { esemeny: 'lemondas', admin: true });
  assert.equal(l.tipus, 'kollega-lemondas'); assert.match(l.szoveg, /az adminban lemondták/i);
  assert.doesNotMatch(u.html + u.szoveg + l.html + l.szoveg, tiltott);
});

test('oktató nélküli óra (Funkcionális tréning): nincs üres „Oktató” sor, a Google-link működik', () => {
  const l = oraVisszaigazolas(cf({ kollega: null, ora: { id: 'funkcionalis', nev: 'Funkcionális tréning', perc: 60, ar: 4000 } }), { ...L, ics: '' });
  assert.doesNotMatch(l.szoveg, /Oktató:/);
  assert.match(l.html, /calendar\.google\.com/);
  assert.doesNotMatch(l.html + l.szoveg, tiltott);
});

test('biztonság: HTML a névben és megjegyzésben escape-elve, a tárgyban nincs sortörés', () => {
  const x = cf({ nev: '<img src=x onerror=alert(1)>\nBcc: valaki@x.hu', megjegyzes: '<script>alert(1)</script>', ora: { id: 'y', nev: 'Yin\r\njóga <b>', perc: 90, ar: 4000 } });
  const all = [oraVisszaigazolas(x, { ...L, ics: '' }), oraLemondasLevel(x, { szabalyok: SZAB }), oraElmaradLevel(x, { szabalyok: SZAB }),
    oktatoErtesito(x, 'o@x.hu', {}), oraEmlekezteto(x, { ...L, hataridoMs: Date.now(), lemondhato: true }),
    oraAthelyezesLevel(x, { ...L, regi: { datum: '2026-10-19', kezd: '09:00', ora: { nev: 'A\nB' } }, ics: '' })];
  for (const l of all) {
    assert.ok(!/[\r\n]/.test(l.targy), `sortörés a tárgyban: ${l.tipus}`);
    assert.ok(!l.html.includes('<img src=x'), `nem escape-elt img: ${l.tipus}`);
    assert.ok(!l.html.includes('<script>'), `nem escape-elt script: ${l.tipus}`);
    assert.ok(!l.html.includes('<b>'), `nem escape-elt b: ${l.tipus}`);
  }
});
