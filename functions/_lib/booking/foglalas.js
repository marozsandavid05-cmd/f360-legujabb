// Időpontfoglaló · üzleti logika (adatbázis-hozzáférés + szabályok). A HTTP-réteg a
// functions/foglalas-api és functions/api/foglalo alatti routerekben van.

import { HttpError } from '../http.js';
import { RACS, budapestMost, datumPlusz, ervenyesDatum, helyiToUtc, kezdesPerc, napok, percToHHMM } from './ido.js';
import { foglalasSlotjai, kezdesAlakja, kinalasLepes, szabadIdopontok } from './szabad.js';
import { sema, szamitasiTorzs, titok, torzsBetolt } from './schema.js';
import { tokenAzonosito, tokenEllenoriz, tokenKeszit, ujAzonosito, ujSo } from './token.js';
import { icsKeszit } from './ics.js';
import { lemondasLevel, modositasLevel, studioErtesito, studioModositas, visszaigazolas } from './levelek.js';
import { kollegaCim, kollegaLemondas, kollegaModositas, kollegaUj } from './levelek-kollega.js';
import { levelSorok, mailMod } from './mailer.js';
import { forrasBemenet, forrasOlvas } from './forras.js';
import { AKTIV_KOLLEGA_SQL } from './torzs-alap.js';

export const NAPI_KORLAT = 20; // foglalási kísérlet IP-nként naponta
export const MAX_NAP_EGY_KERESBEN = 14;
const UTKOZES = 'Ezt az időpontot közben lefoglalták. Kérjük, válassz másikat.';
const KOZBEN_MODOSULT = 'A foglalást közben módosították. Kérjük, töltsd újra az oldalt.';
const NEM_FOGLALHATO = 'Ez az időpont nem foglalható. Kérjük, válassz a szabad időpontok közül.';

export function dbVagy503(env) {
  if (!env.BOOKING_DB) throw new HttpError(503, 'Az időpontfoglalás most nem elérhető. Kérjük, hívj minket telefonon.');
  return env.BOOKING_DB;
}

// ---------------------------------------------------------------- beolvasás

export async function beosztasBetolt(db) {
  const { results } = await db.prepare(
    `SELECT staff_id, weekday, location_id, start_min, end_min FROM schedule ORDER BY staff_id, weekday, start_min`,
  ).all();
  return (results || []).map((r) => ({ kollega: r.staff_id, nap: r.weekday, helyszin: r.location_id, kezd: r.start_min, veg: r.end_min }));
}

export async function kivetelekBetolt(db, tol, ig) {
  const { results } = await db.prepare(
    `SELECT id, staff_id, location_id, date_from, date_to, start_min, end_min, note FROM exceptions
     WHERE date_to >= ? AND date_from <= ? ORDER BY date_from, start_min`,
  ).bind(tol, ig).all();
  return (results || []).map((r) => ({
    id: r.id, kollega: r.staff_id, helyszin: r.location_id, tol: r.date_from, ig: r.date_to, kezd: r.start_min, veg: r.end_min, megjegyzes: r.note,
  }));
}

/**
 * A foglalt idő rácspontjai a tartományban. A forrás maguk az élő foglalások (nem a slot_locks), az aktuális
 * zár-rácsra vetítve: így egy korábbi (15 perces) zár-rácson tárolt foglalás is pontosan a saját idejét
 * foglalja (2026-10-21, a zár-rács 15 percről 5 percre váltott). A dupla foglalást továbbra is a
 * slot_locks UNIQUE kulcsa és az ATFEDES_NINCS_SQL őr zárja ki az írásnál.
 */
export async function foglaltBetolt(db, tol, ig, kiveveFoglalas = null) {
  const { results } = await db.prepare(
    `SELECT staff_id, date, start_min, dur_min, buffer_min FROM bookings
     WHERE status = 'megerositett' AND date >= ? AND date <= ? AND id != ?`,
  ).bind(tol, ig, kiveveFoglalas || '').all();
  return (results || []).flatMap((r) => foglalasSlotjai({ kollega: r.staff_id, datum: r.date, kezd: r.start_min, perc: r.dur_min, puffer: r.buffer_min }));
}

/**
 * Írás-oldali átfedés-őr: ugyanannál a kollégánál, ugyanazon a napon nincs másik élő foglalás, amely a
 * [kezdés, kezdés + idő + puffer) szakasszal átfed (a saját pufferével együtt). A zárak mellett ez akkor is
 * véd, ha egy régebbi foglalás zárai még a korábbi rácson vannak. Paraméterek (atfedesParams):
 * kolléga, dátum, kivéve-azonosító, új vég, új kezdés.
 */
export const ATFEDES_NINCS_SQL = `NOT EXISTS (SELECT 1 FROM bookings o WHERE o.staff_id = ? AND o.date = ?
  AND o.status = 'megerositett' AND o.id != ? AND o.start_min < ? AND o.start_min + o.dur_min + o.buffer_min > ?)`;
const atfedesParams = (kollega, datum, kiveve, kezd, perc, puffer) => [kollega, datum, kiveve || '', kezd + perc + puffer, kezd];

// ---------------------------------------------------------------- katalógus és szabad időpontok

