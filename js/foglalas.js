/* =====================================================================
   STUDIO F360 · IDŐPONTFOGLALÓ · foglalas.js (nyilvános foglaló)
   Lépések egy oldalon: helyszín → kezelés → szakember → nap + időpont → adatok
   → összegzés → a köszönő oldal (foglalas/koszonjuk.html). A választások az URL-ben élnek (megosztható, frissítésre
   megmarad, a böngésző vissza gombja lépésenként visz vissza); a személyes adatok
   csak a böngésző munkamenet-tárában (sessionStorage), sosem az URL-ben.
   Csoportos óra (?tipus=csoportos): heti órarend → adatok → összegzés → köszönő oldal
   (/foglalas-api/orak, /foglalas-api/ora-foglalas; a token „C” előtagú).
   Lemondás: ?t=TOKEN (a levélben lévő link) ugyanezen az oldalon.
   API: /foglalas-api/* (Caesar). Helyi teszt: ?mock=1, vagy file://-ról magától
   a js/foglalo-mock.js fut. Ütközés-próba: ?mock=1&utkozes=1.
   ===================================================================== */
(function () {
  'use strict';

  var F = window.F360Foglalo;
  var MOCK = location.protocol === 'file:' || /[?&]mock=1(&|$)/.test(location.search);
  var API = '/foglalas-api';
  var DATA_KEY = 'f360-foglalas-adatok';
  var DONE_KEY = 'f360-foglalas-kesz';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var FULL_STEPS = [
    { id: 'helyszin', label: 'Helyszín' },
    { id: 'szolgaltatas', label: 'Kezelés' },
    { id: 'kollega', label: 'Szakember' },
    { id: 'idopont', label: 'Időpont' },
    { id: 'adatok', label: 'Adatok' },
    { id: 'osszegzes', label: 'Összegzés' }
  ];
  // módosítás (?t=TOKEN&modositas=1): a helyszín és a kezelés marad, csak szakember, időpont, megerősítés
  var MOD_STEPS = [
    { id: 'kollega', label: 'Szakember' },
    { id: 'idopont', label: 'Időpont' },
    { id: 'osszegzes', label: 'Megerősítés' }
  ];
  // csoportos óra: a heti órarendből egy óra, adatok, összegzés
  var CS_STEPS = [
    { id: 'ora', label: 'Óra' },
    { id: 'adatok', label: 'Adatok' },
    { id: 'osszegzes', label: 'Összegzés' }
  ];
  // csoportos jelentkezés áthelyezése másik órára (?t=C…&modositas=1)
  var CSMOD_STEPS = [
    { id: 'ora', label: 'Másik óra' },
    { id: 'osszegzes', label: 'Megerősítés' }
  ];
  // a táplálkozási szolgáltatások külön csoportban (Mexikói út, Kovács Anna)
  var TAPL = { 'taplalkozas-alapcsomag': 1, 'taplalkozas-kiegeszito': 1, 'inbody-770': 1 };
  var STEPS = FULL_STEPS;
  var mod = null;               // { tok, info, f } módosítás közben (f = a jelenlegi foglalás)
  var infoCache = {};           // token → a /lemondas?t= válasza (a vissza gomb ne kérje újra)
  // helyszín-kép és rövid leírás (a katalógus csak id, nev, cim mezőt garantál)
  var LOC_META = {
    mexikoi: { img: 'media/brand/foglalo/mexikoi-kezelo.jpg', alt: 'Kezelőszoba a Mexikói úti stúdióban', kerulet: 'XIV. kerület', utca: 'Mexikói út 32/b', nyit: '07:00', zar: '21:00' },
    reitter: { img: 'media/brand/foglalo/reitter-edzes.jpg', alt: 'Gyógytorna a Reitter Ferenc utcai teremben', kerulet: 'XIII. kerület', utca: 'Reitter Ferenc utca 48.', nyit: '08:00', zar: '20:00' }
  };
  // portré a csapat-oldalról (a katalógus nem ad képet); akinek nincs, monogramot kap
  var KEP = {
    'kodacsine-labancz-agnes': 1, 'vas-luca': 1, 'szegedi-botond': 1, 'adorjani-anna': 1, 'osvath-bence': 1,
    'barkoczy-barbara': 1, 'aczel-gabriella': 1, 'kovacs-anna': 1
  };
  function kepOf(k) { return k && (k.kep || (KEP[k.id] ? 'media/brand/csapat/' + k.id + '.jpg' : '')); }
  var CHECK = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m6 12.5 3.8 3.7L18 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = F.esc;

  /* ---------------- állapot ---------------- */
  var kat = null;               // katalógus
  var st = { h: '', sz: '', k: '', d: '', t: '', step: 'helyszin', het: '', tipus: '', ora: '', oraNap: '' };
  function cs() { return st.tipus === 'csoportos'; }
  var cache = {};               // szabad-időpont cache: kulcs → Promise<napok>
  var oraIdx = {};              // csoportos órák: id → óra (a betöltött hetekből)
  var busy = false;
  var lastRenderedStep = null;

  /* ---------------- API ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
    if (opts.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    return fetch(API + path, init).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = (data && data.error) || '';
          if (!msg) {
            if (res.status === 409) msg = 'Ezt az időpontot közben lefoglalták.';
            else if (res.status === 429) msg = 'Ma már túl sok foglalás érkezett erről a hálózatról. Hívj minket telefonon.';
            else if (res.status >= 500) msg = 'A foglalórendszer most nem válaszol. Próbáld újra egy perc múlva, vagy hívj minket.';
            else msg = 'Hiba történt (' + res.status + ').';
          }
          var err = new Error(msg); err.status = res.status; err.data = data; throw err;
        }
        return data !== null ? data : txt;
      });
    }, function () {
      var e = new Error('Nincs kapcsolat a foglalórendszerrel. Ellenőrizd az internetet, és próbáld újra.');
      e.status = 0; throw e;
    });
  }

  /* ---------------- katalógus-segédek ---------------- */
  function hely(id) { return kat && kat.helyszinek.filter(function (x) { return x.id === id; })[0]; }
  function szolg(id) { return kat && kat.szolgaltatasok.filter(function (x) { return x.id === id; })[0]; }
  function koll(id) { return kat && kat.kollegak.filter(function (x) { return x.id === id; })[0]; }
  function szolgHelyen(h) { return kat.szolgaltatasok.filter(function (s) { return (s.helyszinek || []).indexOf(h) >= 0; }); }
  function kollegakRa(h, sz) {
    return kat.kollegak.filter(function (k) { return (k.helyszinek || []).indexOf(h) >= 0 && (k.szolgaltatasok || []).indexOf(sz) >= 0; });
  }
  function szolgNev(s) { return s ? s.nev : ''; }
  // „Sportrehabilitáció, gyógytorna” → cím + alcím a választó-sorban
  function szolgReszek(s) { var i = s.nev.indexOf(', '); return i > 0 ? [s.nev.slice(0, i), s.nev.slice(i + 2)] : [s.nev, s.leiras || '']; }
  function szab() { return (kat && kat.szabalyok) || {}; }
  function telefon() { return szab().telefon || F.TELEFON; }
  function telHref() { return 'tel:' + telefon().replace(/[^\d+]/g, ''); }
  function meta(h) { return LOC_META[h] || {}; }
  function monogram(nev) { return String(nev || '').split(/\s+/).filter(Boolean).slice(-2).map(function (w) { return w.charAt(0); }).join('').toUpperCase(); }
  function keresztnev(nev) { var p = String(nev || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0]; }

  /* ---------------- URL ↔ állapot ---------------- */
  function readUrl() {
    var q = new URLSearchParams(location.search);
    return {
      h: q.get('helyszin') || '', sz: q.get('kezeles') || '', k: q.get('szakember') || '',
      d: q.get('nap') || '', t: q.get('ido') || '', step: q.get('lepes') || '',
      tok: q.get('t') || '', kesz: q.get('kesz') || '', mod: q.get('modositas') === '1',
      tipus: q.get('tipus') === 'csoportos' ? 'csoportos' : '', ora: q.get('ora') || '', het: q.get('het') || ''
    };
  }
  function buildUrl(extra) {
    var q = new URLSearchParams();
    if (MOCK && location.protocol !== 'file:') q.set('mock', '1');
    if (mod) { q.set('t', mod.tok); q.set('modositas', '1'); }
    else if (cs()) {
      q.set('tipus', 'csoportos');
      if (st.h) q.set('helyszin', st.h);
    } else {
      if (st.h) q.set('helyszin', st.h);
      if (st.sz) q.set('kezeles', st.sz);
    }
    if (cs()) {
      if (st.het && st.het !== F.hetfo(F.most().datum)) q.set('het', st.het);
      if (st.ora) q.set('ora', st.ora);
    } else {
      if (st.k) q.set('szakember', st.k);
      if (st.d) q.set('nap', st.d);
      if (st.t) q.set('ido', st.t);
    }
    if (st.step && st.step !== firstOpenStep()) q.set('lepes', st.step);
    if (extra) Object.keys(extra).forEach(function (k) { q.set(k, extra[k]); });
    var s = q.toString();
    return location.pathname + (s ? '?' + s : '');
  }
  function syncUrl(push) {
    var u = buildUrl();
    if (u === location.pathname + location.search) return;
    history[push ? 'pushState' : 'replaceState']({ f: 1 }, '', u);
  }

  /* ---------------- adatok (munkamenet) ---------------- */
  function loadData() { try { return JSON.parse(sessionStorage.getItem(DATA_KEY) || '{}'); } catch (e) { return {}; } }
  function saveData() {
    var d = { nev: $('#f-nev').value, email: $('#f-email').value, telefon: $('#f-telefon').value, megjegyzes: $('#f-megjegyzes').value, hozzajarul: $('#f-hozzajarul').checked };
    try { sessionStorage.setItem(DATA_KEY, JSON.stringify(d)); } catch (e) { /* nincs tárhely */ }
    return d;
  }
  function fillData() {
    var d = loadData();
    $('#f-nev').value = d.nev || ''; $('#f-email').value = d.email || ''; $('#f-telefon').value = d.telefon || '';
    $('#f-megjegyzes').value = d.megjegyzes || ''; $('#f-hozzajarul').checked = !!d.hozzajarul;
  }
  function dataErrors(d) {
    var e = {};
    if (!String(d.nev || '').trim() || String(d.nev).trim().length < 3) e.nev = 'Add meg a teljes neved.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(d.email || '').trim())) e.email = 'Ez nem tűnik e-mail-címnek. Például: nev@gmail.com';
    var digits = String(d.telefon || '').replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) e.telefon = 'Adj meg egy elérhető telefonszámot, például +36 30 123 4567.';
    if (!d.hozzajarul) e.hozzajarul = 'A foglaláshoz szükség van a hozzájárulásodra.';
    return e;
  }

  /* ---------------- lépés-logika ---------------- */
  function stepIndex(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return i; return -1; }
  function stepDone(id) {
    if (id === 'helyszin') return !!st.h;
    if (id === 'szolgaltatas') return !!st.sz;
    if (id === 'kollega') return !!st.k;
    if (id === 'idopont') return !!(st.d && st.t) && !isMine(st.d, st.t);
    if (id === 'adatok') { var e = dataErrors(loadData()); return !Object.keys(e).length; }
    if (id === 'ora') { var o = oraIdx[st.ora]; return !!o && o.foglalhato && !isMineOra(o.id); }
    return false;
  }
  function maxReachable() {
    for (var i = 0; i < STEPS.length - 1; i++) if (!stepDone(STEPS[i].id)) return i;
    return STEPS.length - 1;
  }
  function firstOpenStep() { return STEPS[maxReachable()].id; }
  function sanitize() {
    if (cs()) {
      if (st.h && !hely(st.h)) st.h = '';
      if (st.ora && !oraIdx[st.ora]) st.ora = '';
      var mc = maxReachable();
      if (!st.step || stepIndex(st.step) < 0 || stepIndex(st.step) > mc) st.step = STEPS[mc].id;
      return;
    }
    if (st.h && !hely(st.h)) st.h = '';
    if (!st.h) { st.sz = st.k = st.d = st.t = ''; }
    var s = szolg(st.sz);
    if (st.sz && (!s || (s.helyszinek || []).indexOf(st.h) < 0)) { st.sz = ''; }
    if (!st.sz) { st.k = st.d = st.t = ''; }
    if (st.k && st.k !== 'barki' && kollegakRa(st.h, st.sz).map(function (x) { return x.id; }).indexOf(st.k) < 0) st.k = '';
    if (!st.k) { st.d = st.t = ''; }
    var ma = F.most().datum;
    if (st.d && (!/^\d{4}-\d{2}-\d{2}$/.test(st.d) || st.d < ma)) { st.d = ''; }
    if (!st.d) st.t = '';
    if (st.t && isNaN(F.perc(st.t))) st.t = '';
    var mx = maxReachable();
    if (!st.step || stepIndex(st.step) < 0 || stepIndex(st.step) > mx) st.step = STEPS[mx].id;
  }
  // a kezelés időtartama: módosításnál a foglaláskor rögzített (ha azóta átírták is)
  function durPerc() { return mod ? mod.f.szolgaltatas.perc : (szolg(st.sz) || {}).perc || 0; }
  // a jelenlegi időpont (módosításnál): ugyanaz a nap és kezdés, és ugyanaz a szakember vagy „bárki”
  function isMine(d, kezd) {
    return !!mod && d === mod.f.datum && kezd === F.hm2(F.perc(mod.f.kezd)) && (!st.k || st.k === 'barki' || st.k === mod.f.kollega.id);
  }

  function go(id, opts) {
    opts = opts || {};
    var i = stepIndex(id);
    if (i < 0) i = 0;
    if (i > maxReachable()) i = maxReachable();
    st.step = STEPS[i].id;
    if (!opts.noAlertClear) hideAlert();
    render({ focus: opts.focus !== false });
    syncUrl(opts.push !== false);
  }
  function next() {
    if (busy) return;
    var i = stepIndex(st.step);
    if (st.step === 'adatok') {
      var d = saveData(), e = dataErrors(d);
      showFieldErrors(e);
      if (Object.keys(e).length) {
        var first = $('[aria-invalid="true"]', $('#bk-form'));
        if (first) first.focus();
        announce('Javítsd a jelölt mezőket: ' + Object.keys(e).length + ' hiba.');
        return;
      }
    }
    if (st.step === 'osszegzes') return mod ? (mod.cs ? submitCsMod() : submitMod()) : cs() ? submitCs() : submit();
    if (!stepDone(st.step)) {
      var why = { helyszin: 'Válassz helyszínt.', szolgaltatas: 'Válassz kezelést.', kollega: 'Válassz szakembert, vagy azt, hogy bárki jó.', idopont: 'Válassz napot és időpontot.', ora: 'Válassz egy órát, ahol van szabad hely.' }[st.step];
      announce(why || '');
      flashHint(why);
      return;
    }
    go(STEPS[i + 1].id);
  }
  function back() {
    if (busy) return;
    var i = stepIndex(st.step);
    if (i > 0) go(STEPS[i - 1].id);
  }

  /* ---------------- figyelmeztetés, élő régió ---------------- */
  function announce(t) { var l = $('#bk-live'); l.textContent = ''; setTimeout(function () { l.textContent = t; }, 40); }
  function showAlert(h, t, action) {
    var a = $('#bk-alert');
    $('#bk-alert-h').textContent = h;
    $('#bk-alert-t').textContent = t;
    var old = $('.btn', a); if (old) old.remove();
    if (action) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = action.label;
      b.addEventListener('click', action.fn);
      $('#bk-alert-t').parentNode.appendChild(b);
    }
    a.hidden = false;
  }
  function hideAlert() { $('#bk-alert').hidden = true; }
  var hintTimer = null;
  function flashHint(t) {
    var sub = $('.bk-step:not([hidden]) .bk-sub') || null;
    var nb = $('#bk-next');
    nb.classList.add('is-nudge');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { nb.classList.remove('is-nudge'); }, 600);
    if (!sub) return;
  }

  /* ---------------- RENDER ---------------- */
  function render(opts) {
    opts = opts || {};
    document.body.classList.toggle('theme-rehab', !cs() && st.h === 'reitter');
    document.body.setAttribute('data-tipus', cs() ? 'csoportos' : 'egyeni');
    document.body.classList.toggle('is-tt', cs() && st.step === 'ora');
    renderMode();
    renderSteps();
    renderCard();
    $$('.bk-step').forEach(function (sec) {
      var on = sec.getAttribute('data-step') === st.step;
      sec.hidden = !on;
      if (on && lastRenderedStep !== st.step && !reduce) {
        sec.classList.remove('is-enter'); void sec.offsetWidth; sec.classList.add('is-enter');
      }
    });
    if (st.step === 'helyszin') renderHelyszin();
    if (st.step === 'szolgaltatas') renderSzolg();
    if (st.step === 'kollega') renderKollega();
    if (st.step === 'idopont') renderIdopont();
    if (st.step === 'ora') renderOrak();
    if (st.step === 'adatok') fillData();
    if (st.step === 'osszegzes') renderOsszegzes();
    renderBar();
    var changed = lastRenderedStep !== st.step;
    lastRenderedStep = st.step;
    var i = stepIndex(st.step);
    document.title = STEPS[i].label + (mod ? (mod.cs ? ' · Áthelyezés másik órára' : ' · Időpont módosítása') : cs() ? ' · Csoportos óra' : ' · Időpontfoglalás') + ' · Studio F360';
    if (changed && opts.focus) {
      var h = $('.bk-step:not([hidden]) h2');
      scrollToFlow();
      if (h) setTimeout(function () { h.focus({ preventScroll: true }); }, reduce ? 0 : 60);
      announce((i + 1) + '. lépés a ' + STEPS.length + '-ból: ' + STEPS[i].label);
    }
  }
  function scrollToFlow() {
    var top = $('#bk-flow-wrap').getBoundingClientRect().top;
    var navh = 96;
    if (top < navh || top > innerHeight * 0.5) {
      var y = scrollY + top - navh - 16;
      if (window.__lenis) window.__lenis.scrollTo(Math.max(0, y), { duration: reduce ? 0 : 0.6, immediate: reduce });
      else window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  function renderSteps() {
    var ol = $('#bk-steps'), cur = stepIndex(st.step), mx = maxReachable();
    ol.style.setProperty('--steps', STEPS.length);
    ol.setAttribute('data-label', (cur + 1) + '/' + STEPS.length + ' · ' + STEPS[cur].label);
    ol.innerHTML = STEPS.map(function (s, i) {
      var cls = i < cur ? 'is-done' : i === cur ? 'is-cur' : 'is-todo';
      var inner = '<span class="st__l"><span class="st__n">' + (i + 1) + '</span>' + s.label + '</span>';
      var sr = '<span class="sr-only">' + (i < cur ? ', kész' : i === cur ? ', aktuális lépés' : '') + '</span>';
      if (i !== cur && i <= mx) {
        return '<li class="' + cls + '"><button type="button" class="st" data-go="' + s.id + '" aria-label="' + (i + 1) + '. lépés: ' + s.label + (i < cur ? ', kész, vissza ide' : ', ugrás ide') + '">' + inner + '</button></li>';
      }
      return '<li class="' + cls + '"' + (i === cur ? ' aria-current="step"' : '') + '><span class="st">' + inner + sr + '</span></li>';
    }).join('');
    // telefon: egy sor a választásokból
    var parts = [];
    if (cs()) {
      var oc = oraIdx[st.ora];
      if (oc && stepIndex(st.step) > 0) parts.push(oc.ora.nev, F.datumNap(oc.datum) + ' ' + F.hm(F.perc(oc.kezd)));
      $('#bk-trail').innerHTML = parts.map(esc).join(' · ');
      return;
    }
    var h = hely(st.h), s = szolg(st.sz), k = koll(st.k);
    if (h) parts.push(h.nev);
    if (s) parts.push(s.nev + ', ' + s.perc + ' perc');
    if (st.k) parts.push(st.k === 'barki' ? 'bárki' : k ? k.nev : '');
    if (st.d && st.t && stepIndex(st.step) > stepIndex('idopont')) parts.push(F.datumNap(st.d) + ' ' + F.hm(F.perc(st.t)));
    $('#bk-trail').innerHTML = parts.length ? parts.map(esc).join(' · ') : '';
  }

  function cardRow(key, label, value, sub, stepId, extraCls) {
    var filled = !!value;
    var editBtn = filled && stepId && stepIndex(stepId) >= 0 && stepIndex(stepId) !== stepIndex(st.step)
      ? '<dd class="rev__act"><button type="button" class="edit" data-go="' + stepId + '" aria-label="' + esc(label) + ' módosítása">Módosítás</button></dd>' : '';
    return '<div class="' + (filled ? 'is-fill' : 'is-empty') + (extraCls ? ' ' + extraCls : '') + '" data-row="' + key + '"><dt>' + esc(label) + '</dt><dd>' +
      (filled ? esc(value) + (sub ? '<small>' + esc(sub) + '</small>' : '') : '<span class="sr-only">még nincs kiválasztva</span>') + '</dd>' + editBtn + '</div>';
  }
  var prevCard = {};
  function renderCard() {
    if (cs()) return renderCardCs();
    var h = hely(st.h), s = szolg(st.sz), k = koll(st.k), dur = durPerc();
    var rows = [];
    if (mod) {
      var mf = mod.f;
      rows.push(['m', 'Jelenlegi időpont', F.datumNap(mf.datum), F.hm(F.perc(mf.kezd)) + '-' + F.hm(F.perc(mf.veg)) + ', ' + mf.kollega.nev, null, 'is-now']);
    }
    rows = rows.concat([
      ['h', 'Helyszín', h ? h.nev : '', h ? (meta(st.h).utca || h.cim || '') : '', 'helyszin'],
      ['s', 'Kezelés', s ? szolgNev(s) : '', s ? dur + ' perc' : '', 'szolgaltatas'],
      ['k', mod ? 'Új szakember' : 'Szakember', st.k === 'barki' ? 'Bárki' : k ? k.nev : '', st.k === 'barki' ? 'a stúdió osztja be' : k ? k.szerep : '', 'kollega'],
      ['i', mod ? 'Új időpont' : 'Időpont', st.d && st.t && !isMine(st.d, st.t) ? F.datumNap(st.d) : '', st.d && st.t ? F.hm(F.perc(st.t)) + '-' + F.hm(F.perc(st.t) + dur) : '', 'idopont'],
      ['a', 'Díj', mod ? (mf.szolgaltatas.ar != null ? F.ft(mf.szolgaltatas.ar).replace(/\u00a0/g, ' ') : '') : s ? F.ft(s.ar).replace(/\u00a0/g, ' ') : '', '', null, 'rev__sum']
    ]);
    var html = rows.map(function (r) { return cardRow(r[0], r[1], r[2], r[3], r[4], r[5]); }).join('');
    var dl = $('#bk-card-rows');
    dl.innerHTML = html;
    $('#bk-card-hint').hidden = !!st.h;
    $('#bk-card-h').textContent = mod ? 'Áthelyezés' : 'A foglalásod';
    // csak az újonnan kitöltött sor „íródjon be” (a többi ne villogjon)
    rows.forEach(function (r) {
      var el = $('[data-row="' + r[0] + '"]', dl);
      if (el && r[2] && prevCard[r[0]] === r[2] + r[3]) el.classList.remove('is-fill'), el.classList.add('is-kept');
      prevCard[r[0]] = r[2] ? r[2] + r[3] : '';
    });
  }

  function renderBar() {
    var i = stepIndex(st.step);
    var back = $('#bk-back'), nx = $('#bk-next');
    back.hidden = i === 0;
    var ok = st.step === 'adatok' || st.step === 'osszegzes' || stepDone(st.step);
    nx.setAttribute('aria-disabled', ok ? 'false' : 'true');
    $('#bk-next-t').textContent = st.step === 'osszegzes' ? (mod ? 'Áthelyezés véglegesítése' : cs() ? 'Jelentkezés véglegesítése' : 'Foglalás véglegesítése') : st.step === 'adatok' ? 'Tovább az összegzéshez' : 'Tovább';
  }

  /* ---------- 1. helyszín ---------- */
  function renderHelyszin() {
    var box = $('#opt-helyszin');
    box.innerHTML = kat.helyszinek.map(function (h) {
      var m = meta(h.id);
      var names = [];
      szolgHelyen(h.id).forEach(function (s) {
        var n = szolgReszek(s)[0];
        if (names.length && !/[A-ZÁÉÍÓÖŐÚÜŰ]/.test(n.slice(1))) n = n.charAt(0).toLowerCase() + n.slice(1); // a „Kinvent PRO” marad
        if (names.indexOf(n) < 0) names.push(n);
      });
      var nyit = h.nyit || m.nyit, zar = h.zar || m.zar;
      return '<label class="loc loc--' + esc(h.id) + '">' +
        '<input type="radio" name="helyszin" value="' + esc(h.id) + '"' + (st.h === h.id ? ' checked' : '') + '>' +
        '<span class="loc__img">' + (m.img ? '<img src="' + esc(m.img) + '" alt="" width="1400" height="931" loading="eager">' : '') + '</span>' +
        '<span class="loc__b">' +
          '<span class="loc__k">' + esc(h.kerulet || m.kerulet || '') + '</span>' +
          '<span class="loc__n">' + esc(h.nev) + '</span>' +
          '<span class="loc__a">' + esc(m.utca || String(h.cim || '').split(',')[0]) + '</span>' +
          '<span class="loc__s">' + esc(names.slice(0, 4).join(', ')) + '</span>' +
          (nyit && zar ? '<span class="loc__h">Hétköznap ' + esc(F.hm(F.perc(nyit)) + '-' + F.hm(F.perc(zar))) + '</span>' : '') +
        '</span>' +
        '<span class="mk" aria-hidden="true">' + CHECK + '</span>' +
      '</label>';
    }).join('');
  }

  /* ---------- 2. kezelés ---------- */
  function renderSzolg() {
    var h = hely(st.h);
    $('#sub-szolgaltatas').textContent = h ? h.nev + (meta(st.h).kerulet ? ', ' + meta(st.h).kerulet : '') + '. Az ár egy alkalomra szól.' : '';
    var list = szolgHelyen(st.h);
    if (!list.length) { $('#opt-szolgaltatas').innerHTML = '<p class="opts__empty">Ezen a helyszínen most nincs online foglalható kezelés. Hívj minket: <a class="lnk" href="' + telHref() + '">' + esc(telefon()) + '</a></p>'; return; }
    var tapl = list.filter(function (s) { return TAPL[s.id]; }), tobbi = list.filter(function (s) { return !TAPL[s.id]; });
    var csoport = function (cim, l, id) {
      return (cim ? '<p class="opts__h" id="' + id + '">' + esc(cim) + '</p>' : '') + '<div class="opts" role="group"' + (cim ? ' aria-labelledby="' + id + '"' : '') + '>' + l.map(szolgSor).join('') + '</div>';
    };
    $('#opt-szolgaltatas').innerHTML = tapl.length && tobbi.length
      ? csoport('Gyógytorna és masszázs', tobbi, 'oh-kez') + csoport('Táplálkozás & InBody', tapl, 'oh-tapl')
      : csoport('', list);
  }

  function szolgSor(s) {
    var r = szolgReszek(s), leir = s.leiras && s.leiras !== r[1] ? s.leiras : '';
    // nincs beosztás (például a táplálkozási tanácsadásnál az elején): látszik, de telefonon foglalható
    if (s.vanBeosztas === false) {
      return '<div class="opt opt--tel" aria-disabled="true">' +
        '<span class="mk mk--off" aria-hidden="true"></span>' +
        '<span class="opt__t"><span class="opt__n">' + esc(r[0]) + '</span>' + (r[1] ? '<span class="opt__d">' + esc(r[1]) + '</span>' : '') +
          '<span class="opt__tel">Jelenleg nincs szabad időpont, hívj minket: <a class="lnk" href="' + telHref() + '">' + esc(telefon()) + '</a></span></span>' +
        '<span class="opt__m"><b>' + esc(F.ft(s.ar)) + '</b><span>' + esc(s.perc) + ' perc</span></span>' +
      '</div>';
    }
    return '<label class="opt">' +
      '<input type="radio" name="szolgaltatas" value="' + esc(s.id) + '"' + (st.sz === s.id ? ' checked' : '') + '>' +
      '<span class="mk" aria-hidden="true">' + CHECK + '</span>' +
      '<span class="opt__t"><span class="opt__n">' + esc(r[0]) + '</span>' + (r[1] ? '<span class="opt__d">' + esc(r[1]) + '</span>' : '') +
        (leir ? '<span class="opt__d">' + esc(leir) + '</span>' : '') + '</span>' +
      '<span class="opt__m"><b>' + esc(F.ft(s.ar)) + '</b><span>' + esc(s.perc) + ' perc</span></span>' +
    '</label>';
  }

  /* ---------- 3. szakember ---------- */
  function renderKollega() {
    var s = szolg(st.sz), h = hely(st.h);
    $('#sub-kollega').textContent = s ? szolgNev(s) + ', ' + durPerc() + ' perc · ' + (h ? h.nev : '') : '';
    var list = kollegakRa(st.h, st.sz), jelenlegi = mod ? mod.f.kollega.id : '';
    var any = '<label class="opt opt--any">' +
      '<input type="radio" name="kollega" value="barki"' + (st.k === 'barki' ? ' checked' : '') + '>' +
      '<span class="mk" aria-hidden="true">' + CHECK + '</span>' +
      '<span class="face face--any" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="16.5" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M14.5 14.6c.6-.3 1.3-.5 2-.5 2.3 0 4 1.5 4.5 4.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>' +
      '<span class="opt__t"><span class="opt__n">Bárki jó</span><span class="opt__d">A legtöbb szabad időpont. A szakembert a stúdió osztja be' + (list.length ? ' (' + list.length + ' kolléga végzi)' : '') + '.</span></span>' +
    '</label>';
    $('#opt-kollega').innerHTML = any + list.map(function (k) {
      var face = kepOf(k) ? '<span class="face" aria-hidden="true"><img src="' + esc(kepOf(k)) + '" alt="" width="104" height="104" loading="lazy"></span>'
        : '<span class="face" aria-hidden="true"><span>' + esc(monogram(k.nev)) + '</span></span>';
      return '<label class="opt">' +
        '<input type="radio" name="kollega" value="' + esc(k.id) + '"' + (st.k === k.id ? ' checked' : '') + '>' +
        '<span class="mk" aria-hidden="true">' + CHECK + '</span>' + face +
        '<span class="opt__t"><span class="opt__n">' + esc(k.nev) + '</span><span class="opt__d">' + esc(k.szerep || '') + '</span></span>' +
        (k.id === jelenlegi ? '<span class="opt__now">Jelenlegi</span>' : '') +
      '</label>';
    }).join('');
  }

  /* ---------- 4. nap + időpont ---------- */
  var kesz = {}; // a már megérkezett hetek (cacheKey → napok), hogy a visszalapozás azonnali legyen
  function cacheKey(tol) { return [mod ? 'm' : '', st.h, st.sz, st.k || 'barki', tol].join('|'); }
  function fetchWeek(tol) {
    var key = cacheKey(tol);
    if (!cache[key]) {
      var ig = F.addDays(tol, 6);
      // módosításnál a token adja a helyszínt és a kezelést, a saját időpont szabadnak számít
      var path = mod
        ? '/szabad?t=' + encodeURIComponent(mod.tok) + '&kollega=' + encodeURIComponent(st.k || 'barki') + '&tol=' + tol + '&ig=' + ig
        : '/szabad?helyszin=' + encodeURIComponent(st.h) + '&szolgaltatas=' + encodeURIComponent(st.sz) +
          '&kollega=' + encodeURIComponent(st.k || 'barki') + '&tol=' + tol + '&ig=' + ig;
      cache[key] = api(path).then(function (r) { var n = (r && r.napok) || {}; kesz[key] = n; return n; })
        .catch(function (e) { delete cache[key]; throw e; });
    }
    return cache[key];
  }
  function weekLimits() {
    var ma = F.most().datum, mx = szab().maxEloreNap || 60;
    return { min: F.hetfo(ma), max: F.hetfo(F.addDays(ma, mx)), ma: ma, utolso: F.addDays(ma, mx) };
  }
  function weekLabel(tol) {
    var ig = F.addDays(tol, 6);
    var m1 = Number(tol.slice(5, 7)) - 1, m2 = Number(ig.slice(5, 7)) - 1;
    var ev = tol.slice(0, 4);
    return ev + '. ' + (m1 === m2 ? F.HONAPOK[m1] : F.HONAPOK[m1] + ' és ' + F.HONAPOK[m2]);
  }
  var weekReq = 0;
  function renderIdopont(dir) {
    var s = szolg(st.sz), k = koll(st.k);
    $('#sub-idopont').textContent = (s ? szolgNev(s) + ', ' + durPerc() + ' perc' : '') + (st.k === 'barki' ? ' · bárki' : k ? ' · ' + k.nev : '') +
      (mod ? '. A jelenlegi időpontod jelölve van.' : '');
    var L = weekLimits();
    if (!st.het) st.het = F.hetfo(st.d || (mod ? mod.f.datum : L.ma));
    if (st.het < L.min) st.het = L.min;
    if (st.het > L.max) st.het = L.max;
    $('#wk-label').textContent = weekLabel(st.het);
    $('#wk-prev').disabled = st.het <= L.min;
    $('#wk-next').disabled = st.het >= L.max;
    var days = $('#wk-days');
    var req = ++weekReq;
    var megvan = kesz[cacheKey(st.het)];
    if (!days.children.length || dir) days.innerHTML = dayButtons(st.het, megvan || null);
    if (dir && !reduce) { days.classList.remove('is-slide', 'is-slide-back'); void days.offsetWidth; days.classList.add(dir > 0 ? 'is-slide' : 'is-slide-back'); }
    if (!megvan) setSlotsLoading(true);
    fetchWeek(st.het).then(function (napok) {
      if (req !== weekReq) return;
      // ha még nincs nap kiválasztva ezen a héten: az első nap, ahol van szabad időpont
      var inWeek = st.d && st.d >= st.het && st.d <= F.addDays(st.het, 6);
      if (!inWeek) {
        var first = null;
        // módosításnál a jelenlegi nap az első jelölt (ott látszik a mostani időpont is)
        var sajat = mod && mod.f.datum >= st.het && mod.f.datum <= F.addDays(st.het, 6) && (napok[mod.f.datum] || []).some(function (x) { return !isMine(mod.f.datum, x.kezd); }) ? mod.f.datum : null;
        for (var i = 0; i < 7 && !sajat; i++) { var dd = F.addDays(st.het, i); if ((napok[dd] || []).some(function (x) { return !isMine(dd, x.kezd); }) && dd >= L.ma && dd <= L.utolso) { first = dd; break; } }
        if (sajat) first = sajat;
        if (first) { st.d = first; st.t = ''; syncUrl(false); }
        else if (!dir && !autoJumped && st.het < L.max) {
          // ezen a héten nincs hely: magától a következő hétre lép (egyszer)
          autoJumped = true; st.het = F.addDays(st.het, 7); return renderIdopont(1);
        } else { st.d = ''; st.t = ''; syncUrl(false); }
      }
      autoJumped = false;
      days.innerHTML = dayButtons(st.het, napok);
      renderSlots(napok[st.d] || [], napok);
      renderCard(); renderBar(); renderSteps();
    }).catch(function (e) {
      if (req !== weekReq) return;
      setSlotsLoading(false);
      $('#slots').innerHTML = '<div class="slots__empty"><p>' + esc(e.message) + '</p><button type="button" class="btn" id="slots-retry">Újrapróbálom</button></div>';
      $('#slots-retry').addEventListener('click', function () { renderIdopont(); });
    });
  }
  var autoJumped = false;
  function dayButtons(tol, napok) {
    var L = weekLimits(), out = '';
    for (var i = 0; i < 7; i++) {
      var d = F.addDays(tol, i), n = napok ? (napok[d] || []).filter(function (x) { return !isMine(d, x.kezd); }).length : null;
      var mineDay = !!mod && d === mod.f.datum && napok && (napok[d] || []).some(function (x) { return isMine(d, x.kezd); });
      var off = d < L.ma || d > L.utolso || (n === 0 && !mineDay);
      var dn = Number(d.slice(8, 10));
      var cnt = n === null ? '' : off ? (d < L.ma ? '' : 'nincs') : n + ' szabad';
      var sr = F.datumNap(d) + (off ? ', nincs szabad időpont' : n === null ? '' : ', ' + n + ' szabad időpont') + (mod && d === mod.f.datum ? ', a jelenlegi időpontod napja' : '');
      out += '<label class="day' + (off ? ' is-off' : '') + (d === L.ma ? ' is-today' : '') + (mod && d === mod.f.datum ? ' is-mine' : '') + '">' +
        '<input type="radio" name="nap" value="' + d + '"' + (st.d === d && !off ? ' checked' : '') + (off || n === null ? ' disabled' : '') + '>' +
        '<span class="day__w" aria-hidden="true">' + F.NAPOK_ROVID[F.hetNapja(d)] + '</span>' +
        '<span class="day__d" aria-hidden="true">' + dn + '</span>' +
        '<span class="day__c" aria-hidden="true">' + cnt + '</span>' +
        '<span class="sr-only">' + esc(sr) + '</span>' +
      '</label>';
    }
    return out;
  }
  // Töltés alatt a doboz nem eshet össze (különben az oldal ugrál): a magasság rögzül, a meglévő időpontok
  // halványítva maradnak; a váz csak akkor jelenik meg, ha 150 ms alatt sem jött válasz és a doboz üres.
  var vazIdozito = 0;
  function setSlotsLoading(on) {
    var s = $('#slots');
    s.setAttribute('aria-busy', on ? 'true' : 'false');
    clearTimeout(vazIdozito);
    if (on) {
      s.style.minHeight = s.getBoundingClientRect().height + 'px';
      s.classList.add('is-load');
      vazIdozito = setTimeout(function () {
        if (s.getAttribute('aria-busy') !== 'true' || s.querySelector('.slot')) return;
        s.innerHTML = '<div class="slots__grp"><p class="slots__h"><span class="sr-only">Szabad időpontok betöltése</span>&nbsp;</p><div class="slots__grid">' + new Array(9).join('<span class="skel"></span>') + '</div></div>';
      }, 150);
    } else {
      s.classList.remove('is-load');
    }
  }
  // Új tartalom után a rögzített magasság fokozatosan enged az új magasságra (mozgás-csökkentésnél azonnal).
  var engedIdozito = 0;
  function slotsMagassagEngedes(regi) {
    var s = $('#slots');
    s.style.minHeight = '';
    if (!regi) return;
    if (reduce) return;
    var uj = s.getBoundingClientRect().height;
    if (Math.abs(uj - regi) < 2) return;
    // a régi magasságról az újra úszik (nő vagy csökken), így az alatta lévő gombok nem ugranak
    clearTimeout(engedIdozito);
    s.style.height = regi + 'px';
    s.style.overflow = 'hidden';
    void s.offsetHeight;
    s.classList.add('is-meret');
    s.style.height = uj + 'px';
    engedIdozito = setTimeout(function () { s.classList.remove('is-meret'); s.style.height = ''; s.style.overflow = ''; }, 280);
  }
  function renderSlots(list, napok) {
    var sb = $('#slots');
    var regi = sb.style.minHeight ? parseFloat(sb.style.minHeight) : sb.getBoundingClientRect().height;
    renderSlotsBelso(list, napok); slotsMagassagEngedes(regi);
  }
  function renderSlotsBelso(list, napok) {
    setSlotsLoading(false);
    var box = $('#slots');
    if (!st.d) {
      var L = weekLimits(), anyLater = st.het < L.max;
      box.innerHTML = '<div class="slots__empty"><p>Ezen a héten már nincs szabad időpont' + (st.k && st.k !== 'barki' ? ' ennél a szakembernél. Nézd meg a következő hetet, vagy válaszd azt, hogy bárki jó.' : '. Nézd meg a következő hetet.') + '</p>' +
        '<div class="done__act">' + (anyLater ? '<button type="button" class="btn" data-week="1">Következő hét</button>' : '') +
        (st.k && st.k !== 'barki' ? '<button type="button" class="btn" data-anyone="1">Bárki jó</button>' : '') + '</div></div>';
      return;
    }
    if (!list.length) { box.innerHTML = '<div class="slots__empty"><p>Erre a napra nincs szabad időpont. Válassz másik napot.</p></div>'; return; }
    var s = szolg(st.sz), groups = [['Délelőtt', 0, 720], ['Délután', 720, 1020], ['Este', 1020, 1440]];
    var html = '<fieldset class="bk-fs"><legend class="sr-only">Szabad időpontok, ' + esc(F.datumNap(st.d)) + '</legend>';
    groups.forEach(function (g) {
      var items = list.filter(function (x) { var p = F.perc(x.kezd); return p >= g[1] && p < g[2]; });
      if (!items.length) return;
      html += '<div class="slots__grp"><p class="slots__h" aria-hidden="true">' + g[0] + '</p><div class="slots__grid">' +
        items.map(function (x) {
          var p = F.perc(x.kezd), v = F.hm2(p);
          var who = st.k === 'barki' && x.kollegak && x.kollegak.length === 1 && koll(x.kollegak[0]) ? ', ' + koll(x.kollegak[0]).nev : '';
          if (isMine(st.d, v)) {
            // a jelenlegi időpont: jelölve, de nem választható (ugyanarra nem lehet áthelyezni)
            return '<label class="slot is-mine"><input type="radio" name="ido" value="' + v + '" disabled>' +
              '<span aria-hidden="true">' + F.hm(p) + '<small>jelenlegi</small></span>' +
              '<span class="sr-only">' + esc(F.hm(p) + ', ' + F.datumNap(st.d) + ', a jelenlegi időpontod') + '</span></label>';
          }
          return '<label class="slot"><input type="radio" name="ido" value="' + v + '"' + (st.t === v ? ' checked' : '') + '>' +
            '<span aria-hidden="true">' + F.hm(p) + '</span>' +
            '<span class="sr-only">' + esc(F.hm(p) + ', ' + F.datumNap(st.d) + ', ' + durPerc() + ' perc' + who) + '</span></label>';
        }).join('') + '</div></div>';
    });
    html += '</fieldset>';
    box.innerHTML = html;
    if (st.t && !$('input[name="ido"]:checked', box)) { st.t = ''; syncUrl(false); }
  }

  /* ---------- 6. összegzés ---------- */
  function revRows(withEdit) {
    var h = hely(st.h), s = szolg(st.sz), k = koll(st.k), d = loadData();
    var t = F.perc(st.t);
    var rows = [
      ['Időpont', F.datumHosszu(st.d), F.hm(t) + '-' + F.hm(t + s.perc), 'idopont'],
      ['Kezelés', szolgNev(s), s.perc + ' perc', 'szolgaltatas'],
      ['Szakember', st.k === 'barki' ? 'Bárki' : k.nev, st.k === 'barki' ? 'a stúdió osztja be' : k.szerep, 'kollega'],
      ['Helyszín', h.nev, meta(st.h).utca || h.cim, 'helyszin'],
      ['Adataid', d.nev, [d.email, d.telefon].join(' · ') + (d.megjegyzes ? '\n' + d.megjegyzes : ''), 'adatok'],
      ['Díj', F.ft(s.ar), 'a helyszínen fizetendő', null, 'rev__sum']
    ];
    return rows.map(function (r) {
      return '<div' + (r[4] ? ' class="' + r[4] + '"' : '') + '><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]).replace(/\n/g, '<br>') + '</small>' : '') + '</dd>' +
        (withEdit && r[3] ? '<dd class="rev__act"><button type="button" class="edit" data-go="' + r[3] + '" aria-label="' + esc(r[0]) + ' módosítása">Módosítás</button></dd>' : '<dd class="rev__act"></dd>') + '</div>';
    }).join('');
  }
  function renderOsszegzes() {
    $('#ossz-prep').innerHTML = '';
    if (cs()) return renderOsszegzesCs();
    if (!mod) {
      $('#rev').innerHTML = revRows(true); $('#h-osszegzes').textContent = 'Ellenőrizd a foglalást';
      var sp = szolg(st.sz);
      if (sp && sp.elokeszites && sp.elokeszites.length) $('#ossz-prep').innerHTML = prepHtml(sp.elokeszites);
      return;
    }
    // áthelyezés: régi és új időpont egymás alatt, a többi marad
    var mf = mod.f, k = koll(st.k), t = F.perc(st.t), dur = durPerc();
    var rows = [
      ['Új időpont', F.datumHosszu(st.d), F.hm(t) + '-' + F.hm(t + dur), 'idopont', 'rev__new'],
      ['Eddig', F.datumHosszu(mf.datum), F.hm(F.perc(mf.kezd)) + '-' + F.hm(F.perc(mf.veg)) + ', ' + mf.kollega.nev, null, 'rev__old'],
      ['Szakember', st.k === 'barki' ? 'Bárki' : k ? k.nev : '', st.k === 'barki' ? 'a stúdió osztja be' : k ? k.szerep : '', 'kollega'],
      ['Kezelés', mf.szolgaltatas.nev, dur + ' perc'],
      ['Helyszín', mf.helyszin.nev, meta(mf.helyszin.id).utca || mf.helyszin.cim],
      ['Foglalás száma', mod.info.azonosito, 'marad, és a levélben lévő link is']
    ];
    $('#h-osszegzes').textContent = 'Ellenőrizd az új időpontot';
    $('#rev').innerHTML = rows.map(function (r) {
      return '<div' + (r[4] ? ' class="' + r[4] + '"' : '') + '><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</dd>' +
        (r[3] ? '<dd class="rev__act"><button type="button" class="edit" data-go="' + r[3] + '" aria-label="' + esc(r[0]) + ' módosítása">Módosítás</button></dd>' : '<dd class="rev__act"></dd>') + '</div>';
    }).join('');
  }

  // InBody „Mérés előtt”: a backend szolgáltatás-mezőjéből (a taplalkozas.html listája)
  function prepHtml(l) {
    return '<section class="prep" aria-labelledby="prep-h"><h3 class="prep__h" id="prep-h">Mérés előtt</h3><ul>' +
      l.map(function (x) { return '<li>' + esc(String(x).charAt(0).toUpperCase() + String(x).slice(1)) + '</li>'; }).join('') + '</ul></section>';
  }


  /* =====================================================================
     CSOPORTOS ÓRA  (?tipus=csoportos): heti órarend → adatok → összegzés
     Az órák a /foglalas-api/orak-ból (max 14 nap, itt hetente 7), a jelentkezés a
     /foglalas-api/ora-foglalas-ra. A szabad helyek száma minden hétváltáskor friss.
     Asztalin a mexikoi.html órarend-táblájának rendje (sor = napszak, oszlop = nap),
     telefonon napi lista. Egy óra jele: a helyek pöttysora (tele pötty = foglalt hely).
     ===================================================================== */
  var ttUgrott = false;
  var oraCache = {}, oraKesz = {}, oraReq = 0, ttNarrow = matchMedia('(max-width: 760px)');
  function oraKey(tol) { return [st.h || '*', tol].join('|'); }
  function fetchOrak(tol) {
    var key = oraKey(tol);
    if (!oraCache[key]) {
      var path = '/orak?' + (st.h ? 'helyszin=' + encodeURIComponent(st.h) + '&' : '') + 'tol=' + tol + '&ig=' + F.addDays(tol, 6);
      oraCache[key] = api(path).then(function (r) {
        var l = (r && r.orak) || [];
        l.forEach(function (o) { oraIdx[o.id] = o; });
        oraKesz[key] = l; return l;
      }).catch(function (e) { delete oraCache[key]; throw e; });
    }
    return oraCache[key];
  }
  function oraCacheUrit() { oraCache = {}; oraKesz = {}; }
  function isMineOra(id) { return !!mod && !!mod.cs && id === mod.f.session; }
  function oktatoRovid(k) { return k && k.nev ? keresztnev(k.nev) : 'oktató hamarosan'; }
  // ha az órához még nincs oktató kiírva (Lillától kérdezzük), ne üres sor legyen
  var OKTATO_NINCS = 'Hamarosan közöljük';
  function oktatoNev(k) { return k && k.nev ? k.nev : OKTATO_NINCS; }
  function hetCimke(tol) {
    var ig = F.addDays(tol, 6);
    return tol.slice(5, 7) === ig.slice(5, 7) ? F.HONAPOK[Number(tol.slice(5, 7)) - 1] + ' ' + Number(tol.slice(8)) + '-' + Number(ig.slice(8)) + '.'
      : F.honapNap(tol) + ' - ' + F.honapNap(ig);
  }
  // miért nem választható (az API ok mezője), a cellában rövid, felolvasva teljes
  var OK_SZ = { betelt: 'Betelt', hatarido: 'Jelentkezés lezárult', elmarad: 'Elmarad', mult: 'Lezajlott' };
  function helyTxt(o) { return o.szabad + ' hely szabad'; }
  function pottyok(o) {
    if (!o.kapacitas || o.kapacitas > 14) return '';
    var foglalt = o.kapacitas - o.szabad, out = '';
    for (var i = 0; i < o.kapacitas; i++) out += '<i' + (i < foglalt ? ' class="is-f"' : '') + '></i>';
    return '<span class="tt-dots" aria-hidden="true">' + out + '</span>';
  }
  function oraSr(o, extra) {
    return [F.datumNap(o.datum) + ', ' + F.hm(F.perc(o.kezd)) + '-' + F.hm(F.perc(o.veg)), o.ora.nev, o.kollega ? o.kollega.nev : 'oktató hamarosan', o.ora.perc + ' perc',
      o.ora.ar != null ? F.ft(o.ora.ar).replace(/\u00a0/g, ' ') : '', extra].filter(Boolean).join(', ');
  }
  function oraCella(o) {
    var mine = isMineOra(o.id), ok = mine ? null : o.ok, valaszthato = !mine && o.foglalhato;
    var allapot = mine ? 'jelenlegi órád' : ok ? OK_SZ[ok] || 'nem választható' : helyTxt(o);
    var cls = 'tt-c' + (ok ? ' is-' + ok : '') + (mine ? ' is-mine' : '') + (o.szabad > 0 && o.szabad <= 2 && valaszthato ? ' is-low' : '');
    var meta = [oktatoRovid(o.kollega), o.ora.perc + '′', o.ora.ar != null ? F.ft(o.ora.ar) : ''].filter(Boolean).map(esc).join(' · ');
    var belso = '<span class="tt-c__t" aria-hidden="true">' + esc(F.hm(F.perc(o.kezd))) + '</span>' +
      '<span class="tt-c__n" aria-hidden="true">' + esc(o.ora.nev) + '</span>' +
      '<span class="tt-c__m" aria-hidden="true">' + meta + '</span>' +
      '<span class="tt-c__s" aria-hidden="true">' + (valaszthato || mine ? pottyok(o) : '') + '<b>' + esc(mine ? 'Jelenlegi órád' : ok ? OK_SZ[ok] : helyTxt(o)) + '</b></span>' +
      (ok === 'elmarad' && o.megjegyzes ? '<span class="tt-c__x" aria-hidden="true">' + esc(o.megjegyzes) + '</span>' : '') +
      '<span class="sr-only">' + esc(oraSr(o, allapot)) + '</span>';
    if (!valaszthato) return '<label class="' + cls + '"><input type="radio" name="ora" value="' + esc(o.id) + '" disabled>' + belso + '</label>';
    return '<label class="' + cls + '"><input type="radio" name="ora" value="' + esc(o.id) + '"' + (st.ora === o.id ? ' checked' : '') + '>' + belso + '</label>';
  }
  var NAPSZAK = [['Reggel', 0, 720], ['Délután', 720, 1080], ['Este', 1080, 1440]];
  function renderTt(lista) {
    var tol = st.het, napok = [], ma = F.most().datum;
    // a folyó héten a már elmúlt napok nem kellenek (ott nincs foglalható óra), az oszlopok a mai nappal indulnak
    for (var i = 0; i < 7; i++) {
      var d = F.addDays(tol, i), l = lista.filter(function (o) { return o.datum === d; });
      if (d < ma && !l.length) continue;
      if (i < 6 || l.length) napok.push({ d: d, l: l });
    }
    var ures = !lista.length;
    if (ures) {
      var L = weekLimits();
      return '<div class="slots__empty tt-empty"><p>Ezen a héten nincs meghirdetett csoportos óra' + (st.h && hely(st.h) ? ' a(z) ' + esc(hely(st.h).nev) + ' helyszínen' : '') + '.</p>' +
        (st.het < L.max ? '<div class="done__act"><button type="button" class="btn" data-ttweek="1">Következő hét</button></div>' : '') + '</div>';
    }
    if (ttNarrow.matches) {
      // telefon: napi lista (csak az órás napok), napszak nélkül, idő szerint
      return '<div class="tt-list">' + napok.filter(function (n) { return n.l.length; }).map(function (n) {
        return '<section class="tt-day' + (n.d === ma ? ' is-today' : '') + '" aria-labelledby="ttd-' + n.d + '"><h3 class="tt-day__h" id="ttd-' + n.d + '">' +
          esc(F.NAPOK[F.hetNapja(n.d)].replace(/^./, function (c) { return c.toUpperCase(); })) + '<span>' + esc(F.honapNap(n.d)) + (n.d === ma ? ' · ma' : '') + '</span></h3>' +
          '<div class="tt-day__l">' + n.l.map(oraCella).join('') + '</div></section>';
      }).join('') + '</div>';
    }
    var cols = napok.length, html = '<div class="tt-grid" style="--cols:' + cols + '">';
    html += '<div class="tt-h tt-h--corner" aria-hidden="true"></div>';
    napok.forEach(function (n) {
      html += '<div class="tt-h' + (n.d === ma ? ' is-today' : '') + '" aria-hidden="true"><b>' + esc(F.NAPOK[F.hetNapja(n.d)].replace(/^./, function (c) { return c.toUpperCase(); })) + '</b><span>' + esc(F.honapNap(n.d)) + (n.d === ma ? ' · ma' : '') + '</span></div>';
    });
    NAPSZAK.forEach(function (sz) {
      var van = lista.some(function (o) { var p = F.perc(o.kezd); return p >= sz[1] && p < sz[2]; });
      if (!van) return;
      html += '<div class="tt-p" aria-hidden="true"><span>' + sz[0] + '</span></div>';
      napok.forEach(function (n) {
        var l = n.l.filter(function (o) { var p = F.perc(o.kezd); return p >= sz[1] && p < sz[2]; });
        html += '<div class="tt-cell">' + l.map(oraCella).join('') + '</div>';
      });
    });
    return html + '</div>';
  }
  function setTtLoading(on) {
    var b = $('#tt-body');
    b.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on) { b.style.minHeight = b.getBoundingClientRect().height + 'px'; b.classList.add('is-load'); }
    else { b.classList.remove('is-load'); b.style.minHeight = ''; }
  }
  function renderOrak(dir) {
    var L = weekLimits();
    if (!st.het) st.het = F.hetfo(mod && mod.cs ? mod.f.datum : L.ma);
    if (st.het < L.min) st.het = L.min;
    if (st.het > L.max) st.het = L.max;
    var h = hely(st.h);
    $('#sub-ora').textContent = mod && mod.cs
      ? 'Jelenleg: ' + mod.f.ora.nev + ', ' + F.datumNap(mod.f.datum) + ' ' + F.hm(F.perc(mod.f.kezd)) + '. Válassz másik órát, ahol van szabad hely.'
      : (h ? h.nev + '. ' : '') + 'Az óra díját a helyszínen fizeted. A 10:00 előtti órákra előző este ' + String(szab().reggeliHatarOra == null ? 22 : szab().reggeliHatarOra) + ':00-ig lehet jelentkezni.';
    $('#tt-label').textContent = hetCimke(st.het);
    $('#tt-prev').disabled = st.het <= L.min;
    $('#tt-next').disabled = st.het >= L.max;
    var body = $('#tt-body'), req = ++oraReq, megvan = oraKesz[oraKey(st.het)];
    if (megvan) { body.innerHTML = renderTt(megvan); slideTt(dir); return; }
    if (!body.children.length) body.innerHTML = '<div class="tt-skel">' + new Array(7).join('<span class="skel"></span>') + '</div>';
    setTtLoading(true);
    fetchOrak(st.het).then(function (l) {
      if (req !== oraReq) return;
      // a folyó héten már nincs foglalható óra (például vasárnap este): egyszer magától a következő hétre lép
      if (!dir && !ttUgrott && !(mod && mod.cs) && !st.ora && st.het < L.max && !l.some(function (o) { return o.foglalhato; })) {
        ttUgrott = true; st.het = F.addDays(st.het, 7); setTtLoading(false); syncUrl(false); return renderOrak(1);
      }
      setTtLoading(false);
      body.innerHTML = renderTt(l);
      slideTt(dir);
      renderBar(); renderSteps();
    }).catch(function (e) {
      if (req !== oraReq) return;
      setTtLoading(false);
      body.innerHTML = '<div class="slots__empty"><p>' + esc(e.message) + '</p><button type="button" class="btn" id="tt-retry">Újrapróbálom</button></div>';
      $('#tt-retry').addEventListener('click', function () { renderOrak(); });
    });
  }
  function slideTt(dir) {
    if (!dir || reduce) return;
    var b = $('#tt-body'); b.classList.remove('is-slide', 'is-slide-back'); void b.offsetWidth; b.classList.add(dir > 0 ? 'is-slide' : 'is-slide-back');
  }
  function renderCardCs() {
    var o = oraIdx[st.ora], rows = [];
    if (mod && mod.cs) rows.push(['m', 'Jelenlegi óra', mod.f.ora.nev, F.datumNap(mod.f.datum) + ', ' + F.hm(F.perc(mod.f.kezd)) + '-' + F.hm(F.perc(mod.f.veg)), null, 'is-now']);
    rows = rows.concat([
      ['o', mod ? 'Új óra' : 'Óra', o ? o.ora.nev : '', o ? o.ora.perc + ' perc' : '', 'ora'],
      ['i', 'Időpont', o ? F.datumNap(o.datum) : '', o ? F.hm(F.perc(o.kezd)) + '-' + F.hm(F.perc(o.veg)) : '', 'ora'],
      ['k', 'Oktató', o ? oktatoNev(o.kollega) : '', '', null],
      ['h', 'Helyszín', o ? o.helyszin.nev : '', o ? (meta(o.helyszin.id).utca || o.helyszin.cim || '') : '', null],
      ['a', 'Díj', o && o.ora.ar != null ? F.ft(o.ora.ar).replace(/\u00a0/g, ' ') : '', o ? 'a helyszínen fizetendő' : '', null, 'rev__sum']
    ]);
    $('#bk-card-rows').innerHTML = rows.map(function (r) { return cardRow(r[0], r[1], r[2], r[3], r[4], r[5]); }).join('');
    $('#bk-card-hint').hidden = !!o;
    $('#bk-card-h').textContent = mod ? 'Áthelyezés' : 'A jelentkezésed';
  }
  function renderOsszegzesCs() {
    var o = oraIdx[st.ora], d = loadData();
    if (!o) return;
    var reggeli = F.perc(o.kezd) < (szab().reggeliKezdesElott == null ? 10 : szab().reggeliKezdesElott) * 60;
    var rows = mod && mod.cs ? [
      ['Új óra', o.ora.nev, F.datumHosszu(o.datum) + ', ' + F.hm(F.perc(o.kezd)) + '-' + F.hm(F.perc(o.veg)), 'ora', 'rev__new'],
      ['Eddig', mod.f.ora.nev, F.datumHosszu(mod.f.datum) + ', ' + F.hm(F.perc(mod.f.kezd)), null, 'rev__old'],
      ['Oktató', oktatoNev(o.kollega), ''],
      ['Helyszín', o.helyszin.nev, meta(o.helyszin.id).utca || o.helyszin.cim],
      ['Foglalás száma', mod.info.azonosito, 'marad, és a levélben lévő link is']
    ] : [
      ['Óra', o.ora.nev, o.ora.perc + ' perc', 'ora'],
      ['Időpont', F.datumHosszu(o.datum), F.hm(F.perc(o.kezd)) + '-' + F.hm(F.perc(o.veg)) + ', ' + helyTxt(o), 'ora'],
      ['Oktató', oktatoNev(o.kollega), o.kollega ? o.kollega.szerep : ''],
      ['Helyszín', o.helyszin.nev, meta(o.helyszin.id).utca || o.helyszin.cim],
      ['Adataid', d.nev, [d.email, d.telefon].join(' · ') + (d.megjegyzes ? '\n' + d.megjegyzes : ''), 'adatok'],
      ['Díj', o.ora.ar != null ? F.ft(o.ora.ar) : '', 'a helyszínen fizetendő', null, 'rev__sum']
    ];
    $('#h-osszegzes').textContent = mod ? 'Ellenőrizd az új órát' : 'Ellenőrizd a jelentkezést';
    $('#rev').innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) {
      return '<div' + (r[4] ? ' class="' + r[4] + '"' : '') + '><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]).replace(/\n/g, '<br>') + '</small>' : '') + '</dd>' +
        (r[3] ? '<dd class="rev__act"><button type="button" class="edit" data-go="' + r[3] + '" aria-label="' + esc(r[0]) + ' módosítása">Módosítás</button></dd>' : '<dd class="rev__act"></dd>') + '</div>';
    }).join('');
    $('#ossz-fine').textContent = (mod ? 'A régi helyed az áthelyezés pillanatában felszabadul. ' : 'A díjat a helyszínen fizeted. ') +
      'Lemondani vagy másik órára tenni a kezdés előtt ' + (szab().lemondasOra || 24) + ' óráig tudod online.' +
      (reggeli && !mod ? ' Ez reggeli óra: előző este ' + String(szab().reggeliHatarOra == null ? 22 : szab().reggeliHatarOra) + ':00-ig lehet rá jelentkezni.' : '');
  }
  function oraHiba(err, kuldo) {
    var kod = err.data && err.data.kod;
    if (err.status === 409 && (kod === 'betelt' || kod === 'elmarad' || kod === 'hatarido' || kod === 'mult')) {
      var o = oraIdx[st.ora], mi = o ? o.ora.nev + ', ' + F.datumNap(o.datum) + ' ' + F.hm(F.perc(o.kezd)) : 'ez az óra';
      oraCacheUrit(); st.ora = '';
      go('ora', { noAlertClear: true });
      var cim = { betelt: 'Ez az óra közben betelt', elmarad: 'Ez az óra elmarad', hatarido: 'Erre az órára már lezárult a jelentkezés', mult: 'Ez az óra már elkezdődött' }[kod];
      showAlert(cim, (kod === 'betelt' ? 'Amíg kitöltötted az adatokat, elfogyott az utolsó hely: ' + mi + '. ' : err.message + ' ') + 'Frissítettük az órarendet, válassz másikat.' + (mod ? ' A régi helyed addig megmarad.' : ' Az adataidat megjegyeztük.'));
      setTimeout(function () { $('#bk-alert-h').setAttribute('tabindex', '-1'); $('#bk-alert-h').focus(); }, reduce ? 0 : 120);
      return true;
    }
    if (err.status === 409 && kod === 'mar_jelentkezett') {
      showAlert('Erre az órára már jelentkeztél', 'Ezzel az e-mail-címmel már van helyed ezen az órán. A visszaigazoló levélben lévő linkkel tudod kezelni. Ha valaki mást jelentkeztetnél, az ő e-mail-címét add meg.');
      $('#bk-alert-h').setAttribute('tabindex', '-1'); $('#bk-alert-h').focus();
      return true;
    }
    var halozat = err.status === 0 || err.status >= 500;
    showAlert(mod ? 'Az áthelyezés nem sikerült' : 'A jelentkezés nem sikerült', err.message + (halozat && err.message.indexOf(telefon()) < 0 ? ' Telefonon is segítünk: ' + telefon() + '.' : '') + (mod ? ' A régi helyed érvényes maradt.' : ''),
      halozat ? { label: 'Újrapróbálom', fn: function () { hideAlert(); kuldo(); } } : null);
    $('#bk-alert-h').setAttribute('tabindex', '-1'); $('#bk-alert-h').focus();
    return false;
  }
  function submitCs() {
    if (busy) return;
    var d = loadData();
    var body = { ora: st.ora, nev: String(d.nev || '').trim(), email: String(d.email || '').trim(), telefon: String(d.telefon || '').trim(),
      megjegyzes: String(d.megjegyzes || '').trim(), hozzajarul: !!d.hozzajarul, web: $('#f-web').value };
    var forras = window.F360Meres && window.F360Meres.forras();
    if (forras) body.forras = forras;
    setSubmitting(true);
    $('#bk-next-t').textContent = 'Jelentkezés folyamatban';
    announce('Jelentkezés folyamatban');
    api('/ora-foglalas', { method: 'POST', json: body }).then(function (res) {
      setSubmitting(false);
      if (!res || !res.azonosito || !res.foglalas) { renderBar(); showAlert('A jelentkezés nem sikerült', 'Kérjük, töltsd újra az oldalt és próbáld újra, vagy hívj minket: ' + telefon() + '.'); return; }
      var done = { azonosito: res.azonosito, lemondasUrl: res.lemondasUrl || '', ics: res.ics || '', level: res.level || null, foglalas: res.foglalas, telefon: telefon(), forras: forras || null };
      try { sessionStorage.setItem(DONE_KEY, JSON.stringify(done)); sessionStorage.removeItem(DATA_KEY); } catch (e) { /* nincs tárhely */ }
      goThanks(done);
    }).catch(function (err) {
      setSubmitting(false); renderBar();
      if (err.status === 400 && /nev|név|mail|telefon|adatkezel/i.test(err.message)) go('adatok', { noAlertClear: true });
      oraHiba(err, submitCs);
    });
  }
  function submitCsMod() {
    if (busy) return;
    setSubmitting(true);
    $('#bk-next-t').textContent = 'Áthelyezés folyamatban';
    announce('Áthelyezés folyamatban');
    api('/modositas', { method: 'POST', json: { t: mod.tok, ora: st.ora } }).then(function (res) {
      setSubmitting(false);
      if (!res || !res.azonosito || !res.foglalas) { renderBar(); showAlert('Az áthelyezés nem sikerült', 'Kérjük, töltsd újra az oldalt és próbáld újra, vagy hívj minket: ' + telefon() + '.'); return; }
      var done = { azonosito: res.azonosito, lemondasUrl: res.lemondasUrl || '', ics: res.ics || '', level: res.level || null, foglalas: res.foglalas, telefon: telefon(), modositva: true };
      try { sessionStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch (e) { /* nincs tárhely */ }
      delete infoCache[mod.tok];
      var tok = mod.tok;
      mod = null; st.tipus = ''; STEPS = FULL_STEPS;
      goThanks(done, manageHref(tok));
    }).catch(function (err) {
      setSubmitting(false); renderBar();
      if ((err.status === 409 && err.data && err.data.telefon && !err.data.kod) || err.status === 410 || err.status === 404 || (err.status === 409 && /módosították/.test(err.message))) {
        var tok = mod.tok; delete infoCache[tok];
        history.replaceState({ f: 1 }, '', manageHref(tok));
        return showCancel(tok, { uzenet: err.message });
      }
      oraHiba(err, submitCsMod);
    });
  }
  function startCsMod(tok, u, r) {
    var f = r.foglalas, uj = !mod || mod.tok !== tok;
    mod = { tok: tok, info: r, f: f, cs: true };
    st.tipus = 'csoportos'; STEPS = CSMOD_STEPS;
    if (uj) { oraCacheUrit(); prevCard = {}; lastRenderedStep = null; }
    document.body.setAttribute('data-view', 'modositas');
    $('.bk-head').hidden = false;
    $('#bk-h1').textContent = 'Áthelyezés másik órára';
    $('#bk-lead').textContent = f.ora.nev + ', ' + F.datumNap(f.datum) + ' ' + F.hm(F.perc(f.kezd)) + '. Válassz másik órát, a foglalás száma és a levélben lévő link marad.';
    var back = $('#bk-modback'); back.hidden = false; back.href = manageHref(tok);
    $('#bk-flow-wrap').hidden = false;
    st.h = ''; st.ora = u.ora || ''; st.het = u.het || F.hetfo(f.oraAllapot === 'elmarad' || f.datum < F.most().datum ? F.most().datum : f.datum); st.step = u.step || 'ora';
    render({ focus: false });
    fetchOrak(st.het).then(function () {
      sanitize(); render({ focus: !uj }); syncUrl(false);
      if (uj) setTimeout(function () { var h = $('#bk-h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }, 60);
    }, function () { render({ focus: false }); });
  }
  function routeCs(u) {
    STEPS = CS_STEPS;
    var prevH = st.h;
    st.tipus = 'csoportos'; st.h = u.h; st.ora = u.ora; st.het = u.het || (st.het && prevH === u.h ? st.het : ''); st.step = u.step || 'ora';
    if (!st.het) st.het = F.hetfo(F.most().datum);
    var L = weekLimits(); if (st.het < L.min) st.het = L.min; if (st.het > L.max) st.het = L.max;
    var elso = lastRenderedStep === null;
    render({ focus: false });
    fetchOrak(st.het).then(function () {
      sanitize(); render({ focus: !elso }); syncUrl(false);
    }, function () { render({ focus: false }); });
  }
  // két út az első lépésben: egyéni időpont vagy csoportos óra
  function renderMode() {
    var box = $('#bk-mode');
    if (!box) return;
    var lathato = !mod && stepIndex(st.step) === 0;
    box.hidden = !lathato;
    $$('input[name="tipus"]', box).forEach(function (r) { r.checked = r.value === (cs() ? 'csoportos' : 'egyeni'); });
    if (!mod) $('#bk-lead').textContent = cs()
      ? 'Válassz órát a heti órarendből. A jelentkezés azonnal érvényes, a kezdés előtt ' + (szab().lemondasOra || 24) + ' óráig online lemondhatod vagy másik órára teheted.'
      : HEAD_LEAD;
  }
  function valtTipus(v) {
    if ((v === 'csoportos') === cs()) return;
    hideAlert();
    var h = st.h;
    if (v === 'csoportos') { history.pushState({ f: 1 }, '', newBookingHref(h === 'reitter' ? '' : h, 'csoportos')); }
    else { history.pushState({ f: 1 }, '', newBookingHref(h, '')); }
    lastRenderedStep = 'x';
    route();
    setTimeout(function () { var r = $('#bk-mode input:checked'); if (r) r.focus({ preventScroll: true }); }, 30);
  }

  /* ---------------- BEKÜLDÉS ---------------- */
  // A „Foglalás véglegesítése” gomb a válaszig tiltva (a dupla kattintás „bárki” esetén két foglalást hozhatna)
  function setSubmitting(on) {
    var nb = $('#bk-next'), bb = $('#bk-back');
    busy = on;
    nb.disabled = on; bb.disabled = on;
    nb.classList.toggle('is-busy', on);
    if (on) nb.setAttribute('aria-busy', 'true'); else nb.removeAttribute('aria-busy');
  }
  function submit() {
    if (busy) return;
    var d = loadData(), s = szolg(st.sz);
    var body = {
      helyszin: st.h, szolgaltatas: st.sz, kollega: st.k || 'barki', datum: st.d, kezd: st.t,
      nev: String(d.nev || '').trim(), email: String(d.email || '').trim(), telefon: String(d.telefon || '').trim(),
      megjegyzes: String(d.megjegyzes || '').trim(), hozzajarul: !!d.hozzajarul, web: $('#f-web').value
    };
    // honnan jött a látogató (js/meres.js, az első érkezéskor rögzítve); a riport és a mérés ebből dolgozik
    var forras = window.F360Meres && window.F360Meres.forras();
    if (forras) body.forras = forras;
    setSubmitting(true);
    $('#bk-next-t').textContent = 'Foglalás folyamatban';
    announce('Foglalás folyamatban');
    api('/foglalas', { method: 'POST', json: body }).then(function (res) {
      setSubmitting(false);
      if (!res || !res.azonosito || !res.foglalas) {
        // honeypot-válasz ({ok:true}) vagy hiányos válasz: nem mutatunk hamis sikert
        renderBar();
        showAlert('A foglalás nem sikerült', 'Kérjük, töltsd újra az oldalt és próbáld újra, vagy hívj minket: ' + telefon() + '.');
        return;
      }
      var done = { azonosito: res.azonosito, lemondasUrl: res.lemondasUrl || '', ics: res.ics || '', level: res.level || null, foglalas: res.foglalas, telefon: telefon(), forras: forras || null };
      if (done.foglalas.szolgaltatas.ar == null && s) done.foglalas.szolgaltatas.ar = s.ar;
      if (s && s.elokeszites && s.elokeszites.length) done.elokeszites = s.elokeszites;
      try { sessionStorage.setItem(DONE_KEY, JSON.stringify(done)); sessionStorage.removeItem(DATA_KEY); } catch (e) { /* nincs tárhely */ }
      // a köszönő oldal a konverziós pont (ott fut a mérés, egyszer)
      goThanks(done);
    }).catch(function (err) {
      setSubmitting(false);
      renderBar();
      if (err.status === 409) {
        var ido = F.datumNap(st.d) + ', ' + F.hm(F.perc(st.t));
        Object.keys(cache).forEach(function (k) { delete cache[k]; });
        st.t = '';
        st.het = F.hetfo(st.d);
        go('idopont', { noAlertClear: true });
        showAlert('Ezt az időpontot közben lefoglalták',
          'Amíg kitöltötted az adatokat, valaki más lefoglalta ezt az időpontot: ' + ido + '. Frissítettük a listát, válassz egy másikat. Az adataidat megjegyeztük.');
        setTimeout(function () { $('#bk-alert-h').setAttribute('tabindex', '-1'); $('#bk-alert-h').focus(); }, reduce ? 0 : 120);
        return;
      }
      if (err.status === 400 && /nev|név|mail|telefon|adatkezel/i.test(err.message)) go('adatok', { noAlertClear: true });
      var halozat = err.status === 0 || err.status >= 500;
      showAlert('A foglalás nem sikerült', err.message + (halozat && err.message.indexOf(telefon()) < 0 ? ' Telefonon is foglalhatsz: ' + telefon() + '.' : ''),
        halozat ? { label: 'Újrapróbálom', fn: function () { hideAlert(); submit(); } } : null);
      $('#bk-alert-h').setAttribute('tabindex', '-1'); $('#bk-alert-h').focus();
    });
  }

  /* ---------------- ÁTHELYEZÉS BEKÜLDÉSE ---------------- */
  function submitMod() {
    if (busy) return;
    var body = { t: mod.tok, datum: st.d, kezd: st.t, kollega: st.k || 'barki' };
    setSubmitting(true);
    $('#bk-next-t').textContent = 'Áthelyezés folyamatban';
    announce('Áthelyezés folyamatban');
    api('/modositas', { method: 'POST', json: body }).then(function (res) {
      setSubmitting(false);
      if (!res || !res.azonosito || !res.foglalas) {
        renderBar();
        showAlert('Az áthelyezés nem sikerült', 'Kérjük, töltsd újra az oldalt és próbáld újra, vagy hívj minket: ' + telefon() + '.');
        return;
      }
      var done = { azonosito: res.azonosito, lemondasUrl: res.lemondasUrl || '', ics: res.ics || '', level: res.level || null, foglalas: res.foglalas, telefon: telefon(), modositva: true };
      if (done.foglalas.szolgaltatas.ar == null) done.foglalas.szolgaltatas.ar = mod.f.szolgaltatas.ar;
      try { sessionStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch (e) { /* nincs tárhely */ }
      delete infoCache[mod.tok];
      var tok = mod.tok;
      mod = null; STEPS = FULL_STEPS;
      goThanks(done, manageHref(tok));
    }).catch(function (err) {
      setSubmitting(false);
      renderBar();
      var tel = (err.data && err.data.telefon) || telefon();
      // a határidőn belül (409 + telefon) vagy közben lemondták/elmúlt (410): vissza a kezelő nézetre, ott a pontos állapot
      if ((err.status === 409 && ((err.data && err.data.telefon) || /módosították/.test(err.message))) || err.status === 410 || err.status === 404) {
        var tok = mod.tok;
        delete infoCache[tok];
        history.replaceState({ f: 1 }, '', manageHref(tok));
        return showCancel(tok, { uzenet: err.message });
      }
      if (err.status === 409) {
        // közben elvitték (vagy közben módosították): friss lista, vissza az időpont-választóra
        var ido = F.datumNap(st.d) + ', ' + F.hm(F.perc(st.t));
        Object.keys(cache).forEach(function (k) { delete cache[k]; });
        st.t = '';
        st.het = F.hetfo(st.d);
        go('idopont', { noAlertClear: true });
        showAlert(/lefoglalták/.test(err.message) ? 'Ezt az időpontot közben lefoglalták' : 'Ez az időpont már nem választható',
          (/lefoglalták/.test(err.message) ? 'Amíg választottál, valaki más lefoglalta ezt az időpontot: ' + ido + '.' : err.message) + ' Frissítettük a listát, válassz egy másikat. A régi időpontod addig megmarad.');
        setTimeout(function () { $('#bk-alert-h').setAttribute('tabindex', '-1'); $('#bk-alert-h').focus(); }, reduce ? 0 : 120);
        return;
      }
      var halozat = err.status === 0 || err.status >= 500;
      showAlert('Az áthelyezés nem sikerült', err.message + (halozat && err.message.indexOf(tel) < 0 ? ' Telefonon is segítünk: ' + tel + '.' : '') + ' A régi időpontod érvényes maradt.',
        halozat ? { label: 'Újrapróbálom', fn: function () { hideAlert(); submitMod(); } } : null);
      $('#bk-alert-h').setAttribute('tabindex', '-1'); $('#bk-alert-h').focus();
    });
  }

  /* ---------------- KÖSZÖNŐ OLDAL ---------------- */
  // /foglalas/koszonjuk?id=<azonosító>. Élesben a tiszta (.html nélküli) cím, helyben (file://, ?mock=1) a fájl.
  function thanksHref(azonosito) {
    var tiszta = location.protocol !== 'file:' && !MOCK;
    var q = (MOCK && location.protocol !== 'file:' ? 'mock=1&' : '') + 'id=' + encodeURIComponent(azonosito);
    return 'foglalas/koszonjuk' + (tiszta ? '' : '.html') + '?' + q;
  }
  // a vissza gomb ne a véglegesítő lépésre vigyen (onnan újra be lehetne küldeni): az előzmény helyére
  // a foglaló eleje (vagy módosításnál a „Foglalásod kezelése”) kerül, utána jön a köszönő oldal
  function goThanks(done, visszaHref) {
    history.replaceState({ f: 1 }, '', visszaHref || newBookingHref(''));
    location.assign(thanksHref(done.azonosito));
  }

  /* ---------------- KÉSZ ---------------- */
  function revHtml(rows) {
    return rows.filter(function (r) { return r[1]; }).map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</dd><dd class="rev__act"></dd></div>';
    }).join('');
  }
  function foglalasSorok(f, extra) {
    return [
      ['Időpont', F.datumHosszu(f.datum), F.hm(F.perc(f.kezd)) + '-' + F.hm(F.perc(f.veg))],
      ['Kezelés', f.szolgaltatas.nev, f.szolgaltatas.perc + ' perc'],
      ['Szakember', f.kollega.nev, ''],
      ['Helyszín', f.helyszin.nev, f.helyszin.cim]
    ].concat(extra || []);
  }
  function manageHref(tok, extra) {
    var h = newBookingHref('');
    return h + (h.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(tok) + (extra || '');
  }
  function loadInfo(tok, fresh) {
    if (fresh || !infoCache[tok]) {
      infoCache[tok] = api('/lemondas?t=' + encodeURIComponent(tok)).catch(function (e) { delete infoCache[tok]; throw e; });
    }
    return infoCache[tok];
  }

  /* ---------------- MÓDOSÍTÁS (?t=TOKEN&modositas=1) ---------------- */
  // a foglaló lépései a meglévő komponensekkel; a helyszín és a kezelés a foglalásból jön és nem változik
  function startMod(tok, u) {
    $('#bk-cancel').hidden = true;
    loadInfo(tok).then(function (r) {
      if (r.tipus === 'csoportos') {
        if (r.allapot !== 'megerositett' || !r.modosithato) { history.replaceState({ f: 1 }, '', manageHref(tok)); return showCancel(tok); }
        return startCsMod(tok, u, r);
      }
      if (r.allapot !== 'megerositett' || !r.modosithato) {
        // lemondott vagy határidőn belüli: a kezelő nézet mondja meg, mi a teendő
        history.replaceState({ f: 1 }, '', manageHref(tok));
        return showCancel(tok);
      }
      var f = r.foglalas;
      var szIsmert = !!szolg(f.szolgaltatas.id), hIsmert = !!hely(f.helyszin.id);
      if (!szIsmert || !hIsmert) {
        history.replaceState({ f: 1 }, '', manageHref(tok));
        return showCancel(tok, { uzenet: 'Ez a kezelés most nem foglalható online, ezért az időpontot sem lehet itt áthelyezni. Hívj minket, és segítünk.' });
      }
      var uj = !mod || mod.tok !== tok;
      mod = { tok: tok, info: r, f: f };
      STEPS = MOD_STEPS; st.tipus = '';
      if (uj) { Object.keys(cache).forEach(function (k) { delete cache[k]; }); prevCard = {}; lastRenderedStep = null; }
      document.body.setAttribute('data-view', 'modositas');
      $('.bk-head').hidden = false;
      $('#bk-h1').textContent = 'Időpont módosítása';
      $('#bk-lead').textContent = f.szolgaltatas.nev + ', ' + f.helyszin.nev + '. Válassz új napot és időpontot, a kezelés és a helyszín marad.';
      var back = $('#bk-modback'); back.hidden = false; back.href = manageHref(tok);
      $('#ossz-fine').textContent = 'A régi időpont az áthelyezés pillanatában felszabadul. Az új időpontról e-mailt küldünk, a foglalás száma és a levélben lévő link marad.';
      $('#bk-flow-wrap').hidden = false;
      var prevWeekKey = [st.k].join('|');
      st.h = f.helyszin.id; st.sz = f.szolgaltatas.id;
      st.k = u.k || ''; st.d = u.d; st.t = u.t; st.step = u.step;
      if (st.k && st.k !== 'barki' && kollegakRa(st.h, st.sz).map(function (x) { return x.id; }).indexOf(st.k) < 0) st.k = '';
      if (uj || st.k !== prevWeekKey) st.het = '';
      if (!st.d && st.k) { st.het = ''; }
      sanitize();
      render({ focus: !uj });
      syncUrl(false);
      if (uj) setTimeout(function () { var h = $('#bk-h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }, 60);
    }).catch(function (e) {
      history.replaceState({ f: 1 }, '', manageHref(tok));
      showCancel(tok);
    });
  }

  /* ---------------- FOGLALÁSOD KEZELÉSE (?t=TOKEN): módosítás vagy lemondás ---------------- */
  function showCancel(tok, opts) {
    opts = opts || {};
    mod = null; STEPS = FULL_STEPS; st.tipus = '';
    document.body.setAttribute('data-view', 'lemondas');
    $('#bk-flow-wrap').hidden = true;
    $('.bk-head').hidden = true;
    $('#bk-cancel').hidden = false;
    $('#cx-rev').hidden = false;
    document.title = 'Foglalásod kezelése · Studio F360';
    $('#h-cancel').textContent = 'Foglalásod kezelése';
    $('#cx-lead').textContent = 'Betöltjük a foglalásod adatait.';
    $('#cx-act').innerHTML = '';
    loadInfo(tok, true).then(function (r) {
      var f = r.foglalas, tel = r.telefon || telefon(), th = 'tel:' + String(tel).replace(/[^\d+]/g, ''), csop = r.tipus === 'csoportos' || f.tipus === 'csoportos';
      var elmarad = csop && f.oraAllapot === 'elmarad';
      document.body.classList.toggle('theme-rehab', f.helyszin.id === 'reitter');
      $('#cx-rev').innerHTML = revHtml(csop ? [
        ['Óra', f.ora.nev, f.ora.perc + ' perc' + (elmarad ? ', ELMARAD' : '')],
        ['Időpont', F.datumHosszu(f.datum), F.hm(F.perc(f.kezd)) + '-' + F.hm(F.perc(f.veg))],
        ['Oktató', oktatoNev(f.kollega), ''],
        ['Helyszín', f.helyszin.nev, f.helyszin.cim],
        ['Díj', f.ora.ar != null ? F.ft(f.ora.ar) : '', 'a helyszínen fizetendő'],
        ['Foglalás száma', r.azonosito, '']
      ] : foglalasSorok(f, [
        ['Díj', f.szolgaltatas.ar != null ? F.ft(f.szolgaltatas.ar) : '', 'a helyszínen fizetendő'],
        ['Foglalás száma', r.azonosito, '']
      ]));
      $('#cx-tel').textContent = tel; $('#cx-tel').href = th;
      var act = $('#cx-act');
      var elo = opts.uzenet ? '<p class="cx__note" role="alert">' + esc(opts.uzenet) + '</p>' : '';
      if (r.allapot === 'lemondva') {
        $('#h-cancel').textContent = csop ? 'Ezt a jelentkezést már lemondtad' : 'Ezt a foglalást már lemondtad';
        $('#cx-lead').textContent = csop ? 'A helyed felszabadult, ezért áthelyezni sem lehet. Ha mégis jönnél, jelentkezz újra.' : 'Az időpont felszabadult, ezért módosítani sem lehet. Ha mégis jönnél, foglalj újat.';
        act.innerHTML = elo + '<a class="btn bk-next" href="' + newBookingHref(f.helyszin.id, csop ? 'csoportos' : '') + '">' + (csop ? 'Órarend megnyitása' : 'Új időpontot foglalok') + '</a>';
      } else if (!r.lemondhato && !(elmarad && r.modosithato)) {
        $('#h-cancel').textContent = 'Online már nem módosítható';
        $('#cx-lead').textContent = 'A kezdésig kevesebb mint ' + (szab().lemondasOra || 24) + ' óra van, ezért online már nem tudod áthelyezni vagy lemondani. Hívj minket, és megbeszéljük.';
        act.innerHTML = elo + '<a class="cx__phone lnk" href="' + esc(th) + '">' + esc(tel) + '</a>' +
          '<a class="btn btn--dark" href="' + esc(th) + '">Felhívom a stúdiót</a>';
      } else {
        var hat = r.hatarido ? new Date(r.hatarido) : null;
        var hatSz = hat ? hat.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '-ig' : '';
        if (elmarad) {
          $('#h-cancel').textContent = 'Ez az óra elmarad';
          $('#cx-lead').textContent = 'Kedves ' + keresztnev(f.nev) + ', sajnos ez az óra elmarad. Tegyük át a helyed egy másik órára, vagy mondd le, és nem számolunk vele.';
        } else $('#cx-lead').textContent = 'Kedves ' + keresztnev(f.nev) + ', ' + (csop ? 'ha másik órára mennél, itt áthelyezheted a helyed, ha nem tudsz jönni, lemondhatod' : 'ha másik időpont kellene, itt áthelyezheted, ha nem tudsz jönni, lemondhatod') + (hatSz ? ' ' + hatSz : '') + '.';
        act.innerHTML = elo + (r.modosithato !== false ? '<a class="btn bk-next" id="cx-mod" href="' + esc(manageHref(tok, '&modositas=1')) + '">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17M8 3v4M16 3v4M9 15h6m-2.5-2.5L15 15l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '<span>' + (csop ? 'Áthelyezés másik órára' : 'Időpont módosítása') + '</span></a>' : '') +
          '<button type="button" class="btn" id="cx-go">Lemondás</button>';
        var mb = $('#cx-mod');
        if (mb) mb.addEventListener('click', function (e) {
          e.preventDefault();
          history.pushState({ f: 1 }, '', manageHref(tok, '&modositas=1'));
          startMod(tok, readUrl());
        });
        $('#cx-go').addEventListener('click', function () { confirmCancel(tok, r); });
      }
      $('#h-cancel').focus({ preventScroll: true });
    }).catch(function (e) {
      var tel = telefon(), th = telHref();
      $('#h-cancel').textContent = e.status === 404 ? 'Ez a link nem érvényes' : e.status === 410 ? 'Ez a link lejárt' : 'A foglalás most nem tölthető be';
      $('#cx-lead').textContent = (e.status === 404 ? 'Lehet, hogy hiányosan másoltad ki a levélből. ' : e.message + ' ') + 'Ha segítség kell, hívj minket: ' + tel + '.';
      $('#cx-rev').innerHTML = '';
      $('#cx-rev').hidden = true;
      $('#cx-act').innerHTML = '<a class="btn btn--dark" href="' + esc(th) + '">Felhívom a stúdiót</a><a class="btn" href="' + newBookingHref('') + '">Új időpontot foglalok</a>';
      $('#h-cancel').focus({ preventScroll: true });
    });
  }
  function newBookingHref(h, tipus) {
    var q = [];
    if (MOCK && location.protocol !== 'file:') q.push('mock=1');
    if (tipus === 'csoportos') q.push('tipus=csoportos');
    if (h) q.push('helyszin=' + encodeURIComponent(h));
    return 'foglalas.html' + (q.length ? '?' + q.join('&') : '');
  }
  function confirmCancel(tok, r) {
    var act = $('#cx-act'), f = r.foglalas;
    var csop = r.tipus === 'csoportos';
    act.innerHTML = '<div class="cx__confirm" role="group" aria-labelledby="cx-q"><p id="cx-q" tabindex="-1">' + (csop ? 'Biztosan lemondod? A helyed felszabadul, és más jelentkezhet az órára.' : 'Biztosan lemondod? Az időpont felszabadul, és más is lefoglalhatja.') + '</p>' +
      '<div><button type="button" class="btn btn--dark" id="cx-yes">Igen, lemondom</button><button type="button" class="btn" id="cx-no">Mégsem</button></div></div>';
    $('#cx-q').focus();
    $('#cx-no').addEventListener('click', function () { showCancel(tok); });
    $('#cx-yes').addEventListener('click', function () {
      var y = $('#cx-yes'); y.disabled = true; $('#cx-no').disabled = true; y.textContent = 'Lemondás folyamatban';
      api('/lemondas', { method: 'POST', json: { t: tok } }).then(function () {
        $('#h-cancel').textContent = csop ? 'A jelentkezést lemondtuk' : 'A foglalást lemondtuk';
        $('#cx-lead').textContent = 'Köszönjük, hogy időben szóltál, így más is jöhet a helyedre. A lemondásról e-mailt is küldünk.';
        act.innerHTML = '<a class="btn bk-next" href="' + newBookingHref(f.helyszin.id, csop ? 'csoportos' : '') + '">' + (csop ? 'Órarend megnyitása' : 'Új időpontot foglalok') + '</a>';
        $('#cx-live').textContent = csop ? 'A jelentkezést lemondtuk.' : 'A foglalást lemondtuk.';
        $('#h-cancel').focus();
      }).catch(function (e) {
        var tel = (e.data && e.data.telefon) || r.telefon || telefon();
        act.innerHTML = '<div class="cx__confirm"><p>' + esc(e.message) + '</p><div><a class="btn btn--dark" href="tel:' + esc(String(tel).replace(/[^\d+]/g, '')) + '">Felhívom a stúdiót</a></div></div>';
        $('#cx-live').textContent = e.message;
      });
    });
  }

  /* ---------------- ESEMÉNYEK ---------------- */
  var pointerPick = false;
  document.addEventListener('pointerdown', function (e) { pointerPick = !!e.target.closest('.loc,.opt,.slot,.tt-c'); }, true);
  document.addEventListener('keydown', function () { pointerPick = false; }, true);

  function autoAdvance() {
    // egérrel/ujjal választva magától lép tovább; billentyűzettel a nyilak csak választanak, Enter visz tovább
    if (!pointerPick) return;
    pointerPick = false;
    setTimeout(function () { if (stepDone(st.step)) next(); }, reduce ? 60 : 280);
  }
  $('#bk-flow-wrap').addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'helyszin') {
      if (st.h !== t.value) { st.h = t.value; st.sz = st.k = st.d = st.t = ''; st.het = ''; }
      renderCard(); renderSteps(); renderBar(); syncUrl(false);
      document.body.classList.toggle('theme-rehab', st.h === 'reitter');
      autoAdvance();
    } else if (t.name === 'szolgaltatas') {
      if (st.sz !== t.value) {
        st.sz = t.value;
        if (st.k && st.k !== 'barki' && kollegakRa(st.h, st.sz).map(function (x) { return x.id; }).indexOf(st.k) < 0) st.k = '';
        st.t = '';
      }
      renderCard(); renderSteps(); renderBar(); syncUrl(false); autoAdvance();
    } else if (t.name === 'kollega') {
      if (st.k !== t.value) { st.k = t.value; st.t = ''; }
      renderCard(); renderSteps(); renderBar(); syncUrl(false); autoAdvance();
    } else if (t.name === 'nap') {
      st.d = t.value; st.t = '';
      fetchWeek(st.het).then(function (napok) { renderSlots(napok[st.d] || [], napok); });
      renderCard(); renderSteps(); renderBar(); syncUrl(false);
    } else if (t.name === 'ora') {
      st.ora = t.value;
      hideAlert();
      renderCard(); renderSteps(); renderBar(); syncUrl(false); autoAdvance();
    } else if (t.name === 'tipus') {
      valtTipus(t.value);
    } else if (t.name === 'ido') {
      st.t = t.value;
      hideAlert();
      renderCard(); renderSteps(); renderBar(); syncUrl(false); autoAdvance();
    }
  });
  // Enter egy választón = Tovább
  $('#bk-flow-wrap').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches('input[type="radio"]')) { e.preventDefault(); next(); }
  });
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.getAttribute('data-go')); return; }
    if (e.target.closest('[data-ttweek]')) { st.het = F.addDays(st.het, 7); renderOrak(1); syncUrl(false); return; }
    if (e.target.closest('[data-week]')) { st.het = F.addDays(st.het, 7); st.d = ''; st.t = ''; renderIdopont(1); return; }
    if (e.target.closest('[data-anyone]')) { st.k = 'barki'; st.d = ''; st.t = ''; syncUrl(false); render(); return; }
  });
  $('#wk-prev').addEventListener('click', function () { st.het = F.addDays(st.het, -7); st.d = ''; st.t = ''; autoJumped = true; renderIdopont(-1); syncUrl(false); });
  $('#wk-next').addEventListener('click', function () { st.het = F.addDays(st.het, 7); st.d = ''; st.t = ''; autoJumped = true; renderIdopont(1); syncUrl(false); });
  $('#tt-prev').addEventListener('click', function () { st.het = F.addDays(st.het, -7); renderOrak(-1); syncUrl(false); });
  $('#tt-next').addEventListener('click', function () { st.het = F.addDays(st.het, 7); renderOrak(1); syncUrl(false); });
  ttNarrow.addEventListener('change', function () { if (cs() && st.step === 'ora' && oraKesz[oraKey(st.het)]) $('#tt-body').innerHTML = renderTt(oraKesz[oraKey(st.het)]); });
  $('#bk-next').addEventListener('click', next);
  $('#bk-back').addEventListener('click', back);
  $('#bk-form').addEventListener('submit', function (e) { e.preventDefault(); next(); });
  $('#bk-form').addEventListener('input', function (e) {
    saveData();
    if (e.target.getAttribute('aria-invalid') === 'true') {
      var errs = dataErrors(loadData()), key = e.target.name;
      if (!errs[key]) setFieldError(key, '');
    }
    renderCard();
  });
  $('#bk-form').addEventListener('focusout', function (e) {
    var key = e.target.name; if (!key || key === 'megjegyzes' || key === 'web' || key === 'hozzajarul') return;
    if (!e.target.value) return;
    var errs = dataErrors(saveData());
    setFieldError(key, errs[key] || '');
  });
  function setFieldError(key, msg) {
    var inp = $('#f-' + key), err = $('#e-' + key);
    if (!inp || !err) return;
    if (msg) { inp.setAttribute('aria-invalid', 'true'); err.textContent = msg; err.hidden = false; }
    else { inp.removeAttribute('aria-invalid'); err.textContent = ''; err.hidden = true; }
  }
  function showFieldErrors(errs) { ['nev', 'email', 'telefon', 'hozzajarul'].forEach(function (k) { setFieldError(k, errs[k] || ''); }); }

  window.addEventListener('popstate', function () { route(); });

  /* ---------------- INDULÁS ---------------- */
  var HEAD_H1 = $('#bk-h1').textContent, HEAD_LEAD = $('#bk-lead').textContent, OSSZ_FINE = $('#ossz-fine').textContent;
  function route() {
    var u = readUrl();
    if (u.tok && u.mod) { $('#bk-flow-wrap').hidden = true; return startMod(u.tok, u); }
    if (u.tok) { $('#bk-flow-wrap').hidden = true; return showCancel(u.tok); }
    // kilépés a módosításból (vissza gomb): a foglaló eredeti fejléce és lépései
    if (mod) { mod = null; Object.keys(cache).forEach(function (k) { delete cache[k]; }); oraCacheUrit(); prevCard = {}; }
    $('#bk-h1').textContent = HEAD_H1; $('#bk-lead').textContent = HEAD_LEAD; $('#ossz-fine').textContent = OSSZ_FINE; $('#bk-modback').hidden = true;
    // a régi ?kesz=<azonosító> link: átirányít a köszönő oldalra (mérés nélkül, ha ott már lefutott)
    if (u.kesz) { location.replace(thanksHref(u.kesz)); return; }
    document.body.removeAttribute('data-view');
    $('#bk-cancel').hidden = true; $('.bk-head').hidden = false;
    $('#bk-flow-wrap').hidden = false;
    if (u.tipus === 'csoportos') { if (!cs()) prevCard = {}; return routeCs(u); }
    if (cs() || STEPS !== FULL_STEPS) { st.tipus = ''; STEPS = FULL_STEPS; prevCard = {}; st.het = ''; }
    var prevWeekKey = [st.h, st.sz, st.k].join('|');
    st.h = u.h; st.sz = u.sz; st.k = u.k; st.d = u.d; st.t = u.t; st.step = u.step;
    if ([st.h, st.sz, st.k].join('|') !== prevWeekKey || (st.d && (st.d < st.het || st.d > F.addDays(st.het || st.d, 6)))) st.het = '';
    sanitize();
    render({ focus: lastRenderedStep !== null });
    syncUrl(false);
  }
  function boot() {
    api('/katalogus').then(function (k) {
      kat = k || { helyszinek: [], szolgaltatasok: [], kollegak: [] };
      $('#bk-minta').hidden = kat.minta !== true;
      $('#fo').setAttribute('data-state', 'kesz');
      route();
    }).catch(function (e) {
      $('#fo').setAttribute('data-state', 'hiba');
      var wrap = $('#bk-flow-wrap');
      wrap.innerHTML = '<div class="bk-loadfail"><p>' + esc(e.message) + '</p><p>Telefonon is foglalhatsz: <a class="lnk" href="tel:+36305030578">+36 30 503 0578</a></p><button type="button" class="btn" id="bk-reload">Újratöltöm</button></div>';
      $('#bk-reload').addEventListener('click', function () { location.reload(); });
    });
  }

  if (MOCK) {
    var sc = document.createElement('script');
    sc.src = 'js/foglalo-mock.js';
    sc.onload = boot;
    sc.onerror = function () { console.error('A teszt-API (js/foglalo-mock.js) nem töltődött be.'); boot(); };
    document.head.appendChild(sc);
  } else {
    boot();
  }
})();
