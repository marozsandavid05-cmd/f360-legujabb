// Studio F360 · emlékeztető-ütemező (külön, kis Worker). NINCS DEPLOYOLVA.
//
// 15 percenként meghívja a foglaló emlékeztető-végpontját:
//   POST <FOGLALO_URL>/foglalas-api/cron/emlekezteto   X-Cron-Kulcs: <CRON_SECRET>
// A végpont az emlékeztetőket az outboxba írja, és ha be van állítva e-mail-szolgáltató
// (MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM a Pages projekten), a küldendő leveleket el is küldi.
//
// Beállítás élesítéskor (lásd README.md): FOGLALO_URL változó a wrangler.toml-ban, a CRON_SECRET
// secretként ugyanazzal az értékkel, mint a Pages projekten (wrangler secret put CRON_SECRET).

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(futtat(env, controller.scheduledTime));
  },
};

export async function futtat(env, ido = Date.now(), fetchFn = fetch) {
  if (!env.FOGLALO_URL || !env.CRON_SECRET) {
    console.error(JSON.stringify({ uzenet: 'emlekezteto-cron: FOGLALO_URL vagy CRON_SECRET hiányzik', ido }));
    return { ok: false, status: 0 };
  }
  const url = `${String(env.FOGLALO_URL).replace(/\/+$/, '')}/foglalas-api/cron/emlekezteto`;
  let r;
  try {
    r = await fetchFn(url, { method: 'POST', headers: { 'X-Cron-Kulcs': env.CRON_SECRET }, signal: AbortSignal.timeout(25e3) });
  } catch (e) {
    console.error(JSON.stringify({ uzenet: 'emlekezteto-cron: hálózati hiba', hiba: String(e && e.message), ido }));
    return { ok: false, status: 0 };
  }
  let valasz = null;
  try { valasz = await r.json(); } catch { /* nem JSON */ }
  const naplo = { uzenet: 'emlekezteto-cron', status: r.status, ido, ...(valasz && typeof valasz === 'object' ? valasz : {}) };
  if (r.ok) console.log(JSON.stringify(naplo));
  else console.error(JSON.stringify(naplo));
  return { ok: r.ok, status: r.status, valasz };
}
