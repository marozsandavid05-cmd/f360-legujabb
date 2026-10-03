// Időpontfoglaló · „Állandó időpont”: a stúdió-értesítő (létrehozás és leállítás) és a leállítás
// utólag korábbi naptól (Caesar, 2026-10-03). Valódi SQLite-tal. Tesztadat: „David teszt”.
// A minta-beosztásban Szegedi Botond szerdán a Mexikóiban 9-17.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, kollegaAtir, kovNap, outbox, sorok, szabalyAtir, ujEnv } from './_foglalo.mjs';
import { budapestMost, datumPlusz } from '../functions/_lib/booking/ido.js';

const SZERDA = kovNap(3);
const het = (n) => datumPlusz(SZERDA, 7 * n);
const sorozatBe = (o = {}) => ({
  helyszin: 'mexikoi', szolgaltatas: 'gyogymasszazs-50', kollega: 'szegedi-botond',
  nap: 3, kezd: '16:00', ismetles: 1, kezdoDatum: SZERDA, vege: { tipus: 'alkalom', db: 4 }, ...o,
});
const vendeg = (o = {}) => ({ nev: 'David teszt', email: 'david.teszt@example.com', telefon: '+36 30 123 4567', megjegyzes: '', ...o });
async function letrehozOk(e, o = {}, extra = {}) {
  const r = await admin(e, 'POST', '/api/foglalo/sorozatok', { ...sorozatBe(o), vendeg: vendeg(), ...extra });
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
}
const leallit = (e, id, body = {}) => admin(e, 'POST', `/api/foglalo/sorozatok/${id}/leallitas`, body);
const allapotok = (e, id) => sorok(e, `SELECT date, status FROM bookings WHERE sorozat_id = ? ORDER BY date`, id).map((x) => [x.date, x.status]);

// ---------------------------------------------------------------- stúdió-értesítő

test('stúdió-értesítő: létrehozáskor és leállításkor egy-egy sorozat-studio levél a stúdió címére, a kolléga nevével', async () => {
  const e = ujEnv();
  await szabalyAtir(e, { studioEmail: 'studio.teszt@example.com' });
  const d = await letrehozOk(e);
  const uj = outbox(e, 'sorozat-studio');
  assert.equal(uj.length, 1);
  assert.equal(uj[0].cimzett, 'studio.teszt@example.com');
  assert.equal(uj[0].booking_id, d.sorozat.id);
  assert.match(uj[0].targy, /^Új állandó időpont · David teszt · .* · Szegedi Botond$/);
  assert.ok(!uj[0].szoveg.includes('lemondas?t='), 'a vendég lemondó linkje nem kerül a stúdió levelébe');
  assert.equal(((uj[0].szoveg.split('Alkalmak:')[1] || '').match(/^- /gm) || []).length, 4);

  assert.equal((await leallit(e, d.sorozat.id, { tol: het(2) })).status, 200);
  const st = outbox(e, 'sorozat-studio');
  assert.equal(st.length, 2);
  assert.match(st[1].targy, /^Leállt állandó időpont · David teszt · .* · Szegedi Botond$/);
  assert.equal(((st[1].szoveg.split('Lemondott alkalmak:')[1] || '').match(/^- /gm) || []).length, 2);
  // a folytató hívás (409) nem küld újat
  assert.equal((await leallit(e, d.sorozat.id, {})).status, 409);
  assert.equal(outbox(e, 'sorozat-studio').length, 2);
});

test('stúdió-értesítő: üres stúdió-címnél nem kerül az outboxba (és a leállítás nem bukik el)', async () => {
  const e = ujEnv();
  await szabalyAtir(e, { studioEmail: '' });
  const d = await letrehozOk(e, {}, { vendeg: vendeg({ email: '' }) });
  assert.equal(outbox(e, 'sorozat-studio').length, 0);
  assert.equal((await leallit(e, d.sorozat.id, {})).status, 200);
  assert.equal(outbox(e, 'sorozat-studio').length, 0);
});

test('stúdió-értesítő: csak a stúdió címe van (vendég és kolléga e-mail nélkül), a második leállítás 409, a levél egyszer megy', async () => {
  const e = ujEnv();
  await szabalyAtir(e, { studioEmail: 'studio.teszt@example.com', ertesitKollega: false });
  const d = await letrehozOk(e, {}, { vendeg: vendeg({ email: '' }) });
  assert.equal((await leallit(e, d.sorozat.id, {})).status, 200);
  assert.equal((await leallit(e, d.sorozat.id, {})).status, 409);
  assert.equal(outbox(e, 'sorozat-studio').filter((l) => l.targy.startsWith('Leállt')).length, 1);
});

