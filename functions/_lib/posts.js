// Blogbejegyzések: slug-képzés, frontmatter olvasás/írás, bemenet-ellenőrzés.
// A formátum pontosan a meglévő content/blog/*.md fájloké és a tools/build-blog.mjs parserjéé.

import { HttpError } from './http.js';

export const CATEGORIES = ['mozgas', 'sport', 'taplalkozas'];
export const FIELD_ORDER = ['title', 'date', 'author', 'category', 'cover', 'excerpt'];
export const DEFAULT_AUTHOR = 'Studio F360';

export const SLUG_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COVER_RE = /^media\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|jpe?g|png)$/;
const SLUG_TITLE_MAX = 60;

// Ékezet nélküli, kisbetűs, kötőjeles alak (ő/ű/ö/ü is rendben: NFD után a mellékjel leválik)
export function kebab(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Hosszú címnél szóhatáron vág (a meglévő fájlnevek 25-45 karakteresek)
export function titlePart(title, max = SLUG_TITLE_MAX) {
  const k = kebab(title);
  if (k.length <= max) return k;
  const cut = k.slice(0, max + 1);
  const i = cut.lastIndexOf('-');
  return (i > 10 ? cut.slice(0, i) : k.slice(0, max)).replace(/-+$/, '');
}

export function slugFor(date, title) {
  const t = titlePart(title) || 'bejegyzes';
  return `${date}-${t}`;
}

export function assertSlug(slug) {
  if (!SLUG_RE.test(String(slug || '')) || String(slug).length > 120) {
    throw new HttpError(400, 'Érvénytelen bejegyzés-azonosító.');
  }
  return slug;
}

export function postPath(slug) {
  return `content/blog/${assertSlug(slug)}.md`;
}

// ---- frontmatter (ugyanaz a logika, mint a tools/build-blog.mjs parseFrontmatter) ----

export function parseFrontmatter(raw) {
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

// Idézőjel kell, ha a YAML egyébként félreértené (a meglévő fájlok a kettőspontos címet idézik).
// A build-parser nem kezel escape-et, csak a szélső idézőjelpárt vágja le, ezért belső " maradhat.
function fmValue(v) {
  const s = String(v);
  if (s === '') return '';
  const needs = /:\s|:$|\s#|^[\s"'#&*!|>%@`\[\]{},?-]|\s$/.test(s)
    || /^(?:true|false|null|yes|no|on|off|~)$/i.test(s)
    || /^[-+]?\d[\d.:eE+-]*$/.test(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s);
  return needs ? `"${s}"` : s;
}

export function serializePost(fields, body) {
  const lines = FIELD_ORDER
    .filter((k) => fields[k] !== undefined && fields[k] !== '')
    .map((k) => `${k}: ${fmValue(fields[k])}`);
  const text = String(body || '').replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n${text}\n`;
}

// ---- bemenet-ellenőrzés ----

function oneLine(v, max, label, required = false) {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (required && !s) throw new HttpError(400, `A(z) ${label} megadása kötelező.`);
  if (s.length > max) throw new HttpError(400, `A(z) ${label} legfeljebb ${max} karakter lehet.`);
  return s;
}

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Nyers HTML-ből a futtatható részeket nem engedjük be (a publikus blogra kerül, a marked nem szűr)
const DANGEROUS_BODY = /<\s*(?:script|iframe|object|embed|style|form|meta|link|base)\b|\bon[a-z]+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;

export function validatePostInput(input) {
  const title = oneLine(input.title, 200, 'cím', true);
  const date = oneLine(input.date, 10, 'dátum', true);
  if (!validDate(date)) throw new HttpError(400, 'A dátum formátuma ÉÉÉÉ-HH-NN legyen, valós nappal.');
  const category = oneLine(input.category, 20, 'kategória', true);
  if (!CATEGORIES.includes(category)) {
    throw new HttpError(400, 'Ismeretlen kategória. Választható: mozgas, sport, taplalkozas.');
  }
  const author = oneLine(input.author, 80, 'szerző') || DEFAULT_AUTHOR;
  const excerpt = oneLine(input.excerpt, 400, 'rövid bevezető');
  const cover = oneLine(input.cover, 200, 'borítókép');
  if (cover && !COVER_RE.test(cover)) {
    throw new HttpError(400, 'A borítókép útvonala érvénytelen (media/blog/… képfájl lehet).');
  }
  if (typeof input.body !== 'string') throw new HttpError(400, 'A bejegyzés szövege hiányzik.');
  const body = input.body;
  if (!body.trim()) throw new HttpError(400, 'A bejegyzés szövege nem lehet üres.');
  if (body.length > 200000) throw new HttpError(413, 'A bejegyzés szövege túl hosszú (legfeljebb 200 000 karakter).');
  if (DANGEROUS_BODY.test(body)) {
    throw new HttpError(400, 'A szöveg nem engedélyezett HTML-kódot tartalmaz (pl. script, iframe). Távolítsd el, és mentsd újra.');
  }
  return { fields: { title, date, author, category, cover, excerpt }, body };
}

export function postSummary(slug, data) {
  return {
    slug,
    title: data.title || '',
    date: data.date || '',
    category: CATEGORIES.includes(data.category) ? data.category : 'mozgas',
    cover: data.cover || '',
    excerpt: data.excerpt || '',
    author: data.author || '',
  };
}
