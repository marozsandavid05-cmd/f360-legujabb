// Időpontfoglaló · Google Naptár szinkron (szolgáltatásfiók, JWT RS256, insert/patch/delete,
// kolléga-csere, colorId, várakozó sor, újraszinkron, kulcs nélkül no-op). Valódi Google-hívás
// nincs: a fetch egy kis Google-utánzat, a kulcs a tesztben generált RSA-kulcs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, foglalj, get, keres, kovNap, NAP, post, sorok, TESZT_NEV, tokenBol, ujEnv, kollegaAtir, szabalyAtir } from './_foglalo.mjs';
import { googleSzinId, googleToken, esemenyAzonosito, TOKEN_URL, SCOPE } from '../functions/_lib/booking/naptar.js';
import { datumPlusz } from '../functions/_lib/booking/ido.js';
import { PALETTA } from '../functions/_lib/booking/szin.js';

// ---------------------------------------------------------------- segédek

const b64u = (buf) => Buffer.from(buf).toString('base64url');
let kulcsPar = null;
async function kulcsok() {
  if (!kulcsPar) {
    kulcsPar = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
    );
  }
  return kulcsPar;
}
let kidSzamlalo = 0;
/** Egy szolgáltatásfiók-kulcs JSON-ja (mint amit a Google Cloud letöltet), egyedi kid-del. */
async function saKulcs() {
  const { privateKey } = await kulcsok();
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  kidSzamlalo += 1;
  return JSON.stringify({
    type: 'service_account', project_id: 'f360-teszt', private_key_id: `kid${kidSzamlalo}${Date.now()}`,
    private_key: pem, client_email: `f360-naptar-${kidSzamlalo}@f360-teszt.iam.gserviceaccount.com`, token_uri: TOKEN_URL,
  });
}

const API = 'https://www.googleapis.com/calendar/v3/calendars/';

/**
 * Google-utánzat: token-végpont + Calendar events insert/patch/delete. Az eseményeket naptáranként
 * tárolja, a törölt esemény 'cancelled' marad (mint a valódi Google: újra-insert 409, újra-delete 410).
 */
