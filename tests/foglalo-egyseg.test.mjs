// Időpontfoglaló · séma, seed, levelek, .ics, token (egységtesztek)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeD1 } from './_d1.mjs';
import { SEMA, torzsBetolt, titok } from '../functions/_lib/booking/schema.js';
import { SEED_TORZS, SEED_BEOSZTAS } from '../functions/_lib/booking/seed.js';
import { torzsEllenoriz } from '../functions/_lib/booking/admin.js';
import { icsKeszit } from '../functions/_lib/booking/ics.js';
import { visszaigazolas, studioErtesito, lemondasLevel } from '../functions/_lib/booking/levelek.js';
import { tokenKeszit, tokenEllenoriz, ujAzonosito, ujSo } from '../functions/_lib/booking/token.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = path.join(ROOT, 'functions/_lib/booking');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

test('schema.sql és a kódbeli SEMA ugyanaz', () => {
  const sql = fs.readFileSync(path.join(BOOK, 'schema.sql'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map(norm).filter(Boolean);
  assert.deepEqual(sql, SEMA.map(norm));
});

test('a séma kétszer lefuttatva sem hibázik, a seed egyszer kerül be, a szerkesztettet nem írja felül', async () => {
  const db = fakeD1();
  const a = await torzsBetolt(db);
  assert.equal(a.minta, true);
  db._raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify({ ...a, minta: false }));
  const db2 = { ...db }; // új kötés-objektum, ugyanaz az adatbázis (mint egy új isolate)
  const b = await torzsBetolt(db2);
  assert.equal(b.minta, false);
  assert.equal(db._raw.prepare('SELECT COUNT(*) AS n FROM schedule').get().n, SEED_BEOSZTAS.length);
});

test('a MINTA seed átmegy az admin-ellenőrzésen, és minden hivatkozása érvényes', () => {
  assert.doesNotThrow(() => torzsEllenoriz(structuredClone(SEED_TORZS)));
  const hely = new Set(SEED_TORZS.helyszinek.map((h) => h.id));
  for (const b of SEED_BEOSZTAS) {
    const k = SEED_TORZS.kollegak.find((x) => x.id === b.kollega);
    assert.ok(k, b.kollega);
    assert.ok(hely.has(b.helyszin) && k.helyszinek.includes(b.helyszin), `${b.kollega} ${b.helyszin}`);
  }
  // minden szolgáltatáshoz van legalább egy kolléga, aki végzi, és be is van osztva arra a helyszínre;
  // kivétel Kovács Anna táplálkozási szolgáltatásai: neki szándékosan nincs kitalált beosztása (Lilla adja meg)
  const BEOSZTAS_NELKUL = new Set(['taplalkozas-alapcsomag', 'taplalkozas-kiegeszito', 'inbody-770']);
  for (const s of SEED_TORZS.szolgaltatasok) {
    assert.ok(SEED_TORZS.kollegak.some((k) => k.szolgaltatasok.includes(s.id)), `${s.id}: nincs kolléga`);
    if (BEOSZTAS_NELKUL.has(s.id)) continue;
    const ok = SEED_TORZS.kollegak.some((k) => k.szolgaltatasok.includes(s.id)
      && SEED_BEOSZTAS.some((b) => b.kollega === k.id && s.helyszinek.includes(b.helyszin)));
    assert.ok(ok, s.id);
  }
});

test('a seed kódban MINTA-jelölés van', () => {
  const src = fs.readFileSync(path.join(BOOK, 'seed.js'), 'utf8');
  assert.ok((src.match(/\/\/ MINTA/g) || []).length >= 2);
});

const F = {
  azonosito: 'F0123456789', datum: '2026-10-25', kezd: '09:00', veg: '09:50', kezdPerc: 540,
  helyszin: { id: 'mexikoi', nev: 'Mexikói út', cim: 'Mexikói út 32/b, XIV. kerület' },
  szolgaltatas: { id: 'gy', nev: 'Gyógymasszázs', perc: 50, ar: 13500 },
  kollega: { id: 'sb', nev: 'Szegedi Botond' },
  nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: 'Hát; fáj, a vállam',
};
const SZ = SEED_TORZS.szabalyok;

test('.ics: DST-váltás napján is helyes UTC, escape-elt szöveg, 75 bájtos sorhajtogatás', () => {
  const s = icsKeszit(F, { host: 'x.pages.dev', most: Date.parse('2026-09-28T10:00:00Z'), lemondasUrl: 'https://x.pages.dev/foglalas/lemondas?t=' + 'a'.repeat(60) });
  assert.ok(s.includes('DTSTART:20261025T080000Z')); // 2026-10-25 télen: +1
  assert.ok(s.includes('DTEND:20261025T085000Z'));
  assert.ok(s.includes('LOCATION:Studio F360\\, Mexikói út 32/b\\, XIV. kerület'));
  for (const sor of s.split('\r\n')) assert.ok(new TextEncoder().encode(sor).length <= 75, sor);
  assert.ok(s.endsWith('END:VCALENDAR\r\n'));
});

test('levelek: három típus, magyar, gondolatjel nélkül, a felhasználói adat escape-elve', () => {
  const x = { ...F, nev: 'David <b>teszt</b>' };
  const lv = [
    visszaigazolas(x, { lemondasUrl: 'https://h/foglalas/lemondas?t=a&b', icsUrl: 'https://h/i', szabalyok: SZ, ics: 'ICS' }),
    studioErtesito(x, { szabalyok: SZ }),
    lemondasLevel(x, { szabalyok: SZ }),
  ];
  assert.deepEqual(lv.map((l) => l.tipus), ['visszaigazolas', 'studio-ertesito', 'lemondas']);
  assert.deepEqual(lv.map((l) => l.cimzett), ['david.teszt@example.com', 'info@f360.hu', 'david.teszt@example.com']);
  for (const l of lv) {
    assert.ok(!/[\u2013\u2014]/.test(l.targy + l.html + l.szoveg), `gondolatjel: ${l.tipus}`);
    assert.ok(!l.html.includes('<b>teszt</b>'));
    assert.ok(l.html.includes('David &lt;b&gt;teszt&lt;/b&gt;'));
    assert.match(l.szoveg, /2026\. október 25\. \(vasárnap\)/);
    // csak az arculati színek
    const hexek = new Set((l.html.match(/#[0-9A-Fa-f]{6}/g) || []).map((h) => h.toUpperCase()));
    for (const h of hexek) assert.ok(['#303030', '#BFA18F', '#EAEAEA', '#E4DBD2', '#CCD6D9'].includes(h), h);
  }
  assert.ok(lv[0].html.includes('href="https://h/foglalas/lemondas?t=a&amp;b"'));
  assert.equal(lv[0].ics, 'ICS');
  assert.match(lv[0].szoveg, /24 óráig/);
});

test('token: saját titokkal ellenőrizhető, más sóval vagy titokkal nem', async () => {
  const id = ujAzonosito();
  assert.match(id, /^F[0-9A-HJKMNP-TV-Z]{10}$/);
  const so = ujSo();
  const t = await tokenKeszit('titok-1234567890ab', id, so);
  assert.equal(await tokenEllenoriz('titok-1234567890ab', t, so), true);
  assert.equal(await tokenEllenoriz('titok-1234567890ab', t, ujSo()), false);
  assert.equal(await tokenEllenoriz('masik-1234567890ab', t, so), false);
  assert.equal(await tokenEllenoriz('titok-1234567890ab', t.replace(id, ujAzonosito()), so), false);
});

test('titok: rövid BOOKING_SECRET nem elég, ilyenkor a D1-es tartalék él', async () => {
  const db = fakeD1();
  const a = await titok({ BOOKING_SECRET: 'rovid' }, db);
  assert.equal(a.length, 64);
  assert.equal(await titok({}, db), a);
  assert.equal(await titok({ BOOKING_SECRET: 'x'.repeat(32) }, db), 'x'.repeat(32));
});

test('admin-ellenőrzés: a „barki” foglalt azonosító, a hibás listaelem 400 (nem 500)', () => {
  const t = structuredClone(SEED_TORZS);
  t.kollegak[0].id = 'barki';
  assert.throws(() => torzsEllenoriz(t), (e) => e.status === 400);
  for (const k of ['helyszinek', 'szolgaltatasok', 'kollegak']) {
    const u = structuredClone(SEED_TORZS);
    u[k].push(null);
    assert.throws(() => torzsEllenoriz(u), (e) => e.status === 400, k);
  }
});
