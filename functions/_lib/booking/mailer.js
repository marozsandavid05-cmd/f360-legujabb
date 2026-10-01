// Időpontfoglaló · e-mail: outbox + provider-ág (Resend vagy Brevo)
//
// MAIL_PROVIDER env:
//   (nincs) vagy 'outbox'  → a kész levél a D1 `outbox` táblába kerül, sent = 0, NEM megy ki (bemutató).
//   'resend' / 'brevo'     → ha a MAIL_API_KEY (secret) és a MAIL_FROM is be van állítva, az outbox
//                            sent = 0 leveleit az outboxKuld() elküldi. Ha valamelyik hiányzik, marad
//                            az outbox-mód (és a naplóba figyelmeztetés kerül, titok nélkül).
//   MAIL_FROM:      'Studio F360 <foglalas@f360.hu>' vagy 'foglalas@f360.hu' (a domainnek hitelesítve
//                   kell lennie a szolgáltatónál: SPF, DKIM, DMARC, ehhez DNS kell)
//   MAIL_REPLY_TO:  opcionális válaszcím (például info@f360.hu)
//
// A levél a foglalással EGY batch-ben kerül az outboxba (lásd levelSorok), így nem lehet olyan
// foglalás, amihez nem készült el a levél, és olyan levél sem, amihez nincs foglalás. A küldés
// utána, külön lépésben fut (a kérés után a háttérben és a 15 perces ütemezővel), így egy
// szolgáltató-hiba soha nem rontja el a foglalást.
//
// outbox.sent: 0 = küldendő, 1 = elküldve, 2 = végleg sikertelen (hiba: az ok).
// Újrapróbálás: 429 és 503 esetén mindig; más 5xx és hálózati hiba esetén csak idempotens szolgáltatónál
// (Resend), legfeljebb MAX_PROBA alkalommal; más 4xx végleges. A 48 óránál régebbi, el nem küldött levél nem megy ki.
// Ismert korlát: ha a munkafolyamat a sikeres hívás UTÁN, de a sent = 1 írása ELŐTT áll le, a zár lejárta
// után a levél újra mehet (Resendnél az Idempotency-Key 24 óráig ezt is kiszűri, Brevónál nem).
// Párhuzamos futás ellen: a küldő egy UPDATE ... RETURNING-gel foglalja le a sorokat (zarolva_at);
// a félbeszakadt futás zárja ZAR_LEJAR után feloldódik.

import { sema } from './schema.js';

export const MAX_PROBA = 5;
export const ZAR_LEJAR = 10 * 60e3;
// A szolgáltató bekapcsolásakor a régi, bemutató-korszakból maradt (vagy napok óta beragadt) levelek
// NEM mennek ki tömegesen: ami ennél régebbi és még nem ment ki, az sent = 2 („elavult”) lesz.
export const OUTBOX_MAX_KOR = 48 * 3600e3;
const KOTEG = 20; // egy futásban legfeljebb ennyi levél
const IDOKORLAT = 10e3; // egy szolgáltató-hívás legfeljebb 10 mp

const FELADO_RE = /^\s*(?:"?([^"<>]{1,70}?)"?\s*<([^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,})>|([^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}))\s*$/;

/** 'Név <cim@domain>' vagy 'cim@domain' → { name?, email }; hibás alakra null. */
export function feladoBont(s) {
  const m = FELADO_RE.exec(String(s || ''));
  if (!m) return null;
  return m[3] ? { email: m[3] } : { name: m[1].trim(), email: m[2] };
}

export function mailMod(env) {
  const p = String(env.MAIL_PROVIDER || 'outbox').toLowerCase();
  if (p === 'outbox') return 'outbox';
  if (!PROVIDEREK[p]) {
    console.warn(`[mailer] ismeretlen MAIL_PROVIDER (${p}), a levelek csak az outboxba kerülnek`);
    return 'outbox';
  }
  if (!env.MAIL_API_KEY || !feladoBont(env.MAIL_FROM)) {
    console.warn('[mailer] a MAIL_API_KEY vagy a MAIL_FROM hiányzik vagy hibás, a levelek csak az outboxba kerülnek');
    return 'outbox';
  }
  return p;
}

