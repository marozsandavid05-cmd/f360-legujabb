// Időpontfoglaló · a kolléga SAJÁT Google Naptárának figyelése (foglaltság). Ha a kolléga a saját
// naptárába beír valamit, az a sáv a foglalóban nem foglalható. Valódi Google-hívás nincs: a fetch
// egy kis Google-utánzat (tests/_google-foglaltsag.mjs), a kulcs a tesztben generált RSA-kulcs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, alap, get, kovNap, NAP, post, sorok, TESZT_NEV, tokenBol, ujEnv, kollegaAtir, szabalyAtir } from './_foglalo.mjs';
import { fetchCsere, googleFoglaltsag, saKulcs, utc } from './_google-foglaltsag.mjs';
import { esemenyAzonosito } from '../functions/_lib/booking/naptar.js';
import { budapestMost, datumPlusz, helyiToUtc } from '../functions/_lib/booking/ido.js';
import { FOGLALTSAG_SCOPE, foglaltsagLekerd, helyiSavok } from '../functions/_lib/booking/foglaltsag.js';

const SAJAT = 'szegedi.botond.sajat@example.com'; // a kolléga saját (magán) naptára
const SAJAT2 = 'szegedi.botond.munka@group.calendar.google.com';
const KOLLEGA_NAPTAR = 'szegedi.botond@example.com'; // ide ír a foglaló (naptar_id)
const STUDIO_NAPTAR = 'f360.studio@group.calendar.google.com';
const MASIK_SAJAT = 'david.teszt.sajat@example.com';
const KOZBEN = 'Ez az időpont közben foglalt lett, kérjük, válassz másikat.';
const NEM_RESZLET = 'Ehhez a naptárhoz ugyanide ír a foglaló is: adj „Események részleteinek megtekintése” jogot, vagy használj külön naptárt.';

const szabadUrl = (o = {}) => {
  const p = { helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond', tol: NAP, ig: NAP, ...o };
  return `/foglalas-api/szabad?${new URLSearchParams(p)}`;
};
async function kezdesek(env, o) {
  const r = await get(env, szabadUrl(o));
  assert.equal(r.status, 200, await r.clone().text());
  return ((await r.json()).napok[o && o.tol ? o.tol : NAP] || []);
}
const csakIdo = (lista) => lista.map((s) => s.kezd);

async function bekotott({ naptarak = [SAJAT], extra = {} } = {}) {
  const env = ujEnv({ GOOGLE_SA_KEY: await saKulcs(), ...extra });
  await kollegaAtir(env, 'szegedi-botond', { foglaltsagNaptarak: naptarak });
  return env;
}

/** Egy második gyógymasszőr a Mexikóiban (hétköznap 9-17), saját naptárral. */
async function masodikKollega(env, naptarak = [MASIK_SAJAT]) {
  const r = await admin(env, 'POST', '/api/foglalo/kollegak', {
    nev: TESZT_NEV, helyszinek: ['mexikoi'], szolgaltatasok: ['gyogymasszazs-50'], foglaltsagNaptarak: naptarak,
  });
  assert.equal(r.status, 201, await r.clone().text());
  const id = (await r.json()).id;
  const bo = await admin(env, 'PUT', `/api/foglalo/beosztas?kollega=${id}`, { sorok: [1, 2, 3, 4, 5].map((nap) => ({ nap, helyszin: 'mexikoi', kezd: '09:00', veg: '17:00' })) });
  assert.equal(bo.status, 200);
  return id;
}

// ---------------------------------------------------------------- 1-2. mező és kapcsoló

test('foglaltsagNaptarak: PATCH-csel és új kollégánál állítható, 0-3 érvényes naptár, hibásra magyar 400, a katalógusban soha', async () => {
  const env = ujEnv();
  const ok = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { foglaltsagNaptarak: [SAJAT, ` ${SAJAT2} `, SAJAT] });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual((await ok.json()).foglaltsagNaptarak, [SAJAT, SAJAT2]);
  for (const rossz of ['egy@pelda.hu', ['nem naptar'], ['a@b'], [42], [SAJAT, SAJAT2, 'c@group.calendar.google.com', 'd@group.calendar.google.com']]) {
    const r = await admin(env, 'PATCH', '/api/foglalo/kollegak/szegedi-botond', { foglaltsagNaptarak: rossz });
    assert.equal(r.status, 400, JSON.stringify(rossz));
    assert.match((await r.json()).error, /naptár/i);
  }
  // a teljes beállítás-mentés, ami nem küldi a mezőt, megtartja
  const t = await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json();
  assert.deepEqual(t.kollegak.find((k) => k.id === 'szegedi-botond').foglaltsagNaptarak, [SAJAT, SAJAT2]);
  assert.deepEqual(t.kollegak.find((k) => k.id === 'vas-luca').foglaltsagNaptarak, []);
  const kuld = { ...t, kollegak: t.kollegak.map(({ foglaltsagNaptarak: _f, ...k }) => k) };
  const p = await admin(env, 'PUT', '/api/foglalo/beallitasok', kuld);
  assert.equal(p.status, 200, await p.clone().text());
  assert.deepEqual((await p.json()).kollegak.find((k) => k.id === 'szegedi-botond').foglaltsagNaptarak, [SAJAT, SAJAT2]);
  // új kolléga is kaphatja
  const id = await masodikKollega(env);
  const t2 = await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json();
  assert.deepEqual(t2.kollegak.find((k) => k.id === id).foglaltsagNaptarak, [MASIK_SAJAT]);
  // a nyilvános katalógusban és a szabad-válaszban nincs
  const kat = await (await get(env, '/foglalas-api/katalogus')).text();
  for (const x of [SAJAT, SAJAT2, MASIK_SAJAT, 'foglaltsag']) assert.ok(!kat.includes(x), x);
});

