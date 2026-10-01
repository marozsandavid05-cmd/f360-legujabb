// Időpontfoglaló · admin API (/api/foglalo/*). A hitelesítést és a CSRF-védelmet a
// functions/api/_middleware.js végzi (Cloudflare Access JWT), ide csak belépett kérés jut.
//
//   GET|PUT  /api/foglalo/beallitasok                  helyszínek, szolgáltatások, kollégák (szin: #rrggbb), szabályok
//   PATCH    /api/foglalo/kollegak?kollega=            egy kolléga színe ({ szin: '#rrggbb' })
//   GET|PUT  /api/foglalo/beosztas?kollega=            heti minta ({ sorok:[{nap,helyszin,kezd,veg}] })
//   GET|POST|DELETE /api/foglalo/kivetelek             DELETE: ?id=
//   GET      /api/foglalo/foglalasok?tol=&ig=&helyszin=&kollega=&allapot=
//   POST     /api/foglalo/foglalasok                   kézi felvétel (e-mail és telefon nem kötelező)
//   POST     /api/foglalo/foglalasok/:azonosito/lemondas
//   GET      /api/foglalo/outbox                       elkészült, el nem küldött levelek

import { HttpError, errorResponse, json, readJson } from '../../_lib/http.js';
import { adminLemond, dbVagy503, foglal, foglalasBemenet, foglalasLista } from '../../_lib/booking/foglalas.js';
import { beallitasokMent, beosztasLekerd, beosztasMent, kivetelFelvesz, kivetelLista, kivetelTorol, kollegaSzinMent } from '../../_lib/booking/admin.js';
import { torzsBetolt } from '../../_lib/booking/schema.js';
import { mailMod, outboxLista } from '../../_lib/booking/mailer.js';

const UTAK = {
  beallitasok: {
    GET: async ({ db }) => json(await torzsBetolt(db)),
    PUT: async ({ db, request }) => json(await beallitasokMent(db, await readJson(request, 256 * 1024))),
  },
  kollegak: {
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
  outbox: {
    GET: async ({ env, db }) => json({ mod: mailMod(env), levelek: await outboxLista(db) }),
  },
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const reszek = url.pathname.replace(/^\/api\/foglalo\/?/, '').split('/').filter(Boolean);
  try {
    // POST /api/foglalo/foglalasok/:azonosito/lemondas
    if (reszek.length === 3 && reszek[0] === 'foglalasok' && reszek[2] === 'lemondas') {
      if (request.method !== 'POST') return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: 'POST' });
      return json(await adminLemond(env, dbVagy503(env), reszek[1]));
    }
    const ut = reszek.length === 1 && Object.prototype.hasOwnProperty.call(UTAK, reszek[0]) ? UTAK[reszek[0]] : null;
    if (!ut) throw new HttpError(404, 'Ismeretlen API-végpont.');
    const h = ut[request.method];
    if (!h) return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, { Allow: Object.keys(ut).join(', ') });
    return await h({ ...context, url, db: dbVagy503(env) });
  } catch (e) {
    return errorResponse(e);
  }
}
