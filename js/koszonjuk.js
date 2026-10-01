/* =====================================================================
   STUDIO F360 · IDŐPONTFOGLALÓ · koszonjuk.js  (foglalas/koszonjuk.html)
   A sikeres foglalás és a sikeres módosítás külön „Köszönjük” oldala:
   /foglalas/koszonjuk?id=<azonosító>. Ez a konverziós pont (Lilla: GA4, Meta).

   Adat: a foglaló a válaszát a munkamenet-tárba teszi (f360-foglalas-kesz,
   személyes adatból csak a nevet), az URL-ben csak az azonosító van. Ha a tárban
   van token (a lemondó linkből), a GET /foglalas-api/foglalas?t= frissíti az
   állapotot és adja a mérési adatot (szolgáltatás, ár, kampány).
   Mérés: a foglalas_kesz esemény foglalásonként EGYSZER fut (f360-meres-kuldve
   jelző a munkamenet-tárban), frissítésre és a vissza gombra nem.
   Helyi teszt: ?mock=1 vagy file:// (a js/foglalo-mock.js szolgál ki).
   ===================================================================== */
(function () {
  'use strict';

  var F = window.F360Foglalo;
  var MOCK = location.protocol === 'file:' || /[?&]mock=1(&|$)/.test(location.search);
  var DONE_KEY = 'f360-foglalas-kesz';
  var SENT_KEY = 'f360-meres-kuldve';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = F.esc;
  var q = new URLSearchParams(location.search);
  var id = q.get('id') || '';
  var ROOT = '../';
  var MQ = MOCK && location.protocol !== 'file:' ? 'mock=1' : '';

  function href(path, extra) {
    var p = [MQ, extra].filter(Boolean).join('&');
    return ROOT + path + (p ? '?' + p : '');
  }
  function keresztnev(nev) { var p = String(nev || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0]; }
  function tokenOf(u) { var t = (/[?&]t=([^&#]+)/.exec(u || '') || [])[1]; return t ? decodeURIComponent(t) : ''; }

  function olvas() {
    try { var d = JSON.parse(sessionStorage.getItem(DONE_KEY) || 'null'); return d && d.foglalas && d.azonosito === id ? d : null; } catch (e) { return null; }
  }
  function kuldottek() { try { return JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]'); } catch (e) { return []; } }
  function jelol(kulcs) {
    var l = kuldottek(); if (l.indexOf(kulcs) < 0) l.push(kulcs);
    try { sessionStorage.setItem(SENT_KEY, JSON.stringify(l.slice(-50))); } catch (e) { /* nincs tárhely */ }
  }

  /* ---------- mérés: egyszer foglalásonként (a módosítás külön esemény) ---------- */
  function meres(done, extra) {
    var esemeny = done.modositva ? 'foglalas_modositva' : 'foglalas_kesz';
    var kulcs = esemeny + ':' + done.azonosito + (done.modositva ? ':' + done.foglalas.datum + ' ' + done.foglalas.kezd : '');
    if (kuldottek().indexOf(kulcs) >= 0) return false;
    jelol(kulcs); // előbb jelöl: ha az esemény közben hibát dob, akkor sem küld kétszer
    var f = done.foglalas, m = extra || {}, forras = done.forras || {};
    var adat = {
      foglalas_id: done.azonosito,
      helyszin: m.helyszin || f.helyszin.id,
      szolgaltatas: m.szolgaltatas || f.szolgaltatas.id,
      szolgaltatas_nev: f.szolgaltatas.nev,
      kollega: f.kollega.id,
      value: m.ar != null ? m.ar : (f.szolgaltatas.ar || 0),
      currency: 'HUF'
    };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { var v = m[k] || forras[k]; if (v) adat[k] = v; });
    if (!adat.utm_source && forras.gclid) adat.forras = 'google (gclid)';
    if (!adat.utm_source && forras.fbclid) adat.forras = 'facebook (fbclid)';
    if (window.F360Meres) window.F360Meres.esemeny(esemeny, adat);
    return true;
  }

  /* ---------- megjelenítés ---------- */
  function sorok(f, done) {
    var rows = [
      ['Kezelés', f.szolgaltatas.nev, f.szolgaltatas.perc + ' perc'],
      ['Szakember', f.kollega.nev, ''],
      ['Helyszín', f.helyszin.nev, f.helyszin.cim],
      ['Foglalás száma', done.azonosito, done.modositva ? 'Nem változott, a levélben lévő link is marad' : 'Erre hivatkozz, ha telefonálsz'],
      ['Díj', f.szolgaltatas.ar != null ? F.ft(f.szolgaltatas.ar) : '', 'a helyszínen fizetendő']
    ];
    return rows.filter(function (r) { return r[1]; }).map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</dd><dd class="rev__act"></dd></div>';
    }).join('');
  }
  function mutat(done) {
    var f = done.foglalas, lemondva = f.allapot === 'lemondva';
    document.body.classList.toggle('theme-rehab', f.helyszin.id === 'reitter');
    $('#bk-done').hidden = false;
    $('#done-k').textContent = lemondva ? 'Ezt a foglalást azóta lemondták' : done.modositva ? 'Áthelyezés rögzítve' : 'Foglalás rögzítve';
    $('#h-done').textContent = done.modositva ? 'Időpontod módosítva' : 'Köszönjük a foglalásod';
    var mikor = F.datumNap(f.datum);
    $('#done-when').textContent = (done.modositva ? 'Az új időpont: ' + mikor : mikor.replace(/^./, function (c) { return c.toUpperCase(); })) + ', ' +
      F.hm(F.perc(f.kezd)) + '-' + F.hm(F.perc(f.veg)) + ', ' + f.helyszin.nev;
    $('#done-lead').textContent = lemondva ? 'Az időpont felszabadult. Ha mégis jönnél, foglalj újat.'
      : done.modositva ? 'Az új időpontról e-mailt is küldünk. A korábbi időpont felszabadult.'
      : 'Várunk, ' + keresztnev(f.nev) + '. A visszaigazolást e-mailben is elküldtük.';
    $('#done-rev').innerHTML = sorok(f, done);
    // naptár: Google = kitöltött esemény új lapon; Apple / Outlook = a backend .ics címe (inline)
    $('#done-gcal').href = F.googleNaptarUrl(f, done.lemondasUrl || '');
    var ics = $('#done-ics');
    ics.href = done.ics || '#';
    ics.onclick = function (e) {
      if (!MOCK || !window.F360FoglaloMock) return;
      e.preventDefault();
      F.icsLetolt(window.F360FoglaloMock.ics(tokenOf(done.ics)), 'studio-f360-' + done.azonosito + '.ics');
    };
    $('.cal').hidden = lemondva;
    if (done.modositva) $('#cal-t').textContent = 'Az Apple / Outlook gomb egy naptárfájlt ad. Megnyitva frissíti az időpontot a naptáradban. Ha a régi időpont mégis ott maradna, töröld.';
    // „Időpont lemondása / módosítása”: a foglaló „Foglalásod kezelése” nézete a tokennel
    var tok = tokenOf(done.lemondasUrl), cx = $('#done-cancel');
    if (tok && !lemondva) { cx.href = href('foglalas.html', 't=' + encodeURIComponent(tok)); cx.hidden = false; } else cx.hidden = true;
    $('#done-fine').hidden = lemondva;
    var tel = done.telefon || F.TELEFON;
    $('#done-tel').textContent = tel; $('#done-tel').href = 'tel:' + String(tel).replace(/[^\d+]/g, '');
    $('#done-new').href = href('foglalas.html', lemondva ? 'helyszin=' + encodeURIComponent(f.helyszin.id) : '');
    // a visszaigazoló levél előnézete (bemutató): sandboxolt iframe srcdoc, sosem innerHTML
    var mail = $('.done__mail');
    if (done.level && done.level.html && !lemondva) {
      mail.hidden = false;
      $('#mail-subj').textContent = done.level.targy || '';
      var fr = $('#mail-frame');
      fr.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      fr.srcdoc = String(done.level.html).replace(/<head>/i, '<head><base target="_blank">');
    } else mail.hidden = true;
    $('.done').classList.toggle('is-solo', mail.hidden);
    document.title = (done.modositva ? 'Időpont módosítva' : 'Köszönjük a foglalásod') + ' · Studio F360';
    $('#fo').setAttribute('data-state', 'kesz');
    setTimeout(function () { $('#h-done').focus({ preventScroll: true }); }, 60);
    $('#ty-live').textContent = $('#h-done').textContent + '. ' + $('#done-when').textContent;
  }
  function ures() {
    $('#ty-empty').hidden = false;
    $('#empty-new').href = href('foglalas.html');
    var tel = F.TELEFON;
    $('#empty-tel').textContent = 'Kérdésed van? ' + tel; $('#empty-tel').href = 'tel:' + tel.replace(/[^\d+]/g, '');
    $('#fo').setAttribute('data-state', 'kesz');
    setTimeout(function () { $('#h-empty').focus({ preventScroll: true }); }, 60);
  }

  /* ---------- indulás ---------- */
  function friss(done) {
    // a token a lemondó linkből: a backend megerősíti az állapotot és adja a mérési adatot
    var tok = tokenOf(done.lemondasUrl);
    if (!tok) return Promise.resolve(null);
    return fetch('/foglalas-api/foglalas?t=' + encodeURIComponent(tok), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function boot() {
    var done = olvas();
    if (!done) { ures(); return; }
    mutat(done);
    friss(done).then(function (r) {
      if (r && r.foglalas && r.azonosito === done.azonosito) {
        // a backend a mérvadó (pl. közben lemondták); a levél-előnézet a tárolt marad
        var uj = Object.assign({}, done, { foglalas: r.foglalas, lemondasUrl: r.lemondasUrl || done.lemondasUrl, ics: r.ics || done.ics });
        try { sessionStorage.setItem(DONE_KEY, JSON.stringify(uj)); } catch (e) { /* nincs tárhely */ }
        if (r.foglalas.allapot !== done.foglalas.allapot || r.foglalas.datum !== done.foglalas.datum || r.foglalas.kezd !== done.foglalas.kezd) mutat(uj);
        if (r.foglalas.allapot !== 'lemondva') meres(uj, r.meres);
      } else if (done.foglalas.allapot !== 'lemondva') meres(done, null);
    });
  }

  if (MOCK) {
    var sc = document.createElement('script');
    sc.src = ROOT + 'js/foglalo-mock.js';
    sc.onload = sc.onerror = boot;
    document.head.appendChild(sc);
  } else {
    boot();
  }
})();
