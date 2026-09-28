// Studio F360 · blog build
// content/blog/*.md  →  blog/<slug>.html + blog.html (fő fal) + kategória-oldalak
// Futtatás: node tools/build-blog.mjs   (a nav, a mobil menü és a lábléc a tools/shell.mjs közös forrásából jön)
// A főoldal (index.html) Napló-szekcióját is ez frissíti a jelölők között, lásd tools/build-naplo.mjs.
// Képek: a media/blog/* forrásképekből 640 / 1280 / 2000 px széles WebP készül a media/blog/meret/ mappába
// (sharp, lásd package.json), és a blog-HTML img-jei srcset + sizes attribútumot kapnak.
// Ha a sharp nincs telepítve, a build figyelmeztet, és srcset nélkül (az eredeti képpel) megy tovább.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { marked } = require('./marked.min.js');
import { navBlock, menuBlock, footerBlock, bookAttrs } from './shell.mjs';
import { writeJournal } from './build-naplo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content', 'blog');
const OUT_DIR = path.join(ROOT, 'blog');
const MEDIA_DIR = path.join(ROOT, 'media', 'blog');
const SIZES_DIR = path.join(MEDIA_DIR, 'meret');
const SIZE_WIDTHS = [640, 1280, 2000];
const WEBP_QUALITY = 80;

// A képek megjelenési szélessége (css/blog.css alapján: feed 2 oszlop 1100 px fölött, max 640 px alatta;
// a poszt-borító a .post teljes szélessége; a szövegbe tett kép a 70ch széles .post__body-ban)
const SIZES = {
  card: '(min-width: 1100px) 620px, (min-width: 700px) 640px, 92vw',
  cover: '(min-width: 1400px) 1190px, 92vw',
  body: '(min-width: 820px) 720px, 92vw',
  // főoldal, Napló kiemelt kép (css/pages.css .journal__feat: 7/12 oszlop 900 px fölött, alatta teljes szélesség)
  journal: '(min-width: 1440px) 710px, (min-width: 901px) 52vw, 92vw',
};

// forráskép relatív útja ('media/blog/x.jpg') → [{ w, rel: 'media/blog/meret/x-640.webp' }]
let IMAGE_SETS = new Map();

const MONTHS = ['január','február','március','április','május','június',
  'július','augusztus','szeptember','október','november','december'];

// Kategóriák: a blog kategória-kulcsai
export const CATS = {
  mozgas:      { label: 'Mozgás & Testtudat',      page: 'blog-mozgas.html',      no: '13·1', line1: 'Mozgás &', line2: 'Testtudat' },
  sport:       { label: 'Sport & Teljesítmény',    page: 'blog-sport.html',       no: '13·2', line1: 'Sport &', line2: 'Teljesítmény' },
  taplalkozas: { label: 'Táplálkozás & Életmód',   page: 'blog-taplalkozas.html', no: '13·3', line1: 'Táplálkozás', line2: '& Életmód' },
};