test('foglaltsagFigyeles: alapból be, PATCH /api/foglalo/naptar-ral és a beállításokkal is kapcsolható, a katalógusban nincs', async () => {
  const env = ujEnv();
  const t = await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json();
  assert.equal(t.szabalyok.foglaltsagFigyeles, true);
  const r = await admin(env, 'PATCH', '/api/foglalo/naptar', { foglaltsagFigyeles: false });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).foglaltsagFigyeles, false);
  assert.equal((await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json()).szabalyok.foglaltsagFigyeles, false);
  assert.equal((await admin(env, 'PATCH', '/api/foglalo/naptar', { foglaltsagFigyeles: 'igen' })).status, 400);
  // a régi felület (csak studioNaptarId) továbbra is megy
  assert.equal((await admin(env, 'PATCH', '/api/foglalo/naptar', { studioNaptarId: STUDIO_NAPTAR })).status, 200);
  const t2 = await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json();
  const ment = await admin(env, 'PUT', '/api/foglalo/beallitasok', { ...t2, szabalyok: { ...t2.szabalyok, foglaltsagFigyeles: true } });
  assert.equal(ment.status, 200, await ment.clone().text());
  assert.equal((await ment.json()).szabalyok.foglaltsagFigyeles, true);
  assert.equal((await admin(env, 'PUT', '/api/foglalo/beallitasok', { ...t2, szabalyok: { ...t2.szabalyok, foglaltsagFigyeles: 1 } })).status, 400);
  assert.ok(!(await (await get(env, '/foglalas-api/katalogus')).text()).includes('foglaltsag'));
});

// ---------------------------------------------------------------- 3, 5. kínálat (freeBusy)

test('kínálat: a kolléga saját naptárának foglalt sávja (10:00-11:00) kiesik, a 9:00 és a 11:00 marad', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '10:00'), end: utc(NAP, '11:00') }]);
  const lista = await fetchCsere(g, () => kezdesek(env));
  const idok = csakIdo(lista);
  assert.ok(idok.includes('09:00'), idok.join(' '));
  assert.ok(!idok.includes('10:00'), idok.join(' '));
  assert.ok(idok.includes('11:00'), idok.join(' '));
  const fb = g.freeBusyHivasok();
  assert.equal(fb.length, 1);
  assert.deepEqual(fb[0].body.items, [{ id: SAJAT }]);
  assert.equal(fb[0].body.timeMin, new Date(helyiToUtc(NAP, 0)).toISOString());
  assert.equal(fb[0].body.timeMax, new Date(helyiToUtc(datumPlusz(NAP, 1), 0)).toISOString());
  assert.match(fb[0].auth, /^Bearer ftok-\d+$/);
  // csak olvasó jog: a foglalts ághoz külön token kerül, a calendar.readonly hatókörrel
  assert.equal(FOGLALTSAG_SCOPE, 'https://www.googleapis.com/auth/calendar.readonly');
  assert.deepEqual(g.scope, [FOGLALTSAG_SCOPE]);
});

test('kínálat: a foglalt sáv vége utáni első negyedórás pont is felkínált (hézagkitöltés), a rács többi része marad', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '09:20'), end: utc(NAP, '10:20') }]);
  const idok = csakIdo(await fetchCsere(g, () => kezdesek(env)));
  assert.ok(!idok.includes('09:00') && !idok.includes('10:00'), idok.join(' '));
  assert.ok(idok.includes('10:30'), `a 10:20-as vég után 10:30: ${idok.join(' ')}`);
  assert.ok(idok.includes('11:00'), idok.join(' '));
});

test('bárki: a foglalt kolléga helyett a szabad kapja az időpontot (kínálatban és foglaláskor is)', async () => {
  const env = await bekotott();
  const masik = await masodikKollega(env);
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '10:00'), end: utc(NAP, '11:00') }]);
  await fetchCsere(g, async () => {
    const lista = await kezdesek(env, { kollega: 'barki' });
    const tiz = lista.find((s) => s.kezd === '10:00');
    assert.deepEqual(tiz.kollegak, [masik]);
    assert.deepEqual(lista.find((s) => s.kezd === '09:00').kollegak.sort(), [masik, 'szegedi-botond'].sort());
    // egy Google-hívás a két kolléga két naptárára
    assert.equal(g.freeBusyHivasok().length, 1);
    assert.deepEqual(g.freeBusyHivasok()[0].body.items.map((x) => x.id).sort(), [MASIK_SAJAT, SAJAT].sort());
    const r = await post(env, '/foglalas-api/foglalas', alap({ kollega: 'barki', kezd: '10:00' }));
    assert.equal(r.status, 201, await r.clone().text());
    assert.equal((await r.json()).foglalas.kollega.id, masik);
  });
});

