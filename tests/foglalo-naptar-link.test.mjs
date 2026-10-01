// Időpontfoglaló · „Hozzáadás a naptárhoz”: Google Naptár link (nyári és téli idő), .ics inline válasz,
// és a Google-link a visszaigazoló és a módosító levélben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import { googleNaptarUrl } from '../functions/_lib/booking/ics.js';
import { visszaigazolas, modositasLevel } from '../functions/_lib/booking/levelek.js';
import { SEED_TORZS } from '../functions/_lib/booking/seed.js';
import { onRequest as publikus } from '../functions/foglalas-api/[[utvonal]].js';
import { budapestMost, datumPlusz, hetNapja } from '../functions/_lib/booking/ido.js';

const F = (datum, kezdPerc, perc = 50) => ({
  azonosito: 'F0123456789',
  datum,
  kezd: `${String(Math.floor(kezdPerc / 60)).padStart(2, '0')}:${String(kezdPerc % 60).padStart(2, '0')}`,
  veg: `${String(Math.floor((kezdPerc + perc) / 60)).padStart(2, '0')}:${String((kezdPerc + perc) % 60).padStart(2, '0')}`,
  kezdPerc,
  helyszin: { id: 'mexikoi', nev: 'Mexikói út', cim: 'Mexikói út 32/b, XIV. kerület' },
  szolgaltatas: { id: 'gy', nev: 'Gyógymasszázs', perc, ar: 13500 },
  kollega: { id: 'sb', nev: 'Szegedi Botond' },
  nev: 'David teszt', email: 'david.teszt@example.com',
});
const LINK = 'https://h.pages.dev/foglalas/lemondas?t=F0123456789.abc';

test('Google Naptár link: nyári időben (2026-10-20 10:00 Budapest) 08:00Z', () => {
  const u = new URL(googleNaptarUrl(F('2026-10-20', 600), { lemondasUrl: LINK }));
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('dates'), '20261020T080000Z/20261020T085000Z');
  assert.equal(u.searchParams.get('text'), 'Gyógymasszázs · Studio F360');
  assert.equal(u.searchParams.get('location'), 'Studio F360, Mexikói út 32/b, XIV. kerület');
  const d = u.searchParams.get('details');
  assert.ok(d.includes('Szegedi Botond'), d);
  assert.ok(d.includes(LINK), d);
  assert.ok(d.includes('F0123456789'), d);
});

test('Google Naptár link: téli időben (2026-11-03 10:00 Budapest) 09:00Z', () => {
  const u = new URL(googleNaptarUrl(F('2026-11-03', 600), { lemondasUrl: LINK }));
  assert.equal(u.searchParams.get('dates'), '20261103T090000Z/20261103T095000Z');
});

test('Google Naptár link: a váltás napján (2026-10-25 10:00 Budapest, már téli) 09:00Z', () => {
  const u = new URL(googleNaptarUrl(F('2026-10-25', 600), { lemondasUrl: LINK }));
  assert.equal(u.searchParams.get('dates'), '20261025T090000Z/20261025T095000Z');
});

test('levelek: a visszaigazoló és a módosító levélben ott a Google Naptár link is', () => {
  const f = F('2026-11-03', 600);
  const o = { lemondasUrl: LINK, icsUrl: 'https://h.pages.dev/foglalas-api/foglalas.ics?t=x', szabalyok: SEED_TORZS.szabalyok, ics: 'ICS' };
  for (const l of [visszaigazolas(f, o), modositasLevel(f, { ...o, regi: F('2026-10-20', 600) })]) {
    const g = googleNaptarUrl(f, { lemondasUrl: LINK });
    assert.ok(l.html.includes('https://calendar.google.com/calendar/render?'), l.tipus);
    assert.ok(l.html.includes(g.replace(/&/g, '&amp;')), l.tipus);
    assert.ok(l.html.includes('Google Naptár'), l.tipus);
    assert.ok(l.szoveg.includes(g), l.tipus);
    assert.ok(!/[\u2013\u2014]/.test(l.html + l.szoveg), `gondolatjel: ${l.tipus}`);
    // a csatolt fájl és a régi link marad
    assert.ok(l.html.includes('ezzel a linkkel'), l.tipus);
    assert.equal(l.ics, 'ICS');
  }
});

test('.ics végpont: Content-Disposition inline, a fájlnév marad', async () => {
  const ORIGIN = 'https://foglalo.f360-legujabb.pages.dev';
  const env = { BOOKING_DB: fakeD1(), BOOKING_SECRET: 'teszt-titok-'.padEnd(48, 'x') };
  let nap = datumPlusz(budapestMost().datum, 3);
  while (hetNapja(nap) !== 1) nap = datumPlusz(nap, 1);
  const body = { helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: nap, kezd: '10:00',
    nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true };
  const req = (method, path, b) => new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, 'CF-Connecting-IP': '1.2.3.4', ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const r = await publikus({ request: req('POST', '/foglalas-api/foglalas', body), env, params: {}, data: {} });
  assert.equal(r.status, 201);
  const d = await r.json();
  const ics = await publikus({ request: req('GET', new URL(d.ics).pathname + new URL(d.ics).search), env, params: {}, data: {} });
  assert.equal(ics.status, 200);
  assert.equal(ics.headers.get('Content-Disposition'), `inline; filename="studio-f360-${d.azonosito}.ics"`);
  assert.match(ics.headers.get('Content-Type'), /^text\/calendar/);
});
