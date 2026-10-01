// Időpontfoglaló · e-mail-küldés előkészítése (Lilla-kör): MAIL_PROVIDER=resend|brevo, MAIL_API_KEY,
// MAIL_FROM. VALÓDI KÜLDÉS NINCS: minden hívás egy fetch-mockra megy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foglalj, keres, ORIGIN, outbox, post, sorok, ujEnv } from './_foglalo.mjs';
import { mailMod, outboxKuld } from '../functions/_lib/booking/mailer.js';

const KULCS = 're_teszt_'.padEnd(36, 'k');
const RESEND = { MAIL_PROVIDER: 'resend', MAIL_API_KEY: KULCS, MAIL_FROM: 'Studio F360 <foglalas@f360.hu>' };
const BREVO = { MAIL_PROVIDER: 'brevo', MAIL_API_KEY: KULCS, MAIL_FROM: 'Studio F360 <foglalas@f360.hu>' };

/** fetch-mock: a hívásokat rögzíti, a válaszokat sorban adja (az utolsó ismétlődik). */
function mock(...valaszok) {
  const hivasok = [];
  const fn = async (url, init) => {
    hivasok.push({ url: String(url), init, body: JSON.parse(init.body) });
    const v = valaszok[Math.min(hivasok.length - 1, valaszok.length - 1)];
    if (v instanceof Error) throw v;
    return new Response(JSON.stringify(v.body ?? {}), { status: v.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.hivasok = hivasok;
  return fn;
}
const kuld = (e, fetchFn, o = {}) => outboxKuld(e, e.BOOKING_DB, { fetchFn, ...o });
const b64ToStr = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

test('mailMod: beállítás nélkül, ismeretlen providerrel vagy hiányzó kulccsal/feladóval outbox', () => {
  assert.equal(mailMod({}), 'outbox');
  assert.equal(mailMod({ MAIL_PROVIDER: 'outbox' }), 'outbox');
  assert.equal(mailMod({ ...RESEND, MAIL_PROVIDER: 'mailgun' }), 'outbox');
  assert.equal(mailMod({ ...RESEND, MAIL_API_KEY: '' }), 'outbox');
  assert.equal(mailMod({ ...RESEND, MAIL_FROM: '' }), 'outbox');
  assert.equal(mailMod({ ...RESEND, MAIL_FROM: 'nem-email' }), 'outbox');
  assert.equal(mailMod(RESEND), 'resend');
  assert.equal(mailMod({ ...BREVO, MAIL_PROVIDER: 'BREVO' }), 'brevo');
});

test('outbox-módban nincs hálózati hívás, a levelek sent = 0-n maradnak', async () => {
  const e = ujEnv();
  await foglalj(e);
  const f = mock({ status: 200 });
  const r = await kuld(e, f);
  assert.deepEqual(r, { mod: 'outbox', kuldve: 0, hibas: 0, vegleges: 0, elavult: 0 });
  assert.equal(f.hivasok.length, 0);
  assert.ok(outbox(e).every((x) => x.sent === 0));
});

test('resend: a helyes végpont, fejléc és törzs; .ics csatolmány base64-ben; sent = 1, provider_id', async () => {
  const e = ujEnv(RESEND);
  const fo = await foglalj(e);
  const f = mock({ status: 200, body: { id: 'resend-uzenet-1' } });
  const r = await kuld(e, f);
  assert.equal(r.mod, 'resend');
  assert.equal(r.kuldve, 2); // visszaigazolás + stúdió-értesítő
  const h = f.hivasok.find((x) => x.body.to[0] === 'david.teszt@example.com');
  assert.equal(h.url, 'https://api.resend.com/emails');
  assert.equal(h.init.method, 'POST');
  assert.equal(h.init.headers.Authorization, `Bearer ${KULCS}`);
  assert.equal(h.init.headers['Content-Type'], 'application/json');
  assert.match(h.init.headers['Idempotency-Key'], /^f360-outbox-\d+$/);
  assert.equal(h.body.from, 'Studio F360 <foglalas@f360.hu>');
  assert.match(h.body.subject, /visszaigazolása/);
  assert.ok(h.body.html.includes('David teszt'));
  assert.ok(h.body.text.includes('David teszt'));
  assert.equal(h.body.attachments.length, 1);
  assert.equal(h.body.attachments[0].filename, `studio-f360-${fo.azonosito}.ics`);
  assert.ok(b64ToStr(h.body.attachments[0].content).includes('BEGIN:VEVENT'));
  assert.ok(b64ToStr(h.body.attachments[0].content).includes('Gyógymasszázs')); // UTF-8 ép
  const studio = f.hivasok.find((x) => x.body.to[0] === 'info@f360.hu');
  assert.equal(studio.body.attachments, undefined);
  for (const x of outbox(e)) {
    assert.equal(x.sent, 1);
    assert.equal(x.provider_id, 'resend-uzenet-1');
    assert.ok(x.kuldve_at > 0);
    assert.equal(x.zarolva_at, null);
  }
  // másodszor már nincs mit küldeni
  assert.equal((await kuld(e, f)).kuldve, 0);
  assert.equal(f.hivasok.length, 2);
});

test('brevo: api-key fejléc, sender {name, email}, to [{email}], htmlContent, textContent, attachment', async () => {
  const e = ujEnv({ ...BREVO, MAIL_REPLY_TO: 'info@f360.hu' });
  const fo = await foglalj(e);
  const f = mock({ status: 201, body: { messageId: '<brevo-1@smtp>' } });
  assert.equal((await kuld(e, f)).kuldve, 2);
  const h = f.hivasok.find((x) => x.body.to[0].email === 'david.teszt@example.com');
  assert.equal(h.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(h.init.headers['api-key'], KULCS);
  assert.equal(h.init.headers.Authorization, undefined);
  assert.deepEqual(h.body.sender, { name: 'Studio F360', email: 'foglalas@f360.hu' });
  assert.deepEqual(h.body.replyTo, { email: 'info@f360.hu' });
  assert.ok(h.body.htmlContent.includes('David teszt'));
  assert.ok(h.body.textContent.includes('David teszt'));
  assert.equal(h.body.attachment[0].name, `studio-f360-${fo.azonosito}.ics`);
  assert.ok(b64ToStr(h.body.attachment[0].content).includes('BEGIN:VEVENT'));
  assert.match(h.body.headers['Idempotency-Key'], /^f360-outbox-\d+$/);
  assert.ok(outbox(e).every((x) => x.sent === 1 && x.provider_id === '<brevo-1@smtp>'));
});

test('átmeneti hiba (500, 429, hálózati hiba): sent = 0, probalkozas nő, hiba mező; a következő futás elküldi', async () => {
  const e = ujEnv(RESEND);
  await foglalj(e);
  const f = mock({ status: 500, body: { message: 'belső hiba' } }, { status: 429, body: {} }, new Error('fetch failed'), new Error('fetch failed'), { status: 200, body: { id: 'ok' } });
  const r1 = await kuld(e, f);
  assert.equal(r1.hibas, 2);
  for (const x of outbox(e)) {
    assert.equal(x.sent, 0);
    assert.equal(x.probalkozas, 1);
    assert.match(x.hiba, /HTTP (500|429)/);
    assert.ok(!x.hiba.includes(KULCS));
    assert.equal(x.zarolva_at, null);
  }
  assert.equal((await kuld(e, f)).hibas, 2); // hálózati hiba
  assert.ok(outbox(e).every((x) => x.probalkozas === 2 && /fetch failed/.test(x.hiba)));
  const r3 = await kuld(e, f);
  assert.equal(r3.kuldve, 2);
  assert.ok(outbox(e).every((x) => x.sent === 1 && x.hiba === null));
});

test('végleges hiba: 4xx (nem 429) azonnal sent = 2; 5 sikertelen próba után is sent = 2, többet nem próbálja', async () => {
  const e = ujEnv(RESEND);
  await foglalj(e);
  const f = mock({ status: 422, body: { message: 'Invalid `to` field' } });
  const r = await kuld(e, f);
  assert.equal(r.vegleges, 2);
  assert.ok(outbox(e).every((x) => x.sent === 2 && /HTTP 422/.test(x.hiba) && x.hiba.includes('Invalid')));
  assert.equal((await kuld(e, f)).kuldve, 0);
  assert.equal(f.hivasok.length, 2);

  const e2 = ujEnv(RESEND);
  await foglalj(e2);
  const g = mock({ status: 503 });
  for (let i = 0; i < 5; i++) await kuld(e2, g);
  assert.ok(outbox(e2).every((x) => x.sent === 2 && x.probalkozas === 5));
  await kuld(e2, g);
  assert.equal(g.hivasok.length, 10);
});

test('párhuzamos futás nem küld kétszer (zárolás); a beragadt zár 10 perc után feloldódik', async () => {
  const e = ujEnv(RESEND);
  await foglalj(e);
  const f = mock({ status: 200, body: { id: 'x' } });
  await Promise.all([kuld(e, f), kuld(e, f), kuld(e, f)]);
  assert.equal(f.hivasok.length, 2);
  // egy félbeszakadt futás zárja: 5 perc múlva még nem, 11 perc múlva újra küldhető
  const e2 = ujEnv(RESEND);
  await foglalj(e2);
  const most = Date.now();
  e2.BOOKING_DB._raw.prepare('UPDATE outbox SET zarolva_at = ?').run(most);
  const g = mock({ status: 200, body: { id: 'y' } });
  assert.equal((await kuld(e2, g, { most: most + 5 * 60e3 })).kuldve, 0);
  assert.equal((await kuld(e2, g, { most: most + 11 * 60e3 })).kuldve, 2);
});

test('foglaláskor a háttérben (waitUntil) elküldi; outbox-módban nem indít küldést', async () => {
  const e = ujEnv(RESEND);
  const f = mock({ status: 200, body: { id: 'h' } });
  const regi = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const varakozok = [];
    const r = await post(e, '/foglalas-api/foglalas', {
      helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: (await import('./_foglalo.mjs')).NAP, kezd: '10:00',
      nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', hozzajarul: true,
    }, { waitUntil: (p) => varakozok.push(p) });
    assert.equal(r.status, 201);
    assert.equal(varakozok.length, 1);
    await Promise.all(varakozok);
    assert.equal(f.hivasok.length, 2);
    assert.ok(outbox(e).every((x) => x.sent === 1));
    // outbox-mód: nincs waitUntil
    const e2 = ujEnv();
    const v2 = [];
    const r2 = await post(e2, '/foglalas-api/foglalas', {
      helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', datum: (await import('./_foglalo.mjs')).NAP, kezd: '10:00',
      nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', hozzajarul: true,
    }, { waitUntil: (p) => v2.push(p) });
    assert.equal(r2.status, 201);
    assert.equal(v2.length, 0);
  } finally {
    globalThis.fetch = regi;
  }
});

test('a cron-futás a beragadt (korábban sikertelen) leveleket is újrapróbálja', async () => {
  const CRON = 'cron-titok-'.padEnd(40, 'y');
  const e = ujEnv({ ...RESEND, CRON_SECRET: CRON });
  await foglalj(e);
  e.BOOKING_DB._raw.prepare(`UPDATE outbox SET probalkozas = 1, hiba = 'HTTP 500'`).run();
  const f = mock({ status: 200, body: { id: 'c' } });
  const regi = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const r = await keres(e, 'POST', '/foglalas-api/cron/emlekezteto', { origin: null, headers: { 'X-Cron-Kulcs': CRON } });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.mod, 'resend');
    assert.equal(d.levelek.kuldve, 2);
  } finally {
    globalThis.fetch = regi;
  }
  assert.ok(outbox(e).every((x) => x.sent === 1));
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM outbox WHERE sent = 0')[0].n, 0);
  assert.ok(ORIGIN);
});
