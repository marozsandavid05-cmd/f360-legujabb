// A /api middleware viselkedése kitalált context-tel (wrangler nélkül)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/_middleware.js';

function ctx(url, { env = {}, method = 'GET', headers = {} } = {}) {
  let nextCalled = false;
  const c = {
    request: new Request(url, { method, headers }),
    env,
    data: {},
    next: async () => { nextCalled = true; return new Response(JSON.stringify({ email: c.data.email }), { status: 200 }); },
  };
  return { c, wasNext: () => nextCalled };
}

test('DEV_EMAIL localhoston: átengedi, a kitalált e-maillel', async () => {
  const { c, wasNext } = ctx('http://127.0.0.1:8788/api/me', { env: { DEV_EMAIL: 'dev@helyi.teszt' } });
  const r = await onRequest(c);
  assert.equal(r.status, 200);
  assert.ok(wasNext());
  assert.equal(c.data.email, 'dev@helyi.teszt');
});

test('DEV_EMAIL élesben (pages.dev host) NEM kapcsol be: token nélkül 401', async () => {
  const { c, wasNext } = ctx('https://f360-legujabb.pages.dev/api/me', {
    env: { DEV_EMAIL: 'dev@helyi.teszt', ACCESS_TEAM_DOMAIN: 'https://x.cloudflareaccess.com', ACCESS_AUD: 'a' },
  });
  const r = await onRequest(c);
  assert.equal(r.status, 401);
  assert.equal(wasNext(), false);
  assert.match((await r.json()).error, /bejelentkezve/);
});

test('Access beállítás nélkül élesben: 500, magyar hibával, nem enged át', async () => {
  const { c, wasNext } = ctx('https://f360-legujabb.pages.dev/api/me', { env: {} });
  const r = await onRequest(c);
  assert.equal(r.status, 500);
  assert.equal(wasNext(), false);
});

test('hamis token élesben: 401', async () => {
  const { c } = ctx('https://f360-legujabb.pages.dev/api/me', {
    env: { ACCESS_TEAM_DOMAIN: 'https://x.cloudflareaccess.com', ACCESS_AUD: 'a' },
    headers: { 'Cf-Access-Jwt-Assertion': 'nem.valodi.token' },
  });
  assert.equal((await onRequest(c)).status, 401);
});

test('CSRF: idegen Origin módosító kérésnél 403', async () => {
  const { c, wasNext } = ctx('http://127.0.0.1:8788/api/posts', {
    env: { DEV_EMAIL: 'dev@helyi.teszt' }, method: 'POST', headers: { Origin: 'https://tamado.example' },
  });
  const r = await onRequest(c);
  assert.equal(r.status, 403);
  assert.equal(wasNext(), false);
});

test('CSRF: cross-site Sec-Fetch-Site módosító kérésnél 403, same-origin átmegy', async () => {
  const a = ctx('http://127.0.0.1:8788/api/posts', { env: { DEV_EMAIL: 'd@x' }, method: 'DELETE', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal((await onRequest(a.c)).status, 403);
  const b = ctx('http://127.0.0.1:8788/api/posts', {
    env: { DEV_EMAIL: 'd@x' }, method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'http://127.0.0.1:8788' },
  });
  assert.equal((await onRequest(b.c)).status, 200);
});
