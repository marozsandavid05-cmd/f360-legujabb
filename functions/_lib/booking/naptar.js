// Időpontfoglaló · Google Naptár szinkron (2026-10).
//
// Mit csinál: minden egyéni foglalás és minden csoportos óra (amire van jelentkező) egy esemény a
// szakember Google Naptárában (kolléga `naptar_id`), és ha be van állítva, a közös stúdiónaptárban
// (szabalyok.studioNaptarId). Módosításkor az esemény frissül, kolléga-cserénél átkerül, lemondáskor
// (és ha a csoportos óra elmarad vagy kiürül) törlődik. AI nincs benne, sima Google Calendar API v3.
//
// Döntések:
//   - Hitelesítés: Google szolgáltatásfiók (GOOGLE_SA_KEY titok, a teljes JSON-kulcs). JWT RS256
//     WebCrypto-val, access token az oauth2.googleapis.com/token-ről, scope calendar.events. A token
//     a lejárata előtt 60 másodpercig gyorsítótárban marad (isolate-onként). Kulcs nélkül minden no-op.
//   - Állapot-alapú, idempotens egyeztetés: egy „elem” (foglalás F..., óra S...) kívánt állapotát a
//     D1-ből számoljuk, és összevetjük a gcal_esemeny táblával (elem, cél → naptár, esemény-azonosító).
//     Az esemény-azonosító determinisztikus (elem + cél), így egy elem egy naptárba nem kerülhet be
//     kétszer: a 409 (már létező, akár törölt azonosító) után patch jön, ami vissza is állítja.
//   - Megbízhatóság: a Google-hívás soha nem a foglalás kérésében fut, hanem ctx.waitUntil-ban.
//     Előbb a gcal_sor várakozó sorba kerül az elem (verzió-számlálóval), és csak a sikeres egyeztetés
//     után törlődik onnan. Hiba vagy megszakadt futás esetén ott marad: a 15 perces cron, az admin
//     megnyitása és az „Újraszinkron” végpont újrapróbálja.
//   - Token-hiba (visszavont kulcs, kikapcsolt API) esetén a futás az első tételnél leáll. Egy tételt
//     a cron és az admin-megnyitás legfeljebb AUTO_MAX_PROBA-szor próbál, utána csak a kézi újraszinkron.
//   - Hívás-keret: egy futás legfeljebb GCAL_MAX_HIVAS (alap 25) Google-hívást indít (Workers Free:
//     50 subrequest/kérés, ebből a levélküldés legfeljebb 20) és legfeljebb GCAL_MAX_ELEM (alap 60) elemet dolgoz fel, a maradék a sorban vár.
//   - Adatvédelem: a naptárba név, telefon, megjegyzés kerül (Lilla kérése), e-mail-cím és lemondó
//     token nem. Az esemény láthatósága a naptár alapértelmezése: ki mit lát, azt a naptár megosztása
//     dönti el (a „private” esemény a csak részleteket látó kollégának üres foglalt blokk lenne).

import { HttpError } from '../http.js';
import { budapestMost, datumPlusz, percToHHMM } from './ido.js';
import { sema, torzsBetolt } from './schema.js';
import { PALETTA, szinNormal } from './szin.js';
import { TZ } from './ido.js';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/';
const IDOKORLAT = 10000; // ms egy Google-hívásra
// Google-hívás egy futásban. A Workers Free kérésenként 50 külső subrequestet enged; ugyanabban a
// kérésben a levélküldés legfeljebb 20-at használ, a token-kérés legfeljebb 2-t: 20 + 25 + 2 < 50
const ALAP_KERET = 25;
const MIN_KERET = 10;
const ALAP_ELEM = 60; // feldolgozott elem egy futásban (elemenként néhány D1-hívás; Free: 1000 belső subrequest)
const ZAR_MS = 3 * 60e3; // egy elem zárolása (egy elem legfeljebb ~8 hívás × 10 mp, a cron kérésen belül fut)
export const AUTO_MAX_PROBA = 10; // ennyi sikertelen próba után csak a kézi újraszinkron próbálja
const REGI_MS = 5 * 60e3; // a cron és az admin-megnyitás csak az ennél régebbi tételt próbálja újra

// ---------------------------------------------------------------- színek

// A Google esemény-színei (colors.get, event paletta). Élesítés előtt egy valódi colors.get-tel ellenőrizendő.
export const GOOGLE_SZINEK = Object.freeze({
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
});
const GRAFIT = '8';
const SZURKE_KROMA = 12; // ennél kisebb CIELAB-krómájú szín szürkének számít (Graphite)

