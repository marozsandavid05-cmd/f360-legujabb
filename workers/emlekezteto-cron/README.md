# Studio F360 · emlékeztető-ütemező

Kis, külön Cloudflare Worker. 15 percenként (`*/15 * * * *`) meghívja a foglaló végpontját:

    POST https://<foglaló>/foglalas-api/cron/emlekezteto
    X-Cron-Kulcs: <CRON_SECRET>

A végpont:

1. megkeresi a megerősített foglalásokat, amelyek kezdése a következő `emlekeztetoOra` (alap 30) órán belül van, és még nem kaptak emlékeztetőt; mindegyiknek egy `emlekezteto` levelet ír az outboxba (egyszer, idempotensen),
2. ha be van állítva e-mail-szolgáltató, az outbox küldendő leveleit (az újakat és a korábban átmenetileg sikerteleneket is) elküldi.

**Állapot (2026-10-01): nincs deployolva, a `CRON_SECRET` sincs beállítva.** Amíg a Pages projekten nincs `CRON_SECRET`, a végpont 503-at ad, vagyis ki van kapcsolva.

## Élesítés (David jóváhagyásával)

1. Közös titok generálása (legalább 24 karakter), például: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Az értéket ne írd chatbe vagy fájlba.
2. Pages projekt (foglaló): `npx wrangler pages secret put CRON_SECRET --project-name f360-legujabb` (ugyanaz az érték).
3. Ebben a mappában: a `wrangler.toml` `FOGLALO_URL` értékét állítsd az éles címre, majd `npx wrangler secret put CRON_SECRET` (ugyanaz az érték) és `npx wrangler deploy`.
4. Ellenőrzés: a Cloudflare felületen a Worker „Triggers” fülén a cron látszik; a Logs-ban 15 percenként egy `emlekezteto-cron` sor `status: 200`-zal. Kézzel: `curl -X POST -H "X-Cron-Kulcs: ..." https://<foglaló>/foglalas-api/cron/emlekezteto` (a választ a titok nélkül nézd).

Az admin felületen ugyanez kézzel is indítható: `POST /api/foglalo/emlekezteto/futtat`.

## E-mail-küldés bekapcsolása (DNS kell)

A Pages projekten: `MAIL_PROVIDER` (`resend` vagy `brevo`), `MAIL_FROM` (például `Studio F360 <foglalas@f360.hu>`), opcionálisan `MAIL_REPLY_TO`, és secretként `MAIL_API_KEY`. A feladó domainjét a szolgáltatónál hitelesíteni kell (SPF, DKIM, DMARC DNS-rekordok). Amíg ezek nincsenek meg, minden levél az outboxban marad (`sent = 0`), és semmi nem megy ki.
