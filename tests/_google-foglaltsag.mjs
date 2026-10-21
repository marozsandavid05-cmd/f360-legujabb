// Közös teszt-segéd a kolléga saját naptárának figyeléséhez (foglaltság): szolgáltatásfiók-kulcs a
// tesztben generált RSA-kulccsal, és egy Google-utánzat a token-végponttal, a freeBusy.query-vel és az
// events.list-tel. Valódi Google-hívás nincs. Nem teszt-fájl (nincs .test a nevében).
import { TOKEN_URL } from '../functions/_lib/booking/naptar.js';
import { helyiToUtc } from '../functions/_lib/booking/ido.js';

let kulcsPar = null;
let kidSzamlalo = 0;

/** Egy szolgáltatásfiók-kulcs JSON-ja (mint amit a Google Cloud letöltet), egyedi kid-del. */
export async function saKulcs() {
  if (!kulcsPar) {
    kulcsPar = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
    );
  }
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kulcsPar.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  kidSzamlalo += 1;
  return JSON.stringify({
    type: 'service_account', project_id: 'f360-teszt', private_key_id: `fkid${kidSzamlalo}${Date.now()}`,
    private_key: pem, client_email: `f360-foglaltsag-${kidSzamlalo}@f360-teszt.iam.gserviceaccount.com`, token_uri: TOKEN_URL,
  });
}

const API = 'https://www.googleapis.com/calendar/v3/';

/** Budapesti helyi idő ('YYYY-MM-DD', 'HH:MM') → RFC3339 UTC, ahogy a Google visszaadja. */
export function utc(datum, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(helyiToUtc(datum, h * 60 + m)).toISOString().replace('.000Z', 'Z');
}

/**
 * Google-utánzat. `foglalt`: naptár → [{ start, end }] (RFC3339, a freeBusy ezt adja vissza).
 * `esemenyek`: naptár → események (az events.list ezeket adja). `jog`: naptár → 'nincs' | 'szabadfoglalt' |
 * 'olvas' (alap: 'szabadfoglalt' a freeBusy-hez, 'olvas' az events.list-hez). `hiba`: státusz vagy függvény.
 */
export function googleFoglaltsag() {
  const g = { hivasok: [], tokenHivas: 0, foglalt: new Map(), esemenyek: new Map(), jog: new Map(), hiba: null, scope: [] };
  const valasz = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
  g.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u === TOKEN_URL) {
      g.tokenHivas += 1;
      const p = new URLSearchParams(String(init.body));
      const claim = JSON.parse(Buffer.from(p.get('assertion').split('.')[1], 'base64url').toString());
      g.scope.push(claim.scope);
      return valasz({ access_token: `ftok-${g.tokenHivas}`, expires_in: 3599, token_type: 'Bearer' });
    }
    if (!u.startsWith(API)) throw new Error(`váratlan URL: ${u}`);
    const body = init.body ? JSON.parse(init.body) : null;
    const ut = u.slice(API.length).split('?')[0];
    const q = new URL(u).searchParams;
    const hivas = { method, ut, body, q, auth: init.headers && init.headers.Authorization };
    g.hivasok.push(hivas);
    if (g.hiba) {
      const h = typeof g.hiba === 'function' ? g.hiba(hivas) : g.hiba;
      if (h) return valasz({ error: { code: h, message: `Teszt hiba ${h}`, errors: [{ reason: 'backendError' }] } }, h);
    }
    if (method === 'POST' && ut === 'freeBusy') {
      const tMin = Date.parse(body.timeMin);
      const tMax = Date.parse(body.timeMax);
      const calendars = {};
      for (const { id } of body.items) {
        if (g.jog.get(id) === 'nincs') { calendars[id] = { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] }; continue; }
        const busy = (g.foglalt.get(id) || []).filter((b) => Date.parse(b.start) < tMax && Date.parse(b.end) > tMin)
          .map((b) => ({ start: new Date(Math.max(Date.parse(b.start), tMin)).toISOString(), end: new Date(Math.min(Date.parse(b.end), tMax)).toISOString() }));
        calendars[id] = { busy };
      }
      return valasz({ kind: 'calendar#freeBusy', timeMin: body.timeMin, timeMax: body.timeMax, calendars });
    }
    const m = /^calendars\/([^/]+)\/events$/.exec(ut);
    if (method === 'GET' && m) {
      const cal = decodeURIComponent(m[1]);
      const jog = g.jog.get(cal) || 'olvas';
      if (jog === 'nincs') return valasz({ error: { code: 404, message: 'Not Found', errors: [{ reason: 'notFound' }] } }, 404);
      const tMin = Date.parse(q.get('timeMin'));
      const tMax = Date.parse(q.get('timeMax'));
      const kezd = (e) => Date.parse(e.start.dateTime || `${e.start.date}T00:00:00Z`);
      const veg = (e) => Date.parse(e.end.dateTime || `${e.end.date}T00:00:00Z`);
      const items = (g.esemenyek.get(cal) || []).filter((e) => kezd(e) < tMax && veg(e) > tMin)
        .map((e) => (jog === 'szabadfoglalt' ? { start: e.start, end: e.end } : e));
      return valasz({ kind: 'calendar#events', accessRole: jog === 'szabadfoglalt' ? 'freeBusyReader' : 'owner', items });
    }
    throw new Error(`váratlan hívás: ${method} ${ut}`);
  };
  g.freeBusyHivasok = () => g.hivasok.filter((h) => h.ut === 'freeBusy');
  g.listaHivasok = () => g.hivasok.filter((h) => h.ut.endsWith('/events'));
  return g;
}

/** A globális fetch cseréje a teszt idejére. */
export async function fetchCsere(g, fn) {
  const eredeti = globalThis.fetch;
  globalThis.fetch = g.fetch;
  try { return await fn(); } finally { globalThis.fetch = eredeti; }
}