function lab(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const X = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047;
  const Y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const Z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const a = 500 * (f(X) - f(Y));
  const b = 200 * (f(Y) - f(Z));
  return { C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
}

/**
 * Egy szín és egy Google-szín távolsága: az árnyalat (hue) számít, mert a kollégapaletta sötét és
 * tompa, a sima Lab-távolság szinte mindent a szürke Graphite-ra tenne. Szürke csak szürkére megy.
 */
function szinKoltseg(x, id) {
  if (id === GRAFIT) return x.C < SZURKE_KROMA ? 0 : 180;
  if (x.C < SZURKE_KROMA) return 180;
  const d = Math.abs(x.h - lab(GOOGLE_SZINEK[id]).h);
  return Math.min(d, 360 - d);
}

/**
 * A kollégapaletta egyszerre képeződik le, a legkisebb összes eltéréssel és ismétlés nélkül
 * (bitmaszkos dinamikus programozás, 10 szín × 11 Google-szín), így a tíz kollégaszín tíz különböző
 * Google-színt kap. Más szín a legközelebbi árnyalatot kapja.
 */
const PALETTA_GOOGLE = (() => {
  const ids = Object.keys(GOOGLE_SZINEK);
  const p = PALETTA.map((x) => lab(x.hex));
  const memo = new Map();
  const dp = (i, maszk) => {
    if (i === p.length) return [0, []];
    const kulcs = `${i}|${maszk}`;
    if (memo.has(kulcs)) return memo.get(kulcs);
    let legjobb = [Infinity, null];
    ids.forEach((id, j) => {
      if (maszk & (1 << j)) return;
      const [k, ut] = dp(i + 1, maszk | (1 << j));
      const ossz = k + szinKoltseg(p[i], id);
      if (ossz < legjobb[0]) legjobb = [ossz, [id, ...ut]];
    });
    memo.set(kulcs, legjobb);
    return legjobb;
  };
  const [, hozzarendeles] = dp(0, 0);
  return new Map(PALETTA.map((x, i) => [x.hex, hozzarendeles[i]]));
})();

/** A kolléga színéhez tartozó Google colorId ('1'-'11'), érvénytelen színre null. */
export function googleSzinId(hex) {
  const s = szinNormal(hex);
  if (!s) return null;
  if (PALETTA_GOOGLE.has(s)) return PALETTA_GOOGLE.get(s);
  const x = lab(s);
  let legjobb = null;
  let min = Infinity;
  for (const id of Object.keys(GOOGLE_SZINEK)) {
    const k = szinKoltseg(x, id);
    if (k < min) { min = k; legjobb = id; }
  }
  return legjobb;
}

// ---------------------------------------------------------------- azonosítók

/**
 * Determinisztikus Google esemény-azonosító: base32hex karakterek (a-v, 0-9), 5-1024 hosszú,
 * naptáranként egyedi. Az elem azonosítójának hexa alakja + a cél betűje (k: kolléga, s: stúdió).
 */
export function esemenyAzonosito(elemId, cel) {
  const hex = [...new TextEncoder().encode(String(elemId))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `f360${hex}${cel === 'studio' ? 's' : 'k'}`;
}

const FOGLALAS_RE = /^F[0-9A-Z]{10}$/;
const ORA_RE = /^S[0-9A-Z]{10}$/;

// ---------------------------------------------------------------- szolgáltatásfiók és token

const b64u = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uSzoveg = (s) => b64u(new TextEncoder().encode(s));

const KULCS_HIBA = 'A Google szolgáltatásfiók kulcsa hibás (GOOGLE_SA_KEY): a Google Cloudból letöltött teljes JSON-fájl tartalma kell.';

/** A GOOGLE_SA_KEY beolvasása. null, ha nincs beállítva; hibás kulcsnál magyar hibát dob (titok nélkül). */
export function saBetolt(env) {
  const nyers = env && env.GOOGLE_SA_KEY;
  if (nyers == null || String(nyers).trim() === '') return null;
  let k;
  try { k = JSON.parse(String(nyers)); } catch { throw new Error(KULCS_HIBA); }
  if (!k || typeof k !== 'object' || typeof k.client_email !== 'string' || typeof k.private_key !== 'string'
    || !k.private_key.includes('PRIVATE KEY') || !k.client_email.includes('@')) throw new Error(KULCS_HIBA);
  return { email: k.client_email, kid: typeof k.private_key_id === 'string' ? k.private_key_id : '', pem: k.private_key };
}

/** Be van-e kötve a szinkron (érvényes kulcs). */
export function bekotve(env) {
  try { return saBetolt(env) != null; } catch { return false; }
}

const kulcsCache = new Map(); // kid|email → CryptoKey
const tokenCache = new Map(); // kid|email → { token, lejar }

async function alairoKulcs(sa) {
  const k = `${sa.kid}|${sa.email}`;
  if (kulcsCache.has(k)) return kulcsCache.get(k);
  const b64 = sa.pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  let der;
  try {
    der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch { throw new Error(KULCS_HIBA); }
  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch { throw new Error(KULCS_HIBA); }
  kulcsCache.set(k, key);
  return key;
}

/** Hozzáférési token a szolgáltatásfiókkal (JWT bearer). A lejárat előtt 60 mp-ig újrahasznosítja. */
export async function googleToken(env, { fetchFn, most = Date.now(), friss = false, kor = null } = {}) {
  const sa = saBetolt(env);
  if (!sa) throw new Error('A Google Naptár nincs bekötve (hiányzik a GOOGLE_SA_KEY titok).');
  const ck = `${sa.kid}|${sa.email}`;
  const c = tokenCache.get(ck);
  if (!friss && c && most < c.lejar - 60e3) return c.token;
  const iat = Math.floor(most / 1000);
  const fej = { alg: 'RS256', typ: 'JWT', ...(sa.kid ? { kid: sa.kid } : {}) };
  const claim = { iss: sa.email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
  const alairando = `${b64uSzoveg(JSON.stringify(fej))}.${b64uSzoveg(JSON.stringify(claim))}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await alairoKulcs(sa), new TextEncoder().encode(alairando)));
  const f = fetchFn || globalThis.fetch;
  // a token-kérés is subrequest: a futás keretébe beleszámít
  if (kor) {
    if (kor.hasznalt >= kor.max) throw keretHiba();
    kor.hasznalt += 1;
  }
  let r;
  try {
    r = await f(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${alairando}.${b64u(sig)}` }).toString(),
      signal: AbortSignal.timeout(IDOKORLAT),
    });
  } catch (e) {
    throw atmeneti(`A Google bejelentkezés átmenetileg nem érhető el (${e && e.name === 'TimeoutError' ? 'időtúllépés' : 'hálózati hiba'}), később újrapróbáljuk.`);
  }
  let d = null;
  try { d = await r.json(); } catch { /* nem JSON */ }
  if (!r.ok || !d || typeof d.access_token !== 'string') {
    if (r.status >= 500 || r.status === 429) throw atmeneti(`A Google bejelentkezés átmenetileg nem érhető el (HTTP ${r.status}), később újrapróbáljuk.`);
    const kod = d && typeof d.error === 'string' ? d.error.replace(/[^a-z_]/gi, '').slice(0, 40) : `HTTP ${r.status}`;
    throw new Error(`A Google nem adott hozzáférést a naptárhoz (${kod}). Ellenőrizd a szolgáltatásfiók kulcsát, és hogy a Google Calendar API be van-e kapcsolva a projektben.`);
  }
  const lejar = most + (Number(d.expires_in) || 3600) * 1000;
  tokenCache.set(ck, { token: d.access_token, lejar });
  return d.access_token;
}

