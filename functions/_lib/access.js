// Cloudflare Access JWT ellenőrzés (Cf-Access-Jwt-Assertion)
// RS256 aláírás WebCrypto-val a team-domain JWKS-éből, plusz iss / aud / exp / nbf.
// Szándékosan függőség nélkül, hogy a Pages Functions build ne függjön npm-csomagtól.

import { base64UrlToBytes } from './base64.js';

const LEEWAY_S = 60;          // óraeltérés-tűrés
const JWKS_TTL_MS = 10 * 60 * 1000;

// isolate-szintű gyorsítótár: teamDomain → { at, keys: Map(kid → CryptoKey) }
const jwksCache = new Map();

export function normalizeTeamDomain(v) {
  let d = String(v || '').trim().replace(/\/+$/, '');
  if (d && !/^https?:\/\//i.test(d)) d = `https://${d}`;
  return d;
}

async function defaultFetchJwks(teamDomain) {
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS letöltés sikertelen: HTTP ${res.status}`);
  return res.json();
}

async function importKeys(jwks) {
  const keys = new Map();
  for (const jwk of (jwks && jwks.keys) || []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  return keys;
}

async function getKey(teamDomain, kid, fetchJwks) {
  const now = Date.now();
  let entry = jwksCache.get(teamDomain);
  if (!entry || now - entry.at > JWKS_TTL_MS || !entry.keys.has(kid)) {
    // kulcsrotációnál (ismeretlen kid) újratöltünk, de legfeljebb 30 mp-enként
    if (!entry || now - entry.at > 30 * 1000 || !entry.keys.size) {
      entry = { at: now, keys: await importKeys(await fetchJwks(teamDomain)) };
      jwksCache.set(teamDomain, entry);
    }
  }
  return entry.keys.get(kid) || null;
}

function decodePart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

/**
 * Ellenőrzi az Access JWT-t. Siker esetén a payloadot adja vissza, hibánál Error-t dob
 * (az üzenet csak naplózásra való, a kliens általános 401-et kap).
 */
export async function verifyAccessJwt(token, { teamDomain, aud, fetchJwks = defaultFetchJwks, now = Date.now() }) {
  const team = normalizeTeamDomain(teamDomain);
  if (!team || !aud) throw new Error('hiányzó teamDomain vagy aud');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('nem JWT formátum');

  let header, payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new Error('dekódolhatatlan JWT');
  }
  if (header.alg !== 'RS256') throw new Error(`nem támogatott alg: ${header.alg}`);
  if (!header.kid) throw new Error('hiányzó kid');

  const key = await getKey(team, header.kid, fetchJwks);
  if (!key) throw new Error('ismeretlen kid');

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('érvénytelen aláírás');

  const t = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + LEEWAY_S < t) throw new Error('lejárt token');
  if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_S > t) throw new Error('még nem érvényes token');
  if (payload.iss !== team) throw new Error('hibás kibocsátó (iss)');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('hibás célközönség (aud)');
  if (!payload.email || typeof payload.email !== 'string') throw new Error('hiányzó e-mail a tokenben');
  return payload;
}

// csak tesztekhez
export function _resetJwksCache() {
  jwksCache.clear();
}