function googleUtanzat({ hiba = null } = {}) {
  const g = { hivasok: [], tokenHivas: 0, esemenyek: new Map(), hiba, tartas: null };
  g.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u === TOKEN_URL) {
      g.tokenHivas += 1;
      const p = new URLSearchParams(String(init.body));
      g.utolsoAssertion = p.get('assertion');
      g.utolsoGrant = p.get('grant_type');
      return new Response(JSON.stringify({ access_token: `tok-${g.tokenHivas}`, expires_in: 3599, token_type: 'Bearer' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!u.startsWith(API)) throw new Error(`váratlan URL: ${u}`);
    if (g.tartas) await g.tartas;
    const [calPart, , evPart] = u.slice(API.length).split('?')[0].split('/');
    const cal = decodeURIComponent(calPart);
    const body = init.body ? JSON.parse(init.body) : null;
    g.hivasok.push({ method, cal, eventId: evPart ? decodeURIComponent(evPart) : null, body, auth: init.headers && init.headers.Authorization, url: u });
    if (g.hiba) {
      const h = typeof g.hiba === 'function' ? g.hiba({ method, cal, body }) : g.hiba;
      if (h) return new Response(JSON.stringify({ error: { code: h, message: `Teszt hiba ${h}` } }), { status: h, headers: { 'Content-Type': 'application/json' } });
    }
    const kulcs = (id) => `${cal}|${id}`;
    if (method === 'POST') {
      if (g.esemenyek.has(kulcs(body.id))) return new Response(JSON.stringify({ error: { code: 409, message: 'The requested identifier already exists.' } }), { status: 409 });
      g.esemenyek.set(kulcs(body.id), { ...body, status: 'confirmed' });
      return new Response(JSON.stringify({ ...body, status: 'confirmed' }), { status: 200 });
    }
    const id = decodeURIComponent(evPart);
    const e = g.esemenyek.get(kulcs(id));
    if (method === 'PATCH') {
      if (!e) return new Response(JSON.stringify({ error: { code: 404, message: 'Not Found' } }), { status: 404 });
      Object.assign(e, body);
      return new Response(JSON.stringify(e), { status: 200 });
    }
    if (method === 'DELETE') {
      if (!e) return new Response(JSON.stringify({ error: { code: 404, message: 'Not Found' } }), { status: 404 });
      if (e.status === 'cancelled') return new Response(JSON.stringify({ error: { code: 410, message: 'Resource has been deleted' } }), { status: 410 });
      e.status = 'cancelled';
      return new Response(null, { status: 204 });
    }
    throw new Error(`váratlan metódus: ${method}`);
  };
  g.aktiv = (cal) => [...g.esemenyek.entries()].filter(([k, e]) => k.startsWith(`${cal}|`) && e.status !== 'cancelled').map(([, e]) => e);
  return g;
}

/** A globális fetch cseréje a teszt idejére. */
async function fetchCsere(g, fn) {
  const eredeti = globalThis.fetch;
  globalThis.fetch = g.fetch;
  try { return await fn(); } finally { globalThis.fetch = eredeti; }
}

const KOLLEGA_NAPTAR = 'szegedi.botond@example.com';
const MASIK_NAPTAR = 'adorjani.teszt@group.calendar.google.com';
const STUDIO_NAPTAR = 'f360.studio@group.calendar.google.com';

async function bekotottEnv({ kollegaNaptar = KOLLEGA_NAPTAR, studio = STUDIO_NAPTAR } = {}) {
  const env = ujEnv({ GOOGLE_SA_KEY: await saKulcs() });
  await kollegaAtir(env, 'szegedi-botond', { naptar_id: kollegaNaptar });
  await szabalyAtir(env, { studioNaptarId: studio });
  return env;
}

function hatter() {
  const v = [];
  return { waitUntil: (p) => v.push(p), varj: async () => { while (v.length) await v.shift(); } };
}

async function foglalHatterrel(env, o = {}) {
  const h = hatter();
  const r = await post(env, '/foglalas-api/foglalas', alap(o), { waitUntil: h.waitUntil });
  assert.equal(r.status, 201, await r.clone().text());
  const d = await r.json();
  await h.varj();
  return { ...d, t: new URL(d.lemondasUrl).searchParams.get('t') };
}

// ---------------------------------------------------------------- színek

test('googleSzinId: a kollégapaletta minden színe a hozzá legközelebbi árnyalatú Google-színt kapja', () => {
  // a palettát egyszerre képezzük le (a legkisebb összes árnyalat-eltéréssel, ismétlés nélkül), így a
  // tíz kollégaszín tíz különböző Google-színt kap; a mokka (szinte szürke) a Graphite
  const vart = {
    '#4f6d8a': '7', '#a0553c': '11', '#5b7d55': '10', '#7d5a8e': '3', '#8c6b2a': '6',
    '#2f6e6e': '2', '#94485e': '4', '#5a5f30': '5', '#3b4580': '9', '#5e4b44': '8',
  };
  for (const { hex } of PALETTA) assert.equal(googleSzinId(hex), vart[hex], hex);
  assert.equal(new Set(PALETTA.map((p) => googleSzinId(p.hex))).size, PALETTA.length);
  // nagybetűvel is
  assert.equal(googleSzinId('#5B7D55'), '10');
});

test('googleSzinId: a Google saját színei önmagukra képeződnek, szürke a Graphite, hibás szín null', () => {
  const G = { 1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e', 7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000' };
  for (const [id, hex] of Object.entries(G)) assert.equal(googleSzinId(hex), id, hex);
  assert.equal(googleSzinId('#777777'), '8');
  // palettán kívüli szín: a legközelebbi árnyalat (élénkzöld → Basil vagy Sage, nem Graphite)
  assert.ok(['2', '10'].includes(googleSzinId('#2e7d32')));
  assert.equal(googleSzinId('nem szín'), null);
  assert.equal(googleSzinId(undefined), null);
});

test('esemenyAzonosito: base32hex karakterek (a-v, 0-9), 5 és 1024 között, céltól függ', () => {
  const a = esemenyAzonosito('F0123456789', 'kollega');
  const b = esemenyAzonosito('F0123456789', 'studio');
  assert.match(a, /^[a-v0-9]{5,1024}$/);
  assert.match(b, /^[a-v0-9]{5,1024}$/);
  assert.notEqual(a, b);
  assert.equal(a, esemenyAzonosito('F0123456789', 'kollega'));
});

// ---------------------------------------------------------------- JWT és token

test('googleToken: RS256-tal aláírt JWT, a Google által előírt mezőkkel, és az aláírás ellenőrizhető', async () => {
  const kulcs = await saKulcs();
  const g = googleUtanzat();
  const most = Date.UTC(2026, 9, 1, 10, 0, 0);
  const token = await googleToken({ GOOGLE_SA_KEY: kulcs }, { fetchFn: g.fetch, most });
  assert.equal(token, 'tok-1');
  assert.equal(g.utolsoGrant, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, c, s] = g.utolsoAssertion.split('.');
  const fej = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
  const sa = JSON.parse(kulcs);
  assert.deepEqual(fej, { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id });
  assert.equal(claim.iss, sa.client_email);
  assert.equal(claim.scope, SCOPE);
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(claim.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claim.iat, most / 1000);
  assert.equal(claim.exp, most / 1000 + 3600);
  const { publicKey } = await kulcsok();
  const jo = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(jo, true);
  assert.match(s, /^[A-Za-z0-9_-]+$/); // base64url, kitöltés nélkül
  assert.equal(b64u(Buffer.from('x')), 'eA');
});

test('googleToken: a tokent a lejárat előtt újrahasznosítja, utána újat kér', async () => {
  const env = { GOOGLE_SA_KEY: await saKulcs() };
  const g = googleUtanzat();
  const t0 = Date.UTC(2026, 9, 1, 10, 0, 0);
  assert.equal(await googleToken(env, { fetchFn: g.fetch, most: t0 }), 'tok-1');
  assert.equal(await googleToken(env, { fetchFn: g.fetch, most: t0 + 30 * 60e3 }), 'tok-1');
  assert.equal(g.tokenHivas, 1);
  // a lejárat (3599 mp) előtti utolsó percben már újat kér
  assert.equal(await googleToken(env, { fetchFn: g.fetch, most: t0 + 3570e3 }), 'tok-2');
  assert.equal(g.tokenHivas, 2);
});

test('googleToken: hibás kulcs vagy hibás token-válasz magyar hibát ad, titok nélkül', async () => {
  await assert.rejects(googleToken({ GOOGLE_SA_KEY: 'nem json' }, { fetchFn: async () => { throw new Error('nem hívható'); } }), /szolgáltatásfiók kulcsa hibás/);
  const kulcs = await saKulcs();
  const rossz = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 });
  await assert.rejects(googleToken({ GOOGLE_SA_KEY: kulcs }, { fetchFn: rossz }), (e) => {
    assert.match(e.message, /Google nem adott hozzáférést/);
    assert.ok(!e.message.includes('PRIVATE KEY'));
    return true;
  });
});

// ---------------------------------------------------------------- kulcs nélkül

test('GOOGLE_SA_KEY nélkül: a foglalás ugyanúgy megy, Google-hívás és várakozó tétel nincs', async () => {
  const env = ujEnv();
  await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const h = hatter();
    const r = await post(env, '/foglalas-api/foglalas', alap(), { waitUntil: h.waitUntil });
    assert.equal(r.status, 201);
    await h.varj();
  });
  assert.equal(g.tokenHivas, 0);
  assert.equal(g.hivasok.length, 0);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
  const a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.equal(a.bekotve, false);
  assert.equal(a.elakadt, 0);
});

// ---------------------------------------------------------------- életciklus