export function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function huDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${m[1]}. ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}.`;
}

function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

// ---- reszponzív képek ----

// ' srcset="…" sizes="…"' egy media/blog/ forrásképhez, vagy '' ha nincs hozzá méretezett változat
function srcsetAttrs(rel, prefix, kind) {
  const set = IMAGE_SETS.get(String(rel).replace(/^\.\.\//, ''));
  if (!set || !set.length) return '';
  const list = set.map((v) => `${prefix}${esc(v.rel)} ${v.w}w`).join(', ');
  return ` srcset="${list}" sizes="${SIZES[kind]}"`;
}

// a markdownból renderelt szöveg img-jei (src="../media/blog/…" a poszt-oldalon)
function addBodySrcset(html, prefix) {
  return html.replace(/<img\b([^>]*?)\ssrc="((?:\.\.\/)?media\/blog\/[^"/]+)"([^>]*)>/g, (m, pre, src, post) => {
    if (/\ssrcset=/.test(pre + post)) return m;
    const rel = src.replace(/^\.\.\//, '');
    return `<img${pre} src="${src}"${srcsetAttrs(rel, prefix, 'body')}${post}>`;
  });
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    console.warn('[blog] FIGYELEM: a sharp nincs telepítve (npm install), a képek srcset nélkül maradnak.');
    return null;
  }
}

// Egy forráskép méretezett változatai. Nem nagyít: ha a kép keskenyebb egy célméretnél,
// a saját szélességén készül egy változat (egyszer). Meglévő, frissebb változatot nem gyárt újra.
async function sizeImage(sharp, file, base) {
  const src = path.join(MEDIA_DIR, file);
  const meta = await sharp(src).metadata();
  const rotated = (meta.orientation || 1) >= 5;
  const srcW = rotated ? meta.height : meta.width;
  const widths = [...new Set(SIZE_WIDTHS.map((w) => Math.min(w, srcW)))].sort((a, b) => a - b);
  const srcTime = fs.statSync(src).mtimeMs;
  const out = [];
  for (const w of widths) {
    const name = `${base}-${w}.webp`;
    const dest = path.join(SIZES_DIR, name);
    if (!fs.existsSync(dest) || fs.statSync(dest).mtimeMs < srcTime) {
      await sharp(src).rotate().resize({ width: w, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY, effort: 5 }).toFile(dest);
    }
    out.push({ w, rel: `media/blog/meret/${name}` });
  }
  return out;
}

export async function buildImageSets() {
  const sets = new Map();
  if (!fs.existsSync(MEDIA_DIR)) return sets;
  const files = fs.readdirSync(MEDIA_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.(jpe?g|png|webp)$/i.test(d.name))
    .map((d) => d.name)
    .sort();
  if (!files.length) return sets;
  const sharp = await loadSharp();
  if (!sharp) return sets;
  fs.mkdirSync(SIZES_DIR, { recursive: true });
  let failed = 0;
  // azonos alapnév különböző kiterjesztéssel (x.jpg és x.png) ne írja felül egymás változatait
  const baseOf = (f) => f.replace(/\.[^.]+$/, '');
  const seen = new Map();
  for (const f of files) seen.set(baseOf(f), (seen.get(baseOf(f)) || 0) + 1);
  for (const f of files) {
    const base = seen.get(baseOf(f)) > 1 ? f.replace(/\.([^.]+)$/, '-$1') : baseOf(f);
    try {
      sets.set(`media/blog/${f}`, await sizeImage(sharp, f, base));
    } catch (e) {
      failed++;
      console.warn(`[blog] FIGYELEM: ${f} nem méretezhető (${e.message}), srcset nélkül marad.`);
    }
  }
  // elárvult változatok törlése (a forráskép már nincs meg)
  const valid = new Set([...sets.values()].flat().map((v) => path.basename(v.rel)));
  for (const f of fs.readdirSync(SIZES_DIR)) {
    if (f.endsWith('.webp') && !valid.has(f)) fs.unlinkSync(path.join(SIZES_DIR, f));
  }
  console.log(`[blog] ${sets.size} kép méretezve (${SIZE_WIDTHS.join('/')} px WebP)${failed ? `, ${failed} hibás` : ''}`);
  return sets;
}

// ---- közös HTML darabok (prefix: relatív út a gyökérhez képest) ----

function navHtml(prefix, current) {
  // current: 'blog' | 'blog-<kat>' | null (bejegyzés) · a Blog menüpont minden blog-oldalon aktív
  const key = current || 'blog';
  return `<a class="skip" href="#fo">Ugrás a tartalomra</a>
<div class="page-frame" aria-hidden="true"></div>
<div class="page-vignette" aria-hidden="true"></div>

<!-- NAV -->
${navBlock(prefix, key, 'mex')}

<!-- MOBIL MENÜ -->
${menuBlock(prefix, key, 'mex')}`;
}

function footerHtml(prefix, extraScripts = '') {
  return `<!-- ============ FOOTER ============ -->
${footerBlock(prefix, 'blog', 'mex')}

