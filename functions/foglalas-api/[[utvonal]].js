// Időpontfoglaló · nyilvános API (NEM Access mögött; a _routes.json-ban: /foglalas-api/*)
//
//   GET  /foglalas-api/katalogus
//   GET  /foglalas-api/szabad?helyszin=&szolgaltatas=&kollega=(id|barki)&tol=YYYY-MM-DD&ig=YYYY-MM-DD   (max 14 nap)
//   GET  /foglalas-api/szabad?t=&kollega=&tol=&ig=   módosításhoz: a saját foglalás ideje szabadnak számít
//   POST /foglalas-api/foglalas        {helyszin,szolgaltatas,kollega,datum,kezd,nev,email,telefon,megjegyzes,hozzajarul,web}
//   GET  /foglalas-api/lemondas?t=     a foglalás adatai (NEM mond le)
//   POST /foglalas-api/lemondas        {t}  lemond
//   POST /foglalas-api/modositas       {t,datum,kezd,kollega}  áthelyez (helyszín és szolgáltatás marad; token és azonosító marad)
//   GET  /foglalas-api/foglalas.ics?t= naptárfájl
//
// Minden válasz JSON (kivéve az .ics), a hibaüzenet magyarul az `error` mezőben.
// BOOKING_DB kötés nélkül minden végpont 503.

import { HttpError, errorResponse, json } from '../_lib/http.js';
import {
  dbVagy503, foglal, foglalasBemenet, icsTokennel, ipKorlat, katalogus, lemond, lemondasInfo, modosit, modositasBemenet, szabad, tokenFoglalas,
} from '../_lib/booking/foglalas.js';

const MAX_BODY = 8 * 1024;

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
  katalogus: { GET: async ({ env }) => json(await katalogus(dbVagy503(env))) },

  szabad: { GET: async ({ env, url }) => json(await szabad(dbVagy503(env), url.searchParams, { env })) },

  foglalas: {
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
    GET: async ({ env, url }) => json(await lemondasInfo(env, dbVagy503(env), url.searchParams.get('t'))),
    POST: async ({ env, request }) => {
      const db = dbVagy503(env);
      sajatOrigin(request);
      const d = await jsonBody(request);
      const row = await tokenFoglalas(env, db, typeof d.t === 'string' ? d.t : '');
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
      const row = await tokenFoglalas(env, db, typeof d.t === 'string' ? d.t : '');
      return json(await modosit(env, db, row, modositasBemenet(d), { origin: url.origin }));
    },
  },

  'foglalas.ics': {
    GET: async ({ env, url }) => {
      const { azonosito, ics } = await icsTokennel(env, dbVagy503(env), url.searchParams.get('t'), url.origin);
      return new Response(ics, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': `attachment; filename="studio-f360-${azonosito}.ics"`,
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
    return await h({ ...context, url });
  } catch (e) {
    return errorResponse(e);
  }
}