// ---------------------------------------------------------------- 7. friss ellenőrzés

test('friss ellenőrzés: a gyorsítótárban még szabad, de közben a naptárba beírt időpontra 409, magyar üzenettel', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  await fetchCsere(g, async () => {
    assert.ok(csakIdo(await kezdesek(env)).includes('10:00'));
    assert.equal(g.freeBusyHivasok().length, 1);
    // a kolléga közben beírt valamit; a gyorsítótár 5 percig még a régit mutatja
    g.foglalt.set(SAJAT, [{ start: utc(NAP, '10:15'), end: utc(NAP, '10:45') }]);
    assert.ok(csakIdo(await kezdesek(env)).includes('10:00'), 'gyorsítótárból');
    assert.equal(g.freeBusyHivasok().length, 1, 'a második lekérdezés nem hív Google-t');
    const r = await post(env, '/foglalas-api/foglalas', alap({ kezd: '10:00' }));
    assert.equal(r.status, 409, await r.clone().text());
    assert.equal((await r.json()).error, KOZBEN);
    assert.equal(g.freeBusyHivasok().length, 2, 'a foglalás gyorsítótár nélkül kérdez');
    // a friss eredmény a gyorsítótárba is bekerült: a kínálatból már kiesik
    assert.ok(!csakIdo(await kezdesek(env)).includes('10:00'));
  });
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM bookings`)[0].n, 0);
});

test('friss ellenőrzés vendég-módosításnál is: foglalt új időpontra 409, a foglalás marad a régi helyén', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  await fetchCsere(g, async () => {
    const r = await post(env, '/foglalas-api/foglalas', alap({ kezd: '09:00' }));
    assert.equal(r.status, 201, await r.clone().text());
    const d = await r.json();
    g.foglalt.set(SAJAT, [{ start: utc(NAP, '13:00'), end: utc(NAP, '14:00') }]);
    const m = await post(env, '/foglalas-api/modositas', { t: tokenBol(d.lemondasUrl), datum: NAP, kezd: '13:00', kollega: 'szegedi-botond' });
    assert.equal(m.status, 409, await m.clone().text());
    assert.equal((await m.json()).error, KOZBEN);
    const ok = await post(env, '/foglalas-api/modositas', { t: tokenBol(d.lemondasUrl), datum: NAP, kezd: '15:00', kollega: 'szegedi-botond' });
    assert.equal(ok.status, 200, await ok.clone().text());
  });
  assert.deepEqual(sorok(env, `SELECT start_min FROM bookings`).map((x) => x.start_min), [15 * 60]);
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM foglalas_naptar_jel`)[0].n, 0);
});

test('Google-hiba foglaláskor: a foglalás megy, az adminban jelölve „a naptár-ellenőrzés nem futott le”', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  g.hiba = 503;
  const r = await fetchCsere(g, () => post(env, '/foglalas-api/foglalas', alap({ kezd: '10:00' })));
  assert.equal(r.status, 201, await r.clone().text());
  assert.ok(g.freeBusyHivasok().length >= 1);
  const l = await (await admin(env, 'GET', `/api/foglalo/foglalasok?tol=${NAP}&ig=${NAP}`)).json();
  assert.equal(l.foglalasok[0].naptarEllenorzes, 'nem-futott');
  assert.equal(l.foglalasok[0].naptarEllenorzesSzoveg, 'A naptár-ellenőrzés nem futott le.');
  // sikeres ellenőrzésnél nincs jelölés
  const env2 = await bekotott();
  const g2 = googleFoglaltsag();
  assert.equal((await fetchCsere(g2, () => post(env2, '/foglalas-api/foglalas', alap({ kezd: '10:00' })))).status, 201);
  const l2 = await (await admin(env2, 'GET', `/api/foglalo/foglalasok?tol=${NAP}&ig=${NAP}`)).json();
  assert.equal(l2.foglalasok[0].naptarEllenorzes, null);
});

test('admin kézi felvétel és áthelyezés foglalt sávra: nem tilt, a válaszban figyelmeztet', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '10:00'), end: utc(NAP, '11:00') }, { start: utc(NAP, '14:00'), end: utc(NAP, '15:00') }]);
  await fetchCsere(g, async () => {
    const r = await admin(env, 'POST', '/api/foglalo/foglalasok', alap({ kezd: '10:00', email: '' }));
    assert.equal(r.status, 201, await r.clone().text());
    const d = await r.json();
    assert.match(d.figyelmeztetes, /saját naptárában foglalt/);
    const m = await admin(env, 'PATCH', `/api/foglalo/foglalasok/${d.azonosito}`, { datum: NAP, kezd: '14:00', kollega: 'szegedi-botond' });
    assert.equal(m.status, 200, await m.clone().text());
    assert.match((await m.json()).figyelmeztetes, /saját naptárában foglalt/);
    const m2 = await admin(env, 'PATCH', `/api/foglalo/foglalasok/${d.azonosito}`, { datum: NAP, kezd: '12:00', kollega: 'szegedi-botond' });
    assert.equal(m2.status, 200);
    assert.equal((await m2.json()).figyelmeztetes, undefined);
  });
});

// ---------------------------------------------------------------- 6. gyorsítótár

