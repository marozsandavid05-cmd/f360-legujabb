// js/meres.js (böngészős mérés) a Node vm-ben, kitalált window/document mellett.
// Cél: a GA4 a lemondó/módosító token (?t=) és a személyes adat nélküli címet kapja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FORRAS = readFileSync(new URL('../js/meres.js', import.meta.url), 'utf8');

function futtat(href, { id = 'G-TESZT12345', referrer = '' } = {}) {
  const u = new URL(href);
  const tar = new Map();
  const fejbe = [];
  const window = {
    location: { href, protocol: u.protocol, origin: u.origin, pathname: u.pathname, search: u.search, host: u.host },
    sessionStorage: { getItem: (k) => (tar.has(k) ? tar.get(k) : null), setItem: (k, v) => tar.set(k, String(v)) },
    F360Hozzajarulas: true,
  };
  window.document = {
    referrer,
    head: { appendChild: (el) => fejbe.push(el) },
    createElement: () => ({}),
    dispatchEvent: () => true,
  };
  window.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } };
  const ctx = vm.createContext({ ...window, window, URLSearchParams, URL, Date, JSON, String, Object, encodeURIComponent });
  ctx.self = ctx;
  // a GA_MERES_ID a fájlban üres; a teszt egy azonosítót ír bele, ahogy élesítéskor kerül
  vm.runInContext(FORRAS.replace("var GA_MERES_ID = '';", `var GA_MERES_ID = '${id}';`).replace('})(window);', '})(this);'), ctx);
  return { dl: ctx.dataLayer || [], fejbe };
}

test('GA4: a lemondó/módosító token és a nem kampány paraméterek nem kerülnek a page_location-be', () => {
  const { dl, fejbe } = futtat('https://f360-legujabb.pages.dev/foglalas.html?t=F0123456789.titkostokenresz&modositas=1&utm_source=facebook&email=x@y.hu');
  assert.equal(fejbe.length, 1, 'a gtag betöltődik (van ID és hozzájárulás)');
  const config = [...dl].map((a) => [...a]).find((a) => a[0] === 'config');
  assert.ok(config, 'van config hívás');
  const opts = config[2] || {};
  assert.ok(opts.page_location, 'page_location meg van adva (különben a gtag a teljes címet küldi)');
  assert.ok(!/[?&]t=|titkos|email|@/.test(opts.page_location), opts.page_location);
  assert.match(opts.page_location, /utm_source=facebook/);
  assert.ok(!opts.page_referrer || !/[?#]/.test(opts.page_referrer), String(opts.page_referrer));
});

test('GA4: ID nélkül vagy hozzájárulás nélkül nem tölt be semmit', () => {
  assert.equal(futtat('https://x.hu/foglalas.html', { id: '' }).fejbe.length, 0);
});
