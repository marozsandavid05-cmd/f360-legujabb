/* =====================================================================
   STUDIO F360 · BLOG SZERKESZTŐ · mock-api.js
   CSAK HELYI TESZTHEZ. Az admin.js kizárólag ?mock=1 mellett tölti be.
   Ugyanazt az API-t szimulálja, amit a Cloudflare Pages Functions ad
   (lásd .hermes/plans/2026-09-26-f360-blog-admin-kozos.md), a meglévő
   content/blog/*.md fájlokból. Semmit nem ír a lemezre: a változások a
   böngésző memóriájában és a sessionStorage-ban élnek.
   Futtatás: a repó gyökeréből `python -m http.server 8360`, majd
   http://localhost:8360/admin/?mock=1
   ===================================================================== */
(function () {
  'use strict';

  var ROOT = new URL('../', location.href).href;
  var STORE_KEY = 'f360-mock-posts-v1';
  var realFetch = window.fetch.bind(window);
  var posts = {};           // slug → { title, date, author, category, cover, excerpt, body, sha }
  var deploy = { status: 'success', time: new Date(Date.now() - 3600e3).toISOString() };
  var buildTimer = null;

  function sha(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8) + s.length.toString(16);
  }
  function slugify(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
  }
  function parseFrontmatter(raw) {
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    if (!m) return { data: {}, body: raw };
    var data = {};
    m[1].split(/\r?\n/).forEach(function (line) {
      var kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (!kv) return;
      var v = kv[2].trim();
      if ((v[0] === '"' && v.slice(-1) === '"') || (v[0] === "'" && v.slice(-1) === "'")) v = v.slice(1, -1);
      data[kv[1]] = v;
    });
    return { data: data, body: m[2].replace(/\r\n/g, '\n') };
  }
  // a Function is pontosan így írja ki a fájlt (a frontmatter-mezők sorrendje a meglévőké)
  function serialize(p) {
    var q = function (v) { return /[:#"']|^\s|\s$/.test(v) ? '"' + String(v).replace(/"/g, '\\"') + '"' : v; };
    return '---\ntitle: ' + q(p.title) + '\ndate: ' + p.date + '\nauthor: ' + q(p.author || 'Studio F360') +
      '\ncategory: ' + p.category + '\ncover: ' + (p.cover || '') + '\nexcerpt: ' + q(p.excerpt || '') +
      '\n---\n' + (p.body || '').replace(/\s+$/, '') + '\n';
  }
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(posts)); } catch (e) { /* tele */ }
  }
  function commit() { return 'mock' + Math.random().toString(16).slice(2, 9); }
  function startBuild() {
    deploy = { status: 'building', time: new Date().toISOString() };
    clearTimeout(buildTimer);
    buildTimer = setTimeout(function () {
      deploy = { status: 'success', time: new Date().toISOString() };
    }, 7000);
  }
  function json(status, body) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    }));
  }
  function delay(p, ms) { return new Promise(function (r) { setTimeout(function () { r(p); }, ms); }).then(function (x) { return x; }); }
  function summary(slug) {
    var p = posts[slug];
    return { slug: slug, title: p.title, date: p.date, category: p.category, cover: p.cover, excerpt: p.excerpt, author: p.author };
  }
  var CATS = { mozgas: 1, sport: 1, taplalkozas: 1 };
  function check(b) {
    if (!b || !String(b.title || '').trim()) return 'Hiányzik a cím.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return 'A dátum formátuma érvénytelen.';
    if (!CATS[b.category]) return 'Ismeretlen témakör.';
    if (!String(b.body || '').trim()) return 'A bejegyzés szövege üres.';
    return null;
  }
  function pick(b) {
    return {
      title: String(b.title).trim(), date: b.date, category: b.category,
      author: String(b.author || '').trim() || 'Studio F360',
      excerpt: String(b.excerpt || '').trim(), cover: String(b.cover || '').trim(),
      body: String(b.body || '')
    };
  }

  /* ---- betöltés: a slugok a generált blog.html-ből, a tartalom a content/blog/*.md-ből ---- */
  function load() {
    try {
      var saved = sessionStorage.getItem(STORE_KEY);
      if (saved) { posts = JSON.parse(saved); return Promise.resolve(); }
    } catch (e) { /* nincs tárhely */ }
    return realFetch(ROOT + 'blog.html').then(function (r) { return r.text(); }).then(function (html) {
      var slugs = {};
      html.replace(/href="blog\/([^"#?]+)\.html"/g, function (_, s) { slugs[s] = 1; return _; });
      return Promise.all(Object.keys(slugs).map(function (slug) {
        return realFetch(ROOT + 'content/blog/' + slug + '.md').then(function (r) {
          if (!r.ok) return;
          return r.text().then(function (raw) {
            var fm = parseFrontmatter(raw);
            posts[slug] = {
              title: fm.data.title || slug, date: fm.data.date || '1970-01-01', author: fm.data.author || '',
              category: CATS[fm.data.category] ? fm.data.category : 'mozgas', cover: fm.data.cover || '',
              excerpt: fm.data.excerpt || '', body: fm.body, sha: sha(raw)
            };
          });
        });
      }));
    }).then(save).catch(function (e) {
      console.warn('[mock-api] a meglévő bejegyzések betöltése nem sikerült (file:// alatt a böngésző tiltja, http szerver kell):', e.message);
    });
  }

  /* ---- a fetch elfogása: csak a /api/* kérések ---- */
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var u = new URL(url, location.href);
    if (!/^\/api\//.test(u.pathname) || u.origin !== location.origin) return realFetch(input, init);
    init = init || {};
    var method = (init.method || 'GET').toUpperCase();
    var path = u.pathname.replace(/^\/api/, '');
    var m;
    var body = null;
    if (init.body && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = null; } }

    var res;
    if (path === '/me' && method === 'GET') {
      res = json(200, { email: 'teszt@f360.hu' });
    } else if (path === '/status' && method === 'GET') {
      res = json(200, deploy);
    } else if (path === '/posts' && method === 'GET') {
      var list = Object.keys(posts).map(summary).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      res = json(200, list);
    } else if (path === '/posts' && method === 'POST') {
      var err = check(body);
      if (err) res = json(400, { error: err });
      else {
        var p = pick(body);
        var base = p.date + '-' + slugify(p.title), slug = base, n = 2;
        while (posts[slug]) slug = base + '-' + (n++);
        p.sha = sha(serialize(p));
        posts[slug] = p; save(); startBuild();
        res = json(201, { slug: slug, commit: commit() });
      }
    } else if ((m = /^\/posts\/([^/]+)$/.exec(path))) {
      var s = decodeURIComponent(m[1]);
      var cur = posts[s];
      if (!cur) res = json(404, { error: 'Nincs ilyen bejegyzés, lehet, hogy közben törölték.' });
      else if (method === 'GET') {
        res = json(200, Object.assign({ slug: s }, cur));
      } else if (method === 'PUT') {
        var e2 = check(body);
        if (e2) res = json(400, { error: e2 });
        else if (body.sha && body.sha !== cur.sha) res = json(409, { error: 'Közben valaki más is módosította, töltsd újra.' });
        else {
          var np = pick(body);
          np.sha = sha(serialize(np) + Date.now());
          posts[s] = np; save(); startBuild();
          res = json(200, { slug: s, commit: commit() });
        }
      } else if (method === 'DELETE') {
        delete posts[s]; save(); startBuild();
        res = json(200, { ok: true, commit: commit() });
      } else res = json(405, { error: 'Nem támogatott művelet.' });
    } else if (path === '/upload' && method === 'POST') {
      var file = init.body && init.body.get ? init.body.get('file') : null;
      if (!file) res = json(400, { error: 'Nincs fájl a kérésben.' });
      else if (file.size > 5 * 1024 * 1024) res = json(413, { error: 'A kép túl nagy, legfeljebb 5 MB lehet.' });
      else if (!/^image\/(webp|jpeg|png)$/.test(file.type)) res = json(415, { error: 'Csak WebP, JPG vagy PNG kép tölthető fel.' });
      else {
        var ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
        var name = slugify(String(file.name || 'kep').replace(/\.[^.]+$/, '')) || 'kep';
        var h = Math.random().toString(16).slice(2, 8);
        console.info('[mock-api] feltöltés:', file.name, Math.round(file.size / 1024) + ' kB', file.type);
        res = json(200, { path: 'media/blog/' + name + '-' + h + '.' + ext });
      }
    } else {
      res = json(404, { error: 'Ismeretlen végpont.' });
    }
    return delay(res, method === 'GET' ? 120 : 450);
  };

  window.F360Mock = { posts: function () { return posts; }, serialize: serialize, reset: function () { sessionStorage.removeItem(STORE_KEY); location.reload(); } };
  window.F360MockReady = load();
})();
