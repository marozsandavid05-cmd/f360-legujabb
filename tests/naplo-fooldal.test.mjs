// A tünet-teszt a főoldal Napló-szekciójára, a build-modultól függetlenül (így a javítás előtti kódon is fut).
// Futtatás: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('főoldal: a Napló csak létező bejegyzésre linkel (törölt poszt nem maradhat)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const slugs = [...html.matchAll(/href="blog\/([^"/]+)\.html"/g)].map((m) => m[1]);
  for (const s of slugs) {
    assert.ok(fs.existsSync(path.join(ROOT, 'content', 'blog', `${s}.md`)),
      `a főoldal a törölt/nem létező bejegyzésre linkel: ${s}`);
  }
});