function atmeneti(uzenet) {
  const e = new Error(uzenet);
  e.atmeneti = true;
  return e;
}

function keretHiba() {
  const e = atmeneti('A futás hívás-kerete elfogyott, a tétel a következő futásban megy tovább.');
  e.keret = true;
  return e;
}

/** Token-hiba: a futás leáll (ugyanaz a hiba minden tételnél jönne, és mindegyik egy újabb token-kérés lenne). */
async function tokenVagyLeall(env, opts) {
  try {
    return await googleToken(env, opts);
  } catch (e) {
    if (!e.keret) e.leall = true;
    throw e;
  }
}

// ---------------------------------------------------------------- Calendar API

class GoogleHiba extends Error {
  constructor(status, uzenet) { super(uzenet); this.status = status; }
}

function hibaUzenet(status, cal, ok) {
  if (status === 404) return `A rendszer nem éri el a(z) „${cal}” naptárat. Ellenőrizd, hogy a naptár meg van-e osztva a szolgáltatásfiókkal „Események módosítása” joggal, és hogy a naptár-azonosító pontos-e.`;
  if (status === 403 && !/rate|quota|limit/i.test(ok)) return `A szolgáltatásfióknak nincs írási joga a(z) „${cal}” naptárhoz. A megosztásnál az „Események módosítása” jog kell.`;
  if (status === 400) return `A Google Naptár elutasította az eseményt a(z) „${cal}” naptárban (HTTP 400).`;
  return `A Google Naptár átmenetileg nem érhető el (HTTP ${status}), később újrapróbáljuk.`;
}