test('új foglalás: esemény a kolléga és a stúdió naptárába, a kolléga színével, budapesti idővel', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  const f = await fetchCsere(g, () => foglalHatterrel(env, { telefon: '+36 30 123 4567', megjegyzes: 'Bal váll' }));
  const inserts = g.hivasok.filter((h) => h.method === 'POST');
  assert.deepEqual(inserts.map((h) => h.cal).sort(), [KOLLEGA_NAPTAR, STUDIO_NAPTAR].sort());
  for (const h of inserts) {
    const e = h.body;
    assert.equal(e.summary, `Gyógymasszázs · ${TESZT_NEV}`);
    assert.deepEqual(e.start, { dateTime: `${NAP}T10:00:00`, timeZone: 'Europe/Budapest' });
    assert.deepEqual(e.end, { dateTime: `${NAP}T10:50:00`, timeZone: 'Europe/Budapest' });
    assert.equal(e.location, 'Mexikói út 32/b, XIV. kerület');
    assert.equal(e.colorId, '10'); // Szegedi Botond: #5b7d55 zsályazöld → Basil
    assert.match(e.description, /\+36 30 123 4567/);
    assert.match(e.description, /Bal váll/);
    assert.ok(e.description.includes(f.azonosito));
    assert.ok(e.description.includes(`/admin/#/foglalasok/nap/${NAP}`));
    assert.match(e.description, /Szegedi Botond/);
    assert.ok(!e.description.includes('david.teszt@example.com'), 'a páciens e-mail-címe nem kerül a naptárba');
    assert.ok(!e.description.includes('lemondas?t='), 'a lemondó token nem kerül a naptárba');
    // a láthatóság a naptár megosztását követi: a „private” esemény a csak részleteket látó kollégának
    // foglalt blokk lenne, és bizonyos írási jog mellett a szolgáltatásfiók sem módosíthatná
    assert.equal(e.visibility, undefined);
    assert.equal(e.extendedProperties.private.f360Foglalas, f.azonosito);
    assert.match(e.id, /^[a-v0-9]{5,1024}$/);
    assert.match(h.auth, /^Bearer tok-\d+$/);
    assert.match(h.url, /sendUpdates=none/);
  }
  const t = sorok(env, `SELECT cel, naptar_id FROM gcal_esemeny WHERE elem_id = ? ORDER BY cel`, f.azonosito);
  assert.deepEqual(t.map((x) => [x.cel, x.naptar_id]), [['kollega', KOLLEGA_NAPTAR], ['studio', STUDIO_NAPTAR]]);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
});

test('kolléga naptár nélkül: csak a stúdiónaptárba megy; egyik sincs beállítva: nincs hívás', async () => {
  const env = await bekotottEnv({ kollegaNaptar: '' });
  const g = googleUtanzat();
  await fetchCsere(g, () => foglalHatterrel(env));
  assert.deepEqual(g.hivasok.filter((h) => h.method === 'POST').map((h) => h.cal), [STUDIO_NAPTAR]);

  const env2 = await bekotottEnv({ kollegaNaptar: '', studio: '' });
  const g2 = googleUtanzat();
  await fetchCsere(g2, () => foglalHatterrel(env2));
  assert.equal(g2.hivasok.length, 0);
  assert.equal(sorok(env2, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
});

test('módosítás ugyanannál a kollégánál: patch mindkét naptárban az új időponttal', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const f = await foglalHatterrel(env);
    g.hivasok.length = 0;
    const h = hatter();
    const r = await post(env, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '13:00', kollega: 'szegedi-botond' }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200, await r.clone().text());
    await h.varj();
  });
  assert.deepEqual(g.hivasok.map((h) => h.method), ['PATCH', 'PATCH']);
  for (const h of g.hivasok) assert.deepEqual(h.body.start, { dateTime: `${NAP}T13:00:00`, timeZone: 'Europe/Budapest' });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
});

test('kolléga-csere (admin áthelyezés): a régi kolléga naptárából törlődik, az újéba bekerül, a stúdióban színt vált', async () => {
  const env = await bekotottEnv();
  // a seedben a Mexikóiban csak Szegedi Botond végez gyógymasszázst, ezért kell egy második
  // (teszt) kolléga saját naptárral és beosztással
  const uj = await admin(env, 'POST', '/api/foglalo/kollegak', {
    nev: TESZT_NEV, helyszinek: ['mexikoi'], szolgaltatasok: ['gyogymasszazs-50'], szin: '#3b4580', naptar_id: MASIK_NAPTAR,
  });
  assert.equal(uj.status, 201, await uj.clone().text());
  const kid = (await uj.json()).id;
  const bo = await admin(env, 'PUT', `/api/foglalo/beosztas?kollega=${kid}`, { sorok: [1, 2, 3, 4, 5].map((nap) => ({ nap, helyszin: 'mexikoi', kezd: '09:00', veg: '17:00' })) });
  assert.equal(bo.status, 200);
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const f = await foglalHatterrel(env);
    g.hivasok.length = 0;
    const h = hatter();
    const r = await admin(env, 'PATCH', `/api/foglalo/foglalasok/${f.azonosito}`, { datum: NAP, kezd: '11:00', kollega: kid }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200, await r.clone().text());
    await h.varj();
  });
  const m = g.hivasok.map((h) => `${h.method} ${h.cal}`).sort();
  assert.deepEqual(m, [`DELETE ${KOLLEGA_NAPTAR}`, `PATCH ${STUDIO_NAPTAR}`, `POST ${MASIK_NAPTAR}`].sort());
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 0);
  assert.equal(g.aktiv(MASIK_NAPTAR).length, 1);
  assert.equal(g.aktiv(MASIK_NAPTAR)[0].colorId, '9'); // indigó → Blueberry
  assert.equal(g.aktiv(STUDIO_NAPTAR)[0].colorId, '9');
});

