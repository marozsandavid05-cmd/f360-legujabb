// Időpontfoglaló · admin API (/api/foglalo/*). A hitelesítést és a CSRF-védelmet a
// functions/api/_middleware.js végzi (Cloudflare Access JWT), ide csak belépett kérés jut.
//
//   GET|PUT  /api/foglalo/beallitasok                  helyszínek, szolgáltatások, kollégák (szin: #rrggbb), szabályok
//                                                      (+ ertesitKollega, emlekeztetoBe, emlekeztetoOra)
//   POST     /api/foglalo/kollegak                     új kolléga (201) {nev, szerep, helyszinek, szolgaltatasok, szin?,
//                                                      email?, aktiv_tol?, aktiv_ig?, foto?, bemutatkozas?, id?}
//   PATCH    /api/foglalo/kollegak/:id                 egy kolléga mezői (részleges); archivalt: true|false
//   POST     /api/foglalo/kollegak/:id/archivalas      archiválás (jövőbeli foglalás esetén 409)
//   PATCH    /api/foglalo/kollegak?kollega=            egy kolléga színe ({ szin: '#rrggbb' })
//   GET|PUT  /api/foglalo/beosztas?kollega=            heti minta ({ sorok:[{nap,helyszin,kezd,veg}] })
//   GET|POST|DELETE /api/foglalo/kivetelek             DELETE: ?id=
//   GET      /api/foglalo/foglalasok?tol=&ig=&helyszin=&kollega=&allapot=
//   POST     /api/foglalo/foglalasok                   kézi felvétel (e-mail és telefon nem kötelező)
//   PATCH    /api/foglalo/foglalasok/:azonosito        áthelyezés { datum, kezd, kollega } (lemondási határ és minEloreOra nélkül)
//   POST     /api/foglalo/foglalasok/:azonosito/lemondas
//   GET      /api/foglalo/szabad?foglalas=&kollega=&tol=&ig=   az áthelyezés szabad időpontjai (a saját idő szabad)
//   GET      /api/foglalo/outbox                       elkészült levelek (elkuldve, sikertelen, hiba)
//   POST     /api/foglalo/emlekezteto/futtat           emlékeztetők kézi indítása (+ küldés, ha van szolgáltató)
//   GET      /api/foglalo/riport/forrasok?tol=&ig=     foglalások száma forrás, kampány, szolgáltatás szerint

import { HttpError, errorResponse, json, readJson } from '../../_lib/http.js';
import { adminLemond, adminModosit, dbVagy503, foglal, foglalasBemenet, foglalasLista, szabad } from '../../_lib/booking/foglalas.js';
import { beallitasokMent, beosztasLekerd, beosztasMent, kivetelFelvesz, kivetelLista, kivetelTorol, kollegaArchival, kollegaLetrehoz, kollegaModosit, kollegaSzinMent } from '../../_lib/booking/admin.js';
import { torzsBetolt } from '../../_lib/booking/schema.js';
import { hatterKuldes, mailMod, outboxKuld, outboxLista } from '../../_lib/booking/mailer.js';
import { emlekeztetoFuttat } from '../../_lib/booking/emlekezteto.js';
import { forrasRiport } from '../../_lib/booking/forras.js';

const UTAK = {
  beallitasok: {
    GET: async ({ db }) => json(await torzsBetolt(db)),
    PUT: async ({ db, request }) => json(await beallitasokMent(db, await readJson(request, 256 * 1024))),
  },
  kollegak: {
    POST: async ({ db, request }) => json(await kollegaLetrehoz(db, await readJson(request, 16 * 1024)), 201),
    PATCH: async ({ db, url, request }) => json(await kollegaSzinMent(db, url.searchParams.get('kollega'), await readJson(request, 4 * 1024))),
  },
  beosztas: {
    GET: async ({ db, url }) => json(await beosztasLekerd(db, url.searchParams.get('kollega'))),
    PUT: async ({ db, url, request }) => json(await beosztasMent(db, url.searchParams.get('kollega'), await readJson(request, 64 * 1024))),
  },
  kivetelek: {
    GET: async ({ db, url }) => json(await kivetelLista(db, url.searchParams)),
    POST: async ({ db, request }) => json(await kivetelFelvesz(db, await readJson(request, 8 * 1024)), 201),
    DELETE: async ({ db, url }) => json(await kivetelTorol(db, url.searchParams.get('id'))),
  },
  foglalasok: {
    GET: async ({ db, url }) => json(await foglalasLista(db, url.searchParams)),
    POST: async ({ env, db, url, request }) => {
      const be = foglalasBemenet(await readJson(request, 8 * 1024), { admin: true });
      return json(await foglal(env, db, be, { origin: url.origin, admin: true }), 201);
    },
  },
  // az áthelyezés időpontválasztója: ?foglalas=<azonosító>&kollega=&tol=&ig= (minEloreOra és maxEloreNap nélkül)
  szabad: {
    GET: async ({ env, db, url }) => json(await szabad(db, url.searchParams, { env, admin: true })),
  },
  outbox: {
    GET: async ({ env, db }) => json({ mod: mailMod(env), levelek: await outboxLista(db) }),
  },
};

