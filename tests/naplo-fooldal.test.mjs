// A tünet-teszt a főoldal Napló-szekciójára, a build-modul belső függvényeitől függetlenül
// (csak a `node tools/build-blog.mjs` parancsot futtatja), így a javítás előtti kódon is lefut és elbukik.
// Ideiglenes másolatban dolgozik, mert a repó index.html-je szándékosan csak pillanatkép: az adminból
// törölt vagy új bejegyzést a Pages buildje írja bele, a repóba nem kerül vissza.
// Futtatás: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('főoldal: build után a Napló csak létező bejegyzésre linkel, és a legfrissebb bejegyzés rajta van', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f360-fooldal-'));
  try {
    for (const d of ['tools', 'content']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(dir, 'index.html'));
    const mds = fs.readdirSync(path.join(dir, 'content', 'blog')).filter((f) => f.endsWith('.md')).sort().reverse();
    assert.ok(mds.length >= 2, 'a teszthez legalább 2 bejegyzés kell');
    // az admin törlését utánozzuk: a legfrissebb bejegyzés eltűnik
    const deleted = mds[0].slice(0, -3);
    fs.unlinkSync(path.join(dir, 'content', 'blog', mds[0]));
    execFileSync(process.execPath, [path.join(dir, 'tools', 'build-blog.mjs'), '--no-images'], { cwd: dir, encoding: 'utf8' });
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const slugs = [...html.matchAll(/href="blog\/([^"/]+)\.html"/g)].map((m) => m[1]);
    for (const s of slugs) {
      assert.ok(fs.existsSync(path.join(dir, 'content', 'blog', `${s}.md`)),
        `a főoldal a törölt/nem létező bejegyzésre linkel: ${s}`);
    }
    assert.ok(!slugs.includes(deleted), `a törölt bejegyzés a főoldalon maradt: ${deleted}`);
    assert.ok(slugs.includes(mds[1].slice(0, -3)), 'a megmaradt legfrissebb bejegyzés nincs a főoldalon');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