test('gyorsítótár: 5 percig friss; utána új lekérdezés; Google-hibánál legfeljebb 60 perces régi adat, utána a figyelés kiesik', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '10:00'), end: utc(NAP, '11:00') }]);
  const regit = (perc) => env.BOOKING_DB._raw.prepare(`UPDATE gcal_foglaltsag SET lekerdezve = ?`).run(Date.now() - perc * 60e3);
  await fetchCsere(g, async () => {
    assert.ok(!csakIdo(await kezdesek(env)).includes('10:00'));
    regit(6);
    assert.ok(!csakIdo(await kezdesek(env)).includes('10:00'));
    assert.equal(g.freeBusyHivasok().length, 2, '6 perces adat után újra kérdez');
    // Google-hiba, 30 perces adat: a régi adat számít (a 10:00 továbbra sem foglalható)
    g.hiba = 500;
    regit(30);
    assert.ok(!csakIdo(await kezdesek(env)).includes('10:00'));
    let a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
    assert.equal(a.kollegak.find((k) => k.id === 'szegedi-botond').foglaltsag.allapot, 'hiba');
    // 61 perces adat: a figyelés kiesik, a foglaló működik tovább
    regit(61);
    assert.ok(csakIdo(await kezdesek(env)).includes('10:00'));
    a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
    assert.equal(a.kollegak.find((k) => k.id === 'szegedi-botond').foglaltsag.allapot, 'hiba');
  });
  // a gyorsítótárban csak időszakok vannak (naptár, nap, sávok, lekérdezés ideje)
  const oszl = sorok(env, `SELECT name FROM pragma_table_info('gcal_foglaltsag')`).map((x) => x.name).sort();
  assert.deepEqual(oszl, ['datum', 'forras', 'lekerdezve', 'naptar_id', 'savok']);
});

// ---------------------------------------------------------------- 4, 10. saját naptár (events.list)

function sajatEsemenyek(datum) {
  return [
    // a foglaló saját eseménye (determinisztikus azonosító): nem számít
    { id: esemenyAzonosito('F0000000001', 'kollega'), summary: 'Gyógymasszázs · David teszt', start: { dateTime: utc(datum, '09:00') }, end: { dateTime: utc(datum, '09:50') }, extendedProperties: { private: { f360Foglalas: 'F0000000001' } } },
    // „szabad”-ként jelölt esemény: nem számít
    { id: 'atlatszo1', summary: 'Emlékeztető', transparency: 'transparent', start: { dateTime: utc(datum, '10:00') }, end: { dateTime: utc(datum, '11:00') } },
    // a kolléga által elutasított meghívó: nem számít
    { id: 'elutasitott1', summary: 'Meghívó', start: { dateTime: utc(datum, '11:00') }, end: { dateTime: utc(datum, '12:00') }, attendees: [{ email: KOLLEGA_NAPTAR, self: true, responseStatus: 'declined' }] },
    // törölt: nem számít
    { id: 'torolt1', status: 'cancelled', start: { dateTime: utc(datum, '12:00') }, end: { dateTime: utc(datum, '13:00') } },
    // magánprogram: számít
    { id: 'magan1', summary: 'Fogorvos (titkos szöveg)', description: 'privát leírás', start: { dateTime: utc(datum, '14:00') }, end: { dateTime: utc(datum, '15:00') } },
    // egész napos, „szabad” (a Google alapja): nem számít
    { id: 'egesznap1', summary: 'Névnap', transparency: 'transparent', start: { date: datum }, end: { date: datumPlusz(datum, 1) } },
  ];
}

