// Időpontfoglaló · nyilvános API (NEM Access mögött; a _routes.json-ban: /foglalas-api/*)
//
//   GET  /foglalas-api/katalogus
//   GET  /foglalas-api/szabad?helyszin=&szolgaltatas=&kollega=(id|barki)&tol=YYYY-MM-DD&ig=YYYY-MM-DD   (max 14 nap)
//   GET  /foglalas-api/szabad?t=&kollega=&tol=&ig=   módosításhoz: a saját foglalás ideje szabadnak számít
//   GET  /foglalas-api/foglalas?t=     a foglalás publikus adatai a köszönő oldalnak (+ mérési adatok)
//   POST /foglalas-api/foglalas        {helyszin,szolgaltatas,kollega,datum,kezd,nev,email,telefon,megjegyzes,hozzajarul,web,forras}
//                                      forras (opcionális): {utm_source,utm_medium,utm_campaign,utm_content,utm_term,gclid,fbclid,landing,referrer}
//   GET  /foglalas-api/lemondas?t=     a foglalás adatai (NEM mond le)
//   POST /foglalas-api/lemondas        {t}  lemond
//   POST /foglalas-api/modositas       {t,datum,kezd,kollega}  áthelyez (helyszín és szolgáltatás marad; token és azonosító marad)
//   GET  /foglalas-api/foglalas.ics?t= naptárfájl
//   GET  /foglalas-api/orak?helyszin=&tol=&ig=   csoportos órák (max 14 nap): szabad helyek, oktató, ár, foglalhato, ok
//   POST /foglalas-api/ora-foglalas    {ora,nev,email,telefon,megjegyzes,hozzajarul,web,forras}  jelentkezés egy órára
//                                      betelt: 409 {kod:'betelt'}, már jelentkezett: 409 {kod:'mar_jelentkezett'}
//   A tokenes végpontok (lemondas, foglalas?t=, foglalas.ics) a csoportos tokent („C” előtag) is kezelik,
//   a válaszban tipus: 'csoportos'. Csoportos áthelyezés: POST /foglalas-api/modositas {t, ora}.
//   POST /foglalas-api/cron/emlekezteto  X-Cron-Kulcs: <CRON_SECRET>  emlékeztetők (az ütemező hívja)
//
// Minden válasz JSON (kivéve az .ics), a hibaüzenet magyarul az `error` mezőben.
// BOOKING_DB kötés nélkül minden végpont 503.

import { HttpError, errorResponse, json } from '../_lib/http.js';
import {
  dbVagy503, foglal, foglalasBemenet, foglalasTokennel, icsTokennel, ipKorlat, katalogus, lemond, lemondasInfo, modosit, modositasBemenet, szabad, tokenFoglalas,
} from '../_lib/booking/foglalas.js';
import { emlekeztetoFuttat } from '../_lib/booking/emlekezteto.js';
import { ugyfelBemenet } from '../_lib/booking/foglalas.js';
import {
  csoportosToken, oraBemenet, oraEmlekeztetoFuttat, oraFoglal, oraFoglalasTokennel, oraGeneralHaKell, oraIcsTokennel, oraLemond, oraLemondasInfo, oraLista,
  oraModosit, oraTokenFoglalas,
} from '../_lib/booking/orak.js';
import { hatterKuldes, outboxKuld } from '../_lib/booking/mailer.js';

const MAX_BODY = 8 * 1024;

/**
 * Az ütemező kulcsa (X-Cron-Kulcs fejléc). CRON_SECRET nélkül (vagy 24 karakternél rövidebbel) a
 * végpont ki van kapcsolva: 503. Rossz vagy hiányzó kulcs: 401. Az összehasonlítás állandó idejű
 * (mindkét oldal SHA-256 kivonata, majd bájtonkénti XOR), így az időzítésből nem derül ki a kulcs.
 */
async function cronKulcs(env, request) {
  const titok = String(env.CRON_SECRET || '');
  if (titok.length < 24) throw new HttpError(503, 'Az emlékeztető-ütemező nincs beállítva.');
  const kapott = request.headers.get('X-Cron-Kulcs') || '';
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([h(titok), h(kapott)]);
  let kul = 0;
  for (let i = 0; i < a.length; i++) kul |= a[i] ^ b[i];
  if (kul !== 0) throw new HttpError(401, 'Nem engedélyezett.');
}

function sajatOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, 'Nem engedélyezett.');
}

async function jsonBody(request) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) throw new HttpError(415, 'A kérés tartalma JSON legyen.');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'A kérés túl nagy.');
  let d;
  try { d = JSON.parse(text); } catch { throw new HttpError(400, 'Hibás kérés.'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'Hibás kérés.');
  return d;
}

