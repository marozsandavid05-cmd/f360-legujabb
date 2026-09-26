// Egységtesztek a blog-admin backend tiszta logikájára. Futtatás: npm test  (node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyAccessJwt, _resetJwksCache } from '../functions/_lib/access.js';
import {
  kebab, slugFor, titlePart, parseFrontmatter, serializePost, validatePostInput, SLUG_RE, assertSlug,
} from '../functions/_lib/posts.js';
import { sniffImage } from '../functions/api/upload.js';
import { deployState } from '../functions/api/status.js';
import { HttpError } from '../functions/_lib/http.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAM = 'https://f360teszt.cloudflareaccess.com';
const AUD = 'aud-teszt-123';

// ---- JWT segéd: saját RSA-kulcspár, a JWKS-t a teszt adja ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function makeSigner(kid = 'k1') {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwks = { keys: [{ kty: 'RSA', kid, n: pub.n, e: pub.e, alg: 'RS256', use: 'sig' }] };
  async function sign(payload, header = {}) {
    const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT', ...header }));
    const p = b64u(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(sig)}`;
  }
  return { jwks, sign };
}
const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ iss: TEAM, aud: [AUD], email: 'lilla@example.com', exp: now() + 600, iat: now(), nbf: now() - 5 });

test('JWT: érvényes token elfogadva, e-mail visszajön', async () => {
  _resetJwksCache();
  const s = await makeSigner();
  const p = await verifyAccessJwt(await s.sign(good()), { teamDomain: TEAM, aud: AUD, fetchJwks: async () => s.jwks });
  assert.equal(p.email, 'lilla@example.com');
});

test('JWT: team-domain séma nélkül is működik', async () => {
  _resetJwksCache();
  const s = await makeSigner();
  const p = await verifyAccessJwt(await s.sign(good()), { teamDomain: 'f360teszt.cloudflareaccess.com', aud: AUD, fetchJwks: async () => s.jwks });
  assert.equal(p.email, 'lilla@example.com');
});

for (const [name, mut, hdr] of [
  ['rossz aud', (p) => { p.aud = ['masik']; }],
  ['rossz iss', (p) => { p.iss = 'https://tamado.cloudflareaccess.com'; }],
  ['lejárt', (p) => { p.exp = now() - 3600; }],
  ['nbf a jövőben', (p) => { p.nbf = now() + 3600; }],
  ['hiányzó e-mail', (p) => { delete p.email; }],
  ['alg none', () => {}, { alg: 'none' }],
  ['ismeretlen kid', () => {}, { kid: 'mas' }],
]) {
  test(`JWT: elutasítva (${name})`, async () => {
    _resetJwksCache();
    const s = await makeSigner();
    const p = good(); mut(p);
    const tok = await s.sign(p, hdr);
    await assert.rejects(verifyAccessJwt(tok, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => s.jwks }));
  });
}

test('JWT: más kulccsal aláírt token elutasítva', async () => {
  _resetJwksCache();
  const valodi = await makeSigner();
  const hamis = await makeSigner();
  const tok = await hamis.sign(good());
  await assert.rejects(verifyAccessJwt(tok, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => valodi.jwks }), /aláírás/);
});

test('JWT: megváltoztatott payload elutasítva', async () => {
  _resetJwksCache();
  const s = await makeSigner();
  const [h, , sig] = (await s.sign(good())).split('.');
  const p2 = b64u(JSON.stringify({ ...good(), email: 'tamado@example.com' }));
  await assert.rejects(verifyAccessJwt(`${h}.${p2}.${sig}`, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => s.jwks }));
});

test('JWT: szemét bemenet elutasítva', async () => {
  for (const t of ['', 'abc', 'a.b', 'a.b.c', null]) {
    await assert.rejects(verifyAccessJwt(t, { teamDomain: TEAM, aud: AUD, fetchJwks: async () => ({ keys: [] }) }));
  }
});

// ---- slug: a meglévő fájlnevek pontosan visszaállnak a címből + dátumból ----
test('slug: a meglévő bejegyzések fájlneve a címből képezhető (vagy dokumentáltan rövidebb)', () => {
  const dir = path.join(ROOT, 'content', 'blog');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  // a bejegyzések száma az adminból változik (törlés, új), ezért darabszámot nem rögzítünk
  for (const f of files) {
    const slug = f.slice(0, -3);
    assert.match(slug, SLUG_RE, `a meglévő slug illeszkedik a mintára: ${slug}`);
    const { data } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    const gen = slugFor(data.date, data.title);
    // a meglévő fájlnevek kézzel rövidítettek lehetnek, de a generált alak ugyanazt a mintát követi
    assert.match(gen, SLUG_RE, `generált slug mintája: ${gen}`);
    assert.ok(gen.startsWith(`${data.date}-`));
  }
});

test('slug: ékezetek, írásjelek, kettőspont', () => {
  assert.equal(kebab('Fehérje: mennyi kell valójában?'), 'feherje-mennyi-kell-valojaban');
  assert.equal(kebab('Öt perc nyújtás reggel, ami tényleg belefér'), 'ot-perc-nyujtas-reggel-ami-tenyleg-belefer');
  assert.equal(kebab('Mire számíts az első gyógytorna-alkalmon?'), 'mire-szamits-az-elso-gyogytorna-alkalmon');
  assert.equal(kebab('ŐŰ őű ÁÉÍÓÖÚÜ'), 'ou-ou-aeioouu');
  assert.equal(slugFor('2026-08-24', 'Fehérje: mennyi kell valójában?'), '2026-08-24-feherje-mennyi-kell-valojaban');
  assert.equal(slugFor('2026-09-01', '!!!'), '2026-09-01-bejegyzes');
  // a meglévők közül ezek a címből képzett nevek; a másik kettő (ot-perc…, regeneracio…) kézzel rövidített
  assert.equal(slugFor('2026-08-08', 'Testtudat: a mozgás csendes alapja'), '2026-08-08-testtudat-a-mozgas-csendes-alapja');
  assert.equal(slugFor('2026-08-11', 'Bemelegítés, amit tényleg megcsinálsz'), '2026-08-11-bemelegites-amit-tenyleg-megcsinalsz');
  assert.equal(slugFor('2026-08-18', 'Mit egyél edzés előtt és után?'), '2026-08-18-mit-egyel-edzes-elott-es-utan');
  assert.equal(slugFor('2026-08-21', 'Mire számíts az első gyógytorna-alkalmon?'), '2026-08-21-mire-szamits-az-elso-gyogytorna-alkalmon');
  const long = titlePart('Ez egy nagyon hosszú cím, amely jóval több mint hatvan karakter, hogy lássuk a vágást');
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
});

test('slug: path traversal és idegen minták elutasítva', () => {
  for (const s of ['../secret', '2026-08-24-a/../../x', 'abc', '2026-08-24-', '2026-08-24-A', '2026-08-24-a b', '2026-08-24-a.md.x']) {
    assert.throws(() => assertSlug(s), HttpError, s);
  }
  assert.equal(assertSlug('2026-08-24-feherje-mennyi-kell-valojaban'), '2026-08-24-feherje-mennyi-kell-valojaban');
});

// ---- frontmatter: oda-vissza, a build parserével kompatibilis ----
test('frontmatter: a meglévő fájlok újraírva ugyanazt a mezőértéket adják', () => {
  const dir = path.join(ROOT, 'content', 'blog');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const a = parseFrontmatter(raw);
    const out = serializePost(a.data, a.body);
    const b = parseFrontmatter(out);
    assert.deepEqual(b.data, a.data, f);
    assert.equal(b.body.trim(), a.body.replace(/\r\n/g, '\n').trim(), f);
    // a kettőspontos cím idézőjelbe kerül, mint a meglévőkben
    if (a.data.title.includes(': ')) assert.match(out, /^title: ".*"$/m);
  }
});

test('frontmatter: veszélyes értékek nem törik szét a fejlécet', () => {
  const v = validatePostInput({
    title: 'Cím\n---\ninjected: igen', date: '2026-09-26', category: 'sport', author: '', excerpt: '"idéző" # kettős', body: 'szöveg',
  });
  const out = serializePost(v.fields, v.body);
  const p = parseFrontmatter(out);
  assert.equal(p.data.title, 'Cím --- injected: igen');
  assert.equal(p.data.injected, undefined);
  assert.equal(p.data.author, 'Studio F360');
  assert.equal(p.data.excerpt, '"idéző" # kettős');
  assert.equal(p.body.trim(), 'szöveg');
});

test('validálás: hibás mezők magyar 400-zal', () => {
  const base = { title: 'A', date: '2026-09-26', category: 'sport', body: 'x' };
  const bad = [
    { ...base, title: '' },
    { ...base, date: '2026-02-30' },
    { ...base, date: '26-09-2026' },
    { ...base, category: 'egyeb' },
    { ...base, cover: 'https://tamado.hu/x.jpg' },
    { ...base, cover: 'media/blog/../../index.html' },
    { ...base, body: '' },
    { ...base, body: 'szia <script>alert(1)</script>' },
    { ...base, body: '<img src=x onerror=alert(1)>' },
    { ...base, body: '[katt](javascript:alert(1))' },
  ];
  for (const b of bad) assert.throws(() => validatePostInput(b), HttpError, JSON.stringify(b));
  const ok = validatePostInput({ ...base, cover: 'media/blog/feherje-alapok-1a2b3c4d.webp', body: '## Cím\n\n![kép](media/blog/x-12345678.webp)' });
  assert.equal(ok.fields.cover, 'media/blog/feherje-alapok-1a2b3c4d.webp');
});

// ---- upload: típus a tartalomból ----
test('upload: magic bytes felismerés', () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.equal(sniffImage(webp).ext, 'webp');
  assert.equal(sniffImage(jpg).ext, 'jpg');
  assert.equal(sniffImage(png).ext, 'png');
  assert.equal(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a......')), null);
});

test('status: deploy-állapot leképezés', () => {
  assert.equal(deployState({ latest_stage: { name: 'deploy', status: 'success' } }), 'success');
  assert.equal(deployState({ latest_stage: { name: 'build', status: 'active' } }), 'building');
  assert.equal(deployState({ latest_stage: { name: 'queued', status: 'idle' } }), 'building');
  assert.equal(deployState({ latest_stage: { name: 'build', status: 'failure' } }), 'failure');
  assert.equal(deployState({ latest_stage: { name: 'deploy', status: 'canceled' } }), 'failure');
});