test('saját naptár (ahova a foglaló is ír): events.list, a saját, átlátszó, elutasított és törölt esemény nem blokkol', async () => {
  const env = await bekotott({ naptarak: [KOLLEGA_NAPTAR] });
  await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
  const g = googleFoglaltsag();
  g.esemenyek.set(KOLLEGA_NAPTAR, sajatEsemenyek(NAP));
  const idok = csakIdo(await fetchCsere(g, () => kezdesek(env)));
  assert.deepEqual(idok.filter((x) => ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'].includes(x)), ['09:00', '10:00', '11:00', '12:00', '13:00', '15:00']);
  assert.equal(g.freeBusyHivasok().length, 0);
  const l = g.listaHivasok();
  assert.equal(l.length, 1);
  assert.equal(l[0].q.get('singleEvents'), 'true');
  // a gyorsítótárban nincs cím és leírás
  const tartalom = JSON.stringify(sorok(env, `SELECT * FROM gcal_foglaltsag`));
  assert.ok(!tartalom.includes('Fogorvos') && !tartalom.includes('privát'), tartalom);
});

test('stúdiónaptár mint foglaltság-naptár: szintén events.list; egész napos „Foglalt” esemény az egész napot lezárja', async () => {
  const env = await bekotott({ naptarak: [STUDIO_NAPTAR] });
  await szabalyAtir(env, { studioNaptarId: STUDIO_NAPTAR });
  const g = googleFoglaltsag();
  g.esemenyek.set(STUDIO_NAPTAR, [{ id: 'szabadsag1', summary: 'Szabadság', start: { date: NAP }, end: { date: datumPlusz(NAP, 1) } }]);
  const idok = csakIdo(await fetchCsere(g, () => kezdesek(env)));
  assert.deepEqual(idok, []);
  assert.equal(g.freeBusyHivasok().length, 0);
});

test('saját naptár csak szabad/foglalt joggal: az állapot „hiba” a magyar üzenettel, és nem blokkol (nem számolunk kétszer)', async () => {
  const env = await bekotott({ naptarak: [KOLLEGA_NAPTAR] });
  await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
  const g = googleFoglaltsag();
  g.jog.set(KOLLEGA_NAPTAR, 'szabadfoglalt');
  g.esemenyek.set(KOLLEGA_NAPTAR, sajatEsemenyek(NAP));
  await fetchCsere(g, async () => {
    assert.ok(csakIdo(await kezdesek(env)).includes('14:00'));
    const a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
    const f = a.kollegak.find((k) => k.id === 'szegedi-botond').foglaltsag;
    assert.equal(f.allapot, 'hiba');
    assert.equal(f.uzenet, NEM_RESZLET);
  });
});

// ---------------------------------------------------------------- 9. állapot

test('állapot: kollégánként foglaltsag { allapot, uzenet, ellenorizve }: ok, nincs-beallitva, nincs-hozzaferes', async () => {
  const env = await bekotott();
  await kollegaAtir(env, 'vas-luca', { foglaltsagNaptarak: ['vas.luca.nincs.megosztva@example.com'] });
  const g = googleFoglaltsag();
  g.jog.set('vas.luca.nincs.megosztva@example.com', 'nincs');
  const a = await fetchCsere(g, async () => (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json());
  assert.equal(a.foglaltsagFigyeles, true);
  const k = (id) => a.kollegak.find((x) => x.id === id);
  assert.equal(k('szegedi-botond').foglaltsag.allapot, 'ok');
  assert.deepEqual(k('szegedi-botond').foglaltsagNaptarak, [SAJAT]);
  assert.ok(Math.abs(Date.parse(k('szegedi-botond').foglaltsag.ellenorizve) - Date.now()) < 60e3);
  assert.equal(k('osvath-bence').foglaltsag.allapot, 'nincs-beallitva');
  assert.equal(k('osvath-bence').foglaltsag.ellenorizve, null);
  assert.equal(k('vas-luca').foglaltsag.allapot, 'nincs-hozzaferes');
  assert.match(k('vas-luca').foglaltsag.uzenet, /vas\.luca\.nincs\.megosztva@example\.com/);
  assert.match(k('vas-luca').foglaltsag.uzenet, /Csak a szabad\/foglalt időpontok megtekintése/);
  // a meg nem osztott naptár nem blokkol
  assert.equal(g.freeBusyHivasok().length, 1);
});

// ---------------------------------------------------------------- 8. ütközés-jelzés

test('ütközések: a később beírt saját programmal ütköző foglalás és csoportos óra jelezve, semmi nem törlődik', async () => {
  const env = await bekotott();
  await kollegaAtir(env, 'barkoczy-barbara', { foglaltsagNaptarak: ['barkoczy.sajat@example.com'] });
  const hetfo = kovNap(1);
  const g = googleFoglaltsag();
  let fId;
  let ora;
  await fetchCsere(g, async () => {
    const r = await post(env, '/foglalas-api/foglalas', alap({ kezd: '10:00' }));
    assert.equal(r.status, 201, await r.clone().text());
    fId = (await r.json()).azonosito;
    ora = (await (await get(env, `/foglalas-api/orak?helyszin=mexikoi&tol=${hetfo}&ig=${hetfo}`)).json()).orak.find((x) => x.kezd === '18:15');
    assert.ok(ora);
    // utólag: a kolléga 10:30-11:00 foglalt, az oktató 18:00-18:30
    g.foglalt.set(SAJAT, [{ start: utc(NAP, '10:30'), end: utc(NAP, '11:00') }]);
    g.foglalt.set('barkoczy.sajat@example.com', [{ start: utc(hetfo, '18:00'), end: utc(hetfo, '18:30') }]);
    env.BOOKING_DB._raw.prepare(`DELETE FROM gcal_foglaltsag`).run();
    const tol = budapestMost().datum;
    const ig = datumPlusz(tol, 20);
    const u = await admin(env, 'GET', `/api/foglalo/naptar/utkozesek?tol=${tol}&ig=${ig}`);
    assert.equal(u.status, 200, await u.clone().text());
    const d = await u.json();
    const fogl = d.utkozesek.find((x) => x.tipus === 'foglalas');
    assert.deepEqual(fogl, { azonosito: fId, tipus: 'foglalas', kollega: { id: 'szegedi-botond', nev: 'Szegedi Botond' }, datum: NAP, kezd: '10:00', veg: '10:50' });
    const o = d.utkozesek.find((x) => x.tipus === 'ora');
    assert.deepEqual(o, { azonosito: ora.id, tipus: 'ora', kollega: { id: 'barkoczy-barbara', nev: 'Barkóczy Barbara' }, datum: hetfo, kezd: '18:15', veg: '19:15' });
    assert.equal(d.utkozesek.length, 2);
  });
  assert.equal(sorok(env, `SELECT status FROM bookings WHERE id = ?`, fId)[0].status, 'megerositett');
  assert.equal(sorok(env, `SELECT status FROM class_sessions WHERE id = ?`, ora.id)[0].status, 'aktiv');
  // hibás tartomány: 400; kulcs nélkül üres lista
  assert.equal((await admin(env, 'GET', '/api/foglalo/naptar/utkozesek?tol=rossz&ig=x')).status, 400);
  const env2 = ujEnv();
  await kollegaAtir(env2, 'szegedi-botond', { foglaltsagNaptarak: [SAJAT] });
  const u2 = await (await admin(env2, 'GET', `/api/foglalo/naptar/utkozesek?tol=${NAP}&ig=${NAP}`)).json();
  assert.deepEqual(u2.utkozesek, []);
});

// ---------------------------------------------------------------- 11. keretek, időzóna

test('helyiSavok: UTC-sáv → budapesti helyi nap + perc, az október 25-i óraátállítás körül is', () => {
  // 2026-10-25 03:00 nyári idő → 02:00 téli idő (01:00 UTC)
  assert.deepEqual(helyiSavok('2026-10-24T08:00:00Z', '2026-10-24T09:00:00Z'), [{ datum: '2026-10-24', kezd: 600, veg: 660 }]);
  assert.deepEqual(helyiSavok('2026-10-25T09:00:00Z', '2026-10-25T10:00:00Z'), [{ datum: '2026-10-25', kezd: 600, veg: 660 }]);
  assert.deepEqual(helyiSavok('2026-10-26T09:00:00Z', '2026-10-26T10:00:00Z'), [{ datum: '2026-10-26', kezd: 600, veg: 660 }]);
  // éjfélen átnyúló sáv két napra bomlik (a váltás éjszakáján a 02:00-03:00 ismétlődő óra miatt két, átfedő darab,
  // amit a napokra() összevon: a lefedettség 0:00-8:00)
  const ejfel = helyiSavok('2026-10-24T20:00:00Z', '2026-10-25T07:00:00Z');
  assert.deepEqual(ejfel[0], { datum: '2026-10-24', kezd: 1320, veg: 1440 });
  const okt25 = ejfel.filter((x) => x.datum === '2026-10-25');
  assert.equal(Math.min(...okt25.map((x) => x.kezd)), 0);
  assert.equal(Math.max(...okt25.map((x) => x.veg)), 480);
  assert.deepEqual(helyiSavok('2026-10-23T20:00:00Z', '2026-10-24T07:00:00Z'), [{ datum: '2026-10-23', kezd: 1320, veg: 1440 }, { datum: '2026-10-24', kezd: 0, veg: 540 }]);
  // perc töredéke: a kezdés lefelé, a vég felfelé kerekít
  assert.deepEqual(helyiSavok('2026-10-26T09:00:30Z', '2026-10-26T09:10:10Z'), [{ datum: '2026-10-26', kezd: 600, veg: 611 }]);
});

test('freeBusy-hívás az óraátállításon át: timeMin/timeMax budapesti éjfél, egy hívás minden naptárra (legfeljebb 50/kérés)', async () => {
  const env = ujEnv({ GOOGLE_SA_KEY: await saKulcs() });
  const g = googleFoglaltsag();
  const naptarak = Array.from({ length: 55 }, (_, i) => `n${i}@group.calendar.google.com`);
  g.foglalt.set('n3@group.calendar.google.com', [{ start: '2026-10-25T09:00:00Z', end: '2026-10-25T10:00:00Z' }]);
  const most = Date.parse('2026-10-20T10:00:00Z');
  const e = await fetchCsere(g, () => foglaltsagLekerd(env, env.BOOKING_DB, { naptarak, tol: '2026-10-24', ig: '2026-10-26', most, keret: 10 }));
  const fb = g.freeBusyHivasok();
  assert.equal(fb.length, 2);
  assert.deepEqual(fb.map((h) => h.body.items.length), [50, 5]);
  assert.equal(fb[0].body.timeMin, '2026-10-23T22:00:00.000Z');
  assert.equal(fb[0].body.timeMax, '2026-10-26T23:00:00.000Z');
  assert.deepEqual(e.savok.get('n3@group.calendar.google.com').get('2026-10-25'), [[600, 660]]);
  assert.deepEqual(e.savok.get('n3@group.calendar.google.com').get('2026-10-24'), []);
  assert.equal(e.hianyos, false);
});

test('hívás-keret: egy kérés legfeljebb a keretnyi Google-hívást indít, a többi naptár ellenőrizetlen (hiányos) marad', async () => {
  const env = ujEnv({ GOOGLE_SA_KEY: await saKulcs() });
  const sajatok = ['a1@group.calendar.google.com', 'a2@group.calendar.google.com', 'a3@group.calendar.google.com', 'a4@group.calendar.google.com'];
  // mind a négy naptárba ír a foglaló (kolléga naptar_id), ezért mind events.list
  const t = await (await admin(env, 'GET', '/api/foglalo/beallitasok')).json();
  t.kollegak = t.kollegak.map((k, i) => (i < 4 ? { ...k, naptar_id: sajatok[i] } : k));
  env.BOOKING_DB._raw.prepare(`UPDATE settings SET ertek = ? WHERE kulcs = 'torzs'`).run(JSON.stringify(t));
  const g = googleFoglaltsag();
  const e = await fetchCsere(g, () => foglaltsagLekerd(env, env.BOOKING_DB, { naptarak: sajatok, tol: NAP, ig: NAP, keret: 3 }));
  assert.ok(g.tokenHivas + g.hivasok.length <= 3, `${g.tokenHivas} + ${g.hivasok.length}`);
  assert.equal(e.hianyos, true);
});

// ---------------------------------------------------------------- 12. kulcs nélkül, kikapcsolva

test('GOOGLE_SA_KEY nélkül semmi nem változik: ugyanaz a kínálat, Google-hívás nincs, a foglalás megy', async () => {
  const env = ujEnv();
  const alapLista = await kezdesek(env);
  await kollegaAtir(env, 'szegedi-botond', { foglaltsagNaptarak: [SAJAT] });
  const tilos = { fetch: async (u) => { throw new Error(`nem hívható: ${u}`); } };
  await fetchCsere(tilos, async () => {
    assert.deepEqual(await kezdesek(env), alapLista);
    const r = await post(env, '/foglalas-api/foglalas', alap({ kezd: '10:00' }));
    assert.equal(r.status, 201, await r.clone().text());
    const a = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
    assert.equal(a.kollegak.find((k) => k.id === 'szegedi-botond').foglaltsag.allapot, 'hiba');
    assert.equal(a.kollegak.find((k) => k.id === 'vas-luca').foglaltsag.allapot, 'nincs-beallitva');
  });
  assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM foglalas_naptar_jel`)[0].n, 0);
  for (const t of ['gcal_foglaltsag', 'gcal_foglaltsag_allapot']) assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
  // hiányzó kulcs és hibás kulcs: más-más üzenet (a hibás kulcsnál a kulcs hibájáé)
  const hianyzo = await (await admin(env, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.match(hianyzo.kollegak.find((k) => k.id === 'szegedi-botond').foglaltsag.uzenet, /hiányzik a GOOGLE_SA_KEY/);
  const hibas = await (await admin({ ...env, GOOGLE_SA_KEY: '{"rossz":1}' }, 'GET', '/api/foglalo/naptar/allapot')).json();
  assert.match(hibas.kollegak.find((k) => k.id === 'szegedi-botond').foglaltsag.uzenet, /kulcsa hibás/);
});

test('GOOGLE_API_TESZT_ALAP: csak helyi (127.0.0.1, localhost) cím és DEV_EMAIL mellett fogadható el, egyébként a valódi Google-cím marad', async () => {
  const { apiAlap } = await import('../functions/_lib/booking/naptar.js');
  const dev = { DEV_EMAIL: 'dev@helyi.teszt' };
  assert.equal(apiAlap({}), 'https://www.googleapis.com/calendar/v3/');
  assert.equal(apiAlap({ ...dev, GOOGLE_API_TESZT_ALAP: 'http://127.0.0.1:8799' }), 'http://127.0.0.1:8799/calendar/v3/');
  assert.equal(apiAlap({ GOOGLE_API_TESZT_ALAP: 'http://127.0.0.1:8799' }), 'https://www.googleapis.com/calendar/v3/', 'DEV_EMAIL nélkül');
  for (const rossz of ['https://evil.example.com', 'http://127.0.0.1.evil.com:80', 'http://10.0.0.1:80', 'http://localhost', 'file:///x']) {
    assert.equal(apiAlap({ ...dev, GOOGLE_API_TESZT_ALAP: rossz }), 'https://www.googleapis.com/calendar/v3/', rossz);
  }
});

// ---------------------------------------------------------------- review utáni javítások

test('nyilvános kínálat: a Google-lekérdezés a [ma, ma + maxEloreNap] ablakra vágva; ablakon kívüli kérés nem hív Google-t', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  const ma = budapestMost().datum;
  await fetchCsere(g, async () => {
    // a 60 napos ablakon túli 14 nap: Google-hívás nincs, és nem kerül sor a gyorsítótárba
    const tul = datumPlusz(ma, 70);
    assert.equal((await get(env, szabadUrl({ tol: tul, ig: datumPlusz(tul, 13) }))).status, 200);
    // múltbeli napok: szintén nincs hívás
    assert.equal((await get(env, szabadUrl({ tol: datumPlusz(ma, -20), ig: datumPlusz(ma, -7) }))).status, 200);
    assert.equal(g.freeBusyHivasok().length, 0);
    assert.equal(sorok(env, `SELECT COUNT(*) AS n FROM gcal_foglaltsag`)[0].n, 0);
    // az ablak szélén átnyúló kérésnél csak az ablakon belüli napok
    const szel = datumPlusz(ma, 55);
    await get(env, szabadUrl({ tol: szel, ig: datumPlusz(szel, 13) }));
    const fb = g.freeBusyHivasok();
    assert.equal(fb.length, 1);
    assert.equal(fb[0].body.timeMax, new Date(helyiToUtc(datumPlusz(ma, 61), 0)).toISOString());
  });
});

test('Google-hiba foglaláskor, gyorsítótárból felkínált hézag-kezdésre: a foglalás megy (jelölve)', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '09:20'), end: utc(NAP, '10:20') }]);
  await fetchCsere(g, async () => {
    assert.ok(csakIdo(await kezdesek(env)).includes('10:30'));
    g.hiba = 503;
    const r = await post(env, '/foglalas-api/foglalas', alap({ kezd: '10:30' }));
    assert.equal(r.status, 201, await r.clone().text());
  });
  assert.equal(sorok(env, `SELECT jel FROM foglalas_naptar_jel`)[0].jel, 'nem-futott');
});

test('Google-hiba foglaláskor: a legfeljebb 60 perces régi adat nem tilt, a foglalás megy (jelölve)', async () => {
  const env = await bekotott();
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '13:00'), end: utc(NAP, '14:00') }]);
  await fetchCsere(g, async () => {
    assert.ok(!csakIdo(await kezdesek(env)).includes('13:00'));
    env.BOOKING_DB._raw.prepare(`UPDATE gcal_foglaltsag SET lekerdezve = ?`).run(Date.now() - 20 * 60e3);
    g.hiba = 503;
    const r = await post(env, '/foglalas-api/foglalas', alap({ kezd: '13:00' }));
    assert.equal(r.status, 201, await r.clone().text());
  });
  assert.equal(sorok(env, `SELECT jel FROM foglalas_naptar_jel`)[0].jel, 'nem-futott');
});

test('helyiSavok: a lekérdezett tartományra vágva (nagyon hosszú esemény is), és az október 25-i ismétlődő óra nem esik ki', () => {
  // több mint 400 napos esemény: a tartományra vágva a tartomány napja foglalt
  assert.deepEqual(helyiSavok('2024-01-01T00:00:00Z', '2027-01-01T00:00:00Z', { tol: '2026-10-26', ig: '2026-10-26' }), [{ datum: '2026-10-26', kezd: 0, veg: 1440 }]);
  // 2026-10-25 00:30Z (02:30 nyári) - 01:30Z (02:30 téli): a falióra 02:00 és 03:00 között mindkét felét lefedi
  const s = helyiSavok('2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z');
  assert.ok(s.length >= 1, JSON.stringify(s));
  assert.ok(s.every((x) => x.datum === '2026-10-25' && x.kezd < x.veg), JSON.stringify(s));
  assert.equal(Math.min(...s.map((x) => x.kezd)), 120);
  assert.equal(Math.max(...s.map((x) => x.veg)), 180);
});

test('gyorsítótár: a naptár szerepének váltásakor (freeBusy helyett events.list) a régi gyorsítótár nem számít', async () => {
  const env = await bekotott({ naptarak: [KOLLEGA_NAPTAR] });
  const g = googleFoglaltsag();
  // freeBusy-módban a foglaló saját eseménye is foglaltnak látszik (14:00), ez kerül a gyorsítótárba
  g.foglalt.set(KOLLEGA_NAPTAR, [{ start: utc(NAP, '14:00'), end: utc(NAP, '15:00') }]);
  g.esemenyek.set(KOLLEGA_NAPTAR, [{ id: esemenyAzonosito('F0000000009', 'kollega'), start: { dateTime: utc(NAP, '14:00') }, end: { dateTime: utc(NAP, '15:00') } }]);
  await fetchCsere(g, async () => {
    assert.ok(!csakIdo(await kezdesek(env)).includes('14:00'));
    // a naptár ettől kezdve a foglaló írási célja is: events.list kell, a saját esemény nem blokkol
    await kollegaAtir(env, 'szegedi-botond', { naptar_id: KOLLEGA_NAPTAR });
    assert.ok(csakIdo(await kezdesek(env)).includes('14:00'));
    assert.equal(g.listaHivasok().length, 1);
  });
});

test('ütközések: a ma már elkezdődött foglalás nem jelzett, a későbbi igen', async () => {
  const { utkozesek } = await import('../functions/_lib/booking/foglaltsag.js');
  const env = await bekotott();
  const most = helyiToUtc(NAP, 12 * 60); // NAP 12:00 a „most”
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '09:00'), end: utc(NAP, '17:00') }]);
  const db = env.BOOKING_DB;
  await fetchCsere(g, async () => {
    for (const [id, kezd] of [['FMULT000001', 600], ['FJOVO000001', 840]]) {
      db._raw.prepare(`INSERT INTO bookings (id, location_id, service_id, staff_id, date, start_min, dur_min, buffer_min, name, token_salt, created_at)
        VALUES (?, 'mexikoi', 'gyogymasszazs-50', 'szegedi-botond', ?, ?, 50, 10, ?, 'so', 1)`).run(id, NAP, kezd, TESZT_NEV);
    }
    const d = await utkozesek(env, db, new URLSearchParams({ tol: NAP, ig: NAP }), { most });
    assert.deepEqual(d.utkozesek.map((x) => x.azonosito), ['FJOVO000001']);
  });
});

test('foglaltsagFigyeles: false mellett kulccsal sincs Google-hívás és a foglalt sáv is kínálható', async () => {
  const env = await bekotott();
  await szabalyAtir(env, { foglaltsagFigyeles: false });
  const g = googleFoglaltsag();
  g.foglalt.set(SAJAT, [{ start: utc(NAP, '10:00'), end: utc(NAP, '11:00') }]);
  await fetchCsere(g, async () => {
    assert.ok(csakIdo(await kezdesek(env)).includes('10:00'));
    assert.equal((await post(env, '/foglalas-api/foglalas', alap({ kezd: '10:00' }))).status, 201);
  });
  assert.equal(g.hivasok.length + g.tokenHivas, 0);
});
