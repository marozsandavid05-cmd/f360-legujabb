// Időpontfoglaló · lemondó-token
// Alak: "<foglalás-azonosító>.<HMAC-SHA256(kulcs, 'lemondas|' + azonosító + '|' + só) base64url>"
// A só foglalásonként véletlen és csak az adatbázisban van, így a token az azonosítóból sem
// számolható ki a kulcs nélkül. Az ellenőrzés crypto.subtle.verify-jal megy (állandó idejű).
// „Egyszer használható”: lemondás után ugyanaz a token már csak a lemondott állapotot mutatja.

const enc = new TextEncoder();
const ID_ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, nincs I, L, O, U

export function ujAzonosito() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return `F${[...b].map((x) => ID_ABC[x & 31]).join('')}`;
}

export function ujSo() {
  return b64u(crypto.getRandomValues(new Uint8Array(16)));
}

function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  try {
    return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const kulcs = (k) => crypto.subtle.importKey('raw', enc.encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const uzenet = (id, so) => enc.encode(`lemondas|${id}|${so}`);

export async function tokenKeszit(secret, id, so) {
  const sig = await crypto.subtle.sign('HMAC', await kulcs(secret), uzenet(id, so));
  return `${id}.${b64u(new Uint8Array(sig))}`;
}

/** A tokenből az azonosító (az adatbázis-kereséshez); rossz alakra null. */
export function tokenAzonosito(token) {
  const m = /^(F[0-9A-Z]{10})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  return m ? m[1] : null;
}

export async function tokenEllenoriz(secret, token, so) {
  const id = tokenAzonosito(token);
  if (!id) return false;
  const sig = b64uDecode(String(token).split('.')[1]);
  if (!sig || sig.length !== 32) return false;
  return crypto.subtle.verify('HMAC', await kulcs(secret), sig, uzenet(id, so));
}
