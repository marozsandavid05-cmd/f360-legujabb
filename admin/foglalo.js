/* =====================================================================
   STUDIO F360 · ADMIN · foglalo.js  (az időpontfoglaló négy füle)
   Foglalások (nap- és hétnézet, szűrők, kézi felvétel, lemondás), Beosztás
   (heti minta kollégánként + szabadság és zárva tartás), Beállítások
   (kezelések, helyszínek, szabályok, értesítések), Levelek (outbox-előnézet,
   szűrés, emlékeztetők kézi indítása), Kollégák (felvétel, adatlap, mettől
   meddig foglalható, fotó, archiválás), Órarend (csoportos órák), Kampányok (forrás-riport).
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
  // foglalható-e a kolléga ezen a napon (a backend aktivANapon-ja): archivált, belépés előtt, kilépés után nem
  function aktivNapon(k, d) { return !k.archivalt && !(k.aktiv_tol && d < k.aktiv_tol) && !(k.aktiv_ig && d > k.aktiv_ig); }
  function nemArchiv(k) { return !k.archivalt; }
  function monogram(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(-2).map(function (w) { return w.charAt(0); }).join('').toUpperCase(); }
  function rovidNev(n) { var p = String(n || '').split(/\s+/); return p.length > 1 ? p[p.length - 1] + ' ' + p[0].charAt(0) + '.' : n; }
  // dátum toldalékkal, szóközös kötőjel helyett (az gondolatjelnek hat): „október 7-étől”, „december 16-áig”, „október 1-jéig”
  function napRag(iso, mi) {
    var alap = F.honapNapRagos(iso).replace(/n$/, ''); // „október 7-é”, „december 16-á”, „október 1-jé”
    return mi === 'ig' ? alap + 'ig' : alap + (/á$/.test(alap) ? 'tól' : 'től');
  }
  // időszak: egy hónapon belül „október 5-11.”, hónapokon át „szeptember 28-ától október 4-éig”
  function tartomany(tol, ig) {
    if (tol === ig) return F.honapNap(tol);
    if (tol.slice(0, 7) === ig.slice(0, 7)) return F.HONAPOK[Number(tol.slice(5, 7)) - 1] + ' ' + Number(tol.slice(8)) + '-' + Number(ig.slice(8)) + '.';
    return napRag(tol, 'tol') + ' ' + napRag(ig, 'ig');
  }
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
  var fg = { nezet: 'nap', datum: F.most().datum, hely: '', koll: '', lista: [], beosztas: [], kivetelek: [], orak: [] };
  var NINCS_OKTATO = '__nincs';
  var fgReq = 0;

  function fgRange() {
    if (fg.nezet === 'nap') return { tol: fg.datum, ig: fg.datum };
    var h = F.hetfo(fg.datum);
    return { tol: h, ig: F.addDays(h, 6) };
  }
  function fgHash() { return '#/foglalasok/' + fg.nezet + '/' + fg.datum; }
  function openFoglalasok(sub) {
    var al = /^allando(?:\/(R[0-9A-Z]{10}))?$/.exec(sub || '');
    if (al) return openAllando(al[1] || '');
    if ($('#dlg-sr').open) $('#dlg-sr').close();
    fgMode('naptar');
    srSzamlalo();
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
    var kl = torzs.kollegak.filter(function (k) { return (!k.archivalt || k.id === fg.koll) && (!fg.hely || k.helyszinek.indexOf(fg.hely) >= 0); });
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
    // az Állandó időpontok nézetben a naptár nem frissül (a fejléc-összegzést az a nézet írja)
    if ($('#fg-naptar').hidden) return;
    var r = fgRange(), req = ++fgReq, board = $('#fg-board');
    $$('.seg__b').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-nezet') === fg.nezet ? 'true' : 'false'); });
    $('#fg-prev').setAttribute('aria-label', fg.nezet === 'nap' ? 'Előző nap' : 'Előző hét');
    $('#fg-next').setAttribute('aria-label', fg.nezet === 'nap' ? 'Következő nap' : 'Következő hét');
    $('#fg-date').value = fg.datum;
    var ma = F.most().datum;
    $('#fg-label').textContent = fg.nezet === 'nap'
      ? F.datumHosszu(fg.datum).replace(/(\d+\. )([a-zá-ű]+)/, '$1$2') + (fg.datum === ma ? ' · ma' : '')
      : r.tol.slice(0, 4) + '. ' + tartomany(r.tol, r.ig);
    $('#fg-today').disabled = fg.datum === ma && fg.nezet === 'nap';
    board.setAttribute('aria-busy', 'true');
    if (!board.children.length) board.innerHTML = '<div class="skel-board"></div>';
    var q = '?tol=' + r.tol + '&ig=' + r.ig + (fg.hely ? '&helyszin=' + encodeURIComponent(fg.hely) : '') + (fg.koll ? '&kollega=' + encodeURIComponent(fg.koll) : '');
    Promise.all([
      api('/foglalasok' + q),
      api('/beosztas'),
      api('/kivetelek?tol=' + r.tol + '&ig=' + r.ig),
      // a csoportos órák (blokként, a kitöltöttséggel); ha a végpont hibázik, a naptár ettől még megy
      api('/orak?tol=' + r.tol + '&ig=' + r.ig + (fg.hely ? '&helyszin=' + encodeURIComponent(fg.hely) : '')).catch(function () { return { orak: [] }; })
    ]).then(function (res) {
      if (req !== fgReq) return;
      fg.lista = (res[0] && res[0].foglalasok) || [];
      fg.beosztas = (res[1] && res[1].kollegak) || [];
      fg.kivetelek = (res[2] && res[2].kivetelek) || [];
      fg.orak = ((res[3] && res[3].orak) || []).filter(function (o) { return !fg.koll || (o.kollega && o.kollega.id === fg.koll); });
      board.setAttribute('aria-busy', 'false');
      var aktiv = fg.lista.filter(function (b) { return b.allapot !== 'lemondva'; }).length, lem = fg.lista.length - aktiv;
      var oszam = fg.orak.filter(function (o) { return o.status !== 'elmarad'; }).length, ofo = fg.orak.reduce(function (n, o) { return n + (o.status !== 'elmarad' ? o.foglalt || 0 : 0); }, 0);
      $('#fg-sum').textContent = aktiv + ' foglalás' + (lem ? ' · ' + lem + ' lemondva' : '') + (oszam ? ' · ' + oszam + ' csoportos óra, ' + ofo + ' jelentkező' : '') + (fg.nezet === 'nap' ? ' ezen a napon' : ' ezen a héten');
      if (fg.nezet === 'nap') renderNap(board); else renderHet(board);
    }).catch(function (e) { if (req === fgReq) hibaDoboz(board, e, renderFg); });
  }
  function lathatoKollegak(datum) {
    var nap = F.hetNapja(datum) || 7;
    return torzs.kollegak.filter(function (k) {
      if (fg.koll) return k.id === fg.koll;
      if (fg.hely && k.helyszinek.indexOf(fg.hely) < 0) return false;
      var b = fg.beosztas.filter(function (x) { return x.id === k.id; })[0];
      var dolgozik = aktivNapon(k, datum) && b && b.sorok.some(function (s) { return s.nap === nap && (!fg.hely || s.helyszin === fg.hely); });
      var vanFoglalas = fg.lista.some(function (x) { return x.kollega.id === k.id && x.datum === datum; });
      var vanOra = fg.orak.some(function (o) { return o.kollega && o.kollega.id === k.id && o.datum === datum; });
      return dolgozik || vanFoglalas || vanOra;
    }).concat(fg.orak.some(function (o) { return !o.kollega && o.datum === datum; }) && !fg.koll ? [{ id: NINCS_OKTATO, nev: 'Oktató nélkül', szerep: 'csoportos óra', helyszinek: [], szolgaltatasok: [] }] : []);
  }
  function orakNapon(kid, d) { return fg.orak.filter(function (o) { return o.datum === d && (kid === NINCS_OKTATO ? !o.kollega : o.kollega && o.kollega.id === kid); }); }
  // csoportos óra blokkja: az oktató színével, a kitöltöttség számmal és pöttysorral (tele pötty = foglalt hely)
  function oraPottyok(o) {
    if (o.kapacitas > 16) return '';
    var out = ''; for (var i = 0; i < o.kapacitas; i++) out += '<i' + (i < o.foglalt ? ' class="is-f"' : '') + '></i>';
    return '<span class="oc-dots" aria-hidden="true">' + out + '</span>';
  }
  function oraBlokk(o, extraCls) {
    var el = o.status === 'elmarad', tele = !el && o.foglalt >= o.kapacitas;
    var k = o.kollega || { id: '', nev: 'nincs oktató' };
    var cimke = o.kezd + '-' + o.veg + ', ' + o.ora.nev + ', csoportos óra, ' + o.foglalt + ' / ' + o.kapacitas + ' hely foglalt' + (el ? ', elmarad' : tele ? ', betelt' : '') + ', ' + (o.kollega ? o.kollega.nev : 'nincs oktató');
    return '<button type="button" class="oc-item' + (el ? ' is-el' : '') + (tele ? ' is-full' : '') + (extraCls ? ' ' + extraCls : '') + '" data-ora="' + esc(o.id) + '"' + (o.kollega ? kcStyle(k) : '') +
      ' title="' + esc(cimke) + '" aria-label="' + esc(cimke) + '">' +
      '<span class="oc-item__t">' + esc(o.kezd) + '<span>-' + esc(o.veg) + '</span></span>' +
      '<span class="oc-item__n">' + esc(o.ora.nev) + '</span>' +
      '<span class="oc-item__f"><b>' + o.foglalt + '/' + o.kapacitas + '</b>' + (el ? '<span>elmarad</span>' : tele ? '<span>betelt</span>' : oraPottyok(o)) + '</span>' +
    '</button>';
  }
  function kiesesek(kid, datum) {
    return fg.kivetelek.filter(function (k) {
      return datum >= k.tol && datum <= k.ig && (k.kollega === kid || (!k.kollega && k.helyszin));
    });
  }
  function foglBlokk(b, extraCls) {
    var lem = b.allapot === 'lemondva';
    return '<button type="button" title="' + esc(b.kezd + '-' + b.veg + ' · ' + b.nev + ' · ' + b.szolgaltatas.nev + ' · ' + b.kollega.nev + ', ' + b.helyszin.nev) + '" class="bk-item' + (lem ? ' is-cx' : '') + (extraCls ? ' ' + extraCls : '') + '" data-az="' + esc(b.azonosito) + '"' + kcStyle(b.kollega) + ' ' +
      'aria-label="' + esc(b.kezd + '-' + b.veg + ', ' + b.nev + ', ' + b.szolgaltatas.nev + ', ' + b.kollega.nev + ', ' + b.helyszin.nev + (b.sorozat ? ', állandó időpont' : '') + (lem ? ', lemondva' : '')) + '">' +
      '<span class="bk-item__t">' + esc(b.kezd) + '<span>-' + esc(b.veg) + '</span>' + (b.sorozat ? ISM_IKON : '') + '</span>' +
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
      html += '<div class="day__head" style="grid-column:' + (i + 2) + '"><span class="av" aria-hidden="true">' + esc(k.id === NINCS_OKTATO ? '?' : monogram(k.nev)) + '</span><span><b>' + esc(k.nev) + '</b><small>' + esc(k.szerep || '') + '</small></span></div>';
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
      orakNapon(k.id, d).forEach(function (o) {
        var a = Math.max(F.perc(o.kezd), tol), e = Math.min(F.perc(o.veg), ig);
        html += '<div class="day__slot" style="grid-column:' + col + ';grid-row:' + row(a) + ' / ' + row(Math.max(e, a + 30)) + '">' + oraBlokk(o) + '</div>';
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
      '<li><span class="lg lg--cx" aria-hidden="true"></span>Lemondott foglalás</li>' +
      '<li><span class="lg lg--ism" aria-hidden="true">' + ISM_IKON + '</span>Állandó időpont</li>' +
      '<li><span class="lg lg--oc" aria-hidden="true"></span>Csoportos óra, foglalt / összes hely</li></ul>';
  }
  // keskeny képernyőn: időrendi lista szakemberenként
  function agenda(d, kl) {
    return '<div class="agenda">' + kl.map(function (k) {
      var list = fg.lista.filter(function (b) { return b.kollega.id === k.id && b.datum === d; });
      var ol = orakNapon(k.id, d);
      var off = kiesesek(k.id, d);
      var elemek = list.map(function (b) { return { p: F.perc(b.kezd), h: foglBlokk(b, 'bk-item--row') }; })
        .concat(ol.map(function (o) { return { p: F.perc(o.kezd), h: oraBlokk(o, 'oc-item--row') }; })).sort(function (a, b) { return a.p - b.p; });
      var n = list.filter(function (b) { return b.allapot !== 'lemondva'; }).length;
      return '<section class="agenda__p"><h2 class="agenda__h"><span class="av" aria-hidden="true">' + esc(k.id === NINCS_OKTATO ? '?' : monogram(k.nev)) + '</span>' + esc(k.nev) + '<small>' +
        [n ? n + ' foglalás' : '', ol.length ? ol.length + ' csoportos óra' : ''].filter(Boolean).join(', ') + (n || ol.length ? '' : 'nincs foglalás') + '</small></h2>' +
        off.map(function (x) { return '<p class="agenda__off">' + esc((x.kezd ? x.kezd + '-' + x.veg + ' · ' : 'Egész nap · ') + (x.megjegyzes || (x.kollega ? 'Szabadság' : 'Zárva'))) + '</p>'; }).join('') +
        (elemek.length ? elemek.map(function (x) { return x.h; }).join('') : '<p class="agenda__none">Nincs foglalás.</p>') + '</section>';
    }).join('') + '</div>';
  }
  function renderHet(board) {
    var r = fgRange(), ma = F.most().datum, html = '<div class="week">';
    for (var i = 0; i < 7; i++) {
      var d = F.addDays(r.tol, i);
      var list = fg.lista.filter(function (b) { return b.datum === d; });
      var ol = fg.orak.filter(function (o) { return o.datum === d; });
      var aktiv = list.filter(function (b) { return b.allapot !== 'lemondva'; }).length;
      var zar = fg.kivetelek.filter(function (k) { return !k.kollega && d >= k.tol && d <= k.ig && (!fg.hely || k.helyszin === fg.hely) && !k.kezd; });
      html += '<section class="week__d' + (d === ma ? ' is-today' : '') + '" aria-label="' + esc(F.datumNap(d)) + '">' +
        '<a class="week__h" href="#/foglalasok/nap/' + d + '"><span>' + NAP_HOSSZU[(F.hetNapja(d) + 6) % 7] + '</span><b>' + Number(d.slice(8)) + '</b><small>' + ([aktiv ? aktiv + ' foglalás' : '', ol.length ? ol.length + ' óra' : ''].filter(Boolean).join(', ') || 'nincs foglalás') + '</small></a>' +
        zar.map(function (k) { return '<p class="week__off">' + esc((hely(k.helyszin) || {}).nev || '') + ': ' + esc(k.megjegyzes || 'zárva') + '</p>'; }).join('') +
        '<div class="week__list">' + list.map(function (b) {
          return { p: F.perc(b.kezd), h: '<button type="button" class="wk-item' + (b.allapot === 'lemondva' ? ' is-cx' : '') + '" data-az="' + esc(b.azonosito) + '"' + kcStyle(b.kollega) +
            ' title="' + esc(b.kezd + ' · ' + b.nev + ' · ' + b.szolgaltatas.nev + ' · ' + b.kollega.nev + ', ' + b.helyszin.nev) + '">' +
            '<b>' + esc(b.kezd) + (b.sorozat ? ISM_IKON + '<span class="sr">, állandó időpont</span>' : '') + '</b><span>' + esc(b.nev) + '</span><small>' + esc(rovidNev(b.kollega.nev)) + ' · ' + esc(b.szolgaltatas.nev) + (b.allapot === 'lemondva' ? ' · lemondva' : '') + '</small></button>' };
        }).concat(ol.map(function (o) { return { p: F.perc(o.kezd), h: oraBlokk(o, 'oc-item--wk') }; })).sort(function (a, b) { return a.p - b.p; }).map(function (x) { return x.h; }).join('') + '</div></section>';
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
      (b.sorozat ? '<div><dt>Ismétlődik</dt><dd class="dd-ism">' + ISM_IKON + '<span>Állandó időpont: ' + esc(ritmus(b.sorozat)) + '<a class="dd-ism__a" href="#/foglalasok/allando/' + esc(b.sorozat.id) + '" id="fg-ser-link">Az állandó időpont adatai és a többi alkalom</a></span></dd></div>' : '') +
      '<div><dt>Állapot</dt><dd>' + (lem ? '<b>Lemondva</b>' : 'Megerősítve') + ' · ' + (b.forras === 'admin' ? 'kézzel felvéve' : 'a weboldalon foglalta') + '</dd></div>' +
      (b.kampany ? '<div><dt>Honnan jött</dt><dd>' + esc(forrasSzoveg(b.kampany)) + '</dd></div>' : '') +
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
    if (b.sorozat) $('#fg-ser-link').addEventListener('click', function () { d.close(); });
    if (b.sorozat && !lem) $('#dlg-fg-body').insertAdjacentHTML('beforeend', '<p class="hint">Az áthelyezés és a lemondás csak erre az egy alkalomra vonatkozik, a többi alkalom marad.</p>');
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
      var kl = torzs.kollegak.filter(function (k) { return nemArchiv(k) && k.helyszinek.indexOf(b.helyszin.id) >= 0 && k.szolgaltatasok.indexOf(b.szolgaltatas.id) >= 0; });
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
      var kl = torzs.kollegak.filter(function (k) { return nemArchiv(k) && k.helyszinek.indexOf(h) >= 0 && k.szolgaltatasok.indexOf(sz) >= 0; });
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
     ÁLLANDÓ IDŐPONT (sorozat): létrehozás előnézettel, lista, részletek, leállítás
     Szerződés: Claude tesztelés\f360-allando-idopont-2026-10-01\SZERZODES.md
     API: POST /sorozatok/elonezet, POST /sorozatok, GET /sorozatok?allapot=, GET /sorozatok/:id,
          POST /sorozatok/:id/leallitas; áthelyezéshez GET /szabad (admin ág)
     A ritmus felirata a levelek-sorozat.js ritmus()-ának másolata: „szerdánként 16:00-kor”.
     ===================================================================== */
  var NAPOKON = ['', 'hétfőnként', 'keddenként', 'szerdánként', 'csütörtökönként', 'péntekenként', 'szombatonként', 'vasárnaponként'];
  var NAPON_R = ['', 'hétfőn', 'kedden', 'szerdán', 'csütörtökön', 'pénteken', 'szombaton', 'vasárnap'];
  function ritmus(s) {
    var nap = Number(s.nap);
    if (!(nap >= 1 && nap <= 7)) return '';
    return Number(s.ismetles) === 2 ? 'minden második ' + NAPON_R[nap] + ' ' + s.kezd + '-kor' : NAPOKON[nap] + ' ' + s.kezd + '-kor';
  }
  function nagyKezd(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  // a sorozat időszaka toldalékkal: „október 7-étől, 10 alkalom”, „október 7-étől visszavonásig”, „október 7-étől december 16-áig”
  function serIdoszak(s) {
    var tol = napRag(s.kezdoDatum, 'tol');
    if (s.vege.tipus === 'nyitott') return tol + ' visszavonásig';
    if (s.vege.tipus === 'datum') return tol + ' ' + napRag(s.vege.datum, 'ig');
    return tol + ', ' + s.vege.db + ' alkalom';
  }
  var SER_OK = {
    foglalt: 'Foglalt: van már foglalása vagy órája',
    szabadsag: 'Szabadság vagy kiesés',
    nincs_beosztas: 'Ekkor nincs beosztva ezen a helyszínen',
    zarva: 'A helyszín zárva',
    mult: 'Már elmúlt',
    kollega_inaktiv: 'A szakember ekkor nem foglalható',
    kihagyva: 'Kihagyva'
  };
  function okSz(ok) { return SER_OK[ok] || 'Nem foglalható'; }
  // ismétlés-ikon: két íves nyíl körben (a naptár-blokkon, a jelmagyarázatban, a gombon)
  var ISM_IKON = '<svg class="ism" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4.5 8.5A5.5 5.5 0 0 1 14 5.2L15.5 6.8M15.5 3.5v3.3h-3.3M15.5 11.5A5.5 5.5 0 0 1 6 14.8L4.5 13.2M4.5 16.5v-3.3h3.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- létrehozás: 1. adatok ---------- */
  var ser = { step: 'adat', be: null, elo: null, dontes: {}, bo: null, boReq: 0, eloReq: 0, mvDatum: '', mvReq: 0, eredmeny: null };
  function kovNap(nap, tol) { var d = tol; while ((F.hetNapja(d) || 7) !== nap) d = F.addDays(d, 1); return d; }
  function openSer() {
    loadTorzs().then(function () {
      ser = { step: 'adat', be: null, elo: null, dontes: {}, bo: null, boReq: 0, eloReq: 0, mvDatum: '', mvReq: 0, eredmeny: null };
      $('#s-hely').innerHTML = optionList(torzs.helyszinek, fg.hely || torzs.helyszinek[0].id);
      $('#s-nap').innerHTML = NAP_HOSSZU.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i === 2 ? ' selected' : '') + '>' + n + '</option>'; }).join('');
      ['#s-nev', '#s-tel', '#s-email', '#s-megj'].forEach(function (s) { $(s).value = ''; });
      $('input[name="s-ism"][value="1"]').checked = true;
      $('input[name="s-vege"][value="alkalom"]').checked = true;
      $('#s-db').value = 10; $('#s-ig').value = '';
      serVege();
      var ma = F.most().datum;
      $('#s-tol').min = F.addDays(ma, -366); $('#s-tol').max = F.addDays(ma, 366);
      $('#s-tol').value = kovNap(3, F.addDays(ma, 1));
      $('#s-err').hidden = true;
      serFill('hely');
      serStep('adat');
      $('#dlg-ser').showModal();
      $('#s-nev').focus();
    }).catch(function (e) { toast(e.message, 'error'); });
  }
  function serFill(from) {
    var h = $('#s-hely').value;
    if (from === 'hely') {
      var sl = torzs.szolgaltatasok.filter(function (s) { return s.helyszinek.indexOf(h) >= 0 && torzs.kollegak.some(function (k) { return nemArchiv(k) && k.helyszinek.indexOf(h) >= 0 && k.szolgaltatasok.indexOf(s.id) >= 0; }); });
      $('#s-szolg').innerHTML = sl.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.nev + ' · ' + s.perc + ' perc') + '</option>'; }).join('');
    }
    if (from === 'hely' || from === 'szolg') {
      var sz = $('#s-szolg').value, elozo = $('#s-koll').value;
      var kl = torzs.kollegak.filter(function (k) { return nemArchiv(k) && k.helyszinek.indexOf(h) >= 0 && k.szolgaltatasok.indexOf(sz) >= 0; });
      var pref = kl.some(function (k) { return k.id === elozo; }) ? elozo : fg.koll && kl.some(function (k) { return k.id === fg.koll; }) ? fg.koll : (kl[0] || {}).id;
      $('#s-koll').innerHTML = optionList(kl, pref);
    }
    if (from !== 'kezd') serBeosztas(from === 'nap');
    else serRitmus();
  }
  // a választott szakember beosztása a választott napon: a kezdés-lista ehhez igazodik, de bármely 15 perc választható
  function serBeosztas(napValt) {
    var kid = $('#s-koll').value, req = ++ser.boReq;
    if (!kid) { serKezdLista([]); return; }
    api('/beosztas?kollega=' + encodeURIComponent(kid)).then(function (r) {
      if (req !== ser.boReq) return;
      ser.bo = (r && r.sorok) || [];
      var nap = Number($('#s-nap').value), h = $('#s-hely').value;
      var sav = ser.bo.filter(function (s) { return s.nap === nap && s.helyszin === h; });
      serKezdLista(sav);
      if (napValt) { var ma = F.most().datum, t = $('#s-tol').value || F.addDays(ma, 1); $('#s-tol').value = kovNap(nap, t < ma ? ma : t); serRitmus(); }
    }).catch(function () { if (req === ser.boReq) { ser.bo = []; serKezdLista([]); } });
  }
  function serKezdLista(sav) {
    var hely0 = hely($('#s-hely').value), sz = szolg($('#s-szolg').value), sel = $('#s-kezd'), regi = sel.value;
    var perc = sz ? sz.perc : 50, tol = F.perc(hely0.nyit), ig = F.perc(hely0.zar) - perc;
    var bent = function (m) { return sav.some(function (s) { return m >= F.perc(s.kezd) && m + perc <= F.perc(s.veg); }); };
    var opts = [];
    for (var m = Math.ceil(tol / 15) * 15; m <= ig; m += 15) opts.push(m);
    sel.innerHTML = opts.map(function (m) { var t = F.hm2(m); return '<option value="' + t + '">' + t + (sav.length && !bent(m) ? ' (nincs beosztva)' : '') + '</option>'; }).join('');
    var alap = opts.filter(function (m) { return F.hm2(m) === regi && (!sav.length || bent(m)); })[0];
    if (alap == null) alap = sav.length ? opts.filter(bent)[0] : opts.filter(function (m) { return m >= 16 * 60; })[0];
    if (alap != null) sel.value = F.hm2(alap);
    var k = koll($('#s-koll').value), nap = Number($('#s-nap').value);
    $('#s-bo').textContent = !k ? '' : sav.length
      ? rovidNev(k.nev) + ' ' + NAPON_R[nap] + ' ' + sav.map(function (s) { return s.kezd + '-' + s.veg; }).join(', ') + ' között dolgozik ' + (hely0.nev === 'Mexikói út' ? 'a Mexikói úton' : 'a ' + hely0.nev + 'ban') + '.'
      : rovidNev(k.nev) + ' ' + NAPON_R[nap] + ' nincs beosztva ezen a helyszínen. Válassz másik napot, vagy az ellenőrzésnél ütközésként látod.';
    serRitmus();
  }
  function serRitmus() {
    var nap = Number($('#s-nap').value), kezd = $('#s-kezd').value, ism = Number(($('input[name="s-ism"]:checked') || {}).value || 1);
    var k = koll($('#s-koll').value), sz = szolg($('#s-szolg').value);
    $('#s-ritmus').innerHTML = kezd && k ? '<b>' + esc(nagyKezd(ritmus({ nap: nap, kezd: kezd, ismetles: ism }))) + '</b>, ' + esc(k.nev) + (sz ? ', ' + esc(sz.nev) : '') : '';
    var t = $('#s-tol').value;
    $('#s-tol-h').textContent = t ? 'Az első alkalom: ' + F.datumNap(kovNap(nap, t)) + '.' : '';
  }
  // a „Meddig” blokk: csak a kiválasztott vége-opció mezője aktív, a többi halvány és tiltott
  function serVege(fokusz) {
    var vt = ($('input[name="s-vege"]:checked') || {}).value;
    $('#s-db').disabled = vt !== 'alkalom';
    $('#s-ig').disabled = vt !== 'datum';
    if (fokusz) { var m = vt === 'alkalom' ? $('#s-db') : vt === 'datum' ? $('#s-ig') : null; if (m) m.focus(); }
  }
  function serBemenet() {
    var vt = $('input[name="s-vege"]:checked').value;
    var be = { helyszin: $('#s-hely').value, szolgaltatas: $('#s-szolg').value, kollega: $('#s-koll').value, nap: Number($('#s-nap').value), kezd: $('#s-kezd').value,
      ismetles: Number($('input[name="s-ism"]:checked').value), kezdoDatum: $('#s-tol').value,
      vege: vt === 'alkalom' ? { tipus: 'alkalom', db: Number($('#s-db').value) } : vt === 'datum' ? { tipus: 'datum', datum: $('#s-ig').value } : { tipus: 'nyitott' } };
    var vendeg = { nev: $('#s-nev').value.trim(), telefon: $('#s-tel').value.trim(), email: $('#s-email').value.trim(), megjegyzes: $('#s-megj').value.trim() };
    var hiba = null;
    if (vendeg.nev.length < 2) hiba = ['s-nev', 'Add meg a vendég nevét.'];
    else if (vendeg.email && !/^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(vendeg.email)) hiba = ['s-email', 'Az e-mail-cím nem tűnik érvényesnek. Például: nev@gmail.com'];
    else if (!be.kollega) hiba = ['s-koll', 'Ennél a kezelésnél nincs választható szakember ezen a helyszínen.'];
    else if (!be.kezdoDatum) hiba = ['s-tol', 'Add meg, melyik naptól induljon.'];
    else if (vt === 'alkalom' && (!Number.isInteger(be.vege.db) || be.vege.db < 1 || be.vege.db > 104)) hiba = ['s-db', 'Az alkalmak száma 1 és 104 között lehet.'];
    else if (vt === 'datum' && !be.vege.datum) hiba = ['s-ig', 'Add meg az utolsó napot.'];
    else if (vt === 'datum' && be.vege.datum < be.kezdoDatum) hiba = ['s-ig', 'Az utolsó nap nem lehet korábbi az első napnál.'];
    return { be: be, vendeg: vendeg, hiba: hiba };
  }
  function serStep(st) {
    ser.step = st;
    ['adat', 'alk', 'kesz'].forEach(function (x) { $('#ser-' + x).hidden = x !== st; });
    var idx = ['adat', 'alk', 'kesz'].indexOf(st);
    $$('[data-serstep]').forEach(function (li, i) {
      li.classList.toggle('is-done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    var act = $('#ser-act');
    if (st === 'adat') act.innerHTML = '<button type="button" class="btn btn--ghost" id="ser-cancel">Mégse</button><button type="submit" class="btn btn--primary" id="ser-check">Alkalmak ellenőrzése</button>';
    if (st === 'alk') act.innerHTML = '<button type="button" class="linkbtn" id="ser-back">Vissza az adatokhoz</button><button type="button" class="btn btn--ghost" id="ser-cancel">Mégse</button><button type="submit" class="btn btn--primary" id="ser-save">Mentés</button>';
    if (st === 'kesz') act.innerHTML = '<button type="button" class="btn btn--ghost" id="ser-cancel">Bezárás</button><a class="btn btn--primary" id="ser-open" href="#/foglalasok/allando/' + esc(ser.eredmeny ? ser.eredmeny.sorozat.id : '') + '">Az állandó időpont adatai</a>';
  }

  /* ---------- 2. alkalmak ellenőrzése ---------- */
  function serEllenoriz() {
    var b = serBemenet(), err = $('#s-err');
    if (b.hiba) { err.textContent = b.hiba[1]; err.hidden = false; $('#' + b.hiba[0]).focus(); return; }
    err.hidden = true;
    var gomb = $('#ser-check'), req = ++ser.eloReq;
    gomb.disabled = true; gomb.textContent = 'Ellenőrzés folyamatban';
    api('/sorozatok/elonezet', { method: 'POST', json: b.be }).then(function (r) {
      if (req !== ser.eloReq) return;
      // ha ugyanazt nézi újra, a döntései (kihagyás, áthelyezés) megmaradnak
      var ugyanaz = ser.be && JSON.stringify(ser.be) === JSON.stringify(b.be);
      ser.be = b.be; ser.vendeg = b.vendeg; ser.elo = r; if (!ugyanaz) ser.dontes = {};
      serStep('alk'); renderSerAlk();
      $('#ser-alk-h').focus();
    }).catch(function (e) {
      if (req !== ser.eloReq) return;
      gomb.disabled = false; gomb.textContent = 'Alkalmak ellenőrzése';
      err.textContent = e.message; err.hidden = false;
    });
  }
  function serSzamok() {
    var l = ser.elo.alkalmak, n = { letre: 0, utk: 0, nyitott: 0, kihagy: 0, ath: 0 };
    l.forEach(function (a) {
      var d = ser.dontes[a.datum];
      if (a.allapot === 'szabad') n.letre++;
      else { n.utk++; if (!d) n.nyitott++; else if (d.tipus === 'kihagy') n.kihagy++; else { n.ath++; n.letre++; } }
    });
    return n;
  }
  function renderSerAlk() {
    var be = ser.be, k = koll(be.kollega), sz = szolg(be.szolgaltatas), e = ser.elo, n = serSzamok();
    var html = '<div class="ser-sum"' + kcStyle(k) + '><p class="ser-sum__r" id="ser-alk-h" tabindex="-1">' + esc(nagyKezd(ritmus(be))) + '</p>' +
      '<p class="ser-sum__m">' + esc([ser.vendeg.nev, k.nev, sz.nev + ' ' + sz.perc + ' perc', hely(be.helyszin).nev].join(' · ')) + '</p>' +
      '<p class="ser-sum__n" aria-live="polite" id="ser-cnt">' + serCntSz(n) + '</p></div>';
    if (be.vege.tipus === 'nyitott') html += '<p class="note ser-note">Visszavonásig: most a ' + esc(F.honapNapRagos(e.horizontVege).replace(/-(án|én|jén)$/, '')) + '-ig tartó alkalmak készülnek el, a későbbieket a rendszer folyamatosan rögzíti. Ha később egy alkalom ütközik, kimarad, és itt, az állandó időpontnál látod.</p>';
    if (!e.alkalmak.length) html += '<p class="empty-inline">A megadott időszakban nincs ilyen nap. Állítsd át az első napot vagy a végét.</p>';
    html += '<ol class="ser-list">' + e.alkalmak.map(serSor).join('') + '</ol>';
    $('#ser-alk').innerHTML = html;
    var s = $('#ser-save');
    if (s) { s.disabled = !n.letre; s.textContent = n.letre ? 'Mentés: ' + n.letre + ' alkalom' : 'Nincs menthető alkalom'; }
  }
  function serCntSz(n) {
    return '<b>' + n.letre + '</b> alkalom kerül a naptárba' + (n.utk ? ', <b>' + n.utk + '</b> ütközik' + (n.nyitott ? ' (' + n.nyitott + ' még döntésre vár, mentéskor kimarad)' : '') : '') + '.';
  }
  function serSor(a) {
    var d = ser.dontes[a.datum], utk = a.allapot === 'utkozik';
    var cls = 'ser-a' + (utk ? ' is-utk' : '') + (d && d.tipus === 'kihagy' ? ' is-skip' : '') + (d && d.tipus === 'athelyez' ? ' is-moved' : '');
    var nap = '<span class="ser-a__d"><b>' + esc(F.honapNap(a.datum)) + '</b><small>' + esc(F.NAPOK[F.hetNapja(a.datum)]) + '</small></span><span class="ser-a__t">' + esc(a.kezd) + '</span>';
    if (!utk) return '<li class="' + cls + '">' + nap + '<span class="ser-a__s">Szabad</span></li>';
    var allapot, gombok;
    if (!d) {
      allapot = '<span class="ser-a__s"><span class="ser-a__ok">' + esc(okSz(a.ok)) + '</span></span>';
      gombok = '<span class="ser-a__act"><button type="button" class="btn btn--ghost btn--sm" data-serskip="' + a.datum + '" aria-label="Kihagyás: ' + esc(F.datumNap(a.datum)) + '">Kihagyás</button>' +
        (a.ok === 'mult' ? '' : '<button type="button" class="btn btn--ghost btn--sm" data-sermove="' + a.datum + '" aria-label="Áthelyezés: ' + esc(F.datumNap(a.datum)) + '">Áthelyezés</button>') + '</span>';
    } else if (d.tipus === 'kihagy') {
      allapot = '<span class="ser-a__s"><span class="ser-a__ok">Kimarad · ' + esc(okSz(a.ok).split(':')[0].toLowerCase()) + '</span></span>';
      gombok = '<span class="ser-a__act"><button type="button" class="linkbtn" data-serundo="' + a.datum + '" aria-label="Visszavonás: ' + esc(F.datumNap(a.datum)) + '">Visszavonás</button></span>';
    } else {
      allapot = '<span class="ser-a__s"><span class="ser-a__ok">Áthelyezve: <b>' + esc(F.datumNap(d.ujDatum) + ', ' + d.ujKezd) + '</b></span></span>';
      gombok = '<span class="ser-a__act"><button type="button" class="linkbtn" data-serundo="' + a.datum + '" aria-label="Áthelyezés visszavonása: ' + esc(F.datumNap(a.datum)) + '">Visszavonás</button></span>';
    }
    var mv = ser.mvDatum === a.datum ? '<div class="ser-mv" id="ser-mv"><div class="ser-mv__h"><div class="field"><label for="ser-mv-d">Új nap</label><input type="date" id="ser-mv-d" value="' + esc(ser.mvNap || a.datum) + '"></div>' +
      '<p class="hint">Ugyanannál a szakembernél, ugyanazzal a kezeléssel. Csak ez az egy alkalom kerül máshová.</p></div>' +
      '<fieldset class="slotpick"><legend>Szabad időpontok</legend><div class="slotpick__list" id="ser-mv-slots" aria-live="polite"></div></fieldset>' +
      '<div class="ser-mv__act"><button type="button" class="btn btn--ghost btn--sm" id="ser-mv-x">Mégse</button><button type="button" class="btn btn--primary btn--sm" id="ser-mv-ok">Ide helyezem</button></div></div>' : '';
    return '<li class="' + cls + '" data-serdatum="' + a.datum + '">' + nap + allapot + gombok + mv + '</li>';
  }
  function serFrissit(fokusz) {
    renderSerAlk();
    if (fokusz) { var el = $(fokusz); if (el) el.focus(); }
  }
  // az áthelyezés célja nem ütközhet a sorozat többi, még el nem mentett alkalmával
  function serTerv() {
    var l = [];
    ser.elo.alkalmak.forEach(function (a) {
      var d = ser.dontes[a.datum];
      if (a.allapot === 'szabad') l.push({ datum: a.datum, kezd: a.kezd, forras: a.datum });
      else if (d && d.tipus === 'athelyez') l.push({ datum: d.ujDatum, kezd: d.ujKezd, forras: a.datum });
    });
    return l;
  }
  function serMoveOpen(datum) {
    ser.mvDatum = datum; ser.mvNap = datum; renderSerAlk();
    serMoveSlots(); $('#ser-mv-d').focus();
    $('#ser-mv').scrollIntoView({ block: 'nearest' });
  }
  function serMoveSlots(keep) {
    var box = $('#ser-mv-slots'), d = $('#ser-mv-d').value, be = ser.be, req = ++ser.mvReq;
    ser.mvNap = d;
    if (!d) { box.innerHTML = '<p class="hint">Válassz napot.</p>'; return; }
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = '<p class="hint">Szabad időpontok betöltése</p>';
    api('/szabad?helyszin=' + encodeURIComponent(be.helyszin) + '&szolgaltatas=' + encodeURIComponent(be.szolgaltatas) + '&kollega=' + encodeURIComponent(be.kollega) + '&tol=' + d + '&ig=' + d).then(function (r) {
      if (req !== ser.mvReq) return;
      box.setAttribute('aria-busy', 'false');
      var perc = szolg(be.szolgaltatas).perc + (szolg(be.szolgaltatas).puffer == null ? 10 : szolg(be.szolgaltatas).puffer);
      var terv = serTerv().filter(function (x) { return x.datum === d && x.forras !== ser.mvDatum; });
      var list = ((r && r.napok && r.napok[d]) || []).map(function (x) {
        var m = F.perc(x.kezd), ut = terv.some(function (t) { var tm = F.perc(t.kezd); return m < tm + perc && tm < m + perc; });
        return { kezd: x.kezd, ut: ut };
      });
      if (!list.length) { box.innerHTML = '<p class="hint">Ezen a napon nincs szabad időpont ennél a szakembernél. Válassz másik napot.</p>'; return; }
      box.innerHTML = '<div class="pills">' + list.map(function (x) {
        return '<label class="pill' + (x.ut ? ' is-now' : '') + '"><input type="radio" name="ser-mv-slot" value="' + esc(x.kezd) + '"' + (x.ut ? ' disabled' : '') + (keep === x.kezd ? ' checked' : '') + '>' +
          '<span>' + esc(x.kezd) + '<small>' + (x.ut ? 'állandó alkalom' : 'szabad') + '</small></span></label>';
      }).join('') + '</div>';
    }).catch(function (e) { if (req === ser.mvReq) { box.setAttribute('aria-busy', 'false'); box.innerHTML = '<p class="form-err">' + esc(e.message) + '</p>'; } });
  }
  function serMoveOk() {
    var sel = $('input[name="ser-mv-slot"]:checked'), d = $('#ser-mv-d').value, datum = ser.mvDatum;
    if (!sel) { var b = $('#ser-mv-slots'); if (!$('.ser-mv__err', b.parentNode)) b.insertAdjacentHTML('afterend', '<p class="form-err ser-mv__err" role="alert">Válassz egy szabad időpontot.</p>'); return; }
    ser.dontes[datum] = { tipus: 'athelyez', ujDatum: d, ujKezd: sel.value };
    ser.mvDatum = '';
    serFrissit('[data-serundo="' + datum + '"]');
  }
  function serMent() {
    var b = $('#ser-save'), kihagy = [], ath = [];
    Object.keys(ser.dontes).forEach(function (d) {
      var x = ser.dontes[d];
      if (x.tipus === 'kihagy') kihagy.push(d); else ath.push({ datum: d, ujDatum: x.ujDatum, ujKezd: x.ujKezd });
    });
    b.disabled = true; b.textContent = 'Mentés folyamatban';
    api('/sorozatok', { method: 'POST', json: Object.assign({}, ser.be, { vendeg: ser.vendeg, kihagy: kihagy, athelyez: ath }) }).then(function (r) {
      ser.eredmeny = r;
      serStep('kesz'); renderSerKesz();
      $('#ser-kesz-h').focus();
      if (sr.lista) loadSrLista();
      renderFg();
    }).catch(function (e) {
      b.disabled = false; b.textContent = 'Mentés';
      var p = $('#ser-alk .ser-err');
      if (!p) $('#ser-alk').insertAdjacentHTML('afterbegin', '<p class="form-err ser-err" role="alert"></p>');
      $('#ser-alk .ser-err').textContent = e.message;
      if (e.status === 409) serEllenoriz();
    });
  }
  function renderSerKesz() {
    var r = ser.eredmeny, s = r.sorozat, l = r.letrejott.slice().sort(function (a, b) { return a.datum.localeCompare(b.datum); }), km = r.kimaradt || [];
    var athelyezve = l.filter(function (a) { return a.athelyezve; }).length;
    $('#ser-kesz').innerHTML = '<div class="ser-done"><p class="ser-done__n" id="ser-kesz-h" tabindex="-1"><b>' + l.length + '</b> alkalom került a naptárba</p>' +
      '<p class="ser-done__r">' + esc(s.vendeg.nev) + ', ' + esc(ritmus(s)) + ', ' + esc(s.kollega.nev) + '. ' +
      (l.length ? 'Első alkalom: ' + esc(F.datumNap(l[0].datum) + ', ' + l[0].kezd) + '. ' : '') + (athelyezve ? athelyezve + ' alkalom áthelyezve. ' : '') +
      (s.vendeg.email ? 'A vendég egy levelet kap az összes alkalommal.' : 'A vendégnek nincs e-mail-címe, ezért levelet nem kap.') + '</p></div>' +
      (km.length ? '<div class="ser-km"><p class="ser-km__h">Kimaradt ' + km.length + ' alkalom</p><ul>' + km.map(function (x) {
        return '<li><b>' + esc(F.datumNap(x.datum)) + '</b> · ' + esc(okSz(x.ok)) + '</li>';
      }).join('') + '</ul></div>' : '<p class="hint">Egy alkalom sem maradt ki.</p>');
  }

  /* ---------- lista: Állandó időpontok ---------- */
  var sr = { lista: 'aktiv', adat: [], req: 0, nyitott: '', reszlet: null, dReq: 0 };
  function openAllando(id) {
    document.title = 'Állandó időpontok · Admin · Studio F360';
    fgMode('allando');
    loadTorzs().then(function () { loadSrLista(); if (id) openSr(id); else if ($('#dlg-sr').open) $('#dlg-sr').close(); })
      .catch(function (e) { hibaDoboz($('#sr-board'), e, function () { openAllando(id); }); });
  }
  function fgMode(m) {
    $('#fg-naptar').hidden = m !== 'naptar'; $('#fg-allando').hidden = m !== 'allando';
    $$('[data-fgmode]').forEach(function (a) { if (a.getAttribute('data-fgmode') === m) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function loadSrLista() {
    var box = $('#sr-board'), req = ++sr.req;
    box.setAttribute('aria-busy', 'true');
    if (!box.children.length) box.innerHTML = '<div class="skel-board skel-board--sm"></div>';
    $$('[data-srlista]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-srlista') === sr.lista ? 'true' : 'false'); });
    api('/sorozatok?allapot=' + sr.lista).then(function (r) {
      if (req !== sr.req) return;
      sr.adat = (r && r.sorozatok) || [];
      box.setAttribute('aria-busy', 'false');
      $('#fg-sum').textContent = sr.adat.length + ' ' + { aktiv: 'aktív', leallitva: 'leállított', mind: '' }[sr.lista] + (sr.lista === 'mind' ? '' : ' ') + 'állandó időpont' +
        (sr.lista !== 'leallitva' ? ', ' + sr.adat.reduce(function (n, s) { return n + (s.status === 'aktiv' ? s.jovobeli : 0); }, 0) + ' jövőbeli alkalom' : '');
      renderSrLista();
    }).catch(function (e) { if (req === sr.req) hibaDoboz(box, e, loadSrLista); });
    srSzamlalo();
  }
  function srSzamlalo() {
    api('/sorozatok?allapot=aktiv').then(function (r) { var n = ((r && r.sorozatok) || []).length; $('#fg-ser-n').textContent = n ? String(n) : ''; }).catch(function () { /* a szám nem kritikus */ });
  }
  function renderSrLista() {
    var box = $('#sr-board'), l = sr.adat;
    if (!l.length) {
      box.innerHTML = '<div class="empty-state"><p>' + (sr.lista === 'leallitva' ? 'Nincs leállított állandó időpont.' : 'Még nincs állandó időpont. Ha egy vendég minden héten ugyanakkor jön, rögzítsd egyszerre az összes alkalmát.') + '</p>' +
        (sr.lista === 'leallitva' ? '' : '<button type="button" class="btn btn--primary" data-sernew>Állandó időpont felvétele</button>') + '</div>';
      return;
    }
    // napok szerint csoportosítva: a hét rendje, mint egy órarend
    var napok = {};
    l.forEach(function (s) { (napok[s.nap] = napok[s.nap] || []).push(s); });
    box.innerHTML = '<div class="sr-week">' + Object.keys(napok).map(Number).sort().map(function (n) {
      return '<section class="sr-day" aria-labelledby="sr-d-' + n + '"><h2 class="sr-day__h" id="sr-d-' + n + '">' + NAP_HOSSZU[n - 1] + '<small>' + napok[n].length + '</small></h2><ul class="sr-list">' +
        napok[n].map(srSor).join('') + '</ul></section>';
    }).join('') + '</div>';
  }
  function srSor(s) {
    var le = s.status === 'leallitva', km = (s.kimaradt || []).length;
    var ido = serIdoszak(s);
    return '<li><a class="sr-row' + (le ? ' is-off' : '') + '" href="#/foglalasok/allando/' + esc(s.id) + '"' + kcStyle(s.kollega) + '>' +
      '<span class="sr-row__t"><b>' + esc(s.kezd) + '</b><small>' + (Number(s.ismetles) === 2 ? 'kéthetente' : 'hetente') + '</small></span>' +
      '<span class="sr-row__w"><b>' + esc(s.vendeg.nev) + '</b><span class="sr-row__k"><span class="pl__dot" aria-hidden="true"></span>' + esc(s.kollega.nev) + ' · ' + esc(s.szolgaltatas.nev) + '</span>' +
        '<span class="sr-row__m">' + esc(ido) + '</span></span>' +
      '<span class="sr-row__n">' + (le ? '<span class="ko-st ko-st--archiv">Leállítva</span>' : s.kovetkezo ? '<small>Következő</small><b>' + esc(F.datumNap(s.kovetkezo.datum)) + '</b>' : '<small>Nincs több alkalom</small>') +
        (km && !le ? '<span class="sr-warn">' + km + ' alkalom kimaradt</span>' : '') + '</span>' +
      '<span class="sr-row__go" aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18"><path d="m8 5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a></li>';
  }

  /* ---------- részletek + leállítás ---------- */
  function openSr(id) {
    var d = $('#dlg-sr'), req = ++sr.dReq;
    sr.nyitott = id;
    $('#dlg-sr-h').textContent = 'Állandó időpont';
    $('#sr-body').innerHTML = '<div class="skel-board skel-board--sm"></div>'; $('#sr-act').innerHTML = '';
    if (!d.open) d.showModal();
    api('/sorozatok/' + encodeURIComponent(id)).then(function (s) {
      if (req !== sr.dReq) return;
      sr.reszlet = s; renderSr();
    }).catch(function (e) { if (req === sr.dReq) $('#sr-body').innerHTML = '<p class="form-err">' + esc(e.message) + '</p>'; $('#sr-act').innerHTML = '<button type="button" class="btn btn--primary" id="sr-close">Bezárás</button>'; });
  }
  function renderSr(uzenet) {
    var s = sr.reszlet, le = s.status === 'leallitva';
    $('#dlg-sr-h').textContent = s.vendeg.nev;
    var kap = [s.vendeg.telefon ? '<a href="tel:' + esc(String(s.vendeg.telefon).replace(/[^\d+]/g, '')) + '">' + esc(s.vendeg.telefon) + '</a>' : '', s.vendeg.email ? '<a href="mailto:' + esc(s.vendeg.email) + '">' + esc(s.vendeg.email) + '</a>' : ''].filter(Boolean).join(' · ');
    var html = (uzenet ? '<p class="note oc-note" role="status">' + esc(uzenet) + '</p>' : '') +
      '<div class="ser-sum"' + kcStyle(s.kollega) + '><p class="ser-sum__r">' + esc(nagyKezd(ritmus(s))) + '</p><p class="ser-sum__m">' + esc([s.kollega.nev, s.szolgaltatas.nev + (s.szolgaltatas.perc ? ' ' + s.szolgaltatas.perc + ' perc' : ''), s.helyszin.nev].join(' · ')) + '</p>' +
      '<p class="ser-sum__n">' + (le ? '<span class="ko-st ko-st--archiv">Leállítva</span>' + (s.lemondott ? ' ' + s.lemondott + ' alkalom lemondva' : '') : '<b>' + s.jovobeli + '</b> jövőbeli alkalom' + (s.lemondott ? ', ' + s.lemondott + ' lemondva' : '')) + '</p></div>' +
      '<dl class="dl"><div><dt>Időszak</dt><dd>' + esc(serIdoszak(s)) + '</dd></div>' +
      '<div><dt>Elérhetőség</dt><dd>' + (kap || 'nincs megadva') + '</dd></div>' +
      (s.vendeg.megjegyzes ? '<div><dt>Megjegyzés</dt><dd>' + esc(s.vendeg.megjegyzes) + '</dd></div>' : '') +
      '<div><dt>Azonosító</dt><dd class="mono">' + esc(s.id) + '</dd></div></dl>' +
      ((s.kimaradt || []).length ? '<div class="ser-km"><p class="ser-km__h">Kimaradt ' + s.kimaradt.length + ' alkalom</p><ul>' + s.kimaradt.map(function (x) {
        return '<li><b>' + esc(F.datumNap(x.datum)) + '</b> · ' + esc(okSz(x.ok)) + ' · <a href="#/foglalasok/nap/' + esc(x.datum) + '">Megnézem a naptárban</a></li>';
      }).join('') + '</ul><p class="hint">Ha mégis kell, ezekre a napokra az Új foglalás gombbal vehetsz fel időpontot.</p></div>' : '') +
      '<h3 class="oc-h">Alkalmak</h3><ol class="sr-alk">' + s.alkalmak.map(function (a) {
        var mult = F.percIg(a.datum, F.perc(a.kezd)) <= 0, lem = a.allapot === 'lemondva';
        return '<li class="' + (lem ? 'is-cx' : mult ? 'is-past' : '') + '"><a href="#/foglalasok/nap/' + esc(a.datum) + '" aria-label="' + esc(F.datumNap(a.datum) + ', ' + a.kezd + (lem ? ', lemondva' : mult ? ', elmúlt' : '') + ', megnyitás a naptárban') + '">' +
          '<b>' + esc(F.honapNap(a.datum)) + '</b><span>' + esc(F.NAPOK[F.hetNapja(a.datum)]) + ', ' + esc(a.kezd) + '</span><small>' + (lem ? 'lemondva' : mult ? 'elmúlt' : 'megerősítve') + '</small></a></li>';
      }).join('') + '</ol>' +
      (!le ? '<div class="oc-elm sr-stop" id="sr-stop" hidden><h3 class="oc-h">Állandó időpont leállítása</h3>' +
        '<div class="field"><label for="sr-tol">Ettől a naptól nincs több alkalom</label><input type="date" id="sr-tol" value="' + F.most().datum + '" min="' + F.most().datum + '" aria-describedby="sr-tol-h"></div>' +
        '<p class="hint" id="sr-tol-h" aria-live="polite"></p>' +
        '<div class="oc-add__act"><button type="button" class="btn btn--ghost" id="sr-stop-no">Mégse</button><button type="button" class="btn btn--danger" id="sr-stop-yes">Leállítás</button></div></div>' : '');
    $('#sr-body').innerHTML = html;
    $('#sr-act').innerHTML = (!le ? '<button type="button" class="linkbtn linkbtn--danger" id="sr-stop-open">Állandó időpont leállítása</button>' : '') +
      '<button type="button" class="btn btn--primary" id="sr-close">Bezárás</button>';
    if (!le) srStopSz();
  }
  function srStopSz() {
    var s = sr.reszlet, tol = ($('#sr-tol') || {}).value, p = $('#sr-tol-h');
    if (!p) return;
    if (!tol) { p.textContent = 'Válassz napot.'; return; }
    var torol = s.alkalmak.filter(function (a) { return a.allapot === 'megerositett' && a.datum >= tol && F.percIg(a.datum, F.perc(a.kezd)) > 0; });
    var marad = s.alkalmak.filter(function (a) { return a.allapot === 'megerositett' && a.datum < tol && F.percIg(a.datum, F.perc(a.kezd)) > 0; });
    p.textContent = (torol.length ? torol.length + ' alkalom lemondva lesz' : 'Ettől a naptól nincs több alkalom, csak a sorozat áll le') + (marad.length ? ', ' + marad.length + ' megmarad' : '') + '. ' +
      (s.vendeg.email ? 'A vendég és a szakember egy-egy összefoglaló levelet kap.' : 'A szakember összefoglaló levelet kap.');
  }
  function srLeallit() {
    var s = sr.reszlet, tol = $('#sr-tol').value, d = $('#dlg-sr');
    if (!tol) { srStopSz(); return; }
    var n = s.alkalmak.filter(function (a) { return a.allapot === 'megerositett' && a.datum >= tol && F.percIg(a.datum, F.perc(a.kezd)) > 0; }).length;
    d.close();
    confirmDlg('Leállítod az állandó időpontot?', s.vendeg.nev + ', ' + ritmus(s) + '. ' + F.datumNap(tol) + '-tól ' + (n ? n + ' alkalom törlődik a naptárból.' : 'nincs több alkalom.') + ' Ezt nem lehet visszavonni, utána új állandó időpontot kell felvenni.', 'Leállítás').then(function (ok) {
      d.showModal();
      if (!ok) { $('#sr-stop-yes').focus(); return; }
      var b = $('#sr-stop-yes'); b.disabled = true; b.textContent = 'Leállítás folyamatban';
      api('/sorozatok/' + encodeURIComponent(s.id) + '/leallitas', { method: 'POST', json: { tol: tol } }).then(function (r) {
        toast('Leállítva: ' + s.vendeg.nev + ', ' + ritmus(s) + '. ' + r.lemondott.length + ' alkalom lemondva.');
        loadSrLista(); renderFg();
        return api('/sorozatok/' + encodeURIComponent(s.id)).then(function (x) { sr.reszlet = x; renderSr('Leállítva. ' + (r.lemondott.length ? r.lemondott.length + ' alkalmat lemondtunk.' : 'Nem volt lemondandó alkalom.')); $('#sr-close').focus(); });
      }).catch(function (e) { b.disabled = false; b.textContent = 'Leállítás'; toast(e.message, 'error'); });
    });
  }

  /* =====================================================================
     CSOPORTOS ÓRA RÉSZLETEI (a Foglalások naptárából): résztvevők, kézi felvétel,
     lemondás, „Óra elmarad” (megerősítéssel, a résztvevők levelet kapnak)
     API: GET/POST /orak/:id/resztvevok, POST /orak/:id/elmarad, POST /ora-foglalasok/:id/lemondas
     ===================================================================== */
  var oc = { id: '', adat: null, req: 0 };
  function openOra(id) {
    oc.id = id;
    var d = $('#dlg-ora');
    $('#dlg-ora-h').textContent = 'Csoportos óra';
    $('#ora-body').innerHTML = '<div class="skel-board skel-board--sm"></div>';
    $('#ora-act').innerHTML = '';
    if (!d.open) d.showModal();
    loadOra();
  }
  function loadOra(uzenet) {
    var req = ++oc.req;
    return api('/orak/' + encodeURIComponent(oc.id) + '/resztvevok').then(function (r) {
      if (req !== oc.req) return;
      oc.adat = r; renderOra(uzenet);
    }).catch(function (e) { if (req === oc.req) $('#ora-body').innerHTML = '<p class="form-err">' + esc(e.message) + '</p>'; });
  }
  function renderOra(uzenet) {
    var o = oc.adat.ora, l = oc.adat.resztvevok || [], el = o.status === 'elmarad';
    var aktiv = l.filter(function (b) { return b.allapot === 'megerositett'; }), lem = l.filter(function (b) { return b.allapot !== 'megerositett'; });
    var mult = F.percIg(o.datum, F.perc(o.kezd)) <= 0, tele = o.foglalt >= o.kapacitas;
    $('#dlg-ora-h').textContent = o.ora.nev;
    var pot = ''; for (var i = 0; i < Math.min(o.kapacitas, 30); i++) pot += '<i' + (i < o.foglalt ? ' class="is-f"' : '') + '></i>';
    var sor = function (b) {
      var lemondva = b.allapot !== 'megerositett';
      var kap = [b.telefon ? '<a href="tel:' + esc(String(b.telefon).replace(/[^\d+]/g, '')) + '">' + esc(b.telefon) + '</a>' : '', b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : ''].filter(Boolean).join(' · ');
      return '<li class="rt' + (lemondva ? ' is-cx' : '') + '"><div class="rt__w"><b>' + esc(b.nev) + '</b><span>' + (kap || 'nincs elérhetőség') + '</span>' +
        (b.megjegyzes ? '<span class="rt__m">' + esc(b.megjegyzes) + '</span>' : '') +
        '<small>' + (b.rogzites === 'admin' ? 'kézzel felvéve' : 'a weboldalon jelentkezett') + (lemondva ? ' · lemondva' : '') + '</small></div>' +
        (!lemondva && !mult ? '<button type="button" class="linkbtn linkbtn--danger" data-rtcx="' + esc(b.azonosito) + '" aria-label="Jelentkezés lemondása: ' + esc(b.nev) + '">Lemondás</button>' : '') + '</li>';
    };
    $('#ora-body').innerHTML = (uzenet ? '<p class="note oc-note" role="status">' + esc(uzenet) + '</p>' : '') +
      '<div class="oc-sum' + (el ? ' is-el' : '') + '"><div><p class="oc-sum__w">' + esc(F.datumHosszu(o.datum)) + ', <b>' + esc(o.kezd + '-' + o.veg) + '</b></p>' +
        '<p>' + esc([o.kollega ? o.kollega.nev : 'nincs megadva oktató', o.helyszin.nev, o.ora.perc + ' perc', o.ora.ar != null ? F.ft(o.ora.ar) : ''].filter(Boolean).join(' · ')) + '</p>' +
        (el ? '<p class="oc-sum__el"><b>Elmarad.</b>' + (o.megjegyzes ? ' ' + esc(o.megjegyzes) : '') + '</p>' : '') + '</div>' +
        '<div class="oc-sum__n" aria-label="' + o.foglalt + ' / ' + o.kapacitas + ' hely foglalt"><b>' + o.foglalt + '<span>/' + o.kapacitas + '</span></b><span class="oc-dots" aria-hidden="true">' + pot + '</span>' +
        '<small>' + (el ? 'az óra elmarad' : tele ? 'betelt' : (o.kapacitas - o.foglalt) + ' hely szabad') + '</small></div></div>' +
      '<h3 class="oc-h">Résztvevők</h3>' +
      (aktiv.length ? '<ul class="rts">' + aktiv.map(sor).join('') + '</ul>' : '<p class="empty-inline">Még senki nem jelentkezett.</p>') +
      (lem.length ? '<details class="rts-cx"><summary>Lemondott jelentkezések (' + lem.length + ')</summary><ul class="rts">' + lem.map(sor).join('') + '</ul></details>' : '') +
      (!el && !mult ? '<form class="oc-add" id="oc-add" novalidate><h3 class="oc-h">Résztvevő felvétele</h3>' +
        (tele ? '<p class="hint">Az óra betelt. Ha valaki lemond, itt felveheted a helyére.</p>' :
        '<div class="grid2"><div class="field"><label for="oc-nev">Név</label><input type="text" id="oc-nev" maxlength="100" required autocomplete="off"></div>' +
        '<div class="field"><label for="oc-tel">Telefonszám <span class="opt">(nem kötelező)</span></label><input type="tel" id="oc-tel" maxlength="24" inputmode="tel" autocomplete="off"></div>' +
        '<div class="field"><label for="oc-email">E-mail-cím <span class="opt">(nem kötelező)</span></label><input type="email" id="oc-email" maxlength="254" inputmode="email" autocomplete="off" aria-describedby="oc-email-h"><p class="hint" id="oc-email-h">Ha megadod, visszaigazolást kap lemondó linkkel.</p></div>' +
        '<div class="field"><label for="oc-megj">Megjegyzés <span class="opt">(nem kötelező)</span></label><input type="text" id="oc-megj" maxlength="1000" autocomplete="off"></div></div>' +
        '<p class="form-err" id="oc-err" role="alert" hidden></p><div class="oc-add__act"><button type="submit" class="btn btn--primary" id="oc-ok">Felvétel az órára</button></div>') + '</form>' : '') +
      '<div class="oc-elm" id="oc-elm" hidden><h3 class="oc-h">Az óra elmarad</h3>' +
        '<p>' + (aktiv.length ? aktiv.length + ' résztvevő ' + (aktiv.filter(function (b) { return b.email; }).length === aktiv.length ? '' : '(akinek van e-mail-címe) ') + 'levelet kap, hogy az óra elmarad. A jelentkezésük megmarad, a levélben lévő linkkel másik órára tehetik vagy lemondhatják.' : 'Senki nem jelentkezett, levél nem megy ki.') + '</p>' +
        '<div class="field"><label for="oc-ok-t">Mit írjunk az okáról? <span class="opt">(nem kötelező, a levélbe kerül)</span></label><input type="text" id="oc-ok-t" maxlength="300" placeholder="Például: az oktató megbetegedett" autocomplete="off"></div>' +
        '<div class="oc-add__act"><button type="button" class="btn btn--ghost" id="oc-elm-no">Mégse</button><button type="button" class="btn btn--danger" id="oc-elm-yes">Igen, az óra elmarad</button></div></div>';
    $('#ora-act').innerHTML = (!el && !mult ? '<button type="button" class="linkbtn linkbtn--danger" id="oc-elm-open">Óra elmarad</button>' : '') +
      '<button type="button" class="btn btn--primary" id="oc-close">Bezárás</button>';
  }
  function oraFelvesz(ev) {
    ev.preventDefault();
    var err = $('#oc-err'), b = $('#oc-ok');
    var body = { nev: $('#oc-nev').value.trim(), telefon: $('#oc-tel').value.trim(), email: $('#oc-email').value.trim(), megjegyzes: $('#oc-megj').value.trim() };
    if (body.nev.length < 2) { err.textContent = 'Add meg a résztvevő nevét.'; err.hidden = false; $('#oc-nev').focus(); return; }
    err.hidden = true; b.disabled = true; b.textContent = 'Felvétel folyamatban';
    api('/orak/' + encodeURIComponent(oc.id) + '/resztvevok', { method: 'POST', json: body }).then(function () {
      toast('Felvéve: ' + body.nev);
      renderFg();
      return loadOra(body.nev + ' felkerült az órára' + (body.email ? ', és visszaigazoló levelet kap.' : '.'));
    }).catch(function (e) {
      b.disabled = false; b.textContent = 'Felvétel az órára';
      err.textContent = e.message; err.hidden = false;
      if (e.status === 409) { renderFg(); loadOra(); }
    });
  }
  function oraElmaradKuld() {
    var b = $('#oc-elm-yes'), ok = $('#oc-ok-t').value.trim();
    b.disabled = true; b.textContent = 'Folyamatban';
    api('/orak/' + encodeURIComponent(oc.id) + '/elmarad', { method: 'POST', json: ok ? { ok: ok } : {} }).then(function (r) {
      toast('Az óra elmarad. ' + (r && r.ertesitve ? r.ertesitve + ' résztvevő levelet kapott.' : 'Levél nem ment ki.'));
      renderFg();
      return loadOra('Az óra elmaradtként van jelölve. ' + (r && r.ertesitve ? r.ertesitve + ' résztvevő levelet kapott.' : ''));
    }).catch(function (e) { b.disabled = false; b.textContent = 'Igen, az óra elmarad'; toast(e.message, 'error'); if (e.status === 409) loadOra(); });
  }
  function rtLemond(az) {
    var b = (oc.adat.resztvevok || []).filter(function (x) { return x.azonosito === az; })[0];
    if (!b) return;
    var d = $('#dlg-ora'); d.close();
    confirmDlg('Lemondod a jelentkezést?', b.nev + ', ' + oc.adat.ora.ora.nev + ', ' + F.datumNap(oc.adat.ora.datum) + ' ' + oc.adat.ora.kezd + '. A hely felszabadul, és ha van e-mail-cím, lemondó levelet kap.', 'Lemondás').then(function (ok) {
      d.showModal();
      if (!ok) return;
      api('/ora-foglalasok/' + encodeURIComponent(az) + '/lemondas', { method: 'POST', json: {} }).then(function () {
        toast('Lemondva: ' + b.nev); renderFg(); loadOra(b.nev + ' jelentkezését lemondtuk, a hely felszabadult.');
      }).catch(function (e) { toast(e.message, 'error'); loadOra(); });
    });
  }

  /* =====================================================================
     ÓRAREND  (csoportos órák: óratípusok, heti sablon, generálás)
     API: GET/POST /ora-tipusok, PATCH /ora-tipusok/:id, GET/POST /ora-sablonok,
          PATCH/DELETE /ora-sablonok/:id, POST /orak/general
     ===================================================================== */
  var KATEGORIA = { joga: 'Jóga', pilates: 'Pilates', aerial: 'Aerial', core: 'Core', gerinc: 'Gerinctorna', egyeb: 'Egyéb' };
  var or = { tipusok: [], sablonok: [], req: 0, szerk: null };
  function openOrarend() {
    document.title = 'Órarend · Admin · Studio F360';
    var box = $('#or-main'), req = ++or.req;
    box.setAttribute('aria-busy', 'true');
    if (!box.children.length) box.innerHTML = '<div class="skel-board"></div>';
    Promise.all([loadTorzs(), api('/ora-tipusok'), api('/ora-sablonok')]).then(function (r) {
      if (req !== or.req) return;
      or.tipusok = (r[1] && r[1].tipusok) || []; or.sablonok = (r[2] && r[2].sablonok) || [];
      box.setAttribute('aria-busy', 'false');
      renderOrarend();
    }).catch(function (e) { if (req === or.req) hibaDoboz(box, e, openOrarend); });
  }
  function tipusOf(id) { return or.tipusok.filter(function (t) { return t.id === id; })[0]; }
  function ervSz(s) {
    if (!s.ervenyes_tol && !s.ervenyes_ig) return 'folyamatosan';
    if (s.ervenyes_tol && s.ervenyes_ig) return tartomany(s.ervenyes_tol, s.ervenyes_ig);
    return s.ervenyes_tol ? napRag(s.ervenyes_tol, 'tol') : napRag(s.ervenyes_ig, 'ig');
  }
  function renderOrarend() {
    var html = '<section class="be-sec or-sec" aria-labelledby="or-s-h"><div class="be-sec__head or-head"><div><h2 id="or-s-h">Heti órarend</h2>' +
      '<p>Ezekből az órákból készül a következő ' + 8 + ' hét. Az oktató cseréje minden jövőbeli órára átvezetődik. Ha a napot vagy a kezdést változtatod, a még üres jövőbeli órák újra készülnek, a jelentkezősek maradnak.</p></div>' +
      '<button type="button" class="btn btn--primary" id="or-new-s"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Új óra a heti rendbe</button></div>' +
      '<ol class="or-week">';
    for (var n = 1; n <= 7; n++) {
      var l = or.sablonok.filter(function (x) { return x.nap === n; }).sort(function (a, b) { return F.perc(a.kezd) - F.perc(b.kezd); });
      if (!l.length && n === 7) continue;
      html += '<li class="or-day' + (l.length ? '' : ' is-free') + '"><h3 class="or-day__h">' + NAP_HOSSZU[n - 1] + '<small>' + (l.length ? l.length + ' óra' : 'nincs óra') + '</small></h3><ul class="or-day__l">' +
        l.map(function (s) {
          var t = tipusOf(s.ora) || { nev: s.ora, perc: 0, kapacitas: 0, aktiv: true }, k = s.kollega ? koll(s.kollega) : null;
          return '<li><button type="button" class="or-s' + (t.aktiv ? '' : ' is-off') + '" data-sab="' + esc(s.id) + '"' + (k ? kcStyle(k) : '') + ' aria-label="' + esc(NAP_HOSSZU[n - 1] + ' ' + s.kezd + ', ' + t.nev + ', ' + (k ? k.nev : 'nincs oktató') + ', szerkesztés') + '">' +
            '<b>' + esc(s.kezd) + '</b><span class="or-s__n">' + esc(t.nev) + '</span>' +
            '<span class="or-s__m">' + esc([k ? k.nev : 'nincs oktató', t.perc + ' perc', t.kapacitas + ' hely'].join(' · ')) + '</span>' +
            ((s.ervenyes_tol || s.ervenyes_ig) ? '<span class="or-s__e">' + esc(ervSz(s)) + '</span>' : '') +
            (t.aktiv ? '' : '<span class="or-s__e">a típus szünetel</span>') + '</button></li>';
        }).join('') + '</ul></li>';
    }
    html += '</ol></section>';
    html += '<section class="be-sec or-sec" aria-labelledby="or-t-h"><div class="be-sec__head or-head"><div><h2 id="or-t-h">Óratípusok</h2>' +
      '<p>Név, hossz, ár és a létszám. A módosítás a már kiírt órákat nem írja át (azok hossza és létszáma az órán marad), csak az ezután készülőket.</p></div>' +
      '<button type="button" class="btn btn--ghost" id="or-new-t">Új óratípus</button></div>' +
      '<div class="or-types" role="table" aria-label="Óratípusok"><div class="or-types__r or-types__r--h" role="row"><span role="columnheader">Óra</span><span role="columnheader">Hossz</span><span role="columnheader">Ár</span><span role="columnheader">Létszám</span><span role="columnheader"><span class="sr">Szerkesztés</span></span></div>' +
      or.tipusok.map(function (t) {
        var megj = [t.kapacitas_megerositendo ? 'létszám' : '', t.ar_megerositendo ? 'ár' : ''].filter(Boolean);
        return '<div class="or-types__r' + (t.aktiv ? '' : ' is-off') + '" role="row"><span role="cell"><b>' + esc(t.nev) + '</b><small>' + esc((KATEGORIA[t.kategoria] || t.kategoria) + ((hely(t.helyszin) || {}).nev ? ' · ' + hely(t.helyszin).nev : '') + (t.aktiv ? '' : ' · szünetel')) +
          (megj.length ? '<span class="or-chk">egyeztetendő: ' + esc(megj.join(', ')) + '</span>' : '') + '</small></span>' +
          '<span role="cell">' + t.perc + ' perc</span><span role="cell">' + (t.ar != null ? esc(F.ft(t.ar)) : '') + '</span><span role="cell">' + t.kapacitas + ' fő</span>' +
          '<span role="cell"><button type="button" class="linkbtn" data-tip="' + esc(t.id) + '" aria-label="' + esc(t.nev) + ' szerkesztése">Szerkesztés</button></span></div>';
      }).join('') + '</div></section>';
    html += '<section class="be-sec or-gen" aria-labelledby="or-g-h"><div><h2 id="or-g-h">Órák kiírása</h2><p>A rendszer naponta magától kiírja a következő 8 hét óráit. Ha most változtattál, és azonnal a foglalóban akarod látni, kattints ide. A már kiírt órákat nem duplikálja.</p>' +
      '<p class="or-gen__st" id="or-gen-st" role="status" aria-live="polite"></p></div><button type="button" class="btn btn--primary" id="or-gen">Következő 8 hét legenerálása</button></section>';
    $('#or-main').innerHTML = html;
  }
  /* ---- óratípus szerkesztése ---- */
  function openTipus(id) {
    var t = id ? tipusOf(id) : { id: '', nev: '', kategoria: 'joga', helyszin: 'mexikoi', perc: 60, ar: 4000, kapacitas: 8, leiras: '', aktiv: true, kapacitas_megerositendo: false, ar_megerositendo: false };
    or.szerk = { tipus: 't', id: id || '' };
    $('#dlg-ot-h').textContent = id ? t.nev : 'Új óratípus';
    $('#ot-nev').value = t.nev; $('#ot-kat').innerHTML = Object.keys(KATEGORIA).map(function (k) { return '<option value="' + k + '"' + (k === t.kategoria ? ' selected' : '') + '>' + KATEGORIA[k] + '</option>'; }).join('');
    $('#ot-hely').innerHTML = optionList(torzs.helyszinek, t.helyszin);
    $('#ot-perc').value = t.perc; $('#ot-ar').value = t.ar == null ? '' : t.ar; $('#ot-kap').value = t.kapacitas; $('#ot-leiras').value = t.leiras || '';
    $('#ot-aktiv').checked = t.aktiv !== false;
    $('#ot-err').hidden = true;
    var ok = $('#ot-ok'); ok.disabled = false; ok.textContent = id ? 'Mentés' : 'Óratípus felvétele';
    $('#dlg-ot').showModal();
  }
  function submitTipus(ev) {
    ev.preventDefault();
    var err = $('#ot-err'), ok = $('#ot-ok'), id = or.szerk.id;
    var body = { nev: $('#ot-nev').value.trim(), kategoria: $('#ot-kat').value, helyszin: $('#ot-hely').value, perc: Number($('#ot-perc').value), ar: $('#ot-ar').value === '' ? null : Number($('#ot-ar').value),
      kapacitas: Number($('#ot-kap').value), leiras: $('#ot-leiras').value.trim(), aktiv: $('#ot-aktiv').checked };
    var msg = body.nev.length < 2 ? 'Add meg az óra nevét.' : !Number.isInteger(body.perc) || body.perc < 10 || body.perc > 480 || body.perc % 5 ? 'A hossz 10 és 480 perc között, 5 perces lépésben lehet.'
      : body.ar != null && (!Number.isInteger(body.ar) || body.ar < 0) ? 'Az ár egész szám legyen (Ft).' : !Number.isInteger(body.kapacitas) || body.kapacitas < 1 || body.kapacitas > 100 ? 'A létszám 1 és 100 fő között lehet.' : '';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    // ha Lilla megadja az értéket, már nem „egyeztetendő”
    var regi = id ? tipusOf(id) : null;
    if (regi && regi.kapacitas_megerositendo && body.kapacitas !== regi.kapacitas) body.kapacitas_megerositendo = false;
    if (regi && regi.ar_megerositendo && body.ar !== regi.ar) body.ar_megerositendo = false;
    err.hidden = true; ok.disabled = true; ok.textContent = 'Mentés folyamatban';
    (id ? api('/ora-tipusok/' + encodeURIComponent(id), { method: 'PATCH', json: body }) : api('/ora-tipusok', { method: 'POST', json: body })).then(function (t) {
      $('#dlg-ot').close(); toast('Mentve: ' + t.nev + '. Az ezután kiírt órák már így készülnek.'); openOrarend();
    }).catch(function (e) { ok.disabled = false; ok.textContent = id ? 'Mentés' : 'Óratípus felvétele'; err.textContent = e.message; err.hidden = false; });
  }
  /* ---- heti sablon szerkesztése ---- */
  function openSablon(id) {
    if (!or.tipusok.length) { toast('Előbb vegyél fel egy óratípust.', 'error'); return; }
    var s = id ? or.sablonok.filter(function (x) { return x.id === id; })[0] : { id: '', ora: or.tipusok[0].id, kollega: '', nap: 1, kezd: '18:00', ervenyes_tol: '', ervenyes_ig: '' };
    or.szerk = { tipus: 's', id: id || '' };
    $('#dlg-os-h').textContent = id ? 'Óra a heti rendben' : 'Új óra a heti rendbe';
    $('#os-ora').innerHTML = or.tipusok.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === s.ora ? ' selected' : '') + '>' + esc(t.nev + ' · ' + t.perc + ' perc' + (t.aktiv ? '' : ' (szünetel)')) + '</option>'; }).join('');
    var kl = torzs.kollegak.filter(function (k) { return nemArchiv(k) || k.id === s.kollega; });
    $('#os-koll').innerHTML = '<option value="">Nincs megadva</option>' + optionList(kl, s.kollega || '');
    $('#os-nap').innerHTML = NAP_HOSSZU.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === s.nap ? ' selected' : '') + '>' + n + '</option>'; }).join('');
    $('#os-kezd').innerHTML = IDO.map(function (t) { return '<option' + (t === s.kezd ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    $('#os-tol').value = s.ervenyes_tol || ''; $('#os-ig').value = s.ervenyes_ig || '';
    $('#os-err').hidden = true; $('#os-del').hidden = !id;
    var ok = $('#os-ok'); ok.disabled = false; ok.textContent = id ? 'Mentés' : 'Felvétel a heti rendbe';
    $('#dlg-os').showModal();
  }
  function submitSablon(ev) {
    ev.preventDefault();
    var err = $('#os-err'), ok = $('#os-ok'), id = or.szerk.id;
    var body = { ora: $('#os-ora').value, kollega: $('#os-koll').value || null, nap: Number($('#os-nap').value), kezd: $('#os-kezd').value, ervenyes_tol: $('#os-tol').value, ervenyes_ig: $('#os-ig').value };
    if (body.ervenyes_tol && body.ervenyes_ig && body.ervenyes_tol > body.ervenyes_ig) { err.textContent = 'Az „Utolsó nap” nem lehet korábbi az „Első nap”-nál.'; err.hidden = false; return; }
    err.hidden = true; ok.disabled = true; ok.textContent = 'Mentés folyamatban';
    (id ? api('/ora-sablonok/' + encodeURIComponent(id), { method: 'PATCH', json: body }) : api('/ora-sablonok', { method: 'POST', json: body })).then(function (r) {
      $('#dlg-os').close();
      toast('Mentve. ' + (r && r.letrehozva ? r.letrehozva + ' új óra került a foglalóba.' : 'A jövőbeli órák frissültek.'));
      openOrarend();
    }).catch(function (e) { ok.disabled = false; ok.textContent = id ? 'Mentés' : 'Felvétel a heti rendbe'; err.textContent = e.message; err.hidden = false; });
  }
  function torolSablon() {
    var id = or.szerk.id, s = or.sablonok.filter(function (x) { return x.id === id; })[0], t = s && tipusOf(s.ora);
    $('#dlg-os').close();
    confirmDlg('Kiveszed a heti rendből?', (t ? t.nev : 'Az óra') + ', ' + NAP_HOSSZU[s.nap - 1].toLowerCase() + ' ' + s.kezd + '. A még üres jövőbeli órái törlődnek. Ahol már van jelentkező, az az óra megmarad, azt a Foglalások fülön tudod elmaradtnak jelölni.', 'Kivétel').then(function (ok) {
      if (!ok) return;
      api('/ora-sablonok/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
        toast('Kivéve a heti rendből. ' + (r.toroltOrak ? r.toroltOrak + ' üres óra törölve. ' : '') + (r.resztvevosOrakMaradtak ? r.resztvevosOrakMaradtak + ' jelentkezős óra megmaradt.' : ''));
        openOrarend();
      }).catch(function (e) { toast(e.message, 'error'); });
    });
  }
  function generalOrak() {
    var b = $('#or-gen'), st = $('#or-gen-st');
    b.disabled = true; b.textContent = 'Kiírás folyamatban'; st.textContent = '';
    api('/orak/general', { method: 'POST', json: {} }).then(function (r) {
      b.disabled = false; b.textContent = 'Következő 8 hét legenerálása';
      st.textContent = r && r.letrehozva ? r.letrehozva + ' új óra került a foglalóba.' : 'Minden óra ki van már írva a következő 8 hétre, új nem kellett.';
    }).catch(function (e) { b.disabled = false; b.textContent = 'Következő 8 hét legenerálása'; st.textContent = e.message; });
  }

  /* =====================================================================
     2/a. KOLLÉGÁK  (POST /kollegak, PATCH /kollegak/:id, POST /kollegak/:id/archivalas)
     ===================================================================== */
  var ko = { lista: 'aktiv', kid: '', uj: false, dirty: false, form: null, helyi: null, upReq: 0 };
  // a kolléga állapota egy adott napon (a backend aktivANapon szerint)
  function koAllapot(k) {
    var ma = F.most().datum;
    if (k.archivalt) return { kod: 'archiv', szoveg: 'Archivált' };
    if (k.aktiv_ig && k.aktiv_ig < ma) return { kod: 'kilepett', szoveg: 'Már nem foglalható, utolsó nap: ' + F.honapNap(k.aktiv_ig) };
    if (k.aktiv_tol && k.aktiv_tol > ma) return { kod: 'jovo', szoveg: 'Még nem foglalható, első nap: ' + F.honapNap(k.aktiv_tol) };
    if (k.aktiv_ig) return { kod: 'aktiv', szoveg: 'Aktív, utolsó nap: ' + F.honapNap(k.aktiv_ig) };
    return { kod: 'aktiv', szoveg: 'Aktív' };
  }
  function fotoSrc(u) {
    // a /útvonal a weboldal gyökeréhez képest (az admin egy mappával lejjebb van)
    if (!u) return '';
    return /^https:\/\//.test(u) ? u : '..' + u;
  }
  function koAvatar(k, cls) {
    var f = fotoSrc(k.foto);
    return '<span class="kav' + (cls ? ' ' + cls : '') + '"' + kcStyle(k) + ' aria-hidden="true">' +
      (f ? '<img src="' + esc(f) + '" alt="" width="96" height="96" loading="lazy">' : '') +
      '<span>' + esc(monogram(k.nev)) + '</span></span>';
  }
  function openKollegak(sub) {
    document.title = 'Kollégák · Admin · Studio F360';
    if (ko.dirty && sub !== (ko.uj ? 'uj' : ko.kid) && !confirm('A kolléga adatain mentetlen változás van. Elveted?')) {
      history.replaceState(null, '', '#/kollegak/' + (ko.uj ? 'uj' : ko.kid)); return;
    }
    ko.dirty = false;
    var main = $('#ko-main');
    main.setAttribute('aria-busy', 'true');
    // másik kolléga vagy új: az előző adatlap a betöltésig ne maradjon kitölthető (különben a régire írna)
    if ((sub || '') !== (ko.uj ? 'uj' : ko.kid) || !$('#ko-form')) main.innerHTML = '<div class="skel-board"></div>';
    loadTorzs(true).then(function () {
      if (sub === 'uj') { ko.uj = true; ko.kid = ''; }
      else {
        ko.uj = false;
        if (sub && koll(sub)) { ko.kid = sub; ko.lista = koll(sub).archivalt ? 'archiv' : 'aktiv'; }
        var lathato = koLathato();
        if (!ko.kid || !koll(ko.kid)) ko.kid = lathato[0] ? lathato[0].id : '';
      }
      renderKoList();
      renderKoForm();
      main.setAttribute('aria-busy', 'false');
    }).catch(function (e) { hibaDoboz(main, e, function () { openKollegak(sub); }); });
  }
  function koLathato() {
    return torzs.kollegak.filter(function (k) { return ko.lista === 'archiv' ? k.archivalt : !k.archivalt; });
  }
  function renderKoList() {
    $$('[data-kolista]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-kolista') === ko.lista ? 'true' : 'false'); });
    var l = koLathato(), ul = $('#ko-list');
    if (!l.length) { ul.innerHTML = '<li class="empty-inline">' + (ko.lista === 'archiv' ? 'Nincs archivált kolléga.' : 'Még nincs kolléga. Vegyél fel egyet az Új kolléga gombbal.') + '</li>'; return; }
    ul.innerHTML = l.map(function (k) {
      var a = koAllapot(k), on = !ko.uj && k.id === ko.kid;
      return '<li><a class="ko-item' + (on ? ' is-on' : '') + '" href="#/kollegak/' + esc(k.id) + '"' + (on ? ' aria-current="true"' : '') + '>' + koAvatar(k) +
        '<span class="ko-item__t"><b>' + esc(k.nev) + '</b><small>' + esc(k.helyszinek.map(function (h) { return (hely(h) || {}).nev || h; }).join(', ')) + '</small></span>' +
        '<span class="ko-st ko-st--' + a.kod + '">' + esc(a.szoveg) + '</span></a></li>';
    }).join('');
  }
  function koUres() {
    return { id: '', nev: '', szerep: '', helyszinek: [torzs.helyszinek[0].id], szolgaltatasok: [], szin: '', email: '', aktiv_tol: F.most().datum, aktiv_ig: '', foto: '', bemutatkozas: '', archivalt: false, naptar_id: '' };
  }
  function renderKoForm() {
    var main = $('#ko-main');
    var k = ko.uj ? koUres() : koll(ko.kid);
    if (!k) { main.innerHTML = '<div class="empty-state"><p>Válassz kollégát a listából, vagy vegyél fel újat.</p></div>'; return; }
    ko.form = JSON.parse(JSON.stringify(k));
    var f = ko.form, a = koAllapot(f);
    var cur = ko.uj ? '' : szinOf(k), sajat = cur && !PALETTA.some(function (p) { return p.hex === cur; });
    var html = '<form class="ko-card" id="ko-form" novalidate' + kcStyle(k) + '>' +
      '<div class="ko-card__head">' + koAvatar(f, 'kav--lg') + '<div><h2 id="ko-form-h">' + esc(ko.uj ? 'Új kolléga' : f.nev) + '</h2>' +
        (ko.uj ? '<p>A mentés után azonnal foglalható, ha van beosztása.</p>' : '<p><span class="ko-st ko-st--' + a.kod + '">' + esc(a.szoveg) + '</span></p>') + '</div>' +
        (ko.uj ? '' : '<a class="btn btn--ghost ko-card__bo" href="#/beosztas/' + esc(f.id) + '">Beosztás és szabadság</a>') + '</div>' +
      // alapadatok
      '<fieldset class="ko-sec"><legend>Alapadatok</legend><div class="grid2">' +
        '<div class="field"><label for="ko-nev">Név</label><input type="text" id="ko-nev" data-ko="nev" maxlength="100" required value="' + esc(f.nev) + '" autocomplete="off"></div>' +
        '<div class="field"><label for="ko-szerep">Szerep</label><input type="text" id="ko-szerep" data-ko="szerep" maxlength="200" value="' + esc(f.szerep || '') + '" placeholder="Például: gyógytornász, manuálterapeuta"></div>' +
      '</div></fieldset>' +
      // helyszín + kezelések
      '<fieldset class="ko-sec"><legend>Hol dolgozik és mit lehet hozzá foglalni</legend>' +
        '<div class="erow__sub"><span class="erow__lbl">Helyszín</span>' + torzs.helyszinek.map(function (h) { return chk('koh', h.id, f.helyszinek.indexOf(h.id) >= 0, h.nev); }).join('') + '</div>' +
        '<div class="ko-assign">' + koAssign(f) + '</div>' +
      '</fieldset>' +
      // foglalhatóság (nem csak alkalmazott: vállalkozó, külsős partner is; a backend mezői aktiv_tol, aktiv_ig)
      '<fieldset class="ko-sec"><legend>Foglalhatóság</legend><div class="grid2">' +
        '<div class="field"><label for="ko-tol">Mettől foglalható <span class="opt">(nem kötelező)</span></label><input type="date" id="ko-tol" data-ko="aktiv_tol" value="' + esc(f.aktiv_tol || '') + '" aria-describedby="ko-tol-h"><p class="hint" id="ko-tol-h">Előtte a foglaló nem ad hozzá időpontot.</p></div>' +
        '<div class="field"><label for="ko-ig">Meddig foglalható <span class="opt">(nem kötelező)</span></label><input type="date" id="ko-ig" data-ko="aktiv_ig" value="' + esc(f.aktiv_ig || '') + '" aria-describedby="ko-ig-h"><p class="hint" id="ko-ig-h">Ezen a napon még foglalható, utána már nem, és lekerül a foglalóról.</p></div>' +
      '</div></fieldset>' +
      // értesítés
      '<fieldset class="ko-sec"><legend>Értesítés</legend>' +
        '<div class="field ko-email"><label for="ko-email">Privát e-mail-cím <span class="opt">(nem kötelező)</span></label><input type="email" id="ko-email" data-ko="email" maxlength="254" inputmode="email" autocomplete="off" value="' + esc(f.email || '') + '" aria-describedby="ko-email-h"><p class="hint" id="ko-email-h">Ide kap levelet új foglalásról, módosításról és lemondásról' + (torzs.szabalyok && torzs.szabalyok.ertesitKollega === false ? '. A kollégák értesítése most ki van kapcsolva a Beállításokban.' : '.') + ' A weboldalon nem jelenik meg.</p></div>' +
      '</fieldset>' +
      // google naptár: a foglalásai ide kerülnek (a Beállítások Google Naptár blokkja mutatja az állapotot)
      '<fieldset class="ko-sec"><legend>Google Naptár</legend>' +
        '<div class="field ko-email"><label for="ko-gcal">Google Naptár azonosító <span class="opt">(nem kötelező)</span></label><input type="text" id="ko-gcal" data-ko="naptar_id" maxlength="254" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(f.naptar_id || '') + '" placeholder="pl. abc123…@group.calendar.google.com" aria-describedby="ko-gcal-h">' +
        '<p class="hint" id="ko-gcal-h">A Google Naptárban a naptár neve melletti három pont, Beállítások és megosztás, majd a Naptár integrálása résznél a Naptárazonosító sor. Ide kerülnek a foglalásai, a kolléga színével. <a href="#/beallitasok">A bekötés állapota a Beállításokban</a></p></div>' +
      '</fieldset>' +
      // szín
      '<fieldset class="ko-sec kc-pick kc-pick--form"><legend>Szín a naptárban</legend>' +
        '<p class="kc-pick__d">Ezzel a színnel látszanak a foglalásai a napi és a heti nézetben.' + (ko.uj ? ' Ha nem választasz, a rendszer szabad színt ad.' : '') + '</p>' +
        '<div class="kc-pick__row">' + PALETTA.map(function (p) {
          var foglalt = kiHasznalja(p.hex, f.id);
          return '<label class="kc-sw" style="--kc:' + p.hex + '" title="' + esc(p.nev + (foglalt.length ? ', ' + foglalt.join(', ') + ' is ezt használja' : '')) + '">' +
            '<input type="radio" name="ko-szin" value="' + p.hex + '"' + (p.hex === cur ? ' checked' : '') + '>' +
            '<span class="kc-sw__c" aria-hidden="true"></span><span class="sr">' + esc(p.nev) + (foglalt.length ? ' (' + esc(foglalt.join(', ')) + ' is ezt használja)' : '') + '</span>' +
            (foglalt.length ? '<span class="kc-sw__used" aria-hidden="true"></span>' : '') + '</label>';
        }).join('') +
        '<label class="kc-own' + (sajat ? ' is-on' : '') + '"><input type="color" id="ko-own" value="' + (cur || '#4f6d8a') + '"><span>Egyedi szín</span></label>' +
        '</div><p class="kc-pick__n" id="ko-szin-n" aria-live="polite"></p></fieldset>' +
      // bemutatkozás
      '<fieldset class="ko-sec"><legend>Bemutatkozás</legend><div class="ko-intro">' +
        '<div class="ko-photo" id="ko-drop"><span class="ko-photo__f" id="ko-photo-f">' + koFotoPrev(f) + '</span><span class="ko-drop__t" aria-hidden="true">Engedd el a képet</span></div>' +
        '<div class="ko-intro__f">' +
          '<div class="field ko-up"><span class="ko-up__l" id="ko-up-l">Fotó</span>' +
            '<div class="ko-up__b"><input type="file" id="ko-file" class="ko-up__in" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" aria-labelledby="ko-up-l ko-file-l" aria-describedby="ko-up-h ko-up-st">' +
            '<label for="ko-file" class="btn btn--ghost" id="ko-file-l"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 13.5V16h12v-2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>Fotó feltöltése</label>' +
            '<button type="button" class="linkbtn linkbtn--danger" id="ko-foto-del"' + (f.foto ? '' : ' hidden') + '>Fotó eltávolítása</button></div>' +
            '<p class="hint" id="ko-up-h">Válaszd ki a képet, vagy húzd a bal oldali négyzetre. A rendszer négyzetesre vágja (a kép közepéből) és 800 px-re kicsinyíti, a telefonos fotó forgatását is javítja.</p>' +
            '<p class="ko-up__st" id="ko-up-st" aria-live="polite"></p>' +
            '<details class="ko-url"' + (f.foto && /^https:/.test(f.foto) ? ' open' : '') + '><summary>Vagy webcím</summary>' +
              '<div class="field"><label for="ko-foto">A fotó webcíme</label><input type="url" id="ko-foto" data-ko="foto" maxlength="500" inputmode="url" value="' + esc(f.foto || '') + '" placeholder="https://… vagy /media/brand/csapat/nev.jpg" aria-describedby="ko-foto-h"><p class="hint" id="ko-foto-h">https:// kezdetű cím, vagy a weboldalon belüli út, ami /-rel kezdődik.</p></div>' +
            '</details></div>' +
          '<div class="field"><label for="ko-bem">Rövid bemutatkozás <span class="opt">(nem kötelező)</span></label><textarea id="ko-bem" data-ko="bemutatkozas" rows="5" maxlength="2000" aria-describedby="ko-bem-h ko-bem-r">' + esc(f.bemutatkozas || '') + '</textarea><p class="hint" id="ko-bem-h"><span id="ko-bem-n">' + (f.bemutatkozas || '').length + '</span> / 2000 karakter.</p>' +
            '<p class="hint ko-rolunk" id="ko-bem-r">' + (f.archivalt ? 'Archivált kollégaként most nem szerepel a Rólunk oldalon.' : 'Ez jelenik meg a Rólunk oldalon is, pár percen belül.') +
            ' <a href="/rolunk#csapat" target="_blank" rel="noopener">Megnézem a Rólunk oldalon<span class="sr"> (új lapon nyílik)</span></a></p></div>' +
        '</div></div></fieldset>' +
      '<p class="form-err" id="ko-err" role="alert" hidden></p>' +
      '<div class="savebar" id="ko-savebar"><p id="ko-state" aria-live="polite">' + (ko.uj ? 'Új kolléga, még nincs mentve' : 'Mentve') + '</p>' +
        (ko.uj ? '<a class="btn btn--ghost" href="#/kollegak">Mégse</a>' : (f.archivalt
          ? '<button type="button" class="btn btn--ghost" id="ko-vissza">Visszaállítás aktívra</button>'
          : '<button type="button" class="linkbtn linkbtn--danger" id="ko-arch">Archiválás</button>')) +
        '<button type="submit" class="btn btn--primary" id="ko-save"' + (ko.uj ? '' : ' disabled') + '>' + (ko.uj ? 'Kolléga felvétele' : 'Változások mentése') + '</button></div>' +
      '</form>';
    main.innerHTML = html;
    if (ko.uj) $('#ko-nev').focus();
  }
  function koFotoPrev(f) {
    var u = (ko.helyi && ko.helyi.path === f.foto) ? ko.helyi.url : fotoSrc(f.foto);
    return u ? '<img src="' + esc(u) + '" alt="A fotó előnézete" width="240" height="240" data-koprev>'
      : '<span class="ko-photo__x">' + esc(monogram(f.nev) || 'Fotó') + '<small>Nincs fotó</small></span>';
  }

  /* ---------- kolléga-fotó feltöltése (POST /api/upload, mint a blog borítóképe) ----------
     A böngészőben: EXIF-forgatás (createImageBitmap imageOrientation:'from-image'), a kép közepéből
     négyzet, 800 px, WebP (JPG tartalék). Az előnézet azonnal a helyi képből látszik, a feltöltés után
     a kapott út kerül a foto mezőbe (a mentés a „Változások mentése” gombbal megy). Ha a környezetben
     a feltöltés nincs beállítva (503, kod: blog_nincs_beallitva): nyugodt tájékoztatás, nem hiba. */
  var FOTO_OLDAL = 800;
  function fotoDecode(file) {
    var img = function () {
      return new Promise(function (ok, no) { var u = URL.createObjectURL(file), i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { URL.revokeObjectURL(u); no(new Error('decode')); }; i.src = u; });
    };
    return window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(img) : img();
  }
  function fotoKeszit(file) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) return Promise.reject(new Error('Ez nem képfájl. JPG, PNG vagy WebP képet válassz.'));
    return fotoDecode(file).catch(function () { throw new Error('Ezt a képet a böngésző nem tudja megnyitni. Mentsd el JPG-ként, és próbáld újra.'); }).then(function (bmp) {
      var w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height, side = Math.min(w, h), out = Math.min(FOTO_OLDAL, side);
      var c = document.createElement('canvas'); c.width = out; c.height = out;
      var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, Math.round((w - side) / 2), Math.round((h - side) / 2), side, side, 0, 0, out, out);
      if (bmp.close) bmp.close();
      var tb = function (t, q) { return new Promise(function (ok) { c.toBlob(ok, t, q); }); };
      return tb('image/webp', 0.86).then(function (b) { return b && b.type === 'image/webp' ? b : tb('image/jpeg', 0.88); }).then(function (b) {
        if (!b) throw new Error('A kép átalakítása nem sikerült.');
        if (b.size > 5 * 1024 * 1024) throw new Error('A kép átalakítva is túl nagy (legfeljebb 5 MB).');
        return { blob: b, w: out, ext: b.type === 'image/webp' ? 'webp' : 'jpg' };
      });
    });
  }
  function fotoAllapot(t, kind) { var st = $('#ko-up-st'); if (st) { st.textContent = t; st.dataset.kind = kind || 'info'; } }
  function fotoFeltolt(file) {
    var f = ko.form, req = ++ko.upReq, regi = f.foto, lbl = $('#ko-file-l');
    if (!file) return;
    fotoAllapot('A kép előkészítése…');
    $('#ko-drop').classList.remove('is-over');
    fotoKeszit(file).then(function (r) {
      if (req !== ko.upReq || ko.form !== f) return;
      var helyiUrl = URL.createObjectURL(r.blob);
      $('#ko-photo-f').innerHTML = '<img src="' + helyiUrl + '" alt="A fotó előnézete" width="240" height="240">';
      $('#ko-drop').setAttribute('aria-busy', 'true'); if (lbl) lbl.classList.add('is-busy');
      fotoAllapot('Feltöltés folyamatban (' + r.w + '×' + r.w + ' px, ' + Math.round(r.blob.size / 1024) + ' kB)…');
      var fd = new FormData();
      fd.append('file', r.blob, 'kollega.' + r.ext);
      fd.append('name', 'csapat-' + (f.id || f.nev || 'kollega'));
      return fetch('/api/upload', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (res) {
        return res.text().then(function (txt) {
          var d = null; try { d = txt ? JSON.parse(txt) : null; } catch (e) { d = null; }
          if (!res.ok) { var er = new Error((d && d.error) || 'A feltöltés nem sikerült (' + res.status + ').'); er.status = res.status; er.data = d; throw er; }
          return d;
        });
      }, function () { throw new Error('Nincs kapcsolat a szerverrel. Ellenőrizd az internetet, és próbáld újra.'); }).then(function (d) {
        if (req !== ko.upReq || ko.form !== f) return;
        if (!d || !d.path) throw new Error('A feltöltés nem adott vissza útvonalat.');
        var ut = '/' + String(d.path).replace(/^\/+/, '');
        ko.helyi = { path: ut, url: helyiUrl };
        f.foto = ut; $('#ko-foto').value = ut; $('#ko-foto-del').hidden = false;
        $('#ko-photo-f').innerHTML = koFotoPrev(f);
        fotoAllapot('Feltöltve. Mentsd el az adatlapot, és pár perc múlva a weboldalon is megjelenik.', 'ok');
        koChanged();
      }).catch(function (e) {
        if (req !== ko.upReq || ko.form !== f) return;
        URL.revokeObjectURL(helyiUrl);
        f.foto = regi; $('#ko-photo-f').innerHTML = koFotoPrev(f);
        var nincs = e.status === 503 && e.data && e.data.kod === 'blog_nincs_beallitva';
        fotoAllapot(nincs ? 'A fotó feltöltése az éles adminban működik. Itt webcímmel adhatsz meg fotót.' : e.message, nincs ? 'info' : 'error');
      }).then(function () { var dr = $('#ko-drop'); if (dr) dr.setAttribute('aria-busy', 'false'); if (lbl) lbl.classList.remove('is-busy'); });
    }).catch(function (e) { if (req === ko.upReq) fotoAllapot(e.message, 'error'); });
  }
  function fotoTorol() {
    var f = ko.form; if (!f) return;
    ko.upReq++; f.foto = ''; $('#ko-foto').value = '';
    $('#ko-photo-f').innerHTML = koFotoPrev(f); $('#ko-foto-del').hidden = true;
    fotoAllapot('A fotó lekerül, a monogram jelenik meg. Mentsd el az adatlapot.');
    koChanged(); $('#ko-file-l').focus();
  }
  function koAssign(f) {
    var helyek = torzs.helyszinek.filter(function (h) { return f.helyszinek.indexOf(h.id) >= 0; });
    if (!helyek.length) return '<p class="hint">Jelölj be legalább egy helyszínt.</p>';
    return helyek.map(function (h) {
      var sl = torzs.szolgaltatasok.filter(function (s) { return s.helyszinek.indexOf(h.id) >= 0; });
      return '<div class="assign"><span class="assign__h">' + esc(h.nev) + '</span>' + sl.map(function (s) { return chk('kos', s.id, f.szolgaltatasok.indexOf(s.id) >= 0, s.nev + ' ' + s.perc + "'"); }).join('') + '</div>';
    }).join('');
  }
  function koChanged() {
    ko.dirty = true;
    var st = $('#ko-state'); if (st) st.textContent = ko.uj ? 'Új kolléga, még nincs mentve' : 'Mentetlen változás';
    $('#ko-save').disabled = false;
    $('#ko-savebar').classList.add('is-dirty');
  }
  function koInput(e) {
    var el = e.target, f = ko.form;
    if (!f) return;
    if (el.dataset.ko) {
      f[el.dataset.ko] = el.value;
      if (el.dataset.ko === 'bemutatkozas') $('#ko-bem-n').textContent = el.value.length;
      if (el.dataset.ko === 'foto' && e.type === 'change') { $('#ko-photo-f').innerHTML = koFotoPrev(f); $('#ko-foto-del').hidden = !f.foto; }
      if (el.dataset.ko === 'nev' && ko.uj) $('#ko-form-h').textContent = el.value.trim() || 'Új kolléga';
    } else if (el.dataset.koh) {
      toggleIn(f.helyszinek, el.dataset.koh, el.checked);
      // a már nem érintett helyszín kezelései lekerülnek
      f.szolgaltatasok = f.szolgaltatasok.filter(function (sid) { var sv = szolg(sid); return sv && sv.helyszinek.some(function (h) { return f.helyszinek.indexOf(h) >= 0; }); });
      $('.ko-assign').innerHTML = koAssign(f);
    } else if (el.dataset.kos) {
      toggleIn(f.szolgaltatasok, el.dataset.kos, el.checked);
    } else if (el.name === 'ko-szin' || el.id === 'ko-own') {
      var hex = String(el.value).toLowerCase(), n = $('#ko-szin-n');
      if (kontraszt(hex, '#ffffff') < 3) { n.textContent = 'Ez a szín túl világos, a naptárban alig látszana. Válassz sötétebbet.'; return; }
      f.szin = hex;
      $('.kc-own').classList.toggle('is-on', el.id === 'ko-own');
      if (el.id === 'ko-own') $$('input[name="ko-szin"]').forEach(function (r) { r.checked = r.value === hex; });
      $('#ko-form').style.setProperty('--kc', hex);
      n.textContent = szinMegjegyzes(hex, f.id || '');
    } else return;
    koChanged();
  }
  function koValid(f) {
    if (String(f.nev || '').trim().length < 2) return { mezo: 'ko-nev', uzenet: 'Add meg a kolléga nevét.' };
    if (!f.helyszinek.length) return { mezo: 'ko-nev', uzenet: 'Jelöld be, melyik helyszínen dolgozik.' };
    if (f.email && !/^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(String(f.email).trim())) return { mezo: 'ko-email', uzenet: 'A privát e-mail-cím nem tűnik érvényesnek. Például: nev@gmail.com' };
    if (f.aktiv_tol && f.aktiv_ig && f.aktiv_tol > f.aktiv_ig) return { mezo: 'ko-ig', uzenet: 'A „Meddig foglalható” nap nem lehet korábbi a „Mettől foglalható” napnál.' };
    var fo = String(f.foto || '').trim();
    if (fo && !/^https:\/\/[^\s"'<>\\]+$/.test(fo) && !/^\/(?![/\\])[^\s"'<>\\]*$/.test(fo)) return { mezo: 'ko-foto', uzenet: 'A fotó címe https://-sel vagy /-rel kezdődjön.' };
    var gh = gcAzonHiba(f.naptar_id); if (gh) return { mezo: 'ko-gcal', uzenet: 'Google Naptár: ' + gh };
    return null;
  }
  function koMezok(f) {
    var ki = { nev: String(f.nev).trim(), szerep: String(f.szerep || '').trim(), helyszinek: f.helyszinek.slice(), szolgaltatasok: f.szolgaltatasok.slice(),
      email: String(f.email || '').trim(), aktiv_tol: f.aktiv_tol || '', aktiv_ig: f.aktiv_ig || '', foto: String(f.foto || '').trim(), bemutatkozas: String(f.bemutatkozas || '').trim(), naptar_id: String(f.naptar_id || '').trim() };
    if (f.szin) ki.szin = f.szin;
    return ki;
  }
  function koHiba(e, err) {
    err.textContent = e.message + (e.status === 409 && e.data && e.data.jovobeli ? ' A foglalásait a Foglalások fülön találod, a szakember-szűrővel.' : '');
    err.hidden = false;
  }
  function submitKo(ev) {
    ev.preventDefault();
    var f = ko.form, err = $('#ko-err'), b = $('#ko-save');
    var v = koValid(f);
    if (v) { err.textContent = v.uzenet; err.hidden = false; var el = $('#' + v.mezo); if (el) el.focus(); return; }
    err.hidden = true;
    var body = koMezok(f);
    b.disabled = true; b.textContent = 'Mentés folyamatban';
    var req = ko.uj ? api('/kollegak', { method: 'POST', json: body }) : api('/kollegak/' + encodeURIComponent(ko.kid), { method: 'PATCH', json: body });
    req.then(function (k) {
      ko.dirty = false;
      toast(ko.uj ? 'Felvéve: ' + k.nev + '. Add meg a heti beosztását, hogy foglalható legyen.' : 'Mentve: ' + k.nev);
      var uj = ko.uj; ko.uj = false; ko.kid = k.id; ko.lista = k.archivalt ? 'archiv' : 'aktiv';
      if (be.t && !be.dirty) be.t = null;
      return loadTorzs(true).then(function () {
        if (uj) location.hash = '#/kollegak/' + k.id; else { renderKoList(); renderKoForm(); }
      });
    }).catch(function (e) {
      b.disabled = false; b.textContent = ko.uj ? 'Kolléga felvétele' : 'Változások mentése';
      koHiba(e, err);
    });
  }
  function archivKo(vissza) {
    var k = koll(ko.kid);
    if (!k) return;
    var go = function () {
      var req = vissza ? api('/kollegak/' + encodeURIComponent(k.id), { method: 'PATCH', json: { archivalt: false } })
        : api('/kollegak/' + encodeURIComponent(k.id) + '/archivalas', { method: 'POST', json: {} });
      req.then(function () {
        toast(vissza ? k.nev + ' újra aktív. Ha kell, adj meg neki beosztást.' : k.nev + ' archiválva. A régi foglalásai megmaradnak.');
        ko.dirty = false; ko.lista = vissza ? 'aktiv' : 'archiv';
        return loadTorzs(true).then(function () { renderKoList(); renderKoForm(); });
      }).catch(function (e) { koHiba(e, $('#ko-err')); $('#ko-err').scrollIntoView({ block: 'center' }); });
    };
    if (vissza) return go();
    confirmDlg('Archiválod ' + k.nev + ' adatlapját?', 'Lekerül a foglalóról, és új időpontot nem lehet hozzá foglalni. A korábbi foglalásai és levelei megmaradnak, és később visszaállíthatod. Ha van még jövőbeli foglalása, előbb azokat kell áthelyezni vagy lemondani.', 'Archiválás').then(function (ok) { if (ok) go(); });
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
      if (!bo.kid || !koll(bo.kid)) { var elso = torzs.kollegak.filter(nemArchiv)[0]; bo.kid = elso && elso.id; }
      // másik kolléga: az előző kártyája (és színválasztója) ne maradjon kattintható a betöltésig
      if (elozo !== bo.kid) $('#bo-main').innerHTML = '<div class="skel-board"></div>';
      renderPeople();
      loadBo();
    }).catch(function (e) { hibaDoboz($('#bo-main'), e, function () { openBeosztas(sub); }); });
  }
  function renderPeople() {
    $('#bo-people').innerHTML = torzs.kollegak.filter(function (k) { return nemArchiv(k) || k.id === bo.kid; }).map(function (k) {
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
      '<div class="bo-card__act"><a class="btn btn--ghost" href="#/kollegak/' + esc(k.id) + '">Adatlap</a><button type="button" class="btn btn--ghost" id="bo-copy">Hétfő másolása keddtől péntekig</button></div></div>' +
      (koAllapot(k).kod !== 'aktiv' ? '<p class="note bo-note">' + esc(k.nev) + ': ' + esc(koAllapot(k).szoveg.toLowerCase()) + '. ' + (k.archivalt ? 'A foglaló nem ad hozzá időpontot.' : 'A foglalható időszakon kívüli napokra a foglaló nem ad időpontot, a beosztás ettől még megmarad.') + '</p>' : '') +
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
      var d = x.tol === x.ig ? F.datumNap(x.tol) : tartomany(x.tol, x.ig);
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
      toast('Felvéve: ' + (body.kollega ? koll(body.kollega).nev : hely(body.helyszin).nev + ' zárva') + ', ' + (body.tol === body.ig ? F.datumNap(body.tol) : tartomany(body.tol, body.ig)));
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
    if (be.dirty && be.t) { renderBe(); return loadGcal(); }
    form.innerHTML = '<div class="skel-board"></div>';
    loadTorzs(true).then(function (t) { be.t = JSON.parse(JSON.stringify(t)); be.dirty = false; renderBe(); loadGcal(); })
      .catch(function (e) { hibaDoboz(form, e, openBeallitasok); });
  }
  function chk(name, val, on, label, extra) {
    return '<label class="tick-l"><input type="checkbox" data-' + name + '="' + esc(val) + '"' + (on ? ' checked' : '') + (extra || '') + '><span>' + esc(label) + '</span></label>';
  }
  /* ---- a felkínált kezdések lépése (a backend szabad.js kinalasLepes másolata, csak megjelenítéshez) ---- */
  var KIN_RACS = 15, KIN_PELDA_KEZD = 9 * 60;
  var KIN_OPC = [['igazitott', 'A kezelés hosszához igazítva (ajánlott)'], [15, '15 percenként'], [30, '30 percenként'], [60, 'Óránként']];
  function kinGlobal(t) { var k = (t.szabalyok || {}).kinalas; return k == null ? 'igazitott' : k; }
  function kinIgazitott(sz) {
    var p = Number(sz.perc), u = sz.puffer == null ? 10 : Number(sz.puffer);
    if (!(p > 0)) return null;
    return Math.max(KIN_RACS, Math.ceil((p + (u > 0 ? u : 0)) / KIN_RACS) * KIN_RACS);
  }
  function kinErvenyes(k) { return Number.isInteger(k) && k >= KIN_RACS && k <= 240 && k % KIN_RACS === 0; }
  function kinLepes(sz, glob) {
    var k = sz.kinalas != null ? sz.kinalas : glob;
    return kinErvenyes(k) ? k : kinIgazitott(sz);
  }
  function kinSzoveg(l) { return l == null ? 'nincs megadva' : l === 60 ? 'óránként' : l + ' percenként'; }
  function kinKezdesek(l, db) {
    if (!l) return '';
    var out = []; for (var i = 0; i < (db || 4); i++) out.push(F.hm(KIN_PELDA_KEZD + i * l));
    return out.join(', ') + ' …';
  }
  // a kezelés-sor választójának értéke: '' = a közös beállítás (null), 'egyedi' = 15-240 perc, ami nem 15/30/60
  function kinValaszto(sz) {
    var k = sz.kinalas;
    if (k == null) return '';
    if (k === 'igazitott' || k === 15 || k === 30 || k === 60) return String(k);
    return 'egyedi';
  }
  function kinOpciok(sz, glob) {
    var v = kinValaszto(sz), ig = kinIgazitott(sz), kozos = kinLepes({ perc: sz.perc, puffer: sz.puffer }, glob);
    return [['', 'Közös beállítás szerint (' + kinSzoveg(kozos) + ')'], ['igazitott', 'Igazítva (' + kinSzoveg(ig) + ')'], ['15', '15 percenként'], ['30', '30 percenként'], ['60', 'Óránként'], ['egyedi', 'Egyedi…']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function kinSorHtml(sz, i, glob) {
    var v = kinValaszto(sz), l = kinLepes(sz, glob);
    return '<div class="erow__kin"><div class="field erow__kin-v"><label for="sz-k-' + i + '">Kezdések</label><select id="sz-k-' + i + '" data-szk="1" aria-describedby="sz-kt-' + i + '">' + kinOpciok(sz, glob) + '</select></div>' +
      '<div class="field erow__kin-e"' + (v === 'egyedi' ? '' : ' hidden') + '><label for="sz-ke-' + i + '">Egyedi lépés</label><div class="unit"><input id="sz-ke-' + i + '" data-szke="1" type="number" inputmode="numeric" min="15" max="240" step="15" value="' + esc(v === 'egyedi' ? sz.kinalas : (kinIgazitott(sz) || 60)) + '"><span>perc</span></div></div>' +
      '<p class="erow__kin-t" id="sz-kt-' + i + '">' + (l ? 'Kezdés: ' + esc(kinKezdesek(l, 4)) : 'Add meg az időtartamot.') + '</p></div>';
  }
  function kinPeldaHtml(t) {
    var glob = kinGlobal(t), sl = t.szolgaltatasok.filter(function (x) { return String(x.nev || '').trim(); });
    if (!sl.length) return '';
    var sel = be.pelda && sl.some(function (x) { return x.id === be.pelda; }) ? be.pelda : (sl.filter(function (x) { return x.id === 'kismama-masszazs'; })[0] || sl[0]).id;
    be.pelda = sel;
    var sz = sl.filter(function (x) { return x.id === sel; })[0], l = kinLepes({ perc: sz.perc, puffer: sz.puffer }, glob);
    var sajat = sz.kinalas != null ? kinLepes(sz, glob) : null;
    return '<div class="field kin-pelda__v"><label for="kin-pelda">Példa ezzel a kezeléssel</label><select id="kin-pelda">' +
        sl.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.nev + ' ' + x.perc + "'") + '</option>'; }).join('') + '</select></div>' +
      '<div class="kin-pelda__o" aria-live="polite"><p class="kin-pelda__n">' + esc(sz.nev) + ', ' + esc(sz.perc) + ' + ' + esc(sz.puffer == null ? 10 : sz.puffer) + ' perc</p>' +
        '<p class="kin-pelda__k">' + esc(kinKezdesek(l, 5) || 'nincs megadva időtartam') + '</p>' +
        '<p class="hint">Ha a szakember 9:00-kor kezd. Ha egy foglalás korábban ér véget, utána is felkínálunk kezdést, így nem marad kihasználatlan rés.' +
        (sajat ? ' Ennél a kezelésnél saját beállítás van: ' + esc(kinSzoveg(sajat)) + '.' : '') + '</p></div>';
  }
  function kinFrissit() {
    var t = be.t, glob = kinGlobal(t);
    $$('#be-form [data-szi]').forEach(function (row) {
      var i = +row.getAttribute('data-szi'), sz = t.szolgaltatasok[i]; if (!sz) return;
      var sel = $('[data-szk]', row), v = sel.value;
      sel.innerHTML = kinOpciok(sz, glob); sel.value = v;
      var l = kinLepes(sz, glob), p = $('.erow__kin-t', row);
      p.textContent = l ? 'Kezdés: ' + kinKezdesek(l, 4) : 'Add meg az időtartamot.';
    });
    var pe = $('#kin-pelda-box'); if (pe) pe.innerHTML = kinPeldaHtml(t);
  }
  function renderBe() {
    var t = be.t, html = '', glob = kinGlobal(t);
    // időpontok kínálása (közös): milyen kezdéseket lát a vendég
    html += '<section class="be-sec" aria-labelledby="be-kin-h"><div class="be-sec__head"><h2 id="be-kin-h">Időpontok kínálása</h2>' +
      '<p>A foglalások ütközését ez nem befolyásolja, csak azt, milyen kezdéseket lát a vendég.</p></div>' +
      '<div class="kin"><fieldset class="kin__opts"><legend class="kin__lg">Milyen időközönként kínáljuk a kezdéseket</legend>' +
      KIN_OPC.map(function (o) {
        return '<label class="kin-o"><input type="radio" name="kin" data-kin="' + o[0] + '"' + (String(glob) === String(o[0]) ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>';
      }).join('') + '</fieldset>' +
      '<div class="kin-pelda" id="kin-pelda-box">' + kinPeldaHtml(t) + '</div></div>' +
      '<p class="hint kin__fn">Kezelésenként eltérhetsz ettől: lent, a kezelésnél a Kezdések mezőben.</p></section>';
    // kezelések
    html += '<section class="be-sec" aria-labelledby="be-sz-h"><div class="be-sec__head"><h2 id="be-sz-h">Kezelések</h2><p>Ezeket lehet foglalni. Az időtartam percben, 5 perces lépésben. A szünet a következő vendégig tart (takarítás, átöltözés).</p></div><div class="rows">';
    t.szolgaltatasok.forEach(function (s, i) {
      html += '<div class="erow" data-szi="' + i + '"><div class="erow__main">' +
        '<div class="field erow__nev"><label for="sz-n-' + i + '">Név</label><input id="sz-n-' + i + '" data-sz="nev" value="' + esc(s.nev) + '" maxlength="120"></div>' +
        '<div class="field erow__num"><label for="sz-p-' + i + '">Időtartam</label><div class="unit"><input id="sz-p-' + i + '" data-sz="perc" type="number" inputmode="numeric" min="10" max="480" step="5" value="' + esc(s.perc) + '"><span>perc</span></div></div>' +
        '<div class="field erow__num"><label for="sz-a-' + i + '">Ár</label><div class="unit"><input id="sz-a-' + i + '" data-sz="ar" type="number" inputmode="numeric" min="0" step="500" value="' + esc(s.ar == null ? '' : s.ar) + '"><span>Ft</span></div></div>' +
        '<div class="field erow__num"><label for="sz-u-' + i + '">Szünet utána</label><div class="unit"><input id="sz-u-' + i + '" data-sz="puffer" type="number" inputmode="numeric" min="0" max="120" step="5" value="' + esc(s.puffer == null ? 10 : s.puffer) + '"><span>perc</span></div></div>' +
        '</div>' + kinSorHtml(s, i, glob) + '<div class="erow__sub"><span class="erow__lbl">Helyszín</span>' + t.helyszinek.map(function (h) { return chk('szh', h.id, s.helyszinek.indexOf(h.id) >= 0, h.nev); }).join('') +
        '<button type="button" class="linkbtn linkbtn--danger erow__del" data-szdel="' + i + '">Kezelés törlése</button></div></div>';
    });
    html += '</div><button type="button" class="btn btn--ghost be-add" id="be-add-sz">Új kezelés</button></section>';
    // szakemberek: a Kollégák fülön (itt csak áttekintés, hogy két helyen ne lehessen ugyanazt szerkeszteni)
    var aktivK = t.kollegak.filter(nemArchiv);
    html += '<section class="be-sec be-sec--k" aria-labelledby="be-k-h"><div class="be-sec__head"><h2 id="be-k-h">Szakemberek</h2><p>A szakembereket, a helyszínüket, a kezeléseiket és azt, hogy mettől meddig foglalhatók, a Kollégák fülön kezeled.</p></div>' +
      '<p class="be-k">' + aktivK.map(function (k) { return '<a href="#/kollegak/' + esc(k.id) + '">' + esc(k.nev) + '</a>'; }).join('') + '</p>' +
      '<a class="btn btn--ghost" href="#/kollegak">Kollégák kezelése</a></section>';
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
    // értesítések: emlékeztető a vendégnek, értesítő a kollégának
    var emOn = sz.emlekeztetoBe !== false, kOn = sz.ertesitKollega !== false;
    html += '<section class="be-sec" aria-labelledby="be-e-h"><div class="be-sec__head"><h2 id="be-e-h">Értesítések</h2><p>Automatikus levelek a vendégnek és a kollégáknak. A visszaigazolás és a lemondás mindig kimegy.</p></div><div class="notif">' +
      '<div class="notif__row"><label class="sw"><input type="checkbox" role="switch" id="r-emb" data-r="emlekeztetoBe"' + (emOn ? ' checked' : '') + ' aria-describedby="r-emb-h"><span class="sw__t" aria-hidden="true"></span><span class="sw__l">Emlékeztető a vendégnek</span></label>' +
        '<p class="hint" id="r-emb-h">A kezdés előtt ennyi órával megy ki, benne az Időpont lemondása / módosítása gombbal. Aki ennél később foglal, nem kap külön emlékeztetőt, mert a visszaigazolást épp akkor kapta.</p>' +
        '<div class="field notif__num"><label for="r-emo">Ennyi órával előtte</label><div class="unit"><input id="r-emo" data-r="emlekeztetoOra" type="number" inputmode="numeric" min="1" max="168" value="' + esc(sz.emlekeztetoOra == null ? 30 : sz.emlekeztetoOra) + '"' + (emOn ? '' : ' disabled') + '><span>óra</span></div></div></div>' +
      '<div class="notif__row"><label class="sw"><input type="checkbox" role="switch" id="r-kert" data-r="ertesitKollega"' + (kOn ? ' checked' : '') + ' aria-describedby="r-kert-h"><span class="sw__t" aria-hidden="true"></span><span class="sw__l">Értesítő a kollégának</span></label>' +
        '<p class="hint" id="r-kert-h">Új foglalásról, módosításról és lemondásról levelet kap a privát e-mail-címére (a Kollégák fülön adható meg). Akinek nincs címe, nem kap levelet.</p></div>' +
      '</div>' + (Number(sz.emlekeztetoOra) <= Number(sz.lemondasOra) && emOn ? '<p class="note notif__warn">Az emlékeztető a lemondási határ (' + esc(sz.lemondasOra) + ' óra) után menne ki, így a vendég már nem tudna online lemondani. Érdemes legalább ' + (Number(sz.lemondasOra) + 6) + ' órát megadni.</p>' : '') + '</section>';
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
    if (el.id === 'kin-pelda') { if (e.type === 'change') { be.pelda = el.value; $('#kin-pelda-box').innerHTML = kinPeldaHtml(t); $('#kin-pelda').focus(); } return; }
    if (el.dataset.kin) {
      if (!el.checked || e.type !== 'change') return;
      t.szabalyok.kinalas = el.dataset.kin === 'igazitott' ? 'igazitott' : Number(el.dataset.kin);
      kinFrissit(); beChanged(); return;
    }
    if ((row = el.closest('[data-szi]'))) {
      var s = t.szolgaltatasok[+row.getAttribute('data-szi')];
      if (el.dataset.szk) {
        if (e.type !== 'change') return;
        var kv = el.value, ef = $('.erow__kin-e', row), ei = $('[data-szke]', row);
        ef.hidden = kv !== 'egyedi';
        if (kv === 'egyedi') { var n = Number(ei.value); s.kinalas = Number.isInteger(n) ? n : NaN; ei.focus(); }
        else s.kinalas = kv === '' ? null : kv === 'igazitott' ? 'igazitott' : Number(kv);
        kinFrissit(); beChanged(); return;
      }
      if (el.dataset.szke) { s.kinalas = el.value === '' ? NaN : Number(el.value); kinFrissit(); beChanged(); return; }
      if (el.dataset.sz) { var v = el.value; s[el.dataset.sz] = el.dataset.sz === 'nev' ? v : (v === '' ? (el.dataset.sz === 'ar' ? null : NaN) : Number(v)); if (el.dataset.sz !== 'ar') kinFrissit(); }
      if (el.dataset.szh) toggleIn(s.helyszinek, el.dataset.szh, el.checked);
    } else if ((row = el.closest('[data-ki]'))) {
      var k = t.kollegak[+row.getAttribute('data-ki')];
      if (el.dataset.k) k[el.dataset.k] = el.value;
      if (el.dataset.kh) { toggleIn(k.helyszinek, el.dataset.kh, el.checked); if (e.type === 'change') { beChanged(); renderBe(); return; } }
      if (el.dataset.ks) toggleIn(k.szolgaltatasok, el.dataset.ks, el.checked);
    } else if ((row = el.closest('[data-hi]'))) {
      t.helyszinek[+row.getAttribute('data-hi')][el.dataset.h] = el.value;
    } else if (el.dataset.r) {
      if (el.type === 'checkbox') {
        t.szabalyok[el.dataset.r] = el.checked;
        if (el.id === 'r-emb') $('#r-emo').disabled = !el.checked;
      } else t.szabalyok[el.dataset.r] = el.type === 'number' ? (el.value === '' ? NaN : Number(el.value)) : el.value;
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
      if (s.kinalas != null && s.kinalas !== 'igazitott' && !kinErvenyes(s.kinalas)) return n + ': az egyedi kezdés 15 és 240 perc között, 15 perces lépésben lehet.';
    }
    for (var j = 0; j < t.kollegak.length; j++) {
      var k = t.kollegak[j];
      if (!String(k.nev || '').trim()) return 'Minden szakembernek adj nevet.';
      if (!k.helyszinek.length) return k.nev + ': jelöld be, melyik helyszínen dolgozik.';
    }
    for (var h = 0; h < t.helyszinek.length; h++) if (F.perc(t.helyszinek[h].nyit) >= F.perc(t.helyszinek[h].zar)) return t.helyszinek[h].nev + ': a zárás legyen későbbi a nyitásnál.';
    var sz = t.szabalyok;
    if (!Number.isInteger(sz.minEloreOra) || !Number.isInteger(sz.maxEloreNap) || !Number.isInteger(sz.lemondasOra)) return 'A szabályoknál minden szám legyen kitöltve.';
    if (!Number.isInteger(sz.emlekeztetoOra) || sz.emlekeztetoOra < 1 || sz.emlekeztetoOra > 168) return 'Az emlékeztető 1 és 168 óra között lehet.';
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
    // a kollégák a Kollégák fülön változnak: a mentés mindig a frissen betöltött kolléga-listát küldi,
    // így egy régebben megnyitott Beállítások-lap nem írja vissza a régi adatukat
    loadTorzs(true).then(function (friss) {
      var regiSz = {}; friss.szolgaltatasok.forEach(function (x) { regiSz[x.id] = 1; });
      var ujSz = {}; be.t.szolgaltatasok.forEach(function (x) { ujSz[x.id] = 1; });
      var kl = friss.kollegak.map(function (k) { return Object.assign({}, k, { szolgaltatasok: k.szolgaltatasok.filter(function (sid) { return ujSz[sid]; }) }); });
      // a stúdiónaptár a saját blokkjában változik: itt mindig a friss érték megy vissza
      var szab = Object.assign({}, be.t.szabalyok, { studioNaptarId: (friss.szabalyok || {}).studioNaptarId || '' });
      return api('/beallitasok', { method: 'PUT', json: Object.assign({}, be.t, { kollegak: kl, szabalyok: szab }) });
    }).then(function (t) {
      torzs = t; torzsP = Promise.resolve(t); be.t = JSON.parse(JSON.stringify(t)); be.dirty = false; renderBe();
      toast('A beállítások mentve, a foglaló már ezeket használja.');
    }).catch(function (e) { b.disabled = false; b.textContent = 'Beállítások mentése'; toast(e.message, 'error'); });
  }

  /* ---------- Google Naptár (naptar.js: GET naptar/allapot, PATCH naptar, POST naptar/ujraszinkron) ----------
     A kulcs (GOOGLE_SA_KEY) nélkül a blokk nyugodt tájékoztatás a bekötés lépéseivel, nem hiba.
     A stúdiónaptár és a kollégák naptár-azonosítója kulcs nélkül is menthető, a szinkron a bekötés után indul. */
  var gc = { a: null, msg: '', kind: '' };
  var GC_RE = /^[A-Za-z0-9._%+#-]{1,200}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  function gcAzonHiba(v) {
    var s = String(v || '').trim();
    return s && (s.length > 254 || !GC_RE.test(s)) ? 'Ez nem naptár-azonosító. A naptár beállításaiban, a „Naptár integrálása” résznél a „Naptárazonosító” sort másold ki, például abc123@group.calendar.google.com.' : '';
  }
  function gcIdo(iso) { return new Date(iso).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function loadGcal() {
    var box = $('#be-gcal'); if (!box) return;
    box.setAttribute('aria-busy', 'true');
    if (!gc.a) box.innerHTML = '<div class="gc__skel"></div>';
    return api('/naptar/allapot').then(function (a) { gc.a = a; renderGcal(); })
      .catch(function (e) { box.setAttribute('aria-busy', 'false'); hibaDoboz(box, e, loadGcal); });
  }
  function gcLepesek(fiok) {
    return '<ol class="gc-steps">' +
      '<li><span><b>A Google-kapcsolat beállítása.</b> Ezt mi végezzük: a Google Cloudban egy szolgáltatásfiókot hozunk létre, és a kulcsát a foglalóba tesszük.</span></li>' +
      '<li><span><b>Naptárak a stúdió Google-fiókjában.</b> A calendar.google.com oldalon az Egyéb naptárak melletti + jellel kollégánként egy naptár, és egy közös a stúdiónak.</span></li>' +
      '<li><span><b>Megosztás.</b> Mindegyik naptár Beállítások és megosztás oldalán oszd meg ' + (fiok ? 'a <span class="gc-mail">' + esc(fiok) + '</span> címmel' : 'a szolgáltatásfiók e-mail-címével') + ', „Módosítások végrehajtása és az esemény részleteinek megtekintése” joggal.</span></li>' +
      '<li><span><b>Azonosító beírása.</b> Ugyanott, a Naptár integrálása résznél másold ki a Naptárazonosítót. A kollégáét a Kollégák fülön az adatlapjára, a közöset ide, lent.</span></li></ol>';
  }
  function renderGcal() {
    var a = gc.a, box = $('#be-gcal'); if (!box || !a) return;
    var allapot = a.kulcsHiba ? 'hibas' : a.bekotve ? 'be' : 'nincs';
    var cimke = { be: 'Bekötve', nincs: 'Még nincs bekötve', hibas: 'A kulcs hibás' }[allapot];
    var vanK = a.kollegak.filter(function (k) { return k.naptar_id; }).length;
    var html = '<div class="be-sec__head gc__head"><div><h2 id="gc-h">Google Naptár</h2>' +
      '<p>A foglalások maguktól bekerülnek a kolléga saját Google-naptárába és a stúdió közös naptárába, a kolléga színével. Módosításkor az esemény frissül, lemondáskor kikerül.</p></div>' +
      '<span class="gc-st gc-st--' + allapot + '" id="gc-st">' + esc(cimke) + '</span></div>';
    // állapot
    if (allapot === 'nincs') {
      html += '<div class="gc-info" id="gc-info"><p class="gc-info__h">A Google Naptár még nincs bekötve. A bekötés lépései:</p>' + gcLepesek('') +
        '<dl class="gc-dl"><div><dt>Szolgáltatásfiók e-mail-címe</dt><dd class="gc-dl__ph">A bekötés után itt jelenik meg. Ezzel a címmel kell megosztani a naptárakat.</dd></div></dl>' +
        '<p class="hint gc-info__fn">A naptár-azonosítókat már most beírhatod, a foglalások a bekötés után kerülnek át. A foglaló addig is rendben működik.</p></div>';
    } else if (allapot === 'hibas') {
      html += '<div class="gc-info gc-info--hibas" id="gc-info"><p class="gc-info__h">A Google-kapcsolat kulcsa hibás, ezért a naptárba most nem kerül át semmi.</p>' +
        '<p>A javítást mi végezzük. A foglaló ettől függetlenül működik, a vendégek foglalhatnak, a levelek kimennek. A kulcs javítása után az Újraszinkron gombbal minden jövőbeli foglalás átkerül.</p></div>';
    } else {
      var sor = a.varakozik ? a.varakozik + ' tétel vár a naptárba' + (a.elakadt ? ', ebből ' + a.elakadt + ' többszöri próbálkozás után is elakadt' : '') + '.' : 'Minden foglalás a naptárban van.';
      html += '<div class="gc-info gc-info--be" id="gc-info"><dl class="gc-dl">' +
        '<div><dt>Szolgáltatásfiók e-mail-címe</dt><dd><span class="gc-mail" id="gc-fiok">' + esc(a.szolgaltatasFiok) + '</span>' +
          '<button type="button" class="linkbtn gc-copy" id="gc-copy">Cím másolása</button></dd></div>' +
        '<div><dt>Szinkron</dt><dd id="gc-sor">' + esc(sor) + '</dd></div>' +
        (a.utolsoHiba ? '<div><dt>Utolsó hiba</dt><dd id="gc-hiba">' + esc(a.utolsoHiba.uzenet) + '<small>' + esc(a.utolsoHiba.azonosito) + ', ' + esc(gcIdo(a.utolsoHiba.ido)) + ', ' + esc(a.utolsoHiba.probalkozas) + '. próbálkozás</small></dd></div>' : '') +
        '</dl><p class="hint">Ezzel a címmel kell megosztani minden F360-naptárat. Ha egy kolléga naptára hiányzik a listából, nincs megosztva vagy nincs beírva az azonosítója.</p></div>';
    }
    // stúdiónaptár + kollégák
    html += '<div class="gc-grid">' +
      '<form class="gc-studio" id="gc-form" novalidate><h3 class="gc-sub">Közös stúdiónaptár</h3>' +
        '<div class="field"><label for="gc-studio">A stúdió közös naptárának azonosítója <span class="opt">(nem kötelező)</span></label>' +
        '<input type="text" id="gc-studio" value="' + esc(a.studioNaptarId) + '" maxlength="254" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="pl. stúdió…@group.calendar.google.com" aria-describedby="gc-studio-h gc-studio-e">' +
        '<p class="hint" id="gc-studio-h">Ebbe a naptárba minden foglalás bekerül, így ránézésre látszik, ki kihez tartozik. Üresen hagyva nincs közös naptár.</p>' +
        '<p class="field-err" id="gc-studio-e" role="alert" hidden></p></div>' +
        '<div class="gc-studio__act"><button type="submit" class="btn btn--primary" id="gc-save" disabled>Stúdiónaptár mentése</button></div></form>' +
      '<div class="gc-koll"><h3 class="gc-sub">Kollégák naptára</h3>' +
        '<p class="gc-koll__n">' + (a.kollegak.length ? vanK + ' / ' + a.kollegak.length + ' kollégának van saját naptára.' : 'Még nincs kolléga.') + '</p>' +
        '<ul class="gc-kl" id="gc-kl">' + a.kollegak.map(function (k) {
          return '<li><a class="gc-k" href="#/kollegak/' + esc(k.id) + '">' + koAvatar(k) +
            '<span class="gc-k__t"><b>' + esc(k.nev) + '</b><small>' + (k.naptar_id ? esc(k.naptar_id) : 'Nincs naptár megadva') + '</small></span>' +
            '<span class="gc-k__st' + (k.naptar_id ? ' is-on' : '') + '">' + (k.naptar_id ? 'Beállítva' : 'Megadás') + '</span></a></li>';
        }).join('') + '</ul></div></div>';
    // újraszinkron
    html += '<div class="gc-sync"><button type="button" class="btn btn--ghost" id="gc-sync">Újraszinkron</button>' +
      '<p class="gc-sync__t" id="gc-sync-t">Minden jövőbeli foglalást újra elküld a naptárba, és az elakadt tételeket is újrapróbálja. Akkor kell, ha a naptárban valami hiányzik vagy eltér.</p>' +
      '<p class="gc-sync__msg" id="gc-msg" role="status" aria-live="polite"' + (gc.kind ? ' data-kind="' + gc.kind + '"' : '') + '>' + esc(gc.msg) + '</p></div>';
    box.innerHTML = html;
    box.setAttribute('aria-busy', 'false');
  }
  function gcStudioInput() {
    var el = $('#gc-studio'), b = $('#gc-save'); if (!el || !gc.a) return;
    b.disabled = el.value.trim() === (gc.a.studioNaptarId || '');
    var e = $('#gc-studio-e'); e.hidden = true; el.removeAttribute('aria-invalid');
  }
  function gcStudioMent(ev) {
    ev.preventDefault();
    var el = $('#gc-studio'), err = $('#gc-studio-e'), b = $('#gc-save'), v = el.value.trim();
    var h = gcAzonHiba(v);
    if (h) { err.textContent = h; err.hidden = false; el.setAttribute('aria-invalid', 'true'); el.focus(); return; }
    b.disabled = true; b.textContent = 'Mentés folyamatban';
    api('/naptar', { method: 'PATCH', json: { studioNaptarId: v } }).then(function (r) {
      gc.a.studioNaptarId = r.studioNaptarId;
      if (torzs && torzs.szabalyok) torzs.szabalyok.studioNaptarId = r.studioNaptarId;
      if (be.t && be.t.szabalyok) be.t.szabalyok.studioNaptarId = r.studioNaptarId;
      gc.msg = r.studioNaptarId ? (gc.a.bekotve ? 'A stúdiónaptár mentve. A jövőbeli foglalások pár percen belül megjelennek benne.' : 'A stúdiónaptár mentve. A foglalások a bekötés után kerülnek bele.') : 'A közös stúdiónaptár kikapcsolva.' + (gc.a.bekotve ? ' Az események a háttérben kikerülnek belőle.' : '');
      gc.kind = 'ok';
      renderGcal(); $('#gc-studio').focus();
    }).catch(function (e) {
      b.disabled = false; b.textContent = 'Stúdiónaptár mentése';
      err.textContent = e.message; err.hidden = false; el.setAttribute('aria-invalid', 'true');
    });
  }
  function gcSync() {
    var b = $('#gc-sync'), m = $('#gc-msg');
    b.disabled = true; b.textContent = 'Szinkron folyamatban'; m.textContent = ''; m.removeAttribute('data-kind');
    api('/naptar/ujraszinkron', { method: 'POST', json: { mind: true } }).then(function (r) {
      gc.kind = r.hibas ? 'error' : 'ok';
      gc.msg = (r.sikeres ? r.sikeres + ' tétel frissítve a naptárban.' : 'Nem volt mit frissíteni.') +
        (r.hibas ? ' ' + r.hibas + ' tétel nem sikerült, a rendszer később újrapróbálja.' : '') +
        (r.maradt ? ' ' + r.maradt + ' tétel még sorra vár, a következő futás viszi.' : '');
      return api('/naptar/allapot').then(function (a) { gc.a = a; renderGcal(); $('#gc-sync').focus(); });
    }).catch(function (e) {
      b.disabled = false; b.textContent = 'Újraszinkron';
      // kulcs nélkül a backend 409-et ad: ez nem hiba, csak még nincs bekötve
      if (e.status === 409) { gc.kind = 'info'; gc.msg = 'A szinkron még nem indítható, mert a Google Naptár nincs bekötve. A bekötés után ez a gomb minden jövőbeli foglalást átküld.'; }
      else { gc.kind = 'error'; gc.msg = e.message; }
      m.textContent = gc.msg; m.dataset.kind = gc.kind;
    });
  }
  function gcCopy() {
    var t = gc.a && gc.a.szolgaltatasFiok, m = $('#gc-msg'); if (!t) return;
    var kesz = function () { gc.kind = 'ok'; gc.msg = 'A szolgáltatásfiók címe a vágólapon.'; m.textContent = gc.msg; m.dataset.kind = 'ok'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(kesz, function () { window.getSelection().selectAllChildren($('#gc-fiok')); });
    else window.getSelection().selectAllChildren($('#gc-fiok'));
  }

  /* =====================================================================
     4. LEVELEK
     ===================================================================== */
  var le = { list: [], sel: null, mod: 'outbox', szuro: 'mind' };
  var TIPUS = {
    visszaigazolas: 'Visszaigazolás a vendégnek', modositas: 'Módosítás a vendégnek', lemondas: 'Lemondás a vendégnek', emlekezteto: 'Emlékeztető a vendégnek',
    'studio-ertesito': 'Új foglalás a stúdiónak', 'studio-modositas': 'Módosítás a stúdiónak',
    'kollega-uj': 'Új foglalás a kollégának', 'kollega-modositas': 'Módosítás a kollégának', 'kollega-lemondas': 'Lemondás, kollégának vagy stúdiónak',
    'ora-elmarad': 'Az óra elmarad, a résztvevőnek',
    'sorozat-visszaigazolas': 'Állandó időpont a vendégnek', 'sorozat-leallitva': 'Állandó időpont leállt, a vendégnek',
    'sorozat-kollega': 'Állandó időpont a kollégának', 'sorozat-studio': 'Állandó időpont a stúdiónak'
  };
  // a csoportos óráknál ugyanaz a típus mást jelent (jelentkezés, oktató)
  // csoportos levél: a backend csoportos: true jelzője, vagy a jelentkezés „C” előtagú azonosítója (az outbox-lista ezt adja)
  function sorLevel(l) { return l.sorozat === true || /^sorozat-/.test(String(l.tipus || '')) || /^R[0-9A-Z]{10}$/.test(String(l.azonosito || '')); }
  function csopLevel(l) { return l.csoportos === true || /^C[0-9A-Z]{10}$/.test(String(l.azonosito || '')); }
  var TIPUS_CS = { visszaigazolas: 'Jelentkezés visszaigazolása', modositas: 'Áthelyezés másik órára', lemondas: 'Jelentkezés lemondva', 'kollega-uj': 'Új jelentkező az oktatónak', 'kollega-lemondas': 'Lemondott jelentkezés az oktatónak' };
  // szűrők: címzett szerint, a vendégnél az emlékeztető külön is
  var SZURO = [
    { id: 'mind', nev: 'Mind', t: null },
    { id: 'vendeg', nev: 'Vendégnek', t: ['visszaigazolas', 'modositas', 'lemondas', 'ora-elmarad', 'sorozat-visszaigazolas', 'sorozat-leallitva'] },
    { id: 'emlekezteto', nev: 'Emlékeztetők', t: ['emlekezteto'] },
    { id: 'kollega', nev: 'Kollégáknak', t: ['kollega-uj', 'kollega-modositas', 'kollega-lemondas', 'sorozat-kollega'] },
    { id: 'studio', nev: 'Stúdiónak', t: ['studio-ertesito', 'studio-modositas', 'sorozat-studio'] }
  ];
  function leSzurt() {
    var sz = SZURO.filter(function (x) { return x.id === le.szuro; })[0] || SZURO[0];
    return sz.t ? le.list.filter(function (l) { return sz.t.indexOf(l.tipus) >= 0; }) : le.list;
  }
  function leAllapot(l) {
    if (l.elkuldve) return 'Elküldve' + (l.kuldve ? ' ' + new Date(l.kuldve).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
    if (l.sikertelen) return 'Nem sikerült elküldeni' + (l.hiba ? ': ' + l.hiba : '');
    return le.mod === 'outbox' ? 'Nem ment ki (előnézet)' : 'Küldésre vár';
  }
  function openLevelek(sub) {
    document.title = 'Levelek · Admin · Studio F360';
    var ul = $('#le-list');
    ul.innerHTML = '<li class="row-skel"></li><li class="row-skel"></li>';
    return api('/outbox').then(function (r) {
      le.list = (r && r.levelek) || [];
      le.mod = (r && r.mod) || 'outbox';
      var note = $('#le-note');
      note.hidden = le.mod !== 'outbox';
      note.textContent = 'A levelek még nem mennek ki, itt az előnézetük látszik. Ha a levélküldés be lesz állítva, ugyanezek mennek ki a vendégeknek, a kollégáknak és a stúdiónak.';
      renderLeFilter();
      var l = leSzurt();
      if (!l.length) {
        ul.innerHTML = '<li class="empty-inline">' + (le.list.length ? 'Ebben a csoportban még nincs levél.' : 'Még nem készült levél. Az első foglalás után itt jelenik meg.') + '</li>';
        $('#le-prev').innerHTML = ''; return;
      }
      var id = sub && l.some(function (x) { return String(x.id) === sub; }) ? sub : String(l[0].id);
      renderLeList(id);
      showLevel(id, false);
    }).catch(function (e) { hibaDoboz($('#le-prev'), e, function () { openLevelek(sub); }); ul.innerHTML = ''; });
  }
  function renderLeFilter() {
    $('#le-filter').innerHTML = SZURO.map(function (x) {
      var n = x.t ? le.list.filter(function (l) { return x.t.indexOf(l.tipus) >= 0; }).length : le.list.length;
      return '<button type="button" class="chip" data-leszuro="' + x.id + '" aria-pressed="' + (le.szuro === x.id) + '">' + esc(x.nev) + '<span class="chip__n">' + n + '</span></button>';
    }).join('');
  }
  function renderLeList(id) {
    $('#le-list').innerHTML = leSzurt().map(function (l) {
      var d = new Date(l.letrehozva);
      return '<li><a class="le-item' + (String(l.id) === id ? ' is-on' : '') + '" href="#/levelek/' + esc(l.id) + '"' + (String(l.id) === id ? ' aria-current="true"' : '') + '>' +
        '<span class="le-item__k" data-t="' + esc(l.tipus) + '">' + esc((csopLevel(l) && TIPUS_CS[l.tipus]) || ((l.tipus === 'sorozat-kollega' || l.tipus === 'sorozat-studio') && (l.esemeny === 'leallitva' || /^Leállt/.test(l.targy || '')) ? 'Állandó időpont leállt, a ' + (l.tipus === 'sorozat-studio' ? 'stúdiónak' : 'kollégának') : '') || TIPUS[l.tipus] || l.tipus) + (csopLevel(l) ? '<span class="le-cs">csoportos óra</span>' : '') + (sorLevel(l) ? '<span class="le-cs le-cs--sr">' + ISM_IKON + 'állandó időpont</span>' : '') + '</span>' +
        '<span class="le-item__s">' + esc(l.targy) + '</span>' +
        '<span class="le-item__m">' + esc(l.cimzett) + ' · ' + esc(d.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</span></a></li>';
    }).join('');
  }
  function futtatEmlekezteto() {
    var b = $('#le-run'), allapot = $('#le-run-allapot');
    // a visszajelzés a gomb alatt jelenik meg (nem lebegő üzenetként), így nem takarja a listát és az előnézetet
    function jelez(szoveg, kind) { allapot.textContent = szoveg; allapot.dataset.kind = kind || 'info'; }
    jelez('');
    b.disabled = true; b.textContent = 'Emlékeztetők keresése';
    api('/emlekezteto/futtat', { method: 'POST', json: {} }).then(function (r) {
      b.disabled = false; b.textContent = 'Emlékeztetők futtatása most';
      var n = (r && r.emlekeztetve) || 0;
      if (r && r.kikapcsolva) jelez('Az emlékeztető ki van kapcsolva a Beállításokban, ezért nem készült levél.');
      else jelez(n ? n + ' emlékeztető készült. ' + (r.mod === 'outbox' ? 'A listában látod őket.' : 'A levelek kimentek.') : 'Most nincs kinek emlékeztetőt küldeni: mindenki megkapta, vagy még nincs az időablakban.');
      le.szuro = n ? 'emlekezteto' : le.szuro;
      openLevelek('');
    }).catch(function (e) { b.disabled = false; b.textContent = 'Emlékeztetők futtatása most'; jelez(e.message, 'error'); });
  }

  /* =====================================================================
     5. KAMPÁNYOK  (GET /riport/forrasok?tol=&ig=)
     ===================================================================== */
  var ka = { tol: '', ig: '', req: 0 };
  // a kampány-forrás olvasható alakja (a foglalás részleteinél is)
  function forrasSzoveg(k) {
    if (!k) return 'közvetlenül';
    var nev = k.utm_source || (k.gclid ? 'Google Ads' : k.fbclid ? 'Facebook' : '');
    if (!nev && k.referrer) { try { nev = new URL(k.referrer).hostname.replace(/^www\./, ''); } catch (e) { nev = k.referrer; } }
    return [nev || 'közvetlenül', k.utm_medium, k.utm_campaign ? 'kampány: ' + k.utm_campaign : '', k.utm_content ? 'hirdetés: ' + k.utm_content : ''].filter(Boolean).join(' · ');
  }
  // a riport forrás-neve olvasható alakban: ismert csatorna nagybetűvel, webcímnél a www. nélkül
  function forrasCimke(f) {
    var M = { '(közvetlen)': 'Közvetlen vagy ismeretlen', 'google (gclid)': 'Google Ads', 'facebook (fbclid)': 'Facebook (hirdetés)',
      facebook: 'Facebook', fb: 'Facebook', instagram: 'Instagram', ig: 'Instagram', google: 'Google', tiktok: 'TikTok', youtube: 'YouTube', hirlevel: 'Hírlevél', newsletter: 'Hírlevél' };
    var k = String(f || '').toLowerCase();
    return M[f] || M[k] || String(f).replace(/^www\./, '');
  }
  function kaAlap() {
    var ma = F.most().datum;
    if (!ka.tol) { ka.tol = F.addDays(ma, -30); ka.ig = F.addDays(ma, 60); }
  }
  function openKampanyok(sub) {
    document.title = 'Kampányok · Admin · Studio F360';
    var m = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(sub || '');
    if (m) { ka.tol = m[1]; ka.ig = m[2]; }
    kaAlap();
    $('#ka-tol').value = ka.tol; $('#ka-ig').value = ka.ig;
    renderKa();
  }
  function renderKa() {
    var box = $('#ka-board'), req = ++ka.req;
    box.setAttribute('aria-busy', 'true');
    if (!box.children.length) box.innerHTML = '<div class="skel-board"></div>';
    api('/riport/forrasok?tol=' + ka.tol + '&ig=' + ka.ig).then(function (r) {
      if (req !== ka.req) return;
      box.setAttribute('aria-busy', 'false');
      var sorok = (r && r.sorok) || [], o = (r && r.osszesen) || { foglalasok: 0, lemondva: 0 };
      var idoszak = tartomany(r.tol, r.ig);
      if (!sorok.length) { box.innerHTML = '<div class="empty-state"><p>Ebben az időszakban (' + esc(idoszak) + ') nincs foglalás.</p></div>'; return; }
      // forrásonkénti összesítő: melyik csatorna hoz a legtöbbet
      var cs = {};
      sorok.forEach(function (x) { cs[x.forras] = (cs[x.forras] || 0) + x.foglalasok; });
      var csat = Object.keys(cs).sort(function (a, b) { return cs[b] - cs[a]; });
      var max = cs[csat[0]] || 1;
      var html = '<div class="ka-sum"><p class="ka-sum__n"><b>' + o.foglalasok + '</b> foglalás' + (o.lemondva ? ', <span>' + o.lemondva + ' lemondva</span>' : '') + '</p><p class="ka-sum__t">' + esc(idoszak) + '</p></div>' +
        '<ol class="ka-bars" aria-label="Foglalások forrásonként">' + csat.map(function (f) {
          return '<li><span class="ka-bars__l">' + esc(forrasCimke(f)) + '</span><span class="ka-bars__b" aria-hidden="true"><i style="width:' + Math.max(2, Math.round(cs[f] / max * 100)) + '%"></i></span><span class="ka-bars__n">' + cs[f] + '</span></li>';
        }).join('') + '</ol>';
      html += '<div class="ka-tab-w" tabindex="0" role="region" aria-label="Foglalások forrás, kampány és kezelés szerint, görgethető"><table class="ka-tab"><caption class="sr">Foglalások forrás, kampány és kezelés szerint, ' + esc(idoszak) + '</caption>' +
        '<thead><tr><th scope="col">Forrás</th><th scope="col">Kampány</th><th scope="col">Kezelés</th><th scope="col" class="num">Foglalás</th><th scope="col" class="num">Lemondva</th></tr></thead><tbody>' +
        sorok.map(function (x) {
          return '<tr><td><b>' + esc(forrasCimke(x.forras)) + '</b>' + (x.medium ? '<small>' + esc(x.medium) + '</small>' : '') + '</td><td>' + (x.kampany ? esc(x.kampany) : '<span class="ka-nincs">nincs</span>') + '</td>' +
            '<td>' + esc(x.szolgaltatas.nev) + (x.szolgaltatas.perc ? '<small>' + esc(x.szolgaltatas.perc) + ' perc</small>' : '') + '</td><td class="num">' + x.foglalasok + '</td><td class="num">' + (x.lemondva || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="hint ka-foot">A kampány a hirdetés linkjének utm_campaign jelzése. Google Ads és Facebook-hirdetésnél a rendszer a kattintás azonosítójából is felismeri a forrást. „Közvetlen”: a látogató beírta a címet, könyvjelzőből jött, vagy a forrás nem derült ki.</p>';
      box.innerHTML = html;
    }).catch(function (e) { if (req === ka.req) hibaDoboz(box, e, renderKa); });
  }
  function kaGyors(mit) {
    var ma = F.most().datum;
    if (mit === 'm30') { ka.tol = F.addDays(ma, -30); ka.ig = ma; }
    if (mit === 'ho') { ka.tol = ma.slice(0, 8) + '01'; var n = new Date(Date.UTC(+ma.slice(0, 4), +ma.slice(5, 7), 0)).getUTCDate(); ka.ig = ma.slice(0, 8) + (n < 10 ? '0' : '') + n; }
    if (mit === 'j60') { ka.tol = ma; ka.ig = F.addDays(ma, 60); }
    location.hash = '#/kampanyok/' + ka.tol + '/' + ka.ig;
  }
  function submitKa(ev) {
    ev.preventDefault();
    var t = $('#ka-tol').value, i = $('#ka-ig').value;
    if (!t || !i) return toast('Add meg az első és az utolsó napot.', 'error');
    if (i < t) return toast('Az utolsó nap nem lehet korábbi az elsőnél.', 'error');
    if (F.napKulonbseg ? F.napKulonbseg(t, i) > 399 : false) return toast('Egyszerre legfeljebb 400 nap kérhető le.', 'error');
    ka.tol = t; ka.ig = i;
    var h = '#/kampanyok/' + t + '/' + i;
    if (location.hash !== h) location.hash = h; else renderKa();
  }
  function showLevel(id, fromClick) {
    var l = le.list.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!l) return;
    renderLeList(String(id));
    var box = $('#le-prev');
    box.innerHTML = '<div class="le-card"><dl class="le-meta"><div><dt>Címzett</dt><dd>' + esc(l.cimzett) + '</dd></div><div><dt>Tárgy</dt><dd>' + esc(l.targy) + '</dd></div>' +
      '<div><dt>Állapot</dt><dd>' + esc(leAllapot(l)) + (l.ics ? ' · naptárfájl csatolva' : '') + '</dd></div></dl>' +
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
    var ob = t.closest('#fg-board [data-ora]');
    if (ob) { openOra(ob.getAttribute('data-ora')); return; }
    if (t.closest('#oc-close')) return $('#dlg-ora').close();
    if (t.closest('#oc-elm-open')) { var em = $('#oc-elm'); em.hidden = false; $('#oc-ok-t').focus(); em.scrollIntoView({ block: 'nearest' }); return; }
    if (t.closest('#oc-elm-no')) { $('#oc-elm').hidden = true; $('#oc-elm-open').focus(); return; }
    if (t.closest('#oc-elm-yes')) return oraElmaradKuld();
    var rc = t.closest('[data-rtcx]');
    if (rc) return rtLemond(rc.getAttribute('data-rtcx'));
    // órarend
    var sb = t.closest('[data-sab]');
    if (sb) return openSablon(sb.getAttribute('data-sab'));
    var tp = t.closest('[data-tip]');
    if (tp) return openTipus(tp.getAttribute('data-tip'));
    if (t.closest('#or-new-s')) return openSablon('');
    if (t.closest('#or-new-t')) return openTipus('');
    if (t.closest('#or-gen')) return generalOrak();
    if (t.closest('#os-del')) return torolSablon();
    if (t.closest('#os-cancel')) return $('#dlg-os').close();
    if (t.closest('#ot-cancel')) return $('#dlg-ot').close();
    if (t.closest('#fg-prev')) return fgMozgat(-1);
    if (t.closest('#fg-next')) return fgMozgat(1);
    if (t.closest('#fg-today')) { fg.datum = F.most().datum; location.hash = fgHash(); return; }
    if (t.closest('#fg-new')) return openNew();
    // állandó időpont
    if (t.closest('#fg-ser-new') || t.closest('[data-sernew]')) return openSer();
    if (t.closest('#ser-cancel')) return $('#dlg-ser').close();
    // a halvány (tiltott) vége-mezőre kattintott: kiválasztjuk a sor rádióját, és a mezőbe kerül a fókusz
    var svin = t.closest('#dlg-ser .ser-v__in');
    if (svin && $('input', svin).disabled) {
      e.preventDefault();
      $('input[name="s-vege"]', svin.closest('.ser-v')).checked = true;
      serVege(true);
      return;
    }
    if (t.closest('#ser-back')) { ser.mvDatum = ''; serStep('adat'); $('#s-nev').focus(); return; }
    if (t.closest('#ser-open')) { $('#dlg-ser').close(); return; }
    var ssk = t.closest('[data-serskip]');
    if (ssk) { var sd = ssk.getAttribute('data-serskip'); ser.dontes[sd] = { tipus: 'kihagy' }; if (ser.mvDatum === sd) ser.mvDatum = ''; return serFrissit('[data-serundo="' + sd + '"]'); }
    var smv = t.closest('[data-sermove]');
    if (smv) return serMoveOpen(smv.getAttribute('data-sermove'));
    var sun = t.closest('[data-serundo]');
    if (sun) { var ud = sun.getAttribute('data-serundo'); delete ser.dontes[ud]; return serFrissit('[data-serskip="' + ud + '"]'); }
    if (t.closest('#ser-mv-x')) { var xd = ser.mvDatum; ser.mvDatum = ''; return serFrissit('[data-sermove="' + xd + '"]'); }
    if (t.closest('#ser-mv-ok')) return serMoveOk();
    var srl = t.closest('[data-srlista]');
    if (srl) { sr.lista = srl.getAttribute('data-srlista'); return loadSrLista(); }
    if (t.closest('#sr-close')) { $('#dlg-sr').close(); return; }
    if (t.closest('#sr-stop-open')) { var st = $('#sr-stop'); st.hidden = false; $('#sr-tol').focus(); st.scrollIntoView({ block: 'nearest' }); return; }
    if (t.closest('#sr-stop-no')) { $('#sr-stop').hidden = true; $('#sr-stop-open').focus(); return; }
    if (t.closest('#sr-stop-yes')) return srLeallit();
    if (t.closest('#sr-body a[href^="#/foglalasok/nap/"]')) { $('#dlg-sr').close(); return; }
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
    // kollégák
    var kl = t.closest('[data-kolista]');
    if (kl) { ko.lista = kl.getAttribute('data-kolista'); renderKoList(); var l0 = koLathato()[0]; if (l0 && !ko.uj && (!koll(ko.kid) || !!koll(ko.kid).archivalt !== (ko.lista === 'archiv'))) location.hash = '#/kollegak/' + l0.id; return; }
    if (t.closest('#ko-arch')) return archivKo(false);
    if (t.closest('#ko-foto-del')) return fotoTorol();
    if (t.closest('#ko-vissza')) return archivKo(true);
    // levelek
    var lsz = t.closest('[data-leszuro]');
    if (lsz) { le.szuro = lsz.getAttribute('data-leszuro'); return openLevelek(''); }
    if (t.closest('#le-run')) return futtatEmlekezteto();
    // google naptár
    if (t.closest('#gc-sync')) return gcSync();
    if (t.closest('#gc-copy')) return gcCopy();
    // kampányok
    var kp = t.closest('[data-kapre]');
    if (kp) return kaGyors(kp.getAttribute('data-kapre'));
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
    if (t.id === 's-hely') return serFill('hely');
    if (t.id === 's-szolg') return serFill('szolg');
    if (t.id === 's-koll') return serFill('koll');
    if (t.id === 's-nap') return serFill('nap');
    if (t.id === 's-kezd' || t.name === 's-ism' || t.id === 's-tol') return serRitmus();
    if (t.name === 's-vege' || t.id === 's-db' || t.id === 's-ig') { var vr = $('input[name="s-vege"][value="' + (t.id === 's-db' ? 'alkalom' : t.id === 's-ig' ? 'datum' : t.value) + '"]'); if (vr) vr.checked = true; serVege(); return; }
    if (t.id === 'ser-mv-d') { var hb = $('.ser-mv__err'); if (hb) hb.remove(); return serMoveSlots(); }
    if (t.id === 'sr-tol') return srStopSz();
    if (t.id === 'mv-koll' || t.id === 'mv-datum') { $('#mv-err').hidden = true; return moveSlots(); }
    if (t.matches('#bo-main select[data-f]')) {
      var s = bo.sorok[+t.getAttribute('data-i')]; s[t.getAttribute('data-f')] = t.value; boChanged();
      var msg = boValid(); if (msg) toast(msg, 'error');
      var row = t.closest('.wkrow'); $('.wkrow__bar', row).innerHTML = barHtml(bo.sorok.filter(function (x) { return x.nap === s.nap; }));
      return;
    }
    if (t.id === 'ex-egesz') { $$('.ex-ido').forEach(function (x) { x.hidden = t.checked; }); return; }
    if (t.id === 'ex-tol' && $('#ex-ig').value < t.value) { $('#ex-ig').value = t.value; return; }
    if (t.id === 'ko-file') { var fl = t.files && t.files[0]; t.value = ''; return fotoFeltolt(fl); }
    if (t.closest('#be-form')) beInput(e);
    if (t.closest('#ko-form')) koInput(e);
  });
  document.addEventListener('input', function (e) {
    if (e.target.closest('#be-form') && e.target.matches('input:not([type=checkbox])')) beInput(e);
    if (e.target.closest('#ko-form') && e.target.matches('input[type=text],input[type=email],input[type=url],textarea')) koInput(e);
    if (e.target.id === 'gc-studio') gcStudioInput();
  });
  // a fotó-előnézet: ha a cím nem tölthető be, szöveges jelzés (inline onerror nélkül)
  document.addEventListener('error', function (e) {
    var im = e.target;
    if (im && im.tagName === 'IMG') {
      if (im.hasAttribute('data-koprev')) im.parentNode.innerHTML = '<span class="ko-photo__x">A kép nem tölthető be erről a címről.</span>';
      else if (im.closest('.kav')) im.remove();
    }
  }, true);
  // kolléga-fotó: húzd ide (a fotó-négyzetre vagy a feltöltő mezőre)
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var z = e.target.closest && e.target.closest('#ko-drop, .ko-up');
      if (!z || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('#ko-drop').classList.add('is-over');
    });
  });
  document.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('#ko-drop'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('is-over'); });
  document.addEventListener('drop', function (e) {
    var z = e.target.closest && e.target.closest('#ko-drop, .ko-up');
    if (!z || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); fotoFeltolt(e.dataTransfer.files[0]);
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'new-form') return submitNew(e);
    if (e.target.id === 'ser-form') { e.preventDefault(); if (ser.step === 'adat') return serEllenoriz(); if (ser.step === 'alk') return serMent(); return; }
    if (e.target.id === 'move-form') return submitMove(e);
    if (e.target.id === 'ex-form') return submitEx(e);
    if (e.target.id === 'be-form') return saveBe(e);
    if (e.target.id === 'ko-form') return submitKo(e);
    if (e.target.id === 'gc-form') return gcStudioMent(e);
    if (e.target.id === 'ka-form') return submitKa(e);
    if (e.target.id === 'oc-add') return oraFelvesz(e);
    if (e.target.id === 'ot-form') return submitTipus(e);
    if (e.target.id === 'os-form') return submitSablon(e);
  });
  // a részletek bezárásakor a cím a listára áll vissza (vissza gomb, frissítés helyes marad)
  $('#dlg-sr').addEventListener('close', function () { if (/^#\/foglalasok\/allando\/R/.test(location.hash)) history.replaceState(null, '', '#/foglalasok/allando'); });
  narrow.addEventListener('change', function () { if (document.body.dataset.view === 'view-foglalasok' && fg.nezet === 'nap') renderNap($('#fg-board')); });
  window.addEventListener('beforeunload', function (e) { if (bo.dirty || be.dirty || ko.dirty) { e.preventDefault(); e.returnValue = ''; } });

  window.F360AdminFoglalo = {
    open: function (tab, sub) {
      if (tab !== 'beosztas' && bo.dirty && !confirm('A beosztásban mentetlen változás van. Elveted?')) { location.hash = '#/beosztas/' + bo.kid; return; }
      if (tab !== 'beosztas') bo.dirty = false;
      if (tab !== 'kollegak' && ko.dirty && !confirm('A kolléga adatain mentetlen változás van. Elveted?')) { location.hash = '#/kollegak/' + (ko.uj ? 'uj' : ko.kid); return; }
      if (tab !== 'kollegak') ko.dirty = false;
      if (tab === 'foglalasok') return openFoglalasok(sub);
      if (tab === 'kollegak') return openKollegak(sub);
      if (tab === 'kampanyok') return openKampanyok(sub);
      if (tab === 'orarend') return openOrarend();
      if (tab === 'beosztas') { if (sub && sub !== bo.kid && bo.dirty && !confirm('A beosztásban mentetlen változás van. Elveted?')) { location.hash = '#/beosztas/' + bo.kid; return; } return openBeosztas(sub); }
      if (tab === 'beallitasok') return openBeallitasok();
      if (tab === 'levelek') return sub ? (le.list.length && leSzurt().some(function (l) { return String(l.id) === sub; }) ? showLevel(sub, true) : openLevelek(sub)) : openLevelek('');
    }
  };
})();