/** Egy Calendar API-hívás; 401-re egyszer új tokennel újrapróbálja. A keret minden hívást számol. */
async function hivas(env, kor, method, cal, eventId, body) {
  if (kor.hasznalt >= kor.max) throw keretHiba();
  const url = `${API}${encodeURIComponent(cal)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}?sendUpdates=none`;
  for (let proba = 0; proba < 2; proba++) {
    const token = await tokenVagyLeall(env, { friss: proba > 0, kor });
    if (kor.hasznalt >= kor.max) throw keretHiba();
    kor.hasznalt += 1;
    let r;
    try {
      r = await globalThis.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(IDOKORLAT),
      });
    } catch (e) {
      throw new GoogleHiba(0, `A Google Naptár átmenetileg nem érhető el (${e && e.name === 'TimeoutError' ? 'időtúllépés' : 'hálózati hiba'}), később újrapróbáljuk.`);
    }
    if (r.status === 401 && proba === 0 && kor.hasznalt + 2 <= kor.max) continue; // új token + ismétlés
    if (r.ok) {
      if (r.status === 204) return null;
      try { return await r.json(); } catch { return null; }
    }
    let ok = '';
    try {
      const d = await r.json();
      ok = d && d.error && Array.isArray(d.error.errors) ? d.error.errors.map((x) => x && x.reason).join(',') : '';
    } catch { /* nem JSON */ }
    throw new GoogleHiba(r.status, hibaUzenet(r.status, cal, ok));
  }
  throw new GoogleHiba(401, 'A Google nem fogadta el a hozzáférési tokent.');
}

async function torol(env, kor, cal, id) {
  try {
    await hivas(env, kor, 'DELETE', cal, id);
  } catch (e) {
    if (e instanceof GoogleHiba && (e.status === 404 || e.status === 410)) return; // már nincs ott
    throw e;
  }
}

/** Beteszi vagy frissíti az eseményt (insert → 409: patch; patch → 404: insert). */
async function beallit(env, kor, cal, esemeny, { vanTarolt }) {
  const { id, ...tobbi } = esemeny;
  if (vanTarolt) {
    try {
      await hivas(env, kor, 'PATCH', cal, id, tobbi);
      return;
    } catch (e) {
      if (!(e instanceof GoogleHiba && (e.status === 404 || e.status === 410))) throw e;
    }
  }
  try {
    await hivas(env, kor, 'POST', cal, null, esemeny);
  } catch (e) {
    if (!(e instanceof GoogleHiba && e.status === 409)) throw e;
    // a determinisztikus azonosítójú esemény már létezik (akár töröltként): patch, ami vissza is állítja
    await hivas(env, kor, 'PATCH', cal, id, tobbi);
  }
}

// ---------------------------------------------------------------- a kívánt állapot

