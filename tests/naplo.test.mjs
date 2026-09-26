// A főoldal „Napló” szekciójának generálása (tools/build-naplo.mjs). Futtatás: npm test
// A hiba, amit ezek a tesztek fognak: a Napló kézzel volt az index.html-ben, ezért a törölt
// bejegyzés a főoldalon maradt (404-es linkkel), az új pedig nem jelent meg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  renderJournal, injectJournal, NAPLO_START, NAPLO_END,
} from '../tools/build-naplo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const post = (n, extra = {}) => ({
  slug: `2026-08-${String(n).padStart(2, '0')}-poszt-${n}`,
  title: `Poszt ${n}`,
  date: `2026-08-${String(n).padStart(2, '0')}`,
  author: 'Studio F360',
  cover: `media/blog/kep-${n}.jpg`,
  excerpt: `Kivonat ${n}`,
  category: 'sport',
  body: '',
  ...extra,
});
// a readPosts sorrendje: legfrissebb elöl
const posts = (k) => Array.from({ length: k }, (_, i) => post(20 - i));
const noSrcset = () => '';

const between = (html) => {
  const a = html.indexOf(NAPLO_START);
  const b = html.indexOf(NAPLO_END);
  return html.slice(a + NAPLO_START.length, b);
};

test('főoldal: a Napló-blokk jelölők között van, pontosan egyszer', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(html.split(NAPLO_START).length, 2);
  assert.equal(html.split(NAPLO_END).length, 2);
  assert.ok(html.indexOf(NAPLO_START) < html.indexOf(NAPLO_END));
});

// ---- renderJournal ----

test('render: a legfrissebb a kiemelt, a következő 4 a listában, az ötödiken túl semmi', () => {
  const out = renderJournal(posts(6), { srcset: noSrcset });
  const feat = /<article class="journal__feat">([\s\S]*?)<\/article>/.exec(out)[1];
  assert.match(feat, /href="blog\/2026-08-20-poszt-20\.html"/);
  assert.match(feat, /<h3>Poszt 20<\/h3>/);
  assert.match(feat, /<p>Kivonat 20<\/p>/);
  assert.match(feat, /<p class="meta">Sport &amp; Teljesítmény · 2026\. 08\. 20\.<\/p>/);
  const list = /<ol class="journal__list">([\s\S]*?)<\/ol>/.exec(out)[1];
  const lis = [...list.matchAll(/<li>/g)];
  assert.equal(lis.length, 4);
  for (const n of [19, 18, 17, 16]) assert.match(list, new RegExp(`poszt-${n}\\.html`));
  assert.doesNotMatch(out, /poszt-15/);
  assert.match(list, /<span class="meta">Sport &amp; Teljesítmény · 08\. 19\.<\/span><span class="tt">Poszt 19<\/span>/);
});

test('render: a szekció fejléce és osztályai a régi szerkezetet adják', () => {
  const out = renderJournal(posts(5), { srcset: noSrcset });
  assert.match(out, /^<section class="journal" aria-label="Blog">/);
  assert.match(out, /<div class="journal__head">[\s\S]*<p class="tag tag--bare">Nº 13 · Blog<\/p>/);
  assert.match(out, /<h2 data-headin><span class="line-mask"><span>Napló<\/span><\/span><\/h2>/);
  assert.match(out, /<a class="lnk" href="blog\.html">Minden bejegyzés →<\/a>/);
  assert.match(out, /<div class="journal__grid">/);
  assert.match(out, /<figure class="duo-frame" data-scale-img>\s*<img src="media\/blog\/kep-20\.jpg"/);
  assert.match(out, /loading="lazy"/);
  assert.match(out, /<\/section>$/);
});

test('render: 1 bejegyzés esetén csak a kiemelt, lista nélkül', () => {
  const out = renderJournal(posts(1), { srcset: noSrcset });
  assert.match(out, /journal__feat/);
  assert.doesNotMatch(out, /journal__list/);
  assert.doesNotMatch(out, /<ol|<li/);
});

test('render: 2 bejegyzés esetén a lista 1 soros', () => {
  const out = renderJournal(posts(2), { srcset: noSrcset });
  assert.equal([...out.matchAll(/<li>/g)].length, 1);
});

test('render: 0 bejegyzés esetén a szekció nem jelenik meg', () => {
  assert.equal(renderJournal([], { srcset: noSrcset }), '');
});

test('render: borító nélküli bejegyzés kiemeltként is működik (üres keret, nincs törött kép)', () => {
  const out = renderJournal([post(3, { cover: '' })], { srcset: noSrcset });
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /duo-frame/);
});

test('render: a felhasználói szöveg escape-elve kerül a HTML-be', () => {
  const out = renderJournal([post(4, { title: '<script>x</script> & "q"', excerpt: '<b>k</b>' })], { srcset: noSrcset });
  assert.doesNotMatch(out, /<script>|<b>/);
  assert.match(out, /&lt;script&gt;x&lt;\/script&gt; &amp; &quot;q&quot;/);
});

