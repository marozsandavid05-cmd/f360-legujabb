// Blog-admin: ha a blog-kapcsolat nincs beállítva (például az előnézeti környezetben nincs
// GITHUB_TOKEN), az API egyértelmű kóddal jelez (503 + kod: blog_nincs_beallitva), és az
// ügyfél-felületen sehol nem maradhat „Szólj Davidnek” jellegű szöveg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { githubFromEnv } from '../functions/_lib/github.js';
import { HttpError, errorResponse } from '../functions/_lib/http.js';
import { onRequest as statusRequest } from '../functions/api/status.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('GITHUB_TOKEN nélkül: 503 + kod blog_nincs_beallitva, nyugodt üzenet', async () => {
  let hiba = null;
  try { githubFromEnv({}); } catch (e) { hiba = e; }
  assert.ok(hiba instanceof HttpError, 'HttpError kell');
  assert.equal(hiba.status, 503);
  assert.equal(hiba.extra.kod, 'blog_nincs_beallitva');
  assert.doesNotMatch(hiba.message, /David/);
  const r = errorResponse(hiba);
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.kod, 'blog_nincs_beallitva');
  assert.match(body.error, /nem szerkeszthető/);
});

test('élesítés-állapot beállítás nélkül: 503 + kod, David neve nélkül', async () => {
  const r = await statusRequest({ request: new Request('https://x.pages.dev/api/status'), env: {} });
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.kod, 'statusz_nincs_beallitva');
  assert.doesNotMatch(body.error, /David/);
});

function fajlok(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) fajlok(p, out);
    else if (/\.(js|mjs|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('ügyfél-felület és functions: sehol nincs „Szólj Davidnek”', () => {
  const talalat = [];
  for (const dir of ['admin', 'functions']) {
    for (const f of fajlok(path.join(ROOT, dir))) {
      const t = fs.readFileSync(f, 'utf8');
      if (/sz[oó]lj\s+davidnek|davidnek/i.test(t)) talalat.push(path.relative(ROOT, f));
    }
  }
  assert.deepEqual(talalat, []);
});
