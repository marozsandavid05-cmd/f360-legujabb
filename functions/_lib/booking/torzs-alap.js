// Időpontfoglaló · a törzsadat alapértékei és a kolléga új mezőinek ellenőrzése (tiszta függvények).
//
// A kollégák a settings.torzs JSON-ban élnek (nincs külön tábla). A Lilla-kör új mezői:
//   email         privát értesítési cím (lehet üres; a nyilvános API-ban SOHA nem jelenik meg)
//   aktiv_tol     belépés napja, 'YYYY-MM-DD' vagy üres; előtte nem foglalható
//   aktiv_ig      kilépés napja, 'YYYY-MM-DD' vagy üres; utána nem foglalható (aznap még igen)
//   foto          kép URL (https:// vagy a weboldalon belüli /út), vagy üres
//   bemutatkozas  rövid szöveg (legfeljebb 2000 karakter)
//   archivalt     true: nem foglalható, nem látszik a katalógusban, de a régi foglalásokhoz megmarad
//   naptar_id     a kolléga Google Naptárának azonosítója (calendarId) vagy üres; a nyilvános API-ban SOHA
// A régi (mezők nélküli) adat betöltéskor alapértéket kap; ehhez ALTER TABLE nem kell.
//
// Új szabályok: ertesitKollega (alap: be), emlekeztetoBe (alap: be), emlekeztetoOra (alap: 30),
// studioNaptarId (a közös stúdió Google Naptár azonosítója, alap: üres).

import { HttpError } from '../http.js';
import { ervenyesDatum } from './ido.js';

export const KOLLEGA_UJ_MEZOK = ['email', 'aktiv_tol', 'aktiv_ig', 'foto', 'bemutatkozas', 'archivalt', 'naptar_id'];
export const SZABALY_UJ_ALAP = Object.freeze({ ertesitKollega: true, emlekeztetoBe: true, emlekeztetoOra: 30, reggeliHatarOra: 22, reggeliKezdesElott: 10, kinalas: 'igazitott', studioNaptarId: '' });

// A felkínált kezdések lépése (a belső 15 perces rács ettől nem változik):
//   globálisan (szabalyok.kinalas): 'igazitott' (időtartam + puffer, felfelé a 15 többszörösére) | 15 | 30 | 60
//   szolgáltatásonként (kinalas): null (a globálisat követi) | 'igazitott' | 15 többszöröse 15 és 240 között
export const KINALAS_GLOBALIS = Object.freeze(['igazitott', 15, 30, 60]);

export function kinalasGlobalis(v) {
  if (!KINALAS_GLOBALIS.includes(v)) throw hiba("Hibás beállítás: kinalas ('igazitott', 15, 30 vagy 60).");
  return v;
}