// /api/foglalo/emlekezteto/futtat: az emlékeztetők kézi indítása az adminból (és ha van szolgáltató,
// a küldendő levelek elküldése, ugyanúgy, mint a cron)
async function emlekeztetoKezi({ env, db, url }) {
  const emlek = await emlekeztetoFuttat(env, db, { origin: url.origin });
  const levelek = await outboxKuld(env, db);
  return json({ mod: levelek.mod, ...emlek, levelek });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const reszek = url.pathname.replace(/^\/api\/foglalo\/?/, '').split('/').filter(Boolean);
  try {
    const valasz = await kezel(context, request, env, url, reszek);
    // foglalás felvétele, lemondása vagy áthelyezése után a friss levelek a háttérben mennek ki
    // (ha van beállított szolgáltató; outbox-módban semmi nem történik)
    if (valasz.ok && reszek[0] === 'foglalasok' && request.method !== 'GET') hatterKuldes(context, env, env.BOOKING_DB);
    return valasz;
  } catch (e) {
    return errorResponse(e);
  }
}

async function kezel(context, request, env, url, reszek) {
  // GET /api/foglalo/riport/forrasok?tol=&ig=   kampány-összesítő
  if (reszek.length === 2 && reszek[0] === 'riport' && reszek[1] === 'forrasok') {
    if (request.method !== 'GET') return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: 'GET' });
    return json(await forrasRiport(dbVagy503(env), url.searchParams));
  }
  // POST /api/foglalo/emlekezteto/futtat
  if (reszek.length === 2 && reszek[0] === 'emlekezteto' && reszek[1] === 'futtat') {
    if (request.method !== 'POST') return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: 'POST' });
    return await emlekeztetoKezi({ env, db: dbVagy503(env), url });
  }
  // PATCH /api/foglalo/kollegak/:id   egy kolléga mezői (részleges)
  if (reszek.length === 2 && reszek[0] === 'kollegak') {
    if (request.method !== 'PATCH') return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: 'PATCH' });
    const db = dbVagy503(env);
    return json(await kollegaModosit(db, reszek[1], await readJson(request, 16 * 1024)));
  }
  // POST /api/foglalo/kollegak/:id/archivalas   (jövőbeli foglalás esetén 409)
  if (reszek.length === 3 && reszek[0] === 'kollegak' && reszek[2] === 'archivalas') {
    if (request.method !== 'POST') return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: 'POST' });
    return json(await kollegaArchival(dbVagy503(env), reszek[1]));
  }
  // POST /api/foglalo/foglalasok/:azonosito/lemondas
  if (reszek.length === 3 && reszek[0] === 'foglalasok' && reszek[2] === 'lemondas') {
    if (request.method !== 'POST') return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: 'POST' });
    return json(await adminLemond(env, dbVagy503(env), reszek[1]));
  }
  // PATCH /api/foglalo/foglalasok/:azonosito  áthelyezés { datum, kezd, kollega }
  if (reszek.length === 2 && reszek[0] === 'foglalasok') {
    if (request.method !== 'PATCH') return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: 'PATCH' });
    const db = dbVagy503(env);
    return json(await adminModosit(env, db, reszek[1], await readJson(request, 4 * 1024), { origin: url.origin }));
  }
  const ut = reszek.length === 1 && Object.prototype.hasOwnProperty.call(UTAK, reszek[0]) ? UTAK[reszek[0]] : null;
  if (!ut) throw new HttpError(404, 'Ismeretlen API-végpont.');
  const h = ut[request.method];
  if (!h) return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: Object.keys(ut).join(', ') });
  return await h({ ...context, url, db: dbVagy503(env) });
}