const ido = (datum, perc) => {
  const nap = datumPlusz(datum, Math.floor(perc / 1440));
  return { dateTime: `${nap}T${percToHHMM(perc % 1440)}:00`, timeZone: TZ };
};
const adminLink = (origin, datum) => (origin ? `${String(origin).replace(/\/+$/, '')}/admin/#/foglalasok/nap/${datum}` : '');
const egysor = (s) => String(s || '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
const leiras = (sorok) => sorok.filter(Boolean).join('\n').slice(0, 8000);

function naptarak(torzs, kollegaId) {
  const koll = kollegaId ? torzs.kollegak.find((k) => k.id === kollegaId) : null;
  const kollegaNaptar = (koll && koll.naptar_id) || '';
  const studio = torzs.szabalyok.studioNaptarId || '';
  const celok = [];
  if (kollegaNaptar) celok.push({ cel: 'kollega', naptar: kollegaNaptar });
  // ha a stúdiónaptár ugyanaz, mint a kolléga naptára, egyszer kerül be
  if (studio && studio !== kollegaNaptar) celok.push({ cel: 'studio', naptar: studio });
  return { koll, celok };
}

/** Egy egyéni foglalás kívánt eseményei ({ cel, naptar, esemeny } lista; lemondott: üres). */
async function foglalasKivant(db, torzs, id, origin) {
  const row = await db.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
  if (!row || row.status !== 'megerositett') return [];
  const { koll, celok } = naptarak(torzs, row.staff_id);
  if (!celok.length) return [];
  const hely = torzs.helyszinek.find((h) => h.id === row.location_id) || { nev: row.location_id, cim: '' };
  const szolg = torzs.szolgaltatasok.find((s) => s.id === row.service_id) || { nev: row.service_id };
  const colorId = koll ? googleSzinId(koll.szin) : null;
  const alap = {
    summary: `${egysor(szolg.nev)} · ${egysor(row.name)}`,
    start: ido(row.date, row.start_min),
    end: ido(row.date, row.start_min + row.dur_min),
    location: hely.cim || hely.nev || '',
    description: leiras([
      `Szakember: ${egysor(koll ? koll.nev : row.staff_id)}`,
      `Helyszín: ${egysor(hely.nev)}`,
      row.phone ? `Telefon: ${egysor(row.phone)}` : '',
      row.note ? `Megjegyzés: ${row.note}` : '',
      `Foglalás azonosító: ${row.id}`,
      adminLink(origin, row.date) ? `Admin: ${adminLink(origin, row.date)}` : '',
    ]),
    ...(colorId ? { colorId } : {}),
    status: 'confirmed',
    extendedProperties: { private: { f360Foglalas: row.id } },
  };
  return celok.map((c) => ({ ...c, esemeny: { id: esemenyAzonosito(row.id, c.cel), ...alap } }));
}

/** Egy csoportos óra kívánt eseményei: egy esemény óránként, a résztvevők listájával (üres vagy elmaradt: nincs). */
async function oraKivant(db, torzs, id, origin) {
  const s = await db.prepare(
    `SELECT s.*, t.nev AS ora_nev, t.helyszin_id FROM class_sessions s JOIN class_types t ON t.id = s.class_type_id WHERE s.id = ?`,
  ).bind(id).first();
  if (!s || s.status !== 'aktiv') return [];
  const { results } = await db.prepare(
    `SELECT nev, telefon FROM class_bookings WHERE session_id = ? AND status = 'megerositett' ORDER BY created_at, id`,
  ).bind(id).all();
  const resztvevok = results || [];
  if (!resztvevok.length) return [];
  const { koll, celok } = naptarak(torzs, s.kollega_id);
  if (!celok.length) return [];
  const hely = torzs.helyszinek.find((h) => h.id === s.helyszin_id) || { nev: s.helyszin_id, cim: '' };
  const colorId = koll ? googleSzinId(koll.szin) : null;
  const alap = {
    summary: `${egysor(s.ora_nev)} · ${resztvevok.length}/${s.kapacitas} fő`,
    start: ido(s.datum, s.kezd_min),
    end: ido(s.datum, s.kezd_min + s.perc),
    location: hely.cim || hely.nev || '',
    description: leiras([
      `Csoportos óra: ${egysor(s.ora_nev)}`,
      `Oktató: ${koll ? egysor(koll.nev) : 'még nincs megadva'}`,
      `Létszám: ${resztvevok.length}/${s.kapacitas}`,
      'Résztvevők:',
      ...resztvevok.map((r, i) => `${i + 1}. ${egysor(r.nev)}${r.telefon ? `, ${egysor(r.telefon)}` : ''}`),
      `Óra azonosító: ${s.id}`,
      adminLink(origin, s.datum) ? `Admin: ${adminLink(origin, s.datum)}` : '',
    ]),
    ...(colorId ? { colorId } : {}),
    status: 'confirmed',
    extendedProperties: { private: { f360Ora: s.id } },
  };
  return celok.map((c) => ({ ...c, esemeny: { id: esemenyAzonosito(s.id, c.cel), ...alap } }));
}

/** Egy elem egyeztetése a Google-lel. Minden célt megpróbál; az első hibát a végén dobja. */
async function egyeztet(env, db, torzs, elemId, kor, origin) {
  const kivant = FOGLALAS_RE.test(elemId) ? await foglalasKivant(db, torzs, elemId, origin)
    : ORA_RE.test(elemId) ? await oraKivant(db, torzs, elemId, origin) : [];
  const { results } = await db.prepare(`SELECT cel, naptar_id, esemeny_id FROM gcal_esemeny WHERE elem_id = ?`).bind(elemId).all();
  const tarolt = results || [];
  let elsoHiba = null;
  const hibat = (e) => {
    if (e && (e.leall || e.keret)) throw e; // token-hiba vagy elfogyott keret: a tétel egészében vár
    elsoHiba = elsoHiba || e;
  };
  // 1. a kívánt események (előbb a kolléga, utána a stúdió), egymástól függetlenül
  for (const k of kivant) {
    const t = tarolt.find((x) => x.cel === k.cel && x.naptar_id === k.naptar);
    try {
      await beallit(env, kor, k.naptar, k.esemeny, { vanTarolt: !!t });
      await db.prepare(`INSERT INTO gcal_esemeny (elem_id, cel, naptar_id, esemeny_id, frissitve) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(elem_id, cel, naptar_id) DO UPDATE SET esemeny_id = excluded.esemeny_id, frissitve = excluded.frissitve`)
        .bind(elemId, k.cel, k.naptar, k.esemeny.id, Date.now()).run();
    } catch (e) {
      hibat(e);
    }
  }
  // 2. a már nem kívánt (lemondott, áthelyezett, más naptárba került) események törlése; ha egy régi
  // naptárból tartósan nem törölhető, az új naptárat ez már nem akadályozza, a sor újrapróbálja
  for (const t of tarolt) {
    if (kivant.some((k) => k.cel === t.cel && k.naptar === t.naptar_id)) continue;
    try {
      await torol(env, kor, t.naptar_id, t.esemeny_id);
      await db.prepare(`DELETE FROM gcal_esemeny WHERE elem_id = ? AND cel = ? AND naptar_id = ?`).bind(elemId, t.cel, t.naptar_id).run();
    } catch (e) {
      hibat(e);
    }
  }
  if (elsoHiba) throw elsoHiba;
}

// ---------------------------------------------------------------- sor és futás

async function sorba(db, ids, most) {
  const egyedi = [...new Set(ids.filter((x) => FOGLALAS_RE.test(x) || ORA_RE.test(x)))];
  for (let i = 0; i < egyedi.length; i += 50) {
    await db.batch(egyedi.slice(i, i + 50).map((id) => db.prepare(
      `INSERT INTO gcal_sor (elem_id, verzio, probalkozas, letrehozva, frissitve) VALUES (?, 1, 0, ?, ?)
       ON CONFLICT(elem_id) DO UPDATE SET verzio = verzio + 1, probalkozas = 0`,
    ).bind(id, most, most)));
  }
  return egyedi;
}

/** A jövőbeli elemek (szűrhető kollégára vagy óratípusra), plusz minden már naptárban lévő elem. */
async function jovobeliElemek(db, { kollega = null, tipus = null } = {}) {
  const ma = budapestMost().datum;
  const ki = [];
  if (!tipus) {
    const { results } = await db.prepare(`SELECT id FROM bookings WHERE status = 'megerositett' AND date >= ? ${kollega ? 'AND staff_id = ?' : ''} ORDER BY date, start_min LIMIT 2000`)
      .bind(...[ma, ...(kollega ? [kollega] : [])]).all();
    ki.push(...(results || []).map((r) => r.id));
  }
  const felt = ['s.datum >= ?'];
  const args = [ma];
  if (kollega) { felt.push('s.kollega_id = ?'); args.push(kollega); }
  if (tipus) { felt.push('s.class_type_id = ?'); args.push(tipus); }
  const { results: orak } = await db.prepare(
    `SELECT DISTINCT s.id FROM class_sessions s JOIN class_bookings b ON b.session_id = s.id AND b.status = 'megerositett' WHERE ${felt.join(' AND ')} LIMIT 2000`,
  ).bind(...args).all();
  ki.push(...(orak || []).map((r) => r.id));
  if (!kollega && !tipus) {
    const { results: t } = await db.prepare(`SELECT DISTINCT elem_id FROM gcal_esemeny LIMIT 5000`).all();
    ki.push(...(t || []).map((r) => r.elem_id));
  }
  return ki;
}

/** Egy elem feldolgozása zárolással; 'ok' | 'hiba' | 'kihagyva'. A közben érkezett változás (verzió) újrafut. */
async function feldolgoz(env, db, torzs, elemId, kor, origin, most) {
  for (let kor2 = 0; kor2 < 3; kor2++) {
    const verzio = await db.prepare(
      `UPDATE gcal_sor SET zarolva_at = ? WHERE elem_id = ? AND (zarolva_at IS NULL OR zarolva_at < ?) RETURNING verzio`,
    ).bind(Date.now(), elemId, Date.now() - ZAR_MS).first('verzio');
    if (verzio == null) return 'kihagyva';
    try {
      await egyeztet(env, db, torzs, elemId, kor, origin);
    } catch (e) {
      // a keret elfogyott: nem hiba, a tétel a következő futásban folytatódik (nem számít próbálkozásnak)
      if (e && e.keret) {
        await db.prepare(`UPDATE gcal_sor SET zarolva_at = NULL WHERE elem_id = ?`).bind(elemId).run();
        return 'keret';
      }
      const uzenet = String((e && e.message) || 'Ismeretlen hiba a Google Naptár hívásakor.').slice(0, 500);
      await db.prepare(`UPDATE gcal_sor SET probalkozas = probalkozas + 1, hiba = ?, zarolva_at = NULL, frissitve = ? WHERE elem_id = ?`)
        .bind(uzenet, most, elemId).run();
      if (!(e instanceof GoogleHiba) && !e.atmeneti && !e.leall) console.error('[naptar] váratlan hiba:', uzenet);
      return e && e.leall ? 'leall' : 'hiba';
    }
    const r = await db.prepare(`DELETE FROM gcal_sor WHERE elem_id = ? AND verzio = ?`).bind(elemId, verzio).run();
    if (Number(r.meta && r.meta.changes)) return 'ok';
    // közben új változás jött (a verzió nőtt): újra egyeztetjük a friss állapottal
    await db.prepare(`UPDATE gcal_sor SET zarolva_at = NULL WHERE elem_id = ?`).bind(elemId).run();
    torzs = await torzsBetolt(db);
  }
  return 'kihagyva'; // háromszor is változott közben: a sorban marad, a következő futás viszi
}

/**
 * Egy szinkron-futás. `ids`: ezek az elemek (sorba téve, majd feldolgozva); `szurok`: a jövőbeli
 * elemek tömeges sorba tétele ({ mind } | { kollega } | { tipus }); `sorbol`: a várakozó sor
 * (`csakRegi`: csak az 5 percnél régebbi tételek). Kulcs nélkül no-op.
 */
/**
 * Az ugyanabból a sablonból jövő, jövőbeli, résztvevős órák (a sablon oktatócseréje mindet átírja).
 */
async function sablonElemek(db, sablon) {
  const { results } = await db.prepare(
    `SELECT DISTINCT s.id FROM class_sessions s JOIN class_bookings b ON b.session_id = s.id AND b.status = 'megerositett' WHERE s.template_id = ? AND s.datum >= ? LIMIT 500`,
  ).bind(sablon, budapestMost().datum).all();
  return (results || []).map((r) => r.id);
}

export async function naptarSzinkron(env, db, { ids = [], szurok = [], sorbol = false, csakRegi = false, origin = '', most = Date.now() } = {}) {
  if (!bekotve(env)) return { bekotve: false, sikeres: 0, hibas: 0, maradt: 0 };
  await sema(db);
  // legalább MIN_KERET: egy tétel legrosszabb esetben 1 token + 8 hívás, ennél kisebb kerettel beragadna
  const kor = { hasznalt: 0, max: Math.max(MIN_KERET, Number(env.GCAL_MAX_HIVAS) || ALAP_KERET) };
  const maxElem = Math.max(1, Number(env.GCAL_MAX_ELEM) || ALAP_ELEM);
  const lista = await sorba(db, ids, most);
  for (const sz of szurok) lista.push(...await sorba(db, sz.sablon ? await sablonElemek(db, sz.sablon) : await jovobeliElemek(db, sz.mind ? {} : sz), most));
  if (sorbol) {
    const { results } = await db.prepare(
      `SELECT elem_id FROM gcal_sor ${csakRegi ? 'WHERE frissitve < ? AND probalkozas < ?' : ''} ORDER BY frissitve, letrehozva LIMIT 500`,
    ).bind(...(csakRegi ? [most - REGI_MS, AUTO_MAX_PROBA] : [])).all();
    lista.push(...(results || []).map((r) => r.elem_id));
  }
  const torzs = await torzsBetolt(db);
  let sikeres = 0;
  let hibas = 0;
  const kesz = new Set();
  for (const id of lista) {
    if (kesz.has(id)) continue;
    kesz.add(id);
    if (kor.hasznalt >= kor.max || kesz.size > maxElem) break;
    const e = await feldolgoz(env, db, torzs, id, kor, origin, most);
    if (e === 'ok') sikeres += 1;
    else if (e === 'hiba') hibas += 1;
    else if (e === 'leall') { hibas += 1; break; }
    else if (e === 'keret') break;
  }
  const maradt = Number(await db.prepare(`SELECT COUNT(*) AS n FROM gcal_sor`).first('n')) || 0;
  return { bekotve: true, sikeres, hibas, maradt };
}

/**
 * A háttér-szinkron indítása egy sikeres módosítás után (ctx.waitUntil), a választ nem lassítja.
 * `elemek`: elem-azonosítók (string) és szűrők ({ mind } | { kollega } | { tipus } | { sablon }) vegyesen.
 */
export function naptarHatter(context, env, db, elemek, { origin = '' } = {}) {
  if (!db || !elemek || !elemek.length || typeof context.waitUntil !== 'function' || !bekotve(env)) return;
  const ids = elemek.filter((x) => typeof x === 'string');
  const szurok = elemek.filter((x) => x && typeof x === 'object');
  context.waitUntil(naptarSzinkron(env, db, { ids, szurok, origin: env.PUBLIC_ORIGIN || origin })
    .catch((e) => console.error('[naptar] háttér-szinkron hiba:', e && e.message)));
}

/** Az elakadt tételek újrapróbálása a háttérben (admin-megnyitás). */
export function naptarHatterUjra(context, env, db, { origin = '' } = {}) {
  if (!db || typeof context.waitUntil !== 'function' || !bekotve(env)) return;
  context.waitUntil(naptarSzinkron(env, db, { sorbol: true, csakRegi: true, origin: env.PUBLIC_ORIGIN || origin })
    .catch((e) => console.error('[naptar] újrapróbálás hiba:', e && e.message)));
}

// ---------------------------------------------------------------- admin API

/** GET /api/foglalo/naptar/allapot: be van-e kötve, a naptárak, és a sor állapota (titok soha). */
export async function naptarAllapot(env, db) {
  await sema(db);
  let sa = null;
  let kulcsHiba = null;
  try { sa = saBetolt(env); } catch (e) { kulcsHiba = e.message; }
  const torzs = await torzsBetolt(db);
  const varakozik = Number(await db.prepare(`SELECT COUNT(*) AS n FROM gcal_sor`).first('n')) || 0;
  const elakadt = Number(await db.prepare(`SELECT COUNT(*) AS n FROM gcal_sor WHERE probalkozas > 0`).first('n')) || 0;
  const h = await db.prepare(`SELECT elem_id, hiba, probalkozas, frissitve FROM gcal_sor WHERE hiba IS NOT NULL ORDER BY frissitve DESC LIMIT 1`).first();
  return {
    bekotve: !!sa,
    kulcsHiba,
    szolgaltatasFiok: sa ? sa.email : null,
    studioNaptarId: torzs.szabalyok.studioNaptarId || '',
    kollegak: torzs.kollegak.filter((k) => k.archivalt !== true).map((k) => ({ id: k.id, nev: k.nev, szin: k.szin, naptar_id: k.naptar_id || '' })),
    varakozik,
    elakadt,
    utolsoHiba: h ? { azonosito: h.elem_id, uzenet: h.hiba, probalkozas: h.probalkozas, ido: new Date(h.frissitve).toISOString() } : null,
  };
}

/** POST /api/foglalo/naptar/ujraszinkron { mind?: boolean }: a sor (és mind: minden jövőbeli elem) újraszinkronja. */
export async function naptarUjraszinkron(env, db, d = {}, { origin = '' } = {}) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'Hibás kérés.');
  for (const k of Object.keys(d)) if (k !== 'mind') throw new HttpError(400, `Ismeretlen mező: ${k}.`);
  if ('mind' in d && typeof d.mind !== 'boolean') throw new HttpError(400, 'Hibás mező: mind (true vagy false).');
  let sa = null;
  try { sa = saBetolt(env); } catch (e) { throw new HttpError(409, `A Google Naptár nincs bekötve: ${e.message}`); }
  if (!sa) throw new HttpError(409, 'A Google Naptár nincs bekötve (hiányzik a GOOGLE_SA_KEY titok).');
  return naptarSzinkron(env, db, { szurok: d.mind ? [{ mind: true }] : [], sorbol: true, origin: env.PUBLIC_ORIGIN || origin });
}

/**
 * A törzsadat változásából: mely elemeket kell újraszinkronizálni. A stúdiónaptár, egy helyszín vagy
 * egy szolgáltatás változása mindent érint ({ mind: true }); egy kolléga neve, színe vagy naptára
 * csak az ő elemeit ({ kollega }). Ha a naptárat érintő adat nem változott, üres lista.
 */
export function naptarValtozas(regi, uj) {
  const kozos = (t) => JSON.stringify([
    t.szabalyok.studioNaptarId || '',
    t.helyszinek.map((h) => [h.id, h.nev, h.cim]),
    t.szolgaltatasok.map((s) => [s.id, s.nev]),
  ]);
  if (kozos(regi) !== kozos(uj)) return [{ mind: true }];
  const k = (t) => new Map(t.kollegak.map((x) => [x.id, JSON.stringify([x.nev, x.szin, x.naptar_id || ''])]));
  const r = k(regi);
  const u = k(uj);
  return [...new Set([...r.keys(), ...u.keys()])].filter((id) => r.get(id) !== u.get(id)).map((id) => ({ kollega: id }));
}
