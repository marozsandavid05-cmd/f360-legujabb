/* =====================================================================
   STUDIO F360 · ADMIN · foglalo.js  (az időpontfoglaló négy füle)
   Foglalások (nap- és hétnézet, szűrők, kézi felvétel, lemondás), Beosztás
   (heti minta kollégánként + szabadság és zárva tartás), Beállítások
   (kezelések, szakemberek, helyszínek, szabályok), Levelek (outbox-előnézet).
   API: /api/foglalo/* (Caesar, functions/api/foglalo/[[utvonal]].js) és a
   szabad időpontokhoz a nyilvános /foglalas-api/szabad.
   Az admin.js route()-ja hívja: F360AdminFoglalo.open(fül, alút).
   Helyi teszt: /admin/?mock=1 (a js/foglalo-mock.js szolgálja ki).
   ===================================================================== */
(function () {
  'use strict';

  var F = window.F360Foglalo;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = F.esc;
  var NAP_HOSSZU = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];
  var narrow = matchMedia('(max-width: 760px)');

  /* ---------------- API ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
    if (opts.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    var base = opts.publikus ? '/foglalas-api' : '/api/foglalo';
    return fetch(base + path, init).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = (data && data.error) || '';
          if (!msg) {
            if (res.status === 401 || res.status === 403) msg = 'Lejárt a belépés. Töltsd újra az oldalt, és lépj be újra.';
            else if (res.status === 503) msg = 'Az időpontfoglaló adatbázisa még nincs bekapcsolva.';
            else if (res.status >= 500) msg = 'A szerver most nem válaszol. Próbáld újra egy perc múlva.';
            else msg = 'Hiba történt (' + res.status + ').';
          }
          var err = new Error(msg); err.status = res.status; err.data = data; throw err;
        }
        return data;
      });
    }, function () { throw new Error('Nincs kapcsolat a szerverrel. Ellenőrizd az internetet, és próbáld újra.'); });
  }

  var toastTimer = null;
  function toast(text, kind) {
    var t = $('#toast');
    t.textContent = text; t.dataset.kind = kind || 'info'; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, kind === 'error' ? 7000 : 3400);
  }
  function confirmDlg(cim, szoveg, gomb) {
    var d = $('#dlg-ok');
    $('#dlg-ok-h').textContent = cim; $('#dlg-ok-t').textContent = szoveg; $('#dlg-ok-b').textContent = gomb || 'Igen';
    d.returnValue = '';
    return new Promise(function (ok) {
      d.addEventListener('close', function h() { d.removeEventListener('close', h); ok(d.returnValue === 'ok'); });
      d.showModal();
    });
  }

  /* ---------------- törzsadat ---------------- */
  var torzs = null, torzsP = null;
  function loadTorzs(force) {
    if (!torzsP || force) torzsP = api('/beallitasok').then(function (t) { torzs = t; return t; }).catch(function (e) { torzsP = null; throw e; });
    return torzsP;
  }
  function hely(id) { return torzs.helyszinek.filter(function (x) { return x.id === id; })[0]; }
  function szolg(id) { return torzs.szolgaltatasok.filter(function (x) { return x.id === id; })[0]; }
  function koll(id) { return torzs.kollegak.filter(function (x) { return x.id === id; })[0]; }
  // kollégánkénti szín (Caesar szin.js PALETTA): a naptár-blokk, a jelmagyarázat és a színválasztó használja
  var PALETTA = [
    { hex: '#4f6d8a', nev: 'acélkék' }, { hex: '#a0553c', nev: 'terrakotta' }, { hex: '#5b7d55', nev: 'zsályazöld' },
    { hex: '#7d5a8e', nev: 'szilva' }, { hex: '#8c6b2a', nev: 'okker' }, { hex: '#2f6e6e', nev: 'petrol' },
    { hex: '#94485e', nev: 'bordó-rózsa' }, { hex: '#5a5f30', nev: 'olíva' }, { hex: '#3b4580', nev: 'indigó' },
    { hex: '#5e4b44', nev: 'mokka' }
  ];
  var HEX_RE = /^#[0-9a-f]{6}$/i;
  function szinOf(k) {
    var s = k && k.szin;
    if (!HEX_RE.test(s || '') && k && k.id && torzs) s = (koll(k.id) || {}).szin;
    return HEX_RE.test(s || '') ? String(s).toLowerCase() : '#303030';
  }
  // halvány tónus a blokk kitöltéséhez: a szín p arányban fehérrel keverve (color-mix nélkül, minden böngészőben)
  function tonus(hex, p) {
    return '#' + [1, 3, 5].map(function (i) { var v = parseInt(hex.slice(i, i + 2), 16); return ('0' + Math.round(255 + (v - 255) * p).toString(16)).slice(-2); }).join('');
  }
  function kcVars(k) { var c = szinOf(k); return '--kc:' + c + ';--kct:' + tonus(c, 0.16) + ';--kcl:' + tonus(c, 0.4); }
  function kcStyle(k) { return ' style="' + kcVars(k) + '"'; }
  function monogram(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(-2).map(function (w) { return w.charAt(0); }).join('').toUpperCase(); }
  function rovidNev(n) { var p = String(n || '').split(/\s+/); return p.length > 1 ? p[p.length - 1] + ' ' + p[0].charAt(0) + '.' : n; }
  function optionList(list, sel, extra) {
    return (extra || '') + list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.nev) + '</option>'; }).join('');
  }
  function hibaDoboz(box, e, retry) {
    box.setAttribute('aria-busy', 'false');
    box.innerHTML = '<div class="empty-state"><p>' + esc(e.message) + '</p><button type="button" class="btn btn--ghost">Újrapróbálom</button></div>';
    $('button', box).addEventListener('click', retry);
  }

  /* =====================================================================
     1. FOGLALÁSOK
     ===================================================================== */
  var fg = { nezet: 'nap', datum: F.most().datum, hely: '', koll: '', lista: [], beosztas: [], kivetelek: [] };
  var fgReq = 0;

  function fgRange() {
    if (fg.nezet === 'nap') return { tol: fg.datum, ig: fg.datum };
    var h = F.hetfo(fg.datum);
    return { tol: h, ig: F.addDays(h, 6) };
  }
  function fgHash() { return '#/foglalasok/' + fg.nezet + '/' + fg.datum; }
  function openFoglalasok(sub) {
    var m = /^(nap|het)\/(\d{4}-\d{2}-\d{2})$/.exec(sub || '');
    if (m) { fg.nezet = m[1]; fg.datum = m[2]; }
    document.title = 'Foglalások · Admin · Studio F360';
    loadTorzs().then(function () {
      fillFgFilters();
      renderFg();
    }).catch(function (e) { hibaDoboz($('#fg-board'), e, function () { openFoglalasok(sub); }); });
  }
  function fillFgFilters() {
    var hs = $('#fg-hely'), ks = $('#fg-koll');
    hs.innerHTML = optionList(torzs.helyszinek, fg.hely, '<option value="">Mindkét helyszín</option>');
    var kl = torzs.kollegak.filter(function (k) { return !fg.hely || k.helyszinek.indexOf(fg.hely) >= 0; });
    if (fg.koll && !kl.some(function (k) { return k.id === fg.koll; })) fg.koll = '';
    ks.innerHTML = optionList(kl, fg.koll, '<option value="">Mindenki</option>');
    renderPeopleLegend(kl);
  }
  // jelmagyarázat: szakember + színpötty, kattintásra a meglévő szakember-szűrőt állítja
  function renderPeopleLegend(kl) {
    var box = $('#fg-people');
    if (!box) return;
    box.innerHTML = '<span class="pl__h" id="fg-people-h">Kié az időpont</span>' +
      '<ul class="pl__list" aria-labelledby="fg-people-h">' + kl.map(function (k) {
        var on = fg.koll === k.id;
        return '<li><button type="button" class="pl__b" data-pkoll="' + esc(k.id) + '" aria-pressed="' + on + '"' + kcStyle(k) +
          ' title="' + esc(on ? 'Újra mindenki foglalása' : 'Csak ' + k.nev + ' foglalásai') + '">' +
          '<span class="pl__dot" aria-hidden="true"></span>' + esc(k.nev) + '</button></li>';
      }).join('') + '</ul>';
    box.classList.toggle('is-filtered', !!fg.koll);
  }
  function renderFg() {
    var r = fgRange(), req = ++fgReq, board = $('#fg-board');
    $$('.seg__b').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-nezet') === fg.nezet ? 'true' : 'false'); });
    $('#fg-prev').setAttribute('aria-label', fg.nezet === 'nap' ? 'Előző nap' : 'Előző hét');
    $('#fg-next').setAttribute('aria-label', fg.nezet === 'nap' ? 'Következő nap' : 'Következő hét');
    $('#fg-date').value = fg.datum;
    var ma = F.most().datum;
    $('#fg-label').textContent = fg.nezet === 'nap'
      ? F.datumHosszu(fg.datum).replace(/(\d+\. )([a-zá-ű]+)/, '$1$2') + (fg.datum === ma ? ' · ma' : '')
      : r.tol.slice(0, 4) + '. ' + F.honapNap(r.tol) + ' - ' + F.honapNap(r.ig);
    $('#fg-today').disabled = fg.datum === ma && fg.nezet === 'nap';
    board.setAttribute('aria-busy', 'true');
    if (!board.children.length) board.innerHTML = '<div class="skel-board"></div>';
    var q = '?tol=' + r.tol + '&ig=' + r.ig + (fg.hely ? '&helyszin=' + encodeURIComponent(fg.hely) : '') + (fg.koll ? '&kollega=' + encodeURIComponent(fg.koll) : '');
    Promise.all([
      api('/foglalasok' + q),
      api('/beosztas'),
      api('/kivetelek?tol=' + r.tol + '&ig=' + r.ig)
    ]).then(function (res) {
      if (req !== fgReq) return;
      fg.lista = (res[0] && res[0].foglalasok) || [];
      fg.beosztas = (res[1] && res[1].kollegak) || [];
      fg.kivetelek = (res[2] && res[2].kivetelek) || [];
      board.setAttribute('aria-busy', 'false');
      var aktiv = fg.lista.filter(function (b) { return b.allapot !== 'lemondva'; }).length, lem = fg.lista.length - aktiv;
      $('#fg-sum').textContent = aktiv + ' foglalás' + (lem ? ' · ' + lem + ' lemondva' : '') + (fg.nezet === 'nap' ? ' ezen a napon' : ' ezen a héten');
      if (fg.nezet === 'nap') renderNap(board); else renderHet(board);
    }).catch(function (e) { if (req === fgReq) hibaDoboz(board, e, renderFg); });
  }
  function lathatoKollegak(datum) {
    var nap = F.hetNapja(datum) || 7;
    return torzs.kollegak.filter(function (k) {
      if (fg.koll) return k.id === fg.koll;
      if (fg.hely && k.helyszinek.indexOf(fg.hely) < 0) return false;
      var b = fg.beosztas.filter(function (x) { return x.id === k.id; })[0];
      var dolgozik = b && b.sorok.some(function (s) { return s.nap === nap && (!fg.hely || s.helyszin === fg.hely); });
      var vanFoglalas = fg.lista.some(function (x) { return x.kollega.id === k.id && x.datum === datum; });
      return dolgozik || vanFoglalas;
    });
  }
  function kiesesek(kid, datum) {
    return fg.kivetelek.filter(function (k) {
      return datum >= k.tol && datum <= k.ig && (k.kollega === kid || (!k.kollega && k.helyszin));
    });
  }
  function foglBlokk(b, extraCls) {
    var lem = b.allapot === 'lemondva';
    return '<button type="button" title="' + esc(b.kezd + '-' + b.veg + ' · ' + b.nev + ' · ' + b.szolgaltatas.nev + ' · ' + b.kollega.nev + ', ' + b.helyszin.nev) + '" class="bk-item' + (lem ? ' is-cx' : '') + (extraCls ? ' ' + extraCls : '') + '" data-az="' + esc(b.azonosito) + '"' + kcStyle(b.kollega) + ' ' +
      'aria-label="' + esc(b.kezd + '-' + b.veg + ', ' + b.nev + ', ' + b.szolgaltatas.nev + ', ' + b.kollega.nev + ', ' + b.helyszin.nev + (lem ? ', lemondva' : '')) + '">' +
      '<span class="bk-item__t">' + esc(b.kezd) + '<span>-' + esc(b.veg) + '</span></span>' +
      '<span class="bk-item__n">' + esc(b.nev) + '</span>' +
      '<span class="bk-item__s">' + esc(b.szolgaltatas.nev) + (lem ? ' · lemondva' : '') + '</span>' +
    '</button>';
  }
  // napnézet: oszlop = szakember, sor = idő (15 percenként), a munkasáv világos, a kiesés vonalkázott
  function renderNap(board) {
    var d = fg.datum, nap = F.hetNapja(d) || 7;
    var kl = lathatoKollegak(d);
    if (!kl.length) { board.innerHTML = '<div class="empty-state"><p>Ezen a napon senki nincs beosztva' + (fg.hely ? ' ezen a helyszínen' : '') + ', és foglalás sincs.</p></div>'; return; }
    if (narrow.matches) { board.innerHTML = legend() + agenda(d, kl); return; }
    // 5 perces sorok: az 50 perces kezelés pontosan 50 percnyi magas, a szünet látszik a blokkok között
    var R = 5, tol = 24 * 60, ig = 0;
    torzs.helyszinek.forEach(function (h) { if (!fg.hely || fg.hely === h.id) { tol = Math.min(tol, F.perc(h.nyit)); ig = Math.max(ig, F.perc(h.zar)); } });
    var row = function (m) { return Math.round((m - tol) / R) + 2; };
    var html = '<div class="day" style="--cols:' + kl.length + ';--rows:' + ((ig - tol) / R) + '">';
    html += '<div class="day__corner" aria-hidden="true"></div>';
    kl.forEach(function (k, i) {
      html += '<div class="day__head" style="grid-column:' + (i + 2) + '"><span class="av" aria-hidden="true">' + esc(monogram(k.nev)) + '</span><span><b>' + esc(k.nev) + '</b><small>' + esc(k.szerep || '') + '</small></span></div>';
    });
    for (var t = Math.ceil(tol / 60) * 60; t < ig; t += 60) {
      html += '<div class="day__hour" style="grid-row:' + row(t) + ' / span ' + (60 / R) + '" aria-hidden="true">' + F.hm(t) + '</div>';
      html += '<div class="day__line" style="grid-row:' + row(t) + ' / span ' + (60 / R) + '" aria-hidden="true"></div>';
    }
    kl.forEach(function (k, i) {
      var col = i + 2;
      var bo = (fg.beosztas.filter(function (x) { return x.id === k.id; })[0] || { sorok: [] }).sorok;
      bo.filter(function (s) { return s.nap === nap && (!fg.hely || s.helyszin === fg.hely); }).forEach(function (s) {
        var a = Math.max(F.perc(s.kezd), tol), b = Math.min(F.perc(s.veg), ig);
        if (b <= a) return;
        html += '<div class="day__work' + (s.helyszin === 'reitter' ? ' is-reit' : '') + '" style="grid-column:' + col + ';grid-row:' + row(a) + ' / ' + row(b) + '"><span>' + esc((hely(s.helyszin) || {}).nev || '') + ' · ' + esc(s.kezd + '-' + s.veg) + '</span></div>';
      });
      kiesesek(k.id, d).forEach(function (x) {
        var a = Math.max(x.kezd ? F.perc(x.kezd) : tol, tol), b = Math.min(x.veg ? F.perc(x.veg) : ig, ig);
        if (b <= a) return;
        html += '<div class="day__off" style="grid-column:' + col + ';grid-row:' + row(a) + ' / ' + row(b) + '"><span>' + esc(x.megjegyzes || (x.kollega ? 'Szabadság' : 'Zárva')) + '</span></div>';
      });
      fg.lista.filter(function (b) { return b.kollega.id === k.id && b.datum === d; }).forEach(function (b) {
        var a = Math.max(F.perc(b.kezd), tol), e = Math.min(F.perc(b.kezd) + b.szolgaltatas.perc, ig);
        html += '<div class="day__slot" style="grid-column:' + col + ';grid-row:' + row(a) + ' / ' + row(Math.max(e, a + 30)) + '">' + foglBlokk(b) + '</div>';
      });
    });
    var most = F.most();
    if (d === most.datum && most.perc > tol && most.perc < ig) {
      html += '<div class="day__now" style="grid-row:' + row(Math.floor(most.perc / R) * R) + '" aria-hidden="true"><span>' + F.hm(most.perc) + '</span></div>';
    }
    html += '</div>';
    board.innerHTML = legend() + '<div class="day-scroll" tabindex="0" aria-label="Napi beosztás és foglalások, görgethető">' + html + '</div>';
    // az első foglalás vagy a mostani idő legyen látható
    var sc = $('.day-scroll', board), first = $('.day__slot, .day__now', sc);
    if (first) sc.scrollTop = Math.max(0, first.offsetTop - 90);
  }
  function legend() {
    return '<ul class="legend" aria-label="Jelmagyarázat"><li class="legend__h" aria-hidden="true">Jelek:</li>' +
      '<li><span class="lg lg--work" aria-hidden="true"></span>Munkaidő, Mexikói út</li>' +
      '<li><span class="lg lg--work is-reit" aria-hidden="true"></span>Munkaidő, Reitter Ferenc utca</li>' +
      '<li><span class="lg lg--off" aria-hidden="true"></span>Szabadság, zárva</li>' +
      '<li><span class="lg lg--cx" aria-hidden="true"></span>Lemondott foglalás</li></ul>';
  }
  // keskeny képernyőn: időrendi lista szakemberenként
  function agenda(d, kl) {
    return '<div class="agenda">' + kl.map(function (k) {
      var list = fg.lista.filter(function (b) { return b.kollega.id === k.id && b.datum === d; });
      var off = kiesesek(k.id, d);
      return '<section class="agenda__p"><h2 class="agenda__h"><span class="av" aria-hidden="true">' + esc(monogram(k.nev)) + '</span>' + esc(k.nev) + '<small>' + list.filter(function (b) { return b.allapot !== 'lemondva'; }).length + ' foglalás</small></h2>' +
        off.map(function (x) { return '<p class="agenda__off">' + esc((x.kezd ? x.kezd + '-' + x.veg + ' · ' : 'Egész nap · ') + (x.megjegyzes || (x.kollega ? 'Szabadság' : 'Zárva'))) + '</p>'; }).join('') +
        (list.length ? list.map(function (b) { return foglBlokk(b, 'bk-item--row'); }).join('') : '<p class="agenda__none">Nincs foglalás.</p>') + '</section>';
    }).join('') + '</div>';
  }
  function renderHet(board) {
    var r = fgRange(), ma = F.most().datum, html = '<div class="week">';
    for (var i = 0; i < 7; i++) {
      var d = F.addDays(r.tol, i);
      var list = fg.lista.filter(function (b) { return b.datum === d; });
      var aktiv = list.filter(function (b) { return b.allapot !== 'lemondva'; }).length;
      var zar = fg.kivetelek.filter(function (k) { return !k.kollega && d >= k.tol && d <= k.ig && (!fg.hely || k.helyszin === fg.hely) && !k.kezd; });
      html += '<section class="week__d' + (d === ma ? ' is-today' : '') + '" aria-label="' + esc(F.datumNap(d)) + '">' +
        '<a class="week__h" href="#/foglalasok/nap/' + d + '"><span>' + NAP_HOSSZU[(F.hetNapja(d) + 6) % 7] + '</span><b>' + Number(d.slice(8)) + '</b><small>' + (aktiv ? aktiv + ' foglalás' : 'nincs foglalás') + '</small></a>' +
        zar.map(function (k) { return '<p class="week__off">' + esc((hely(k.helyszin) || {}).nev || '') + ': ' + esc(k.megjegyzes || 'zárva') + '</p>'; }).join('') +
        '<div class="week__list">' + list.map(function (b) {
          return '<button type="button" class="wk-item' + (b.allapot === 'lemondva' ? ' is-cx' : '') + '" data-az="' + esc(b.azonosito) + '"' + kcStyle(b.kollega) +
            ' title="' + esc(b.kezd + ' · ' + b.nev + ' · ' + b.szolgaltatas.nev + ' · ' + b.kollega.nev + ', ' + b.helyszin.nev) + '">' +
            '<b>' + esc(b.kezd) + '</b><span>' + esc(b.nev) + '</span><small>' + esc(rovidNev(b.kollega.nev)) + ' · ' + esc(b.szolgaltatas.nev) + (b.allapot === 'lemondva' ? ' · lemondva' : '') + '</small></button>';
        }).join('') + '</div></section>';
    }
    board.innerHTML = html + '</div>';
  }
  function fgMozgat(n) { fg.datum = F.addDays(fg.datum, n * (fg.nezet === 'nap' ? 1 : 7)); location.hash = fgHash(); }

  /* ---------- foglalás részletei + lemondás ---------- */
  function openDetail(az) {
    var b = fg.lista.filter(function (x) { return x.azonosito === az; })[0];
    if (!b) return;
    var lem = b.allapot === 'lemondva';
    var tel = b.telefon ? '<a href="tel:' + esc(String(b.telefon).replace(/[^\d+]/g, '')) + '">' + esc(b.telefon) + '</a>' : 'nincs megadva';
    var em = b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : 'nincs megadva';
    $('#dlg-fg-h').textContent = b.nev;
    $('#dlg-fg-body').innerHTML = '<dl class="dl">' +
      '<div><dt>Időpont</dt><dd>' + esc(F.datumHosszu(b.datum)) + ', <b>' + esc(b.kezd + '-' + b.veg) + '</b></dd></div>' +
      '<div><dt>Kezelés</dt><dd>' + esc(b.szolgaltatas.nev) + ' · ' + esc(b.szolgaltatas.perc) + ' perc' + (b.szolgaltatas.ar != null ? ' · ' + esc(F.ft(b.szolgaltatas.ar)) : '') + '</dd></div>' +
      '<div><dt>Szakember</dt><dd>' + esc(b.kollega.nev) + '</dd></div>' +
      '<div><dt>Helyszín</dt><dd>' + esc(b.helyszin.nev) + '</dd></div>' +
      '<div><dt>Telefon</dt><dd>' + tel + '</dd></div>' +
      '<div><dt>E-mail</dt><dd>' + em + '</dd></div>' +
      (b.megjegyzes ? '<div><dt>Megjegyzés</dt><dd>' + esc(b.megjegyzes) + '</dd></div>' : '') +
      '<div><dt>Állapot</dt><dd>' + (lem ? '<b>Lemondva</b>' : 'Megerősítve') + ' · ' + (b.forras === 'admin' ? 'kézzel felvéve' : 'a weboldalon foglalta') + '</dd></div>' +
      '<div><dt>Azonosító</dt><dd class="mono">' + esc(b.azonosito) + '</dd></div>' +
      '</dl>';
    var act = $('#dlg-fg-act');
    // áthelyezés: megerősített és még el nem kezdődött foglalásnál (a backend a múltbelit 410-zel elutasítja)
    var athelyezheto = !lem && F.percIg(b.datum, F.perc(b.kezd)) > 0;
    act.innerHTML = (lem ? '' : '<button type="button" class="linkbtn linkbtn--danger" id="fg-cx">Foglalás lemondása</button>') +
      (athelyezheto ? '<button type="button" class="btn btn--ghost" id="fg-move">Áthelyezés</button>' : '') +
      '<button type="button" class="btn btn--primary" id="fg-close" autofocus>Bezárás</button>';
    var d = $('#dlg-fg');
    $('#fg-close').addEventListener('click', function () { d.close(); });
    if (athelyezheto) $('#fg-move').addEventListener('click', function () { d.close(); openMove(b); });
    if (!lem) $('#fg-cx').addEventListener('click', function () {
      d.close();
      confirmDlg('Lemondod a foglalást?', b.nev + ', ' + F.datumNap(b.datum) + ' ' + b.kezd + '. Az időpont felszabadul, és ha van e-mail-cím, a vendég lemondó levelet kap.', 'Lemondás').then(function (ok) {
        if (!ok) return;
        api('/foglalasok/' + encodeURIComponent(b.azonosito) + '/lemondas', { method: 'POST', json: {} }).then(function () {
          toast('A foglalást lemondtuk: ' + b.nev + ', ' + b.kezd);
          renderFg();
        }).catch(function (e) { toast(e.message, 'error'); renderFg(); });
      });
    });
    d.showModal();
  }

  /* ---------- áthelyezés (PATCH /api/foglalo/foglalasok/:id) ---------- */
  var mv = { b: null };
  function openMove(b) {
    mv.b = b;
    loadTorzs().then(function () {
      var kl = torzs.kollegak.filter(function (k) { return k.helyszinek.indexOf(b.helyszin.id) >= 0 && k.szolgaltatasok.indexOf(b.szolgaltatas.id) >= 0; });
      if (!kl.some(function (k) { return k.id === b.kollega.id; }) && koll(b.kollega.id)) kl.unshift(koll(b.kollega.id));
      $('#dlg-move-h').textContent = 'Áthelyezés: ' + b.nev;
      $('#mv-now').textContent = 'Most: ' + F.datumNap(b.datum) + ', ' + b.kezd + '-' + b.veg + ', ' + b.kollega.nev + '. ' + b.szolgaltatas.nev + ', ' + b.helyszin.nev + '.';
      $('#mv-koll').innerHTML = '<option value="barki">Bárki, aki szabad</option>' + optionList(kl, b.kollega.id);
      $('#mv-datum').value = b.datum;
      $('#mv-datum').min = F.most().datum;
      $('#mv-err').hidden = true;
      var ok = $('#mv-ok'); ok.disabled = false; ok.textContent = 'Áthelyezés';
      moveSlots();
      $('#dlg-move').showModal();
    }).catch(function (e) { toast(e.message, 'error'); });
  }
  var mvReq = 0;
  function moveSlots(keep) {
    var box = $('#mv-slots'), d = $('#mv-datum').value, b = mv.b, req = ++mvReq, kid = $('#mv-koll').value;
    if (!d) { box.innerHTML = '<p class="hint">Válassz napot.</p>'; return; }
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = '<p class="hint">Szabad időpontok betöltése</p>';
    api('/szabad?foglalas=' + encodeURIComponent(b.azonosito) + '&kollega=' + encodeURIComponent(kid) + '&tol=' + d + '&ig=' + d).then(function (r) {
      if (req !== mvReq) return;
      box.setAttribute('aria-busy', 'false');
      var list = (r && r.napok && r.napok[d]) || [];
      if (!list.length) { box.innerHTML = '<p class="hint">Ezen a napon nincs szabad időpont ' + (kid === 'barki' ? 'senkinél' : 'ennél a szakembernél') + '. Válassz másik napot vagy szakembert.</p>'; return; }
      box.innerHTML = '<div class="pills">' + list.map(function (x) {
        // a jelenlegi időpont: jelölve, nem választható (ugyanarra nem lehet áthelyezni)
        var sajat = d === b.datum && x.kezd === b.kezd && (kid === 'barki' || kid === b.kollega.id);
        var who = x.kollegak.length === 1 && koll(x.kollegak[0]) ? rovidNev(koll(x.kollegak[0]).nev) : x.kollegak.length + ' szabad';
        return '<label class="pill' + (sajat ? ' is-now' : '') + '"><input type="radio" name="mv-slot" value="' + esc(x.kezd) + '"' + (sajat ? ' disabled' : '') + (keep === x.kezd && !sajat ? ' checked' : '') + '>' +
          '<span>' + esc(x.kezd) + '<small>' + esc(sajat ? 'jelenlegi' : who) + '</small></span></label>';
      }).join('') + '</div>';
    }).catch(function (e) { if (req === mvReq) { box.setAttribute('aria-busy', 'false'); box.innerHTML = '<p class="form-err">' + esc(e.message) + '</p>'; } });
  }
  function submitMove(ev) {
    ev.preventDefault();
    var b = mv.b, err = $('#mv-err'), ok = $('#mv-ok'), sel = $('input[name="mv-slot"]:checked');
    var body = { datum: $('#mv-datum').value, kezd: sel ? sel.value : '', kollega: $('#mv-koll').value };
    if (!body.kezd) { err.textContent = 'Válassz új időpontot a szabad időpontok közül.'; err.hidden = false; return; }
    err.hidden = true; ok.disabled = true; ok.textContent = 'Áthelyezés folyamatban';
    api('/foglalasok/' + encodeURIComponent(b.azonosito), { method: 'PATCH', json: body }).then(function (r) {
      ok.disabled = false; ok.textContent = 'Áthelyezés';
      $('#dlg-move').close();
      var f = (r && r.foglalas) || {};
      toast('Áthelyezve: ' + b.nev + ', ' + F.datumNap(body.datum) + ' ' + body.kezd + (f.kollega ? ', ' + f.kollega.nev : ''));
      fg.datum = body.datum;
      if (location.hash !== fgHash()) location.hash = fgHash(); else renderFg();
    }).catch(function (e) {
      ok.disabled = false; ok.textContent = 'Áthelyezés';
      err.textContent = e.message; err.hidden = false;
      if (e.status === 409) moveSlots();
      if (e.status === 410 || e.status === 404) renderFg();
    });
  }

  /* ---------- kézi felvétel ---------- */
  var nw = { slot: '' };
  function openNew() {
    loadTorzs().then(function () {
      var h = fg.hely || torzs.helyszinek[0].id;
      $('#n-hely').innerHTML = optionList(torzs.helyszinek, h);
      $('#n-datum').value = fg.datum < F.most().datum ? F.most().datum : fg.datum;
      $('#n-nev').value = ''; $('#n-tel').value = ''; $('#n-email').value = ''; $('#n-megj').value = '';
      $('#n-err').hidden = true;
      newFill('hely');
      $('#dlg-new').showModal();
    }).catch(function (e) { toast(e.message, 'error'); });
  }
  function newFill(from) {
    var h = $('#n-hely').value;
    if (from === 'hely') {
      var sl = torzs.szolgaltatasok.filter(function (s) { return s.helyszinek.indexOf(h) >= 0; });
      $('#n-szolg').innerHTML = sl.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.nev + ' · ' + s.perc + ' perc') + '</option>'; }).join('');
    }
    if (from === 'hely' || from === 'szolg') {
      var sz = $('#n-szolg').value;
      var kl = torzs.kollegak.filter(function (k) { return k.helyszinek.indexOf(h) >= 0 && k.szolgaltatasok.indexOf(sz) >= 0; });
      var pref = fg.koll && kl.some(function (k) { return k.id === fg.koll; }) ? fg.koll : 'barki';
      $('#n-koll').innerHTML = '<option value="barki"' + (pref === 'barki' ? ' selected' : '') + '>Bárki, aki szabad</option>' + optionList(kl, pref);
    }
    newSlots();
  }
  var slotReq = 0;
  function newSlots() {
    var box = $('#n-slots'), d = $('#n-datum').value, req = ++slotReq;
    nw.slot = '';
    if (!d || !$('#n-szolg').value) { box.innerHTML = '<p class="hint">Válassz kezelést és napot.</p>'; return; }
    box.innerHTML = '<p class="hint">Szabad időpontok betöltése</p>';
    api('/szabad?helyszin=' + encodeURIComponent($('#n-hely').value) + '&szolgaltatas=' + encodeURIComponent($('#n-szolg').value) +
      '&kollega=' + encodeURIComponent($('#n-koll').value) + '&tol=' + d + '&ig=' + d, { publikus: true }).then(function (r) {
      if (req !== slotReq) return;
      var list = (r && r.napok && r.napok[d]) || [];
      if (!list.length) { box.innerHTML = '<p class="hint">Ezen a napon nincs szabad időpont ennél a kezelésnél. Válassz másik napot vagy szakembert.</p>'; return; }
      box.innerHTML = '<div class="pills">' + list.map(function (x) {
        var who = x.kollegak.length === 1 && koll(x.kollegak[0]) ? rovidNev(koll(x.kollegak[0]).nev) : x.kollegak.length + ' szabad';
        return '<label class="pill"><input type="radio" name="n-slot" value="' + esc(x.kezd) + '"><span>' + esc(x.kezd) + '<small>' + esc(who) + '</small></span></label>';
      }).join('') + '</div><p class="hint">A foglaló a legalább ' + esc((torzs.szabalyok || {}).minEloreOra) + ' órával későbbi időpontokat mutatja.</p>';
    }).catch(function (e) { if (req === slotReq) box.innerHTML = '<p class="form-err">' + esc(e.message) + '</p>'; });
  }
  function submitNew(ev) {
    ev.preventDefault();
    var err = $('#n-err'), ok = $('#n-ok');
    var sel = $('input[name="n-slot"]:checked');
    var body = {
      helyszin: $('#n-hely').value, szolgaltatas: $('#n-szolg').value, kollega: $('#n-koll').value, datum: $('#n-datum').value,
      kezd: sel ? sel.value : '', nev: $('#n-nev').value.trim(), telefon: $('#n-tel').value.trim(), email: $('#n-email').value.trim(), megjegyzes: $('#n-megj').value.trim()
    };
    var msg = !body.kezd ? 'Válassz időpontot a szabad időpontok közül.' : body.nev.length < 2 ? 'Add meg a vendég nevét.' : '';
    if (msg) { err.textContent = msg; err.hidden = false; (body.kezd ? $('#n-nev') : $('#n-slots')).focus && (body.kezd ? $('#n-nev').focus() : null); return; }
    err.hidden = true; ok.disabled = true; ok.textContent = 'Rögzítés folyamatban';
    api('/foglalasok', { method: 'POST', json: body }).then(function (r) {
      ok.disabled = false; ok.textContent = 'Foglalás rögzítése';
      $('#dlg-new').close();
      toast('Rögzítve: ' + body.nev + ', ' + F.datumNap(body.datum) + ' ' + body.kezd + (r && r.foglalas ? ', ' + r.foglalas.kollega.nev : ''));
      fg.datum = body.datum; fg.nezet = 'nap';
      if (location.hash !== fgHash()) location.hash = fgHash(); else renderFg();
    }).catch(function (e) {
      ok.disabled = false; ok.textContent = 'Foglalás rögzítése';
      err.textContent = e.message; err.hidden = false;
      if (e.status === 409) newSlots();
    });
  }

  /* =====================================================================
     2. BEOSZTÁS
     ===================================================================== */
  var bo = { kid: '', sorok: [], dirty: false, kivetelek: [] };
  var IDO = (function () { var o = []; for (var t = 6 * 60; t <= 22 * 60; t += 15) o.push(F.hm2(t)); return o; })();
  function openBeosztas(sub) {
    document.title = 'Beosztás · Admin · Studio F360';
    loadTorzs().then(function () {
      var elozo = bo.kid;
      if (sub && koll(sub)) bo.kid = sub;
      if (!bo.kid || !koll(bo.kid)) bo.kid = torzs.kollegak[0] && torzs.kollegak[0].id;
      // másik kolléga: az előző kártyája (és színválasztója) ne maradjon kattintható a betöltésig
      if (elozo !== bo.kid) $('#bo-main').innerHTML = '<div class="skel-board"></div>';
      renderPeople();
      loadBo();
    }).catch(function (e) { hibaDoboz($('#bo-main'), e, function () { openBeosztas(sub); }); });
  }
  function renderPeople() {
    $('#bo-people').innerHTML = torzs.kollegak.map(function (k) {
      return '<a class="person' + (k.id === bo.kid ? ' is-on' : '') + '" href="#/beosztas/' + esc(k.id) + '"' + (k.id === bo.kid ? ' aria-current="true"' : '') + '>' +
        '<span class="av" aria-hidden="true">' + esc(monogram(k.nev)) + '</span><span><b>' + esc(k.nev) + '</b><small>' + esc(k.helyszinek.map(function (h) { return (hely(h) || {}).nev; }).join(', ')) + '</small></span></a>';
    }).join('');
  }
  function loadBo() {
    var main = $('#bo-main');
    main.setAttribute('aria-busy', 'true');
    Promise.all([api('/beosztas?kollega=' + encodeURIComponent(bo.kid)), api('/kivetelek?tol=' + F.most().datum)]).then(function (r) {
      bo.sorok = (r[0].sorok || []).map(function (s) { return { nap: s.nap, helyszin: s.helyszin, kezd: s.kezd, veg: s.veg }; });
      bo.kivetelek = r[1].kivetelek || [];
      bo.dirty = false;
      main.setAttribute('aria-busy', 'false');
      renderBo();
    }).catch(function (e) { hibaDoboz(main, e, loadBo); });
  }
  function hetOra(sorok) {
    return sorok.reduce(function (a, s) { return a + (F.perc(s.veg) - F.perc(s.kezd)); }, 0) / 60;
  }
  function renderBo() {
    var k = koll(bo.kid), main = $('#bo-main');
    var ora = hetOra(bo.sorok);
    var html = '<div class="bo-card"><div class="bo-card__head"><div><h2>' + esc(k.nev) + '</h2><p>' + esc(k.szerep || '') + ' · heti ' + String(Math.round(ora * 10) / 10).replace('.', ',') + ' óra</p></div>' +
      '<div class="bo-card__act"><button type="button" class="btn btn--ghost" id="bo-copy">Hétfő másolása keddtől péntekig</button></div></div>' +
      szinValaszto(k);
    html += '<ol class="wkgrid" aria-label="Heti beosztás">';
    for (var n = 1; n <= 7; n++) {
      var list = bo.sorok.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return x.s.nap === n; })
        .sort(function (a, b) { return F.perc(a.s.kezd) - F.perc(b.s.kezd); });
      html += '<li class="wkrow' + (list.length ? '' : ' is-free') + '"><div class="wkrow__d"><b>' + NAP_HOSSZU[n - 1] + '</b><small>' + (list.length ? list.length + ' sáv' : 'szabadnap') + '</small></div>' +
        '<div class="wkrow__bar" aria-hidden="true" title="7 és 21 óra között">' + barHtml(list.map(function (x) { return x.s; })) + '</div>' +
        '<div class="wkrow__bands">' + list.map(function (x) { return bandHtml(x.s, x.i, k); }).join('') +
        '<button type="button" class="addband" data-add="' + n + '"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' + (list.length ? 'Még egy sáv' : 'Dolgozik ezen a napon') + '<span class="sr"> (' + NAP_HOSSZU[n - 1] + ')</span></button></div></li>';
    }
    html += '</ol>';
    html += '<div class="savebar" id="bo-savebar"><p id="bo-state" aria-live="polite">' + (bo.dirty ? 'Mentetlen változás' : 'Mentve') + '</p>' +
      '<button type="button" class="btn btn--ghost" id="bo-reset"' + (bo.dirty ? '' : ' disabled') + '>Visszaállítás</button>' +
      '<button type="button" class="btn btn--primary" id="bo-save"' + (bo.dirty ? '' : ' disabled') + '>Beosztás mentése</button></div></div>';
    html += kivetelHtml();
    main.innerHTML = html;
    $('#bo-savebar').classList.toggle('is-dirty', bo.dirty);
  }
  function barHtml(sorok) {
    var tol = 7 * 60, ig = 21 * 60, out = '';
    for (var t = tol; t <= ig; t += 120) out += '<span class="tick" style="left:' + ((t - tol) / (ig - tol) * 100) + '%">' + (t / 60) + '</span>';
    // a sáv <i>, a jelölő <span>: így a .tick:last-of-type a 21 órás jelölő
    sorok.forEach(function (s) {
      var a = Math.max(F.perc(s.kezd), tol), b = Math.min(F.perc(s.veg), ig);
      if (b > a) out += '<i class="band' + (s.helyszin === 'reitter' ? ' is-reit' : '') + '" style="left:' + ((a - tol) / (ig - tol) * 100) + '%;width:' + ((b - a) / (ig - tol) * 100) + '%"></i>';
    });
    return out;
  }
  function bandHtml(s, i, k) {
    var helyek = k.helyszinek.map(hely).filter(Boolean);
    var hs = helyek.length > 1
      ? '<label><span class="sr">Helyszín</span><select data-f="helyszin" data-i="' + i + '">' + optionList(helyek, s.helyszin) + '</select></label>'
      : '<span class="bandrow__h">' + esc((hely(s.helyszin) || {}).nev || '') + '</span>';
    function sel(f, v) { return '<select data-f="' + f + '" data-i="' + i + '" aria-label="' + (f === 'kezd' ? 'Kezdés' : 'Vége') + '">' + IDO.map(function (t) { return '<option' + (t === v ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>'; }
    return '<div class="bandrow' + (s.helyszin === 'reitter' ? ' is-reit' : '') + '">' + hs + '<span class="bandrow__t">' + sel('kezd', s.kezd) + '<span aria-hidden="true">-</span>' + sel('veg', s.veg) + '</span>' +
      '<button type="button" class="iconbtn bandrow__x" data-del="' + i + '" aria-label="Sáv törlése: ' + esc(NAP_HOSSZU[s.nap - 1] + ' ' + s.kezd + '-' + s.veg) + '"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>';
  }
  /* ---------- kolléga színe (PATCH /api/foglalo/kollegak?kollega=) ---------- */
  function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16) / 255; }); }
  function lum(h) { var c = hexRgb(h).map(function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function kontraszt(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function kiHasznalja(hex, kid) {
    return torzs.kollegak.filter(function (x) { return x.id !== kid && szinOf(x) === hex; }).map(function (x) { return x.nev; });
  }
  function szinValaszto(k) {
    var cur = szinOf(k), sajat = !PALETTA.some(function (p) { return p.hex === cur; });
    return '<fieldset class="kc-pick" data-kid="' + esc(k.id) + '"' + kcStyle(k) + '><legend>Szín a naptárban</legend>' +
      '<p class="kc-pick__d">Ezzel a színnel látszanak ' + esc(k.nev) + ' foglalásai a napi és a heti nézetben. A fehér pöttyös színt már egy másik kolléga használja.</p>' +
      '<div class="kc-pick__row">' + PALETTA.map(function (p) {
        var foglalt = kiHasznalja(p.hex, k.id);
        return '<label class="kc-sw" style="--kc:' + p.hex + '" title="' + esc(p.nev + (foglalt.length ? ', ' + foglalt.join(', ') + ' is ezt használja' : '')) + '">' +
          '<input type="radio" name="kc" value="' + p.hex + '"' + (p.hex === cur ? ' checked' : '') + '>' +
          '<span class="kc-sw__c" aria-hidden="true"></span><span class="sr">' + esc(p.nev) + (foglalt.length ? ' (' + esc(foglalt.join(', ')) + ' is ezt használja)' : '') + '</span>' +
          (foglalt.length ? '<span class="kc-sw__used" aria-hidden="true"></span>' : '') + '</label>';
      }).join('') +
      '<label class="kc-own' + (sajat ? ' is-on' : '') + '"><input type="color" id="kc-own" value="' + cur + '"><span>Egyedi szín</span></label>' +
      '</div><p class="kc-pick__n" id="kc-note" aria-live="polite">' + esc(szinMegjegyzes(cur, k.id)) + '</p></fieldset>';
  }
  function szinMegjegyzes(hex, kid) {
    var f = kiHasznalja(hex, kid);
    return f.length ? 'Ezt a színt ' + f.join(' és ') + ' is használja. Válassz másikat, hogy a naptárban meg lehessen különböztetni.' : '';
  }
  var szinReq = 0;
  function szinMent(hex) {
    var k = koll(bo.kid), kid = bo.kid, req = ++szinReq, pick = $('.kc-pick');
    if (!pick || pick.getAttribute('data-kid') !== kid) return;
    hex = String(hex).toLowerCase();
    if (!HEX_RE.test(hex) || hex === szinOf(k)) return;
    if (kontraszt(hex, '#ffffff') < 3) {
      $('#kc-note').textContent = 'Ez a szín túl világos, a naptárban alig látszana. Válassz sötétebbet.';
      $('#kc-own').value = szinOf(k);
      return;
    }
    pick.setAttribute('aria-busy', 'true'); pick.style.setProperty('--kc', hex);
    api('/kollegak?kollega=' + encodeURIComponent(kid), { method: 'PATCH', json: { szin: hex } }).then(function (r) {
      var uj = (r && r.szin) || hex;
      koll(kid).szin = uj;
      if (be.t) be.t.kollegak.forEach(function (x) { if (x.id === kid) x.szin = uj; });
      if (req !== szinReq || bo.kid !== kid) return;
      renderPeople();
      var keep = bo.dirty; renderBo(); if (keep) boChanged();
      toast('Mentve: ' + k.nev + ' új színe a naptárban');
      var on = $('.kc-pick input:checked') || $('#kc-own'); if (on) on.focus();
    }).catch(function (e) {
      if (req !== szinReq) return;
      toast(e.message, 'error');
      var after = function () { if (bo.kid === kid) { renderPeople(); var keep = bo.dirty; renderBo(); if (keep) boChanged(); } };
      if (e.status === 409) loadTorzs(true).then(after, after); else after();
    });
  }
  function boValid() {
    for (var i = 0; i < bo.sorok.length; i++) {
      var a = bo.sorok[i];
      if (F.perc(a.kezd) >= F.perc(a.veg)) return NAP_HOSSZU[a.nap - 1] + ': a sáv vége legyen későbbi, mint a kezdése (' + a.kezd + '-' + a.veg + ').';
      for (var j = i + 1; j < bo.sorok.length; j++) {
        var b = bo.sorok[j];
        if (a.nap === b.nap && F.perc(a.kezd) < F.perc(b.veg) && F.perc(b.kezd) < F.perc(a.veg)) return NAP_HOSSZU[a.nap - 1] + ': két sáv fedi egymást (' + a.kezd + '-' + a.veg + ' és ' + b.kezd + '-' + b.veg + ').';
      }
    }
    return '';
  }
  function boChanged() { bo.dirty = true; var st = $('#bo-state'); if (st) st.textContent = 'Mentetlen változás'; $('#bo-save').disabled = false; $('#bo-reset').disabled = false; $('#bo-savebar').classList.add('is-dirty'); }
  function saveBo() {
    var msg = boValid();
    if (msg) { toast(msg, 'error'); return; }
    var b = $('#bo-save'); b.disabled = true; b.textContent = 'Mentés folyamatban';
    api('/beosztas?kollega=' + encodeURIComponent(bo.kid), { method: 'PUT', json: { sorok: bo.sorok } }).then(function (r) {
      bo.sorok = r.sorok; bo.dirty = false; renderBo();
      toast('Mentve: ' + koll(bo.kid).nev + ' heti beosztása');
    }).catch(function (e) { b.disabled = false; b.textContent = 'Beosztás mentése'; toast(e.message, 'error'); });
  }
  // kivételek: szabadság, zárva tartás (a backendben minden kivétel kiesés)
  function kivetelHtml() {
    var list = bo.kivetelek.slice().sort(function (a, b) { return a.tol.localeCompare(b.tol); });
    function kinek(x) { return x.kollega ? (koll(x.kollega) || {}).nev || x.kollega : 'Az egész ' + ((hely(x.helyszin) || {}).nev || '') + ' zárva'; }
    function mikor(x) {
      var d = x.tol === x.ig ? F.datumNap(x.tol) : F.honapNap(x.tol) + ' - ' + F.honapNap(x.ig);
      return d + (x.kezd ? ', ' + x.kezd + '-' + x.veg : ', egész nap');
    }
    var ma = F.most().datum;
    return '<div class="bo-card bo-ex"><div class="bo-card__head"><div><h2>Szabadság és zárva tartás</h2><p>Ezekben az időkben a foglaló nem ad időpontot. A már meglévő foglalásokat nem mondja le.</p></div></div>' +
      (list.length ? '<ul class="exlist">' + list.map(function (x) {
        return '<li class="ex' + (x.kollega === bo.kid ? ' is-mine' : '') + '"><span class="ex__w"><b>' + esc(kinek(x)) + '</b><span>' + esc(mikor(x)) + (x.megjegyzes ? ' · ' + esc(x.megjegyzes) : '') + '</span></span>' +
          '<button type="button" class="linkbtn" data-exdel="' + esc(x.id) + '" aria-label="Törlés: ' + esc(kinek(x) + ', ' + mikor(x)) + '">Törlés</button></li>';
      }).join('') + '</ul>' : '<p class="empty-inline">Nincs rögzített szabadság vagy zárva tartás.</p>') +
      '<form class="exform" id="ex-form" novalidate><p class="exform__h">Új felvétele</p><div class="exform__g">' +
        '<div class="field"><label for="ex-kinek">Kinél</label><select id="ex-kinek">' + optionList(torzs.kollegak, bo.kid) +
          torzs.helyszinek.map(function (h) { return '<option value="hely:' + esc(h.id) + '">Az egész ' + esc(h.nev) + ' zárva</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="ex-tol">Első nap</label><input type="date" id="ex-tol" min="' + ma + '" value="' + ma + '" required></div>' +
        '<div class="field"><label for="ex-ig">Utolsó nap</label><input type="date" id="ex-ig" min="' + ma + '" value="' + ma + '" required></div>' +
        '<div class="field field--chk"><label class="chkl"><input type="checkbox" id="ex-egesz" checked> Egész nap</label></div>' +
        '<div class="field ex-ido" hidden><label for="ex-kezd">Ettől</label><select id="ex-kezd">' + IDO.map(function (t) { return '<option' + (t === '08:00' ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
        '<div class="field ex-ido" hidden><label for="ex-veg">Eddig</label><select id="ex-veg">' + IDO.map(function (t) { return '<option' + (t === '12:00' ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
        '<div class="field exform__m"><label for="ex-megj">Megjegyzés <span class="opt">(nem kötelező)</span></label><input type="text" id="ex-megj" maxlength="300" placeholder="Például: szabadság, továbbképzés, ünnepnap"></div>' +
      '</div><p class="hint">Rendkívüli nyitvatartás (a heti mintán felüli plusz nap) később kerül a rendszerbe.</p>' +
      '<p class="form-err" id="ex-err" role="alert" hidden></p><div class="exform__act"><button type="submit" class="btn btn--primary">Felvétel</button></div></form></div>';
  }
  function submitEx(ev) {
    ev.preventDefault();
    var k = $('#ex-kinek').value, egesz = $('#ex-egesz').checked, err = $('#ex-err');
    var body = { kollega: /^hely:/.test(k) ? null : k, helyszin: /^hely:/.test(k) ? k.slice(5) : null, tol: $('#ex-tol').value, ig: $('#ex-ig').value, megjegyzes: $('#ex-megj').value.trim() };
    if (!egesz) { body.kezd = $('#ex-kezd').value; body.veg = $('#ex-veg').value; }
    var msg = !body.tol || !body.ig ? 'Add meg az első és az utolsó napot.' : body.ig < body.tol ? 'Az utolsó nap nem lehet korábbi az elsőnél.' : !egesz && body.kezd >= body.veg ? 'A vége legyen későbbi, mint a kezdés.' : '';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    err.hidden = true;
    api('/kivetelek', { method: 'POST', json: body }).then(function () {
      toast('Felvéve: ' + (body.kollega ? koll(body.kollega).nev : hely(body.helyszin).nev + ' zárva') + ', ' + (body.tol === body.ig ? F.datumNap(body.tol) : F.honapNap(body.tol) + ' - ' + F.honapNap(body.ig)));
      return api('/kivetelek?tol=' + F.most().datum);
    }).then(function (r) {
      bo.kivetelek = r.kivetelek || [];
      var keep = bo.dirty; renderBo(); if (keep) boChanged();
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; });
  }

  /* =====================================================================
     3. BEÁLLÍTÁSOK
     ===================================================================== */
  var be = { t: null, dirty: false };
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'uj';
  }
  function ujId(nev, lista) {
    var base = slugify(nev); if (base === 'barki') base = 'barki-1';
    var id = base, n = 2;
    while (lista.some(function (x) { return x.id === id; })) id = base + '-' + (n++);
    return id;
  }
  function openBeallitasok() {
    document.title = 'Beállítások · Admin · Studio F360';
    var form = $('#be-form');
    if (be.dirty && be.t) return renderBe();
    form.innerHTML = '<div class="skel-board"></div>';
    loadTorzs(true).then(function (t) { be.t = JSON.parse(JSON.stringify(t)); be.dirty = false; renderBe(); })
      .catch(function (e) { hibaDoboz(form, e, openBeallitasok); });
  }
  function chk(name, val, on, label, extra) {
    return '<label class="tick-l"><input type="checkbox" data-' + name + '="' + esc(val) + '"' + (on ? ' checked' : '') + (extra || '') + '><span>' + esc(label) + '</span></label>';
  }
  function renderBe() {
    var t = be.t, html = '';
    // kezelések
    html += '<section class="be-sec" aria-labelledby="be-sz-h"><div class="be-sec__head"><h2 id="be-sz-h">Kezelések</h2><p>Ezeket lehet foglalni. Az időtartam percben, 5 perces lépésben. A szünet a következő vendégig tart (takarítás, átöltözés).</p></div><div class="rows">';
    t.szolgaltatasok.forEach(function (s, i) {
      html += '<div class="erow" data-szi="' + i + '"><div class="erow__main">' +
        '<div class="field erow__nev"><label for="sz-n-' + i + '">Név</label><input id="sz-n-' + i + '" data-sz="nev" value="' + esc(s.nev) + '" maxlength="120"></div>' +
        '<div class="field erow__num"><label for="sz-p-' + i + '">Időtartam</label><div class="unit"><input id="sz-p-' + i + '" data-sz="perc" type="number" inputmode="numeric" min="10" max="480" step="5" value="' + esc(s.perc) + '"><span>perc</span></div></div>' +
        '<div class="field erow__num"><label for="sz-a-' + i + '">Ár</label><div class="unit"><input id="sz-a-' + i + '" data-sz="ar" type="number" inputmode="numeric" min="0" step="500" value="' + esc(s.ar == null ? '' : s.ar) + '"><span>Ft</span></div></div>' +
        '<div class="field erow__num"><label for="sz-u-' + i + '">Szünet utána</label><div class="unit"><input id="sz-u-' + i + '" data-sz="puffer" type="number" inputmode="numeric" min="0" max="120" step="5" value="' + esc(s.puffer == null ? 10 : s.puffer) + '"><span>perc</span></div></div>' +
        '</div><div class="erow__sub"><span class="erow__lbl">Helyszín</span>' + t.helyszinek.map(function (h) { return chk('szh', h.id, s.helyszinek.indexOf(h.id) >= 0, h.nev); }).join('') +
        '<button type="button" class="linkbtn linkbtn--danger erow__del" data-szdel="' + i + '">Kezelés törlése</button></div></div>';
    });
    html += '</div><button type="button" class="btn btn--ghost be-add" id="be-add-sz">Új kezelés</button></section>';
    // szakemberek + összerendelés
    html += '<section class="be-sec" aria-labelledby="be-k-h"><div class="be-sec__head"><h2 id="be-k-h">Szakemberek</h2><p>Kinek melyik kezelést lehet foglalni. Csak a szakember helyszínén végzett kezelések jelennek meg a foglalóban.</p></div><div class="rows">';
    t.kollegak.forEach(function (k, i) {
      html += '<div class="erow" data-ki="' + i + '"><div class="erow__main erow__main--k">' +
        '<div class="field erow__nev"><label for="k-n-' + i + '">Név</label><input id="k-n-' + i + '" data-k="nev" value="' + esc(k.nev) + '" maxlength="100"></div>' +
        '<div class="field erow__nev"><label for="k-s-' + i + '">Szerep</label><input id="k-s-' + i + '" data-k="szerep" value="' + esc(k.szerep || '') + '" maxlength="200"></div>' +
        '</div><div class="erow__sub"><span class="erow__lbl">Helyszín</span>' + t.helyszinek.map(function (h) { return chk('kh', h.id, k.helyszinek.indexOf(h.id) >= 0, h.nev); }).join('') + '</div>' +
        '<fieldset class="erow__assign"><legend>Kezelések</legend>' + t.helyszinek.filter(function (h) { return k.helyszinek.indexOf(h.id) >= 0; }).map(function (h) {
          var sl = t.szolgaltatasok.filter(function (s) { return s.helyszinek.indexOf(h.id) >= 0; });
          return '<div class="assign"><span class="assign__h">' + esc(h.nev) + '</span>' + sl.map(function (s) { return chk('ks', s.id, k.szolgaltatasok.indexOf(s.id) >= 0, s.nev + ' ' + s.perc + "'"); }).join('') + '</div>';
        }).join('') + '</fieldset>' +
        '<div class="erow__sub erow__sub--end"><button type="button" class="linkbtn linkbtn--danger erow__del" data-kdel="' + i + '">Szakember törlése</button></div></div>';
    });
    html += '</div><button type="button" class="btn btn--ghost be-add" id="be-add-k">Új szakember</button></section>';
    // helyszínek
    html += '<section class="be-sec" aria-labelledby="be-h-h"><div class="be-sec__head"><h2 id="be-h-h">Helyszínek</h2><p>A nyitvatartáson kívül akkor sem lehet foglalni, ha a szakember be van osztva.</p></div><div class="rows">';
    t.helyszinek.forEach(function (h, i) {
      html += '<div class="erow" data-hi="' + i + '"><div class="erow__main erow__main--h">' +
        '<div class="field erow__nev"><label for="h-n-' + i + '">Név</label><input id="h-n-' + i + '" data-h="nev" value="' + esc(h.nev) + '" maxlength="100"></div>' +
        '<div class="field erow__nev"><label for="h-c-' + i + '">Cím</label><input id="h-c-' + i + '" data-h="cim" value="' + esc(h.cim) + '" maxlength="200"></div>' +
        '<div class="field erow__num"><label for="h-ny-' + i + '">Nyitás</label><select id="h-ny-' + i + '" data-h="nyit">' + IDO.map(function (x) { return '<option' + (x === h.nyit ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>' +
        '<div class="field erow__num"><label for="h-z-' + i + '">Zárás</label><select id="h-z-' + i + '" data-h="zar">' + IDO.map(function (x) { return '<option' + (x === h.zar ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>' +
        '</div></div>';
    });
    html += '</div></section>';
    // szabályok
    var sz = t.szabalyok || {};
    html += '<section class="be-sec" aria-labelledby="be-r-h"><div class="be-sec__head"><h2 id="be-r-h">Szabályok</h2><p>Mennyivel előre lehet foglalni, meddig lehet online lemondani, és hova menjen a stúdió értesítője.</p></div>' +
      '<div class="rules">' +
      '<div class="field"><label for="r-min">Legkorábban ennyivel előre</label><div class="unit"><input id="r-min" data-r="minEloreOra" type="number" min="0" max="168" value="' + esc(sz.minEloreOra) + '"><span>óra</span></div></div>' +
      '<div class="field"><label for="r-max">Legfeljebb ennyivel előre</label><div class="unit"><input id="r-max" data-r="maxEloreNap" type="number" min="1" max="366" value="' + esc(sz.maxEloreNap) + '"><span>nap</span></div></div>' +
      '<div class="field"><label for="r-lem">Online lemondás a kezdés előtt eddig</label><div class="unit"><input id="r-lem" data-r="lemondasOra" type="number" min="0" max="168" value="' + esc(sz.lemondasOra) + '"><span>óra</span></div></div>' +
      '<div class="field"><label for="r-tel">Telefonszám a vendégeknek</label><input id="r-tel" data-r="telefon" type="tel" maxlength="30" value="' + esc(sz.telefon || '') + '"></div>' +
      '<div class="field"><label for="r-em">A stúdió értesítője ide megy</label><input id="r-em" data-r="studioEmail" type="email" maxlength="254" value="' + esc(sz.studioEmail || '') + '"></div>' +
      '</div></section>';
    html += '<div class="savebar savebar--page' + (be.dirty ? ' is-dirty' : '') + '" id="be-savebar"><p id="be-state" aria-live="polite">' + (be.dirty ? 'Mentetlen változás' : 'Minden mentve') + '</p>' +
      '<button type="button" class="btn btn--ghost" id="be-reset"' + (be.dirty ? '' : ' disabled') + '>Elvetés</button>' +
      '<button type="submit" class="btn btn--primary" id="be-save"' + (be.dirty ? '' : ' disabled') + '>Beállítások mentése</button></div>';
    if (t.minta) html = '<p class="note">Mintaadatok: a kezelések, a szakemberek és az összerendelés most kitalált példák. Itt írhatjátok át a valódira, a mentés után a foglaló azonnal ezeket használja.</p>' + html;
    $('#be-form').innerHTML = html;
  }
  function beChanged() {
    be.dirty = true;
    $('#be-state').textContent = 'Mentetlen változás';
    $('#be-save').disabled = false; $('#be-reset').disabled = false;
    $('#be-savebar').classList.add('is-dirty');
  }
  function beInput(e) {
    var el = e.target, t = be.t, row;
    if ((row = el.closest('[data-szi]'))) {
      var s = t.szolgaltatasok[+row.getAttribute('data-szi')];
      if (el.dataset.sz) { var v = el.value; s[el.dataset.sz] = el.dataset.sz === 'nev' ? v : (v === '' ? (el.dataset.sz === 'ar' ? null : NaN) : Number(v)); }
      if (el.dataset.szh) toggleIn(s.helyszinek, el.dataset.szh, el.checked);
    } else if ((row = el.closest('[data-ki]'))) {
      var k = t.kollegak[+row.getAttribute('data-ki')];
      if (el.dataset.k) k[el.dataset.k] = el.value;
      if (el.dataset.kh) { toggleIn(k.helyszinek, el.dataset.kh, el.checked); if (e.type === 'change') { beChanged(); renderBe(); return; } }
      if (el.dataset.ks) toggleIn(k.szolgaltatasok, el.dataset.ks, el.checked);
    } else if ((row = el.closest('[data-hi]'))) {
      t.helyszinek[+row.getAttribute('data-hi')][el.dataset.h] = el.value;
    } else if (el.dataset.r) {
      t.szabalyok[el.dataset.r] = el.type === 'number' ? (el.value === '' ? NaN : Number(el.value)) : el.value;
    } else return;
    beChanged();
  }
  function toggleIn(arr, v, on) { var i = arr.indexOf(v); if (on && i < 0) arr.push(v); if (!on && i >= 0) arr.splice(i, 1); }
  function beValid() {
    var t = be.t;
    for (var i = 0; i < t.szolgaltatasok.length; i++) {
      var s = t.szolgaltatasok[i], n = s.nev || (i + 1) + '. kezelés';
      if (!String(s.nev || '').trim()) return 'Minden kezelésnek adj nevet.';
      if (!Number.isInteger(s.perc) || s.perc < 10 || s.perc > 480 || s.perc % 5) return n + ': az időtartam 10 és 480 perc között, 5 perces lépésben lehet.';
      if (s.ar != null && (!Number.isInteger(s.ar) || s.ar < 0)) return n + ': az ár egész szám legyen.';
      if (!Number.isInteger(s.puffer) || s.puffer < 0 || s.puffer > 120) return n + ': a szünet 0 és 120 perc között lehet.';
      if (!s.helyszinek.length) return n + ': jelöld be, melyik helyszínen van.';
    }
    for (var j = 0; j < t.kollegak.length; j++) {
      var k = t.kollegak[j];
      if (!String(k.nev || '').trim()) return 'Minden szakembernek adj nevet.';
      if (!k.helyszinek.length) return k.nev + ': jelöld be, melyik helyszínen dolgozik.';
    }
    for (var h = 0; h < t.helyszinek.length; h++) if (F.perc(t.helyszinek[h].nyit) >= F.perc(t.helyszinek[h].zar)) return t.helyszinek[h].nev + ': a zárás legyen későbbi a nyitásnál.';
    var sz = t.szabalyok;
    if (!Number.isInteger(sz.minEloreOra) || !Number.isInteger(sz.maxEloreNap) || !Number.isInteger(sz.lemondasOra)) return 'A szabályoknál minden szám legyen kitöltve.';
    return '';
  }
  function saveBe(ev) {
    ev.preventDefault();
    var msg = beValid();
    if (msg) { toast(msg, 'error'); return; }
    // a szakember csak a saját helyszínén végzett kezelést kaphatja
    be.t.kollegak.forEach(function (k) {
      k.szolgaltatasok = k.szolgaltatasok.filter(function (sid) { var s = be.t.szolgaltatasok.filter(function (x) { return x.id === sid; })[0]; return s && s.helyszinek.some(function (h) { return k.helyszinek.indexOf(h) >= 0; }); });
    });
    // új elem: az azonosító a névből (kisbetű, szám, kötőjel), a régiek azonosítója nem változik
    ['szolgaltatasok', 'kollegak'].forEach(function (lista) {
      be.t[lista].forEach(function (x) {
        if (!x._uj) return;
        var regi = x.id, tobbi = be.t[lista].filter(function (y) { return y !== x; });
        x.id = ujId(x.nev, tobbi); delete x._uj;
        if (lista === 'szolgaltatasok') be.t.kollegak.forEach(function (k) { var i = k.szolgaltatasok.indexOf(regi); if (i >= 0) k.szolgaltatasok[i] = x.id; });
      });
    });
    var b = $('#be-save'); b.disabled = true; b.textContent = 'Mentés folyamatban';
    api('/beallitasok', { method: 'PUT', json: be.t }).then(function (t) {
      torzs = t; torzsP = Promise.resolve(t); be.t = JSON.parse(JSON.stringify(t)); be.dirty = false; renderBe();
      toast('A beállítások mentve, a foglaló már ezeket használja.');
    }).catch(function (e) { b.disabled = false; b.textContent = 'Beállítások mentése'; toast(e.message, 'error'); });
  }

  /* =====================================================================
     4. LEVELEK
     ===================================================================== */
  var le = { list: [], sel: null };
  var TIPUS = { visszaigazolas: 'Visszaigazolás a vendégnek', 'studio-ertesito': 'Értesítő a stúdiónak', lemondas: 'Lemondás a vendégnek' };
  function openLevelek(sub) {
    document.title = 'Levelek · Admin · Studio F360';
    var ul = $('#le-list');
    ul.innerHTML = '<li class="row-skel"></li><li class="row-skel"></li>';
    api('/outbox').then(function (r) {
      le.list = (r && r.levelek) || [];
      if (!le.list.length) { ul.innerHTML = '<li class="empty-inline">Még nem készült levél. Az első foglalás után itt jelenik meg.</li>'; $('#le-prev').innerHTML = ''; return; }
      var id = sub && le.list.some(function (l) { return String(l.id) === sub; }) ? sub : String(le.list[0].id);
      renderLeList(id);
      showLevel(id, false);
    }).catch(function (e) { hibaDoboz($('#le-prev'), e, function () { openLevelek(sub); }); ul.innerHTML = ''; });
  }
  function renderLeList(id) {
    $('#le-list').innerHTML = le.list.map(function (l) {
      var d = new Date(l.letrehozva);
      return '<li><a class="le-item' + (String(l.id) === id ? ' is-on' : '') + '" href="#/levelek/' + esc(l.id) + '"' + (String(l.id) === id ? ' aria-current="true"' : '') + '>' +
        '<span class="le-item__k" data-t="' + esc(l.tipus) + '">' + esc(TIPUS[l.tipus] || l.tipus) + '</span>' +
        '<span class="le-item__s">' + esc(l.targy) + '</span>' +
        '<span class="le-item__m">' + esc(l.cimzett) + ' · ' + esc(d.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</span></a></li>';
    }).join('');
  }
  function showLevel(id, fromClick) {
    var l = le.list.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!l) return;
    renderLeList(String(id));
    var box = $('#le-prev');
    box.innerHTML = '<div class="le-card"><dl class="le-meta"><div><dt>Címzett</dt><dd>' + esc(l.cimzett) + '</dd></div><div><dt>Tárgy</dt><dd>' + esc(l.targy) + '</dd></div>' +
      '<div><dt>Állapot</dt><dd>' + (l.elkuldve ? 'Elküldve' : 'Nem ment ki (bemutató)') + (l.ics ? ' · naptárfájl csatolva' : '') + '</dd></div></dl>' +
      '<div class="seg seg--sm" role="group" aria-label="Levél nézete"><button type="button" class="seg__b" data-lv="html" aria-pressed="true">Ahogy a vendég látja</button><button type="button" class="seg__b" data-lv="txt" aria-pressed="false">Szöveges változat</button></div>' +
      '<iframe class="le-frame" id="le-frame" title="Levél előnézete: ' + esc(l.targy) + '" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>' +
      '<pre class="le-txt" id="le-txt" hidden></pre></div>';
    $('#le-frame').srcdoc = String(l.html || '').replace(/<head>/i, '<head><base target="_blank">');
    $('#le-txt').textContent = l.szoveg || '';
    if (fromClick && narrow.matches) box.scrollIntoView({ block: 'start' });
  }

  /* =====================================================================
     ESEMÉNYEK
     ===================================================================== */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var v = t.closest('#view-foglalasok [data-nezet]');
    if (v) { fg.nezet = v.getAttribute('data-nezet'); location.hash = fgHash(); return; }
    var pk = t.closest('[data-pkoll]');
    if (pk) {
      var pid = pk.getAttribute('data-pkoll');
      fg.koll = fg.koll === pid ? '' : pid;
      $('#fg-koll').value = fg.koll;
      fillFgFilters(); renderFg();
      var again = $('[data-pkoll="' + pid + '"]'); if (again) again.focus();
      return;
    }
    var it = t.closest('#fg-board [data-az]');
    if (it) { openDetail(it.getAttribute('data-az')); return; }
    if (t.closest('#fg-prev')) return fgMozgat(-1);
    if (t.closest('#fg-next')) return fgMozgat(1);
    if (t.closest('#fg-today')) { fg.datum = F.most().datum; location.hash = fgHash(); return; }
    if (t.closest('#fg-new')) return openNew();
    if (t.closest('#n-cancel')) return $('#dlg-new').close();
    if (t.closest('#mv-cancel')) return $('#dlg-move').close();
    // beosztás
    var add = t.closest('[data-add]');
    if (add) {
      var n = +add.getAttribute('data-add'), k = koll(bo.kid);
      var napi = bo.sorok.filter(function (s) { return s.nap === n; }).sort(function (a, b) { return F.perc(a.veg) - F.perc(b.veg); });
      var last = napi[napi.length - 1];
      var kezd = last ? F.hm2(Math.min(F.perc(last.veg) + 60, 20 * 60)) : '09:00';
      var veg = F.hm2(Math.min(F.perc(kezd) + 4 * 60, 22 * 60));
      bo.sorok.push({ nap: n, helyszin: last ? last.helyszin : k.helyszinek[0], kezd: kezd, veg: veg });
      boChanged(); renderBo();
      var sel = $$('.wkrow')[n - 1].querySelectorAll('select[data-f="kezd"]');
      if (sel.length) sel[sel.length - 1].focus();
      return;
    }
    var del = t.closest('[data-del]');
    if (del) { var di = +del.getAttribute('data-del'), dn = bo.sorok[di].nap; bo.sorok.splice(di, 1); boChanged(); renderBo(); var ab = $('[data-add="' + dn + '"]'); if (ab) ab.focus(); return; }
    if (t.closest('#bo-copy')) {
      var hetfo = bo.sorok.filter(function (s) { return s.nap === 1; });
      if (!hetfo.length) { toast('Hétfőn nincs sáv, amit másolni lehetne.', 'error'); return; }
      bo.sorok = bo.sorok.filter(function (s) { return s.nap === 1 || s.nap > 5; });
      [2, 3, 4, 5].forEach(function (n) { hetfo.forEach(function (s) { bo.sorok.push({ nap: n, helyszin: s.helyszin, kezd: s.kezd, veg: s.veg }); }); });
      boChanged(); renderBo(); toast('A hétfői sávok bemásolva keddtől péntekig. Mentsd el, ha jó.');
      return;
    }
    if (t.closest('#bo-save')) return saveBo();
    if (t.closest('#bo-reset')) return loadBo();
    var exd = t.closest('[data-exdel]');
    if (exd) {
      var id = exd.getAttribute('data-exdel');
      confirmDlg('Törlöd?', 'A ' + exd.getAttribute('aria-label').replace(/^Törlés: /, '') + ' kivétel törlése után ebben az időben újra lehet foglalni.', 'Törlés').then(function (ok) {
        if (!ok) return;
        api('/kivetelek?id=' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { return api('/kivetelek?tol=' + F.most().datum); })
          .then(function (r) { bo.kivetelek = r.kivetelek || []; var keep = bo.dirty; renderBo(); if (keep) boChanged(); toast('Törölve.'); })
          .catch(function (e2) { toast(e2.message, 'error'); });
      });
      return;
    }
    // beállítások
    if (t.closest('#be-add-sz')) {
      var s = { id: ujId('uj kezeles', be.t.szolgaltatasok), nev: '', perc: 50, ar: null, puffer: 10, helyszinek: [be.t.helyszinek[0].id], _uj: true };
      be.t.szolgaltatasok.push(s); beChanged(); renderBe();
      $('#sz-n-' + (be.t.szolgaltatasok.length - 1)).focus();
      return;
    }
    if (t.closest('#be-add-k')) {
      be.t.kollegak.push({ id: ujId('uj szakember', be.t.kollegak), nev: '', szerep: '', helyszinek: [be.t.helyszinek[0].id], szolgaltatasok: [], _uj: true });
      beChanged(); renderBe();
      $('#k-n-' + (be.t.kollegak.length - 1)).focus();
      return;
    }
    var szd = t.closest('[data-szdel]');
    if (szd) {
      var si = +szd.getAttribute('data-szdel'), sv = be.t.szolgaltatasok[si];
      confirmDlg('Törlöd a kezelést?', '„' + (sv.nev || 'Névtelen kezelés') + '” lekerül a foglalóról. A már meglévő foglalások megmaradnak. A mentéssel lesz végleges.', 'Törlés').then(function (ok) {
        if (!ok) return;
        be.t.szolgaltatasok.splice(si, 1);
        be.t.kollegak.forEach(function (k) { toggleIn(k.szolgaltatasok, sv.id, false); });
        beChanged(); renderBe();
      });
      return;
    }
    var kd = t.closest('[data-kdel]');
    if (kd) {
      var ki = +kd.getAttribute('data-kdel'), kv = be.t.kollegak[ki];
      confirmDlg('Törlöd a szakembert?', (kv.nev || 'Névtelen szakember') + ' lekerül a foglalóról. A már meglévő foglalásai megmaradnak. A mentéssel lesz végleges.', 'Törlés').then(function (ok) {
        if (!ok) return;
        be.t.kollegak.splice(ki, 1); beChanged(); renderBe();
      });
      return;
    }
    if (t.closest('#be-reset')) { be.dirty = false; be.t = null; return openBeallitasok(); }
    // levelek
    var lv = t.closest('[data-lv]');
    if (lv) {
      var txt = lv.getAttribute('data-lv') === 'txt';
      $$('[data-lv]').forEach(function (b) { b.setAttribute('aria-pressed', b === lv ? 'true' : 'false'); });
      $('#le-frame').hidden = txt; $('#le-txt').hidden = !txt;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'fg-hely') { fg.hely = t.value; fillFgFilters(); renderFg(); return; }
    if (t.id === 'fg-koll') { fg.koll = t.value; fillFgFilters(); renderFg(); return; }
    if (t.matches('.kc-pick input[name="kc"]')) return szinMent(t.value);
    if (t.id === 'kc-own') return szinMent(t.value);
    if (t.id === 'fg-date' && t.value) { fg.datum = t.value; location.hash = fgHash(); return; }
    if (t.id === 'n-hely') return newFill('hely');
    if (t.id === 'n-szolg') return newFill('szolg');
    if (t.id === 'n-koll' || t.id === 'n-datum') return newSlots();
    if (t.id === 'mv-koll' || t.id === 'mv-datum') { $('#mv-err').hidden = true; return moveSlots(); }
    if (t.matches('#bo-main select[data-f]')) {
      var s = bo.sorok[+t.getAttribute('data-i')]; s[t.getAttribute('data-f')] = t.value; boChanged();
      var msg = boValid(); if (msg) toast(msg, 'error');
      var row = t.closest('.wkrow'); $('.wkrow__bar', row).innerHTML = barHtml(bo.sorok.filter(function (x) { return x.nap === s.nap; }));
      return;
    }
    if (t.id === 'ex-egesz') { $$('.ex-ido').forEach(function (x) { x.hidden = t.checked; }); return; }
    if (t.id === 'ex-tol' && $('#ex-ig').value < t.value) { $('#ex-ig').value = t.value; return; }
    if (t.closest('#be-form')) beInput(e);
  });
  document.addEventListener('input', function (e) { if (e.target.closest('#be-form') && e.target.matches('input:not([type=checkbox])')) beInput(e); });
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'new-form') return submitNew(e);
    if (e.target.id === 'move-form') return submitMove(e);
    if (e.target.id === 'ex-form') return submitEx(e);
    if (e.target.id === 'be-form') return saveBe(e);
  });
  narrow.addEventListener('change', function () { if (document.body.dataset.view === 'view-foglalasok' && fg.nezet === 'nap') renderNap($('#fg-board')); });
  window.addEventListener('beforeunload', function (e) { if (bo.dirty || be.dirty) { e.preventDefault(); e.returnValue = ''; } });

  window.F360AdminFoglalo = {
    open: function (tab, sub) {
      if (tab !== 'beosztas' && bo.dirty && !confirm('A beosztásban mentetlen változás van. Elveted?')) { location.hash = '#/beosztas/' + bo.kid; return; }
      if (tab !== 'beosztas') bo.dirty = false;
      if (tab === 'foglalasok') return openFoglalasok(sub);
      if (tab === 'beosztas') { if (sub && sub !== bo.kid && bo.dirty && !confirm('A beosztásban mentetlen változás van. Elveted?')) { location.hash = '#/beosztas/' + bo.kid; return; } return openBeosztas(sub); }
      if (tab === 'beallitasok') return openBeallitasok();
      if (tab === 'levelek') return sub ? (le.list.length ? showLevel(sub, true) : openLevelek(sub)) : openLevelek('');
    }
  };
})();