export async function katalogus(db) {
  const t = await torzsBetolt(db);
  const ma = budapestMost().datum;
  const beosztas = await beosztasBetolt(db);
  const aktivK = t.kollegak.filter((k) => k.archivalt !== true && !(k.aktiv_ig && k.aktiv_ig < ma));
  // van-e foglalható beosztás a szolgáltatáshoz (ha nincs, a felület a telefonszámot mutatja)
  const vanBeosztas = (s) => aktivK.some((k) => k.szolgaltatasok.includes(s.id)
    && beosztas.some((b) => b.kollega === k.id && s.helyszinek.includes(b.helyszin) && k.helyszinek.includes(b.helyszin)));
  return {
    minta: t.minta === true,
    helyszinek: t.helyszinek.map(({ id, nev, cim, nyit, zar, napiNyitvatartas }) => ({ id, nev, cim, nyit, zar, ...(napiNyitvatartas ? { napiNyitvatartas } : {}) })),
    szolgaltatasok: t.szolgaltatasok.map((s) => ({
      id: s.id, nev: s.nev, perc: s.perc, ar: s.ar, helyszinek: s.helyszinek,
      lepes: kinalasLepes(s, t.szabalyok), // a felkínált kezdések lépése percben
      ...(s.leiras ? { leiras: s.leiras } : {}), ...(s.elokeszites ? { elokeszites: s.elokeszites } : {}),
      vanBeosztas: vanBeosztas(s),
    })),
    // az archivált és a már kilépett kolléga nem látszik; a privát e-mail soha nem kerül ide
    kollegak: aktivK
      .map(({ id, nev, szerep, helyszinek, szolgaltatasok, foto, bemutatkozas }) => ({ id, nev, szerep, helyszinek, szolgaltatasok, foto, bemutatkozas })),
    szabalyok: {
      lemondasOra: t.szabalyok.lemondasOra, minEloreOra: t.szabalyok.minEloreOra, maxEloreNap: t.szabalyok.maxEloreNap, telefon: t.szabalyok.telefon,
    },
  };
}

export function hivatkozasok(torzs, { helyszin, szolgaltatas, kollega }) {
  const hely = torzs.helyszinek.find((h) => h.id === helyszin);
  if (!hely) throw new HttpError(400, 'Ismeretlen helyszín.');
  const szolg = torzs.szolgaltatasok.find((s) => s.id === szolgaltatas);
  if (!szolg || !szolg.helyszinek.includes(helyszin)) throw new HttpError(400, 'Ez a szolgáltatás ezen a helyszínen nem foglalható.');
  let koll = null;
  if (kollega !== 'barki') {
    koll = torzs.kollegak.find((k) => k.id === kollega && k.archivalt !== true);
    if (!koll) throw new HttpError(400, 'Ismeretlen szakember.');
    if (!koll.helyszinek.includes(helyszin) || !koll.szolgaltatasok.includes(szolgaltatas)) {
      throw new HttpError(400, 'A kiválasztott szakember ezt a szolgáltatást ezen a helyszínen nem végzi.');
    }
  }
  return { hely, szolg, koll };
}

/**
 * Szabad időpontok. Módosításhoz a foglalás is megadható: nyilvánosan `t` (lemondó/módosító
 * token), az adminban `foglalas` (azonosító). Ilyenkor a helyszín és a szolgáltatás a foglalásból
 * jön (eltérő érték 400), a saját foglalás zárai szabadnak számítanak, és a foglaláskor rögzített
 * időtartam és puffer számít. Az admin nézetben nincs minEloreOra és maxEloreNap.
 */
export async function szabad(db, q, { env = {}, most = Date.now(), admin = false } = {}) {
  const tol = q.get('tol');
  const ig = q.get('ig');
  if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw new HttpError(400, 'Hibás dátum-tartomány.');
  if (napok(tol, ig, MAX_NAP_EGY_KERESBEN + 1).length > MAX_NAP_EGY_KERESBEN) {
    throw new HttpError(400, `Egyszerre legfeljebb ${MAX_NAP_EGY_KERESBEN} nap kérhető le.`);
  }
  const kollega = q.get('kollega') || 'barki';
  let row = null;
  if (!admin && q.has('t')) row = await tokenFoglalas(env, db, q.get('t'));
  if (admin && q.has('foglalas')) row = await foglalasAzonositoval(db, q.get('foglalas'));
  const alapTorzs = await torzsBetolt(db);
  if (row) {
    modosithatoAllapot(row, alapTorzs, { admin, most });
    for (const [p, col] of [['helyszin', 'location_id'], ['szolgaltatas', 'service_id']]) {
      if (q.get(p) && q.get(p) !== row[col]) throw new HttpError(400, 'Módosításkor a helyszín és a szolgáltatás nem változhat.');
    }
  }
  const p = { helyszin: row ? row.location_id : q.get('helyszin'), szolgaltatas: row ? row.service_id : q.get('szolgaltatas'), kollega };
  hivatkozasok(alapTorzs, p);
  const [beosztas, kivetelek, foglalt] = await Promise.all([beosztasBetolt(db), kivetelekBetolt(db, tol, ig), foglaltBetolt(db, tol, ig, row && row.id)]);
  return szabadIdopontok({ torzs: szamitasiTorzs(szamitasra(alapTorzs, { admin, row })), beosztas, kivetelek, foglalt, most, ...p, tol, ig });
}

