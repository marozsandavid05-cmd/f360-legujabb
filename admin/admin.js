/* =====================================================================
   STUDIO F360 · BLOG SZERKESZTŐ · admin.js
   Keretrendszer nélkül. A szöveg a háttérben markdown (marked: md → html,
   turndown: html → md), a mentés a /api/* végpontokra megy (Caesar backendje).
   Helyi teszt: ?mock=1 → az admin/mock-api.js szimulálja az API-t.
   ===================================================================== */
(function () {
  'use strict';

  var API = '/api';
  var MOCK = /[?&]mock=1(&|$)/.test(location.search);
  var MEDIA_PREFIX = '../';
  var MAX_SIDE = 2000;
  var QUALITY = 0.82;
  var MAX_UPLOAD = 5 * 1024 * 1024;

  var CATS = {
    mozgas: 'Mozgás & Testtudat',
    sport: 'Sport & Teljesítmény',
    taplalkozas: 'Táplálkozás & Életmód'
  };
  var MONTHS = ['január', 'február', 'március', 'április', 'május', 'június',
    'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- állapot ---------------- */
  var state = {
    posts: [],
    filter: 'all',
    current: null,      // { slug|null, sha }
    dirty: false,
    saving: false,
    cover: '',          // media/blog/... út
    lastSaveAt: 0,
    savedRange: null
  };
  var localMedia = {};  // ebben a munkamenetben feltöltött képek: út → objectURL (élesítés előtt is látszik)

  /* ---------------- segédek ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function huDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return m[1] + '. ' + MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + '.';
  }
  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function hhmm(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtBytes(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' kB';
  }
  function mediaUrl(p) {
    if (!p) return '';
    if (/^(https?:|blob:|data:)/.test(p)) return p;
    if (localMedia[p]) return localMedia[p];
    return MEDIA_PREFIX + p.replace(/^\/+/, '');
  }

  var toastTimer = null;
  function toast(text, kind, ms) {
    var t = $('#toast');
    t.textContent = text;
    t.dataset.kind = kind || 'info';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || (kind === 'error' ? 7000 : 3200));
  }

  function hideToast() { clearTimeout(toastTimer); $('#toast').hidden = true; }
  // modális ablak vagy előnézet nyitásakor a korábbi üzenet eltűnik
  var _showModal = HTMLDialogElement.prototype.showModal;
  $$('dialog').forEach(function (d) {
    d.showModal = function () { hideToast(); return _showModal.call(d); };
  });

  /* ---------------- API ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
    if (opts.json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.json);
    } else if (opts.body) {
      init.body = opts.body;
    }
    return fetch(API + path, init).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = (data && (data.error || data.message)) || '';
          if (!msg) {
            if (res.status === 401 || res.status === 403) msg = 'Lejárt a belépés. Töltsd újra az oldalt, és lépj be újra.';
            else if (res.status === 409) msg = 'Közben valaki más is módosította, töltsd újra.';
            else if (res.status === 413) msg = 'A kép túl nagy, legfeljebb 5 MB lehet.';
            else if (res.status >= 500) msg = 'A szerver most nem válaszol. Próbáld újra egy perc múlva.';
            else msg = 'Hiba történt (' + res.status + ').';
          }
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        if (data === null && txt && !opts.raw) {
          var e2 = new Error('A szerver érvénytelen választ adott.');
          e2.status = res.status;
          throw e2;
        }
        return data;
      });
    }, function () {
      throw new Error('Nincs kapcsolat a szerverrel. Ellenőrizd az internetet, és próbáld újra.');
    });
  }

  /* ---------------- markdown ↔ html ---------------- */
  var td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    codeBlockStyle: 'fenced',
    hr: '---',
    linkStyle: 'inlined'
  });
  // H1 → H2, H4-6 → H3 (a cikk címe az egyetlen H1)
  td.addRule('headings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: function (content, node) {
      var lvl = Number(node.nodeName.charAt(1));
      var hashes = lvl <= 2 ? '##' : '###';
      content = content.replace(/\n+/g, ' ').trim();
      return content ? '\n\n' + hashes + ' ' + content + '\n\n' : '';
    }
  });
  // kép: az eredeti repó-út (data-src), nem a helyi előnézeti blob
  td.addRule('image', {
    filter: 'img',
    replacement: function (content, node) {
      var src = node.getAttribute('data-src') || node.getAttribute('src') || '';
      if (!src || /^(blob:|data:|file:)/.test(src)) return '';
      var alt = (node.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim();
      return '\n\n![' + alt + '](' + src + ')\n\n';
    }
  });
  // lista: "- elem" és "1. elem" (a turndown alapból 3 szóközt tesz a jel után)
  td.addRule('listItem', {
    filter: 'li',
    replacement: function (content, node) {
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n   ');
      var parent = node.parentNode;
      var prefix = '- ';
      if (parent.nodeName === 'OL') {
        var start = parent.getAttribute('start');
        var idx = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + idx : idx + 1) + '. ';
      }
      return prefix + content.trim() + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    }
  });
  // aláhúzás, áthúzás, szín: csak a szöveg marad
  td.addRule('plainInline', {
    filter: ['u', 'span', 'font', 'mark', 'ins', 'small', 'sub', 'sup'],
    replacement: function (content) { return content; }
  });
  td.remove(['script', 'style', 'meta', 'link', 'iframe', 'object', 'video', 'audio', 'figcaption']);

  function mdToHtml(md) {
    var html = window.marked.parse(String(md || ''), { gfm: true, breaks: false });
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    sanitize(tmp);
    $$('img', tmp).forEach(function (img) {
      var src = img.getAttribute('src') || '';
      img.setAttribute('data-src', src);
      img.setAttribute('src', mediaUrl(src));
      img.setAttribute('loading', 'lazy');
      img.addEventListener('error', imgFallback);
    });
    return tmp.innerHTML;
  }
  function imgFallback() {
    this.removeEventListener('error', imgFallback);
    this.setAttribute('alt', (this.getAttribute('alt') || 'Kép') + ' (az élesítés után jelenik meg)');
  }
  function htmlToMd(root) {
    var clone = root.cloneNode(true);
    $$('.is-sel', clone).forEach(function (n) { n.classList.remove('is-sel'); });
    // üres bekezdések és felesleges sortörések ki (a szerkesztő Enterjei)
    $$('p, h2, h3, li, blockquote', clone).reverse().forEach(function (el) {
      $$(':scope > br:last-child', el).forEach(function (br) { if (el.childNodes.length > 1) br.remove(); });
      if (!el.textContent.replace(/[\s\u00a0\u200b]/g, '') && !el.querySelector('img')) el.remove();
    });
    var md = td.turndown(clone.innerHTML);
    md = md.split('\n').map(function (l) { return l.replace(/[ \t]+$/, ''); }).join('\n');
    return md.replace(/\u00a0/g, ' ').replace(/\n(>\n)+(?=[^>]|$)/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  // csak az engedett elemek és attribútumok maradnak (beillesztésnél és betöltésnél)
  var ALLOWED = { P: 1, H2: 1, H3: 1, STRONG: 1, B: 1, EM: 1, I: 1, UL: 1, OL: 1, LI: 1, A: 1, IMG: 1, BLOCKQUOTE: 1, BR: 1, HR: 1 };
  function sanitize(root) {
    $$('*', root).forEach(function (el) {
      if (!el.parentNode) return;
      var tag = el.nodeName;
      if (!ALLOWED[tag]) {
        if (/^(SCRIPT|STYLE|IFRAME|OBJECT|META|LINK|VIDEO|AUDIO)$/.test(tag)) { el.remove(); return; }
        if (/^H[1]$/.test(tag)) { rename(el, 'h2'); return; }
        if (/^H[4-6]$/.test(tag)) { rename(el, 'h3'); return; }
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.remove();
        return;
      }
      for (var i = el.attributes.length - 1; i >= 0; i--) {
        var a = el.attributes[i].name;
        var keep = (tag === 'A' && a === 'href') || (tag === 'IMG' && (a === 'src' || a === 'alt' || a === 'data-src'));
        if (!keep) el.removeAttribute(a);
      }
      if (tag === 'A' && /^\s*javascript:/i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
      if (tag === 'IMG') {
        var s = el.getAttribute('data-src') || el.getAttribute('src') || '';
        if (/^(file:|data:)/.test(s)) el.remove();
      }
    });
  }
  function rename(el, tag) {
    var n = document.createElement(tag);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.parentNode.replaceChild(n, el);
    sanitize(n);
  }

  /* ---------------- képoptimalizálás a böngészőben ---------------- */
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return decodeViaImg(file); });
    }
    return decodeViaImg(file);
  }
  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function toBlob(canvas, type, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, q); });
  }
  // EXIF-forgatás (imageOrientation: from-image), max 2000 px hosszabb oldal, WebP 0,82
  function optimizeImage(file) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      return Promise.reject(new Error('Ez nem képfájl. JPG, PNG vagy WebP képet válassz.'));
    }
    return decode(file).catch(function () {
      throw new Error('Ezt a képet a böngésző nem tudja megnyitni. Mentsd el JPG-ként, és próbáld újra.');
    }).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, cw, ch);
      if (bmp.close) bmp.close();
      return toBlob(c, 'image/webp', QUALITY).then(function (blob) {
        // régi Safari nem tud WebP-t kódolni: JPG tartalék
        if (!blob || blob.type !== 'image/webp') return toBlob(c, 'image/jpeg', 0.85);
        return blob;
      }).then(function (blob) {
        if (!blob) throw new Error('A kép átalakítása nem sikerült.');
        if (blob.size > MAX_UPLOAD) throw new Error('A kép átalakítva is ' + fmtBytes(blob.size) + ', legfeljebb 5 MB lehet.');
        var base = (file.name || 'kep').replace(/\.[^.]+$/, '');
        var ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
        return {
          blob: blob, name: base + '.' + ext,
          origSize: file.size, newSize: blob.size,
          origW: w, origH: h, w: cw, h: ch
        };
      });
    });
  }
  function sizeLine(r) {
    var pct = r.origSize ? Math.round((1 - r.newSize / r.origSize) * 100) : 0;
    return 'Eredeti: <b>' + fmtBytes(r.origSize) + '</b> (' + r.origW + '×' + r.origH + ') · Új: <b>' +
      fmtBytes(r.newSize) + '</b> (' + r.w + '×' + r.h + ')' + (pct > 0 ? ' · ' + pct + '% kisebb' : '');
  }
  function upload(r) {
    var fd = new FormData();
    fd.append('file', r.blob, r.name);
    state.uploading = (state.uploading || 0) + 1;
    return api('/upload', { method: 'POST', body: fd }).then(function (res) {
      if (!res || !res.path) throw new Error('A feltöltés nem adott vissza útvonalat.');
      localMedia[res.path] = URL.createObjectURL(r.blob);
      return res.path;
    }).then(function (p) { state.uploading--; return p; }, function (err) { state.uploading--; throw err; });
  }

  /* ---------------- élesítés-állapot ---------------- */
  var deployTimer = null;
  function normStatus(j) {
    j = j || {};
    var s = String(j.status || j.state || '').toLowerCase();
    if (/build|progress|queue|pending|active|deploy/.test(s) && !/success|fail/.test(s)) s = 'building';
    else if (/success|ok|done|live|ready/.test(s)) s = 'success';
    else if (/fail|error|cancel/.test(s)) s = 'failure';
    var t = j.time || j.created_on || j.modified_on || j.at || j.updated_at || j.date || null;
    var d = t ? new Date(t) : null;
    return { s: s, time: d && !isNaN(d) ? d : null };
  }
  function showDeploy(st) {
    var el = $('#deploy');
    if (!st.s) { el.hidden = true; return; }
    el.hidden = false;
    el.dataset.state = st.s;
    var txt = st.s === 'building' ? 'Élesítés folyamatban'
      : st.s === 'success' ? (st.time ? 'Utolsó élesítés ' + hhmm(st.time) : 'Az oldal naprakész')
      : 'Az élesítés nem sikerült';
    $('.deploy__txt', el).textContent = txt;
  }
  function checkDeploy() {
    return api('/status').then(function (j) { var st = normStatus(j); showDeploy(st); return st; })
      .catch(function () { return { s: '' }; });
  }
  function watchDeploy() {
    clearTimeout(deployTimer);
    var started = state.lastSaveAt, seenBuilding = false;
    (function tick() {
      checkDeploy().then(function (st) {
        var elapsed = Date.now() - started;
        if (st.s === 'building') seenBuilding = true;
        var fresh = st.time ? st.time.getTime() >= started - 5000 : seenBuilding;
        if (st.s === 'success' && fresh) { setSaveState('live'); return; }
        if (st.s === 'failure' && fresh) { setSaveState('failed'); return; }
        if (st.s !== 'building') showDeploy({ s: 'building' });
        if (elapsed > 8 * 60 * 1000) { setSaveState('unknown'); return; }
        deployTimer = setTimeout(tick, elapsed < 60000 ? 4000 : 10000);
      });
    })();
  }

  /* ---------------- mentés-állapot felirat ---------------- */
  function setSaveState(s) {
    var el = $('#save-state');
    var txt = {
      clean: '',
      dirty: 'Mentetlen változás',
      saving: 'Mentés folyamatban',
      building: 'Mentve, élesítés folyamatban',
      live: 'Élesben',
      failed: 'Mentve, de az élesítés nem sikerült. Szólj Davidnek.',
      unknown: 'Mentve. Pár perc múlva nézd meg az oldalon.',
      error: 'Nem sikerült menteni'
    }[s] || '';
    el.dataset.s = s;
    el.textContent = txt;
  }
  function markDirty() {
    if (!state.dirty) { state.dirty = true; }
    if (!state.saving) setSaveState('dirty');
    scheduleDraft();
  }

  /* ---------------- piszkozat a böngészőben (ha lemerül a telefon) ---------------- */
  var draftTimer = null;
  function draftKey() { return 'f360-admin-draft:' + (state.current && state.current.slug || 'uj'); }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try { localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), data: collect() })); } catch (e) { /* tele a tárhely */ }
    }, 800);
  }
  function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (e) { /* nincs tárhely */ } }
  function offerDraft() {
    var raw = null;
    try { raw = localStorage.getItem(draftKey()); } catch (e) { return; }
    if (!raw) return;
    var d; try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || !d.data) return;
    var t = $('#toast');
    t.innerHTML = '';
    t.dataset.kind = 'info';
    t.append('Van egy mentetlen piszkozatod (' + hhmm(new Date(d.at)) + '). ');
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'linkbtn'; b.textContent = 'Visszaállítom';
    b.style.color = 'inherit';
    b.addEventListener('click', function () { fill(d.data); markDirty(); t.hidden = true; });
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'linkbtn'; x.textContent = 'Elvetem';
    x.style.color = 'inherit'; x.style.marginLeft = '.75rem';
    x.addEventListener('click', function () { clearDraft(); t.hidden = true; });
    t.append(b, x);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 20000);
  }

  /* ---------------- nézetváltás ---------------- */
  function show(id) {
    $$('.view').forEach(function (v) { v.hidden = v.id !== id; });
    document.body.dataset.view = id;
    // fülsor: a blog nézetei a „Blog” fül alá tartoznak
    var tab = /^view-(foglalasok|beosztas|beallitasok|levelek)$/.exec(id);
    $$('.tabs__a').forEach(function (a) {
      var on = a.getAttribute('data-tab') === (tab ? tab[1] : 'blog');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  window.F360AdminShow = show;
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    clearTimeout(deployTimer);
    // az időpontfoglaló fülei (admin/foglalo.js)
    var fg = /^(foglalasok|beosztas|beallitasok|levelek)(\/.*)?$/.exec(h);
    if (fg && window.F360AdminFoglalo) { show('view-' + fg[1]); return window.F360AdminFoglalo.open(fg[1], fg[2] ? fg[2].slice(1) : ''); }
    if (h === 'uj') return openEditor(null);
    var m = /^szerk\/(.+)$/.exec(h);
    if (m) return openEditor(decodeURIComponent(m[1]));
    return openList();
  }
  var skipGuard = false;
  window.addEventListener('hashchange', function (e) {
    if (skipGuard) { skipGuard = false; return; }
    if (state.dirty && !confirm('Van mentetlen változás. Biztosan kilépsz a szerkesztőből?')) {
      skipGuard = true;
      history.replaceState(null, '', e.oldURL.slice(e.oldURL.indexOf('#')) || '#/');
      return;
    }
    state.dirty = false;
    route();
  });
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  function go(hash) {
    state.dirty = false;
    if (location.hash === hash) route(); else location.hash = hash;
  }

  /* ---------------- LISTA ---------------- */
  function openList() {
    show('view-list');
    document.title = 'Bejegyzések · Blog szerkesztő · Studio F360';
    var ul = $('#posts');
    if (!state.posts.length) ul.innerHTML = '<li class="row-skel"></li><li class="row-skel"></li><li class="row-skel"></li>';
    else renderList();
    return api('/posts').then(function (list) {
      state.posts = (list || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      renderList();
    }).catch(function (err) {
      ul.innerHTML = '';
      $('#posts-empty').hidden = false;
      $('#posts-empty').textContent = err.message;
    });
  }
  function renderFilters() {
    var counts = { all: state.posts.length };
    Object.keys(CATS).forEach(function (k) { counts[k] = state.posts.filter(function (p) { return p.category === k; }).length; });
    var chips = [['all', 'Mind']].concat(Object.keys(CATS).map(function (k) { return [k, CATS[k]]; }));
    $('#filters').innerHTML = chips.map(function (c) {
      return '<button type="button" class="chip" data-filter="' + c[0] + '" aria-pressed="' + (state.filter === c[0]) + '">' +
        esc(c[1]) + '<span class="n">' + counts[c[0]] + '</span></button>';
    }).join('');
  }
  function renderList() {
    renderFilters();
    var list = state.filter === 'all' ? state.posts : state.posts.filter(function (p) { return p.category === state.filter; });
    $('#list-count').textContent = state.posts.length + ' bejegyzés a blogon';
    $('#posts-empty').hidden = list.length > 0;
    $('#posts-empty').textContent = 'Még nincs bejegyzés ebben a témakörben.';
    $('#posts').innerHTML = list.map(function (p) {
      var img = p.cover
        ? '<div class="post-row__img"><img src="' + esc(mediaUrl(p.cover)) + '" alt="" loading="lazy" width="112" height="84"></div>'
        : '<div class="post-row__img post-row__img--none" aria-hidden="true">F360</div>';
      var href = '#/szerk/' + encodeURIComponent(p.slug);
      return '<li class="post-row">' + img +
        '<div class="post-row__t"><a class="post-row__title" href="' + href + '">' + esc(p.title) + '</a>' +
        '<p class="post-row__meta"><span>' + esc(huDate(p.date)) + '</span>' +
        '<span class="post-row__cat" data-cat="' + esc(p.category) + '">' + esc(CATS[p.category] || p.category) + '</span>' +
        (p.author ? '<span class="post-row__au">' + esc(p.author) + '</span>' : '') + '</p></div>' +
        '<div class="post-row__act">' +
        '<a class="iconbtn iconbtn--edit" href="' + href + '" aria-label="Szerkesztés: ' + esc(p.title) + '">' +
        '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M13.6 3.4a1.9 1.9 0 0 1 2.7 2.7l-9 9-3.6.9.9-3.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>Szerkesztés</a>' +
        '<button type="button" class="iconbtn" data-del="' + esc(p.slug) + '" aria-label="Törlés: ' + esc(p.title) + '">' +
        '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L14 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Törlés</button>' +
        '</div></li>';
    }).join('');
  }
  $('#filters').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    renderList();
  });
  $('#posts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    var p = state.posts.filter(function (x) { return x.slug === b.dataset.del; })[0];
    if (p) confirmDelete(p.slug, p.title);
  });

  /* ---------------- TÖRLÉS ---------------- */
  function confirmDelete(slug, title) {
    var dlg = $('#dlg-delete');
    $('#dlg-delete-title').textContent = '„' + title + '”';
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', function onClose() {
      dlg.removeEventListener('close', onClose);
      if (dlg.returnValue !== 'ok') return;
      api('/posts/' + encodeURIComponent(slug), { method: 'DELETE' }).then(function () {
        state.posts = state.posts.filter(function (p) { return p.slug !== slug; });
        try { localStorage.removeItem('f360-admin-draft:' + slug); } catch (e) { /* */ }
        state.lastSaveAt = Date.now();
        toast('Törölve. Pár perc múlva az oldalról is eltűnik.');
        state.dirty = false;
        if (document.body.dataset.view === 'view-edit') go('#/');
        else renderList();
        watchDeployBar();
      }).catch(function (err) { toast(err.message, 'error'); });
    });
  }
  // lista nézetben csak a felső jelzőt frissítjük
  function watchDeployBar() {
    var started = Date.now(), seen = false;
    (function tick() {
      checkDeploy().then(function (st) {
        if (st.s === 'building') seen = true;
        var fresh = st.time ? st.time.getTime() >= started - 5000 : seen;
        if ((st.s === 'success' || st.s === 'failure') && fresh) return;
        if (st.s !== 'building') showDeploy({ s: 'building' });
        if (Date.now() - started > 8 * 60 * 1000) return;
        setTimeout(tick, 5000);
      });
    })();
  }

  /* ---------------- SZERKESZTŐ ---------------- */
  var rte = $('#rte-body');
  var fTitle = $('#f-title');

  function openEditor(slug) {
    show('view-edit');
    measureTop();
    state.current = { slug: slug, sha: null };
    state.dirty = false;
    $('#edit-h').textContent = slug ? 'Bejegyzés szerkesztése' : 'Új bejegyzés';
    document.title = (slug ? 'Szerkesztés' : 'Új bejegyzés') + ' · Blog szerkesztő · Studio F360';
    $('#danger').hidden = !slug;
    setSaveState('clean');
    fillAuthors();
    if (!slug) {
      fill({ title: '', date: today(), category: 'mozgas', author: 'Studio F360', excerpt: '', cover: '', body: '' });
      offerDraft();
      setTimeout(function () { fTitle.focus(); }, 30);
      return Promise.resolve();
    }
    fill({ title: 'Betöltés', date: '', category: 'mozgas', author: '', excerpt: '', cover: '', body: '' });
    setBusy(true);
    return api('/posts/' + encodeURIComponent(slug)).then(function (p) {
      state.current.sha = p.sha || null;
      fill(p);
      setBusy(false);
      offerDraft();
    }).catch(function (err) {
      setBusy(false);
      show('view-msg');
      $('#msg').innerHTML = esc(err.message) + '<br><br><a class="btn btn--ghost" href="#/">Vissza a listához</a>';
    });
  }
  function setBusy(b) {
    fTitle.disabled = b;
    rte.setAttribute('contenteditable', b ? 'false' : 'true');
  }
  function fillAuthors() {
    var set = {};
    state.posts.forEach(function (p) { if (p.author) set[p.author] = 1; });
    set['Studio F360'] = 1;
    $('#authors').innerHTML = Object.keys(set).map(function (a) { return '<option value="' + esc(a) + '">'; }).join('');
  }
  function fill(p) {
    fTitle.value = p.title || '';
    autoGrow();
    $('#f-date').value = (p.date || '').slice(0, 10);
    $('#f-cat').value = CATS[p.category] ? p.category : 'mozgas';
    $('#f-author').value = p.author || '';
    $('#f-excerpt').value = p.excerpt || '';
    $('#excerpt-n').textContent = ($('#f-excerpt').value || '').length;
    setCover(p.cover || '');
    $('#cover-info').textContent = '';
    rte.innerHTML = p.body ? mdToHtml(p.body) : '<p><br></p>';
    updateEmpty();
    updateFoot();
    clearErrors();
  }
  function collect() {
    return {
      title: fTitle.value.replace(/\s+/g, ' ').trim(),
      date: $('#f-date').value,
      category: $('#f-cat').value,
      author: $('#f-author').value.trim(),
      excerpt: $('#f-excerpt').value.replace(/\s+/g, ' ').trim(),
      cover: state.cover,
      body: htmlToMd(rte)
    };
  }

  function autoGrow() {
    fTitle.style.height = 'auto';
    fTitle.style.height = fTitle.scrollHeight + 'px';
  }
  fTitle.addEventListener('input', function () { autoGrow(); markDirty(); clearErrors(); });
  fTitle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); placeCaretStart(rte); }
  });
  ['#f-date', '#f-cat', '#f-author', '#f-excerpt'].forEach(function (s) {
    $(s).addEventListener('input', markDirty);
    $(s).addEventListener('change', markDirty);
  });
  $('#f-excerpt').addEventListener('input', function () { $('#excerpt-n').textContent = this.value.length; });

  function clearErrors() {
    $('#err-title').hidden = true;
    fTitle.removeAttribute('aria-invalid');
  }

  function measureTop() {
    var t = $('.edit-top');
    if (t && t.offsetHeight) document.documentElement.style.setProperty('--toph', t.offsetHeight + 'px');
    fitSide();
  }
  window.addEventListener('resize', measureTop);

  // az oldalsáv csak akkor ragad, ha teljes magasságában kifér a felső sávok alatt
  function fitSide() {
    var side = $('.edit__side');
    if (!side || !side.offsetHeight) return;
    var cs = getComputedStyle(document.documentElement);
    var top = (parseFloat(cs.getPropertyValue('--barh')) || 64) + (parseFloat(cs.getPropertyValue('--toph')) || 68) + 16;
    side.classList.toggle('is-stick', side.offsetHeight + top + 16 <= window.innerHeight);
  }
  if (window.ResizeObserver) new ResizeObserver(fitSide).observe($('.edit__side'));

  /* ---- borítókép ---- */
  function setCover(path) {
    state.cover = path || '';
    var box = $('#cover-img');
    box.innerHTML = path
      ? '<img src="' + esc(mediaUrl(path)) + '" alt="A borítókép előnézete">'
      : '<span class="cover__none">Nincs borítókép</span>';
    var img = $('img', box);
    if (img) img.addEventListener('error', function () {
      box.innerHTML = '<span class="cover__none">A kép az élesítés után jelenik meg</span>';
    });
    $('#cover-remove').hidden = !path;
    $('#cover-btn-t').textContent = path ? 'Másik kép' : 'Kép kiválasztása';
    if (!path) $('#cover-info').textContent = '';
  }
  $('#f-cover').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var box = $('#cover-img'), info = $('#cover-info');
    box.classList.add('is-busy');
    info.textContent = 'Kép optimalizálása';
    optimizeImage(file).then(function (r) {
      info.innerHTML = sizeLine(r) + '<br>Feltöltés';
      return upload(r).then(function (path) {
        setCover(path);
        info.innerHTML = sizeLine(r);
        markDirty();
      });
    }).catch(function (err) {
      info.textContent = '';
      toast(err.message, 'error');
    }).then(function () { box.classList.remove('is-busy'); });
  });
  $('#cover-remove').addEventListener('click', function () { setCover(''); markDirty(); });

  /* ---- szövegszerkesztő ---- */
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* régi böngésző */ }

  function inEditor(node) { return node && (node === rte || rte.contains(node)); }
  function saveRange() {
    var sel = getSelection();
    if (sel.rangeCount && inEditor(sel.anchorNode)) state.savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    rte.focus({ preventScroll: true });
    var sel = getSelection();
    if (state.savedRange && inEditor(state.savedRange.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(state.savedRange);
    } else {
      placeCaretEnd(rte);
    }
  }
  function placeCaretEnd(el) {
    el.focus({ preventScroll: true });
    var r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function placeCaretStart(el) {
    el.focus();
    var r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function blockOf(node) {
    while (node && node !== rte) {
      if (node.nodeType === 1 && /^(P|H2|H3|LI|BLOCKQUOTE|DIV)$/.test(node.nodeName)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function topBlock(node) {
    while (node && node.parentNode && node.parentNode !== rte) node = node.parentNode;
    return node && node.parentNode === rte ? node : null;
  }
  function closestIn(node, sel) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    el = el && el.closest(sel);
    return el && rte.contains(el) ? el : null;
  }
  function updateEmpty() {
    var txt = rte.textContent.replace(/\u200b/g, '').trim();
    rte.classList.toggle('is-empty', !txt && !rte.querySelector('img'));
  }
  function updateFoot() {
    var words = (rte.innerText || '').trim().split(/\s+/).filter(Boolean).length;
    var mins = Math.max(1, Math.round(words / 200));
    var imgs = rte.querySelectorAll('img').length;
    $('#rte-foot').textContent = words + ' szó · kb. ' + mins + ' perc olvasás' + (imgs ? ' · ' + imgs + ' kép a szövegben' : '');
  }
  function updateToolbar() {
    var sel = getSelection();
    var node = sel.rangeCount ? sel.anchorNode : null;
    var active = inEditor(node);
    var st = {
      h2: active && !!closestIn(node, 'h2'),
      h3: active && !!closestIn(node, 'h3'),
      bold: active && safeState('bold'),
      italic: active && safeState('italic'),
      ul: active && !!closestIn(node, 'ul'),
      ol: active && !!closestIn(node, 'ol'),
      quote: active && !!closestIn(node, 'blockquote'),
      link: active && !!closestIn(node, 'a')
    };
    $$('.tb [data-cmd]').forEach(function (b) {
      if (b.dataset.cmd in st) b.setAttribute('aria-pressed', st[b.dataset.cmd] ? 'true' : 'false');
    });
  }
  function safeState(c) { try { return document.queryCommandState(c); } catch (e) { return false; } }

  document.addEventListener('selectionchange', function () {
    if (document.body.dataset.view !== 'view-edit') return;
    saveRange();
    updateToolbar();
  });
  rte.addEventListener('input', function () {
    // a böngésző néha div-et vagy üres gyökeret hagy: mindig legyen bekezdés
    if (!rte.firstElementChild) rte.innerHTML = '<p><br></p>';
    $$(':scope > div', rte).forEach(function (d) { rename(d, 'p'); });
    updateEmpty(); updateFoot(); markDirty();
  });
  rte.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    // Enter egy üres idézet-sorban vagy címsor után: kilépés normál bekezdésbe (mint a Wordben)
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      var sel0 = getSelection();
      var bq = closestIn(sel0.anchorNode, 'blockquote');
      if (bq) {
        var blk = blockOf(sel0.anchorNode);
        var line = blk && blk !== bq ? blk : null;
        var empty = line ? !line.textContent.replace(/[\s\u00a0\u200b]/g, '') : !bq.textContent.trim();
        if (empty) {
          e.preventDefault();
          if (line) line.remove();
          var np = document.createElement('p');
          np.appendChild(document.createElement('br'));
          bq.after(np);
          if (!bq.textContent.trim() && !bq.querySelector('img')) bq.remove();
          placeCaretStart(np);
          rte.dispatchEvent(new Event('input'));
          return;
        }
      }
    }
    if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); cmd('link'); }
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); cmd('bold'); }
    if (mod && !e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); cmd('italic'); }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
    // kiválasztott kép törlése
    var selImg = rte.querySelector('img.is-sel');
    if (selImg && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      var p = selImg.parentNode;
      selImg.remove();
      if (p && p !== rte && !p.textContent.trim() && !p.querySelector('img')) p.remove();
      if (!rte.firstElementChild) rte.innerHTML = '<p><br></p>';
      updateEmpty(); updateFoot(); markDirty();
    }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && document.body.dataset.view === 'view-edit') {
      e.preventDefault(); save();
    }
  });
  rte.addEventListener('click', function (e) {
    $$('img.is-sel', rte).forEach(function (i) { i.classList.remove('is-sel'); });
    if (e.target.nodeName === 'IMG') e.target.classList.add('is-sel');
    var a = e.target.closest('a');
    if (a && rte.contains(a)) e.preventDefault();
  });
  // beillesztés Wordből, weboldalról: csak a tiszta szerkezet marad
  rte.addEventListener('paste', function (e) {
    var cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    var html = cd.getData('text/html');
    var clean;
    if (html) {
      var md = td.turndown(html.replace(/<!--[\s\S]*?-->/g, ''));
      clean = mdToHtml(md);
    } else {
      var text = cd.getData('text/plain') || '';
      clean = text.split(/\r?\n\s*\r?\n/).map(function (para) {
        return '<p>' + esc(para).replace(/\r?\n/g, '<br>') + '</p>';
      }).join('');
    }
    document.execCommand('insertHTML', false, clean);
  });
  rte.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      toast('Képet a Kép gombbal tudsz beszúrni, így optimalizálva kerül fel.');
    }
  });

  // gomb lenyomásakor ne vesszen el a kijelölés
  $('.tb').addEventListener('mousedown', function (e) { if (e.target.closest('.tb__b')) e.preventDefault(); });
  $('.tb').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cmd]');
    if (b) cmd(b.dataset.cmd);
  });

  function toggleBlock(tag) {
    restoreRange();
    var sel = getSelection();
    var cur = closestIn(sel.anchorNode, tag);
    document.execCommand('formatBlock', false, cur ? 'p' : tag);
  }
  function cmd(c) {
    if (rte.getAttribute('contenteditable') !== 'true') return;
    switch (c) {
      case 'h2': toggleBlock('h2'); break;
      case 'h3': toggleBlock('h3'); break;
      case 'bold': restoreRange(); document.execCommand('bold'); break;
      case 'italic': restoreRange(); document.execCommand('italic'); break;
      case 'ul': restoreRange(); ensureParagraph(); document.execCommand('insertUnorderedList'); break;
      case 'ol': restoreRange(); ensureParagraph(); document.execCommand('insertOrderedList'); break;
      case 'quote': toggleQuote(); break;
      case 'hr': insertRule(); break;
      case 'link': openLink(); return;
      case 'image': openImage(); return;
      case 'undo': rte.focus(); document.execCommand('undo'); break;
      case 'redo': rte.focus(); document.execCommand('redo'); break;
    }
    rte.dispatchEvent(new Event('input'));
    updateToolbar();
  }
  // címsorból listát kérve előbb bekezdés legyen (különben a címsor kerülne a listába)
  function ensureParagraph() {
    var sel = getSelection();
    if (closestIn(sel.anchorNode, 'h2,h3')) document.execCommand('formatBlock', false, 'p');
  }
  // elválasztó vonal: saját sorba az aktuális blokk után, utána üres bekezdés a folytatáshoz
  function insertRule() {
    restoreRange();
    var top = topBlock(getSelection().anchorNode);
    var hr = document.createElement('hr');
    var after = document.createElement('p');
    after.appendChild(document.createElement('br'));
    if (top && top.nodeName === 'P' && !top.textContent.trim() && !top.querySelector('img')) {
      rte.replaceChild(after, top);
      rte.insertBefore(hr, after);
    } else if (top) {
      top.after(hr, after);
    } else {
      rte.append(hr, after);
    }
    placeCaretStart(after);
  }
  function toggleQuote() {
    restoreRange();
    var sel = getSelection();
    var bq = closestIn(sel.anchorNode, 'blockquote');
    if (bq) {
      // kibontás: a benne lévő bekezdések visszakerülnek a szövegbe
      var first = bq.firstChild;
      if (!bq.querySelector('p,h2,h3,ul,ol')) {
        var p = document.createElement('p');
        while (bq.firstChild) p.appendChild(bq.firstChild);
        bq.appendChild(p);
        first = p;
      }
      while (bq.firstChild) bq.parentNode.insertBefore(bq.firstChild, bq);
      bq.remove();
      if (first && first.nodeType === 1) placeCaretEnd(first);
    } else {
      ensureParagraph();
      document.execCommand('formatBlock', false, 'blockquote');
      // a Chrome néha közvetlen szöveget tesz a blockquote-ba: bekezdésbe csomagoljuk
      var nb = closestIn(getSelection().anchorNode, 'blockquote');
      if (nb && !nb.querySelector('p')) {
        var np = document.createElement('p');
        while (nb.firstChild) np.appendChild(nb.firstChild);
        nb.appendChild(np);
        placeCaretEnd(np);
      }
    }
  }

  /* ---- link ---- */
  function openLink() {
    restoreRange();
    var sel = getSelection();
    var range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    var a = closestIn(sel.anchorNode, 'a');
    var dlg = $('#dlg-link');
    $('#l-text').value = a ? a.textContent : (sel.toString() || '');
    $('#l-url').value = a ? a.getAttribute('href') : '';
    $('#l-err').hidden = true;
    $('#l-remove').hidden = !a;
    $('#l-ok').textContent = a ? 'Mentés' : 'Beszúrás';
    dlg.returnValue = '';
    dlg.showModal();
    setTimeout(function () { ($('#l-text').value ? $('#l-url') : $('#l-text')).focus(); }, 20);

    function onOk(e) {
      e.preventDefault();
      var url = $('#l-url').value.trim();
      if (!url) { $('#l-err').hidden = false; $('#l-url').focus(); return; }
      if (!/^(https?:|mailto:|tel:|#|\/)/i.test(url)) url = (/@/.test(url) && !/\//.test(url) ? 'mailto:' : 'https://') + url;
      var text = $('#l-text').value.trim() || url.replace(/^(https?:\/\/|mailto:)/, '');
      cleanup(); dlg.close('ok');
      rte.focus({ preventScroll: true });
      if (a) {
        a.setAttribute('href', url);
        a.textContent = text;
      } else {
        if (range) { var s = getSelection(); s.removeAllRanges(); s.addRange(range); }
        document.execCommand('insertHTML', false, '<a href="' + esc(url) + '">' + esc(text) + '</a>');
      }
      rte.dispatchEvent(new Event('input'));
    }
    function onRemove() {
      cleanup(); dlg.close('remove');
      if (a) {
        var t = document.createTextNode(a.textContent);
        a.parentNode.replaceChild(t, a);
        rte.dispatchEvent(new Event('input'));
      }
    }
    function cleanup() {
      $('#l-ok').removeEventListener('click', onOk);
      $('#l-remove').removeEventListener('click', onRemove);
      dlg.removeEventListener('close', cleanup);
    }
    $('#l-ok').addEventListener('click', onOk);
    $('#l-remove').addEventListener('click', onRemove);
    dlg.addEventListener('close', cleanup);
  }

  /* ---- kép a szövegbe ---- */
  var pending = null;
  function openImage() {
    restoreRange();
    var sel = getSelection();
    var range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    var dlg = $('#dlg-image');
    pending = null;
    $('#imgpick-prev').innerHTML = '<span>Még nincs kiválasztva kép</span>';
    $('#imgpick-info').textContent = '';
    $('#i-alt').value = '';
    $('#i-ok').disabled = true;
    $('#i-ok').textContent = 'Beszúrás';
    dlg.returnValue = '';
    dlg.showModal();

    function onOk(e) {
      e.preventDefault();
      if (!pending) return;
      var btn = $('#i-ok');
      btn.disabled = true; btn.classList.add('is-busy'); btn.textContent = 'Feltöltés';
      upload(pending).then(function (path) {
        cleanup(); dlg.close('ok');
        var alt = $('#i-alt').value.trim();
        rte.focus({ preventScroll: true });
        if (range && inEditor(range.startContainer)) { var s = getSelection(); s.removeAllRanges(); s.addRange(range); }
        else placeCaretEnd(rte);
        // a kép saját bekezdésbe kerül az aktuális blokk után, utána üres sor a folytatáshoz
        var imgP = document.createElement('p');
        var img = document.createElement('img');
        img.src = mediaUrl(path);
        img.setAttribute('data-src', path);
        img.alt = alt;
        imgP.appendChild(img);
        var after = document.createElement('p');
        after.appendChild(document.createElement('br'));
        var top = topBlock(getSelection().anchorNode);
        if (top && top.nodeName === 'P' && !top.textContent.trim() && !top.querySelector('img')) {
          rte.replaceChild(after, top);
          rte.insertBefore(imgP, after);
        } else if (top) {
          top.after(imgP, after);
        } else {
          rte.append(imgP, after);
        }
        placeCaretStart(after);
        rte.dispatchEvent(new Event('input'));
        toast('A kép bekerült a szövegbe.');
      }).catch(function (err) {
        toast(err.message, 'error');
      }).then(function () { btn.classList.remove('is-busy'); btn.textContent = 'Beszúrás'; btn.disabled = !pending; });
    }
    function cleanup() {
      $('#i-ok').removeEventListener('click', onOk);
      dlg.removeEventListener('close', cleanup);
    }
    $('#i-ok').addEventListener('click', onOk);
    dlg.addEventListener('close', cleanup);
  }
  $('#i-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    var prev = $('#imgpick-prev'), info = $('#imgpick-info');
    prev.classList.add('is-busy');
    info.textContent = 'Kép optimalizálása';
    $('#i-ok').disabled = true;
    optimizeImage(file).then(function (r) {
      pending = r;
      prev.innerHTML = '<img src="' + URL.createObjectURL(r.blob) + '" alt="">';
      info.innerHTML = sizeLine(r);
      $('#i-ok').disabled = false;
      $('#i-alt').focus();
    }).catch(function (err) {
      pending = null;
      info.textContent = '';
      toast(err.message, 'error');
    }).then(function () { prev.classList.remove('is-busy'); });
  });

  /* ---------------- MENTÉS ---------------- */
  $('#post-form').addEventListener('submit', function (e) { e.preventDefault(); save(); });

  function validate(d) {
    if (!d.title) {
      $('#err-title').hidden = false;
      fTitle.setAttribute('aria-invalid', 'true');
      fTitle.focus();
      toast('Adj címet a bejegyzésnek.', 'error');
      return false;
    }
    if (!d.date) { $('#f-date').focus(); toast('Add meg a dátumot.', 'error'); return false; }
    if (!d.body.trim()) { placeCaretEnd(rte); toast('A bejegyzés szövege még üres.', 'error'); return false; }
    return true;
  }
  function setSaveButtons(busy) {
    $$('[data-action="save"]').forEach(function (b) {
      b.classList.toggle('is-busy', busy);
      b.setAttribute('aria-busy', busy ? 'true' : 'false');
    });
  }
  function save() {
    if (state.saving || document.body.dataset.view !== 'view-edit') return;
    if (state.uploading > 0 || $('#cover-img').classList.contains('is-busy')) {
      toast('Egy pillanat, még töltődik fel a kép. Utána mentsd újra.');
      return;
    }
    var d = collect();
    if (!validate(d)) return;
    state.saving = true;
    setSaveButtons(true);
    setSaveState('saving');
    var slug = state.current.slug;
    var req = slug
      ? api('/posts/' + encodeURIComponent(slug), { method: 'PUT', json: Object.assign({ sha: state.current.sha }, d) })
      : api('/posts', { method: 'POST', json: d });
    req.then(function (res) {
      var newSlug = (res && res.slug) || slug;
      clearDraft();
      state.dirty = false;
      state.lastSaveAt = Date.now();
      if (!slug) {
        state.current.slug = newSlug;
        $('#edit-h').textContent = 'Bejegyzés szerkesztése';
        $('#danger').hidden = false;
        skipGuard = true;
        location.hash = '#/szerk/' + encodeURIComponent(newSlug);
      }
      setSaveState('building');
      toast('Mentve. Pár perc múlva élesben is látszik.');
      // új sha a következő mentéshez (optimista zár)
      api('/posts/' + encodeURIComponent(newSlug)).then(function (p) { state.current.sha = p.sha || null; }).catch(function () {});
      // a listában azonnal frissüljön
      var row = { slug: newSlug, title: d.title, date: d.date, category: d.category, cover: d.cover, excerpt: d.excerpt, author: d.author };
      state.posts = state.posts.filter(function (p) { return p.slug !== newSlug; }).concat([row])
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      watchDeploy();
    }).catch(function (err) {
      setSaveState('error');
      toast(err.message, 'error', 9000);
      if (err.status === 409) state.dirty = true;
      else state.dirty = true;
    }).then(function () {
      state.saving = false;
      setSaveButtons(false);
    });
  }

  document.body.addEventListener('click', function (e) {
    var a = e.target.closest('[data-action]');
    if (!a) return;
    var act = a.dataset.action;
    if (act === 'preview') openPreview();
    else if (act === 'preview-close') closePreview();
    else if (act === 'delete-current' && state.current && state.current.slug) {
      confirmDelete(state.current.slug, fTitle.value.trim() || 'Névtelen bejegyzés');
    }
  });

  /* ---------------- ELŐNÉZET (a cikk-oldal kinézetében) ---------------- */
  function openPreview() {
    var d = collect();
    var body = $('#pv-frame');
    var cat = CATS[d.category] || '';
    var meta = [huDate(d.date), d.author].filter(Boolean).join(' · ');
    var bodyHtml = window.marked.parse(d.body || '');
    var tmp = document.createElement('div');
    tmp.innerHTML = bodyHtml;
    sanitize(tmp);
    $$('img', tmp).forEach(function (img) { img.setAttribute('src', mediaUrl(img.getAttribute('src'))); });
    var cover = d.cover
      ? '<figure class="post__cover"><img src="' + esc(mediaUrl(d.cover)) + '" alt="" width="1600" height="1000"></figure>' : '';
    var base = new URL('.', location.href).href;
    var doc = '<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<base href="' + esc(base) + '">' +
      '<link rel="stylesheet" href="../fonts-brand/fonts-brand.css">' +
      '<link rel="stylesheet" href="../css/main.css">' +
      '<link rel="stylesheet" href="../css/pages.css">' +
      '<link rel="stylesheet" href="../css/blog.css">' +
      '<style>body{padding-top:0}.post-open{padding-top:clamp(2.5rem,7vh,5rem)}a{pointer-events:none}</style>' +
      '</head><body class="p-blog-post"><main>' +
      '<header class="post-open is-in"><div class="post-open__t">' +
      '<p class="tag">Nº 13 · Blog · <span class="tag-link">' + esc(cat) + '</span> · ' + esc(meta) + '</p>' +
      '<h1><span class="line-mask"><span>' + esc(d.title || 'Cím nélkül') + '</span></span></h1></div>' +
      (d.excerpt ? '<p class="lead">' + esc(d.excerpt) + '</p>' : '') +
      '</header><article class="post">' + cover + '<div class="post__body">' + tmp.innerHTML + '</div></article>' +
      '</main></body></html>';
    body.srcdoc = doc;
    var pv = $('#pv');
    hideToast();
    pv.hidden = false;
    document.body.style.overflow = 'hidden';
    $('[data-action="preview-close"]', pv).focus();
  }
  function closePreview() {
    $('#pv').hidden = true;
    document.body.style.overflow = '';
    $('#pv-frame').srcdoc = '';
  }
  $('.pv__sizes').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pv]');
    if (!b) return;
    $$('.pv__sz').forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on); });
    $('#pv').classList.toggle('is-phone', b.dataset.pv === 'phone');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#pv').hidden) closePreview();
  });

  /* ---------------- gépelés közben mobilon eltűnik az alsó sáv ---------------- */
  document.addEventListener('focusin', function (e) {
    if (e.target.matches && e.target.matches('#rte-body, input, textarea, select')) document.body.classList.add('is-typing');
  });
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      var a = document.activeElement;
      if (!(a && a.matches && a.matches('#rte-body, input, textarea, select'))) document.body.classList.remove('is-typing');
    }, 60);
  });

  /* ---------------- indulás ---------------- */
  function boot() {
    api('/me').then(function (me) {
      if (me && me.email) $('#user').textContent = me.email;
    }).catch(function () { /* a lista hibája mutatja */ });
    checkDeploy();
    if (!location.hash) history.replaceState(null, '', '#/foglalasok');
    route();
  }
  if (MOCK) {
    var s = document.createElement('script');
    s.src = 'mock-api.js';
    // a blog-mock után a foglaló mock-ja is (az /api/foglalo/* kéréseket ez szolgálja ki)
    s.onload = function () {
      var s2 = document.createElement('script');
      s2.src = '../js/foglalo-mock.js';
      s2.onload = s2.onerror = function () { (window.F360MockReady || Promise.resolve()).then(boot); };
      document.head.appendChild(s2);
    };
    s.onerror = function () { toast('A teszt-API nem töltődött be.', 'error'); boot(); };
    document.head.appendChild(s);
  } else {
    boot();
  }
})();
