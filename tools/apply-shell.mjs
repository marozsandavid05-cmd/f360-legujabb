// Studio F360 · a közös nav + mobil menü + lábléc beírása minden gyökér-HTML-be,
// és az oldalak törzsében lévő foglalás-gombok célja (a korábbi WordPress-foglaló címei → shell.mjs bookAttrs)
// Futtatás: node tools/apply-shell.mjs   (a blog-oldalakat a build-blog.mjs írja, azokat itt kihagyjuk)
// Pre-flight: ha BÁRMELYIK fájlban nem pontosan 1 nav / menü / lábléc blokk van, semmit nem ír.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { navBlock, menuBlock, footerBlock, bookAttrs, bookCsoportosHref, BOOK_LEGACY } from './shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// body-osztály → oldal-kulcs
const KEY = {
  'p-index': 'index', 'p-arak': 'arak', 'p-csapat': 'csapat', 'p-gerinc': 'gerinc',
  'p-gyogyaszat': 'gyogyaszat', 'p-joga': 'joga', 'p-kapcsolat': 'kapcsolat', 'p-masszazs': 'masszazs',
  'p-mexikoi': 'mexikoi', 'p-reitter': 'reitter', 'p-terapia': 'terapia', 'p-rolunk': 'rolunk',
  'p-taplalkozas': 'taplalkozas', 'p-foglalas': 'foglalas',
};
// a Mexikói úti oldalak (itt a törzs foglalás-gombja a Mexikói úttal indítja a foglalót)
const MEX_PAGES = new Set(['mexikoi', 'gyogyaszat', 'gerinc', 'masszazs', 'joga', 'taplalkozas']);

const RE = {
  nav: /<nav class="nav"[\s\S]*?<\/nav>/g,
  menu: /<div class="menu" id="menu"[^>]*>[\s\S]*?\r?\n<\/div>/g,
  footer: /<footer class="footer[\s\S]*?<\/footer>/g,
};

// törzsbeli foglalás-linkek: a régi WordPress-cím (új lappal) VAGY a saját foglaló (foglalas.html[?helyszin=…])
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LEGACY_HREF = `(?:${esc(BOOK_LEGACY.mex)}|${esc(BOOK_LEGACY.reit)}|foglalas\\.html(?:\\?(?:tipus=csoportos(?:&amp;|&))?helyszin=(?:mexikoi|reitter))?)`;
const BODY_LINK = new RegExp(`href="(${LEGACY_HREF})"(?: target="_blank" rel="noopener")?([^>]*)>([\\s\\S]*?)<\\/a>`, 'g');

function placeFor(href, text, key) {
  if (href === BOOK_LEGACY.reit || /helyszin=reitter/.test(href) || /Reitter/.test(text)) return 'reit';
  if (/Mexikói/.test(text) || MEX_PAGES.has(key)) return 'mex';
  if (/helyszin=mexikoi/.test(href)) return 'mex';
  return null;
}
function rewriteBody(html, key) {
  let n = 0;
  const out = html.replace(BODY_LINK, (all, href, rest, text) => {
    n++;
    // csoportos óra (jóga, pilates, aerial): a saját foglaló csoportos (heti órarend) nézete, Mexikói út előválasztva
    if (/data-csoportos/.test(rest)) return `href="${bookCsoportosHref('', 'mex')}"${rest}>${text}</a>`;
    return `${bookAttrs('', placeFor(href, text, key))}${rest}>${text}</a>`;
  });
  return { out, n };
}

// almappás oldalak, amelyek a közös héjat kapják (a prefix a gyökérhez vezető relatív út);
// a törzsük foglalás-linkjei '../foglalas.html' alakúak, azokhoz a csere nem nyúl
const SUB_PAGES = { 'foglalas/koszonjuk.html': '../' };
const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).concat(Object.keys(SUB_PAGES).filter((f) => fs.existsSync(path.join(ROOT, f))));
const jobs = [];
const errors = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const body = (src.match(/<body class="([^"]+)"/) || [])[1] || '';
  const cls = body.split(/\s+/);
  if (cls.includes('p-blog') || cls.includes('p-404')) continue; // generált
  if (/http-equiv="refresh"/.test(src)) continue; // átirányító oldal (gerinc.html, csapat.html), nincs héja
  const key = KEY[cls.find((c) => KEY[c])];
  if (!key) { errors.push(`${f}: ismeretlen body-osztály (${body})`); continue; }
  for (const [k, re] of Object.entries(RE)) {
    const n = (src.match(re) || []).length;
    if (n !== 1) errors.push(`${f}: ${k} blokk ${n} db (1 kell)`);
  }
  const world = cls.includes('theme-rehab') ? 'reit' : 'mex';
  jobs.push({ f, src, key, world, prefix: SUB_PAGES[f] || '' });
}
if (errors.length) { console.error('PRE-FLIGHT HIBA, semmi nem íródott:\n' + errors.join('\n')); process.exit(1); }

for (const { f, src, key, world, prefix } of jobs) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const fix = (s) => s.replace(/\r?\n/g, eol);
  // a shell-blokkokat előbb kivesszük, hogy a törzs-csere ne nyúljon beléjük
  const mark = ['\u0000NAV\u0000', '\u0000MENU\u0000', '\u0000FOOT\u0000'];
  let tmp = src.replace(RE.nav, mark[0]).replace(RE.menu, mark[1]).replace(RE.footer, mark[2]);
  const { out: bodyOut, n } = prefix ? { out: tmp, n: 0 } : rewriteBody(tmp, key);
  const out = bodyOut
    .replace(mark[0], () => fix(navBlock(prefix, key, world)))
    .replace(mark[1], () => fix(menuBlock(prefix, key, world)))
    .replace(mark[2], () => fix(footerBlock(prefix, key, world)));
  fs.writeFileSync(path.join(ROOT, f), out, 'utf8');
  console.log(`ok  ${f}  (${key}, ${world}, ${n} foglalás-link a törzsben)`);
}
console.log(`${jobs.length} oldal frissítve.`);