// ---------------------------------------------------------------- leállítás utólag korábbi naptól

test('leállítás utólag korábbi naptól: a köztes alkalmak is lemondva, a leallitva_tol frissül, új levelek csak az új alkalmakkal', async () => {
  const e = ujEnv();
  await kollegaAtir(e, 'szegedi-botond', { email: 'botond@example.com' });
  await szabalyAtir(e, { studioEmail: 'studio.teszt@example.com' });
  const d = await letrehozOk(e);
  const id = d.sorozat.id;
  assert.equal((await leallit(e, id, { tol: het(3) })).status, 200);
  assert.deepEqual(allapotok(e, id).map((x) => x[1]), ['megerositett', 'megerositett', 'megerositett', 'lemondva']);
  const elotte = outbox(e).length;

  const r = await leallit(e, id, { tol: het(1) });
  assert.equal(r.status, 200, await r.clone().text());
  const v = await r.json();
  assert.deepEqual(v.lemondott.map((x) => x.datum), [het(1), het(2)]);
  assert.deepEqual(allapotok(e, id), [[het(0), 'megerositett'], [het(1), 'lemondva'], [het(2), 'lemondva'], [het(3), 'lemondva']]);
  assert.equal(sorok(e, 'SELECT leallitva_tol FROM sorozatok WHERE id = ?', id)[0].leallitva_tol, het(1));
  // a lemondott alkalmak zárai felszabadultak
  for (const x of v.lemondott) assert.equal(sorok(e, 'SELECT * FROM slot_locks WHERE booking_id = ?', x.id).length, 0);

  const uj = outbox(e).slice(elotte);
  assert.deepEqual(uj.map((l) => l.tipus).sort(), ['sorozat-kollega', 'sorozat-leallitva', 'sorozat-studio']);
  const vend = uj.find((l) => l.tipus === 'sorozat-leallitva').szoveg;
  const lemResz = vend.split('Ezek az alkalmak megmaradnak')[0];
  assert.equal((lemResz.match(/^- /gm) || []).length, 2, 'csak az újonnan lemondott két alkalom');
  assert.equal((vend.match(/lemondas\?t=/g) || []).length, 1, 'a megmaradt egy alkalom linkje');
  for (const t of ['sorozat-kollega', 'sorozat-studio']) {
    const sz = uj.find((l) => l.tipus === t).szoveg;
    assert.equal(((sz.split('Lemondott alkalmak:')[1] || '').match(/^- /gm) || []).length, 2, t);
  }

  // ugyanez a nap még egyszer, vagy későbbi nap: 409, nincs új levél
  assert.equal((await leallit(e, id, { tol: het(1) })).status, 409);
  assert.equal((await leallit(e, id, { tol: het(2) })).status, 409);
  assert.equal(outbox(e).length, elotte + 3);
});

test('leállítás utólag: tol nélkül (ma) a már leállított sorozat NEM bővül, múltbeli tol 400', async () => {
  const e = ujEnv();
  const d = await letrehozOk(e);
  assert.equal((await leallit(e, d.sorozat.id, { tol: het(2) })).status, 200);
  assert.equal((await leallit(e, d.sorozat.id, {})).status, 409);
  assert.equal((await leallit(e, d.sorozat.id, { tol: datumPlusz(budapestMost().datum, -1) })).status, 400);
  assert.deepEqual(allapotok(e, d.sorozat.id).map((x) => x[1]), ['megerositett', 'megerositett', 'lemondva', 'lemondva']);
  assert.equal(sorok(e, 'SELECT leallitva_tol FROM sorozatok WHERE id = ?', d.sorozat.id)[0].leallitva_tol, het(2));
});

test('leállítás utólag korábbi naptól, ha a köztes időben nincs megerősített alkalom: 200, a nap frissül, levél nem megy', async () => {
  const e = ujEnv();
  const d = await letrehozOk(e);
  const id = d.sorozat.id;
  assert.equal((await leallit(e, id, { tol: het(2) })).status, 200);
  // a köztes alkalmat a vendég már lemondta
  assert.equal((await admin(e, 'POST', `/api/foglalo/foglalasok/${d.letrejott[1].id}/lemondas`)).status, 200);
  const elotte = outbox(e).length;
  const r = await leallit(e, id, { tol: het(1) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await r.json()).lemondott, []);
  assert.equal(sorok(e, 'SELECT leallitva_tol FROM sorozatok WHERE id = ?', id)[0].leallitva_tol, het(1));
  assert.ok(!outbox(e).slice(elotte).some((l) => l.tipus === 'sorozat-leallitva'), 'üres lemondott listával nincs vendég-levél');
});