const UTAK = {
  // az ütemező (workers/emlekezteto-cron) hívja 15 percenként; böngészőből nem (nincs Origin-ellenőrzés,
  // a kulcs véd). CRON_SECRET nélkül kikapcsolt: 503.
  'cron/emlekezteto': {
    POST: async ({ env, request, url }) => {
      const db = dbVagy503(env);
      await cronKulcs(env, request);
      const origin = env.PUBLIC_ORIGIN || url.origin;
      const emlek = await emlekeztetoFuttat(env, db, { origin });
      // csoportos órák: a napi generálás (8 hét) és az emlékeztetők ugyanitt
      const orak = await oraGeneralHaKell(db);
      const oraEmlek = await oraEmlekeztetoFuttat(env, db, { origin });
      // ugyanez a futás küldi el (ha van szolgáltató) az új és a korábban sikertelen leveleket
      const levelek = await outboxKuld(env, db);
      return json({ mod: levelek.mod, ...emlek, csoportos: { generalva: orak.letrehozva, emlekeztetve: oraEmlek.emlekeztetve }, levelek });
    },
  },

  katalogus: { GET: async ({ env }) => json(await katalogus(dbVagy503(env))) },

  szabad: { GET: async ({ env, url }) => json(await szabad(dbVagy503(env), url.searchParams, { env })) },

  orak: { GET: async ({ env, url }) => json(await oraLista(dbVagy503(env), url.searchParams)) },

  'ora-foglalas': {
    POST: async ({ env, request, url }) => {
      const db = dbVagy503(env);
      sajatOrigin(request);
      const d = await jsonBody(request);
      if (d.web != null && String(d.web).trim() !== '') return json({ ok: true }); // honeypot, mint a foglalásnál
      await ipKorlat(env, db, request);
      const be = { ...ugyfelBemenet(d), ora: oraBemenet(d) };
      return json(await oraFoglal(env, db, be, { origin: url.origin }), 201);
    },
  },

  foglalas: {
    // a köszönő oldal adatai (frissítés után is): GET ?t=<token>
    GET: async ({ env, url }) => {
      const t = url.searchParams.get('t');
      const db = dbVagy503(env);
      return json(csoportosToken(t) ? await oraFoglalasTokennel(env, db, t, url.origin) : await foglalasTokennel(env, db, t, url.origin));
    },
    POST: async ({ env, request, url }) => {
      const db = dbVagy503(env);
      sajatOrigin(request);
      const d = await jsonBody(request);
      // honeypot: a látogató nem látja a `web` mezőt; ha ki van töltve, robot. Nem mentünk semmit,
      // de sikert jelzünk, hogy a robot ne tanuljon belőle.
      if (d.web != null && String(d.web).trim() !== '') return json({ ok: true });
      await ipKorlat(env, db, request);
      const be = foglalasBemenet(d);
      return json(await foglal(env, db, be, { origin: url.origin }), 201);
    },
  },

  lemondas: {
    GET: async ({ env, url }) => {
      const t = url.searchParams.get('t');
      return json(csoportosToken(t) ? await oraLemondasInfo(env, dbVagy503(env), t) : await lemondasInfo(env, dbVagy503(env), t));
    },
    POST: async ({ env, request }) => {
      const db = dbVagy503(env);
      sajatOrigin(request);
      const d = await jsonBody(request);
      // ugyanaz a napi IP-korlát, mint a foglalásnál és a módosításnál: a token-találgatást is fékezi
      await ipKorlat(env, db, request);
      const t = typeof d.t === 'string' ? d.t : '';
      if (csoportosToken(t)) return json(await oraLemond(env, db, await oraTokenFoglalas(env, db, t)));
      const row = await tokenFoglalas(env, db, t);
      return json(await lemond(env, db, row));
    },
  },

  modositas: {
    POST: async ({ env, request, url }) => {
      const db = dbVagy503(env);
      sajatOrigin(request);
      const d = await jsonBody(request);
      // ugyanaz a napi IP-korlát, mint a foglalásnál: a módosítás is levelet ír és zárakat cserél
      await ipKorlat(env, db, request);
      const t = typeof d.t === 'string' ? d.t : '';
      // csoportos tokennel: {t, ora}; egyéni tokennel: {t, datum, kezd, kollega}; a kettő nem keverhető
      if (csoportosToken(t)) {
        if ('datum' in d || 'kezd' in d || 'kollega' in d) throw new HttpError(400, 'Csoportos jelentkezésnél másik órát kell választani (ora).');
        const row = await oraTokenFoglalas(env, db, t);
        return json(await oraModosit(env, db, row, oraBemenet(d), { origin: url.origin }));
      }
      if ('ora' in d) throw new HttpError(400, 'Egyéni foglalásnál az időpontot kell megadni (datum, kezd).');
      const row = await tokenFoglalas(env, db, t);
      return json(await modosit(env, db, row, modositasBemenet(d), { origin: url.origin }));
    },
  },

  'foglalas.ics': {
    GET: async ({ env, url }) => {
      const t = url.searchParams.get('t');
      const { azonosito, ics } = csoportosToken(t) ? await oraIcsTokennel(env, dbVagy503(env), t, url.origin) : await icsTokennel(env, dbVagy503(env), t, url.origin);
      return new Response(ics, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          // inline: iPhone-on és Macen a Safari egyből a Naptár appot nyitja, nem tölti le; a fájlnév marad
          'Content-Disposition': `inline; filename="studio-f360-${azonosito}.ics"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    },
  },
};

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const nev = url.pathname.replace(/^\/foglalas-api\/?/, '').replace(/\/+$/, '');
  const ut = Object.prototype.hasOwnProperty.call(UTAK, nev) ? UTAK[nev] : null;
  try {
    if (!ut) return json({ error: 'Ismeretlen végpont.' }, 404);
    const h = ut[request.method];
    if (!h) return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: Object.keys(ut).join(', ') });
    const valasz = await h({ ...context, url });
    // sikeres foglalás, lemondás vagy módosítás után a friss levelek a háttérben mennek ki (ha van
    // beállított szolgáltató; outbox-módban semmi nem történik). A cron maga küld, ott nem kell.
    if (request.method === 'POST' && valasz.ok && nev !== 'cron/emlekezteto') hatterKuldes(context, context.env, context.env.BOOKING_DB);
    return valasz;
  } catch (e) {
    return errorResponse(e);
  }
}
