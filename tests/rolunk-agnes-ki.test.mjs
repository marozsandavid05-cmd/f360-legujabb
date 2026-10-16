// Rólunk oldal, 2026-10-15 esti Lilla-kör (Caesar, t_636336d1): Kodácsiné Labancz Ágnes („Ági”) se a
// foglalóban, se a honlapon nem szerepel. A foglalóban archivált (D1), a statikus rolunk.html-ből is kikerül,
// és a statikus létszám-sor ugyanazt mutatja, mint az élő (dinamikus) névsor. Tesztadat: „David teszt”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_TORZS } from '../functions/_lib/booking/seed.js';
import { rolunkHtml } from '../functions/_lib/rolunk.js';

const GY = join(import.meta.dirname, '..');
const HTML = readFileSync(join(GY, 'rolunk.html'), 'utf8');
const MA = '2026-10-16';
const letszam = (html) => html.match(/<p class="team__count">([\s\S]*?)<\/p>/)[1];
const kartyak = (html) => [...html.match(/<div class="roster" data-roster>([\s\S]*?)<p class="roster__note"/)[1]
  .matchAll(/<details class="dossier" data-loc="([a-z]+)" data-id="([a-z-]+)"/g)].map((m) => `${m[1]}:${m[2]}`);

// az élő törzs alakja a 2026-10-15-i és a mostani migráció után: Ágnes archivált, Sebestyén két helyszínen
const eloTorzs = () => ({
  ...structuredClone(SEED_TORZS),
  kollegak: structuredClone(SEED_TORZS.kollegak).map((k) => {
    if (k.id === 'kodacsine-labancz-agnes') return { ...k, szolgaltatasok: [], archivalt: true };
    if (k.id === 'kovacs-sebestyen') return { ...k, helyszinek: ['mexikoi', 'reitter'] };
    return k;
  }),
});

test('statikus rolunk.html: Ágnes kártyája és a neve nincs benne (a képfájl maradhat a repóban)', () => {
  assert.ok(!kartyak(HTML).some((k) => k.endsWith(':kodacsine-labancz-agnes')));
  assert.ok(!HTML.includes('Kodácsiné'));
  assert.ok(!HTML.includes('Labancz'));
});

test('statikus létszám-sor = az élő névsoré: 8 szakember, 6 Mexikói, 4 Reitter, két kolléga mindkét helyszínen', () => {
  const dinamikus = rolunkHtml(HTML, eloTorzs(), MA);
  assert.equal(letszam(dinamikus), '<b data-n="team">8</b> szakember · <b data-n="mex">6</b> a Mexikói úton · <b data-n="reit">4</b> a Reitter Ferenc utcában · két kolléga mindkét helyszínen');
  assert.equal(letszam(HTML), letszam(dinamikus));
  assert.ok(!kartyak(dinamikus).some((k) => k.endsWith(':kodacsine-labancz-agnes')));
});

test('a honlap egyetlen HTML-oldala sem nevezi meg Ágnest (név, monogram-kép hivatkozás)', () => {
  const html = readdirSync(GY).filter((f) => f.endsWith('.html'));
  // a blog/ mappát a build generálja (a repóban nincs mindig); ha van, az is számít
  const blog = existsSync(join(GY, 'blog')) ? readdirSync(join(GY, 'blog')).filter((f) => f.endsWith('.html')).map((f) => join('blog', f)) : [];
  assert.ok(html.includes('rolunk.html') && html.length > 10);
  for (const f of [...html, ...blog]) {
    const t = readFileSync(join(GY, f), 'utf8');
    assert.ok(!/Kodácsiné|Labancz|kodacsine-labancz-agnes/.test(t), f);
  }
});
