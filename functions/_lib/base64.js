// Base64 ⇄ bájt / UTF-8 szöveg (a GitHub Contents API base64-et vár és ad vissza)

export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

export function base64ToUtf8(b64) {
  return new TextDecoder('utf-8').decode(base64ToBytes(b64));
}

export function base64UrlToBytes(s) {
  let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return base64ToBytes(b64);
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
