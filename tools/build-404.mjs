// Studio F360 · 404.html generátor
// Futtatás: node tools/build-404.mjs
// A nav, a mobil menü és a lábléc a tools/shell.mjs közös forrásából jön, így nem csúszik szét.
// Minden út gyökér-relatív ('/'), mert a Cloudflare Pages a 404.html-t BÁRMILYEN mélységű
// ismeretlen úton kiszolgálja (pl. /admin/x/y), ott a relatív 'css/…' út eltörne.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { navBlock, menuBlock, footerBlock, PLACES } from './shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = '/';

export function render404() {
  const m = PLACES.mex;
  const r = PLACES.reit;
  return `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>document.documentElement.className += ' js';</script>
<title>Nincs ilyen oldal · Studio F360</title>
<meta name="description" content="A keresett oldal nem található a Studio F360 weboldalán.">
<meta name="robots" content="noindex">
<link rel="icon" href="${P}media/logo/favicon-64.png" type="image/png">
<link rel="stylesheet" href="${P}fonts-brand/fonts-brand.css">
<link rel="stylesheet" href="${P}css/main.css">
<link rel="stylesheet" href="${P}css/pages.css">
<style>
.p-404 main{min-height:72vh}
.p-404 .nf-actions{display:flex;flex-wrap:wrap;gap:.9rem;margin-top:2rem}
.p-404 .nf-places a{text-decoration:none;color:var(--ink)}
.p-404 .nf-places a:hover{text-decoration:underline}
</style>
</head>
<body class="p-404">

<a class="skip" href="#fo">Ugrás a tartalomra</a>
<div class="page-frame" aria-hidden="true"></div>
<div class="page-vignette" aria-hidden="true"></div>

<!-- NAV -->
${navBlock(P, null, 'mex')}

<!-- MOBIL MENÜ -->
${menuBlock(P, null, 'mex')}

<main id="fo">

<header class="chap-hd" data-hero>
  <div class="chap-hd__t">
    <p class="tag" data-reveal>Nº 404 · Nincs ilyen oldal</p>
    <h1><span class="line-mask"><span>Ezt az oldalt</span></span><span class="line-mask"><span>nem találjuk</span></span></h1>
    <p class="lead" data-reveal>Lehet, hogy elírás van a címben, vagy az oldal időközben átköltözött.
    Innen egy kattintással visszatalálsz.</p>
    <div class="nf-actions" data-reveal>
      <a class="btn btn--accent" href="${P}index.html">Vissza a főoldalra</a>
      <a class="btn" href="${P}blog.html">Blog</a>
      <a class="btn" href="${P}kapcsolat.html">Kapcsolat</a>
    </div>
  </div>
  <div class="chap-hd__side">
    <dl class="hd-facts nf-places" data-reveal>
      <div><b>${m.district}</b><span><a href="${P}${m.href}">${m.name} · ${m.street}</a></span></div>
      <div><b>${r.district}</b><span><a href="${P}${r.href}">${r.name} · ${r.street}</a></span></div>
      <div><b>Időpont</b><span><a href="https://f360.hu/idopontfoglalas/" target="_blank" rel="noopener">Online időpontfoglalás</a></span></div>
    </dl>
  </div>
</header>

</main>

${footerBlock(P, null, 'mex')}

<script src="${P}vendor/gsap.min.js"></script>
<script src="${P}vendor/ScrollTrigger.min.js"></script>
<script src="${P}vendor/lenis.min.js"></script>
<script src="${P}js/core.js"></script>
<script src="${P}js/motion.js"></script>
</body>
</html>
`;
}

export function build404() {
  fs.writeFileSync(path.join(ROOT, '404.html'), render404(), 'utf8');
  console.log('[404] 404.html kész');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  build404();
}
