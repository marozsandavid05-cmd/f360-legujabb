// /api/* közös kapu: hitelesítés (Cloudflare Access JWT), CSRF-védelem, hibakezelés.
// Siker esetén context.data.email = a belépett felhasználó e-mail-címe.
//
// Helyi fejlesztés: DEV_EMAIL env + localhost/127.0.0.1 host. Élesben a host soha nem localhost,
// ezért a DEV_EMAIL ott akkor sem kapcsol be, ha véletlenül beállítanák.

import { verifyAccessJwt } from '../_lib/access.js';
import { json, errorResponse } from '../_lib/http.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function unauthorized() {
  return json({ error: 'Nem vagy bejelentkezve, vagy lejárt a belépésed. Töltsd újra az oldalt, és lépj be újra.' }, 401);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    // CSRF: böngészőből érkező módosító kérés csak ugyanarról az originről jöhet
    if (MUTATING.has(request.method)) {
      const origin = request.headers.get('Origin');
      const site = request.headers.get('Sec-Fetch-Site');
      if ((origin && origin !== url.origin) || (site && !['same-origin', 'none'].includes(site))) {
        return json({ error: 'A kérés nem az admin felületről érkezett, ezért elutasítottuk.' }, 403);
      }
    }

    let email = null;
    const isLocal = LOCAL_HOSTS.has(url.hostname);

    if (env.DEV_EMAIL && isLocal) {
      email = String(env.DEV_EMAIL);
    } else {
      if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
        console.error('[auth] ACCESS_TEAM_DOMAIN / ACCESS_AUD nincs beállítva');
        return json({ error: 'A belépés nincs beállítva a szerveren. Szólj Davidnek.' }, 500);
      }
      const token = request.headers.get('Cf-Access-Jwt-Assertion');
      if (!token) return unauthorized();
      try {
        const payload = await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD });
        email = payload.email;
      } catch (e) {
        console.warn('[auth] elutasított token:', e && e.message);
        return unauthorized();
      }
    }

    context.data.email = email;
    return await context.next();
  } catch (e) {
    return errorResponse(e);
  }
}
