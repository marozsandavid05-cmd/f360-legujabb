// Időpontfoglaló · a független review négy logikai hibájának regressziós tesztjei (Lilla-kör).
//  1. a szolgáltató bekapcsolásakor a régi (bemutatós) outbox-levelek ne menjenek ki tömegesen
//  2. Brevo: bizonytalan kézbesítésnél (időtúllépés, hálózati hiba) nincs vak újrapróbálás
//  3. a teljes beállítás-mentés (PUT) se archiválhasson, és ne tehesse a kilépést jövőbeli foglalás elé
//  4. archiválás és új foglalás versenye: archivált vagy kilépett kollégához nem kerülhet be foglalás
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, foglalj, NAP, outbox, post, sorok, ujEnv } from './_foglalo.mjs';
import * as mailer from '../functions/_lib/booking/mailer.js';
import { datumPlusz } from '../functions/_lib/booking/ido.js';

const { outboxKuld, OUTBOX_MAX_KOR } = mailer;
const KULCS = 're_teszt_'.padEnd(36, 'k');
const RESEND = { MAIL_PROVIDER: 'resend', MAIL_API_KEY: KULCS, MAIL_FROM: 'Studio F360 <foglalas@f360.hu>' };
const BREVO = { ...RESEND, MAIL_PROVIDER: 'brevo' };
function mock(...valaszok) {
  const hivasok = [];
  const fn = async (url, init) => {
    hivasok.push({ url, body: JSON.parse(init.body) });
    const v = valaszok[Math.min(hivasok.length - 1, valaszok.length - 1)];
    if (v instanceof Error) throw v;
    return new Response(JSON.stringify(v.body ?? {}), { status: v.status ?? 200 });
  };
  fn.hivasok = hivasok;
  return fn;
}

test('1. régi outbox-levél (48 óránál régebbi) nem megy ki, sent = 2 „elavult”; a friss igen', async () => {
  const e = ujEnv(RESEND);
  await foglalj(e);
  const most = Date.now();
  e.BOOKING_DB._raw.prepare('UPDATE outbox SET created_at = ?').run(most - OUTBOX_MAX_KOR - 60e3);
  await foglalj(e, { kezd: '12:00' }, '2.2.2.2');
  const f = mock({ status: 200, body: { id: 'x' } });
  const r = await outboxKuld(e, e.BOOKING_DB, { fetchFn: f, most });
  assert.equal(r.kuldve, 2);
  assert.equal(r.elavult, 2);
  assert.equal(f.hivasok.length, 2);
  const regi = sorok(e, 'SELECT sent, hiba FROM outbox WHERE created_at < ?', most - OUTBOX_MAX_KOR);
  assert.equal(regi.length, 2);
  assert.ok(regi.every((x) => x.sent === 2 && /elavult/.test(x.hiba)));
  assert.equal(OUTBOX_MAX_KOR, 48 * 3600e3);
});

test('2. Brevo: időtúllépés vagy hálózati hiba után nincs újrapróbálás (sent = 2, bizonytalan); 5xx után igen', async () => {
  const e = ujEnv(BREVO);
  await foglalj(e);
  const f = mock(new Error('The operation was aborted due to timeout'));
  const r = await outboxKuld(e, e.BOOKING_DB, { fetchFn: f });
  assert.equal(r.vegleges, 2);
  assert.ok(outbox(e).every((x) => x.sent === 2 && /bizonytalan/.test(x.hiba)));
  await outboxKuld(e, e.BOOKING_DB, { fetchFn: f });
  assert.equal(f.hivasok.length, 2);
  // 5xx: a Brevo nem fogadta be, újrapróbálható
  const e2 = ujEnv(BREVO);
  await foglalj(e2);
  const g = mock({ status: 503 }, { status: 503 }, { status: 201, body: { messageId: 'm' } });
  assert.equal((await outboxKuld(e2, e2.BOOKING_DB, { fetchFn: g })).hibas, 2);
  assert.equal((await outboxKuld(e2, e2.BOOKING_DB, { fetchFn: g })).kuldve, 2);
  // Resend: az Idempotency-Key miatt a hálózati hiba után újrapróbálható
  const e3 = ujEnv(RESEND);
  await foglalj(e3);
  const h = mock(new Error('fetch failed'));
  assert.equal((await outboxKuld(e3, e3.BOOKING_DB, { fetchFn: h })).hibas, 2);
  assert.ok(outbox(e3).every((x) => x.sent === 0));
});

