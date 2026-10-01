// Közös teszt-segéd a foglaló Lilla-körös tesztjeihez (kolléga-kezelés, értesítések,
// emlékeztető, e-mail-küldés, kampány-forrás). Nem teszt-fájl (nincs .test a nevében).
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import { onRequest as publikus } from '../functions/foglalas-api/[[utvonal]].js';
import { onRequest as adminRouter } from '../functions/api/foglalo/[[utvonal]].js';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { budapestMost, datumPlusz, hetNapja } from '../functions/_lib/booking/ido.js';

export const ORIGIN = 'https://foglalo.f360-legujabb.pages.dev';
export const SECRET = 'teszt-titok-'.padEnd(48, 'x');
export const TESZT_NEV = 'David teszt';

export const ujEnv = (extra = {}) => ({ BOOKING_DB: fakeD1(), BOOKING_SECRET: SECRET, ...extra });

export function keres(env, method, path, { body, origin = ORIGIN, ip = '1.2.3.4', headers = {}, waitUntil } = {}) {
  const h = { 'CF-Connecting-IP': ip, ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const request = new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = { request, env, params: {}, data: {} };
  if (waitUntil) ctx.waitUntil = waitUntil;
  return publikus(ctx);
}
export const get = (env, path, o) => keres(env, 'GET', path, o);
export const post = (env, path, body, o = {}) => keres(env, 'POST', path, { ...o, body });

export function admin(env, method, path, body, { waitUntil } = {}) {
  const url = 'http://127.0.0.1:8788' + path;
  const headers = { Origin: 'http://127.0.0.1:8788' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const context = { request, env: { ...env, DEV_EMAIL: 'david@teszt.hu' }, data: {}, params: {} };
  if (waitUntil) context.waitUntil = waitUntil;
  context.next = () => adminRouter(context);
  return middleware(context);
}

/** Az első, legalább 3 nap múlva eső hétfő (Szegedi Botond a Mexikóiban 9-17). */
export function celHetfo() {
  let d = datumPlusz(budapestMost().datum, 3);
  while (hetNapja(d) !== 1) d = datumPlusz(d, 1);
  return d;
}
export const NAP = celHetfo();

/** Az első adott hétköznap (1 = hétfő ... 7 = vasárnap) legalább `min` nap múlva. */
export function kovNap(nap, min = 3) {
  let d = datumPlusz(budapestMost().datum, min);
  while (hetNapja(d) !== nap) d = datumPlusz(d, 1);
  return d;
}

export const alap = (o = {}) => ({
  helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: NAP, kezd: '10:00',
  nev: TESZT_NEV, email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true, ...o,
});
export const tokenBol = (url) => new URL(url).searchParams.get('t');
export const sorok = (env, sql, ...a) => env.BOOKING_DB._raw.prepare(sql).all(...a);

export async function foglalj(env, o = {}, ip = '1.2.3.4') {
  const r = await post(env, '/foglalas-api/foglalas', alap(o), { ip });
  assert.equal(r.status, 201, await r.clone().text());
  const d = await r.json();
  return { ...d, t: tokenBol(d.lemondasUrl) };
}

/** A törzsadat egy kollégájának mezőit írja át közvetlenül (a tesztek előkészítéséhez). */
export async function kollegaAtir(env, id, mezok) {
  const r = await admin(env, 'GET', '/api/foglalo/beallitasok');
  const t = await r.json();
  t.kollegak = t.kollegak.map((k) => (k.id === id ? { ...k, ...mezok } : k));
  env.BOOKING_DB._raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(t));
  return t;
}

export async function szabalyAtir(env, mezok) {
  const r = await admin(env, 'GET', '/api/foglalo/beallitasok');
  const t = await r.json();
  t.szabalyok = { ...t.szabalyok, ...mezok };
  env.BOOKING_DB._raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(t));
  return t;
}

export const outbox = (env, tipus) => sorok(env, `SELECT * FROM outbox ${tipus ? 'WHERE tipus = ?' : ''} ORDER BY id`, ...(tipus ? [tipus] : []));