/**
 * A számításhoz használt törzs: adminnak nincs minEloreOra és maxEloreNap korlát, és bármely 15 perces
 * rácspontra vehet fel (a kínálás-beállítás rá nem vonatkozik); módosításnál a szolgáltatás a foglaláskor
 * rögzített időtartammal és pufferrel számít (ha azóta átírták is).
 */
export function szamitasra(torzs, { admin = false, row = null } = {}) {
  let t = admin ? {
    ...torzs,
    szabalyok: { ...torzs.szabalyok, minEloreOra: 0, maxEloreNap: 3660 },
    szolgaltatasok: torzs.szolgaltatasok.map((s) => ({ ...s, kinalas: RACS })),
  } : torzs;
  if (row) {
    t = { ...t, szolgaltatasok: t.szolgaltatasok.map((s) => (s.id === row.service_id ? { ...s, perc: row.dur_min, puffer: row.buffer_min } : s)) };
  }
  return t;
}

// ---------------------------------------------------------------- bemenet ellenőrzése

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const TEL_RE = /^[+0-9 ()/.-]{6,24}$/;

function szoveg(v, max, { egysoros = false } = {}) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new HttpError(400, 'Hibás kérés.');
  let s = v.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // név, e-mail, telefon: egy sor (a sortörés a levél tárgyába és a fejlécekbe se kerülhessen)
  if (egysoros) s = s.replace(/[\t\r\n\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (s.length > max) throw new HttpError(400, `Túl hosszú szöveg (legfeljebb ${max} karakter).`);
  return s;
}

/** Az ügyfél adatai (név, e-mail, telefon, megjegyzés, hozzájárulás); az egyéni és a csoportos foglalás közös része. */
export function ugyfelBemenet(d, { admin = false } = {}) {
  const nev = szoveg(d.nev, 100, { egysoros: true });
  const email = szoveg(d.email, 254, { egysoros: true }).toLowerCase();
  const telefon = szoveg(d.telefon, 24, { egysoros: true });
  const megjegyzes = szoveg(d.megjegyzes, 1000);
  if (nev.length < 2) throw new HttpError(400, 'Kérjük, add meg a neved.');
  if (!admin || email) {
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Kérjük, adj meg egy érvényes e-mail-címet.');
  }
  if (!admin || telefon) {
    if (!TEL_RE.test(telefon) || telefon.replace(/\D/g, '').length < 6) throw new HttpError(400, 'Kérjük, adj meg egy érvényes telefonszámot.');
  }
  if (!admin && d.hozzajarul !== true) throw new HttpError(400, 'A foglaláshoz el kell fogadnod az adatkezelési tájékoztatót.');
  return { nev, email, telefon, megjegyzes, forras: forrasBemenet(d.forras) };
}

export function foglalasBemenet(d, { admin = false } = {}) {
  const { nev, email, telefon, megjegyzes, forras } = ugyfelBemenet(d, { admin });
  if (!ervenyesDatum(d.datum)) throw new HttpError(400, 'Hibás dátum.');
  const kezdPerc = kezdesPerc(d.kezd); // 5 perces pontosság (InBody :50); a felkínáltságot a szabad-számítás dönti el
  if (kezdPerc == null) throw new HttpError(400, 'Hibás időpont.');
  for (const k of ['helyszin', 'szolgaltatas']) if (typeof d[k] !== 'string') throw new HttpError(400, 'Hibás kérés.');
  const kollega = d.kollega == null || d.kollega === '' ? 'barki' : d.kollega;
  if (typeof kollega !== 'string') throw new HttpError(400, 'Hibás kérés.');
  return { helyszin: d.helyszin, szolgaltatas: d.szolgaltatas, kollega, datum: d.datum, kezdPerc, nev, email, telefon, megjegyzes, forras };
}

// ---------------------------------------------------------------- nézetek

export function nezet(row, torzs) {
  const hely = torzs.helyszinek.find((h) => h.id === row.location_id) || { id: row.location_id, nev: row.location_id, cim: '' };
  const szolg = torzs.szolgaltatasok.find((s) => s.id === row.service_id) || { id: row.service_id, nev: row.service_id };
  const koll = torzs.kollegak.find((k) => k.id === row.staff_id) || { id: row.staff_id, nev: row.staff_id };
  return {
    azonosito: row.id,
    allapot: row.status,
    helyszin: { id: hely.id, nev: hely.nev, cim: hely.cim },
    szolgaltatas: { id: szolg.id, nev: szolg.nev, perc: row.dur_min, ar: row.price, ...(szolg.elokeszites ? { elokeszites: szolg.elokeszites } : {}) },
    kollega: { id: koll.id, nev: koll.nev, ...(koll.szin ? { szin: koll.szin } : {}) },
    datum: row.date,
    kezd: percToHHMM(row.start_min),
    veg: percToHHMM(row.start_min + row.dur_min),
    kezdPerc: row.start_min,
    nev: row.name,
    email: row.email,
    telefon: row.phone,
    megjegyzes: row.note,
    forras: row.source,
  };
}

/** Az ügyfélnek visszaadható rész (e-mail, telefon és megjegyzés nélkül). */
export function publikusNezet(f) {
  const { azonosito, allapot, helyszin, szolgaltatas, kollega, datum, kezd, veg, nev } = f;
  return { azonosito, allapot, helyszin, szolgaltatas, kollega: { id: kollega.id, nev: kollega.nev }, datum, kezd, veg, nev };
}

// ---------------------------------------------------------------- IP-korlát

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function ipKorlat(env, db, request) {
  await sema(db);
  const nap = budapestMost().datum;
  const ip = request.headers.get('CF-Connecting-IP') || 'ismeretlen';
  const iph = (await sha256hex(`${nap}|${ip}|${await titok(env, db)}`)).slice(0, 32);
  const n = await db.prepare(
    `INSERT INTO foglalas_korlat (iph, nap, n) VALUES (?, ?, 1)
     ON CONFLICT(iph, nap) DO UPDATE SET n = n + 1 RETURNING n`,
  ).bind(iph, nap).first('n');
  await db.prepare(`DELETE FROM foglalas_korlat WHERE nap < ?`).bind(datumPlusz(nap, -2)).run();
  if (Number(n) > NAPI_KORLAT) throw new HttpError(429, 'Ma már túl sok foglalási kísérlet érkezett erről a hálózatról. Kérjük, hívj minket telefonon.');
}

/**
 * A kezdésre jelölt kollégák. Felkínált kezdés a beosztás szerinti rács (foglalások nélkül számolva) és
 * a meglévő foglalások utáni hézagkitöltő kezdés (a foglalásokkal számolva). Előbb a most szabadnak
 * látszók, utána a többi (hátha közben felszabadult); a végső döntést a slot_locks hozza meg.
 */
function jeloltKollegak(alap, foglalt, datum, kezd) {
  const keres = (f) => ((szabadIdopontok({ ...alap, foglalt: f }).napok[datum] || []).find((s) => s.kezd === kezd) || { kollegak: [] }).kollegak;
  const mostSzabad = keres(foglalt);
  const jeloltek = [...new Set([...mostSzabad, ...keres([])])];
  if (!jeloltek.length) throw new HttpError(409, NEM_FOGLALHATO);
  return jeloltek;
}

/**
 * A foglalás zárai EGY utasításban (a rácspontok JSON-tömbként, json_each): az 5 perces zár-rács
 * miatt egy 50 perces foglalás 12 zár, és soronként külön INSERT a D1 kérésenkénti lekérdezés-keretét
 * (állandó időpontnál 104 alkalom) feleslegesen terhelné. A `foglalasSql` a booking_id-t adó
 * részlekérdezés: ha NULL (a foglalás nem jött létre, vagy a feltétele nem teljesül), a NOT NULL
 * eldobja a batch-et; ütközéskor a PRIMARY KEY (UNIQUE) dobja.
 */
export function zarakBeszurasa(db, { kollega, datum, kezd, perc, puffer }, foglalasSql, foglalasParams) {
  const slotok = foglalasSlotjai({ kollega, datum, kezd, perc, puffer }).map((s) => s.slot);
  return db.prepare(
    `INSERT INTO slot_locks (staff_id, date, slot_min, booking_id) SELECT ?, ?, j.value, ${foglalasSql} FROM json_each(?) j`,
  ).bind(kollega, datum, ...foglalasParams, JSON.stringify(slotok));
}

// ---------------------------------------------------------------- foglalás

const linkek = (origin, token) => ({
  lemondasUrl: `${origin}/foglalas/lemondas?t=${encodeURIComponent(token)}`,
  icsUrl: `${origin}/foglalas-api/foglalas.ics?t=${encodeURIComponent(token)}`,
});

/**
 * Foglalás. A dupla foglalást az adatbázis zárja ki: a foglalás minden 15 perces rácspontja egy
 * slot_locks sor (PRIMARY KEY staff_id, date, slot_min), és a foglalás, a zárak és a levelek egy
 * batch-ben (egy tranzakcióban) kerülnek be. Ütközéskor az egész batch visszagörgetődik.
 * „Bárki” választásnál a jelöltek sorban próbálkoznak, az elsőként sikerülő kapja.
 * `sorozatId` (állandó időpont, csak admin): a foglalás a sorozathoz kötődik, alkalmanként NEM megy levél
 * (a sorozat egy összefoglalót küld), és csak akkor kerül be, ha a sorozat a batch lefutásakor még aktív.
 */
export async function foglal(env, db, be, { origin, admin = false, most = Date.now(), sorozatId = null }) {
  const torzs = await torzsBetolt(db);
  const { hely, szolg } = hivatkozasok(torzs, be);
  if (!kezdesAlakja(be.kezdPerc, szolg)) throw new HttpError(400, 'Hibás időpont.');
  const szTorzs = szamitasiTorzs(szamitasra(torzs, { admin }));
  const [beosztas, kivetelek, foglalt] = await Promise.all([
    beosztasBetolt(db), kivetelekBetolt(db, be.datum, be.datum), foglaltBetolt(db, be.datum, be.datum),
  ]);
  const kezd = percToHHMM(be.kezdPerc);
  const alap = { torzs: szTorzs, beosztas, kivetelek, most, helyszin: be.helyszin, szolgaltatas: be.szolgaltatas, kollega: be.kollega, tol: be.datum, ig: be.datum };
  // csak felkínált kezdésre (a rács vagy hézagkitöltés szerint); ha egyik kolléga sem, 409
  const jeloltek = jeloltKollegak(alap, foglalt, be.datum, kezd);

  const secret = await titok(env, db);
  const puffer = szolg.puffer ?? 10;
  for (const kollega of jeloltek) {
    const id = ujAzonosito();
    const so = ujSo();
    const token = await tokenKeszit(secret, id, so);
    const { lemondasUrl, icsUrl } = linkek(origin, token);
    const row = {
      id, location_id: hely.id, service_id: szolg.id, staff_id: kollega, date: be.datum, start_min: be.kezdPerc,
      dur_min: szolg.perc, buffer_min: puffer, price: szolg.ar ?? null, name: be.nev, email: be.email, phone: be.telefon,
      note: be.megjegyzes, status: 'megerositett', source: admin ? 'admin' : 'web', token_salt: so, created_at: most,
      forras: be.forras ? JSON.stringify(be.forras) : null,
      ...(sorozatId ? { sorozat_id: sorozatId } : {}),
    };
    const f = nezet(row, torzs);
    const ics = icsKeszit(f, { host: new URL(origin).host, most, lemondasUrl });
    const levelek = [visszaigazolas(f, { lemondasUrl, icsUrl, szabalyok: torzs.szabalyok, ics })];
    if (!admin) levelek.push(studioErtesito(f, { szabalyok: torzs.szabalyok }));
    levelek.push(kollegaUj(f, kollegaCim(torzs, kollega), { admin })); // üres címzettnél kimarad
    const elsoLevel = levelek[0];
    if (sorozatId) levelek.length = 0; // a sorozat egy összefoglaló levelet küld (sorozat.js)
    const sorozatOr = sorozatId ? ` AND EXISTS (SELECT 1 FROM sorozatok WHERE id = ? AND status = 'aktiv')` : '';
    const cols = Object.keys(row);
    const stmts = [
      // a kolléga a batch lefutásakor is aktív legyen (nem archiválták és nem léptették ki közben);
      // ha nem, a sor nem kerül be, és a zárak booking_id-ja NULL lesz: a NOT NULL eldobja a batch-et
      // és ne fedjen át a kolléga másik élő foglalásával (ATFEDES_NINCS_SQL); ha igen, ugyanígy NULL zár
      db.prepare(`INSERT INTO bookings (${cols.join(', ')}) SELECT ${cols.map(() => '?').join(', ')} WHERE ${AKTIV_KOLLEGA_SQL}${sorozatOr} AND ${ATFEDES_NINCS_SQL}`)
        .bind(...cols.map((c) => row[c] ?? null), kollega, be.datum, be.datum, ...(sorozatId ? [sorozatId] : []),
          ...atfedesParams(kollega, be.datum, id, be.kezdPerc, szolg.perc, puffer)),
      zarakBeszurasa(db, { kollega, datum: be.datum, kezd: be.kezdPerc, perc: szolg.perc, puffer },
        `(SELECT id FROM bookings WHERE id = ?)`, [id]),
      ...levelSorok(db, id, levelek, most),
    ];
    mailMod(env);
    try {
      await db.batch(stmts);
    } catch (e) {
      const uzenet = String(e && e.message);
      if (/UNIQUE constraint failed: slot_locks/.test(uzenet)) continue; // közben lefoglalták
      if (/NOT NULL constraint failed: slot_locks\.booking_id/.test(uzenet)) continue; // archiválták, kiléptették, vagy átfedne
      throw e;
    }
    return { azonosito: id, lemondasUrl, ics: icsUrl, level: { targy: elsoLevel.targy, html: elsoLevel.html, szoveg: elsoLevel.szoveg }, foglalas: publikusNezet(f) };
  }
  throw new HttpError(409, UTKOZES);
}

// ---------------------------------------------------------------- lemondás

async function foglalasSor(db, id) {
  return db.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
}

/** Token → foglalás-sor; rossz vagy ismeretlen token esetén 404 (nem áruljuk el, melyik). */
export async function tokenFoglalas(env, db, token) {
  await sema(db);
  const id = tokenAzonosito(token);
  const nincs = new HttpError(404, 'Ez a lemondó link érvénytelen.');
  if (!id) throw nincs;
  const row = await foglalasSor(db, id);
  if (!row || !(await tokenEllenoriz(await titok(env, db), token, row.token_salt))) throw nincs;
  return row;
}

export function lemondasAllapot(row, torzs, most = Date.now()) {
  const kezdMs = helyiToUtc(row.date, row.start_min);
  const hataridoMs = kezdMs - torzs.szabalyok.lemondasOra * 3600e3;
  return { kezdMs, hataridoMs, elmult: kezdMs <= most, lemondhato: row.status === 'megerositett' && most < hataridoMs };
}

export async function lemondasInfo(env, db, token, most = Date.now()) {
  const row = await tokenFoglalas(env, db, token);
  const torzs = await torzsBetolt(db);
  const a = lemondasAllapot(row, torzs, most);
  if (a.elmult) throw new HttpError(410, 'Ez az időpont már elmúlt, a link lejárt.');
  return {
    azonosito: row.id,
    allapot: row.status,
    lemondhato: a.lemondhato,
    // a módosítás határa ugyanaz, mint a lemondásé (a felület ebből dönti el, mutatja-e a gombot)
    modosithato: a.lemondhato,
    hatarido: new Date(a.hataridoMs).toISOString(),
    telefon: torzs.szabalyok.telefon,
    foglalas: publikusNezet(nezet(row, torzs)),
  };
}

/**
 * Lemondás. Egy batch: állapot → lemondva (csak ha még megerősített), a zárak törlése, lemondó levél.
 * A levél csak akkor kerül be, ha ez a kérés váltotta át az állapotot (changes() = 1), így két
 * párhuzamos lemondásból sem lesz két levél.
 */
export async function lemond(env, db, row, { admin = false, most = Date.now(), levelNelkul = false } = {}) {
  const torzs = await torzsBetolt(db);
  const a = lemondasAllapot(row, torzs, most);
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a foglalást már lemondták.');
  if (!admin) {
    if (a.elmult) throw new HttpError(410, 'Ez az időpont már elmúlt, a link lejárt.');
    if (!a.lemondhato) {
      throw new HttpError(409, `A kezdés előtti ${torzs.szabalyok.lemondasOra} órán belül a link már nem mond le. Kérjük, hívj minket: ${torzs.szabalyok.telefon}.`, { telefon: torzs.szabalyok.telefon });
    }
  }
  const f = nezet({ ...row, status: 'lemondva' }, torzs);
  // a páciens visszaigazolása, a kolléga (ha van címe és be van kapcsolva) és a stúdió értesítője
  // levelNelkul: a sorozat leállítása egy összefoglalót küld (sorozat.js), alkalmanként nincs levél
  const levelek = levelNelkul ? [] : [
    lemondasLevel(f, { szabalyok: torzs.szabalyok }),
    kollegaLemondas(f, kollegaCim(torzs, row.staff_id), { admin }),
    kollegaLemondas(f, torzs.szabalyok.studioEmail, { admin }),
  ].filter((l) => l.cimzett);
  const stmts = [
    // csak akkor mond le, ha a foglalás még pontosan a beolvasott időpontban van: ha közben
    // módosították, a lemondó levél és a határidő a régi időpontról szólna
    db.prepare(`UPDATE bookings SET status = 'lemondva', cancelled_at = ? WHERE id = ? AND status = 'megerositett' AND staff_id = ? AND date = ? AND start_min = ?`)
      .bind(most, row.id, row.staff_id, row.date, row.start_min),
  ];
  // a levelek csak akkor kerülnek be, ha ez a kérés váltotta át az állapotot: az első a changes()
  // szerint az UPDATE-re, a többi az előző beszúrásra néz (0 beszúrt sor után a lánc 0 marad)
  for (const level of levelek) {
    stmts.push(db.prepare(
      `INSERT INTO outbox (booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at)
       SELECT ?, ?, ?, ?, ?, ?, NULL, 0, ? WHERE changes() = 1`,
    ).bind(row.id, level.tipus, level.cimzett, level.targy, level.html, level.szoveg, most));
  }
  // a zárak csak akkor törlődnek, ha a foglalás lemondott (ez a batch vagy egy korábbi mondta le);
  // ha közben módosították és itt nem mondtunk le, az új időpont zárai maradnak
  stmts.push(db.prepare(`DELETE FROM slot_locks WHERE booking_id = ? AND (SELECT status FROM bookings WHERE id = ?) = 'lemondva'`).bind(row.id, row.id));
  mailMod(env);
  const eredmeny = await db.batch(stmts);
  if (!eredmeny[0] || Number(eredmeny[0].meta && eredmeny[0].meta.changes) !== 1) {
    const friss = await foglalasSor(db, row.id);
    if (friss && friss.status === 'megerositett') throw new HttpError(409, KOZBEN_MODOSULT);
    throw new HttpError(410, 'Ezt a foglalást már lemondták.');
  }
  return { azonosito: row.id, allapot: 'lemondva' };
}

export async function adminLemond(env, db, id, most = Date.now()) {
  return lemond(env, db, await foglalasAzonositoval(db, id), { admin: true, most });
}

async function foglalasAzonositoval(db, id) {
  await sema(db);
  const row = /^F[0-9A-Z]{10}$/.test(String(id || '')) ? await foglalasSor(db, id) : null;
  if (!row) throw new HttpError(404, 'Nincs ilyen foglalás.');
  return row;
}

// ---------------------------------------------------------------- módosítás (áthelyezés)

/**
 * Módosítható-e a foglalás. Lemondott 410, elmúlt 410 (az adminnak is: múltbeli foglalást nem
 * helyezünk át); a páciensnek a lemondási határon belül 409 a telefonszámmal, ugyanúgy, mint a
 * lemondásnál. Az admin a határon belül is áthelyezhet.
 */
export function modosithatoAllapot(row, torzs, { admin = false, most = Date.now() } = {}) {
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a foglalást már lemondták, nem módosítható.');
  const a = lemondasAllapot(row, torzs, most);
  if (a.elmult) throw new HttpError(410, 'Ez az időpont már elmúlt, a link lejárt.');
  if (!admin && !a.lemondhato) {
    throw new HttpError(409, `A kezdés előtti ${torzs.szabalyok.lemondasOra} órán belül a link már nem módosít. Kérjük, hívj minket: ${torzs.szabalyok.telefon}.`, { telefon: torzs.szabalyok.telefon });
  }
}

/** A módosítás bemenete: új nap, kezdés, kolléga (vagy „barki”). Helyszín és szolgáltatás nem változik. */
export function modositasBemenet(d) {
  if (!ervenyesDatum(d.datum)) throw new HttpError(400, 'Hibás dátum.');
  const kezdPerc = kezdesPerc(d.kezd); // 5 perces pontosság (InBody :50); a felkínáltságot a szabad-számítás dönti el
  if (kezdPerc == null) throw new HttpError(400, 'Hibás időpont.');
  const kollega = d.kollega == null || d.kollega === '' ? 'barki' : d.kollega;
  if (typeof kollega !== 'string') throw new HttpError(400, 'Hibás kérés.');
  return { datum: d.datum, kezdPerc, kollega };
}

/**
 * Módosítás. Az azonosító és a token marad; az új időpontra ugyanazok a szabályok, mint foglaláskor
 * (adminnál minEloreOra és maxEloreNap nélkül). Egy batch: a régi zárak törlése, az újak beszúrása,
 * a foglalás frissítése, a levelek. Az új zárak booking_id-ja egy alkérdés, ami csak akkor ad
 * értéket, ha a foglalás még pontosan az, amit beolvastunk (megerősített, régi időpont); ha közben
 * lemondták vagy módosították, NULL lesz, a NOT NULL megszorítás eldobja az egész batch-et. Foglalt
 * új slotnál a PRIMARY KEY dobja el; a régi foglalás így mindkét esetben érintetlen marad.
 */
export async function modosit(env, db, row, be, { origin, admin = false, most = Date.now() }) {
  const torzs = await torzsBetolt(db);
  modosithatoAllapot(row, torzs, { admin, most });
  const { szolg } = hivatkozasok(torzs, { helyszin: row.location_id, szolgaltatas: row.service_id, kollega: be.kollega });
  if (!kezdesAlakja(be.kezdPerc, szolg)) throw new HttpError(400, 'Hibás időpont.');
  if (be.datum === row.date && be.kezdPerc === row.start_min && (be.kollega === 'barki' || be.kollega === row.staff_id)) {
    throw new HttpError(400, 'Ez a jelenlegi időpontod. Válassz másikat.');
  }
  const szTorzs = szamitasiTorzs(szamitasra(torzs, { admin, row }));
  const [beosztas, kivetelek, foglalt] = await Promise.all([
    beosztasBetolt(db), kivetelekBetolt(db, be.datum, be.datum), foglaltBetolt(db, be.datum, be.datum, row.id),
  ]);
  const kezd = percToHHMM(be.kezdPerc);
  const alap = { torzs: szTorzs, beosztas, kivetelek, most, helyszin: row.location_id, szolgaltatas: row.service_id, kollega: be.kollega, tol: be.datum, ig: be.datum };
  const jeloltek = jeloltKollegak(alap, foglalt, be.datum, kezd);

  const token = await tokenKeszit(await titok(env, db), row.id, row.token_salt);
  const { lemondasUrl, icsUrl } = linkek(origin, token);
  const regi = nezet(row, torzs);
  for (const kollega of jeloltek) {
    const f = nezet({ ...row, staff_id: kollega, date: be.datum, start_min: be.kezdPerc }, torzs);
    const ics = icsKeszit(f, { host: new URL(origin).host, most, lemondasUrl });
    const levelek = [modositasLevel(f, { regi, lemondasUrl, icsUrl, szabalyok: torzs.szabalyok, ics })];
    if (!admin) levelek.push(studioModositas(f, { regi, szabalyok: torzs.szabalyok }));
    // a kolléga: ugyanannál módosítás; kolléga-cserénél a régi lemondást, az új új foglalást kap
    if (kollega === row.staff_id) levelek.push(kollegaModositas(f, regi, kollegaCim(torzs, kollega)));
    else levelek.push(kollegaLemondas(regi, kollegaCim(torzs, row.staff_id), { admin }), kollegaUj(f, kollegaCim(torzs, kollega), { admin }));
    const stmts = [
      db.prepare(`DELETE FROM slot_locks WHERE booking_id = ?`).bind(row.id),
      zarakBeszurasa(db, { kollega, datum: be.datum, kezd: be.kezdPerc, perc: row.dur_min, puffer: row.buffer_min },
        `(SELECT id FROM bookings WHERE id = ? AND status = 'megerositett' AND staff_id = ? AND date = ? AND start_min = ? AND ${AKTIV_KOLLEGA_SQL} AND ${ATFEDES_NINCS_SQL})`,
        [row.id, row.staff_id, row.date, row.start_min, kollega, be.datum, be.datum,
          ...atfedesParams(kollega, be.datum, row.id, be.kezdPerc, row.dur_min, row.buffer_min)]),
      db.prepare(`UPDATE bookings SET staff_id = ?, date = ?, start_min = ?, emlekeztetve_at = NULL WHERE id = ?`).bind(kollega, be.datum, be.kezdPerc, row.id),
      ...levelSorok(db, row.id, levelek, most),
    ];
    mailMod(env);
    try {
      await db.batch(stmts);
    } catch (e) {
      const uzenet = String(e && e.message);
      if (/UNIQUE constraint failed: slot_locks/.test(uzenet)) continue; // az új időpontot közben lefoglalták
      if (/NOT NULL constraint failed: slot_locks\.booking_id/.test(uzenet)) {
        const most2 = await foglalasSor(db, row.id);
        if (!most2 || most2.status !== 'megerositett') throw new HttpError(410, 'Ezt a foglalást közben lemondták.');
        // a foglalás változatlan: az új kollégát archiválták vagy kiléptették közben, próbáljuk a következőt
        if (most2.staff_id === row.staff_id && most2.date === row.date && most2.start_min === row.start_min) continue;
        throw new HttpError(409, KOZBEN_MODOSULT);
      }
      throw e;
    }
    return {
      azonosito: row.id, lemondasUrl, ics: icsUrl, modositva: true,
      level: { targy: levelek[0].targy, html: levelek[0].html, szoveg: levelek[0].szoveg }, foglalas: publikusNezet(f),
    };
  }
  throw new HttpError(409, UTKOZES);
}

export async function adminModosit(env, db, id, d, { origin, most = Date.now() }) {
  const row = await foglalasAzonositoval(db, id);
  return modosit(env, db, row, modositasBemenet(d), { origin, admin: true, most });
}

/**
 * A köszönő oldal adatai tokennel (GET /foglalas-api/foglalas?t=): frissítés után is kiírhatók.
 * Csak a publikus nézet (e-mail, telefon, megjegyzés nélkül) és a mérési eseményhez szükséges,
 * személyes adatot nem tartalmazó rész (szolgáltatás, ár, kampány). Lemondott foglalásra is ad
 * választ (allapot: 'lemondva'), hogy a felület ki tudja írni.
 */
export async function foglalasTokennel(env, db, token, origin) {
  const row = await tokenFoglalas(env, db, token);
  const torzs = await torzsBetolt(db);
  const f = nezet(row, torzs);
  const k = forrasOlvas(row.forras) || {};
  const { lemondasUrl, icsUrl } = linkek(origin, token);
  return {
    azonosito: row.id,
    lemondasUrl,
    ics: icsUrl,
    foglalas: publikusNezet(f),
    meres: {
      szolgaltatas: row.service_id, helyszin: row.location_id, ar: row.price,
      ...Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].filter((x) => k[x]).map((x) => [x, k[x]])),
    },
  };
}

