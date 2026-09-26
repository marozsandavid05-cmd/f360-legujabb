// GET  /api/posts  → bejegyzések listája, dátum szerint csökkenő
// POST /api/posts  → új bejegyzés { title, date, category, author, excerpt, cover, body } → { slug, commit }

import { json, methods, readJson, HttpError } from '../../_lib/http.js';
import { githubFromEnv, commitMessage } from '../../_lib/github.js';
import {
  parseFrontmatter, postSummary, validatePostInput, serializePost, slugFor, postPath, SLUG_RE,
} from '../../_lib/posts.js';

const MAX_SUFFIX = 20;

export const onRequest = methods({
  GET: async ({ env }) => {
    const gh = githubFromEnv(env);
    const entries = await gh.listDirWithText('content/blog');
    const posts = [];
    for (const e of entries) {
      if (!e.name.endsWith('.md') || e.text == null) continue;
      const slug = e.name.slice(0, -3);
      if (!SLUG_RE.test(slug)) continue;
      const { data } = parseFrontmatter(e.text);
      if (!data.title) continue; // a build is kihagyja
      posts.push(postSummary(slug, data));
    }
    // ugyanaz a rendezés, mint a tools/build-blog.mjs-ben (azonos napon a slug dönt, stabilan)
    posts.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.slug.localeCompare(b.slug));
    return json(posts);
  },

  POST: async ({ request, env, data }) => {
    const input = await readJson(request);
    const { fields, body } = validatePostInput(input);
    const gh = githubFromEnv(env);
    const base = slugFor(fields.date, fields.title);
    const text = serializePost(fields, body);

    for (let n = 1; n <= MAX_SUFFIX; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      if (await gh.exists(postPath(slug))) continue;
      try {
        const r = await gh.putText(postPath(slug), text, commitMessage('új bejegyzés', slug, data.email));
        return json({ slug, commit: r.commit }, 201);
      } catch (e) {
        // versenyhelyzet: közben valaki létrehozta ugyanezt a fájlt → következő utótag
        if (e instanceof HttpError && e.status === 409) continue;
        throw e;
      }
    }
    throw new HttpError(409, 'Túl sok azonos című bejegyzés ezen a napon. Adj meg más címet.');
  },
});
