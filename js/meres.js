/* =====================================================================
   STUDIO F360 · MÉRÉS · meres.js  (minden oldalon fut, a tools/shell.mjs írja be)
   1) Forrás: a látogató ELSŐ érkezésekor (a böngészőlap munkamenetében) elmenti,
      honnan jött: utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, fbclid, landing (az érkezési oldal, csak a kampány-paraméterekkel),
      referrer (csak külső oldal). A foglaló ezt küldi a foglalással (forras mező).
      Ha az első érkezés kampány nélküli volt, és a munkamenetben később egy
      kampány-linkről jön vissza, a kampányos érkezés lép a helyére.
   2) GA4: EGY konfigurációs pont (GA_MERES_ID). A gtag CSAK akkor töltődik be, ha
      van ID ÉS a látogató hozzájárult (window.F360Hozzajarulas === true vagy
      { analitika: true }). Sütibanner még nincs; ha lesz, a hozzájárulás után
      F360Meres.hozzajarul() hívásával tölti be.
   3) Esemény: F360Meres.esemeny(nev, adatok) minden esetben kivált egy
      'f360:meres' DOM-eseményt (más mérőkód, pl. Meta pixel, erre köthető), és ha
      a gtag be van töltve, elküldi a GA4-nek is. Személyes adatot soha nem küld.
   Keretrendszer nélkül, gsap-független. A token (?t=) soha nem kerül a forrásba.
   ===================================================================== */
(function (g) {
  'use strict';

  /* ---------- KONFIGURÁCIÓ: GA4 mérési azonosító (pl. 'G-XXXXXXXXXX'), most üres ---------- */
  var GA_MERES_ID = '';

  var KULCS = 'f360-forras';
  var KAMPANY = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
  var MAX = { utm_source: 200, utm_medium: 200, utm_campaign: 200, utm_content: 200, utm_term: 200, gclid: 300, fbclid: 300, landing: 500, referrer: 500 };

  function tisztit(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
  }
  function olvas() {
    try { var r = JSON.parse(sessionStorage.getItem(KULCS) || 'null'); return r && typeof r === 'object' ? r : null; } catch (e) { return null; }
  }
  function kampanyos(f) { return !!f && KAMPANY.some(function (k) { return !!f[k]; }); }

  /* ---------- forrás rögzítése az érkezéskor ---------- */
  function rogzit() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:' && location.protocol !== 'file:') return;
    var q = new URLSearchParams(location.search), uj = {};
    KAMPANY.forEach(function (k) { var v = tisztit(q.get(k), MAX[k]); if (v) uj[k] = v; });
    // landing: az oldal útja, a lekérdezésből csak a kampány-paraméterek (a ?t= token és a többi soha)
    var lq = new URLSearchParams();
    KAMPANY.forEach(function (k) { if (uj[k]) lq.set(k, uj[k]); });
    if (location.protocol !== 'file:') {
      var ls = lq.toString();
      uj.landing = tisztit(location.origin + location.pathname + (ls ? '?' + ls : ''), MAX.landing);
    }
    // referrer: csak külső http(s) oldal (a saját oldalon belüli lapozás nem forrás)
    var ref = document.referrer || '';
    if (/^https?:\/\//i.test(ref)) {
      try { if (new URL(ref).host !== location.host) uj.referrer = tisztit(ref, MAX.referrer); } catch (e) { /* hibás cím */ }
    }
    var regi = olvas();
    if (regi && !(kampanyos(uj) && !kampanyos(regi))) return; // az első érkezés marad
    try { sessionStorage.setItem(KULCS, JSON.stringify(uj)); } catch (e) { /* nincs tárhely */ }
  }

  /** A foglalónak küldendő forrás (vagy null, ha nincs mit küldeni). */
  function forras() {
    var f = olvas();
    if (!f) return null;
    var ki = {};
    Object.keys(MAX).forEach(function (k) { if (typeof f[k] === 'string' && f[k]) ki[k] = f[k].slice(0, MAX[k]); });
    return Object.keys(ki).length ? ki : null;
  }

  /* ---------- GA4: csak ID + hozzájárulás mellett ---------- */
  function hozzajarult() {
    var h = g.F360Hozzajarulas;
    return h === true || !!(h && typeof h === 'object' && h.analitika === true);
  }
  var betoltve = false;
  function gaBetolt() {
    if (betoltve || !GA_MERES_ID || !hozzajarult()) return false;
    betoltve = true;
    g.dataLayer = g.dataLayer || [];
    g.gtag = g.gtag || function () { g.dataLayer.push(arguments); };
    g.gtag('js', new Date());
    g.gtag('config', GA_MERES_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MERES_ID);
    document.head.appendChild(s);
    return true;
  }

  /** Esemény: DOM-esemény mindig, GA4 csak betöltött gtag mellett. Visszaadja, ment-e a GA4-nek. */
  function esemeny(nev, adatok) {
    var d = adatok || {};
    try { document.dispatchEvent(new CustomEvent('f360:meres', { detail: { nev: nev, adatok: d } })); } catch (e) { /* régi böngésző */ }
    if (betoltve && typeof g.gtag === 'function') {
      try { g.gtag('event', nev, d); return true; } catch (e) { /* a mérés nem akadályozhat semmit */ }
    }
    return false;
  }

  rogzit();
  gaBetolt();

  g.F360Meres = {
    GA_MERES_ID: GA_MERES_ID,
    forras: forras,
    esemeny: esemeny,
    gaAktiv: function () { return betoltve; },
    // a jövőbeli sütibanner ezt hívja, ha a látogató elfogadta az analitikai sütiket
    hozzajarul: function () { g.F360Hozzajarulas = { analitika: true }; return gaBetolt(); }
  };
})(window);
