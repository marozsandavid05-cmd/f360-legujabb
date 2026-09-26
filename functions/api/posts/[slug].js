// GET    /api/posts/:slug → { ...frontmatter, slug, body, sha }
// PUT    /api/posts/:slug → body mint a POST-nál + sha (optimista zár) → { slug, commit }
// DELETE /api/posts/:slug?sha=… (vagy JSON { sha }) → { ok: true, commit }
//
// Szerkesztéskor a slug (és így az URL) NEM változik, akkor sem, ha a cím vagy a dátum módosul:
// a már megosztott linkek így nem törnek el.

import { json, methods, readJson, HttpError } from '../../_lib/http.js';
import { githubFromEnv, commitMessage } from '../../_lib/github.js';
import { parseFrontmatter, validatePostInput, serializePost, postPath, assertSlug, FIELD_ORDER } from '../../_lib/posts.js';

const SHA_RE = /^[0-9a-f]{40}$/;

function slugParam(params) {
  const s = Array.isArray(params.slug) ? params.slug.join('/') : params.slug;
  return assertSlug(String(s || '').replace(/\.md$/, ''));
}

function requireSha(sha) {
  if (!SHA_RE.test(String(sha || ''))) {
    throw new HttpError(400, 'Hiányzik a verzió-azonosító (sha). Töltsd újra a bejegyzést, és próbáld újra.');
  }
  return sha;
}

export const onRequest = methods({
  GET: async ({ params, env }) => {
    const slug = slugParam(params);
    const gh = githubFromEnv(env);
    const f = await gh.getFile(postPath(slug));
    if (!f) throw new HttpError(404, 'Ez a bejegyzés nem létezik.');
    const { data, body } = parseFrontmatter(f.text);
    const out = { slug };
    for (const k of FIELD_ORDER) out[k] = data[k] || '';
    out.body = body;
    out.sha = f.sha;
    return json(out);
  },

  PUT: async ({ params, request, env, data }) => {
    const slug = slugParam(params);
    const input = await readJson(request);
    const sha = requireSha(input.sha);
    const { fields, body } = validatePostInput(input);
    const gh = githubFromEnv(env);
    const r = await gh.putText(postPath(slug), serializePost(fields, body), commitMessage('módosítás', slug, data.email), sha);
    return json({ slug, commit: r.commit, sha: r.sha });
  },

  DELETE: async ({ params, request, env, data }) => {
    const slug = slugParam(params);
    const gh = githubFromEnv(env);
    let sha = new URL(request.url).searchParams.get('sha');
    if (!sha && (request.headers.get('Content-Type') || '').includes('application/json')) {
      sha = (await readJson(request)).sha;
    }
    if (!sha) {
      // sha nélkül is törölhető (a felület megerősítést kér), ilyenkor a legfrissebb verzió megy
      const f = await gh.getFile(postPath(slug));
      if (!f) throw new HttpError(404, 'Ez a bejegyzés már nem létezik.');
      sha = f.sha;
    }
    const r = await gh.deleteFile(postPath(slug), { sha: requireSha(sha), message: commitMessage('törlés', slug, data.email) });
    return json({ ok: true, commit: r.commit });
  },
});