test('lemondás (páciens és admin): az esemény mindkét naptárból törlődik', async () => {
  for (const ki of ['paciens', 'admin']) {
    const env = await bekotottEnv();
    const g = googleUtanzat();
    await fetchCsere(g, async () => {
      const f = await foglalHatterrel(env);
      const h = hatter();
      const r = ki === 'paciens'
        ? await post(env, '/foglalas-api/lemondas', { t: f.t }, { waitUntil: h.waitUntil })
        : await admin(env, 'POST', `/api/foglalo/foglalasok/${f.azonosito}/lemondas`, undefined, { waitUntil: h.waitUntil });
      assert.equal(r.status, 200, await r.clone().text());
      await h.varj();
      assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_esemeny WHERE elem_id = ?`, f.azonosito)[0].n, 0);
    });
    assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 0, ki);
    assert.equal(g.aktiv(STUDIO_NAPTAR).length, 0, ki);
    assert.equal(g.hivasok.filter((h) => h.method === 'DELETE').length, 2, ki);
  }
});

test('admin kézi felvétel is bekerül a naptárba', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const h = hatter();
    const r = await admin(env, 'POST', '/api/foglalo/foglalasok', { ...alap(), email: '', telefon: '' }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 201, await r.clone().text());
    await h.varj();
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
});

// ---------------------------------------------------------------- megbízhatóság

test('a foglalás nem vár a Google-re: a válasz kész, mielőtt a naptár-hívás lefutna', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  let enged;
  g.tartas = new Promise((r) => { enged = r; });
  await fetchCsere(g, async () => {
    const h = hatter();
    const r = await post(env, '/foglalas-api/foglalas', alap(), { waitUntil: h.waitUntil });
    assert.equal(r.status, 201);
    assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 0, 'a válaszkor még nincs esemény');
    enged();
    await h.varj();
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
});

test('Google-hiba: a foglalás sikeres, a tétel a várakozó sorba kerül; az újraszinkron utána beteszi', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat({ hiba: 503 });
  let f;
  await fetchCsere(g, async () => {
    f = await foglalHatterrel(env);
    assert.ok(f.azonosito);
  });
  const sor = sorok(env, `SELECT * FROM gcal_sor`);
  assert.equal(sor.length, 1);
  assert.equal(sor[0].elem_id, f.azonosito);
  assert.equal(sor[0].probalkozas, 1);
  assert.match(sor[0].hiba, /Google Naptár/);
  assert.equal(sor[0].zarolva_at, null);
  const a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.equal(a.bekotve, true);
  assert.equal(a.elakadt, 1);
  assert.match(a.utolsoHiba.uzenet, /átmenetileg nem érhető el/);
  assert.equal(a.utolsoHiba.azonosito, f.azonosito);
  assert.match(a.szolgaltatasFiok, /@f360-teszt\.iam\.gserviceaccount\.com$/);

  g.hiba = null;
  await fetchCsere(g, async () => {
    const r = await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', {});
    assert.equal(r.status, 200, await r.clone().text());
    const d = await r.json();
    assert.equal(d.sikeres, 1);
    assert.equal(d.hibas, 0);
    assert.equal(d.maradt, 0);
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
  const a2 = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.equal(a2.elakadt, 0);
  assert.equal(a2.utolsoHiba, null);
});

test('nem megosztott naptár (404): érthető magyar hibaüzenet a naptár azonosítójával, páciensadat nélkül', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat({ hiba: ({ cal }) => (cal === KOLLEGA_NAPTAR ? 404 : null) });
  await fetchCsere(g, () => foglalHatterrel(env));
  const a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.equal(a.elakadt, 1);
  assert.match(a.utolsoHiba.uzenet, /nem éri el/);
  assert.ok(a.utolsoHiba.uzenet.includes(KOLLEGA_NAPTAR));
  assert.ok(!a.utolsoHiba.uzenet.includes(TESZT_NEV));
  // a stúdiónaptárba közben bekerült
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
});

test('idempotens: ismételt szinkron nem duplikál; 409 (már létező azonosító) után patch', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const f = await foglalHatterrel(env);
    // a tárolt kapcsolat elveszett (például a Google-hívás sikerült, de a D1-írás nem): újra insert → 409 → patch
    env.BOOKING_DB._raw.prepare(`DELETE FROM gcal_esemeny`).run();
    env.BOOKING_DB._raw.prepare(`INSERT INTO gcal_sor (elem_id, probalkozas, letrehozva, frissitve) VALUES (?, 0, 0, 0)`).run(f.azonosito);
    g.hivasok.length = 0;
    const d = await (await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', {})).json();
    assert.equal(d.sikeres, 1);
    assert.deepEqual(g.hivasok.map((h) => h.method).sort(), ['PATCH', 'PATCH', 'POST', 'POST']);
    // még egyszer, mindenre: csak patch
    g.hivasok.length = 0;
    const d2 = await (await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', { mind: true })).json();
    assert.equal(d2.sikeres, 1);
    assert.deepEqual(g.hivasok.map((h) => h.method), ['PATCH', 'PATCH']);
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
});

test('kolléga oda-vissza csere: a törölt esemény újra-beillesztése (409) visszaállítja, nem duplikál', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const f = await foglalHatterrel(env);
    // a kolléga naptára átmenetileg kikerül (törlés), majd visszakerül (ugyanaz az eseményazonosító)
    await kollegaAtir(env, 'szegedi-botond', { naptar_id: '' });
    await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', { mind: true });
    assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 0);
    await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
    const d = await (await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', { mind: true })).json();
    assert.equal(d.sikeres, 1);
    assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
    assert.equal(g.aktiv(KOLLEGA_NAPTAR)[0].status, 'confirmed');
    assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_esemeny WHERE elem_id = ?`, f.azonosito)[0].n, 2);
  });
});

test('401 (lejárt token): új tokent kér és egyszer újrapróbálja', async () => {
  const env = await bekotottEnv({ studio: '' });
  const g = googleUtanzat();
  let elso = true;
  g.hiba = () => { if (elso) { elso = false; return 401; } return null; };
  await fetchCsere(g, () => foglalHatterrel(env));
  assert.equal(g.tokenHivas, 2);
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
});

test('az admin megnyitása (GET) a háttérben újrapróbálja az elakadt tételeket', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat({ hiba: 500 });
  await fetchCsere(g, () => foglalHatterrel(env));
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 1);
  // az utolsó próba „régi” legyen (a túl gyakori újrapróbálást a kód fékezi)
  env.BOOKING_DB._raw.prepare(`UPDATE gcal_sor SET frissitve = 0`).run();
  g.hiba = null;
  await fetchCsere(g, async () => {
    const h = hatter();
    const r = await admin(env, 'GET', '/api/foglalo/foglalasok', undefined, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200);
    await h.varj();
  });
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
});

test('újraszinkron { mind: true }: a jövőbeli megerősített foglalásokat is szinkronizálja (bekötés után)', async () => {
  const env = ujEnv(); // kulcs nélkül foglalunk
  await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
  await foglalj(env);
  await foglalj(env, { kezd: '14:00' }, '5.6.7.8');
  const env2 = { ...env, GOOGLE_SA_KEY: await saKulcs() };
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const r = await admin(env2, 'POST', '/api/foglalo/naptar/ujraszinkron', { mind: true });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.sikeres, 2);
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 2);
});

test('újraszinkron kulcs nélkül: 409 magyar üzenettel', async () => {
  const env = ujEnv();
  const r = await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', {});
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /nincs bekötve/);
});

// ---------------------------------------------------------------- admin API: naptar_id és studioNaptarId