/** Az outbox-sorok beszúró utasításai (a hívó teszi a saját batch-ébe). */
export function levelSorok(db, bookingId, levelek, most = Date.now()) {
  return levelek
    .filter((l) => l.cimzett)
    .map((l) => db.prepare(
      `INSERT INTO outbox (booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).bind(bookingId, l.tipus, l.cimzett, l.targy, l.html, l.szoveg, l.ics ?? null, most));
}

export async function outboxLista(db, limit = 100) {
  const { results } = await db.prepare(
    `SELECT id, booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at, hiba, probalkozas, kuldve_at FROM outbox ORDER BY id DESC LIMIT ?`,
  ).bind(limit).all();
  return (results || []).map((r) => ({
    id: r.id,
    azonosito: r.booking_id,
    tipus: r.tipus,
    cimzett: r.cimzett,
    targy: r.targy,
    html: r.html,
    szoveg: r.szoveg,
    ics: r.ics,
    elkuldve: r.sent === 1,
    sikertelen: r.sent === 2,
    hiba: r.hiba ?? null,
    probalkozas: r.probalkozas ?? 0,
    kuldve: r.kuldve_at ? new Date(r.kuldve_at).toISOString() : null,
    letrehozva: new Date(r.created_at).toISOString(),
  }));
}

// ---------------------------------------------------------------- szolgáltatók

function base64Utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const icsNev = (sor) => `studio-f360-${sor.booking_id || sor.id}.ics`;

const PROVIDEREK = {
  // https://resend.com/docs/api-reference/emails/send-email
  resend: (env, sor) => {
    const felado = feladoBont(env.MAIL_FROM);
    const body = {
      from: felado.name ? `${felado.name} <${felado.email}>` : felado.email,
      to: [sor.cimzett],
      subject: sor.targy,
      html: sor.html,
      text: sor.szoveg,
    };
    if (env.MAIL_REPLY_TO) body.reply_to = String(env.MAIL_REPLY_TO);
    if (sor.ics) body.attachments = [{ filename: icsNev(sor), content: base64Utf8(sor.ics), content_type: 'text/calendar; charset=utf-8' }];
    return {
      url: 'https://api.resend.com/emails',
      headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `f360-outbox-${sor.id}` },
      body,
      azonosito: (v) => v && v.id,
      // a Resend az Idempotency-Key fejlécet 24 óráig betartja: hálózati hiba vagy időtúllépés
      // után az újrapróbálás nem küld kétszer
      idempotens: true,
    };
  },
  // https://developers.brevo.com/reference/sendtransacemail
  brevo: (env, sor) => {
    const felado = feladoBont(env.MAIL_FROM);
    const body = {
      sender: felado.name ? { name: felado.name, email: felado.email } : { email: felado.email },
      to: [{ email: sor.cimzett }],
      subject: sor.targy,
      htmlContent: sor.html,
      textContent: sor.szoveg,
      headers: { 'Idempotency-Key': `f360-outbox-${sor.id}` },
    };
    if (env.MAIL_REPLY_TO) body.replyTo = { email: String(env.MAIL_REPLY_TO) };
    if (sor.ics) body.attachment = [{ name: icsNev(sor), content: base64Utf8(sor.ics) }];
    return {
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: { 'api-key': String(env.MAIL_API_KEY), 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      azonosito: (v) => v && v.messageId,
      // a Brevo dokumentációja nem ígér kérés-szintű idempotenciát (a fenti fejléc csak a levélbe
      // kerül): ha a válasz nem jött meg (időtúllépés, hálózati hiba), lehet, hogy a levél kiment,
      // ezért ilyenkor NEM próbáljuk újra (inkább egy levél hiányozzon, mint kétszer menjen ki)
      idempotens: false,
    };
  },
};

/**
 * A hibaüzenet a naplóba és az outboxba: rövid, a kulcs és az e-mail-cím biztosan nincs benne (a
 * szolgáltató hibaüzenete visszaírhatja a címzettet, ami páciensadat, a naplóba nem kerülhet).
 */
function tisztaHiba(s, env) {
  let t = String(s).replace(/\s+/g, ' ');
  if (env.MAIL_API_KEY) t = t.split(String(env.MAIL_API_KEY)).join('[kulcs]');
  t = t.replace(/[^\s@<>"'`,;:()]+@[^\s@<>"'`,;:()]+/g, '[e-mail]');
  return t.slice(0, 300);
}

async function egyetKuld(env, sor, fetchFn) {
  const k = PROVIDEREK[mailMod(env)](env, sor);
  let r;
  try {
    r = await fetchFn(k.url, { method: 'POST', headers: k.headers, body: JSON.stringify(k.body), signal: AbortSignal.timeout(IDOKORLAT) });
  } catch (e) {
    if (!k.idempotens) return { ok: false, atmeneti: false, hiba: tisztaHiba(`bizonytalan kézbesítés, nem próbáljuk újra: ${e && e.message}`, env) };
    return { ok: false, atmeneti: true, hiba: tisztaHiba(`hálózati hiba: ${e && e.message}`, env) };
  }
  let valasz = null;
  try { valasz = await r.json(); } catch { /* üres vagy nem JSON válasz */ }
  if (r.ok) return { ok: true, providerId: String(k.azonosito(valasz) || '') || null };
  const uzenet = valasz && (valasz.message || valasz.error || valasz.code);
  // 429 és 503: a szolgáltató biztosan nem fogadta be, újrapróbálható. A többi 5xx (500, 502, 504)
  // után a levél akár ki is mehetett: csak idempotens szolgáltatónál próbáljuk újra.
  const atmeneti = r.status === 429 || r.status === 503 || (r.status >= 500 && k.idempotens);
  return { ok: false, atmeneti, hiba: tisztaHiba(`HTTP ${r.status}${uzenet ? `: ${typeof uzenet === 'string' ? uzenet : JSON.stringify(uzenet)}` : ''}`, env) };
}

/**
 * Az outbox küldendő leveleinek elküldése. Outbox-módban nem csinál semmit (nincs hálózati hívás).
 * @returns {{ mod: string, kuldve: number, hibas: number, vegleges: number }}
 */
export async function outboxKuld(env, db, { fetchFn = globalThis.fetch, most = Date.now(), koteg = KOTEG } = {}) {
  const mod = mailMod(env);
  const ered = { mod, kuldve: 0, hibas: 0, vegleges: 0, elavult: 0 };
  if (mod === 'outbox') return ered;
  await sema(db);
  const regi = await db.prepare(
    `UPDATE outbox SET sent = 2, hiba = 'elavult: ${OUTBOX_MAX_KOR / 3600e3} óránál régebbi, nem küldtük ki' WHERE sent = 0 AND created_at < ?`,
  ).bind(most - OUTBOX_MAX_KOR).run();
  ered.elavult = Number(regi.meta && regi.meta.changes) || 0;
  // lefoglalás egy utasításban: amit egy párhuzamos futás már lefoglalt, azt ez nem kapja meg
  const { results } = await db.prepare(
    `UPDATE outbox SET zarolva_at = ? WHERE id IN (
       SELECT id FROM outbox WHERE sent = 0 AND (zarolva_at IS NULL OR zarolva_at < ?) ORDER BY id LIMIT ?
     ) RETURNING id, booking_id, tipus, cimzett, targy, html, szoveg, ics, probalkozas`,
  ).bind(most, most - ZAR_LEJAR, koteg).all();
  for (const sor of (results || []).sort((a, b) => a.id - b.id)) {
    const r = await egyetKuld(env, sor, fetchFn);
    const proba = Number(sor.probalkozas || 0) + 1;
    if (r.ok) {
      await db.prepare(`UPDATE outbox SET sent = 1, kuldve_at = ?, provider_id = ?, hiba = NULL, zarolva_at = NULL, probalkozas = ? WHERE id = ?`)
        .bind(Date.now(), r.providerId, proba, sor.id).run();
      ered.kuldve++;
    } else {
      const vegleges = !r.atmeneti || proba >= MAX_PROBA;
      await db.prepare(`UPDATE outbox SET sent = ?, hiba = ?, zarolva_at = NULL, probalkozas = ? WHERE id = ?`)
        .bind(vegleges ? 2 : 0, r.hiba, proba, sor.id).run();
      console.warn(`[mailer] outbox #${sor.id} (${sor.tipus}) ${vegleges ? 'végleg sikertelen' : 'újrapróbálandó'}: ${r.hiba}`);
      if (vegleges) ered.vegleges++;
      else ered.hibas++;
    }
  }
  return ered;
}

/**
 * Sikeres módosító kérés után a háttérben elküldi a friss leveleket (ha van szolgáltató). A
 * context.waitUntil-t az eredeti context-en hívja (nem leválasztva), a hibát naplózza.
 */
export function hatterKuldes(context, env, db) {
  if (mailMod(env) === 'outbox' || !db || typeof context.waitUntil !== 'function') return;
  context.waitUntil(outboxKuld(env, db).catch((e) => console.error('[mailer] háttér-küldés hiba:', e && e.message)));
}
