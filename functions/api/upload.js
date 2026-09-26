// POST /api/upload  (multipart/form-data, mező: file; opcionális mező: slug vagy name)
// → { path: "media/blog/<név>-<rövid-hash>.<kiterjesztés>", commit|null, existed }
//
// Ellenőrzés: legfeljebb 5 MB, csak WebP / JPEG / PNG, és a típust a fájl tartalmából
// (magic bytes) döntjük el, nem a böngésző által küldött MIME-ból.
// A hash a tartalomból jön, így ugyanaz a kép másodszor nem kerül fel újra (nincs új commit).

import { json, methods, HttpError } from '../_lib/http.js';
import { githubFromEnv, commitMessage } from '../_lib/github.js';
import { bytesToBase64, sha256Hex } from '../_lib/base64.js';
import { kebab, titlePart } from '../_lib/posts.js';

export const MAX_UPLOAD = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/webp', 'image/jpeg', 'image/png']);

export function sniffImage(u8) {
  if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46
      && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47
      && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  return null;
}

function baseName(form, file) {
  const hint = form.get('slug') || form.get('name') || '';
  const fromHint = typeof hint === 'string' ? titlePart(hint, 50) : '';
  if (fromHint) return fromHint;
  const orig = String((file && file.name) || '').replace(/\.[a-z0-9]+$/i, '');
  return titlePart(kebab(orig), 50) || 'kep';
}

export const onRequest = methods({
  POST: async ({ request, env, data }) => {
    const ct = request.headers.get('Content-Type') || '';
    if (!ct.toLowerCase().startsWith('multipart/form-data')) {
      throw new HttpError(415, 'A képet multipart űrlapként kell küldeni (file mező).');
    }
    // a multipart keret miatt egy kis ráhagyás; a pontos méretet a fájlon is ellenőrizzük
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_UPLOAD + 64 * 1024) throw new HttpError(413, 'A kép túl nagy, legfeljebb 5 MB lehet.');

    let form;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'A feltöltés nem értelmezhető. Próbáld újra.');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Nincs kiválasztott kép (file mező).');
    if (file.size === 0) throw new HttpError(400, 'A kiválasztott fájl üres.');
    if (file.size > MAX_UPLOAD) throw new HttpError(413, 'A kép túl nagy, legfeljebb 5 MB lehet.');

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind || !ALLOWED_MIME.has(kind.mime)) {
      throw new HttpError(415, 'Csak WebP, JPEG vagy PNG kép tölthető fel.');
    }

    const hash = (await sha256Hex(bytes)).slice(0, 8);
    const path = `media/blog/${baseName(form, file)}-${hash}.${kind.ext}`;
    const gh = githubFromEnv(env);

    if (await gh.exists(path)) {
      return json({ path, commit: null, existed: true });
    }
    try {
      const r = await gh.putFile(path, {
        contentBase64: bytesToBase64(bytes),
        message: commitMessage('kép feltöltése', path, data.email),
      });
      return json({ path, commit: r.commit, existed: false }, 201);
    } catch (e) {
      // ugyanaz a tartalom közben felkerült (párhuzamos feltöltés): a cél így is teljesült
      if (e instanceof HttpError && e.status === 409) return json({ path, commit: null, existed: true });
      throw e;
    }
  },
});
