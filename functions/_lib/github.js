// GitHub-adapter: a blog tartalma a repóban él (content/blog/*.md, media/blog/*).
// REST Contents API az íráshoz (sha-val optimista zár), GraphQL a listázáshoz (egy kérés, nem N).
// Minden GitHub-specifikus részlet itt van, a végpontok csak ezt a felületet látják.

import { HttpError } from './http.js';
import { utf8ToBase64, base64ToUtf8 } from './base64.js';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'marozsandavid05-cmd/f360-legujabb';
const TIMEOUT_MS = 15000;

export function githubFromEnv(env) {
  if (!env.GITHUB_TOKEN) {
    // Szándékos az előnézeti környezetben: onnan nem szabad a repóba írni. A felület a kódból
    // tudja, hogy itt nem hiba van, hanem nyugodt tájékoztatást mutat (admin.js blogNincs).
    throw new HttpError(503, 'A blog ezen a próbaoldalon nem szerkeszthető.', { kod: 'blog_nincs_beallitva' });
  }
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new HttpError(500, 'Hibás GITHUB_REPO beállítás.');
  const branch = env.GITHUB_BRANCH || 'main';
  return new GitHub({ token: env.GITHUB_TOKEN, repo, branch, fetchImpl: env.__fetch || fetch });
}

function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export class GitHub {
  constructor({ token, repo, branch, fetchImpl }) {
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.fetch = (...args) => fetchImpl(...args); // workerd: a fetch nem hívható idegen this-szel
    [this.owner, this.name] = repo.split('/');
  }

  async request(method, url, body) {
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'f360-blog-admin',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      console.error('[github] hálózati hiba:', method, url.replace(API, ''), e && e.name, e && e.message);
      throw new HttpError(502, 'A tárhely (GitHub) most nem érhető el. Próbáld újra egy perc múlva.');
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
    }
    return { status: res.status, data, headers: res.headers };
  }

  // Nem várt GitHub-válasz → egységes, titokmentes hiba
  fail(r, what) {
    const msg = r.data && r.data.message ? String(r.data.message).slice(0, 200) : '';
    console.error(`[github] ${what}: HTTP ${r.status} ${msg}`);
    if (r.status === 401) throw new HttpError(502, 'A blog tárhelyének kulcsa érvénytelen vagy lejárt, ezért most nem menthető. Jelezd a weboldal karbantartójának.');
    if (r.status === 403 || r.status === 429) {
      throw new HttpError(503, 'A GitHub átmenetileg korlátozza a kéréseket, vagy nincs jogosultság. Próbáld újra később.');
    }
    throw new HttpError(502, 'A tárhely (GitHub) hibát jelzett, a módosítás nem mentődött.');
  }

  contentsUrl(path, withRef = false) {
    const u = `${API}/repos/${this.owner}/${this.name}/contents/${encPath(path)}`;
    return withRef ? `${u}?ref=${encodeURIComponent(this.branch)}` : u;
  }

  // Egy fájl: { text, sha } vagy null, ha nincs
  async getFile(path) {
    const r = await this.request('GET', this.contentsUrl(path, true));
    if (r.status === 404) return null;
    if (r.status !== 200 || !r.data || Array.isArray(r.data)) this.fail(r, `getFile ${path}`);
    let text;
    if (r.data.encoding === 'base64' && typeof r.data.content === 'string' && r.data.content) {
      text = base64ToUtf8(r.data.content);
    } else {
      // 1 MB fölött a Contents API nem ad tartalmat: blob API
      const b = await this.request('GET', `${API}/repos/${this.owner}/${this.name}/git/blobs/${r.data.sha}`);
      if (b.status !== 200) this.fail(b, `getBlob ${path}`);
      text = base64ToUtf8(b.data.content);
    }
    return { text, sha: r.data.sha };
  }

  async exists(path) {
    const r = await this.request('GET', this.contentsUrl(path, true));
    if (r.status === 404) return false;
    if (r.status === 200) return true;
    this.fail(r, `exists ${path}`);
  }

  // Könyvtár tartalma egyetlen GraphQL-kérésben: [{ name, oid, text }]
  async listDirWithText(dir) {
    const query = `query($owner:String!,$name:String!,$expr:String!){
      repository(owner:$owner,name:$name){
        object(expression:$expr){
          ... on Tree { entries { name type oid object { ... on Blob { text isBinary } } } }
        }
      }
    }`;
    const r = await this.request('POST', `${API}/graphql`, {
      query,
      variables: { owner: this.owner, name: this.name, expr: `${this.branch}:${dir}` },
    });
    if (r.status !== 200 || !r.data || r.data.errors) {
      if (r.data && r.data.errors) console.error('[github] graphql:', JSON.stringify(r.data.errors).slice(0, 300));
      this.fail(r, `listDir ${dir}`);
    }
    const repo = r.data.data && r.data.data.repository;
    if (!repo) throw new HttpError(502, 'A blog tárhelye nem található. Jelezd a weboldal karbantartójának.');
    if (!repo.object) return [];
    return repo.object.entries
      .filter((e) => e.type === 'blob')
      .map((e) => ({ name: e.name, oid: e.oid, text: e.object && !e.object.isBinary ? e.object.text : null }));
  }

  // Létrehozás (sha nélkül) vagy módosítás (sha-val). Ütközésnél HttpError 409.
  async putFile(path, { contentBase64, message, sha }) {
    const r = await this.request('PUT', this.contentsUrl(path), {
      message,
      content: contentBase64,
      branch: this.branch,
      ...(sha ? { sha } : {}),
    });
    if (r.status === 200 || r.status === 201) {
      return { sha: r.data.content.sha, commit: r.data.commit.sha };
    }
    if (r.status === 409 || (r.status === 422 && !sha && /sha/i.test((r.data && r.data.message) || ''))) {
      throw new HttpError(409, 'Közben valaki más is módosította, töltsd újra.', { code: 'conflict' });
    }
    if (r.status === 404 && sha) {
      throw new HttpError(409, 'Közben valaki más is módosította (vagy törölte), töltsd újra.', { code: 'conflict' });
    }
    this.fail(r, `putFile ${path}`);
  }

  async putText(path, text, message, sha) {
    return this.putFile(path, { contentBase64: utf8ToBase64(text), message, sha });
  }

  async deleteFile(path, { sha, message }) {
    const r = await this.request('DELETE', this.contentsUrl(path), { message, sha, branch: this.branch });
    if (r.status === 200) return { commit: r.data.commit.sha };
    if (r.status === 409) throw new HttpError(409, 'Közben valaki más is módosította, töltsd újra.', { code: 'conflict' });
    if (r.status === 404) throw new HttpError(404, 'Ez a bejegyzés már nem létezik.');
    if (r.status === 422) throw new HttpError(409, 'Közben valaki más is módosította, töltsd újra.', { code: 'conflict' });
    this.fail(r, `deleteFile ${path}`);
  }
}

export function commitMessage(action, slug, email) {
  return `Blog-admin: ${action}: ${slug}\n\nMódosította: ${email}`;
}