test('3. PUT /beallitasok: archiválás vagy kilépés jövőbeli foglalás elé 409, a beállítás nem változik', async () => {
  const e = ujEnv();
  await foglalj(e);
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const atir = (m) => ({ ...t, kollegak: t.kollegak.map((k) => (k.id === 'szegedi-botond' ? { ...k, ...m } : k)) });
  for (const m of [{ archivalt: true }, { aktiv_ig: datumPlusz(NAP, -1) }, { aktiv_tol: datumPlusz(NAP, 1) }]) {
    const r = await admin(e, 'PUT', '/api/foglalo/beallitasok', atir(m));
    assert.equal(r.status, 409, JSON.stringify(m));
    assert.equal((await r.json()).jovobeli, 1);
  }
  const most = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const b = most.kollegak.find((k) => k.id === 'szegedi-botond');
  assert.equal(b.archivalt, false);
  assert.equal(b.aktiv_ig, '');
  // a foglalás napja még belefér: 200
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', atir({ aktiv_ig: NAP }))).status, 200);
  // a kolléga törlése a listából jövőbeli foglalással ugyanúgy 409 (archiválásnak számít)
  const t2 = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const torol = await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t2, kollegak: t2.kollegak.filter((k) => k.id !== 'szegedi-botond') });
  assert.equal(torol.status, 409);
  assert.equal((await torol.json()).jovobeli, 1);
  assert.ok((await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json()).kollegak.some((k) => k.id === 'szegedi-botond'));
  // foglalás nélküli kolléga törölhető
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t2, kollegak: t2.kollegak.filter((k) => k.id !== 'osvath-bence') })).status, 200);
});

test('fotó: visszaperjeles vagy protokoll-relatív út 400', async () => {
  const e = ujEnv();
  for (const foto of ['/\\\\gonosz.example/x.jpg', '//gonosz.example/x.jpg', '/\\gonosz.example/x.jpg', 'https://a.hu/x\\y.jpg']) {
    assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/vas-luca', { foto })).status, 400, foto);
  }
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/vas-luca', { foto: '/media/csapat/luca.jpg' })).status, 200);
});

test('Brevo: 500, 502 és 504 után nincs újrapróbálás (lehet, hogy befogadta); 429 és 503 után igen', async () => {
  for (const [status, varSent] of [[500, 2], [502, 2], [504, 2], [429, 0], [503, 0]]) {
    const e = ujEnv(BREVO);
    await foglalj(e);
    await outboxKuld(e, e.BOOKING_DB, { fetchFn: mock({ status }) });
    assert.ok(outbox(e).every((x) => x.sent === varSent), `${status}: ${outbox(e).map((x) => x.sent)}`);
  }
  // a Resend 500 után újrapróbál (idempotens)
  const e = ujEnv(RESEND);
  await foglalj(e);
  await outboxKuld(e, e.BOOKING_DB, { fetchFn: mock({ status: 500 }) });
  assert.ok(outbox(e).every((x) => x.sent === 0));
});

/** A D1-utánzat burka: a megadott SQL-előtag előtt egyszer lefuttat egy „közbeszóló” műveletet. */
function kozbeszol(env, elotag, muvelet) {
  const db = env.BOOKING_DB;
  let volt = false;
  const fut = () => { if (!volt) { volt = true; muvelet(db._raw); } };
  return {
    ...db,
    prepare: (sql) => {
      const st = db.prepare(sql);
      if (!sql.trimStart().startsWith(elotag)) return st;
      const burkol = (s) => ({ ...s, bind: (...a) => burkol(s.bind(...a)), run: async () => { fut(); return s.run(); }, _exec: () => { fut(); return s._exec(); } });
      return burkol(st);
    },
    batch: async (lista) => db.batch(lista),
  };
}

test('4a. verseny: a foglalás beolvasta a törzsadatot, közben archiválták a kollégát: a foglalás 409, nem kerül be', async () => {
  const e = ujEnv();
  await admin(e, 'GET', '/api/foglalo/beallitasok'); // séma + seed
  const archival = (raw) => {
    const t = JSON.parse(raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
    t.kollegak = t.kollegak.map((k) => (k.id === 'szegedi-botond' ? { ...k, archivalt: true } : k));
    raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(t));
  };
  const e2 = { ...e, BOOKING_DB: kozbeszol(e, 'INSERT INTO bookings', archival) };
  e2.BOOKING_DB._raw = e.BOOKING_DB._raw;
  const r = await post(e2, '/foglalas-api/foglalas', alap());
  assert.equal(r.status, 409, await r.clone().text());
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM bookings')[0].n, 0);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks')[0].n, 0);
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM outbox')[0].n, 0);
});

