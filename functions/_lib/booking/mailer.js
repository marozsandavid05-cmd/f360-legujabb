// Időpontfoglaló · e-mail provider-seam
//
// MAIL_PROVIDER env:
//   (nincs) vagy 'outbox'  → a kész levél a D1 `outbox` táblába kerül, sent = 0, NEM megy ki (bemutató).
//   'resend' / 'brevo'     → még nincs bekötve (nincs DNS a domainen). Addig ezek is csak az outboxba
//                            írnak, és a naplóba figyelmeztetés kerül. A bekötés helye: kuld() lent.
//
// A levél a foglalással EGY batch-ben kerül az outboxba (lásd levelSorok), így nem lehet olyan
// foglalás, amihez nem készült el a levél, és olyan levél sem, amihez nincs foglalás.

export function mailMod(env) {
  const p = String(env.MAIL_PROVIDER || 'outbox').toLowerCase();
  if (p !== 'outbox') console.warn(`[mailer] MAIL_PROVIDER=${p} még nincs bekötve, a levél csak az outboxba kerül`);
  return 'outbox';
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
    `SELECT id, booking_id, tipus, cimzett, targy, html, szoveg, ics, sent, created_at FROM outbox ORDER BY id DESC LIMIT ?`,
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
    letrehozva: new Date(r.created_at).toISOString(),
  }));
}
