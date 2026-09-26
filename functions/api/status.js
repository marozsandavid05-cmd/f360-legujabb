// GET /api/status → a legutóbbi éles Pages-deploy állapota
// { state: "building" | "success" | "failure", time, stage, commit, message, createdOn, modifiedOn, finishedOn }
//
// A felület ebből írja ki: „Élesítés folyamatban…” / „Élesben van”.
// Env: CF_API_TOKEN (Pages: olvasás elég), CF_ACCOUNT_ID, opcionálisan CF_PAGES_PROJECT.

import { json, methods, HttpError } from '../_lib/http.js';

const DEFAULT_PROJECT = 'f360-legujabb';

export function deployState(dep) {
  const stage = (dep && dep.latest_stage) || {};
  if (stage.status === 'failure' || stage.status === 'canceled') return 'failure';
  if (stage.name === 'deploy' && stage.status === 'success') return 'success';
  return 'building';
}

export const onRequest = methods({
  GET: async ({ env }) => {
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
      throw new HttpError(500, 'Az élesítés állapota nincs beállítva a szerveren. Szólj Davidnek.');
    }
    const project = env.CF_PAGES_PROJECT || DEFAULT_PROJECT;
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}`
      + `/pages/projects/${encodeURIComponent(project)}/deployments?env=production&per_page=1`;
    let res;
    try {
      res = await (env.__fetch || globalThis.fetch.bind(globalThis))(url, {
        headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      console.error('[status] hálózati hiba:', e && e.name, e && e.message);
      throw new HttpError(502, 'Az élesítés állapota most nem kérdezhető le.');
    }
    let body = null;
    try { body = await res.json(); } catch { /* üres vagy nem JSON */ }
    if (!res.ok || !body || !body.success) {
      console.error('[status] Cloudflare API:', res.status, body && JSON.stringify(body.errors || '').slice(0, 200));
      throw new HttpError(502, 'Az élesítés állapota most nem kérdezhető le.');
    }
    const dep = (body.result || [])[0];
    if (!dep) return json({ state: 'success', time: null, stage: null, commit: null, message: null, createdOn: null, modifiedOn: null, finishedOn: null });
    const meta = (dep.deployment_trigger && dep.deployment_trigger.metadata) || {};
    const stage = dep.latest_stage || {};
    return json({
      state: deployState(dep),
      // `time`: a felület ezt nézi (befejezés ideje, építés közben az indulásé)
      time: stage.ended_on || dep.created_on || null,
      stage: stage.name || null,
      commit: meta.commit_hash || null,
      message: meta.commit_message ? String(meta.commit_message).split('\n')[0].slice(0, 200) : null,
      createdOn: dep.created_on || null,
      modifiedOn: dep.modified_on || null,
      finishedOn: stage.ended_on || null,
    }, 200);
  },
});