test('kolléga naptar_id: PATCH-csel állítható, hibásra 400, a nyilvános katalógusban nem látszik', async () => {
  const env = ujEnv();
  const ok = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { naptar_id: MASIK_NAPTAR });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal((await ok.json()).naptar_id, MASIK_NAPTAR);
  const ures = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { naptar_id: '' });
  assert.equal((await ures.json()).naptar_id, '');
  for (const rossz of ['nem naptar', 'a@b', '<x>@group.calendar.google.com', 42]) {
    const r = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { naptar_id: rossz });
    assert.equal(r.status, 400, String(rossz));
  }
  await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { naptar_id: MASIK_NAPTAR });
  const kat = await (await get(env, '/foglalas-api/katalogus')).text();
  assert.ok(!kat.includes(MASIK_NAPTAR));
  assert.ok(!kat.includes('naptar_id'));
  // a teljes beállítás-mentés (ami nem küldi a mezőt) megtartja
  const t = await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json();
  const kuld = { ...t, kollegak: t.kollegak.map(({ naptar_id: _n, ...k }) => k) };
  const p = await admin(env, 'PUT', '/api/foglalo/beallitasok', kuld);
  assert.equal(p.status, 200, await p.clone().text());
  assert.equal((await p.json()).kollegak.find((k) => k.id === 'szegedi-botond').naptar_id, MASIK_NAPTAR);
});

test('studioNaptarId: a beállításokban olvasható és menthető, hibásra 400, alapból üres', async () => {
  const env = ujEnv();
  const t = await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t.szabalyok.studioNaptarId, '');
  const ment = await admin(env, 'PUT', '/api/foglalo/beallitasok', { ...t, szabalyok: { ...t.szabalyok, studioNaptarId: STUDIO_NAPTAR } });
  assert.equal(ment.status, 200, await ment.clone().text());
  assert.equal((await ment.json()).szabalyok.studioNaptarId, STUDIO_NAPTAR);
  // egy későbbi mentés, ami nem küldi, megtartja
  const { studioNaptarId: _s, ...nelkule } = t.szabalyok;
  const ment2 = await admin(env, 'PUT', '/api/foglalo/beallitasok', { ...t, szabalyok: nelkule });
  assert.equal((await ment2.json()).szabalyok.studioNaptarId, STUDIO_NAPTAR);
  const rossz = await admin(env, 'PUT', '/api/foglalo/beallitasok', { ...t, szabalyok: { ...t.szabalyok, studioNaptarId: 'rossz' } });
  assert.equal(rossz.status, 400);
  const kat = await (await get(env, '/foglalas-api/katalogus')).text();
  assert.ok(!kat.includes(STUDIO_NAPTAR));
});