test('4b. verseny: az archiválás megszámolta a foglalásokat, közben foglaltak: az archiválás 409, a kolléga aktív marad', async () => {
  const e = ujEnv();
  const f = await foglalj(e);
  await post(e, '/foglalas-api/lemondas', { t: f.t });
  // a foglalás közvetlenül kerül be, mintha egy párhuzamos kérés épp most írta volna
  const beszur = (raw) => raw.prepare(`INSERT INTO bookings (id, location_id, service_id, staff_id, date, start_min, dur_min, buffer_min, name, token_salt, created_at, status)
    VALUES ('F00000000ZZ', 'mexikoi', 'gyogymasszazs-50', 'szegedi-botond', ?, 720, 50, 10, 'David teszt', 'so', 1, 'megerositett')`).run(NAP);
  const e2 = { ...e, BOOKING_DB: kozbeszol(e, 'UPDATE settings', beszur) };
  e2.BOOKING_DB._raw = e.BOOKING_DB._raw;
  const r = await admin(e2, 'POST', '/api/foglalo/kollegak/szegedi-botond/archivalas', {});
  assert.equal(r.status, 409, await r.clone().text());
  assert.equal((await r.json()).jovobeli, 1);
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t.kollegak.find((k) => k.id === 'szegedi-botond').archivalt, false);
});

test('4c. módosítás olyan kollégához, akit közben archiváltak: 409, a foglalás az eredeti helyén marad', async () => {
  const e = ujEnv();
  const f = await foglalj(e, { szolgaltatas: 'kismama-masszazs' });
  const archival = (raw) => {
    const t = JSON.parse(raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
    t.kollegak = t.kollegak.map((k) => (k.id === 'vas-luca' ? { ...k, archivalt: true } : k));
    raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(t));
  };
  const e2 = { ...e, BOOKING_DB: kozbeszol(e, 'DELETE FROM slot_locks', archival) };
  e2.BOOKING_DB._raw = e.BOOKING_DB._raw;
  const r = await post(e2, '/foglalas-api/modositas', { t: f.t, datum: NAP, kezd: '14:00', kollega: 'vas-luca' });
  assert.equal(r.status, 409, await r.clone().text());
  assert.deepEqual({ ...sorok(e, 'SELECT staff_id, start_min FROM bookings')[0] }, { staff_id: 'szegedi-botond', start_min: 600 });
  assert.equal(sorok(e, 'SELECT COUNT(*) AS n FROM slot_locks WHERE staff_id = ?', 'szegedi-botond')[0].n, 4);
});

test('5. másik kolléga jövőbeli foglalása nem akadályozza egy kolléga módosítását és archiválását', async () => {
  const e = ujEnv();
  await foglalj(e); // Szegedi Botondnak van jövőbeli foglalása
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/vas-luca', { bemutatkozas: 'Szia.' })).status, 200);
  assert.equal((await admin(e, 'PATCH', '/api/foglalo/kollegak/vas-luca', { aktiv_ig: datumPlusz(NAP, 30) })).status, 200);
  assert.equal((await admin(e, 'POST', '/api/foglalo/kollegak/osvath-bence/archivalas', {})).status, 200);
});

test('6. PUT: ha a beolvasás és a mentés között a törzsadat megváltozott, 409 (nem írja vissza az elavultat)', async () => {
  const e = ujEnv();
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const kozbe = (raw) => {
    const x = JSON.parse(raw.prepare(`SELECT ertek FROM settings WHERE kulcs = 'torzs'`).get().ertek);
    x.kollegak = x.kollegak.map((k) => (k.id === 'vas-luca' ? { ...k, archivalt: false, aktiv_ig: '' , bemutatkozas: 'közben' } : k));
    raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(x));
  };
  const e2 = { ...e, BOOKING_DB: kozbeszol(e, 'UPDATE settings', kozbe) };
  e2.BOOKING_DB._raw = e.BOOKING_DB._raw;
  const r = await admin(e2, 'PUT', '/api/foglalo/beallitasok', { ...t, szabalyok: { ...t.szabalyok, lemondasOra: 12 } });
  assert.equal(r.status, 409, await r.clone().text());
  const most = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(most.kollegak.find((k) => k.id === 'vas-luca').bemutatkozas, 'közben');
  assert.equal(most.szabalyok.lemondasOra, 24);
});

test('7. sok kolléga egyszerre törölve sem lépi túl a D1 100-as paraméterkorlátját: 400, érthető üzenettel', async () => {
  const e = ujEnv();
  const t = await (await admin(e, 'GET', '/api/foglalo/beallitasok')).json();
  const sok = Array.from({ length: 40 }, (_, i) => ({ id: `k${i}`, nev: `David teszt ${i}`, helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'] }));
  assert.equal((await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t, kollegak: [...t.kollegak, ...sok] })).status, 200);
  const r = await admin(e, 'PUT', '/api/foglalo/beallitasok', { ...t, kollegak: t.kollegak });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /legfeljebb/);
});
