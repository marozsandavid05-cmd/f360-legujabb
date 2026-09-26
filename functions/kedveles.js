// Studio F360 · nyilvános kedvelés-számláló (Cloudflare D1, kötés: LIKES_DB)
//
//   GET  /kedveles?s=slug1,slug2      → { counts: { slug1: 3, slug2: 0 } }
//   POST /kedveles  {slug, voter, like} → { slug, count, liked }
//
// Mindenki ugyanazt a számot látja, 0-ról indul. Hozzászólás nincs.
// Egy látogató (voter: a böngészőjében tárolt véletlen azonosító) egy bejegyzést
// egyszer kedvelhet, visszavonni is tudja. Személyes adat nincs: az IP csak
// napi sóval hash-elve, a visszaélés-korláthoz kerül tárolásra, és 2 nap után törlődik.
// A tábla magától létrejön az első kérésnél.

const SLUG_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,120}$/;
const VOTER_RE = /^[a-z0-9-]{16,64}$/;
const MAX_SLUGS = 60;
const NAPI_KORLAT = 120; // egy IP-ről naponta ennyi kedvelés-változtatás

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const valasz = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const hiba = (status, error) => valasz({ error }, status);

const SEMA = [
  `CREATE TABLE IF NOT EXISTS kedveles (slug TEXT NOT NULL, voter TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (slug, voter))`,
  `CREATE TABLE IF NOT EXISTS kedveles_korlat (iph TEXT NOT NULL, nap TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (iph, nap))`,
];
let semaKesz = false;
async function sema(db) {
  if (semaKesz) return;
  await db.batch(SEMA.map((s) => db.prepare(s)));
  semaKesz = true;
}
export function _semaReset() { semaKesz = false; }

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function szamok(db, slugs) {
  const counts = Object.fromEntries(slugs.map((s) => [s, 0]));
  if (!slugs.length) return counts;
  const q = `SELECT slug, COUNT(*) AS n FROM kedveles WHERE slug IN (${slugs.map(() => '?').join(',')}) GROUP BY slug`;
  const { results } = await db.prepare(q).bind(...slugs).all();
  for (const r of results || []) counts[r.slug] = Number(r.n) || 0;
  return counts;
}

async function letezik(env, request, slug) {
  if (!env.ASSETS) return true; // teszt / helyi futás
  const r = await env.ASSETS.fetch(new URL(`/blog/${slug}`, request.url));
  return r.status === 200;
}

export async function onRequestGet({ request, env }) {
  if (!env.LIKES_DB) return hiba(503, 'A kedvelés most nem elérhető.');
  const url = new URL(request.url);
  const slugs = [...new Set((url.searchParams.get('s') || '').split(',').map((x) => x.trim()).filter(Boolean))];
  if (slugs.length > MAX_SLUGS || slugs.some((s) => !SLUG_RE.test(s))) return hiba(400, 'Hibás kérés.');
  await sema(env.LIKES_DB);
  return valasz({ counts: await szamok(env.LIKES_DB, slugs) });
}

export async function onRequestPost({ request, env }) {
  if (!env.LIKES_DB) return hiba(503, 'A kedvelés most nem elérhető.');
  // csak a saját oldalról jöhet (más weboldal ne kedveltethessen a látogató nevében)
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return hiba(403, 'Nem engedélyezett.');
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) return hiba(415, 'Hibás kérés.');
  const text = await request.text();
  if (text.length > 1000) return hiba(413, 'Hibás kérés.');
  let d;
  try { d = JSON.parse(text); } catch { return hiba(400, 'Hibás kérés.'); }
  const slug = String(d && d.slug || '');
  const voter = String(d && d.voter || '');
  const like = d && d.like === true;
  if (!SLUG_RE.test(slug) || !VOTER_RE.test(voter)) return hiba(400, 'Hibás kérés.');

  const db = env.LIKES_DB;
  await sema(db);
  if (!(await letezik(env, request, slug))) return hiba(404, 'Nincs ilyen bejegyzés.');

  // napi korlát IP-nként (hash napi sóval, nyers IP nem kerül tárolásra)
  const nap = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') || 'ismeretlen';
  const iph = (await sha256(`${nap}|${ip}|${env.ACCESS_AUD || 'f360'}`)).slice(0, 32);
  const sor = await db.prepare(
    `INSERT INTO kedveles_korlat (iph, nap, n) VALUES (?, ?, 1)
     ON CONFLICT(iph, nap) DO UPDATE SET n = n + 1 RETURNING n`).bind(iph, nap).first();
  if (sor && Number(sor.n) > NAPI_KORLAT) return hiba(429, 'Túl sok kérés, próbáld később.');

  if (like) {
    await db.prepare(`INSERT OR IGNORE INTO kedveles (slug, voter, ts) VALUES (?, ?, ?)`).bind(slug, voter, Date.now()).run();
  } else {
    await db.prepare(`DELETE FROM kedveles WHERE slug = ? AND voter = ?`).bind(slug, voter).run();
  }
  // régi korlát-sorok takarítása (2 napnál régebbiek)
  const tegnapelott = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  await db.prepare(`DELETE FROM kedveles_korlat WHERE nap < ?`).bind(tegnapelott).run();

  const counts = await szamok(db, [slug]);
  return valasz({ slug, count: counts[slug], liked: like });
}
