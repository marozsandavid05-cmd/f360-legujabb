// Emlékeztető-ütemező Worker (workers/emlekezteto-cron): a foglaló cron-végpontját hívja a kulccsal.
// Valódi hálózat nincs: fetch-mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { futtat } from '../workers/emlekezteto-cron/src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KULCS = 'cron-titok-'.padEnd(40, 'y');

function mock(status = 200, body = { emlekeztetve: 1, mod: 'outbox' }) {
  const hivasok = [];
  const fn = async (url, init) => { hivasok.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
  fn.hivasok = hivasok;
  return fn;
}

test('futtat: POST a cron-végpontra, X-Cron-Kulcs fejléccel; a perjel a cím végén nem duplázódik', async () => {
  const f = mock();
  const r = await futtat({ FOGLALO_URL: 'https://f360.example/', CRON_SECRET: KULCS }, 1, f);
  assert.equal(r.ok, true);
  assert.equal(f.hivasok.length, 1);
  assert.equal(f.hivasok[0].url, 'https://f360.example/foglalas-api/cron/emlekezteto');
  assert.equal(f.hivasok[0].init.method, 'POST');
  assert.equal(f.hivasok[0].init.headers['X-Cron-Kulcs'], KULCS);
});

test('futtat: beállítás nélkül nem hív; hibás válasz és hálózati hiba ok: false, nem dob', async () => {
  const f = mock();
  assert.equal((await futtat({ CRON_SECRET: KULCS }, 1, f)).ok, false);
  assert.equal((await futtat({ FOGLALO_URL: 'https://f360.example' }, 1, f)).ok, false);
  assert.equal(f.hivasok.length, 0);
  assert.deepEqual([(await futtat({ FOGLALO_URL: 'https://x', CRON_SECRET: KULCS }, 1, mock(401, { error: 'Nem engedélyezett.' }))).status], [401]);
  const hibas = async () => { throw new Error('fetch failed'); };
  assert.deepEqual(await futtat({ FOGLALO_URL: 'https://x', CRON_SECRET: KULCS }, 1, hibas), { ok: false, status: 0 });
});

test('scheduled: a futást a ctx.waitUntil-hoz köti', async () => {
  const varakozok = [];
  const regi = globalThis.fetch;
  globalThis.fetch = mock();
  try {
    await worker.scheduled({ scheduledTime: 1 }, { FOGLALO_URL: 'https://x', CRON_SECRET: KULCS }, { waitUntil: (p) => varakozok.push(p) });
    assert.equal(varakozok.length, 1);
    assert.equal((await varakozok[0]).ok, true);
  } finally {
    globalThis.fetch = regi;
  }
});

test('wrangler.toml: 15 perces cron, a titok nincs benne', () => {
  const t = fs.readFileSync(path.join(ROOT, 'workers/emlekezteto-cron/wrangler.toml'), 'utf8');
  assert.match(t, /crons = \["\*\/15 \* \* \* \*"\]/);
  assert.match(t, /main = "src\/index\.js"/);
  assert.doesNotMatch(t, /^\s*CRON_SECRET\s*=/m);
});