<script src="${prefix}vendor/gsap.min.js"></script>
<script src="${prefix}vendor/ScrollTrigger.min.js"></script>
<script src="${prefix}vendor/lenis.min.js"></script>
<script src="${prefix}js/core.js"></script>
<script src="${prefix}js/motion.js"></script>
${extraScripts}`;
}

function headHtml(prefix, title, desc, bodyClass) {
  return `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>document.documentElement.className += ' js';</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="${prefix}media/logo/favicon-64.png" type="image/png">
<link rel="stylesheet" href="${prefix}fonts-brand/fonts-brand.css">
<link rel="stylesheet" href="${prefix}css/main.css">
<link rel="stylesheet" href="${prefix}css/pages.css">
<link rel="stylesheet" href="${prefix}css/blog.css">
</head>
<body class="${bodyClass}">
`;
}

// ---- SVG ikonok (nincs emoji) ----

const SVG_HEART = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path class="hp" d="M12 20.4 4.7 13a4.9 4.9 0 0 1 0-7 4.7 4.7 0 0 1 6.7 0l.6.6.6-.6a4.7 4.7 0 0 1 6.7 0 4.9 4.9 0 0 1 0 7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
const SVG_BUBBLE = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3.5c-4.9 0-8.8 3.4-8.8 7.6 0 4.2 3.9 7.6 8.8 7.6.9 0 1.8-.1 2.6-.3l3.9 2.1-.6-3.6c1.8-1.4 2.9-3.5 2.9-5.8 0-4.2-3.9-7.6-8.8-7.6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

// ---- közös közösségi blokk (kedvelés + hozzászólások) ----

function socialHtml(post, { articleHref = null } = {}) {
  // Valódi kedvelés-számláló (functions/kedveles.js, D1). 0-ról indul, a szám a böngészőben töltődik be.
  // Hozzászólás nincs (David döntése, 2026-09-26).
  return `<div class="ig__bar">
    <button class="like-btn" type="button" data-like aria-pressed="false" aria-label="Kedvelés">
      ${SVG_HEART}<span class="like-n" data-like-count>0</span>
    </button>
    ${articleHref ? `<a class="ig__more" href="${esc(articleHref)}">Elolvasom <span class="ar">→</span></a>` : ''}
  </div>`;
}

// ---- feed-kártya (Instagram-anatómia, editorial köntösben) ----

function igCard(post, prefix, idx) {
  const cat = CATS[post.category] || CATS.mozgas;
  const media = post.cover
    ? `<a class="ig__media" href="${prefix}blog/${esc(post.slug)}.html" aria-label="${esc(post.title)}"><img src="${prefix}${esc(post.cover)}"${srcsetAttrs(post.cover, prefix, 'card')} alt="" loading="lazy" width="1600" height="1200"></a>`
    : `<a class="ig__media ig__media--empty" href="${prefix}blog/${esc(post.slug)}.html" aria-label="${esc(post.title)}"><span>F360</span></a>`;
  return `<article class="ig${idx % 2 ? ' ig--alt' : ''}" data-slug="${esc(post.slug)}">
  <div class="ig__datecol" aria-hidden="true"><span>${esc(huDate(post.date))}</span></div>
  <div class="ig__body">
  <header class="ig__head">
    <span class="ig__ava" aria-hidden="true">F</span>
    <div class="ig__who">
      <span class="ig__handle">studio_f360_egeszsegkozpont</span>
      <span class="ig__meta">${esc(huDate(post.date))}${post.author ? ` · ${esc(post.author)}` : ''}</span>
    </div>
    <a class="ig__chip" href="${prefix}${cat.page}">${esc(cat.label)}</a>
  </header>
  ${media}
  <div class="ig__cap">
    <h2 class="ig__title"><a href="${prefix}blog/${esc(post.slug)}.html">${esc(post.title)}</a></h2>
    ${post.excerpt ? `<p class="ig__ex">${esc(post.excerpt)}</p>` : ''}
  </div>
  ${socialHtml(post, { articleHref: `${prefix}blog/${post.slug}.html` })}
  </div>
