/* Studio F360 · blog kedvelés (valódi, közös számláló)
   A szám a /kedveles végpontról jön (Cloudflare D1), mindenkinek ugyanaz, 0-ról indul.
   A látogató egy véletlen azonosítót kap (localStorage), ezzel egy bejegyzést egyszer kedvelhet,
   és vissza is vonhatja. Hozzászólás nincs. file:// alatt a gomb csendben nem csinál semmit. */
(function () {
  'use strict';

  var API = '/kedveles';
  var VOTER_KEY = 'f360Voter';
  var LIKED_KEY = 'f360Liked';
  var online = location.protocol === 'http:' || location.protocol === 'https:';

  function lsGet(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; }
    catch (e) { return def; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* privát mód */ }
  }
  function voterId() {
    var v = lsGet(VOTER_KEY, '');
    if (typeof v === 'string' && /^[a-z0-9-]{16,64}$/.test(v)) return v;
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    v = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    lsSet(VOTER_KEY, v);
    return v;
  }

  var widgets = {}; // slug -> [{btn, count}]

  function paint(slug, count, liked) {
    (widgets[slug] || []).forEach(function (w) {
      if (w.count && typeof count === 'number') w.count.textContent = String(count);
      if (w.btn) {
        w.btn.classList.toggle('is-liked', liked);
        w.btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      }
    });
  }

  function send(slug, like) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug, voter: voterId(), like: like })
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function onClick(slug, btn) {
    if (!online || btn.disabled) return;
    var liked = lsGet(LIKED_KEY, {});
    var next = !liked[slug];
    var w = (widgets[slug] || [])[0];
    var cur = w && w.count ? parseInt(w.count.textContent, 10) || 0 : 0;
    /* azonnali visszajelzés, a szerver válasza pontosít */
    paint(slug, Math.max(0, cur + (next ? 1 : -1)), next);
    btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop');
    btn.disabled = true;
    send(slug, next).then(function (d) {
      if (next) liked[slug] = 1; else delete liked[slug];
      lsSet(LIKED_KEY, liked);
      paint(slug, d.count, next);
    }).catch(function () {
      paint(slug, cur, !next); /* hiba: vissza az előző állapotra */
    }).then(function () { btn.disabled = false; });
  }

  function init() {
    var roots = document.querySelectorAll('[data-slug]');
    var liked = lsGet(LIKED_KEY, {});
    for (var i = 0; i < roots.length; i++) {
      (function (root) {
        var slug = root.getAttribute('data-slug');
        if (!slug) return;
        var btn = root.querySelector('[data-like]');
        var count = root.querySelector('[data-like-count]');
        (widgets[slug] = widgets[slug] || []).push({ btn: btn, count: count });
        if (btn) btn.addEventListener('click', function () { onClick(slug, btn); });
      })(roots[i]);
    }
    Object.keys(widgets).forEach(function (s) { paint(s, null, !!liked[s]); });

    var slugs = Object.keys(widgets);
    if (online && slugs.length) {
      fetch(API + '?s=' + encodeURIComponent(slugs.join(',')))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) {
          var c = (d && d.counts) || {};
          slugs.forEach(function (s) { if (typeof c[s] === 'number') paint(s, c[s], !!liked[s]); });
        })
        .catch(function () { /* a számláló nem elérhető: marad a 0 */ });
    }

    /* keskeny nézetben az aktív kategória-chip kerüljön látótérbe */
    var list = document.querySelector('.wall-tabs');
    var active = list && list.querySelector('.wtab.is-on');
    if (list && active && list.scrollWidth > list.clientWidth) {
      var lr = list.getBoundingClientRect();
      var ar = active.getBoundingClientRect();
      list.scrollLeft = Math.max(0,
        (ar.left - lr.left) + list.scrollLeft - (lr.width - ar.width) / 2);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