test('naptár-állapot: a kollégák naptár-azonosítója és a stúdiónaptár látszik (kulcs és token soha)', async () => {
  const kulcs = await saKulcs();
  const env = await bekotottEnv();
  env.GOOGLE_SA_KEY = kulcs;
  const r = await admin(env, 'GET', '/api/foglalo/naptar/allapot');
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.ok(!txt.includes('PRIVATE KEY'));
  assert.ok(!txt.includes(JSON.parse(kulcs).private_key_id));
  const a = JSON.parse(txt);
  assert.equal(a.studioNaptarId, STUDIO_NAPTAR);
  assert.equal(a.kollegak.find((k) => k.id === 'szegedi-botond').naptar_id, KOLLEGA_NAPTAR);
  assert.equal(a.kulcsHiba, null);
  const hibas = await (await admin({ ...env, GOOGLE_SA_KEY: '{"rossz":1}' }, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.equal(hibas.bekotve, false);
  assert.match(hibas.kulcsHiba, /hibás/);
});

// ---------------------------------------------------------------- csoportos órák

const OKTATO_NAPTAR = 'barkoczy.barbara@example.com';
const ugyfel = (o = {}) => ({ nev: TESZT_NEV, email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', hozzajarul: true, ...o });

/** A következő hétfői 18:15-ös aerial óra (Barkóczy Barbara, 6 hely), vagy a megadott. */
async function ora(env, kezd = '18:15', nap = kovNap(1)) {
  const d = await (await get(env, `/foglalas-api/orak?helyszin=mexikoi&tol=${nap}&ig=${nap}`)).json();
  const o = d.orak.find((x) => x.kezd === kezd);
  assert.ok(o, `${nap} ${kezd}`);
  return o;
}

async function csoportosEnv({ oktato = OKTATO_NAPTAR, studio = STUDIO_NAPTAR } = {}) {
  const env = ujEnv({ GOOGLE_SA_KEY: await saKulcs() });
  await kollegaAtir(env, 'barkoczy-barbara', { naptar_id: oktato });
  await szabalyAtir(env, { studioNaptarId: studio });
  return env;
}

async function jelentkezz(env, o, extra = {}, ip = '1.2.3.4') {
  const h = hatter();
  const r = await post(env, '/foglalas-api/ora-foglalas', { ora: o.id, ...ugyfel(extra) }, { ip, waitUntil: h.waitUntil });
  assert.equal(r.status, 201, await r.clone().text());
  const d = await r.json();
  await h.varj();
  return { ...d, t: tokenBol(d.lemondasUrl) };
}

test('csoportos óra: óránként EGY esemény az oktató és a stúdió naptárában, a résztvevők listájával', async () => {
  const env = await csoportosEnv();
  const o = await ora(env);
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    await jelentkezz(env, o);
    await jelentkezz(env, o, { nev: 'David teszt Kettő', email: 'david.teszt+2@example.com', telefon: '+36 30 765 4321' }, '5.6.7.8');
  });
  assert.equal(g.hivasok.filter((h) => h.method === 'POST').length, 2, 'az első jelentkezés hozza létre (oktató + stúdió)');
  assert.equal(g.aktiv(OKTATO_NAPTAR).length, 1);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
  for (const cal of [OKTATO_NAPTAR, STUDIO_NAPTAR]) {
    const e = g.aktiv(cal)[0];
    assert.equal(e.summary, 'Aerial yoga trapeze · 2/6 fő');
    assert.deepEqual(e.start, { dateTime: `${o.datum}T18:15:00`, timeZone: 'Europe/Budapest' });
    assert.deepEqual(e.end, { dateTime: `${o.datum}T19:15:00`, timeZone: 'Europe/Budapest' });
    assert.equal(e.colorId, '4'); // Barkóczy Barbara: #94485e bordó-rózsa → Flamingo
    assert.match(e.description, /Barkóczy Barbara/);
    assert.match(e.description, /1\. David teszt, \+36 30 123 4567/);
    assert.match(e.description, /2\. David teszt Kettő, \+36 30 765 4321/);
    assert.ok(!e.description.includes('@example.com'), 'e-mail-cím nem kerül a naptárba');
    assert.equal(e.extendedProperties.private.f360Ora, o.id);
    // a láthatóság a naptár megosztását követi: a „private” esemény a csak részleteket látó kollégának
    // foglalt blokk lenne, és bizonyos írási jog mellett a szolgáltatásfiók sem módosíthatná
    assert.equal(e.visibility, undefined);
  }
  assert.deepEqual(sorok(env, `SELECT cel FROM gcal_esemeny WHERE elem_id = ? ORDER BY cel`, o.id).map((x) => x.cel), ['kollega', 'studio']);
});

test('csoportos óra: lemondáskor a lista frissül, az utolsó lemondásnál az esemény törlődik', async () => {
  const env = await csoportosEnv();
  const o = await ora(env);
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const a = await jelentkezz(env, o);
    const b = await jelentkezz(env, o, { nev: 'David teszt Kettő', email: 'david.teszt+2@example.com' }, '5.6.7.8');
    let h = hatter();
    assert.equal((await post(env, '/foglalas-api/lemondas', { t: a.t }, { waitUntil: h.waitUntil })).status, 200);
    await h.varj();
    const e = g.aktiv(OKTATO_NAPTAR)[0];
    assert.equal(e.summary, 'Aerial yoga trapeze · 1/6 fő');
    assert.ok(!/1\. David teszt,/.test(e.description));
    assert.match(e.description, /1\. David teszt Kettő/);
    h = hatter();
    assert.equal((await admin(env, 'POST', `/api/foglalo/ora-foglalasok/${b.azonosito}/lemondas`, undefined, { waitUntil: h.waitUntil })).status, 200);
    await h.varj();
  });
  assert.equal(g.aktiv(OKTATO_NAPTAR).length, 0);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 0);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_esemeny`)[0].n, 0);
});

test('csoportos áthelyezés másik órára: a régi óra eseménye törlődik, az újé létrejön', async () => {
  const env = await csoportosEnv();
  const o1 = await ora(env);
  const o2 = await ora(env, '18:15', kovNap(5)); // pénteki aerial, ugyanaz az oktató
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const a = await jelentkezz(env, o1);
    const h = hatter();
    const r = await post(env, '/foglalas-api/modositas', { t: a.t, ora: o2.id }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200, await r.clone().text());
    await h.varj();
  });
  const akt = g.aktiv(OKTATO_NAPTAR);
  assert.equal(akt.length, 1);
  assert.equal(akt[0].extendedProperties.private.f360Ora, o2.id);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
});

test('csoportos óra elmarad: az esemény mindkét naptárból törlődik', async () => {
  const env = await csoportosEnv();
  const o = await ora(env);
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    await jelentkezz(env, o);
    const h = hatter();
    const r = await admin(env, 'POST', `/api/foglalo/orak/${o.id}/elmarad`, { ok: 'Betegség' }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200, await r.clone().text());
    await h.varj();
  });
  assert.equal(g.aktiv(OKTATO_NAPTAR).length, 0);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 0);
});

test('csoportos óra oktatócseréje (admin): átkerül az új oktató naptárába, a stúdióban színt vált', async () => {
  const env = await csoportosEnv();
  await kollegaAtir(env, 'aczel-gabriella', { naptar_id: MASIK_NAPTAR });
  const o = await ora(env);
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    await jelentkezz(env, o);
    const h = hatter();
    const r = await admin(env, 'PATCH', `/api/foglalo/orak/${o.id}`, { kollega: 'aczel-gabriella' }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200, await r.clone().text());
    await h.varj();
  });
  assert.equal(g.aktiv(OKTATO_NAPTAR).length, 0);
  assert.equal(g.aktiv(MASIK_NAPTAR).length, 1);
  assert.equal(g.aktiv(STUDIO_NAPTAR)[0].colorId, '5'); // Aczél Gabriella: #5a5f30 olíva → Banana
  assert.match(g.aktiv(STUDIO_NAPTAR)[0].description, /Aczél Gabriella/);
});

test('csoportos óra oktató-naptár nélkül: csak a stúdiónaptárba kerül; admin kézi felvétel is', async () => {
  const env = await csoportosEnv({ oktato: '' });
  const o = await ora(env);
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const h = hatter();
    const r = await admin(env, 'POST', `/api/foglalo/orak/${o.id}/resztvevok`, { nev: TESZT_NEV, email: '', telefon: '' }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 201, await r.clone().text());
    await h.varj();
  });
  assert.deepEqual(g.hivasok.filter((h) => h.method === 'POST').map((h) => h.cal), [STUDIO_NAPTAR]);
  assert.match(g.aktiv(STUDIO_NAPTAR)[0].description, /1\. David teszt/);
});

// ---------------------------------------------------------------- beállítás-változás, cron, keret

test('PATCH /api/foglalo/naptar: a stúdiónaptár külön is állítható; hibásra 400', async () => {
  const env = ujEnv();
  const r = await admin(env, 'PATCH', '/api/foglalo/naptar', { studioNaptarId: STUDIO_NAPTAR });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).studioNaptarId, STUDIO_NAPTAR);
  assert.equal((await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json()).szabalyok.studioNaptarId, STUDIO_NAPTAR);
  assert.equal((await admin(env, 'PATCH', '/api/foglalo/naptar', { studioNaptarId: 'rossz' })).status, 400);
  assert.equal((await admin(env, 'PATCH', '/api/foglalo/naptar', { mas: 1 })).status, 400);
  assert.equal((await admin(env, 'PATCH', '/api/foglalo/naptar', { studioNaptarId: '' })).status, 200);
});

test('a kolléga naptárának beállítása után a meglévő jövőbeli foglalásai maguktól bekerülnek', async () => {
  const env = await bekotottEnv({ kollegaNaptar: '', studio: '' });
  await foglalj(env); // kulcs van, de naptár még nincs: nincs hívás
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const h = hatter();
    const r = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { naptar_id: KOLLEGA_NAPTAR }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200, await r.clone().text());
    await h.varj();
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
});

test('a kolléga színének változása a naptárban is átszínezi az eseményeit', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    await foglalHatterrel(env);
    const h = hatter();
    const r = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { szin: '#4f6d8a' }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200);
    await h.varj();
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR)[0].colorId, '7');
  assert.equal(g.aktiv(STUDIO_NAPTAR)[0].colorId, '7');
});

test('a 15 perces cron is újrapróbálja az elakadt tételeket', async () => {
  const CRON = 'cron-titok-'.padEnd(40, 'y');
  const env = await bekotottEnv();
  env.CRON_SECRET = CRON;
  const g = googleUtanzat({ hiba: 503 });
  await fetchCsere(g, () => foglalHatterrel(env));
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 1);
  env.BOOKING_DB._raw.prepare(`UPDATE gcal_sor SET frissitve = 0`).run();
  g.hiba = null;
  await fetchCsere(g, async () => {
    const r = await keres(env, 'POST', '/foglalas-api/cron/emlekezteto', { origin: null, headers: { 'X-Cron-Kulcs': CRON } });
    assert.equal(r.status, 200, await r.clone().text());
    const d = await r.json();
    assert.equal(d.naptar.sikeres, 1);
  });
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
});

test('hívás-keret: egy futás legfeljebb GCAL_MAX_HIVAS Google-hívást indít (a token-kérést is), a maradék a sorban vár', async () => {
  const env = ujEnv();
  await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
  await szabalyAtir(env, { studioNaptarId: STUDIO_NAPTAR });
  const NAP2 = datumPlusz(NAP, 7);
  for (const [i, kezd] of ['09:00', '11:00', '13:00', '15:00'].entries()) await foglalj(env, { kezd }, `9.9.9.${i}`);
  for (const [i, kezd] of ['09:00', '11:00', '13:00', '15:00'].entries()) await foglalj(env, { kezd, datum: NAP2 }, `9.9.8.${i}`);
  // keret 10: 1 token + 4 tétel × 2 esemény = 9; az ötödik tétel már nem fér bele
  const env2 = { ...env, GOOGLE_SA_KEY: await saKulcs(), GCAL_MAX_HIVAS: '10' };
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const d = await (await admin(env2, 'POST', '/api/foglalo/naptar/ujraszinkron', { mind: true })).json();
    assert.equal(d.sikeres, 4);
    assert.equal(d.maradt, 4);
    assert.ok(g.tokenHivas + g.hivasok.length <= 10, `${g.tokenHivas} + ${g.hivasok.length}`);
    const d2 = await (await admin(env2, 'POST', '/api/foglalo/naptar/ujraszinkron', {})).json();
    assert.equal(d2.sikeres, 4);
    assert.equal(d2.maradt, 0);
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 8);
  const a = await (await admin(env2, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.equal(a.elakadt, 0);
  assert.equal(a.varakozik, 0);
});

test('lemondott foglalás régi eseménye: ha a lemondáskor a Google nem érhető el, az újraszinkron törli', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const f = await foglalHatterrel(env);
    g.hiba = 500;
    const h = hatter();
    await post(env, '/foglalas-api/lemondas', { t: f.t }, { waitUntil: h.waitUntil });
    await h.varj();
    assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
    g.hiba = null;
    const d = await (await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', {})).json();
    assert.equal(d.sikeres, 1);
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 0);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 0);
});

test('elem-keret: egy futás legfeljebb GCAL_MAX_ELEM elemet dolgoz fel (a D1-hívások miatt is), a maradék a sorban vár', async () => {
  const env = ujEnv();
  for (const [i, kezd] of ['09:00', '11:00', '13:00'].entries()) await foglalj(env, { kezd }, `8.8.8.${i}`);
  // bekötve, de egyetlen naptár sincs: Google-hívás nincs, a keretet csak az elemszám adja
  const env2 = { ...env, GOOGLE_SA_KEY: await saKulcs(), GCAL_MAX_ELEM: '2' };
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    const d = await (await admin(env2, 'POST', '/api/foglalo/naptar/ujraszinkron', { mind: true })).json();
    assert.equal(d.sikeres, 2);
    assert.equal(d.maradt, 1);
  });
  assert.equal(g.hivasok.length, 0);
});

// ---------------------------------------------------------------- független review után (2026-10-01)

test('token-hiba: a futás az első sikertelen token-kérés után leáll (nem kér tokent tételenként)', async () => {
  const env = ujEnv();
  await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
  for (const [i, kezd] of ['09:00', '11:00', '13:00', '15:00'].entries()) await foglalj(env, { kezd }, `7.7.7.${i}`);
  const env2 = { ...env, GOOGLE_SA_KEY: await saKulcs() };
  let tokenKeres = 0;
  const rossz = async (url) => {
    if (String(url) === TOKEN_URL) { tokenKeres += 1; return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }); }
    throw new Error('Calendar-hívás nem történhet token nélkül');
  };
  await fetchCsere({ fetch: rossz }, async () => {
    const d = await (await admin(env2, 'POST', '/api/foglalo/naptar/ujraszinkron', { mind: true })).json();
    assert.equal(d.sikeres, 0);
    assert.equal(d.maradt, 4);
  });
  assert.equal(tokenKeres, 1);
  const a = await (await admin(env2, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.match(a.utolsoHiba.uzenet, /nem adott hozzáférést/);
});

test('kolléga-csere, a régi naptárból tartósan nem törölhető (403): az új naptárba így is bekerül', async () => {
  const env = await bekotottEnv({ studio: '' });
  const uj = await admin(env, 'POST', '/api/foglalo/kollegak', {
    nev: TESZT_NEV, helyszinek: ['mexikoi'], szolgaltatasok: ['gyogymasszazs-50'], szin: '#3b4580', naptar_id: MASIK_NAPTAR,
  });
  const kid = (await uj.json()).id;
  await admin(env, 'PUT', `/api/foglalo/beosztas?kollega=${kid}`, { sorok: [1, 2, 3, 4, 5].map((nap) => ({ nap, helyszin: 'mexikoi', kezd: '09:00', veg: '17:00' })) });
  const g = googleUtanzat();
  let f;
  await fetchCsere(g, async () => {
    f = await foglalHatterrel(env);
    g.hiba = ({ method, cal }) => (method === 'DELETE' && cal === KOLLEGA_NAPTAR ? 403 : null);
    const h = hatter();
    const r = await admin(env, 'PATCH', `/api/foglalo/foglalasok/${f.azonosito}`, { datum: NAP, kezd: '11:00', kollega: kid }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200);
    await h.varj();
  });
  assert.equal(g.aktiv(MASIK_NAPTAR).length, 1, 'az új kolléga naptárába bekerült');
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 1, 'a régi törlése a sorban vár');
  const a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.match(a.utolsoHiba.uzenet, /nincs írási joga/);
  // a jog helyreállt: az újraszinkron törli a régit
  g.hiba = null;
  await fetchCsere(g, async () => {
    const d = await (await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', {})).json();
    assert.equal(d.sikeres, 1);
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 0);
  assert.equal(g.aktiv(MASIK_NAPTAR).length, 1);
  assert.deepEqual(sorok(env, `SELECT naptar_id FROM gcal_esemeny WHERE elem_id = ?`, f.azonosito).map((x) => x.naptar_id), [MASIK_NAPTAR]);
});

test('automatikus újrapróbálás legfeljebb 10-szer; a kézi újraszinkron ezután is próbálja', async () => {
  const env = await bekotottEnv({ studio: '' });
  const g = googleUtanzat({ hiba: 400 });
  await fetchCsere(g, () => foglalHatterrel(env));
  env.BOOKING_DB._raw.prepare(`UPDATE gcal_sor SET probalkozas = 10, frissitve = 0`).run();
  g.hivasok.length = 0;
  g.hiba = null;
  await fetchCsere(g, async () => {
    const h = hatter();
    await admin(env, 'GET', '/api/foglalo/foglalasok', undefined, { waitUntil: h.waitUntil });
    await h.varj();
  });
  assert.equal(g.hivasok.length, 0, 'az admin-megnyitás nem próbálja tovább');
  const a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.equal(a.elakadt, 1);
  await fetchCsere(g, async () => {
    const d = await (await admin(env, 'POST', '/api/foglalo/naptar/ujraszinkron', {})).json();
    assert.equal(d.sikeres, 1);
  });
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
});

test('kulcs nélkül az admin-módosítás nem olvas plusz törzsadatot, és egy naptár-hiba nem rontja el a már sikeres választ', async () => {
  const env = ujEnv();
  let olvas = 0;
  const db = env.BOOKING_DB;
  const prep = db.prepare;
  env.BOOKING_DB = { ...db, prepare: (sql) => { if (/kulcs = 'torzs'/.test(sql)) olvas += 1; return prep(sql); } };
  const r = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { szerep: 'gyógymasszőr' });
  assert.equal(r.status, 200);
  const kulcsNelkul = olvas;
  olvas = 0;
  const env2 = { ...env, GOOGLE_SA_KEY: await saKulcs() };
  const r2 = await admin(env2, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { szerep: 'gyógymasszőr, nyirokmasszőr' });
  assert.equal(r2.status, 200);
  assert.ok(olvas > kulcsNelkul, `kulcs nélkül ${kulcsNelkul}, kulccsal ${olvas} törzs-olvasás`);
});

test('cron: a naptár-hiba nem buktatja el a cron-választ', async () => {
  const CRON = 'cron-titok-'.padEnd(40, 'y');
  const env = await bekotottEnv();
  env.CRON_SECRET = CRON;
  await fetchCsere(googleUtanzat({ hiba: 503 }), () => foglalHatterrel(env));
  env.BOOKING_DB._raw.prepare(`UPDATE gcal_sor SET frissitve = 0`).run();
  env.BOOKING_DB._raw.exec(`DROP TABLE gcal_sor`); // a sor maga nem olvasható: a szinkron egészében elbukik
  const r = await keres(env, 'POST', '/foglalas-api/cron/emlekezteto', { origin: null, headers: { 'X-Cron-Kulcs': CRON } });
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok((await r.json()).naptar.hiba);
});

// ---------------------------------------------------------------- második review után (2026-10-01)

test('sablon oktatócseréje: a sablon minden jövőbeli, résztvevős órája átkerül az új oktató naptárába', async () => {
  const env = await csoportosEnv();
  await kollegaAtir(env, 'aczel-gabriella', { naptar_id: MASIK_NAPTAR });
  const o = await ora(env);
  const g = googleUtanzat();
  await fetchCsere(g, async () => {
    await jelentkezz(env, o);
    const sablon = sorok(env, `SELECT template_id FROM class_sessions WHERE id = ?`, o.id)[0].template_id;
    const h = hatter();
    const r = await admin(env, 'PATCH', `/api/foglalo/ora-sablonok/${sablon}`, { kollega: 'aczel-gabriella' }, { waitUntil: h.waitUntil });
    assert.equal(r.status, 200, await r.clone().text());
    await h.varj();
  });
  assert.equal(g.aktiv(OKTATO_NAPTAR).length, 0);
  assert.equal(g.aktiv(MASIK_NAPTAR).length, 1);
  assert.match(g.aktiv(STUDIO_NAPTAR)[0].description, /Aczél Gabriella/);
});

test('újra sorba kerülő tétel (új változás): a próbálkozás-számláló nullázódik, az automatikus újrapróbálás ismét él', async () => {
  const env = await bekotottEnv({ studio: '' });
  const g = googleUtanzat({ hiba: 503 });
  let f;
  await fetchCsere(g, async () => { f = await foglalHatterrel(env); });
  env.BOOKING_DB._raw.prepare(`UPDATE gcal_sor SET probalkozas = 10`).run();
  await fetchCsere(g, async () => {
    const h = hatter();
    await post(env, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '13:00', kollega: 'szegedi-botond' }, { waitUntil: h.waitUntil });
    await h.varj();
  });
  assert.equal(sorok(env, `SELECT probalkozas FROM gcal_sor`)[0].probalkozas, 1);
});

test('hívás-keret: a túl kicsi GCAL_MAX_HIVAS legalább 10 (egy tétel mindig befér, nem ragad be)', async () => {
  const env = await bekotottEnv();
  const g = googleUtanzat();
  await fetchCsere(g, () => foglalHatterrel({ ...env, GCAL_MAX_HIVAS: '2' }));
  assert.equal(g.aktiv(KOLLEGA_NAPTAR).length, 1);
  assert.equal(g.aktiv(STUDIO_NAPTAR).length, 1);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_sor`)[0].n, 0);
});