</article>`;
}

// ---- poszt-oldal ----

function renderPost(post, posts) {
  const prefix = '../';
  const cat = CATS[post.category] || CATS.mozgas;
  const bodyHtml = addBodySrcset(marked.parse(post.body)
    .replace(/src="media\/blog\//g, 'src="../media/blog/'), prefix);
  const meta = [huDate(post.date), post.author].filter(Boolean).join(' · ');
  const idx = posts.indexOf(post);
  const prev = posts[idx + 1]; // régebbi
  const next = posts[idx - 1]; // újabb

  const coverHtml = post.cover
    ? `<figure class="post__cover" data-scale-img>
    <img src="../${esc(post.cover)}"${srcsetAttrs(post.cover, prefix, 'cover')} alt="" width="1600" height="1000">
  </figure>`
    : '';

  let pager = '';
  if (prev || next) {
    pager = `<nav class="post__pager" aria-label="További bejegyzések">
    ${prev ? `<a class="post__pnav" href="${esc(prev.slug)}.html"><span class="no">← Korábbi</span><span class="tt">${esc(prev.title)}</span></a>` : '<span></span>'}
    ${next ? `<a class="post__pnav post__pnav--next" href="${esc(next.slug)}.html"><span class="no">Újabb →</span><span class="tt">${esc(next.title)}</span></a>` : '<span></span>'}
  </nav>`;
  }

  return `${headHtml(prefix, `${post.title} · Blog · Studio F360`, post.excerpt || post.title, 'p-blog-post')}
${navHtml(prefix, null)}

<main id="fo">

<header class="post-open" data-hero>
  <div class="post-open__t">
    <p class="tag" data-reveal>Nº 13 · Blog · <a class="tag-link" href="../${cat.page}">${esc(cat.label)}</a> · ${esc(meta)}</p>
    <h1><span class="line-mask"><span>${esc(post.title)}</span></span></h1>
  </div>
  ${post.excerpt ? `<p class="lead" data-reveal>${esc(post.excerpt)}</p>` : ''}
</header>

<article class="post">
  ${coverHtml}
  <div class="post__body">
${bodyHtml}
  </div>
  <div class="post__social" data-slug="${esc(post.slug)}">
    ${socialHtml(post)}
  </div>
  ${pager}
  <div class="post__back">
    <a class="btn" href="../blog.html">← Vissza a bloghoz</a>
    <a class="btn btn--accent" ${bookAttrs('../', null)}>Időpontfoglalás</a>
  </div>
</article>

</main>

