// Időpontfoglaló · biztonsági regressziós tesztek (végső átvizsgálás, 2026-10-01).
// Mindegyik a javítás előtti kódon bukott (lásd a végső jelentést), utána zöld.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, foglalj, outbox, post, sorok, ujEnv } from './_foglalo.mjs';
import { NAPI_KORLAT } from '../functions/_lib/booking/foglalas.js';
import { forrasBemenet } from '../functions/_lib/booking/forras.js';
import { outboxKuld } from '../functions/_lib/booking/mailer.js';
import { tokenEllenoriz, tokenKeszit, ujAzonosito, ujSo } from '../functions/_lib/booking/token.js';

const HAMIS = (n) => `F${'0123456789'.slice(0, 10)}.${String(n).padStart(43, 'A').slice(0, 43)}`;

test('lemondás: a token találgatása IP-nként korlátozott (a 21. kísérlet 429), másik IP-ről megy', async () => {
  const e = ujEnv();
  const f = await foglalj(e, {}, '9.9.9.9');
  let utolso = 0;
  for (let i = 0; i <= NAPI_KORLAT; i++) utolso = (await post(e, '/foglalas-api/lemondas', { t: HAMIS(i) }, { ip: '6.6.6.6' })).status;
  assert.equal(utolso, 429);
  // a valódi tulajdonos (másik hálózatról) továbbra is lemondhat
  assert.equal((await post(e, '/foglalas-api/lemondas', { t: f.t }, { ip: '8.8.8.8' })).status, 200);
});

test('fejléc-injekció: sortörés a névben nem jut a levél tárgyába és a tárolt névbe', async () => {
  const e = ujEnv();
  const r = await post(e, '/foglalas-api/foglalas', alap({ nev: 'David teszt\r\nBcc: tamado@example.com' }));
  assert.equal(r.status, 201, await r.clone().text());
  const nev = sorok(e, 'SELECT name FROM bookings')[0].name;
  assert.ok(!/[\r\n]/.test(nev), JSON.stringify(nev));
  for (const l of outbox(e)) assert.ok(!/[\r\n]/.test(l.targy) && !/[\r\n]/.test(l.cimzett), `${l.tipus}: ${JSON.stringify(l.targy)}`);
});

test('fejléc-injekció: a kolléga neve sem tartalmazhat sortörést (admin)', async () => {
  const e = ujEnv();
  const r = await admin(e, 'POST', '/api/foglalo/kollegak', { nev: 'David teszt\nBcc: x@y.hu', szerep: '', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'] });
  if (r.status === 201) {
    const k = await r.json();
    assert.ok(!/[\r\n]/.test(k.nev), JSON.stringify(k.nev));
  } else assert.equal(r.status, 400);
});

test('a stúdió értesítési címe csak érvényes e-mail-cím lehet (címzett-injekció ellen)', async () => {
  const e = ujEnv();
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  for (const rossz of ['info@f360.hu\nBcc: x@y.hu', 'nem-email', 'a@b.hu, c@d.hu']) {
    const r = await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t, szabalyok: { ...t.szabalyok, studioEmail: rossz } });
    assert.equal(r.status, 400, rossz);
  }
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t, szabalyok: { ...t.szabalyok, studioEmail: 'info@f360.hu' } })).status, 200);
});

test('adatvédelem: a szolgáltató hibaüzenetéből a címzett e-mail-címe nem kerül a hiba mezőbe és a naplóba', async () => {
  const e = ujEnv({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 're_teszt_'.padEnd(36, 'k'), MAIL_FROM: 'Studio F360 <foglalas@f360.hu>' });
  await foglalj(e);
  const fetchFn = async (url, init) => {
    const to = JSON.parse(init.body).to[0];
    return new Response(JSON.stringify({ message: `Invalid \`to\` field: ${to}` }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  };
  const naplo = [];
  const eredeti = console.warn;
  console.warn = (...a) => naplo.push(a.join(' '));
  try { await outboxKuld(e, e.BOOKING_DB, { fetchFn }); } finally { console.warn = eredeti; }
  const hibak = sorok(e, 'SELECT hiba FROM outbox').map((x) => x.hiba || '');
  assert.ok(hibak.some((h) => /HTTP 422/.test(h)), hibak.join(' | '));
  for (const s of [...hibak, ...naplo]) assert.ok(!/@/.test(s), s);
});

test('kampány-forrás: a hivatkozó és az érkezési cím lekérdezéséből csak a kampány-paraméterek maradnak', () => {
  const k = forrasBemenet({
    referrer: 'https://www.google.com/search?q=david+teszt+telefon&hl=hu#x',
    landing: 'https://f360-legujabb.pages.dev/gerinc?utm_source=facebook&email=david.teszt@example.com&t=F0123456789.abc&gclid=G1#top',
  });
  assert.equal(k.referrer, 'https://www.google.com/search');
  assert.equal(k.landing, 'https://f360-legujabb.pages.dev/gerinc?utm_source=facebook&gclid=G1');
  assert.equal(forrasBemenet({ landing: '/gerinc?utm_source=facebook' }).landing, '/gerinc?utm_source=facebook');
});

test('token: csak a pontos (kanonikus) alak érvényes; az utolsó karakter kitöltő bitjeit átírva nem', async () => {
  const titok = 'x'.repeat(48);
  for (let i = 0; i < 20; i++) {
    const id = ujAzonosito(), so = ujSo(), tok = await tokenKeszit(titok, id, so);
    assert.equal(await tokenEllenoriz(titok, tok, so), true);
    const [, sig] = tok.split('.');
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const c of ABC) {
      if (c === sig.at(-1)) continue;
      assert.equal(await tokenEllenoriz(titok, `${id}.${sig.slice(0, -1)}${c}`, so), false, `${sig.at(-1)} -> ${c}`);
    }
  }
});
