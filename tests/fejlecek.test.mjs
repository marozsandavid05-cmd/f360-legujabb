// Biztonsági fejlécek (_headers, Cloudflare Pages): a CSP minden inline szkriptet hash-sel enged,
// ezért ha egy inline szkript változik, a hash-t is frissíteni kell. Ez a teszt ezt őrzi: minden
// HTML (a forrás és a blog-build sablonja) inline szkriptjének SHA-256-ja szerepel a CSP-ben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const GY = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADERS = join(GY, '_headers');

function htmlFajlok(dir, ki = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.git', '.wrangler', 'media', 'vendor', 'tests'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) htmlFajlok(p, ki);
    else if (n.endsWith('.html')) ki.push(p);
  }
  return ki;
}
// a böngésző a hash-t a CRLF → LF normalizálás utáni tartalomra számolja
const hash = (s) => `'sha256-${createHash('sha256').update(s.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;
function inlineSzkriptek(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/application\/ld\+json|importmap/.test(m[1]) && m[2].trim())
    .map((m) => m[2]);
}
const szabalyok = () => {
  const s = readFileSync(HEADERS, 'utf8').replace(/\r\n?/g, '\n');
  const blokkok = {};
  let ut = null;
  for (const sor of s.split('\n')) {
    if (!sor.trim() || sor.trim().startsWith('#')) continue;
    if (!/^\s/.test(sor)) { ut = sor.trim(); blokkok[ut] = {}; continue; }
    const i = sor.indexOf(':');
    blokkok[ut][sor.slice(0, i).trim().toLowerCase()] = sor.slice(i + 1).trim();
  }
  return blokkok;
};

test('_headers: van, és minden oldalon CSP, nosniff, frame-védelem, HSTS, Referrer-Policy', () => {
  assert.ok(existsSync(HEADERS), '_headers hiányzik');
  const m = szabalyok()['/*'];
  assert.ok(m, '/* blokk');
  assert.equal(m['x-content-type-options'], 'nosniff');
  assert.match(m['strict-transport-security'], /max-age=\d{7,}/);
  assert.equal(m['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(m['x-frame-options'], /SAMEORIGIN|DENY/);
  const csp = m['content-security-policy'];
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script-src unsafe-inline nélkül');
  assert.ok(!/script-src[^;]*'unsafe-eval'/.test(csp), 'script-src unsafe-eval nélkül');
});

test('_headers: minden inline szkript hash-e a CSP-ben (forrás-HTML és a blog-build sablonja)', () => {
  const csp = szabalyok()['/*']['content-security-policy'];
  const hianyzo = [];
  for (const f of htmlFajlok(GY)) for (const s of inlineSzkriptek(readFileSync(f, 'utf8'))) if (!csp.includes(hash(s))) hianyzo.push(`${f.slice(GY.length + 1)}: ${s.trim().slice(0, 40)}`);
  for (const t of ['tools/build-blog.mjs', 'tools/build-404.mjs', 'tools/shell.mjs']) {
    const p = join(GY, t);
    if (!existsSync(p)) continue;
    for (const s of inlineSzkriptek(readFileSync(p, 'utf8'))) if (!s.includes('${') && !csp.includes(hash(s))) hianyzo.push(`${t}: ${s.trim().slice(0, 40)}`);
  }
  assert.deepEqual(hianyzo, []);
});

test('_headers: az admin nem kerül gyorsítótárba, és nem indexelhető', () => {
  const b = szabalyok();
  assert.equal((b['/admin/*'] || {})['cache-control'], 'no-store');
  assert.match((b['/admin/*'] || {})['x-robots-tag'] || '', /noindex/);
});

test('_headers: a köszönő oldal (foglalás-azonosító az URL-ben) se gyorsítótárban, se hivatkozóban', () => {
  const b = szabalyok();
  for (const ut of ['/foglalas/koszonjuk*', '/foglalas/lemondas*']) {
    assert.equal((b[ut] || {})['cache-control'], 'no-store', ut);
    assert.equal((b[ut] || {})['referrer-policy'], 'no-referrer', ut);
  }
});
