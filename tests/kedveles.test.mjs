// A nyilvános kedvelés-számláló (functions/kedveles.js) tesztje valódi SQLite-tal (node:sqlite),
// egy vékony D1-utánzattal (prepare/bind/all/first/run/batch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet, onRequestPost, _semaReset } from '../functions/kedveles.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
    _exec: () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s._exec()) };
}

const ORIGIN = 'https://f360-legujabb.pages.dev';
const SLUG = '2026-08-24-feherje-mennyi-kell-valojaban';
const V1 = 'a'.repeat(32), V2 = 'b'.repeat(32);

function post(env, body, { origin = ORIGIN, ip = '1.2.3.4' } = {}) {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (origin) h.Origin = origin;
  return onRequestPost({ env, request: new Request(ORIGIN + '/kedveles', { method: 'POST', headers: h, body: JSON.stringify(body) }) });
}
const get = (env, q) => onRequestGet({ env, request: new Request(ORIGIN + '/kedveles?s=' + q) });

function env(extra = {}) { _semaReset(); return { LIKES_DB: fakeD1(), ...extra }; }

test('0-ról indul, két látogató kedvel → 2, mindenki ugyanazt látja', async () => {
  const e = env();
  let r = await (await get(e, SLUG)).json();
  assert.equal(r.counts[SLUG], 0);
  assert.equal((await (await post(e, { slug: SLUG, voter: V1, like: true })).json()).count, 1);
  assert.equal((await (await post(e, { slug: SLUG, voter: V2, like: true })).json()).count, 2);
  r = await (await get(e, SLUG)).json();
  assert.equal(r.counts[SLUG], 2);
});

test('ugyanaz a látogató kétszer nem számít, visszavonni tud', async () => {
  const e = env();
  await post(e, { slug: SLUG, voter: V1, like: true });
  assert.equal((await (await post(e, { slug: SLUG, voter: V1, like: true })).json()).count, 1);
  assert.equal((await (await post(e, { slug: SLUG, voter: V1, like: false })).json()).count, 0);
  assert.equal((await (await post(e, { slug: SLUG, voter: V1, like: false })).json()).count, 0);
});

test('idegen oldalról (más Origin vagy Origin nélkül) 403', async () => {
  const e = env();
  assert.equal((await post(e, { slug: SLUG, voter: V1, like: true }, { origin: 'https://gonosz.example' })).status, 403);
  assert.equal((await post(e, { slug: SLUG, voter: V1, like: true }, { origin: null })).status, 403);
});

test('hibás slug vagy voter 400, túl sok slug 400', async () => {
  const e = env();
  assert.equal((await post(e, { slug: '../admin', voter: V1, like: true })).status, 400);
  assert.equal((await post(e, { slug: SLUG, voter: 'x', like: true })).status, 400);
  assert.equal((await get(e, "x'; DROP TABLE kedveles;--")).status, 400);
  const sok = Array.from({ length: 61 }, (_, i) => `2026-01-01-a${i}`).join(',');
  assert.equal((await get(e, sok)).status, 400);
});

test('nem létező bejegyzés 404 (ASSETS ellenőrzés)', async () => {
  const e = env({ ASSETS: { fetch: async (u) => new Response('', { status: String(u).includes(SLUG) ? 200 : 404 }) } });
  assert.equal((await post(e, { slug: '2026-01-01-nincs-ilyen', voter: V1, like: true })).status, 404);
  assert.equal((await post(e, { slug: SLUG, voter: V1, like: true })).status, 200);
});

test('napi korlát IP-nként: a 121. változtatás 429', async () => {
  const e = env();
  for (let i = 0; i < 120; i++) {
    const r = await post(e, { slug: SLUG, voter: V1, like: i % 2 === 0 }, { ip: '9.9.9.9' });
    assert.equal(r.status, 200);
  }
  assert.equal((await post(e, { slug: SLUG, voter: V1, like: true }, { ip: '9.9.9.9' })).status, 429);
  assert.equal((await post(e, { slug: SLUG, voter: V2, like: true }, { ip: '8.8.8.8' })).status, 200);
});

test('kötés nélkül 503, nem omlik össze', async () => {
  _semaReset();
  assert.equal((await get({}, SLUG)).status, 503);
});
