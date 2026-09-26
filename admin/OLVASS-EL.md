# Blog szerkesztő (admin felület)

Studio F360 blog-admin felülete. Keretrendszer nélkül: `index.html` + `admin.css` + `admin.js`.
A belépést a Cloudflare Access adja (`/admin/*` és `/api/*` védett), saját login-oldal nincs.
Az API-t a `functions/api/` alatti Pages Functions adják (Caesar), a szerződés:
`David\f360\.hermes\plans\2026-09-26-f360-blog-admin-kozos.md`.

## Fájlok

- `index.html` · a felület váza (lista, szerkesztő, párbeszédablakok, előnézet)
- `admin.css` · csak az arculati színek (#303030 #EAEAEA #BFA18F #CCD6D9 #E4DBD2 #FFFFFF #000000), Cherion csak a fő címben
- `admin.js` · minden logika: lista, szerkesztő, képoptimalizálás, mentés, élesítés-állapot, előnézet
- `mock-api.js` · CSAK helyi teszthez, az `admin.js` kizárólag `?mock=1` mellett tölti be
- `vendor/marked.min.js` (v15.0.12, MIT, licenc: `vendor/marked-LICENSE.md`) · markdown → HTML
- `vendor/turndown.js` (v7.2.4, MIT, licenc: `vendor/turndown-LICENSE.txt`) · HTML → markdown

## Szerkesztő

Saját `contenteditable` szerkesztő eszköztárral (Címsor = H2, Alcím = H3, félkövér, dőlt,
felsorolás, számozott lista, idézet, link, kép, visszavonás, újra). Betöltéskor a markdownt a
marked alakítja HTML-lé, mentéskor a turndown vissza markdownná (`##`, `###`, `- `, `1. `,
`> `, `**`, `*`, `[szöveg](url)`, `![alt](media/blog/...)`). Wordből beillesztett szöveg a
tiszta szerkezetre szűrve kerül be. Mentetlen munka a böngészőben piszkozatként megmarad.

## Képek

Feltöltés előtt a böngészőben: EXIF szerinti forgatás (`createImageBitmap` +
`imageOrientation: from-image`), hosszabb oldal max 2000 px, WebP 0,82 minőség (ha a böngésző
nem tud WebP-t kódolni, JPG 0,85). A felület kiírja az eredeti és az új méretet.
A `POST /api/upload` a `file` mezőben kapja, és `{ "path": "media/blog/....webp" }`-t vár.

## Élesítés-állapot

A `GET /api/status` válaszából a `status` (vagy `state`) mezőt és az időt (`time`, `created_on`,
`modified_on`) olvassa. Elfogadott értékek: `building` | `success` | `failure` (a Cloudflare
saját szavai is: `active`, `queued`, `failed` stb.). Mentés után 4 majd 10 másodpercenként
kérdez, a felirat: „Mentve, élesítés folyamatban”, majd „Élesben”.

## Helyi teszt

A repó gyökeréből: `python -m http.server 8360`, majd
`http://localhost:8360/admin/?mock=1`. A mock a `blog.html`-ből veszi a slugokat és a
`content/blog/*.md` fájlokat olvassa, semmit nem ír a lemezre (sessionStorage).
Alaphelyzet: a konzolban `F360Mock.reset()`.