test('render: hibás (nem ÉÉÉÉ-HH-NN) dátum is escape-elve kerül a HTML-be', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const out = renderJournal([post(6, { date: bad }), post(5, { date: bad })], { srcset: noSrcset });
  assert.doesNotMatch(out, /<img src=x/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('render: ismeretlen kategória a Mozgás címkét kapja (mint a blogfalon)', () => {
  const out = renderJournal([post(5, { category: 'nincs-ilyen' })], { srcset: noSrcset });
  assert.match(out, /Mozgás &amp; Testtudat · 2026\. 08\. 05\./);
});

test('render: a kiemelt kép a kapott srcset attribútumot viszi, "journal" méretezéssel', () => {
  const calls = [];
  const srcset = (rel, prefix, kind) => { calls.push([rel, prefix, kind]); return ' srcset="X 640w" sizes="Y"'; };
  const out = renderJournal(posts(3), { srcset });
  assert.deepEqual(calls, [['media/blog/kep-20.jpg', '', 'journal']]);
  assert.match(out, /<img src="media\/blog\/kep-20\.jpg" srcset="X 640w" sizes="Y" alt=""/);
});

// ---- injectJournal ----

const PAGE = `<main>\r\n<section class="elotte">A</section>\r\n\r\n${NAPLO_START}\r\n<section class="journal">régi</section>\r\n${NAPLO_END}\r\n\r\n<section class="utana">B</section>\r\n</main>\r\n`;

test('inject: csak a jelölők közti rész cserélődik, minden más bájtra ugyanaz', () => {
  const out = injectJournal(PAGE, '<section class="journal">új</section>');
  const pre = PAGE.slice(0, PAGE.indexOf(NAPLO_START) + NAPLO_START.length);
  const post_ = PAGE.slice(PAGE.indexOf(NAPLO_END));
  assert.ok(out.startsWith(pre));
  assert.ok(out.endsWith(post_));
  assert.match(between(out), /új/);
  assert.doesNotMatch(out, /régi/);
});

test('inject: a fájl sorvégét (CRLF / LF) megtartja', () => {
  const block = '<section>\n  <p>x</p>\n</section>';
  const crlf = injectJournal(PAGE, block);
  assert.doesNotMatch(crlf.replace(/\r\n/g, ''), /\n/);
  const lf = injectJournal(PAGE.replace(/\r\n/g, '\n'), block);
  assert.doesNotMatch(lf, /\r/);
});

test('inject: idempotens (kétszer futtatva ugyanaz)', () => {
  const once = injectJournal(PAGE, '<section>x</section>');
  assert.equal(injectJournal(once, '<section>x</section>'), once);
});

test('inject: üres blokknál a jelölők maradnak, köztük nincs szekció', () => {
  const out = injectJournal(PAGE, '');
  assert.ok(out.includes(NAPLO_START) && out.includes(NAPLO_END));
  assert.doesNotMatch(between(out), /<section/);
  assert.match(out, /class="utana"/);
});

test('inject: hiányzó vagy dupla jelölőnél hibát dob (nem hagyja csendben elavultan)', () => {
  assert.throws(() => injectJournal('<main></main>', 'x'), /NAPLO/);
  assert.throws(() => injectJournal(PAGE + NAPLO_START, 'x'), /NAPLO/);
  assert.throws(() => injectJournal(`${NAPLO_END}${NAPLO_START}`, 'x'), /NAPLO/);
});

// ---- teljes build ideiglenes másolatban (a valódi tools/, content/, index.html) ----

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f360-naplo-'));
  for (const d of ['tools', 'content', 'media/blog']) {
    fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(dir, 'index.html'));
  return dir;
}
const runBuild = (dir) => execFileSync(process.execPath,
  [path.join(dir, 'tools', 'build-blog.mjs'), '--no-images'], { cwd: dir, encoding: 'utf8' });

test('build: a mostani tartalommal a Napló a content/blog-ból épül, és a második futás semmit nem ír', () => {
  const dir = tempCopy();
  try {
    runBuild(dir);
    const first = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const mdSlugs = fs.readdirSync(path.join(dir, 'content', 'blog'))
      .filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort().reverse();
    const linked = [...between(first).matchAll(/href="blog\/([^"/]+)\.html"/g)].map((m) => m[1]);
    assert.deepEqual(linked, mdSlugs.slice(0, 5));
    const mtime = fs.statSync(path.join(dir, 'index.html')).mtimeMs;
    runBuild(dir);
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), first);
    assert.equal(fs.statSync(path.join(dir, 'index.html')).mtimeMs, mtime, 'változatlan tartalomnál nem írja újra');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build: törölt bejegyzés eltűnik a főoldalról', () => {
  const dir = tempCopy();
  try {
    const mds = fs.readdirSync(path.join(dir, 'content', 'blog')).filter((f) => f.endsWith('.md')).sort().reverse();
    fs.unlinkSync(path.join(dir, 'content', 'blog', mds[0]));
    runBuild(dir);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.doesNotMatch(html, new RegExp(mds[0].replace('.md', '').replace(/[.-]/g, '\\$&')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