/** A szolgáltatás felülírása; null: a globálisat követi. */
export function kinalasSzolgaltatas(v, id = '') {
  if (v === null || v === 'igazitott') return v;
  if (Number.isInteger(v) && v >= 15 && v <= 240 && v % 15 === 0) return v;
  throw hiba(`Hibás kínálás${id ? ` (${id})` : ''}: null, 'igazitott', vagy 15 többszöröse 15 és 240 perc között.`);
}

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
// Google calendarId: egy e-mail-cím alakú azonosító (a saját naptárnál a fiók címe, a létrehozottnál
// ...@group.calendar.google.com; az ünnepnaptárakban # is előfordul)
const NAPTAR_RE = /^[A-Za-z0-9._%+#-]{1,200}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Egy Google naptár-azonosító ellenőrzése: üres (nincs naptár) vagy érvényes calendarId. */
export function naptarAzonosito(v, mezo = 'naptár-azonosító') {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') throw hiba(`Hibás mező: ${mezo}.`);
  const s = v.trim();
  if (s && (s.length > 254 || !NAPTAR_RE.test(s))) {
    throw hiba(`Hibás ${mezo}: a Google Naptár beállításaiban, a „Naptár integrálása” résznél látható azonosító kell, például valami@group.calendar.google.com.`);
  }
  return s;
}
const hiba = (m) => new HttpError(400, m);

export function kollegaAlap(k) {
  return {
    ...k,
    email: typeof k.email === 'string' ? k.email : '',
    aktiv_tol: typeof k.aktiv_tol === 'string' ? k.aktiv_tol : '',
    aktiv_ig: typeof k.aktiv_ig === 'string' ? k.aktiv_ig : '',
    foto: typeof k.foto === 'string' ? k.foto : '',
    bemutatkozas: typeof k.bemutatkozas === 'string' ? k.bemutatkozas : '',
    archivalt: k.archivalt === true,
    naptar_id: typeof k.naptar_id === 'string' ? k.naptar_id : '',
  };
}

export function torzsAlap(t) {
  return {
    ...t,
    kollegak: (Array.isArray(t.kollegak) ? t.kollegak : []).map(kollegaAlap),
    szabalyok: { ...SZABALY_UJ_ALAP, ...(t.szabalyok || {}) },
  };
}

/** Foglalható-e a kolléga ezen a napon (nem archivált, és a belépés és kilépés között van). */
export function aktivANapon(k, datum) {
  if (k.archivalt === true) return false;
  if (k.aktiv_tol && datum < k.aktiv_tol) return false;
  if (k.aktiv_ig && datum > k.aktiv_ig) return false;
  return true;
}

/**
 * Ugyanez SQL-ben, a settings.torzs JSON-ból, a foglalás és a módosítás batch-ének őrfeltételéhez:
 * a kolléga a batch lefutásakor (nem a beolvasáskor) is aktív legyen. Így ha a foglalás beolvasása és
 * a batch között archiválták vagy kiléptették, a batch nem ír semmit. Paraméterek: kolléga-id, dátum, dátum.
 */
export const AKTIV_KOLLEGA_SQL = `EXISTS (SELECT 1 FROM settings s, json_each(s.ertek, '$.kollegak') k
  WHERE s.kulcs = 'torzs' AND json_extract(k.value, '$.id') = ?
    AND COALESCE(json_extract(k.value, '$.archivalt'), 0) != 1
    AND COALESCE(json_extract(k.value, '$.aktiv_tol'), '') <= ?
    AND (COALESCE(json_extract(k.value, '$.aktiv_ig'), '') = '' OR json_extract(k.value, '$.aktiv_ig') >= ?))`;

/**
 * A kolléga régi és új állapotából: mely (jövőbeli, megerősített) foglalásai válnának foglalhatatlanná.
 * null, ha a változás nem szűkít (nincs mit ellenőrizni). Különben { sql, args } predikátum a
 * bookings táblára (a staff_id, status és date >= ma feltételt a hívó teszi hozzá).
 */
export function szukitoFeltetel(regi, uj) {
  if (uj.archivalt === true) return regi.archivalt === true ? null : { sql: '1', args: [] };
  const resz = [];
  const args = [];
  const szukult = (uj.aktiv_tol || '') !== (regi.aktiv_tol || '') || (uj.aktiv_ig || '') !== (regi.aktiv_ig || '');
  if (!szukult) return null;
  if (uj.aktiv_tol) { resz.push('date < ?'); args.push(uj.aktiv_tol); }
  if (uj.aktiv_ig) { resz.push('date > ?'); args.push(uj.aktiv_ig); }
  return resz.length ? { sql: resz.join(' OR '), args } : null;
}

function szoveg(v, mezo, max) {
  if (v == null) return '';
  if (typeof v !== 'string') throw hiba(`Hibás mező: ${mezo}.`);
  const s = v.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (s.length > max) throw hiba(`Túl hosszú: ${mezo} (legfeljebb ${max} karakter).`);
  return s;
}

/**
 * A kolléga új mezőinek ellenőrzése. Csak a `d`-ben ténylegesen szereplő kulcsokat adja vissza
 * (így a részleges módosítás és a régi felület mentése nem törli a meg nem küldött mezőket).
 */
export function kollegaUjMezok(d) {
  const ki = {};
  if ('email' in d) {
    const e = szoveg(d.email, 'e-mail', 254).toLowerCase();
    if (e && !EMAIL_RE.test(e)) throw hiba('Hibás e-mail-cím.');
    ki.email = e;
  }
  for (const k of ['aktiv_tol', 'aktiv_ig']) {
    if (!(k in d)) continue;
    const v = d[k] == null ? '' : d[k];
    if (v !== '' && !ervenyesDatum(v)) throw hiba(`Hibás dátum: ${k === 'aktiv_tol' ? 'belépés' : 'kilépés'} (ÉÉÉÉ-HH-NN).`);
    ki[k] = v;
  }
  if ('foto' in d) {
    const f = szoveg(d.foto, 'fotó', 500);
    if (f && !/^https:\/\/[^\s"'<>\\]+$/.test(f) && !/^\/(?![/\\])[^\s"'<>\\]*$/.test(f)) {
      throw hiba('A fotó https:// kezdetű webcím vagy a weboldalon belüli /út legyen.');
    }
    ki.foto = f;
  }
  if ('naptar_id' in d) ki.naptar_id = naptarAzonosito(d.naptar_id, 'naptár-azonosító (kolléga)');
  if ('bemutatkozas' in d) ki.bemutatkozas = szoveg(d.bemutatkozas, 'bemutatkozás', 2000);
  if ('archivalt' in d) {
    if (typeof d.archivalt !== 'boolean') throw hiba('Hibás mező: archivalt (true vagy false).');
    ki.archivalt = d.archivalt;
  }
  return ki;
}

/** A belépés ne legyen a kilépés után (a végleges, összefésült kolléga-objektumon). */
export function aktivSorrend(k) {
  if (k.aktiv_tol && k.aktiv_ig && k.aktiv_tol > k.aktiv_ig) throw hiba('A belépés napja nem lehet a kilépés után.');
}

/** Az új szabályok ellenőrzése: csak a megadott kulcsok. */
export function szabalyUjMezok(sz) {
  const ki = {};
  for (const k of ['ertesitKollega', 'emlekeztetoBe']) {
    if (!(k in sz)) continue;
    if (typeof sz[k] !== 'boolean') throw hiba(`Hibás beállítás: ${k} (true vagy false).`);
    ki[k] = sz[k];
  }
  if ('emlekeztetoOra' in sz) {
    if (!Number.isInteger(sz.emlekeztetoOra) || sz.emlekeztetoOra < 1 || sz.emlekeztetoOra > 168) {
      throw hiba('Hibás szám: emlekeztetoOra (1 és 168 között).');
    }
    ki.emlekeztetoOra = sz.emlekeztetoOra;
  }
  // csoportos órák: a reggeli órákra (kezdés reggeliKezdesElott óra előtt) az előző nap reggeliHatarOra:00 a határ
  if ('reggeliHatarOra' in sz) {
    if (!Number.isInteger(sz.reggeliHatarOra) || sz.reggeliHatarOra < 0 || sz.reggeliHatarOra > 23) throw hiba('Hibás szám: reggeliHatarOra (0 és 23 között).');
    ki.reggeliHatarOra = sz.reggeliHatarOra;
  }
  if ('reggeliKezdesElott' in sz) {
    if (!Number.isInteger(sz.reggeliKezdesElott) || sz.reggeliKezdesElott < 0 || sz.reggeliKezdesElott > 24) throw hiba('Hibás szám: reggeliKezdesElott (0 és 24 között).');
    ki.reggeliKezdesElott = sz.reggeliKezdesElott;
  }
  if ('kinalas' in sz) ki.kinalas = kinalasGlobalis(sz.kinalas);
  if ('studioNaptarId' in sz) ki.studioNaptarId = naptarAzonosito(sz.studioNaptarId, 'stúdiónaptár-azonosító');
  return ki;
}
