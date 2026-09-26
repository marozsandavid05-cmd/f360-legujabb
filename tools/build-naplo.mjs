// Studio F360 · a főoldal „Napló” szekciója (index.html, 6. szekció)
// A tools/build-blog.mjs hívja minden build végén (npm run build), a content/blog/*.md alapján.
// Az index.html kézzel szerkesztett, a repóban tárolt fájl: a build CSAK a
// <!-- NAPLO:START --> és <!-- NAPLO:END --> jelölő közti részt cseréli, minden mást bájtra
// érintetlenül hagy, a fájl sorvégét (CRLF vagy LF) megtartja, és ha a tartalom nem változott,
// nem is írja újra a fájlt (idempotens).
// Kiosztás: a legfrissebb bejegyzés a kiemelt helyre, a következő 4 a listába. Kevesebb
// bejegyzésnél a hiányzó sorok kimaradnak; 0 bejegyzésnél a szekció nem jelenik meg
// (egy üres „Hamarosan” sáv a főoldalon befejezetlennek hatna, a blogfal saját üres-állapota elég).
//
// Megjegyzés: a CATS és az esc a build-blog.mjs-ből jön (körkörös import, de csak függvényen belül
// használjuk, ezért a betöltési sorrendtől függetlenül működik).
import fs from 'node:fs';
import path from 'node:path';
import { CATS, esc } from './build-blog.mjs';

export const NAPLO_START = '<!-- NAPLO:START -->';
export const NAPLO_END = '<!-- NAPLO:END -->';
const LIST_MAX = 4;

// 2026-08-24 → { full: '2026. 08. 24.', short: '08. 24.' } (a régi, kézzel írt Napló formátuma)
function dotDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return { full: String(iso), short: String(iso) };
  return { full: `${m[1]}. ${m[2]}. ${m[3]}.`, short: `${m[2]}. ${m[3]}.` };
}

const catLabel = (post) => (CATS[post.category] || CATS.mozgas).label;

// posts: a readPosts() sorrendje (legfrissebb elöl). srcset(rel, prefix, kind) → ' srcset="…" sizes="…"' vagy ''.
export function renderJournal(posts, { srcset = () => '' } = {}) {
  if (!posts.length) return '';
  const [feat, ...rest] = posts;
  const list = rest.slice(0, LIST_MAX);
  const href = (p) => `blog/${esc(p.slug)}.html`;

  const img = feat.cover
    ? `\n          <img src="${esc(feat.cover)}"${srcset(feat.cover, '', 'journal')} alt="" loading="lazy" width="1500" height="1000">\n        `
    : '';

  const featHtml = `    <article class="journal__feat">
      <a href="${href(feat)}">
        <figure class="duo-frame" data-scale-img>${img}</figure>
        <p class="meta">${esc(catLabel(feat))} · ${esc(dotDate(feat.date).full)}</p>
        <h3>${esc(feat.title)}</h3>${feat.excerpt ? `
        <p>${esc(feat.excerpt)}</p>` : ''}
      </a>
    </article>`;

  const listHtml = list.length
    ? `\n    <ol class="journal__list">\n${list.map((p) =>
      `      <li><a href="${href(p)}"><span class="meta">${esc(catLabel(p))} · ${esc(dotDate(p.date).short)}</span><span class="tt">${esc(p.title)}</span></a></li>`).join('\n')}\n    </ol>`
    : '';

  return `<section class="journal" aria-label="Blog">
  <div class="journal__head">
    <div>
      <p class="tag tag--bare">Nº 13 · Blog</p>
      <h2 data-headin><span class="line-mask"><span>Napló</span></span></h2>
    </div>
    <a class="lnk" href="blog.html">Minden bejegyzés →</a>
  </div>
  <div class="journal__grid">
${featHtml}${listHtml}
  </div>
</section>`;
}

// A jelölők közti részt cseréli. Hiányzó, dupla vagy fordított jelölőnél hibát dob, hogy a build
// ne menjen át csendben egy elavult főoldallal.
export function injectJournal(html, block) {
  const count = (s) => html.split(s).length - 1;
  const a = html.indexOf(NAPLO_START);
  const b = html.indexOf(NAPLO_END);
  if (count(NAPLO_START) !== 1 || count(NAPLO_END) !== 1 || b < a) {
    throw new Error(`az index.html-ben pontosan egy ${NAPLO_START} és utána egy ${NAPLO_END} jelölő kell`);
  }
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const body = block ? `${eol}${block.replace(/\r?\n/g, eol)}${eol}` : eol;
  return html.slice(0, a + NAPLO_START.length) + body + html.slice(b);
}

// Beírja a Naplót a root/index.html-be. Csak akkor ír, ha változott. Visszatér: 'irva' | 'valtozatlan' | 'nincs-index'.
export function writeJournal(root, posts, { srcset } = {}) {
  const file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) {
    console.warn('[naplo] FIGYELEM: nincs index.html, a főoldali Napló kimarad.');
    return 'nincs-index';
  }
  const html = fs.readFileSync(file, 'utf8');
  const next = injectJournal(html, renderJournal(posts, { srcset }));
  if (next === html) {
    console.log(`[naplo] a főoldali Napló változatlan (${Math.min(posts.length, LIST_MAX + 1)} bejegyzés)`);
    return 'valtozatlan';
  }
  fs.writeFileSync(file, next, 'utf8');
  console.log(`[naplo] a főoldali Napló frissítve (${Math.min(posts.length, LIST_MAX + 1)} bejegyzés)`);
  return 'irva';
}
