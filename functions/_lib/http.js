// Studio F360 blog-admin · közös HTTP-segédek (JSON válasz, hibakezelés)
// Minden API-válasz JSON, a hibaüzenet magyarul a `error` mezőben.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ error: err.message, ...err.extra }, err.status);
  }
  // Váratlan hiba: a részlet csak a logba kerül (titok nélkül), a kliens általános üzenetet kap
  console.error('[api] váratlan hiba:', err && err.stack ? err.stack : String(err));
  return json({ error: 'Váratlan hiba történt a szerveren. Próbáld újra, és ha ismétlődik, jelezd a weboldal karbantartójának.' }, 500);
}

// Metódus szerinti elosztó: ismeretlen metódusra 405 JSON (nem esik át statikus oldalra)
export function methods(handlers) {
  return async (context) => {
    const h = handlers[context.request.method];
    if (!h) {
      return json({ error: 'Ez a művelet itt nem engedélyezett.' }, 405, {
        Allow: Object.keys(handlers).join(', '),
      });
    }
    try {
      return await h(context);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(request, maxBytes = 1024 * 1024) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'A kérés tartalma JSON legyen.');
  }
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'A bejegyzés túl nagy (legfeljebb 1 MB szöveg).');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'A bejegyzés túl nagy (legfeljebb 1 MB szöveg).');
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('nem objektum');
    return data;
  } catch {
    throw new HttpError(400, 'Hibás kérés: a tartalom nem értelmezhető JSON.');
  }
}