${footerHtml(prefix, `<script src="${prefix}js/blog-social.js"></script>`)}
</body>
</html>
`;
}

// ---- fal-oldalak (fő + kategóriák): bal sticky panel + jobb feed ----

function renderWall(posts, catKey) {
  const prefix = '';
  const cat = catKey ? CATS[catKey] : null;
  const shown = catKey ? posts.filter((p) => p.category === catKey) : posts;
  const countOf = (k) => posts.filter((p) => p.category === k).length;

  const feed = shown.length
    ? shown.map((p, i) => igCard(p, prefix, i)).join('\n\n')
    : `<p class="blog-empty">Ebben a témakörben még nincs bejegyzés. Az első hamarosan érkezik.</p>`;

  const tab = (href, label, count, active) =>
    `<a class="wtab${active ? ' is-on' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>${esc(label)}<span class="n">${count}</span></a>`;
  const tabs = [
    tab('blog.html', 'Minden bejegyzés', posts.length, !catKey),
    tab(CATS.mozgas.page, CATS.mozgas.label, countOf('mozgas'), catKey === 'mozgas'),
    tab(CATS.sport.page, CATS.sport.label, countOf('sport'), catKey === 'sport'),
    tab(CATS.taplalkozas.page, CATS.taplalkozas.label, countOf('taplalkozas'), catKey === 'taplalkozas'),
  ].join('\n    ');

  const title = cat
    ? `<h1>
        <span class="line-mask"><span>${esc(cat.line1)}</span></span>
        <span class="line-mask"><span>${esc(cat.line2)}</span></span>
      </h1>`
    : `<h1>
        <span class="line-mask"><span>Szakmai jegyzetek</span></span>
      </h1>`;

  const lead = cat
    ? {
        mozgas: 'Jegyzetek arról, hogyan mozogj okosabban: testtudat, tartás, gyógytorna és minden, amit a kezelőasztal mellett is elmondanánk.',
        sport: 'Teljesítmény, regeneráció, sérülésmegelőzés. A Reitter utcai sportrehabos csapat jegyzetei sportolóknak és amatőr versenyzőknek.',
        taplalkozas: 'Amit a tányérodra teszel, az is edzésterv. Táplálkozás, alvás, életmód, a hétköznapokra fordítva.',
      }[catKey]
    : 'Amit a kezelőasztal mellett is elmondanánk: jegyzetek mozgásról, fájdalomról, regenerációról és arról, hogyan érdemes bánni a testeddel a hétköznapokban.';

  const pageTitle = cat
    ? `${cat.no} · ${cat.label} · Blog · Studio F360`
    : 'Nº 13 · Blog · Szakmai jegyzetek · Studio F360';
  const pageDesc = cat
    ? `A Studio F360 blogja, ${cat.label} témakör: ${lead}`
    : 'A Studio F360 blogja: szakmai jegyzetek mozgásról, gyógytornáról, rehabilitációról és regenerációról.';

  return `${headHtml(prefix, pageTitle, pageDesc, 'p-blog')}
${navHtml(prefix, catKey ? `blog-${catKey}` : 'blog')}

<main id="fo">

<section class="blog-wall" aria-label="Blog">
  <header class="wall-head" data-hero>
    <div class="wall-head__t">
      <p class="tag" data-reveal>Széljegyzetek · Blog · Nº 13</p>
      ${title}
    </div>
    <p class="wall-head__lead" data-reveal>${esc(lead)}</p>
  </header>
  <nav class="wall-tabs" aria-label="Témakörök">
    ${tabs}
  </nav>
  <div class="blog-feed">
    ${feed}
  </div>
  <p class="wall-ig">Kövess minket: <a href="https://www.instagram.com/studio_f360_egeszsegkozpont/" target="_blank" rel="noopener">@studio_f360_egeszsegkozpont</a></p>
</section>

</main>

${footerHtml(prefix, `<script src="${prefix}js/blog-social.js"></script>`)}
</body>
</html>
`;
}

// ---- posztok beolvasása ----

function readPosts() {
  if (!fs.existsSync(CONTENT)) return [];
  const posts = [];
  for (const f of fs.readdirSync(CONTENT)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(CONTENT, f), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    if (!data.title) continue;
    posts.push({
      slug: f.replace(/\.md$/, ''),
      title: data.title,
      date: data.date || '1970-01-01',
      author: data.author || '',
      cover: data.cover || '',
      excerpt: data.excerpt || '',
      category: CATS[data.category] ? data.category : 'mozgas',
      body,
    });
  }
  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return posts;
}

// ---- build ----

export async function build({ images = true } = {}) {
  IMAGE_SETS = images ? await buildImageSets() : new Map();
  const posts = readPosts();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // elárvult poszt-oldalak törlése (törölt md → törölt html)
  const valid = new Set(posts.map((p) => `${p.slug}.html`));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.html') && !valid.has(f)) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  for (const p of posts) {
    fs.writeFileSync(path.join(OUT_DIR, `${p.slug}.html`), renderPost(p, posts), 'utf8');
  }
  fs.writeFileSync(path.join(ROOT, 'blog.html'), renderWall(posts, null), 'utf8');
  for (const k of Object.keys(CATS)) {
    fs.writeFileSync(path.join(ROOT, CATS[k].page), renderWall(posts, k), 'utf8');
  }
  console.log(`[blog] ${posts.length} bejegyzés → blog.html + 3 kategória-oldal + blog/*.html`);
  writeJournal(ROOT, posts, { srcset: srcsetAttrs });
  return posts.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  build({ images: !process.argv.includes('--no-images') }).catch((e) => {
    console.error('[blog] a build elbukott:', e);
    process.exit(1);
  });
}