export async function icsTokennel(env, db, token, origin) {
  const row = await tokenFoglalas(env, db, token);
  if (row.status !== 'megerositett') throw new HttpError(410, 'Ezt a foglalást lemondták.');
  const torzs = await torzsBetolt(db);
  const f = nezet(row, torzs);
  return { azonosito: row.id, ics: icsKeszit(f, { host: new URL(origin).host, lemondasUrl: linkek(origin, token).lemondasUrl }) };
}

// ---------------------------------------------------------------- admin lista

export async function foglalasLista(db, q) {
  const torzs = await torzsBetolt(db);
  const ma = budapestMost().datum;
  const tol = q.get('tol') || ma;
  const ig = q.get('ig') || datumPlusz(tol, 6);
  if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw new HttpError(400, 'Hibás dátum-tartomány.');
  if (napok(tol, ig, 93).length > 92) throw new HttpError(400, 'Egyszerre legfeljebb 92 nap kérhető le.');
  const felt = ['date >= ?', 'date <= ?'];
  const args = [tol, ig];
  for (const [p, col] of [['helyszin', 'location_id'], ['kollega', 'staff_id'], ['allapot', 'status']]) {
    const v = q.get(p);
    if (v) { felt.push(`${col} = ?`); args.push(v); }
  }
  const { results } = await db.prepare(
    `SELECT * FROM bookings WHERE ${felt.join(' AND ')} ORDER BY date, start_min, staff_id LIMIT 2000`,
  ).bind(...args).all();
  // az állandó időpont jelölése (sorozat: { id, nap, kezd, ismetles } vagy null)
  const { results: sorozatok } = await db.prepare(
    `SELECT id, weekday, start_min, interval_het FROM sorozatok WHERE id IN (SELECT DISTINCT sorozat_id FROM bookings WHERE ${felt.join(' AND ')} AND sorozat_id IS NOT NULL)`,
  ).bind(...args).all();
  const sorozatMap = new Map((sorozatok || []).map((x) => [x.id, { id: x.id, nap: x.weekday, kezd: percToHHMM(x.start_min), ismetles: x.interval_het }]));
  return {
    tol, ig,
    foglalasok: (results || []).map((r) => {
      const { kezdPerc: _k, ...f } = nezet(r, torzs);
      return {
        ...f, kampany: forrasOlvas(r.forras), sorozat: (r.sorozat_id && sorozatMap.get(r.sorozat_id)) || null,
        letrehozva: new Date(r.created_at).toISOString(), lemondva: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null,
      };
    }),
  };
}
