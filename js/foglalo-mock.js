/* =====================================================================
   STUDIO F360 · IDŐPONTFOGLALÓ · foglalo-mock.js
   CSAK HELYI TESZTHEZ ÉS BEMUTATÓHOZ. A foglalas.js és az admin.js csak
   ?mock=1 mellett vagy file://-ról tölti be, élesben nem töltődik le.
   A backend (ág foglalo, d0f50c1) PONTOS másolata böngészőben:
     functions/_lib/booking/{foglalas,admin,szabad,levelek,levelek-kollega,emlekezteto,forras,torzs-alap,ics,seed}.js
     nyilvános: /foglalas-api/katalogus | szabad | foglalas (GET ?t= is) | lemondas | modositas | foglalas.ics
     admin:     /api/foglalo/beallitasok | kollegak (POST, PATCH /:id, POST /:id/archivalas) | beosztas
                | kivetelek | foglalasok | szabad | outbox | emlekezteto/futtat | riport/forrasok
                | sorozatok (állandó időpont: elonezet, létrehozás, lista, részletek, leallitas)
   Ha a backend változik, ezt a fájlt is hozzá kell igazítani.
   Az adat a localStorage-ban él (a foglaló és az admin ugyanazt látja).
   Alaphelyzet: F360FoglaloMock.reset(). Ütközés-próba: ?utkozes=1 (a következő
   foglalás időpontját „közben” elviszi valaki, a válasz 409).
   Előfeltétel: js/foglalo-kozos.js (window.F360Foglalo).
   ===================================================================== */
(function () {
  'use strict';

  var F = window.F360Foglalo;
  var KEY = 'f360-foglalo-mock-v3';
  var FLAG = 'f360-foglalo-mock-utkozes';
  var script = document.currentScript;
  var ROOT = new URL('../', script ? script.src : location.href).href; // a webhely gyökere (js/ fölött)
  var ORIGIN = ROOT.replace(/\/$/, '');
  var realFetch = window.fetch.bind(window);
  var RACS = 15;

  if (/[?&]utkozes=1(&|$)/.test(location.search)) { try { sessionStorage.setItem(FLAG, '1'); } catch (e) { /* nincs */ } }

  /* ---------------- MINTA törzsadat = a backend seed.js-e ---------------- */
  // a taplalkozas.html „Mérés előtt” listája (seed.js MERES_ELOTT)
  var MERES_ELOTT = ['a mérés előtt 2 órával már ne étkezz', 'csak tiszta víz vagy ízesítetlen tea', 'előtte pár órával ne végezz megerőltető edzést',
    'fém ékszereket vedd le', 'a mérés fehérneműben történik'];
  function seedTorzs() {
    return {
      minta: true,
      helyszinek: [
        { id: 'mexikoi', nev: 'Mexikói út', cim: 'Mexikói út 32/b, XIV. kerület', nyit: '07:00', zar: '21:00' },
        { id: 'reitter', nev: 'Reitter Ferenc utca', cim: 'Reitter Ferenc utca 48., XIII. kerület', nyit: '08:00', zar: '20:00' }
      ],
      szolgaltatasok: [
        { id: 'gyogytorna', nev: 'Gyógytorna', perc: 50, ar: 14500, puffer: 10, helyszinek: ['mexikoi'] },
        { id: 'gyogymasszazs-50', nev: 'Gyógymasszázs', perc: 50, ar: 13500, puffer: 10, helyszinek: ['mexikoi'] },
        { id: 'gyogymasszazs-90', nev: 'Gyógymasszázs', perc: 90, ar: 19000, puffer: 10, helyszinek: ['mexikoi'] },
        { id: 'relaxalo-masszazs', nev: 'Relaxáló masszázs', perc: 50, ar: 13500, puffer: 10, helyszinek: ['mexikoi'] },
        { id: 'nyirokmasszazs-teljes', nev: 'Nyirokmasszázs, teljes test', perc: 90, ar: 23000, puffer: 10, helyszinek: ['mexikoi'] },
        { id: 'kismama-masszazs', nev: 'Kismama masszázs', perc: 50, ar: 12000, puffer: 10, helyszinek: ['mexikoi'] },
        { id: 'sportrehab-felmeres', nev: 'Sportrehabilitációs állapotfelmérés', perc: 50, ar: 20000, puffer: 10, helyszinek: ['reitter'] },
        { id: 'sportrehab-gyogytorna', nev: 'Sportrehabilitáció, gyógytorna', perc: 50, ar: 16000, puffer: 10, helyszinek: ['reitter'] },
        { id: 'sportmasszazs', nev: 'Sportmasszázs, regeneráció', perc: 50, ar: 15000, puffer: 10, helyszinek: ['reitter'] },
        { id: 'kinvent-pro', nev: 'Kinvent PRO', perc: 60, ar: 20000, puffer: 10, helyszinek: ['reitter'] },
        { id: 'gepi-nyirokmasszazs', nev: 'Gépi nyirokmasszázs, nyirokcsizma', perc: 45, ar: 10000, puffer: 10, helyszinek: ['reitter'] },
        // táplálkozás (Kovács Anna, Mexikói út), a backend seed.js-e szerint; az időtartam Lillától megerősítendő
        { id: 'taplalkozas-alapcsomag', nev: 'Táplálkozási alapcsomag (felmérés + InBody + 3 konzultáció)', perc: 60, ar: 60000, puffer: 10, helyszinek: ['mexikoi'],
          leiras: 'Az alapcsomag további 3 konzultációját az első alkalmon egyeztetjük.', elokeszites: MERES_ELOTT.slice(), idotartam_megerositendo: true },
        { id: 'taplalkozas-kiegeszito', nev: 'Kiegészítő tanácsadás', perc: 45, ar: 10000, puffer: 10, helyszinek: ['mexikoi'], idotartam_megerositendo: true },
        { id: 'inbody-770', nev: 'InBody 770 testösszetétel-elemzés, önálló', perc: 20, ar: 10000, puffer: 10, helyszinek: ['mexikoi'], elokeszites: MERES_ELOTT.slice(), idotartam_megerositendo: true }
      ],
      kollegak: [
        { id: 'kodacsine-labancz-agnes', szin: '#4f6d8a', nev: 'Kodácsiné Labancz Ágnes', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'], foto: '/media/brand/csapat/kodacsine-labancz-agnes.jpg' },
        { id: 'vas-luca', szin: '#a0553c', nev: 'Vas Luca', szerep: 'gyógytornász, perinatális tréner, SEAS terapeuta', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna', 'kismama-masszazs'], foto: '/media/brand/csapat/vas-luca.jpg' },
        { id: 'szegedi-botond', szin: '#5b7d55', nev: 'Szegedi Botond', szerep: 'gyógymasszőr, nyirokmasszőr (Mexikói út), sportmasszőr (Reitter)', helyszinek: ['mexikoi', 'reitter'],
          szolgaltatasok: ['gyogymasszazs-50', 'gyogymasszazs-90', 'relaxalo-masszazs', 'nyirokmasszazs-teljes', 'kismama-masszazs', 'sportmasszazs', 'gepi-nyirokmasszazs'], foto: '/media/brand/csapat/szegedi-botond.jpg' },
        { id: 'adorjani-anna', szin: '#7d5a8e', nev: 'Adorjáni Anna', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna'], foto: '/media/brand/csapat/adorjani-anna.jpg' },
        { id: 'kovacs-sebestyen', szin: '#8c6b2a', nev: 'Kovács Sebestyén', szerep: 'gyógytornász, sportrehabilitáció', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna', 'kinvent-pro', 'gepi-nyirokmasszazs'] },
        { id: 'osvath-bence', szin: '#2f6e6e', nev: 'Osváth Bence', szerep: 'személyi edző, erőnléti edző', helyszinek: ['reitter'], szolgaltatasok: ['kinvent-pro'], foto: '/media/brand/csapat/osvath-bence.jpg' },
        // a jógaoktatók csoportos órát tartanak (egyéni szolgáltatásuk nincs); Kovács Annának nincs kitalált beosztása
        { id: 'barkoczy-barbara', szin: '#94485e', nev: 'Barkóczy Barbara', szerep: 'jógaoktató, aerial jóga, aerial trapéz', helyszinek: ['mexikoi'], szolgaltatasok: [], foto: '/media/brand/csapat/barkoczy-barbara.jpg' },
        { id: 'aczel-gabriella', szin: '#5a5f30', nev: 'Aczél Gabriella', szerep: 'jógaoktató, gerincjóga, Yin jóga', helyszinek: ['mexikoi'], szolgaltatasok: [], foto: '/media/brand/csapat/aczel-gabriella.jpg' },
        { id: 'kovacs-anna', szin: '#3b4580', nev: 'Kovács Anna', szerep: 'táplálkozási tanácsadó, InBody, alapító', helyszinek: ['mexikoi'],
          szolgaltatasok: ['taplalkozas-alapcsomag', 'taplalkozas-kiegeszito', 'inbody-770'], foto: '/media/brand/csapat/kovacs-anna.jpg' }
      ],
      szabalyok: { minEloreOra: 2, maxEloreNap: 60, lemondasOra: 24, telefon: '+36 30 503 0578', studioEmail: 'info@f360.hu', reggeliHatarOra: 22, reggeliKezdesElott: 10 }
    };
  }
  function seedBeosztas() {
    var out = [], HP = [1, 2, 3, 4, 5];
    function add(k, napok, h, a, b) { napok.forEach(function (n) { out.push({ kollega: k, nap: n, helyszin: h, kezd: F.perc(a), veg: F.perc(b) }); }); }
    add('kodacsine-labancz-agnes', [1, 2, 3, 4], 'mexikoi', '08:00', '16:00');
    add('vas-luca', [1, 3, 5], 'mexikoi', '10:00', '18:00');
    add('vas-luca', [2, 4], 'mexikoi', '12:00', '20:00');
    add('szegedi-botond', [1, 3, 5], 'mexikoi', '09:00', '17:00');
    add('szegedi-botond', [2, 4], 'reitter', '10:00', '18:00');
    add('adorjani-anna', HP, 'reitter', '08:00', '14:00');
    add('kovacs-sebestyen', HP, 'reitter', '12:00', '20:00');
    add('osvath-bence', [1, 3, 5], 'reitter', '08:00', '16:00');
    add('kovacs-sebestyen', [6], 'reitter', '09:00', '13:00');
    return out;
  }

  /* ---------------- tár ---------------- */
  var db = null;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* tele */ } }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); if (db && db.v === 3) { szinPotol(); db.torzs = torzsAlap(db.torzs); return; } } } catch (e) { /* sérült */ }
    seed();
  }
  /* ---------------- torzs-alap.js: a kolléga Lilla-kör mezői és az új szabályok ---------------- */
  var KOLLEGA_UJ_MEZOK = ['email', 'aktiv_tol', 'aktiv_ig', 'foto', 'bemutatkozas', 'archivalt', 'naptar_id'];
  var SZABALY_UJ_ALAP = { ertesitKollega: true, emlekeztetoBe: true, emlekeztetoOra: 30, reggeliHatarOra: 22, reggeliKezdesElott: 10, kinalas: 'igazitott', studioNaptarId: '' };
  /* torzs-alap.js: a felkínált kezdések lépése (a belső 15 perces rács ettől nem változik)
     globálisan (szabalyok.kinalas): 'igazitott' | 15 | 30 | 60; szolgáltatásonként (kinalas): null | 'igazitott' | 15 többszöröse 15 és 240 között */
  var KINALAS_GLOBALIS = ['igazitott', 15, 30, 60];
  function kinalasGlobalis(v) { if (KINALAS_GLOBALIS.indexOf(v) < 0) throw hiba("Hibás beállítás: kinalas ('igazitott', 15, 30 vagy 60)."); return v; }
  function kinalasSzolgaltatas(v, id) {
    if (v === null || v === 'igazitott') return v;
    if (Number.isInteger(v) && v >= 15 && v <= 240 && v % 15 === 0) return v;
    throw hiba('Hibás kínálás' + (id ? ' (' + id + ')' : '') + ": null, 'igazitott', vagy 15 többszöröse 15 és 240 perc között.");
  }
  function kollegaAlap(k) {
    return Object.assign({}, k, {
      email: typeof k.email === 'string' ? k.email : '', aktiv_tol: typeof k.aktiv_tol === 'string' ? k.aktiv_tol : '',
      aktiv_ig: typeof k.aktiv_ig === 'string' ? k.aktiv_ig : '', foto: typeof k.foto === 'string' ? k.foto : '',
      bemutatkozas: typeof k.bemutatkozas === 'string' ? k.bemutatkozas : '', archivalt: k.archivalt === true,
      naptar_id: typeof k.naptar_id === 'string' ? k.naptar_id : ''
    });
  }
  function torzsAlap(t) {
    return Object.assign({}, t, { kollegak: (t.kollegak || []).map(kollegaAlap), szabalyok: Object.assign({}, SZABALY_UJ_ALAP, t.szabalyok || {}) });
  }
  function aktivANapon(k, datum) {
    if (k.archivalt === true) return false;
    if (k.aktiv_tol && datum < k.aktiv_tol) return false;
    if (k.aktiv_ig && datum > k.aktiv_ig) return false;
    return true;
  }
  var EMAIL_RE_K = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
  function szovegK(v, mezo, max) {
    if (v == null) return '';
    if (typeof v !== 'string') throw hiba('Hibás mező: ' + mezo + '.');
    var s = v.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (s.length > max) throw hiba('Túl hosszú: ' + mezo + ' (legfeljebb ' + max + ' karakter).');
    return s;
  }
  /* torzs-alap.js naptarAzonosito: Google Naptár azonosító (calendarId) vagy üres */
  var NAPTAR_RE = /^[A-Za-z0-9._%+#-]{1,200}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  function naptarAzonosito(v, mezo) {
    if (v == null || v === '') return '';
    if (typeof v !== 'string') throw hiba('Hibás mező: ' + (mezo || 'naptár-azonosító') + '.');
    var s = v.trim();
    if (s && (s.length > 254 || !NAPTAR_RE.test(s))) throw hiba('Hibás ' + (mezo || 'naptár-azonosító') + ': a Google Naptár beállításaiban, a „Naptár integrálása” résznél látható azonosító kell, például valami@group.calendar.google.com.');
    return s;
  }
  function kollegaUjMezok(d) {
    var ki = {};
    if ('email' in d) { var e = szovegK(d.email, 'e-mail', 254).toLowerCase(); if (e && !EMAIL_RE_K.test(e)) throw hiba('Hibás e-mail-cím.'); ki.email = e; }
    ['aktiv_tol', 'aktiv_ig'].forEach(function (k) {
      if (!(k in d)) return;
      var v = d[k] == null ? '' : d[k];
      if (v !== '' && !ervenyesDatum(v)) throw hiba('Hibás dátum: ' + (k === 'aktiv_tol' ? 'belépés' : 'kilépés') + ' (ÉÉÉÉ-HH-NN).');
      ki[k] = v;
    });
    if ('foto' in d) {
      var f = szovegK(d.foto, 'fotó', 500);
      if (f && !/^https:\/\/[^\s"'<>\\]+$/.test(f) && !/^\/(?![/\\])[^\s"'<>\\]*$/.test(f)) throw hiba('A fotó https:// kezdetű webcím vagy a weboldalon belüli /út legyen.');
      ki.foto = f;
    }
    if ('bemutatkozas' in d) ki.bemutatkozas = szovegK(d.bemutatkozas, 'bemutatkozás', 2000);
    if ('archivalt' in d) { if (typeof d.archivalt !== 'boolean') throw hiba('Hibás mező: archivalt (true vagy false).'); ki.archivalt = d.archivalt; }
    if ('naptar_id' in d) ki.naptar_id = naptarAzonosito(d.naptar_id, 'naptár-azonosító (kolléga)');
    return ki;
  }
  function aktivSorrend(k) { if (k.aktiv_tol && k.aktiv_ig && k.aktiv_tol > k.aktiv_ig) throw hiba('A belépés napja nem lehet a kilépés után.'); }
  function szabalyUjMezok(sz) {
    var ki = {};
    ['ertesitKollega', 'emlekeztetoBe'].forEach(function (k) {
      if (!(k in sz)) return;
      if (typeof sz[k] !== 'boolean') throw hiba('Hibás beállítás: ' + k + ' (true vagy false).');
      ki[k] = sz[k];
    });
    if ('emlekeztetoOra' in sz) {
      if (!Number.isInteger(sz.emlekeztetoOra) || sz.emlekeztetoOra < 1 || sz.emlekeztetoOra > 168) throw hiba('Hibás szám: emlekeztetoOra (1 és 168 között).');
      ki.emlekeztetoOra = sz.emlekeztetoOra;
    }
    if ('kinalas' in sz) ki.kinalas = kinalasGlobalis(sz.kinalas);
    if ('studioNaptarId' in sz) ki.studioNaptarId = naptarAzonosito(sz.studioNaptarId, 'stúdiónaptár-azonosító');
    return ki;
  }
  // a régi és az új kolléga: mely jövőbeli, megerősített foglalások válnának foglalhatatlanná (szukitoFeltetel)
  function szukito(regi, uj) {
    if (uj.archivalt === true) return regi.archivalt === true ? null : function () { return true; };
    if ((uj.aktiv_tol || '') === (regi.aktiv_tol || '') && (uj.aktiv_ig || '') === (regi.aktiv_ig || '')) return null;
    if (!uj.aktiv_tol && !uj.aktiv_ig) return null;
    return function (b) { return (uj.aktiv_tol && b.date < uj.aktiv_tol) || (uj.aktiv_ig && b.date > uj.aktiv_ig); };
  }
  function jovobeli(kid, felt) {
    var ma = F.most().datum;
    return db.bookings.filter(function (b) { return b.staff_id === kid && b.status === 'megerositett' && b.date >= ma && felt(b); }).length;
  }
  function szukitesOr(regiKollegak, ujKollegak) {
    var ujIds = {}; ujKollegak.forEach(function (k) { ujIds[k.id] = 1; });
    regiKollegak.forEach(function (r) {
      var uj = ujKollegak.filter(function (k) { return k.id === r.id; })[0];
      var felt = !ujIds[r.id] ? function () { return true; } : szukito(kollegaAlap(r), uj);
      if (!felt) return;
      var n = jovobeli(r.id, felt);
      var archival = !ujIds[r.id] || (uj.archivalt === true && r.archivalt !== true);
      if (n) throw HttpErr(409, 'A kollégának ' + n + ' jövőbeli foglalása van, ami ' + (archival ? 'archiválás után gazdátlan maradna' : 'a belépés előtt vagy a kilépés után esik') + '. Előbb helyezd át vagy mondd le ' + (n > 1 ? 'ezeket' : 'ezt') + '.', { jovobeli: n });
    });
  }
  /* ---------------- kollégánkénti szín = a backend szin.js-e ---------------- */
  var PALETTA = ['#4f6d8a', '#a0553c', '#5b7d55', '#7d5a8e', '#8c6b2a', '#2f6e6e', '#94485e', '#5a5f30', '#3b4580', '#5e4b44'];
  function szinNormal(v) { if (typeof v !== 'string') return null; var s = v.trim(); return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null; }
  // mint a szinKioszt: a meglévő érvényes szín marad, a hiányzó a legkevésbé használt palettaszínt kapja
  function szinKioszt(kollegak) {
    var h = {}; PALETTA.forEach(function (p) { h[p] = 0; });
    var ki = kollegak.map(function (k) { return Object.assign({}, k, { szin: szinNormal(k.szin) }); });
    ki.forEach(function (k) { if (k.szin && h[k.szin] != null) h[k.szin]++; });
    ki.forEach(function (k) {
      if (k.szin) return;
      var best = PALETTA[0];
      PALETTA.forEach(function (p) { if (h[p] < h[best]) best = p; });
      k.szin = best; h[best]++;
    });
    return ki;
  }
  // a régi (szín nélküli) mentett mock-adat színt kap, mint a torzsBetolt migrációja
  function szinPotol() {
    if (db.torzs.kollegak.every(function (k) { return szinNormal(k.szin); })) return;
    db.torzs.kollegak = szinKioszt(db.torzs.kollegak); save();
  }
  // mint a backend torzsBetolt: a Lilla-kör mezői mindig kitöltve (a régi adatban is)
  function T() { if (!db.torzs.szabalyok || db.torzs.szabalyok.emlekeztetoOra == null || db.torzs.szabalyok.kinalas == null || db.torzs.kollegak.some(function (k) { return k.archivalt == null; })) db.torzs = torzsAlap(db.torzs); return db.torzs; }
  function hetNapja(d) { return F.hetNapja(d) || 7; }
  function hm(p) { return F.hm2(p); }
  // HH:MM → perc; csak a 15 perces rácson (mint a backend hhmmToPerc)
  function hhmmToPerc(s) {
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
    if (!m) return null;
    var p = Number(m[1]) * 60 + Number(m[2]);
    return p % RACS === 0 ? p : null;
  }
  function napok(tol, ig, max) { var out = []; for (var d = tol; d <= ig && out.length < (max || 400); d = F.addDays(d, 1)) out.push(d); return out; }
  function helyiToUtc(d, p) { return F.utcDate(d, p).getTime(); }
  function ervenyesDatum(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var a = s.split('-').map(Number), t = new Date(Date.UTC(a[0], a[1] - 1, a[2]));
    return t.getUTCFullYear() === a[0] && t.getUTCMonth() === a[1] - 1 && t.getUTCDate() === a[2];
  }

  /* ---------------- szabad.js ---------------- */
  function foglalasSlotjai(o) {
    var n = Math.ceil((o.perc + (o.puffer || 0)) / RACS), out = [];
    for (var i = 0; i < n; i++) out.push({ kollega: o.kollega, datum: o.datum, slot: o.kezd + i * RACS });
    return out;
  }
  function kivetelUtkozik(kiv, o) {
    return kiv.some(function (k) {
      if (k.kollega && k.kollega !== o.kollega) return false;
      if (k.helyszin && k.helyszin !== o.helyszin) return false;
      if (!k.kollega && !k.helyszin) return false;
      if (o.datum < k.tol || o.datum > k.ig) return false;
      if (k.kezd == null || k.veg == null) return true;
      return o.kezd < k.veg && k.kezd < o.veg;
    });
  }
  function napiKivetelek(kiv, o) {
    return kiv.filter(function (k) {
      if (k.kollega && k.kollega !== o.kollega) return false;
      if (k.helyszin && k.helyszin !== o.helyszin) return false;
      if (!k.kollega && !k.helyszin) return false;
      return o.datum >= k.tol && o.datum <= k.ig;
    });
  }
  // a felkínált kezdések lépése percben (szabad.js kinalasLepes): a szolgáltatás kinalas mezője erősebb,
  // 'igazitott' = időtartam + puffer, felfelé a 15 többszörösére
  function kinalasLepes(szolg, szabalyok) {
    var k = szolg.kinalas != null ? szolg.kinalas : ((szabalyok || {}).kinalas != null ? szabalyok.kinalas : 'igazitott');
    if (Number.isInteger(k) && k >= RACS && k <= 240 && k % RACS === 0) return k;
    return Math.max(RACS, Math.ceil((szolg.perc + (szolg.puffer == null ? 10 : szolg.puffer)) / RACS) * RACS);
  }
  // a [tol, ig) szakasz részleges kivételekkel nem fedett részei; egész napos kivételnél üres
  function szabadSzakaszok(tol, ig, kiv) {
    var sz = [[tol, ig]];
    for (var i = 0; i < kiv.length; i++) {
      var k = kiv[i];
      if (k.kezd == null || k.veg == null) return [];
      sz = sz.reduce(function (acc, ab) {
        var a = ab[0], b = ab[1];
        if (!(a < k.veg && k.kezd < b)) { acc.push([a, b]); return acc; }
        [[a, Math.min(b, k.kezd)], [Math.max(a, k.veg), b]].forEach(function (x) { if (x[0] < x[1]) acc.push(x); });
        return acc;
      }, []);
    }
    return sz;
  }
  function foglaltLista(kiveve) {
    var out = [];
    db.bookings.forEach(function (b) {
      if (b.status !== 'megerositett' || b.id === kiveve) return;
      foglalasSlotjai({ kollega: b.staff_id, datum: b.date, kezd: b.start_min, perc: b.dur_min, puffer: b.buffer_min }).forEach(function (s) { out.push(s); });
    });
    return out;
  }
  function szabadIdopontok(o) {
    var torzs = o.torzs, hely = torzs.helyszinek.filter(function (h) { return h.id === o.helyszin; })[0];
    var szolg = torzs.szolgaltatasok.filter(function (s) { return s.id === o.szolgaltatas; })[0];
    var eredmeny = {}, osszes = napok(o.tol, o.ig);
    osszes.forEach(function (d) { eredmeny[d] = []; });
    if (!hely || !szolg || (szolg.helyszinek || []).indexOf(o.helyszin) < 0) return { napok: eredmeny };
    var kollega = o.kollega || 'barki';
    var jeloltek = torzs.kollegak.filter(function (k) {
      return (kollega === 'barki' || k.id === kollega) && k.archivalt !== true && (k.helyszinek || []).indexOf(o.helyszin) >= 0 && (k.szolgaltatasok || []).indexOf(o.szolgaltatas) >= 0;
    }).sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    if (!jeloltek.length) return { napok: eredmeny };
    var sz = torzs.szabalyok || {}, most = o.most || Date.now();
    var legkorabbi = most + (sz.minEloreOra == null ? 2 : sz.minEloreOra) * 3600e3;
    var utolso = F.addDays(F.most().datum, sz.maxEloreNap == null ? 60 : sz.maxEloreNap);
    var fs = {};
    (o.foglalt || []).forEach(function (f) { fs[f.kollega + '|' + f.datum + '|' + f.slot] = 1; });
    var puffer = szolg.puffer == null ? 10 : szolg.puffer;
    var nyit = F.perc(hely.nyit), zar = F.perc(hely.zar), lepes = kinalasLepes(szolg, sz);
    var kivAll = o.kivetelek || db.kivetelek;
    osszes.forEach(function (datum) {
      if (datum > utolso) return;
      if (helyiToUtc(datum, 24 * 60 - 1) <= legkorabbi) return;
      var nap = hetNapja(datum), kezdesek = {};
      // belépés előtt és kilépés után a kolléga nem foglalható (a „bárki” sem osztja rá)
      jeloltek.filter(function (k) { return aktivANapon(k, datum); }).map(function (k) { return k.id; }).forEach(function (kid) {
        var napiKiv = napiKivetelek(kivAll, { kollega: kid, helyszin: o.helyszin, datum: datum });
        // a kolléga aznapi foglalásainak vége: egy zár-sorozat utolsó rácspontja utáni rácspont
        var foglalasVegek = (o.foglalt || []).filter(function (f) { return f.kollega === kid && f.datum === datum && !fs[kid + '|' + datum + '|' + (f.slot + RACS)]; })
          .map(function (f) { return f.slot + RACS; });
        db.beosztas.forEach(function (b) {
          if (b.kollega !== kid || b.nap !== nap || b.helyszin !== o.helyszin) return;
          // a rács horgonya a beosztási blokk, illetve a részleges kivétel utáni szabad szakasz eleje
          szabadSzakaszok(Math.max(b.kezd, nyit), Math.min(b.veg, zar), napiKiv).forEach(function (ab) {
            var elso = Math.ceil(ab[0] / RACS) * RACS, i0 = ab[1], jelolt = {};
            for (var k = elso; k + szolg.perc <= i0; k += lepes) jelolt[k] = 1;
            // hézagkitöltés: a foglalás vége utáni első rácspont is, ha a kezelés belefér
            foglalasVegek.forEach(function (v) { if (v >= elso && v + szolg.perc <= i0) jelolt[v] = 1; });
            Object.keys(jelolt).map(Number).forEach(function (k) {
              if (helyiToUtc(datum, k) < legkorabbi) return;
              if (kivetelUtkozik(kivAll, { kollega: kid, helyszin: o.helyszin, datum: datum, kezd: k, veg: k + szolg.perc })) return;
              var sl = foglalasSlotjai({ kollega: kid, datum: datum, kezd: k, perc: szolg.perc, puffer: puffer });
              if (sl.some(function (s) { return fs[kid + '|' + datum + '|' + s.slot]; })) return;
              (kezdesek[k] = kezdesek[k] || []).indexOf(kid) < 0 && kezdesek[k].push(kid);
            });
          });
        });
      });
      eredmeny[datum] = Object.keys(kezdesek).map(Number).sort(function (a, b) { return a - b; })
        .map(function (k) { return { kezd: hm(k), kollegak: kezdesek[k].sort() }; });
    });
    return { napok: eredmeny };
  }

  /* ---------------- levelek.js (a backend szövege és HTML-je) ---------------- */
  var SZIN = { ink: '#303030', accent: '#BFA18F', krem: '#EAEAEA', bezs: '#E4DBD2', kek: '#CCD6D9' };
  var esc = F.esc;
  var NAPNEV = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  function szepDatum(d) { var a = d.split('-').map(Number); return a[0] + '. ' + F.HONAPOK[a[1] - 1] + ' ' + a[2] + '. (' + NAPNEV[new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay()] + ')'; }
  function ft(n) { return n == null ? '' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft'; }
  function keret(cim, torzs) {
    return '<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + esc(cim) + '</title></head>' +
      '<body style="margin:0;background:' + SZIN.bezs + ';color:' + SZIN.ink + ';font-family:Georgia,\'Times New Roman\',serif">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + SZIN.bezs + '"><tr><td align="center" style="padding:32px 16px">' +
      '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:' + SZIN.krem + '">' +
      '<tr><td style="padding:28px 32px 8px;border-bottom:1px solid ' + SZIN.accent + ';font-size:13px;letter-spacing:.14em;text-transform:uppercase">Studio F360</td></tr>' +
      '<tr><td style="padding:24px 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">' + torzs + '</td></tr>' +
      '<tr><td style="padding:16px 32px;background:' + SZIN.ink + ';color:' + SZIN.krem + ';font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6">' +
      'Studio F360 · Mexikói út 32/b · Reitter Ferenc utca 48. · Budapest</td></tr></table></td></tr></table></body></html>';
  }
  function adatTabla(f) {
    function sor(k, v) { return '<tr><td style="padding:6px 16px 6px 0;color:' + SZIN.ink + ';opacity:.7;white-space:nowrap">' + esc(k) + '</td><td style="padding:6px 0">' + esc(v) + '</td></tr>'; }
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid ' + SZIN.accent + ';border-bottom:1px solid ' + SZIN.accent + ';width:100%">' +
      sor('Időpont', szepDatum(f.datum) + ', ' + f.kezd + ' és ' + f.veg + ' között') +
      sor('Szolgáltatás', f.szolgaltatas.nev + ' (' + f.szolgaltatas.perc + ' perc)') +
      sor('Szakember', f.kollega.nev) + sor('Helyszín', f.helyszin.nev + ', ' + f.helyszin.cim) +
      (f.szolgaltatas.ar != null ? sor('Ár', ft(f.szolgaltatas.ar) + ', a helyszínen fizetendő') : '') +
      sor('Azonosító', f.azonosito) + '</table>';
  }
  function adatSzoveg(f) {
    return ['Időpont: ' + szepDatum(f.datum) + ', ' + f.kezd + ' és ' + f.veg + ' között', 'Szolgáltatás: ' + f.szolgaltatas.nev + ' (' + f.szolgaltatas.perc + ' perc)',
      'Szakember: ' + f.kollega.nev, 'Helyszín: ' + f.helyszin.nev + ', ' + f.helyszin.cim,
      f.szolgaltatas.ar != null ? 'Ár: ' + ft(f.szolgaltatas.ar) + ', a helyszínen fizetendő' : '', 'Azonosító: ' + f.azonosito].filter(Boolean).join('\n');
  }
  function gomb(url, felirat) { return '<p style="margin:24px 0"><a href="' + esc(url) + '" style="display:inline-block;padding:12px 22px;background:' + SZIN.accent + ';color:' + SZIN.ink + ';text-decoration:none">' + esc(felirat) + '</a></p>'; }
  // a backend levelek.js-e (2026-10-01): közös kezelő-gomb (lemondás és módosítás), naptár-sor Google-linkkel
  var KEZELO_GOMB = 'Időpont lemondása / módosítása';
  function kezeloHtml(lemondasUrl, sz) {
    return '<p>Ha mégsem tudsz jönni, vagy másik időpont kellene, a kezdés előtt ' + sz.lemondasOra + ' óráig itt lemondhatod vagy módosíthatod:</p>' +
      gomb(lemondasUrl, KEZELO_GOMB) + '<p>' + sz.lemondasOra + ' órán belül telefonon tudunk segíteni: ' + esc(sz.telefon) + '.</p>';
  }
  function kezeloSzoveg(lemondasUrl, sz) {
    return 'Ha mégsem tudsz jönni, vagy másik időpont kellene, a kezdés előtt ' + sz.lemondasOra + ' óráig itt lemondhatod vagy módosíthatod (' + KEZELO_GOMB + '):\n' + lemondasUrl + '\n\n' +
      sz.lemondasOra + ' órán belül telefonon tudunk segíteni: ' + sz.telefon + '.';
  }
  function naptarHtml(icsUrl, googleUrl) {
    return '<p>A naptáradhoz a csatolt fájllal vagy <a href="' + esc(icsUrl) + '" style="color:' + SZIN.ink + '">ezzel a linkkel</a> adhatod hozzá.' +
      ' Ha Google Naptárat használsz: <a href="' + esc(googleUrl) + '" style="color:' + SZIN.ink + '">hozzáadás a Google Naptárhoz</a>.</p>';
  }
  function naptarSzoveg(icsUrl, googleUrl) { return 'Naptárhoz adás: ' + icsUrl + '\nGoogle Naptárhoz: ' + googleUrl; }
  function regiIdopont(r) { return szepDatum(r.datum) + ', ' + r.kezd + ' és ' + r.veg + ' között, ' + r.kollega.nev; }
  // teendők az időpont előtt (InBody: „Mérés előtt”), a backend levelek.js elokeszitesHtml-je
  function elokH(f) { var l = f.szolgaltatas.elokeszites; return l && l.length ? '<p><strong>Mérés előtt</strong></p><ul style="margin:0 0 16px;padding-left:20px">' + l.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }
  function elokSz(f) { var l = f.szolgaltatas.elokeszites; return l && l.length ? 'Mérés előtt:\n' + l.map(function (x) { return '- ' + x; }).join('\n') + '\n\n' : ''; }
  function visszaigazolas(f, o) {
    var sz = o.szabalyok, targy = 'Időpontfoglalás visszaigazolása · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · Studio F360';
    var g = F.googleNaptarUrl(f, o.lemondasUrl);
    var html = keret(targy, '<p>Kedves ' + esc(f.nev) + '!</p><p>Köszönjük a foglalásodat, az időpontodat rögzítettük.</p>' + adatTabla(f) + elokH(f) +
      naptarHtml(o.icsUrl, g) + kezeloHtml(o.lemondasUrl, sz) + '<p>Várunk szeretettel,<br>a Studio F360 csapata</p>');
    var szoveg = 'Kedves ' + f.nev + '!\n\nKöszönjük a foglalásodat, az időpontodat rögzítettük.\n\n' + adatSzoveg(f) + '\n\n' + elokSz(f) + naptarSzoveg(o.icsUrl, g) +
      '\n\n' + kezeloSzoveg(o.lemondasUrl, sz) + '\n\nVárunk szeretettel,\na Studio F360 csapata\n';
    return { tipus: 'visszaigazolas', cimzett: f.email, targy: targy, html: html, szoveg: szoveg, ics: o.ics };
  }
  function modositasLevel(f, o) {
    var sz = o.szabalyok, targy = 'Időpont módosítva · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · Studio F360';
    var g = F.googleNaptarUrl(f, o.lemondasUrl);
    var html = keret(targy, '<p>Kedves ' + esc(f.nev) + '!</p><p>Az időpontodat módosítottuk. A korábbi időpont (' + esc(regiIdopont(o.regi)) + ') már nem érvényes, az új:</p>' +
      adatTabla(f) + elokH(f) + naptarHtml(o.icsUrl, g) + '<p>Ha a naptáradban a korábbi időpont is szerepel, azt töröld.</p>' + kezeloHtml(o.lemondasUrl, sz) +
      '<p>Várunk szeretettel,<br>a Studio F360 csapata</p>');
    var szoveg = 'Kedves ' + f.nev + '!\n\nAz időpontodat módosítottuk. A korábbi időpont (' + regiIdopont(o.regi) + ') már nem érvényes, az új:\n\n' + adatSzoveg(f) + '\n\n' +
      naptarSzoveg(o.icsUrl, g) + '\nHa a naptáradban a korábbi időpont is szerepel, azt töröld.\n\n' + kezeloSzoveg(o.lemondasUrl, sz) + '\n\nVárunk szeretettel,\na Studio F360 csapata\n';
    return { tipus: 'modositas', cimzett: f.email, targy: targy, html: html, szoveg: szoveg, ics: o.ics };
  }
  function studioModositas(f, o) {
    var targy = 'Módosított foglalás · ' + f.helyszin.nev + ' · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · ' + f.kollega.nev;
    var kap = [f.email && 'E-mail: ' + f.email, f.telefon && 'Telefon: ' + f.telefon].filter(Boolean);
    var html = keret(targy, '<p><strong>' + esc(f.nev) + '</strong> módosította a foglalását a weboldalon.</p><p>Korábbi időpont: ' + esc(regiIdopont(o.regi)) +
      '. Ez az időpont felszabadult.</p><p>Új időpont:</p>' + adatTabla(f) + '<p>' + kap.map(esc).join('<br>') + '</p>');
    var szoveg = f.nev + ' módosította a foglalását a weboldalon.\n\nKorábbi időpont: ' + regiIdopont(o.regi) + '. Ez az időpont felszabadult.\n\nÚj időpont:\n' +
      adatSzoveg(f) + '\n\n' + kap.join('\n') + '\n';
    return { tipus: 'studio-modositas', cimzett: o.szabalyok.studioEmail, targy: targy, html: html, szoveg: szoveg };
  }
  function studioErtesito(f, o) {
    var targy = 'Új foglalás · ' + f.helyszin.nev + ' · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · ' + f.kollega.nev;
    var kap = [f.email && 'E-mail: ' + f.email, f.telefon && 'Telefon: ' + f.telefon].filter(Boolean);
    var html = keret(targy, '<p>Új foglalás érkezett a weboldalról.</p>' + adatTabla(f) + '<p><strong>' + esc(f.nev) + '</strong><br>' + kap.map(esc).join('<br>') + '</p>' +
      (f.megjegyzes ? '<p>Megjegyzés: ' + esc(f.megjegyzes) + '</p>' : ''));
    var szoveg = 'Új foglalás érkezett a weboldalról.\n\n' + adatSzoveg(f) + '\n\nVendég: ' + f.nev + '\n' + kap.join('\n') + '\n' + (f.megjegyzes ? 'Megjegyzés: ' + f.megjegyzes + '\n' : '');
    return { tipus: 'studio-ertesito', cimzett: o.szabalyok.studioEmail, targy: targy, html: html, szoveg: szoveg };
  }
  function lemondasLevel(f, o) {
    var sz = o.szabalyok, targy = 'Időpont lemondva · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · Studio F360';
    var html = keret(targy, '<p>Kedves ' + esc(f.nev) + '!</p><p>Az alábbi időpontodat lemondtuk.</p>' + adatTabla(f) +
      '<p>Ha új időpontot szeretnél, a weboldalon foglalhatsz, vagy hívj minket: ' + esc(sz.telefon) + '.</p><p>Üdvözlettel,<br>a Studio F360 csapata</p>');
    var szoveg = 'Kedves ' + f.nev + '!\n\nAz alábbi időpontodat lemondtuk.\n\n' + adatSzoveg(f) + '\n\nHa új időpontot szeretnél, a weboldalon foglalhatsz, vagy hívj minket: ' + sz.telefon + '.\n\nÜdvözlettel,\na Studio F360 csapata\n';
    return { tipus: 'lemondas', cimzett: f.email, targy: targy, html: html, szoveg: szoveg };
  }

  /* ---------------- levelek-kollega.js (kolléga-értesítők és a páciens emlékeztetője) ---------------- */
  function idopontSz(f) { return szepDatum(f.datum) + ', ' + f.kezd + ' és ' + f.veg + ' között'; }
  function ktabla(sorok) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid ' + SZIN.accent + ';border-bottom:1px solid ' + SZIN.accent + ';width:100%">' +
      sorok.filter(function (r) { return r[1]; }).map(function (r) { return '<tr><td style="padding:6px 16px 6px 0;opacity:.7;white-space:nowrap">' + esc(r[0]) + '</td><td style="padding:6px 0">' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>';
  }
  function kszoveg(sorok) { return sorok.filter(function (r) { return r[1]; }).map(function (r) { return r[0] + ': ' + r[1]; }).join('\n'); }
  function kadatok(f, cimke) {
    return [[cimke || 'Időpont', idopontSz(f)], ['Szolgáltatás', f.szolgaltatas.nev + ' (' + f.szolgaltatas.perc + ' perc)'], ['Szakember', f.kollega.nev],
      ['Helyszín', f.helyszin.nev + ', ' + f.helyszin.cim], ['Páciens', f.nev], ['E-mail', f.email], ['Telefon', f.telefon], ['Megjegyzés', f.megjegyzes], ['Azonosító', f.azonosito]];
  }
  function klevel(tipus, cimzett, targy, bev, sorok, zaras) {
    var html = keret(targy, '<p>' + esc(bev) + '</p>' + ktabla(sorok) + (zaras ? '<p>' + esc(zaras) + '</p>' : ''));
    return { tipus: tipus, cimzett: cimzett, targy: targy, html: html, szoveg: bev + '\n\n' + kszoveg(sorok) + '\n' + (zaras ? '\n' + zaras + '\n' : '') };
  }
  function kollegaUj(f, cimzett, admin) {
    return klevel('kollega-uj', cimzett, 'Új foglalás · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · ' + f.szolgaltatas.nev,
      admin ? 'Új időpontot rögzítettek neked az adminban.' : 'Új foglalásod érkezett a weboldalról.', kadatok(f));
  }
  function kollegaLemondas(f, cimzett, admin) {
    return klevel('kollega-lemondas', cimzett, 'Lemondott foglalás · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · ' + f.kollega.nev,
      admin ? 'Az alábbi foglalást az adminban lemondták.' : f.nev + ' lemondta az alábbi foglalását.', kadatok(f), 'Ez az időpont felszabadult.');
  }
  function kollegaModositas(f, regi, cimzett) {
    return klevel('kollega-modositas', cimzett, 'Módosított foglalás · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · ' + f.szolgaltatas.nev,
      f.nev + ' foglalása módosult.', [['Korábbi időpont', idopontSz(regi)]].concat(kadatok(f, 'Új időpont')), 'A korábbi időpont felszabadult.');
  }
  function emlekeztetoLevel(f, o) {
    var targy = 'Emlékeztető · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · Studio F360', sz = o.szabalyok;
    var hat = new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(o.hataridoMs));
    var sorok = [['Időpont', idopontSz(f)], ['Szolgáltatás', f.szolgaltatas.nev + ' (' + f.szolgaltatas.perc + ' perc)'], ['Szakember', f.kollega.nev], ['Helyszín', f.helyszin.nev + ', ' + f.helyszin.cim], ['Azonosító', f.azonosito]];
    var kh = o.lemondhato
      ? '<p>Ha mégsem tudsz jönni, vagy másik időpont kellene, ' + esc(hat) + '-ig itt lemondhatod vagy módosíthatod:</p>' + gomb(o.lemondasUrl, KEZELO_GOMB) + '<p>Ezután telefonon tudunk segíteni: ' + esc(sz.telefon) + '.</p>'
      : '<p>Ha mégsem tudsz jönni, kérjük, hívj minket minél előbb: ' + esc(sz.telefon) + '.</p>';
    var ks = o.lemondhato
      ? 'Ha mégsem tudsz jönni, vagy másik időpont kellene, ' + hat + '-ig itt lemondhatod vagy módosíthatod (' + KEZELO_GOMB + '):\n' + o.lemondasUrl + '\n\nEzután telefonon tudunk segíteni: ' + sz.telefon + '.'
      : 'Ha mégsem tudsz jönni, kérjük, hívj minket minél előbb: ' + sz.telefon + '.';
    var html = keret(targy, '<p>Kedves ' + esc(f.nev) + '!</p><p>Emlékeztetünk a közelgő időpontodra.</p>' + ktabla(sorok) + kh + '<p>Várunk szeretettel,<br>a Studio F360 csapata</p>');
    var szoveg = 'Kedves ' + f.nev + '!\n\nEmlékeztetünk a közelgő időpontodra.\n\n' + kszoveg(sorok) + '\n\n' + ks + '\n\nVárunk szeretettel,\na Studio F360 csapata\n';
    return { tipus: 'emlekezteto', cimzett: f.email, targy: targy, html: html, szoveg: szoveg };
  }
  function kollegaCim(kid) {
    var t = T();
    if (t.szabalyok && t.szabalyok.ertesitKollega === false) return '';
    var k = t.kollegak.filter(function (x) { return x.id === kid; })[0];
    return (k && k.email) || '';
  }

  /* ---------------- forras.js (UTM) ---------------- */
  var FORRAS_KULCSOK = { utm_source: 200, utm_medium: 200, utm_campaign: 200, utm_content: 200, utm_term: 200, gclid: 300, fbclid: 300, landing: 500, referrer: 500 };
  function forrasBemenet(v) {
    if (v == null) return null;
    if (typeof v !== 'object' || Array.isArray(v)) throw HttpErr(400, 'Hibás kérés: forras.');
    var ki = {};
    Object.keys(FORRAS_KULCSOK).forEach(function (k) {
      if (v[k] == null) return;
      if (typeof v[k] !== 'string') throw HttpErr(400, 'Hibás kérés: forras.' + k + '.');
      var s = v[k].replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, FORRAS_KULCSOK[k]);
      if (!s || (k === 'referrer' && !/^https?:\/\//i.test(s))) return;
      ki[k] = s;
    });
    return Object.keys(ki).length ? ki : null;
  }
  function forrasNev(k) {
    if (!k) return '(közvetlen)';
    if (k.utm_source) return k.utm_source;
    if (k.gclid) return 'google (gclid)';
    if (k.fbclid) return 'facebook (fbclid)';
    if (k.referrer) { try { return new URL(k.referrer).hostname; } catch (e) { /* hibás */ } }
    return '(közvetlen)';
  }
  function forrasRiport(q) {
    var ma = F.most().datum, tol = q.get('tol') || F.addDays(ma, -30), ig = q.get('ig') || F.addDays(ma, 60);
    if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw HttpErr(400, 'Hibás dátum-tartomány.');
    if (napok(tol, ig, 401).length > 400) throw HttpErr(400, 'Egyszerre legfeljebb 400 nap kérhető le.');
    var cs = {}, osszesen = { foglalasok: 0, lemondva: 0 }, t = T();
    db.bookings.filter(function (b) { return b.date >= tol && b.date <= ig; }).forEach(function (b) {
      var k = b.forras || null, forras = forrasNev(k), kampany = (k && k.utm_campaign) || '';
      var kulcs = JSON.stringify([forras, kampany, b.service_id]);
      if (!cs[kulcs]) {
        var sz = t.szolgaltatasok.filter(function (s) { return s.id === b.service_id; })[0];
        cs[kulcs] = { forras: forras, medium: (k && k.utm_medium) || '', kampany: kampany, szolgaltatas: { id: b.service_id, nev: sz ? sz.nev : b.service_id, perc: sz ? sz.perc : null }, foglalasok: 0, lemondva: 0 };
      }
      var c = cs[kulcs];
      if (!c.medium && k && k.utm_medium) c.medium = k.utm_medium;
      if (b.status === 'lemondva') { c.lemondva++; osszesen.lemondva++; } else { c.foglalasok++; osszesen.foglalasok++; }
    });
    var sorok = Object.keys(cs).map(function (x) { return cs[x]; }).sort(function (a, b) {
      return b.foglalasok - a.foglalasok || b.lemondva - a.lemondva || a.forras.localeCompare(b.forras, 'hu') || a.kampany.localeCompare(b.kampany, 'hu') || a.szolgaltatas.nev.localeCompare(b.szolgaltatas.nev, 'hu');
    });
    return { tol: tol, ig: ig, osszesen: osszesen, sorok: sorok };
  }

  /* ---------------- emlekezteto.js ---------------- */
  function emlekeztetoFuttat() {
    var sz = T().szabalyok, most = Date.now();
    if (sz.emlekeztetoBe === false) return { kikapcsolva: true, emlekeztetve: 0, jeloltek: 0 };
    var ablak = sz.emlekeztetoOra * 3600e3;
    var jeloltek = db.bookings.filter(function (b) {
      if (b.status !== 'megerositett' || b.emlekeztetve_at || !b.email) return false;
      var kezd = helyiToUtc(b.date, b.start_min), foglalva = b.modositva_at || b.created_at;
      return kezd > most && kezd - most <= ablak && kezd - foglalva > ablak;
    }).slice(0, 25);
    jeloltek.forEach(function (b) {
      var a = lemondasAllapot(b);
      b.emlekeztetve_at = most;
      outboxIr(b.id, [emlekeztetoLevel(nezet(b), { lemondasUrl: linkek(b.token).lemondasUrl, hataridoMs: a.hataridoMs, szabalyok: sz, lemondhato: a.lemondhato })]);
    });
    save();
    return { kikapcsolva: false, emlekeztetve: jeloltek.length, jeloltek: jeloltek.length };
  }

  /* ---------------- ics.js ---------------- */
  function icsEsc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function utc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function icsKeszit(f, lemondasUrl) {
    var kezd = helyiToUtc(f.datum, f.kezdPerc), veg = kezd + f.szolgaltatas.perc * 60000, most = Date.now();
    var leiras = [f.szolgaltatas.nev + ', ' + f.kollega.nev, 'Azonosító: ' + f.azonosito, lemondasUrl ? 'Lemondás: ' + lemondasUrl : ''].filter(Boolean).join('\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio F360//Idopontfoglalo//HU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + f.azonosito + '@' + location.host, 'DTSTAMP:' + utc(most), 'SEQUENCE:' + Math.floor(most / 1000), 'DTSTART:' + utc(kezd), 'DTEND:' + utc(veg),
      'SUMMARY:' + icsEsc(f.szolgaltatas.nev + ' · Studio F360'), 'LOCATION:' + icsEsc('Studio F360, ' + f.helyszin.cim), 'DESCRIPTION:' + icsEsc(leiras),
      'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }

  /* ---------------- foglalas.js ---------------- */
  function HttpErr(status, msg, extra) { var e = new Error(msg); e.status = status; e.extra = extra; return e; }
  var ID_ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function rnd(n) { return Array.prototype.slice.call(crypto.getRandomValues(new Uint8Array(n))); }
  function ujAzonosito() { return 'F' + rnd(10).map(function (x) { return ID_ABC[x & 31]; }).join(''); }
  function ujToken(id) { return id + '.' + rnd(24).map(function (x) { return 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_'[x % 60]; }).join(''); }
  // élesben: https://<host>/foglalas/lemondas?t=… (a Pages a .html nélküli utat szolgálja ki);
  // a mockban a statikus szerver miatt a .html-es út kell, és a ?mock=1 megy tovább
  var MOCK_QS = location.protocol === 'file:' ? '' : '&mock=1';
  function linkek(token) {
    return { lemondasUrl: ROOT + 'foglalas/lemondas.html?t=' + encodeURIComponent(token) + MOCK_QS, icsUrl: ORIGIN + '/foglalas-api/foglalas.ics?t=' + encodeURIComponent(token) };
  }
  function nezet(r) {
    var t = T();
    var hely = t.helyszinek.filter(function (h) { return h.id === r.location_id; })[0] || { id: r.location_id, nev: r.location_id, cim: '' };
    var szolg = t.szolgaltatasok.filter(function (s) { return s.id === r.service_id; })[0] || { id: r.service_id, nev: r.service_id };
    var koll = t.kollegak.filter(function (k) { return k.id === r.staff_id; })[0] || { id: r.staff_id, nev: r.staff_id };
    return {
      azonosito: r.id, allapot: r.status, helyszin: { id: hely.id, nev: hely.nev, cim: hely.cim },
      szolgaltatas: Object.assign({ id: szolg.id, nev: szolg.nev, perc: r.dur_min, ar: r.price }, szolg.elokeszites && szolg.elokeszites.length ? { elokeszites: szolg.elokeszites } : {}), kollega: koll.szin ? { id: koll.id, nev: koll.nev, szin: koll.szin } : { id: koll.id, nev: koll.nev },
      datum: r.date, kezd: hm(r.start_min), veg: hm(r.start_min + r.dur_min), kezdPerc: r.start_min,
      nev: r.name, email: r.email, telefon: r.phone, megjegyzes: r.note, forras: r.source
    };
  }
  function publikusNezet(f) {
    return { azonosito: f.azonosito, allapot: f.allapot, helyszin: f.helyszin, szolgaltatas: f.szolgaltatas, kollega: { id: f.kollega.id, nev: f.kollega.nev }, datum: f.datum, kezd: f.kezd, veg: f.veg, nev: f.nev };
  }
  function szabRH(t) { var v = t.szabalyok.reggeliHatarOra; return v == null ? 22 : v; }
  function szabRK(t) { var v = t.szabalyok.reggeliKezdesElott; return v == null ? 10 : v; }
  // van-e foglalható beosztás a szolgáltatáshoz (foglalas.js katalogus: ha nincs, a felület a telefonszámot mutatja)
  function vanBeosztas(s, t) {
    var ma = F.most().datum;
    return t.kollegak.some(function (k) {
      return k.archivalt !== true && !(k.aktiv_ig && k.aktiv_ig < ma) && k.szolgaltatasok.indexOf(s.id) >= 0 &&
        db.beosztas.some(function (b) { return b.kollega === k.id && s.helyszinek.indexOf(b.helyszin) >= 0 && k.helyszinek.indexOf(b.helyszin) >= 0; });
    });
  }
  function katalogus() {
    var t = T();
    return {
      minta: t.minta === true,
      helyszinek: t.helyszinek.map(function (h) { return { id: h.id, nev: h.nev, cim: h.cim, nyit: h.nyit, zar: h.zar }; }),
      szolgaltatasok: t.szolgaltatasok.map(function (s) {
        var o = { id: s.id, nev: s.nev, perc: s.perc, ar: s.ar, helyszinek: s.helyszinek, lepes: kinalasLepes(s, t.szabalyok) };
        if (s.leiras) o.leiras = s.leiras;
        if (s.elokeszites && s.elokeszites.length) o.elokeszites = s.elokeszites;
        o.vanBeosztas = vanBeosztas(s, t);
        return o;
      }),
      // az archivált és a már kilépett kolléga nem látszik; a privát e-mail soha nem kerül ide
      kollegak: t.kollegak.filter(function (k) { return k.archivalt !== true && !(k.aktiv_ig && k.aktiv_ig < F.most().datum); })
        .map(function (k) { return { id: k.id, nev: k.nev, szerep: k.szerep, helyszinek: k.helyszinek, szolgaltatasok: k.szolgaltatasok, foto: k.foto, bemutatkozas: k.bemutatkozas }; }),
      szabalyok: { lemondasOra: t.szabalyok.lemondasOra, minEloreOra: t.szabalyok.minEloreOra, maxEloreNap: t.szabalyok.maxEloreNap, telefon: t.szabalyok.telefon, reggeliHatarOra: szabRH(t), reggeliKezdesElott: szabRK(t) }
    };
  }
  function hivatkozasok(p) {
    var t = T();
    var hely = t.helyszinek.filter(function (h) { return h.id === p.helyszin; })[0];
    if (!hely) throw HttpErr(400, 'Ismeretlen helyszín.');
    var szolg = t.szolgaltatasok.filter(function (s) { return s.id === p.szolgaltatas; })[0];
    if (!szolg || szolg.helyszinek.indexOf(p.helyszin) < 0) throw HttpErr(400, 'Ez a szolgáltatás ezen a helyszínen nem foglalható.');
    if (p.kollega !== 'barki') {
      var koll = t.kollegak.filter(function (k) { return k.id === p.kollega && k.archivalt !== true; })[0];
      if (!koll) throw HttpErr(400, 'Ismeretlen szakember.');
      if (koll.helyszinek.indexOf(p.helyszin) < 0 || koll.szolgaltatasok.indexOf(p.szolgaltatas) < 0) throw HttpErr(400, 'A kiválasztott szakember ezt a szolgáltatást ezen a helyszínen nem végzi.');
    }
    return { hely: hely, szolg: szolg };
  }
  var EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]{2,}$/, TEL_RE = /^[+0-9 ()/.-]{6,24}$/;
  function szoveg(v, max) {
    if (v == null) return '';
    if (typeof v !== 'string') throw HttpErr(400, 'Hibás kérés.');
    var s = v.trim();
    if (s.length > max) throw HttpErr(400, 'Túl hosszú szöveg (legfeljebb ' + max + ' karakter).');
    return s;
  }
  function foglalasBemenet(d, admin) {
    var nev = szoveg(d.nev, 100), email = szoveg(d.email, 254).toLowerCase(), telefon = szoveg(d.telefon, 24), megjegyzes = szoveg(d.megjegyzes, 1000);
    if (nev.length < 2) throw HttpErr(400, 'Kérjük, add meg a neved.');
    if ((!admin || email) && !EMAIL_RE.test(email)) throw HttpErr(400, 'Kérjük, adj meg egy érvényes e-mail-címet.');
    if ((!admin || telefon) && (!TEL_RE.test(telefon) || telefon.replace(/\D/g, '').length < 6)) throw HttpErr(400, 'Kérjük, adj meg egy érvényes telefonszámot.');
    if (!admin && d.hozzajarul !== true) throw HttpErr(400, 'A foglaláshoz el kell fogadnod az adatkezelési tájékoztatót.');
    if (!ervenyesDatum(d.datum)) throw HttpErr(400, 'Hibás dátum.');
    var kezdPerc = hhmmToPerc(d.kezd);
    if (kezdPerc == null) throw HttpErr(400, 'Hibás időpont.');
    var kollega = d.kollega == null || d.kollega === '' ? 'barki' : d.kollega;
    return { helyszin: d.helyszin, szolgaltatas: d.szolgaltatas, kollega: kollega, datum: d.datum, kezdPerc: kezdPerc, nev: nev, email: email, telefon: telefon, megjegyzes: megjegyzes, forras: forrasBemenet(d.forras) };
  }
  function outboxIr(bookingId, levelek) {
    levelek.filter(function (l) { return l.cimzett; }).forEach(function (l) {
      db.outbox.unshift({ id: ++db.seq, booking_id: bookingId, tipus: l.tipus, csoportos: !!l.csoportos, cimzett: l.cimzett, targy: l.targy, html: l.html, szoveg: l.szoveg, ics: l.ics || null, sent: 0, created_at: Date.now() });
    });
    if (db.outbox.length > 100) db.outbox.length = 100;
  }
  // foglalas.js jeloltKollegak: a hézag-kezdés csak a foglalásokkal létezik, ezért a két számítás uniója
  function jeloltKollegak(alap, foglalt, datum, kezd) {
    function keres(f) { return ((szabadIdopontok(Object.assign({}, alap, { foglalt: f })).napok[datum] || []).filter(function (s) { return s.kezd === kezd; })[0] || { kollegak: [] }).kollegak; }
    var most = keres(foglalt), u = most.slice();
    keres([]).forEach(function (k) { if (u.indexOf(k) < 0) u.push(k); });
    return { mind: u, most: most };
  }
  // az admin bármely 15 perces rácspontra vehet fel (a kínálás rá nem vonatkozik), és nincs minEloreOra/maxEloreNap
  function adminTorzs(t) {
    return Object.assign({}, t, { szabalyok: Object.assign({}, t.szabalyok, { minEloreOra: 0, maxEloreNap: 3660 }),
      szolgaltatasok: t.szolgaltatasok.map(function (s) { return Object.assign({}, s, { kinalas: RACS }); }) });
  }
  function foglal(be, admin) {
    var r = hivatkozasok(be), hely = r.hely, szolg = r.szolg, t = T();
    var szT = admin ? adminTorzs(t) : t;
    var kezd = hm(be.kezdPerc);
    var alap = { torzs: szT, helyszin: be.helyszin, szolgaltatas: be.szolgaltatas, kollega: be.kollega, tol: be.datum, ig: be.datum };
    // csak felkínált kezdésre (a rács vagy hézagkitöltés szerint); ha egyik kolléga sem, 409
    var jk = jeloltKollegak(alap, foglaltLista(), be.datum, kezd);
    if (!jk.mind.length) throw HttpErr(409, 'Ez az időpont nem foglalható. Kérjük, válassz a szabad időpontok közül.');
    var beoSz = { kollegak: jk.mind };
    // ütközés-próba: a kért időpontot „közben” elviszi egy másik vendég (mindegyik jelöltnél)
    var utk = false;
    if (!admin) { try { utk = sessionStorage.getItem(FLAG) === '1'; if (utk) sessionStorage.removeItem(FLAG); } catch (e) { /* nincs */ } }
    if (utk) {
      beoSz.kollegak.forEach(function (kid) {
        db.bookings.push(sor({ kollega: kid, datum: be.datum, kezdPerc: be.kezdPerc, szolg: szolg, hely: hely, nev: 'David teszt', email: 'info@clientflow.team', telefon: '+36 30 123 4567', megjegyzes: '', source: 'web' }));
      });
      save();
    }
    var foglalt = foglaltLista();
    var szabadNow = ((szabadIdopontok(Object.assign({}, alap, { foglalt: foglalt })).napok[be.datum] || []).filter(function (s) { return s.kezd === kezd; })[0] || { kollegak: [] }).kollegak;
    var jeloltek = beoSz.kollegak.slice().sort(function (a, b) { return (szabadNow.indexOf(b) >= 0) - (szabadNow.indexOf(a) >= 0); });
    var puffer = szolg.puffer == null ? 10 : szolg.puffer;
    var fs = {}; foglalt.forEach(function (f) { fs[f.kollega + '|' + f.datum + '|' + f.slot] = 1; });
    for (var i = 0; i < jeloltek.length; i++) {
      var kid = jeloltek[i];
      var sl = foglalasSlotjai({ kollega: kid, datum: be.datum, kezd: be.kezdPerc, perc: szolg.perc, puffer: puffer });
      if (sl.some(function (s) { return fs[kid + '|' + s.datum + '|' + s.slot]; })) continue; // UNIQUE slot_locks
      var row = sor({ kollega: kid, datum: be.datum, kezdPerc: be.kezdPerc, szolg: szolg, hely: hely, nev: be.nev, email: be.email, telefon: be.telefon, megjegyzes: be.megjegyzes, source: admin ? 'admin' : 'web' });
      row.forras = be.forras || null;
      var l = linkek(row.token), f = nezet(row);
      var ics = icsKeszit(f, l.lemondasUrl);
      var levelek = [visszaigazolas(f, { lemondasUrl: l.lemondasUrl, icsUrl: l.icsUrl, szabalyok: t.szabalyok, ics: ics })];
      if (!admin) levelek.push(studioErtesito(f, { szabalyok: t.szabalyok }));
      levelek.push(kollegaUj(f, kollegaCim(kid), admin)); // üres címzettnél kimarad
      db.bookings.push(row);
      outboxIr(row.id, levelek);
      save();
      return { azonosito: row.id, lemondasUrl: l.lemondasUrl, ics: l.icsUrl, level: { targy: levelek[0].targy, html: levelek[0].html, szoveg: levelek[0].szoveg }, foglalas: publikusNezet(f) };
    }
    throw HttpErr(409, 'Ezt az időpontot közben lefoglalták. Kérjük, válassz másikat.');
  }
  function sor(o) {
    var id = ujAzonosito();
    return {
      id: id, location_id: o.hely.id, service_id: o.szolg.id, staff_id: o.kollega, date: o.datum, start_min: o.kezdPerc,
      dur_min: o.szolg.perc, buffer_min: o.szolg.puffer == null ? 10 : o.szolg.puffer, price: o.szolg.ar == null ? null : o.szolg.ar,
      name: o.nev, email: o.email, phone: o.telefon, note: o.megjegyzes, status: 'megerositett', source: o.source,
      token: ujToken(id), created_at: o.created || Date.now(), cancelled_at: null
    };
  }
  function tokenFoglalas(tok) {
    var b = db.bookings.filter(function (x) { return x.token && x.token === tok; })[0];
    if (!b) throw HttpErr(404, 'Ez a lemondó link érvénytelen.');
    return b;
  }
  function lemondasAllapot(row) {
    var kezdMs = helyiToUtc(row.date, row.start_min), hat = kezdMs - T().szabalyok.lemondasOra * 3600e3, most = Date.now();
    return { kezdMs: kezdMs, hataridoMs: hat, elmult: kezdMs <= most, lemondhato: row.status === 'megerositett' && most < hat };
  }
  function lemondasInfo(tok) {
    var row = tokenFoglalas(tok), a = lemondasAllapot(row);
    if (a.elmult) throw HttpErr(410, 'Ez az időpont már elmúlt, a link lejárt.');
    return { azonosito: row.id, allapot: row.status, lemondhato: a.lemondhato, modosithato: a.lemondhato, hatarido: new Date(a.hataridoMs).toISOString(), telefon: T().szabalyok.telefon, foglalas: publikusNezet(nezet(row)) };
  }
  // a backend lemond()-ja óta: csak akkor mond le, ha a foglalás még a beolvasott időpontban van
  function lemond(row, admin, latott) {
    var a = lemondasAllapot(row), sz = T().szabalyok;
    if (row.status !== 'megerositett') throw HttpErr(410, 'Ezt a foglalást már lemondták.');
    if (!admin) {
      if (a.elmult) throw HttpErr(410, 'Ez az időpont már elmúlt, a link lejárt.');
      if (!a.lemondhato) throw HttpErr(409, 'A kezdés előtti ' + sz.lemondasOra + ' órán belül a link már nem mond le. Kérjük, hívj minket: ' + sz.telefon + '.', { telefon: sz.telefon });
    }
    if (latott && (latott.staff_id !== row.staff_id || latott.date !== row.date || latott.start_min !== row.start_min)) {
      throw HttpErr(409, 'A foglalást közben módosították. Kérjük, töltsd újra az oldalt.');
    }
    row.status = 'lemondva'; row.cancelled_at = Date.now();
    var nf = nezet(row);
    outboxIr(row.id, [lemondasLevel(nf, { szabalyok: sz }), kollegaLemondas(nf, kollegaCim(row.staff_id), admin), kollegaLemondas(nf, sz.studioEmail, admin)]); save();
    return { azonosito: row.id, allapot: 'lemondva' };
  }

  /* ---------------- módosítás (a backend modosit()-ja) ---------------- */
  function modosithatoAllapot(row, admin) {
    var sz = T().szabalyok, a = lemondasAllapot(row);
    if (row.status !== 'megerositett') throw HttpErr(410, 'Ezt a foglalást már lemondták, nem módosítható.');
    if (a.elmult) throw HttpErr(410, 'Ez az időpont már elmúlt, a link lejárt.');
    if (!admin && !a.lemondhato) throw HttpErr(409, 'A kezdés előtti ' + sz.lemondasOra + ' órán belül a link már nem módosít. Kérjük, hívj minket: ' + sz.telefon + '.', { telefon: sz.telefon });
  }
  function modositasBemenet(d) {
    d = d || {};
    if (!ervenyesDatum(d.datum)) throw HttpErr(400, 'Hibás dátum.');
    var kezdPerc = hhmmToPerc(d.kezd);
    if (kezdPerc == null) throw HttpErr(400, 'Hibás időpont.');
    var kollega = d.kollega == null || d.kollega === '' ? 'barki' : d.kollega;
    if (typeof kollega !== 'string') throw HttpErr(400, 'Hibás kérés.');
    return { datum: d.datum, kezdPerc: kezdPerc, kollega: kollega };
  }
  // a számítás törzse: adminnak nincs minEloreOra/maxEloreNap; a foglaláskor rögzített időtartam és puffer számít
  function szamitasra(admin, row) {
    var t = T();
    if (admin) t = adminTorzs(t);
    if (row) t = Object.assign({}, t, { szolgaltatasok: t.szolgaltatasok.map(function (s) { return s.id === row.service_id ? Object.assign({}, s, { perc: row.dur_min, puffer: row.buffer_min }) : s; }) });
    return t;
  }
  function modosit(row, be, admin) {
    modosithatoAllapot(row, admin);
    hivatkozasok({ helyszin: row.location_id, szolgaltatas: row.service_id, kollega: be.kollega });
    if (be.datum === row.date && be.kezdPerc === row.start_min && (be.kollega === 'barki' || be.kollega === row.staff_id)) throw HttpErr(400, 'Ez a jelenlegi időpontod. Válassz másikat.');
    var t = T(), szT = szamitasra(admin, row), kezd = hm(be.kezdPerc);
    var alap = { torzs: szT, helyszin: row.location_id, szolgaltatas: row.service_id, kollega: be.kollega, tol: be.datum, ig: be.datum };
    var jk = jeloltKollegak(alap, foglaltLista(row.id), be.datum, kezd);
    if (!jk.mind.length) throw HttpErr(409, 'Ez az időpont nem foglalható. Kérjük, válassz a szabad időpontok közül.');
    var beoSz = { kollegak: jk.mind };
    // ütközés-próba: ?utkozes=1 mellett az új időpontot „közben” elviszi valaki (mindegyik jelöltnél)
    var utk = false;
    if (!admin) { try { utk = sessionStorage.getItem(FLAG) === '1'; if (utk) sessionStorage.removeItem(FLAG); } catch (e) { /* nincs */ } }
    if (utk) {
      var r0 = hivatkozasok({ helyszin: row.location_id, szolgaltatas: row.service_id, kollega: 'barki' });
      beoSz.kollegak.forEach(function (kid) {
        db.bookings.push(sor({ kollega: kid, datum: be.datum, kezdPerc: be.kezdPerc, szolg: r0.szolg, hely: r0.hely, nev: 'David teszt', email: 'info@clientflow.team', telefon: '+36 30 123 4567', megjegyzes: '', source: 'web' }));
      });
      save();
    }
    var foglalt = foglaltLista(row.id);
    var szabadNow = ((szabadIdopontok(Object.assign({}, alap, { foglalt: foglalt })).napok[be.datum] || []).filter(function (s) { return s.kezd === kezd; })[0] || { kollegak: [] }).kollegak;
    var jeloltek = beoSz.kollegak.slice().sort(function (a, b) { return (szabadNow.indexOf(b) >= 0) - (szabadNow.indexOf(a) >= 0); });
    var fs = {}; foglalt.forEach(function (f) { fs[f.kollega + '|' + f.datum + '|' + f.slot] = 1; });
    var l = linkek(row.token), regi = nezet(row);
    for (var i = 0; i < jeloltek.length; i++) {
      var kid = jeloltek[i];
      var sl = foglalasSlotjai({ kollega: kid, datum: be.datum, kezd: be.kezdPerc, perc: row.dur_min, puffer: row.buffer_min });
      if (sl.some(function (s) { return fs[kid + '|' + s.datum + '|' + s.slot]; })) continue;
      var regiKid = row.staff_id;
      row.staff_id = kid; row.date = be.datum; row.start_min = be.kezdPerc; row.emlekeztetve_at = null; row.modositva_at = Date.now();
      var f = nezet(row);
      var levelek = [modositasLevel(f, { regi: regi, lemondasUrl: l.lemondasUrl, icsUrl: l.icsUrl, szabalyok: t.szabalyok, ics: icsKeszit(f, l.lemondasUrl) })];
      if (!admin) levelek.push(studioModositas(f, { regi: regi, szabalyok: t.szabalyok }));
      // a kolléga: ugyanannál módosítás; kolléga-cserénél a régi lemondást, az új új foglalást kap
      if (kid === regiKid) levelek.push(kollegaModositas(f, regi, kollegaCim(kid)));
      else levelek.push(kollegaLemondas(regi, kollegaCim(regiKid), admin), kollegaUj(f, kollegaCim(kid), admin));
      outboxIr(row.id, levelek); save();
      return { azonosito: row.id, lemondasUrl: l.lemondasUrl, ics: l.icsUrl, modositva: true, level: { targy: levelek[0].targy, html: levelek[0].html, szoveg: levelek[0].szoveg }, foglalas: publikusNezet(f) };
    }
    throw HttpErr(409, 'Ezt az időpontot közben lefoglalták. Kérjük, válassz másikat.');
  }
  // szabad időpontok módosításhoz: a foglalásból jön a helyszín és a szolgáltatás, a saját ideje szabad
  function szabadModositashoz(row, q, admin) {
    var tol = q.get('tol'), ig = q.get('ig');
    if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw HttpErr(400, 'Hibás dátum-tartomány.');
    if (napok(tol, ig, 15).length > 14) throw HttpErr(400, 'Egyszerre legfeljebb 14 nap kérhető le.');
    modosithatoAllapot(row, admin);
    if ((q.get('helyszin') && q.get('helyszin') !== row.location_id) || (q.get('szolgaltatas') && q.get('szolgaltatas') !== row.service_id)) throw HttpErr(400, 'Módosításkor a helyszín és a szolgáltatás nem változhat.');
    var kollega = q.get('kollega') || 'barki';
    hivatkozasok({ helyszin: row.location_id, szolgaltatas: row.service_id, kollega: kollega });
    return szabadIdopontok({ torzs: szamitasra(admin, row), foglalt: foglaltLista(row.id), helyszin: row.location_id, szolgaltatas: row.service_id, kollega: kollega, tol: tol, ig: ig });
  }
  function csakKinalas(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
    var kk = Object.keys(d);
    if (kk.length !== 1 || kk[0] !== 'kinalas') throw hiba('Itt csak a kinalas mező módosítható.');
  }
  function foglalasId(id) {
    var r = /^F[0-9A-Z]{10}$/.test(String(id || '')) ? db.bookings.filter(function (b) { return b.id === id; })[0] : null;
    if (!r) throw HttpErr(404, 'Nincs ilyen foglalás.');
    return r;
  }

  /* ---------------- admin.js ---------------- */
  var ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
  function hiba(m) { return HttpErr(400, m); }
  /* ---------------- Google Naptár (naptar.js naptarAllapot, naptarUjraszinkron) ----------------
     A böngészőben nincs valódi Google-hívás. A kulcs állapota tesztkapcsoló (a munkamenetben megmarad):
       ?gcal=0       nincs kulcs (alap, ez az élő állapot)        ?gcal=1       be van kötve
       ?gcal=hibas   hibás kulcs (kulcsHiba)                      ?gcal=elakadt be van kötve, 3 tétel vár, 2 elakadt */
  var GCAL_KEY = 'f360-foglalo-mock-gcal', GCAL_FIOK = 'f360-naptar@f360-foglalo.iam.gserviceaccount.com';
  var GCAL_KULCS_HIBA = 'A Google szolgáltatásfiók kulcsa hibás (GOOGLE_SA_KEY): a Google Cloudból letöltött teljes JSON-fájl tartalma kell.';
  (function () {
    var m = /[?&]gcal=(0|1|hibas|elakadt)(&|$)/.exec(location.search);
    if (m) { try { if (m[1] === '0') sessionStorage.removeItem(GCAL_KEY); else sessionStorage.setItem(GCAL_KEY, m[1]); } catch (e) { /* nincs */ } }
  })();
  function gcalMod() { try { return sessionStorage.getItem(GCAL_KEY) || 'nincs'; } catch (e) { return 'nincs'; } }
  function gcalSor() { try { return JSON.parse(sessionStorage.getItem(GCAL_KEY + '-sor') || 'null'); } catch (e) { return null; } }
  function naptarAllapot() {
    var mod = gcalMod(), be = mod === '1' || mod === 'elakadt', t = T();
    var sor = mod === 'elakadt' ? (gcalSor() || { varakozik: 3, elakadt: 2 }) : { varakozik: 0, elakadt: 0 };
    var elsoF = db.bookings.filter(function (b) { return b.status === 'megerositett' && b.date >= F.most().datum; })[0];
    return {
      bekotve: be,
      kulcsHiba: mod === 'hibas' ? GCAL_KULCS_HIBA : null,
      szolgaltatasFiok: be ? GCAL_FIOK : null,
      studioNaptarId: t.szabalyok.studioNaptarId || '',
      kollegak: t.kollegak.filter(function (k) { return k.archivalt !== true; }).map(function (k) { return { id: k.id, nev: k.nev, szin: k.szin, naptar_id: k.naptar_id || '' }; }),
      varakozik: sor.varakozik, elakadt: sor.elakadt,
      utolsoHiba: sor.elakadt ? { azonosito: elsoF ? elsoF.id : 'F0000000001', uzenet: 'A Google Naptár 403-at adott: a naptár nincs megosztva a szolgáltatásfiókkal.', probalkozas: 2, ido: new Date(Date.now() - 18 * 60e3).toISOString() } : null
    };
  }
  function naptarUjraszinkron(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
    Object.keys(d).forEach(function (k) { if (k !== 'mind') throw hiba('Ismeretlen mező: ' + k + '.'); });
    if ('mind' in d && typeof d.mind !== 'boolean') throw hiba('Hibás mező: mind (true vagy false).');
    var mod = gcalMod();
    if (mod === 'hibas') throw HttpErr(409, 'A Google Naptár nincs bekötve: ' + GCAL_KULCS_HIBA);
    if (mod !== '1' && mod !== 'elakadt') throw HttpErr(409, 'A Google Naptár nincs bekötve (hiányzik a GOOGLE_SA_KEY titok).');
    var t = T(), van = {};
    t.kollegak.forEach(function (k) { if (k.naptar_id) van[k.id] = 1; });
    var ma = F.most().datum, n = 0;
    if (d.mind) n = db.bookings.filter(function (b) { return b.status === 'megerositett' && b.date >= ma && (t.szabalyok.studioNaptarId || van[b.staff_id]); }).length;
    var sor = mod === 'elakadt' ? (gcalSor() || { varakozik: 3, elakadt: 2 }) : { varakozik: 0, elakadt: 0 };
    var siker = Math.min(n, 25) + sor.varakozik;
    try { sessionStorage.setItem(GCAL_KEY + '-sor', JSON.stringify({ varakozik: 0, elakadt: 0 })); } catch (e) { /* nincs */ }
    return { bekotve: true, sikeres: siker, hibas: 0, maradt: Math.max(0, n - 25) };
  }
  function str(v, mezo, max, kotelezo) {
    if (v == null || v === '') { if (kotelezo !== false) throw hiba('Hiányzó mező: ' + mezo + '.'); return ''; }
    if (typeof v !== 'string' || v.length > (max || 200)) throw hiba('Hibás mező: ' + mezo + '.');
    return v.trim();
  }
  function egesz(v, mezo, min, max) { if (!Number.isInteger(v) || v < min || v > max) throw hiba('Hibás szám: ' + mezo + ' (' + min + ' és ' + max + ' között).'); return v; }
  function idLista(v, mezo, ismert) {
    if (!Array.isArray(v) || v.some(function (x) { return typeof x !== 'string' || !ismert[x]; })) throw hiba('Hibás hivatkozás: ' + mezo + '.');
    return v.filter(function (x, i) { return v.indexOf(x) === i; });
  }
  function egyediId(lista, mezo) {
    var ids = {};
    lista.forEach(function (x) {
      if (!x || typeof x !== 'object') throw hiba('Hibás elem a listában (' + mezo + ').');
      if (typeof x.id !== 'string' || !ID_RE.test(x.id)) throw hiba('Hibás azonosító (' + mezo + '): csak kisbetű, szám és kötőjel.');
      if (x.id === 'barki') throw hiba('A „barki” azonosító foglalt (' + mezo + ').');
      if (ids[x.id]) throw hiba('Ismétlődő azonosító (' + mezo + '): ' + x.id + '.');
      ids[x.id] = 1;
    });
    return ids;
  }
  function torzsEllenoriz(d) {
    if (!d || typeof d !== 'object') throw hiba('Hibás kérés.');
    ['helyszinek', 'szolgaltatasok', 'kollegak'].forEach(function (k) { if (!Array.isArray(d[k]) || d[k].length > 100) throw hiba('Hiányzó vagy hibás lista: ' + k + '.'); });
    var hIds = egyediId(d.helyszinek, 'helyszín');
    var helyszinek = d.helyszinek.map(function (h) {
      var ny = str(h.nyit, 'nyitás', 5), z = str(h.zar, 'zárás', 5);
      if (hhmmToPerc(ny) == null || hhmmToPerc(z) == null || hhmmToPerc(ny) >= hhmmToPerc(z)) throw hiba('Hibás nyitvatartás: ' + h.id + '.');
      return { id: h.id, nev: str(h.nev, 'név', 100), cim: str(h.cim, 'cím', 200), nyit: ny, zar: z };
    });
    var sIds = egyediId(d.szolgaltatasok, 'szolgáltatás');
    var szolgaltatasok = d.szolgaltatasok.map(function (s) {
      var perc = egesz(s.perc, 'időtartam', 10, 480);
      if (perc % 5 !== 0) throw hiba('Az időtartam 5 perc többszöröse legyen: ' + s.id + '.');
      var ki = { id: s.id, nev: str(s.nev, 'név', 120), perc: perc, ar: s.ar == null ? null : egesz(s.ar, 'ár', 0, 10000000),
        puffer: s.puffer == null ? 10 : egesz(s.puffer, 'puffer', 0, 120), helyszinek: idLista(s.helyszinek, 'szolgáltatás helyszínei', hIds) };
      // a kínált kezdések felülírása: csak ha megadták (null = a globálisat követi, a mentés törli)
      if ('kinalas' in s) ki.kinalas = kinalasSzolgaltatas(s.kinalas, s.id);
      ['leiras', 'elokeszites', 'idotartam_megerositendo'].forEach(function (m) { if (s[m] != null) ki[m] = s[m]; });
      return ki;
    });
    egyediId(d.kollegak, 'kolléga');
    var kollegak = d.kollegak.map(function (k) {
      var szin = null;
      if (k.szin != null && k.szin !== '') { szin = szinNormal(k.szin); if (!szin) throw hiba('Hibás szín (' + k.id + '): #rrggbb alakú hex kell, például #4f6d8a.'); }
      return Object.assign({ id: k.id, szin: szin, nev: str(k.nev, 'név', 100), szerep: str(k.szerep, 'szerep', 200, false),
        helyszinek: idLista(k.helyszinek, 'kolléga helyszínei', hIds), szolgaltatasok: idLista(k.szolgaltatasok, 'kolléga szolgáltatásai', sIds) }, kollegaUjMezok(k));
    });
    var sz = d.szabalyok || {};
    return { minta: d.minta === true, helyszinek: helyszinek, szolgaltatasok: szolgaltatasok, kollegak: kollegak, szabalyok: Object.assign({
      minEloreOra: egesz(sz.minEloreOra, 'minEloreOra', 0, 168), maxEloreNap: egesz(sz.maxEloreNap, 'maxEloreNap', 1, 366),
      lemondasOra: egesz(sz.lemondasOra, 'lemondasOra', 0, 168), telefon: str(sz.telefon, 'telefon', 30), studioEmail: str(sz.studioEmail, 'studioEmail', 254) }, szabalyUjMezok(sz)) };
  }
  /* kolléga létrehozása, módosítása, archiválása (admin.js kollegaLetrehoz / kollegaModosit / kollegaArchival) */
  var KOLLEGA_MEZOK = ['id', 'nev', 'szerep', 'helyszinek', 'szolgaltatasok', 'szin'].concat(KOLLEGA_UJ_MEZOK);
  function nevbolAzonosito(nev) {
    var s = String(nev).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
    return s && s !== 'barki' ? s : 'kollega';
  }
  function kollegaMezok(d, reszleges) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
    Object.keys(d).forEach(function (k) { if (KOLLEGA_MEZOK.indexOf(k) < 0) throw hiba('Ismeretlen mező: ' + k + '.'); });
    var t = T(), hIds = {}, sIds = {}, ki = {};
    t.helyszinek.forEach(function (h) { hIds[h.id] = 1; }); t.szolgaltatasok.forEach(function (s) { sIds[s.id] = 1; });
    if (!reszleges || 'nev' in d) ki.nev = str(d.nev, 'név', 100);
    if ('szerep' in d) ki.szerep = str(d.szerep, 'szerep', 200, false);
    if (!reszleges || 'helyszinek' in d) ki.helyszinek = idLista(d.helyszinek, 'kolléga helyszínei', hIds);
    if (!reszleges || 'szolgaltatasok' in d) ki.szolgaltatasok = idLista(d.szolgaltatasok, 'kolléga szolgáltatásai', sIds);
    if ('szin' in d && d.szin !== '' && d.szin != null) { ki.szin = szinNormal(d.szin); if (!ki.szin) throw hiba('Hibás szín: #rrggbb alakú hex kell, például #4f6d8a.'); }
    return Object.assign(ki, kollegaUjMezok(d));
  }
  function kollegaLetrehoz(d) {
    var t = T(), mezok = kollegaMezok(d, false), id;
    if (d.id != null && d.id !== '') {
      if (typeof d.id !== 'string' || !ID_RE.test(d.id) || d.id === 'barki') throw hiba('Hibás azonosító: csak kisbetű, szám és kötőjel.');
      if (t.kollegak.some(function (k) { return k.id === d.id; })) throw HttpErr(409, 'Ilyen azonosítójú kolléga már van.');
      id = d.id;
    } else {
      var alap = nevbolAzonosito(mezok.nev); id = alap;
      for (var i = 2; t.kollegak.some(function (k) { return k.id === id; }); i++) id = alap + '-' + i;
    }
    var uj = kollegaAlap(Object.assign({ id: id, szerep: '' }, mezok));
    aktivSorrend(uj);
    db.torzs.kollegak = szinKioszt(t.kollegak.concat([uj])); save();
    return db.torzs.kollegak[db.torzs.kollegak.length - 1];
  }
  function kollegaModosit(id, d) {
    var t = T(), regi = t.kollegak.filter(function (k) { return k.id === id; })[0];
    if (!regi) throw HttpErr(404, 'Ismeretlen szakember.');
    if (d && typeof d === 'object' && 'id' in d) throw hiba('Az azonosító nem módosítható.');
    var uj = kollegaAlap(Object.assign({}, regi, kollegaMezok(d, true)));
    aktivSorrend(uj);
    szukitesOr([regi], [uj]);
    db.torzs.kollegak = szinKioszt(t.kollegak.map(function (k) { return k.id === id ? uj : k; })); save();
    return db.torzs.kollegak.filter(function (k) { return k.id === id; })[0];
  }
  function kiBeosztas(b) { return { nap: b.nap, helyszin: b.helyszin, kezd: hm(b.kezd), veg: hm(b.veg) }; }
  function beosztasLekerd(kid) {
    if (!kid) return { kollegak: T().kollegak.map(function (k) { return { id: k.id, nev: k.nev, szin: k.szin, sorok: db.beosztas.filter(function (b) { return b.kollega === k.id; }).map(kiBeosztas) }; }) };
    if (!T().kollegak.some(function (k) { return k.id === kid; })) throw hiba('Ismeretlen szakember.');
    return { kollega: kid, sorok: db.beosztas.filter(function (b) { return b.kollega === kid; }).sort(function (a, b) { return a.nap - b.nap || a.kezd - b.kezd; }).map(kiBeosztas) };
  }
  function beosztasMent(kid, d) {
    var k = T().kollegak.filter(function (x) { return x.id === kid; })[0];
    if (!k) throw hiba('Ismeretlen szakember.');
    if (!d || !Array.isArray(d.sorok) || d.sorok.length > 50) throw hiba('Hiányzó vagy hibás lista: sorok.');
    var sorok = d.sorok.map(function (s) {
      var nap = egesz(s && s.nap, 'nap (1 = hétfő, 7 = vasárnap)', 1, 7);
      if (k.helyszinek.indexOf(s.helyszin) < 0) throw hiba('A szakember ezen a helyszínen nem dolgozik.');
      var kz = hhmmToPerc(s.kezd), v = s.veg === '24:00' ? 1440 : hhmmToPerc(s.veg);
      if (kz == null || v == null || kz >= v) throw hiba('Hibás idősáv (HH:MM, 15 perces lépésben, a kezdés a vég előtt).');
      return { kollega: kid, nap: nap, helyszin: s.helyszin, kezd: kz, veg: v };
    });
    sorok.forEach(function (a) { sorok.forEach(function (b) { if (a !== b && a.nap === b.nap && a.kezd < b.veg && b.kezd < a.veg) throw hiba('Egy napon belül átfedő idősávok.'); }); });
    db.beosztas = db.beosztas.filter(function (b) { return b.kollega !== kid; }).concat(sorok);
    save();
    return { kollega: kid, sorok: sorok.map(kiBeosztas) };
  }
  function kiKivetel(k) { return { id: k.id, kollega: k.kollega, helyszin: k.helyszin, tol: k.tol, ig: k.ig, kezd: k.kezd == null ? null : hm(k.kezd), veg: k.veg == null ? null : hm(k.veg), megjegyzes: k.megjegyzes }; }
  function kivetelFelvesz(d) {
    var t = T(), kollega = d.kollega || null, helyszin = d.helyszin || null;
    if (!kollega && !helyszin) throw hiba('Add meg a szakembert vagy a helyszínt (vagy mindkettőt).');
    if (kollega && !t.kollegak.some(function (k) { return k.id === kollega; })) throw hiba('Ismeretlen szakember.');
    if (helyszin && !t.helyszinek.some(function (h) { return h.id === helyszin; })) throw hiba('Ismeretlen helyszín.');
    if (!ervenyesDatum(d.tol) || !ervenyesDatum(d.ig) || d.ig < d.tol) throw hiba('Hibás dátum-tartomány.');
    var kz = null, v = null;
    if (d.kezd != null || d.veg != null) {
      kz = hhmmToPerc(d.kezd); v = d.veg === '24:00' ? 1440 : hhmmToPerc(d.veg);
      if (kz == null || v == null || kz >= v) throw hiba('Hibás idősáv (HH:MM, 15 perces lépésben).');
    }
    var rec = { id: crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }),
      kollega: kollega, helyszin: helyszin, tol: d.tol, ig: d.ig, kezd: kz, veg: v, megjegyzes: str(d.megjegyzes, 'megjegyzés', 300, false) };
    db.kivetelek.push(rec); save();
    return kiKivetel(rec);
  }
  function foglalasLista(q) {
    var ma = F.most().datum, tol = q.get('tol') || ma, ig = q.get('ig') || F.addDays(tol, 6);
    if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw hiba('Hibás dátum-tartomány.');
    if (napok(tol, ig, 93).length > 92) throw hiba('Egyszerre legfeljebb 92 nap kérhető le.');
    var fh = q.get('helyszin'), fk = q.get('kollega'), fa = q.get('allapot');
    return { tol: tol, ig: ig, foglalasok: db.bookings.filter(function (b) {
      return b.date >= tol && b.date <= ig && (!fh || b.location_id === fh) && (!fk || b.staff_id === fk) && (!fa || b.status === fa);
    }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.start_min - b.start_min || a.staff_id.localeCompare(b.staff_id); }).map(function (r) {
      var f = nezet(r); delete f.kezdPerc;
      f.kampany = r.forras || null;
      f.sorozat = sorozatJel(r);
      f.letrehozva = new Date(r.created_at).toISOString(); f.lemondva = r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null;
      return f;
    }) };
  }

  /* ---------------- minta-foglalások, hogy a naptár élő legyen ---------------- */
  // minden kitalált foglaló neve „David teszt” (David kérése, 2026-10-01); a minta így nem mutat valódinak látszó személyt
  function prng(s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function seed() {
    var ma = F.most().datum;
    db = { v: 3, seq: 0, torzs: torzsAlap(seedTorzs()), beosztas: seedBeosztas(), kivetelek: [], bookings: [], outbox: [], orak: null };
    // minta-kivételek: nemzeti ünnep (mindkét helyszín), egy szabadság, egy délutáni továbbképzés
    var ev = ma.slice(0, 4), okt23 = ev + '-10-23';
    if (okt23 >= ma) {
      db.kivetelek.push({ id: '00000000-0000-4000-8000-000000000001', kollega: null, helyszin: 'mexikoi', tol: okt23, ig: okt23, kezd: null, veg: null, megjegyzes: 'Nemzeti ünnep, zárva' });
      db.kivetelek.push({ id: '00000000-0000-4000-8000-000000000002', kollega: null, helyszin: 'reitter', tol: okt23, ig: okt23, kezd: null, veg: null, megjegyzes: 'Nemzeti ünnep, zárva' });
    }
    var hh = F.hetfo(F.addDays(ma, 14));
    db.kivetelek.push({ id: '00000000-0000-4000-8000-000000000003', kollega: 'vas-luca', helyszin: null, tol: F.addDays(hh, 2), ig: F.addDays(hh, 4), kezd: null, veg: null, megjegyzes: 'Szabadság' });
    db.kivetelek.push({ id: '00000000-0000-4000-8000-000000000004', kollega: 'adorjani-anna', helyszin: null, tol: F.addDays(hh, 7), ig: F.addDays(hh, 7), kezd: 480, veg: 720, megjegyzes: 'Továbbképzés' });
    var r = prng(20260928), t = T(), created = Date.now() - 5 * 864e5;
    for (var i = -7; i <= 24; i++) {
      var d = F.addDays(ma, i), nap = hetNapja(d);
      db.beosztas.filter(function (b) { return b.nap === nap; }).forEach(function (b) {
        var k = t.kollegak.filter(function (x) { return x.id === b.kollega; })[0];
        var tt = b.kezd;
        while (tt < b.veg) {
          var lehet = k.szolgaltatasok.map(function (id) { return t.szolgaltatasok.filter(function (s) { return s.id === id; })[0]; })
            .filter(function (s) { return s && s.helyszinek.indexOf(b.helyszin) >= 0 && tt + s.perc <= b.veg; });
          if (!lehet.length) break;
          var s = lehet[Math.floor(r() * lehet.length)];
          var tel = i < 0 ? 0.7 : i < 3 ? 0.6 : i < 10 ? 0.4 : 0.18;
          var ok = r() < tel && !kivetelUtkozik(db.kivetelek, { kollega: k.id, helyszin: b.helyszin, datum: d, kezd: tt, veg: tt + s.perc });
          if (ok && (i !== 0 || helyiToUtc(d, tt) < Date.now() || helyiToUtc(d, tt) > Date.now() + 3 * 3600e3)) {
            r(); r(); // a korábbi névválasztás két húzása: a minta-eloszlás (és a rá épülő tesztek) változatlan
            var rec = sor({ kollega: k.id, datum: d, kezdPerc: tt, szolg: s, hely: t.helyszinek.filter(function (h) { return h.id === b.helyszin; })[0],
              nev: 'David teszt', email: 'info@clientflow.team',
              telefon: '+36 ' + (r() < 0.5 ? '30' : '70') + ' ' + (100 + Math.floor(r() * 900)) + ' ' + (1000 + Math.floor(r() * 9000)),
              megjegyzes: r() < 0.12 ? 'Térdműtét után, második alkalom.' : '', source: r() < 0.25 ? 'admin' : 'web', created: created + Math.floor(r() * 4 * 864e5) });
            if (r() < 0.06) { rec.status = 'lemondva'; rec.cancelled_at = rec.created_at + 864e5; }
            // minta-kampányforrás a webes foglalások egy részén (a Kampányok fül ne legyen üres)
            if (rec.source === 'web') {
              var fr = r();
              if (fr < 0.28) rec.forras = { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'osz-gyogytorna', utm_content: 'video-1', fbclid: 'IwAR' + Math.floor(r() * 1e9) };
              else if (fr < 0.4) rec.forras = { utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'osz-gyogytorna', utm_content: 'kep-2' };
              else if (fr < 0.55) rec.forras = { gclid: 'Cj0K' + Math.floor(r() * 1e9), landing: ORIGIN + '/masszazs' };
              else if (fr < 0.62) rec.forras = { utm_source: 'hirlevel', utm_medium: 'email', utm_campaign: 'szeptemberi-hirlevel' };
              else if (fr < 0.72) rec.forras = { referrer: 'https://www.google.com/' };
            }
            db.bookings.push(rec);
            tt += Math.ceil((s.perc + s.puffer) / RACS) * RACS;
          } else {
            tt += RACS * (1 + Math.floor(r() * 4));
          }
        }
      });
    }
    // a Levelek fül ne legyen üres: az utolsó két jövőbeli webes foglalás levelei
    db.bookings.filter(function (b) { return b.source === 'web' && b.date > ma && b.status === 'megerositett'; }).slice(-2).forEach(function (row) {
      var l = linkek(row.token), f = nezet(row);
      outboxIr(row.id, [visszaigazolas(f, { lemondasUrl: l.lemondasUrl, icsUrl: l.icsUrl, szabalyok: t.szabalyok, ics: icsKeszit(f, l.lemondasUrl) }), studioErtesito(f, { szabalyok: t.szabalyok })]);
    });
    save();
  }

  /* =====================================================================
     CSOPORTOS ÓRÁK (functions/_lib/booking/orak.js, orak-seed.js, levelek-csoportos.js)
     óratípus → heti sablon → konkrét óra (session, „S…”) → jelentkezés („C…”, a token is C-vel kezdődik)
     ===================================================================== */
  var ORA_HETEK = 8, ORA_MAX_NAP = 14;
  var SESSION_RE = /^S[0-9A-Z]{10}$/, CSOPORTOS_RE = /^C[0-9A-Z]{10}$/;
  var KATEGORIAK = ['joga', 'pilates', 'aerial', 'core', 'gerinc', 'egyeb'];
  function oraTipusSeed() {
    function t(id, nev, kat, perc, ar, arM) { return { id: id, nev: nev, kategoria: kat, perc: perc, ar: ar, helyszin: 'mexikoi', kapacitas: kat === 'aerial' ? 6 : 8, kapacitas_megerositendo: true, ar_megerositendo: !!arM, leiras: '', aktiv: true }; }
    return [
      t('csiponyito-joga', 'Csípőnyitó jóga', 'joga', 60, 4000, 1), t('aerial-yoga-trapeze', 'Aerial yoga trapeze', 'aerial', 60, 4700),
      t('core-trening', 'Core tréning', 'core', 60, 4000), t('slow-flow', 'Slow Flow', 'joga', 60, 4000, 1), t('pilates', 'Pilates', 'pilates', 60, 4000),
      t('gerinctorna', 'Gerinctorna', 'gerinc', 60, 4000, 1), t('gyertyafenyes-gerincjoga', 'Gyertyafényes gerincjóga', 'joga', 60, 4000, 1),
      t('yin-joga', 'Yin jóga', 'joga', 90, 4000), t('funkcionalis-trening', 'Funkcionális tréning', 'egyeb', 60, 4000), t('hatha-joga', 'Hatha jóga', 'joga', 60, 4000),
      t('aerial-slow-flow', 'Aerial slow flow', 'aerial', 60, 4700), t('gyerek-core-trening', 'Gyerek core tréning', 'core', 45, 4000, 1)
    ];
  }
  function oraSablonSeed() {
    function s(ora, nap, kezd, k) { return { id: ora + '-' + nap + '-' + kezd.replace(':', ''), ora: ora, nap: nap, kezd: F.perc(kezd), kollega: k, ervenyes_tol: '', ervenyes_ig: '' }; }
    return [
      s('csiponyito-joga', 1, '09:00', 'aczel-gabriella'), s('gyerek-core-trening', 1, '17:00', 'vas-luca'), s('aerial-yoga-trapeze', 1, '18:15', 'barkoczy-barbara'),
      s('core-trening', 2, '07:30', 'vas-luca'), s('slow-flow', 2, '19:30', 'barkoczy-barbara'), s('pilates', 3, '09:30', 'vas-luca'),
      s('gerinctorna', 3, '17:00', 'vas-luca'), s('gyertyafenyes-gerincjoga', 3, '20:00', 'aczel-gabriella'), s('yin-joga', 4, '10:00', 'aczel-gabriella'),
      s('funkcionalis-trening', 4, '17:00', null), s('hatha-joga', 5, '09:00', 'aczel-gabriella'), s('aerial-yoga-trapeze', 5, '18:15', 'barkoczy-barbara'),
      s('aerial-slow-flow', 6, '10:00', 'barkoczy-barbara')
    ];
  }
  function ujId(elo) { return elo + rnd(10).map(function (x) { return ID_ABC[x & 31]; }).join(''); }
  function O() {
    if (!db.orak) { db.orak = { tipusok: oraTipusSeed(), sablonok: oraSablonSeed(), sessions: [], foglalasok: [], generalva: '' }; oraGeneral(); oraMintaJelentkezok(); save(); }
    if (db.orak.generalva !== F.most().datum) { oraGeneral(); save(); }
    return db.orak;
  }
  function tipusOf(id) { return db.orak.tipusok.filter(function (t) { return t.id === id; })[0]; }
  function oraGeneral(hetek) {
    var o = db.orak, ma = F.most().datum, most = Date.now(), n = 0;
    napok(ma, F.addDays(ma, (hetek || ORA_HETEK) * 7 - 1), 400).forEach(function (d) {
      var nap = hetNapja(d);
      o.sablonok.forEach(function (s) {
        var t = tipusOf(s.ora);
        if (!t || !t.aktiv || s.nap !== nap) return;
        if (s.ervenyes_tol && d < s.ervenyes_tol) return;
        if (s.ervenyes_ig && d > s.ervenyes_ig) return;
        if (helyiToUtc(d, s.kezd) <= most) return;
        if (o.sessions.some(function (x) { return x.tipus === s.ora && x.datum === d && x.kezd === s.kezd; })) return; // UNIQUE
        o.sessions.push({ id: ujId('S'), tipus: s.ora, kollega: s.kollega || null, datum: d, kezd: s.kezd, perc: t.perc, kapacitas: t.kapacitas, status: 'aktiv', megjegyzes: '', sablon: s.id, created: most });
        n++;
      });
    });
    o.generalva = ma;
    return { letrehozva: n, hetek: hetek || ORA_HETEK };
  }
  // bemutatóhoz: néhány jelentkező (mind „David teszt”), a következő hétfői aerial óra betelt
  function oraMintaJelentkezok() {
    var o = db.orak, r = prng(20261001), hetfo = F.hetfo(F.addDays(F.most().datum, 7));
    o.sessions.filter(function (x) { return x.datum <= F.addDays(F.most().datum, 13); }).forEach(function (x, i) {
      var tele = x.tipus === 'aerial-yoga-trapeze' && x.datum === hetfo;
      var db_ = tele ? x.kapacitas : Math.floor(r() * (x.kapacitas - 1));
      for (var j = 0; j < db_; j++) {
        var id = ujId('C');
        o.foglalasok.push({ id: id, session: x.id, nev: 'David teszt', email: 'david.teszt+' + i + '-' + j + '@example.com', telefon: '+36 30 123 4567', megjegyzes: '', ar: tipusOf(x.tipus).ar,
          status: 'megerositett', rogzites: r() < 0.2 ? 'admin' : 'web', forras: null, token: ujToken(id), created_at: Date.now() - 3 * 864e5, lemondva_at: null, emlekeztetve_at: null });
      }
    });
  }
  function foglaltDb(sid) { return db.orak.foglalasok.filter(function (b) { return b.session === sid && b.status === 'megerositett'; }).length; }
  function oraHatarido(datum, kezd, sz) {
    var normal = helyiToUtc(datum, kezd) - (sz.minEloreOra == null ? 2 : sz.minEloreOra) * 3600e3;
    if (kezd < (sz.reggeliKezdesElott == null ? 10 : sz.reggeliKezdesElott) * 60) return Math.min(normal, helyiToUtc(F.addDays(datum, -1), (sz.reggeliHatarOra == null ? 22 : sz.reggeliHatarOra) * 60));
    return normal;
  }
  function oraKollega(id) {
    if (!id) return null;
    var k = T().kollegak.filter(function (x) { return x.id === id; })[0];
    return k ? { id: k.id, nev: k.nev, szerep: k.szerep || '', foto: k.foto || '' } : null;
  }
  function oraHely(id) { var h = T().helyszinek.filter(function (x) { return x.id === id; })[0] || { id: id, nev: id, cim: '' }; return { id: h.id, nev: h.nev, cim: h.cim }; }
  function oraNezet(x, most) {
    var t = tipusOf(x.tipus) || { nev: x.tipus, kategoria: 'egyeb', ar: null, leiras: '', helyszin: 'mexikoi' };
    var sz = T().szabalyok, hat = oraHatarido(x.datum, x.kezd, sz), foglalt = foglaltDb(x.id), szabad = Math.max(0, x.kapacitas - foglalt), ok = null;
    if (x.status === 'elmarad') ok = 'elmarad';
    else if (helyiToUtc(x.datum, x.kezd) <= most) ok = 'mult';
    else if (most >= hat) ok = 'hatarido';
    else if (szabad <= 0) ok = 'betelt';
    return { id: x.id, ora: { id: x.tipus, nev: t.nev, kategoria: t.kategoria, perc: x.perc, ar: t.ar, leiras: t.leiras || '' }, kollega: oraKollega(x.kollega), helyszin: oraHely(t.helyszin),
      datum: x.datum, kezd: hm(x.kezd), veg: hm(x.kezd + x.perc), kapacitas: x.kapacitas, szabad: szabad, status: x.status, megjegyzes: x.megjegyzes || '',
      hatarido: new Date(hat).toISOString(), foglalhato: ok === null, ok: ok };
  }
  function sessionOf(id) {
    if (!SESSION_RE.test(String(id || ''))) throw HttpErr(400, 'Hibás óra-azonosító.');
    var x = O().sessions.filter(function (s) { return s.id === id; })[0];
    if (!x) throw HttpErr(404, 'Nincs ilyen óra.');
    return x;
  }
  function oraLista(q, admin) {
    O();
    var tol = q.get('tol'), ig = q.get('ig'), max = admin ? 92 : ORA_MAX_NAP, most = Date.now();
    if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw HttpErr(400, 'Hibás dátum-tartomány.');
    if (napok(tol, ig, max + 1).length > max) throw HttpErr(400, 'Egyszerre legfeljebb ' + max + ' nap kérhető le.');
    var hely = q.get('helyszin');
    if (hely && !T().helyszinek.some(function (h) { return h.id === hely; })) throw HttpErr(400, 'Ismeretlen helyszín.');
    var orak = db.orak.sessions.filter(function (x) {
      var t = tipusOf(x.tipus);
      return x.datum >= tol && x.datum <= ig && t && (!hely || t.helyszin === hely) && (admin || t.aktiv);
    }).sort(function (a, b) { return a.datum.localeCompare(b.datum) || a.kezd - b.kezd || tipusOf(a.tipus).nev.localeCompare(tipusOf(b.tipus).nev); }).map(function (x) {
      var n = oraNezet(x, most);
      if (!admin) return n;
      var k = T().kollegak.filter(function (y) { return y.id === x.kollega; })[0];
      return Object.assign({}, n, { foglalt: foglaltDb(x.id), sablon: x.sablon, kollega: n.kollega && Object.assign({}, n.kollega, { szin: k && k.szin }) });
    });
    var sz = T().szabalyok;
    return { tol: tol, ig: ig, orak: orak, szabalyok: { telefon: sz.telefon, lemondasOra: sz.lemondasOra } };
  }
  /* ---- a jelentkezés nézete (cf) és a levelek (levelek-csoportos.js) ---- */
  function cfNezet(b) {
    var x = db.orak.sessions.filter(function (s) { return s.id === b.session; })[0], t = tipusOf(x.tipus);
    return { azonosito: b.id, allapot: b.status, oraAllapot: x.status, session: x.id, nev: b.nev, email: b.email, telefon: b.telefon, megjegyzes: b.megjegyzes,
      datum: x.datum, kezd: hm(x.kezd), veg: hm(x.kezd + x.perc), kezdPerc: x.kezd, ora: { id: t.id, nev: t.nev, perc: x.perc, ar: b.ar, kategoria: t.kategoria },
      kollega: oraKollega(x.kollega), helyszin: oraHely(t.helyszin) };
  }
  function oraPublikus(cf) {
    return { tipus: 'csoportos', azonosito: cf.azonosito, allapot: cf.allapot, oraAllapot: cf.oraAllapot, ora: cf.ora, session: cf.session,
      kollega: cf.kollega && { id: cf.kollega.id, nev: cf.kollega.nev }, helyszin: cf.helyszin, datum: cf.datum, kezd: cf.kezd, veg: cf.veg, nev: cf.nev };
  }
  function cfIcs(cf) { return { azonosito: cf.azonosito, datum: cf.datum, kezdPerc: cf.kezdPerc, kezd: cf.kezd, helyszin: cf.helyszin, szolgaltatas: { nev: cf.ora.nev, perc: cf.ora.perc }, kollega: { nev: (cf.kollega && cf.kollega.nev) || 'Studio F360' } }; }
  function oraSorok(cf) {
    return [['Időpont', idopontSz(cf)], ['Óra', cf.ora.nev + ' (' + cf.ora.perc + ' perc)'], ['Oktató', cf.kollega ? cf.kollega.nev : ''], ['Helyszín', cf.helyszin.nev + ', ' + cf.helyszin.cim],
      ['Ár', cf.ora.ar != null ? ft(cf.ora.ar) + ', a helyszínen fizetendő' : ''], ['Azonosító', cf.azonosito]];
  }
  var ZARAS_H = '<p>Várunk szeretettel,<br>a Studio F360 csapata</p>', ZARAS_SZ = 'Várunk szeretettel,\na Studio F360 csapata\n';
  function oKezeloH(u, sz) { return '<p>Ha mégsem tudsz jönni, vagy másik órára mennél, a kezdés előtt ' + sz.lemondasOra + ' óráig itt lemondhatod vagy áthelyezheted:</p>' + gomb(u, KEZELO_GOMB) + '<p>Ha lemondasz, a helyed felszabadul, és más jelentkezhet az órára. ' + sz.lemondasOra + ' órán belül telefonon tudunk segíteni: ' + esc(sz.telefon) + '.</p>'; }
  function oKezeloSz(u, sz) { return 'Ha mégsem tudsz jönni, vagy másik órára mennél, a kezdés előtt ' + sz.lemondasOra + ' óráig itt lemondhatod vagy áthelyezheted (' + KEZELO_GOMB + '):\n' + u + '\n\nHa lemondasz, a helyed felszabadul, és más jelentkezhet az órára. ' + sz.lemondasOra + ' órán belül telefonon tudunk segíteni: ' + sz.telefon + '.'; }
  function oraVisszaigazolas(cf, o) {
    var targy = 'Jelentkezés visszaigazolása · ' + cf.ora.nev + ' · ' + szepDatum(cf.datum) + ' ' + cf.kezd + ' · Studio F360', bev = 'Köszönjük a jelentkezésedet, a helyedet lefoglaltuk az órára.';
    var g = F.googleNaptarUrl(cfIcs(cf), o.lemondasUrl), erk = 'Kérjük, pár perccel a kezdés előtt érkezz, hogy nyugodtan át tudj öltözni.';
    return { tipus: 'visszaigazolas', csoportos: true, cimzett: cf.email, targy: targy, ics: o.ics,
      html: keret(targy, '<p>Kedves ' + esc(cf.nev) + '!</p><p>' + bev + '</p>' + ktabla(oraSorok(cf)) + '<p>' + erk + '</p>' + naptarHtml(o.icsUrl, g) + oKezeloH(o.lemondasUrl, o.szabalyok) + ZARAS_H),
      szoveg: 'Kedves ' + cf.nev + '!\n\n' + bev + '\n\n' + kszoveg(oraSorok(cf)) + '\n\n' + erk + '\n\n' + naptarSzoveg(o.icsUrl, g) + '\n\n' + oKezeloSz(o.lemondasUrl, o.szabalyok) + '\n\n' + ZARAS_SZ };
  }
  function oraAthelyezesLevel(cf, o) {
    var regiSz = o.regi.ora.nev + ', ' + szepDatum(o.regi.datum) + ' ' + o.regi.kezd, targy = 'Óra áthelyezve · ' + cf.ora.nev + ' · ' + szepDatum(cf.datum) + ' ' + cf.kezd + ' · Studio F360';
    var bev = 'A jelentkezésedet áthelyeztük. A korábbi óra (' + regiSz + ') már nem érvényes, az új:', g = F.googleNaptarUrl(cfIcs(cf), o.lemondasUrl);
    return { tipus: 'modositas', csoportos: true, cimzett: cf.email, targy: targy, ics: o.ics,
      html: keret(targy, '<p>Kedves ' + esc(cf.nev) + '!</p><p>' + esc(bev) + '</p>' + ktabla(oraSorok(cf)) + naptarHtml(o.icsUrl, g) + '<p>Ha a naptáradban a korábbi óra is szerepel, azt töröld.</p>' + oKezeloH(o.lemondasUrl, o.szabalyok) + ZARAS_H),
      szoveg: 'Kedves ' + cf.nev + '!\n\n' + bev + '\n\n' + kszoveg(oraSorok(cf)) + '\n\n' + naptarSzoveg(o.icsUrl, g) + '\nHa a naptáradban a korábbi óra is szerepel, azt töröld.\n\n' + oKezeloSz(o.lemondasUrl, o.szabalyok) + '\n\n' + ZARAS_SZ };
  }
  function oraLemondasLevel(cf, sz) {
    var targy = 'Jelentkezés lemondva · ' + cf.ora.nev + ' · ' + szepDatum(cf.datum) + ' ' + cf.kezd + ' · Studio F360', bev = 'Az alábbi órára szóló jelentkezésedet lemondtuk, a helyed felszabadult.';
    var vege = 'Ha másik órára jelentkeznél, a weboldalon megteheted, vagy hívj minket: ' + sz.telefon + '.';
    return { tipus: 'lemondas', csoportos: true, cimzett: cf.email, targy: targy,
      html: keret(targy, '<p>Kedves ' + esc(cf.nev) + '!</p><p>' + bev + '</p>' + ktabla(oraSorok(cf)) + '<p>' + esc(vege) + '</p><p>Üdvözlettel,<br>a Studio F360 csapata</p>'),
      szoveg: 'Kedves ' + cf.nev + '!\n\n' + bev + '\n\n' + kszoveg(oraSorok(cf)) + '\n\n' + vege + '\n\nÜdvözlettel,\na Studio F360 csapata\n' };
  }
  function oraElmaradLevel(cf, sz, ok) {
    var targy = 'Az óra elmarad · ' + cf.ora.nev + ' · ' + szepDatum(cf.datum) + ' ' + cf.kezd + ' · Studio F360', bev = 'Sajnos az alábbi óra elmarad. Elnézést kérünk a kellemetlenségért.';
    var vege = 'Másik órára a weboldalon jelentkezhetsz, vagy hívj minket: ' + sz.telefon + '.', sorok = oraSorok(cf).filter(function (r) { return r[0] !== 'Ár'; });
    return { tipus: 'ora-elmarad', csoportos: true, cimzett: cf.email, targy: targy,
      html: keret(targy, '<p>Kedves ' + esc(cf.nev) + '!</p><p>' + bev + '</p>' + (ok ? '<p>' + esc(ok) + '</p>' : '') + ktabla(sorok) + '<p>' + esc(vege) + '</p><p>Üdvözlettel,<br>a Studio F360 csapata</p>'),
      szoveg: 'Kedves ' + cf.nev + '!\n\n' + bev + '\n' + (ok ? ok + '\n' : '') + '\n' + kszoveg(sorok) + '\n\n' + vege + '\n\nÜdvözlettel,\na Studio F360 csapata\n' };
  }
  function oktatoErtesito(cf, cimzett, uj, allapot, admin) {
    var targy = (uj ? 'Új jelentkezés' : 'Lemondott jelentkezés') + ' · ' + cf.ora.nev + ' · ' + szepDatum(cf.datum) + ' ' + cf.kezd;
    var bev = uj ? (admin ? 'Új résztvevőt vettek fel az órádra az adminban.' : 'Új jelentkezés érkezett az órádra a weboldalról.') : (admin ? 'Az adminban lemondták egy résztvevő jelentkezését az órádra.' : 'Egy résztvevő lemondta a jelentkezését az órádra.');
    var sorok = [['Időpont', idopontSz(cf)], ['Óra', cf.ora.nev + ' (' + cf.ora.perc + ' perc)'], ['Helyszín', cf.helyszin.nev + ', ' + cf.helyszin.cim], ['Résztvevő', cf.nev], ['E-mail', cf.email], ['Telefon', cf.telefon], ['Megjegyzés', cf.megjegyzes],
      ['Létszám', allapot.foglalt + ' / ' + allapot.kapacitas + ' hely foglalt'], ['Azonosító', cf.azonosito]];
    return { tipus: uj ? 'kollega-uj' : 'kollega-lemondas', csoportos: true, cimzett: cimzett, targy: targy, html: keret(targy, '<p>' + esc(bev) + '</p>' + ktabla(sorok)), szoveg: bev + '\n\n' + kszoveg(sorok) + '\n' };
  }
  /* ---- jelentkezés, lemondás, áthelyezés ---- */
  function hataridoHiba(x) {
    var sz = T().szabalyok, reggeli = x.kezd < szabRK(T()) * 60;
    var sv = reggeli ? 'A reggeli órákra az előző este ' + ('0' + szabRH(T())).slice(-2) + ':00-ig beérkezett foglalásokat tudjuk jóváhagyni.' : 'Erre az órára a kezdés előtt ' + (sz.minEloreOra == null ? 2 : sz.minEloreOra) + ' órával lezárult a jelentkezés.';
    return HttpErr(409, sv + ' Kérjük, hívj minket: ' + sz.telefon + '.', { kod: 'hatarido', telefon: sz.telefon });
  }
  function betelt() { return HttpErr(409, 'Betelt: erre az órára már nincs szabad hely. Kérjük, válassz másik órát.', { kod: 'betelt' }); }
  function foglalhatoE(x, admin) {
    var t = tipusOf(x.tipus), most = Date.now();
    if (x.status === 'elmarad') throw HttpErr(409, 'Ez az óra elmarad. Kérjük, válassz másikat.', { kod: 'elmarad' });
    if (!admin && !t.aktiv) throw HttpErr(404, 'Nincs ilyen óra.');
    if (helyiToUtc(x.datum, x.kezd) <= most) throw HttpErr(409, 'Ez az óra már elkezdődött vagy elmúlt.', { kod: 'mult' });
    if (!admin && most >= oraHatarido(x.datum, x.kezd, T().szabalyok)) throw hataridoHiba(x);
    if (foglaltDb(x.id) >= x.kapacitas) throw betelt();
  }
  function ugyfelBemenet(d, admin) {
    var nev = szoveg(d.nev, 100), email = szoveg(d.email, 254).toLowerCase(), telefon = szoveg(d.telefon, 24), megjegyzes = szoveg(d.megjegyzes, 1000);
    if (nev.length < 2) throw HttpErr(400, 'Kérjük, add meg a neved.');
    if ((!admin || email) && !EMAIL_RE.test(email)) throw HttpErr(400, 'Kérjük, adj meg egy érvényes e-mail-címet.');
    if ((!admin || telefon) && (!TEL_RE.test(telefon) || telefon.replace(/\D/g, '').length < 6)) throw HttpErr(400, 'Kérjük, adj meg egy érvényes telefonszámot.');
    if (!admin && d.hozzajarul !== true) throw HttpErr(400, 'A foglaláshoz el kell fogadnod az adatkezelési tájékoztatót.');
    return { nev: nev, email: email, telefon: telefon, megjegyzes: megjegyzes, forras: forrasBemenet(d.forras) };
  }
  function oraBemenet(d) {
    if (typeof d.ora !== 'string' || !d.ora) throw HttpErr(400, 'Hiányzik az óra.');
    if (!SESSION_RE.test(d.ora)) throw HttpErr(400, 'Hibás óra-azonosító.');
    return d.ora;
  }
  function oraFoglal(be, sid, admin) {
    var x = sessionOf(sid), sz = T().szabalyok;
    // ütközés-próba: ?utkozes=1 mellett az óra „közben” betelik
    if (!admin) { try { if (sessionStorage.getItem(FLAG) === '1') { sessionStorage.removeItem(FLAG); while (foglaltDb(x.id) < x.kapacitas) { var zid = ujId('C'); db.orak.foglalasok.push({ id: zid, session: x.id, nev: 'David teszt', email: 'david.teszt+utk' + rnd(2).join('') + '@example.com', telefon: '+36 30 123 4567', megjegyzes: '', ar: tipusOf(x.tipus).ar, status: 'megerositett', rogzites: 'web', forras: null, token: ujToken(zid), created_at: Date.now(), lemondva_at: null, emlekeztetve_at: null }); } save(); } } catch (e) { /* nincs */ } }
    foglalhatoE(x, admin);
    if (be.email && db.orak.foglalasok.some(function (b) { return b.session === x.id && b.status === 'megerositett' && b.email === be.email; })) throw HttpErr(409, 'Erre az órára ezzel az e-mail-címmel már jelentkeztél.', { kod: 'mar_jelentkezett' });
    var id = ujId('C'), b = { id: id, session: x.id, nev: be.nev, email: be.email, telefon: be.telefon, megjegyzes: be.megjegyzes, ar: tipusOf(x.tipus).ar, status: 'megerositett',
      rogzites: admin ? 'admin' : 'web', forras: be.forras || null, token: ujToken(id), created_at: Date.now(), lemondva_at: null, emlekeztetve_at: null };
    db.orak.foglalasok.push(b);
    var l = linkek(b.token), cf = cfNezet(b), ics = icsKeszit(cfIcs(cf), l.lemondasUrl);
    var levelek = [oraVisszaigazolas(cf, { lemondasUrl: l.lemondasUrl, icsUrl: l.icsUrl, szabalyok: sz, ics: ics }), oktatoErtesito(cf, kollegaCim(x.kollega), true, { foglalt: foglaltDb(x.id), kapacitas: x.kapacitas }, admin)].filter(function (v) { return v.cimzett; });
    outboxIr(id, levelek); save();
    return { azonosito: id, lemondasUrl: l.lemondasUrl, ics: l.icsUrl, level: { targy: levelek[0] ? levelek[0].targy : '', html: levelek[0] ? levelek[0].html : '', szoveg: levelek[0] ? levelek[0].szoveg : '' }, foglalas: oraPublikus(cf) };
  }
  function oraTokenFoglalas(tok) {
    var id = String(tok || '').split('.')[0];
    var b = CSOPORTOS_RE.test(id) ? O().foglalasok.filter(function (x) { return x.token === tok; })[0] : null;
    if (!b) throw HttpErr(404, 'Ez a lemondó link érvénytelen.');
    return b;
  }
  function csoportosToken(tok) { return CSOPORTOS_RE.test(String(tok || '').split('.')[0]); }
  function oraAllapot(b) { var x = db.orak.sessions.filter(function (s) { return s.id === b.session; })[0]; return lemondasAllapot({ date: x.datum, start_min: x.kezd, status: b.status }); }
  function oraLemondasInfo(tok) {
    var b = oraTokenFoglalas(tok), a = oraAllapot(b), cf = cfNezet(b);
    if (a.elmult) throw HttpErr(410, 'Ez az óra már elmúlt, a link lejárt.');
    return { tipus: 'csoportos', azonosito: b.id, allapot: b.status, lemondhato: a.lemondhato, modosithato: b.status === 'megerositett' && (a.lemondhato || cf.oraAllapot === 'elmarad'),
      hatarido: new Date(a.hataridoMs).toISOString(), telefon: T().szabalyok.telefon, foglalas: oraPublikus(cf) };
  }
  function oraLemond(b, admin) {
    var sz = T().szabalyok, a = oraAllapot(b), cf0 = cfNezet(b);
    if (b.status !== 'megerositett') throw HttpErr(410, 'Ezt a jelentkezést már lemondták.');
    if (!admin) {
      if (a.elmult) throw HttpErr(410, 'Ez az óra már elmúlt, a link lejárt.');
      if (!a.lemondhato && cf0.oraAllapot !== 'elmarad') throw HttpErr(409, 'A kezdés előtti ' + sz.lemondasOra + ' órán belül a link már nem mond le. Kérjük, hívj minket: ' + sz.telefon + '.', { telefon: sz.telefon });
    }
    b.status = 'lemondva'; b.lemondva_at = Date.now();
    var cf = cfNezet(b), x = db.orak.sessions.filter(function (s) { return s.id === b.session; })[0];
    var lev = [oraLemondasLevel(cf, sz)];
    if (cf.oraAllapot !== 'elmarad') lev.push(oktatoErtesito(cf, kollegaCim(x.kollega), false, { foglalt: foglaltDb(x.id), kapacitas: x.kapacitas }, admin));
    outboxIr(b.id, lev); save();
    return { tipus: 'csoportos', azonosito: b.id, allapot: 'lemondva' };
  }
  function oraModosit(b, ujSid, admin) {
    var sz = T().szabalyok, a = oraAllapot(b), regi = cfNezet(b);
    if (b.status !== 'megerositett') throw HttpErr(410, 'Ezt a jelentkezést már lemondták, nem módosítható.');
    if (a.elmult) throw HttpErr(410, 'Ez az óra már elmúlt, a link lejárt.');
    if (!admin && !a.lemondhato && regi.oraAllapot !== 'elmarad') throw HttpErr(409, 'A kezdés előtti ' + sz.lemondasOra + ' órán belül a link már nem módosít. Kérjük, hívj minket: ' + sz.telefon + '.', { telefon: sz.telefon });
    if (ujSid === b.session) throw HttpErr(400, 'Erre az órára már jelentkeztél. Válassz másikat.');
    var x = sessionOf(ujSid);
    if (!admin) { try { if (sessionStorage.getItem(FLAG) === '1') { sessionStorage.removeItem(FLAG); throw betelt(); } } catch (e) { if (e && e.status) throw e; } }
    foglalhatoE(x, admin);
    if (b.email && db.orak.foglalasok.some(function (y) { return y.session === x.id && y.status === 'megerositett' && y.email === b.email; })) throw HttpErr(409, 'Erre az órára ezzel az e-mail-címmel már jelentkeztél.', { kod: 'mar_jelentkezett' });
    var regiX = db.orak.sessions.filter(function (s) { return s.id === b.session; })[0];
    b.session = x.id; b.ar = tipusOf(x.tipus).ar; b.emlekeztetve_at = null; b.modositva_at = Date.now();
    var l = linkek(b.token), cf = cfNezet(b), ics = icsKeszit(cfIcs(cf), l.lemondasUrl);
    var lev = [oraAthelyezesLevel(cf, { regi: { datum: regi.datum, kezd: regi.kezd, ora: { nev: regi.ora.nev } }, lemondasUrl: l.lemondasUrl, icsUrl: l.icsUrl, szabalyok: sz, ics: ics })];
    if (regi.oraAllapot !== 'elmarad') lev.push(oktatoErtesito(regi, kollegaCim(regiX.kollega), false, { foglalt: foglaltDb(regiX.id), kapacitas: regiX.kapacitas }, admin));
    lev.push(oktatoErtesito(cf, kollegaCim(x.kollega), true, { foglalt: foglaltDb(x.id), kapacitas: x.kapacitas }, admin));
    outboxIr(b.id, lev.filter(function (v) { return v.cimzett; })); save();
    return { tipus: 'csoportos', azonosito: b.id, lemondasUrl: l.lemondasUrl, ics: l.icsUrl, modositva: true, level: { targy: lev[0].targy, html: lev[0].html, szoveg: lev[0].szoveg }, foglalas: oraPublikus(cf) };
  }
  function oraFoglalasTokennel(tok) {
    var b = oraTokenFoglalas(tok), x = db.orak.sessions.filter(function (s) { return s.id === b.session; })[0], l = linkek(b.token), k = b.forras || {};
    var meres = { szolgaltatas: x.tipus, helyszin: tipusOf(x.tipus).helyszin, ar: b.ar };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (y) { if (k[y]) meres[y] = k[y]; });
    return { tipus: 'csoportos', azonosito: b.id, lemondasUrl: l.lemondasUrl, ics: l.icsUrl, foglalas: oraPublikus(cfNezet(b)), meres: meres };
  }
  /* ---- admin ---- */
  function oraResztvevok(sid) {
    var x = sessionOf(sid);
    return { ora: Object.assign(oraNezet(x, Date.now()), { foglalt: foglaltDb(x.id) }), resztvevok: db.orak.foglalasok.filter(function (b) { return b.session === x.id; })
      .sort(function (a, b) { return (a.status === b.status ? 0 : a.status === 'lemondva' ? 1 : -1) || a.created_at - b.created_at; }).map(function (b) {
        return { azonosito: b.id, nev: b.nev, email: b.email, telefon: b.telefon, megjegyzes: b.megjegyzes, allapot: b.status, ar: b.ar, rogzites: b.rogzites, kampany: b.forras || null,
          letrehozva: new Date(b.created_at).toISOString(), lemondva: b.lemondva_at ? new Date(b.lemondva_at).toISOString() : null };
      }) };
  }
  function megjegyzesSz(v) {
    if (v == null) return '';
    if (typeof v !== 'string') throw hiba('Hibás mező: megjegyzés.');
    var s = v.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (s.length > 300) throw hiba('Túl hosszú megjegyzés (legfeljebb 300 karakter).');
    return s;
  }
  function oraElmarad(sid, d) {
    var x = sessionOf(sid), sz = T().szabalyok;
    if (x.status === 'elmarad') throw HttpErr(409, 'Ez az óra már elmaradtként van jelölve.');
    var ok = megjegyzesSz(d && d.ok), res = db.orak.foglalasok.filter(function (b) { return b.session === x.id && b.status === 'megerositett'; });
    x.status = 'elmarad'; x.megjegyzes = ok;
    var ert = 0;
    res.forEach(function (b) { if (b.email) { outboxIr(b.id, [oraElmaradLevel(cfNezet(b), sz, ok)]); ert++; } });
    save();
    return { id: x.id, status: 'elmarad', ertesitve: ert, resztvevok: res.length };
  }
  function oraModositAdmin(sid, d) {
    var x = sessionOf(sid);
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
    Object.keys(d).forEach(function (k) { if (['kapacitas', 'kollega', 'megjegyzes'].indexOf(k) < 0) throw hiba('Ismeretlen mező: ' + k + '.'); });
    var kap = 'kapacitas' in d ? d.kapacitas : x.kapacitas;
    if (!Number.isInteger(kap) || kap < 1 || kap > 100) throw hiba('Hibás szám: kapacitás (1 és 100 között).');
    var k = x.kollega;
    if ('kollega' in d) { k = d.kollega === '' || d.kollega == null ? null : d.kollega; if (k && !T().kollegak.some(function (y) { return y.id === k; })) throw hiba('Ismeretlen szakember.'); }
    if (foglaltDb(x.id) > kap) throw HttpErr(409, 'A kapacitás nem lehet kevesebb a már jelentkezettek számánál.');
    x.kapacitas = kap; x.kollega = k; if ('megjegyzes' in d) x.megjegyzes = megjegyzesSz(d.megjegyzes);
    save(); return oraNezet(x, Date.now());
  }
  function tipusKi(t) { return { id: t.id, nev: t.nev, leiras: t.leiras || '', helyszin: t.helyszin, perc: t.perc, ar: t.ar, kapacitas: t.kapacitas, kategoria: t.kategoria, aktiv: !!t.aktiv, kapacitas_megerositendo: !!t.kapacitas_megerositendo, ar_megerositendo: !!t.ar_megerositendo }; }
  function tipusMezok(d, reszleges) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
    var ism = ['id', 'nev', 'leiras', 'helyszin', 'perc', 'ar', 'kapacitas', 'kategoria', 'aktiv', 'kapacitas_megerositendo', 'ar_megerositendo'];
    Object.keys(d).forEach(function (k) { if (ism.indexOf(k) < 0) throw hiba('Ismeretlen mező: ' + k + '.'); });
    var ki = {}, kell = function (k) { return !reszleges || k in d; };
    if (kell('nev')) { ki.nev = str(d.nev, 'név', 120); if (!ki.nev) throw hiba('Hiányzó mező: név.'); }
    if ('leiras' in d) { if (d.leiras != null && typeof d.leiras !== 'string') throw hiba('Hibás mező: leírás.'); ki.leiras = String(d.leiras || '').trim(); if (ki.leiras.length > 1000) throw hiba('Túl hosszú: leírás (legfeljebb 1000 karakter).'); }
    if (kell('helyszin')) { if (!T().helyszinek.some(function (h) { return h.id === d.helyszin; })) throw hiba('Ismeretlen helyszín.'); ki.helyszin = d.helyszin; }
    if (kell('perc')) { ki.perc = egesz(d.perc, 'időtartam', 10, 480); if (ki.perc % 5) throw hiba('Az időtartam 5 perc többszöröse legyen.'); }
    if ('ar' in d) ki.ar = d.ar == null ? null : egesz(d.ar, 'ár', 0, 10000000);
    if (kell('kapacitas')) ki.kapacitas = egesz(d.kapacitas, 'kapacitás', 1, 100);
    if (kell('kategoria')) { if (KATEGORIAK.indexOf(d.kategoria) < 0) throw hiba('Hibás kategória (' + KATEGORIAK.join(', ') + ').'); ki.kategoria = d.kategoria; }
    ['aktiv', 'kapacitas_megerositendo', 'ar_megerositendo'].forEach(function (k) { if (k in d) { if (typeof d[k] !== 'boolean') throw hiba('Hibás mező: ' + k + ' (true vagy false).'); ki[k] = d[k]; } });
    return ki;
  }
  function tipusLetrehoz(d) {
    var m = tipusMezok(d, false), o = O(), id = d.id;
    if (id) { if (typeof id !== 'string' || !ID_RE.test(id)) throw hiba('Hibás azonosító: csak kisbetű, szám és kötőjel.'); if (o.tipusok.some(function (t) { return t.id === id; })) throw HttpErr(409, 'Ilyen azonosítójú óratípus már van.'); }
    else { var alap = nevbolAzonosito(m.nev).replace(/^kollega$/, 'ora'); id = alap; for (var i = 2; o.tipusok.some(function (t) { return t.id === id; }); i++) id = alap + '-' + i; }
    var t = Object.assign({ id: id, leiras: '', ar: null, aktiv: true, kapacitas_megerositendo: false, ar_megerositendo: false }, m);
    o.tipusok.push(t); save(); return tipusKi(t);
  }
  function tipusModosit(id, d) {
    var t = O().tipusok.filter(function (x) { return x.id === id; })[0];
    if (!t) throw HttpErr(404, 'Nincs ilyen óratípus.');
    if (d && typeof d === 'object' && 'id' in d) throw hiba('Az azonosító nem módosítható.');
    Object.assign(t, tipusMezok(d, true)); save(); return tipusKi(t);
  }
  function sablonKi(s) { return { id: s.id, ora: s.ora, kollega: s.kollega || null, nap: s.nap, kezd: hm(s.kezd), ervenyes_tol: s.ervenyes_tol || '', ervenyes_ig: s.ervenyes_ig || '' }; }
  function sablonMezok(d, reszleges) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
    Object.keys(d).forEach(function (k) { if (['ora', 'kollega', 'nap', 'kezd', 'ervenyes_tol', 'ervenyes_ig'].indexOf(k) < 0) throw hiba('Ismeretlen mező: ' + k + '.'); });
    var ki = {}, kell = function (k) { return !reszleges || k in d; };
    if (kell('ora')) { if (typeof d.ora !== 'string' || !tipusOf(d.ora)) throw hiba('Ismeretlen óratípus.'); ki.ora = d.ora; }
    if ('kollega' in d) { var k = d.kollega === '' || d.kollega == null ? null : d.kollega; if (k && !T().kollegak.some(function (x) { return x.id === k; })) throw hiba('Ismeretlen szakember.'); ki.kollega = k; }
    if (kell('nap')) ki.nap = egesz(d.nap, 'nap (1 = hétfő, 7 = vasárnap)', 1, 7);
    if (kell('kezd')) { var p = hhmmToPerc(d.kezd); if (p == null) throw hiba('Hibás kezdés (HH:MM, 15 perces lépésben).'); ki.kezd = p; }
    ['ervenyes_tol', 'ervenyes_ig'].forEach(function (k) { if (!(k in d)) return; var v = d[k] == null ? '' : d[k]; if (v !== '' && !ervenyesDatum(v)) throw hiba('Hibás dátum: ' + k + ' (ÉÉÉÉ-HH-NN).'); ki[k] = v; });
    return ki;
  }
  function uresJovobeli(sid) { var ma = F.most().datum; return function (x) { return x.sablon === sid && x.datum >= ma && foglaltDb(x.id) === 0; }; }
  function sablonLetrehoz(d) {
    var m = sablonMezok(d, false), o = O();
    if (m.ervenyes_tol && m.ervenyes_ig && m.ervenyes_tol > m.ervenyes_ig) throw hiba('Az érvényesség kezdete nem lehet a vége után.');
    var s = Object.assign({ id: ujId('T'), kollega: null, ervenyes_tol: '', ervenyes_ig: '' }, m);
    o.sablonok.push(s); var g = oraGeneral(); save();
    return Object.assign(sablonKi(s), { letrehozva: g.letrehozva });
  }
  function sablonModosit(id, d) {
    var o = O(), s = o.sablonok.filter(function (x) { return x.id === id; })[0];
    if (!s) throw HttpErr(404, 'Nincs ilyen sablon.');
    var m = sablonMezok(d, true), uj = Object.assign({}, s, m);
    if (uj.ervenyes_tol && uj.ervenyes_ig && uj.ervenyes_tol > uj.ervenyes_ig) throw hiba('Az érvényesség kezdete nem lehet a vége után.');
    var ido = ['ora', 'nap', 'kezd', 'ervenyes_tol', 'ervenyes_ig'].some(function (k) { return k in m && m[k] !== s[k]; }), ma = F.most().datum;
    Object.assign(s, m);
    if ('kollega' in m) o.sessions.forEach(function (x) { if (x.sablon === id && x.datum >= ma) x.kollega = s.kollega; });
    var g = { letrehozva: 0 };
    if (ido) { o.sessions = o.sessions.filter(function (x) { return !uresJovobeli(id)(x); }); g = oraGeneral(); }
    save(); return Object.assign(sablonKi(s), { letrehozva: g.letrehozva });
  }
  function sablonTorol(id) {
    var o = O();
    if (!o.sablonok.some(function (x) { return x.id === id; })) throw HttpErr(404, 'Nincs ilyen sablon.');
    var el = o.sessions.length, ma = F.most().datum;
    o.sablonok = o.sablonok.filter(function (x) { return x.id !== id; });
    o.sessions = o.sessions.filter(function (x) { return !uresJovobeli(id)(x); });
    var maradt = o.sessions.filter(function (x) { return x.sablon === id && x.datum >= ma; }).length;
    save(); return { torolve: id, toroltOrak: el - o.sessions.length, resztvevosOrakMaradtak: maradt };
  }
  function oraAdminFoglalas(id) {
    var b = CSOPORTOS_RE.test(String(id || '')) ? O().foglalasok.filter(function (x) { return x.id === id; })[0] : null;
    if (!b) throw HttpErr(404, 'Nincs ilyen jelentkezés.');
    return b;
  }

  /* =====================================================================
     ÁLLANDÓ IDŐPONT (sorozat, „R…”): SZERZODES.md, Claude tesztelés\f360-allando-idopont-2026-10-01
     Minden alkalom közönséges foglalás (bookings sor) + sorozat_id; a lemondás és az áthelyezés
     alkalmanként a meglévő úttal megy. A levelek a functions/_lib/booking/levelek-sorozat.js másolatai.
     Végpontok: POST /sorozatok/elonezet, POST /sorozatok, GET /sorozatok?allapot=, GET /sorozatok/:id,
                POST /sorozatok/:id/leallitas
     ===================================================================== */
  // a backend sorozat.js-ének böngészős másolata (Caesar, 2026-10-03, még munkában): ha az változik, ezt is igazítani kell
  var SOROZAT_RE = /^R[0-9A-Z]{10}$/, SOROZAT_MAX = 104;
  var NAPOKON = ['', 'hétfőnként', 'keddenként', 'szerdánként', 'csütörtökönként', 'péntekenként', 'szombatonként', 'vasárnaponként'];
  var NAPON_R = ['', 'hétfőn', 'kedden', 'szerdán', 'csütörtökön', 'pénteken', 'szombaton', 'vasárnap'];
  function S() { if (!db.sorozatok) db.sorozatok = []; return db.sorozatok; }
  /* ---- a levelek-sorozat.js másolata ---- */
  function egysor(s) { return String(s == null ? '' : s).replace(/[\r\n\t\u2028\u2029]+/g, ' ').trim(); }
  function ritmus(s) {
    var nap = Number(s.nap);
    if (!(nap >= 1 && nap <= 7)) return '';
    return Number(s.ismetles) === 2 ? 'minden második ' + NAPON_R[nap] + ' ' + s.kezd + '-kor' : NAPOKON[nap] + ' ' + s.kezd + '-kor';
  }
  function vegeSzoveg(s) {
    var v = s.vege || {};
    if (v.tipus === 'datum' && v.datum) return szepDatum(v.datum) + '-ig';
    if (v.tipus === 'alkalom' && Number.isInteger(v.db)) return v.db + ' alkalom';
    return 'visszavonásig';
  }
  var LISTA_MAX = 12;
  function sTabla(sorok) { return ktabla(sorok); }
  function sorozatSorok(s) {
    var sz = s.szolgaltatas || {};
    return [['Állandó időpont', ritmus(s)], ['Kezdés', s.kezdoDatum ? szepDatum(s.kezdoDatum) : ''], ['Időtartam', vegeSzoveg(s)],
      ['Szolgáltatás', sz.nev ? egysor(sz.nev) + (sz.perc ? ' (' + sz.perc + ' perc)' : '') : ''], ['Szakember', egysor(s.kollega && s.kollega.nev)],
      ['Helyszín', s.helyszin ? egysor(s.helyszin.nev) + ', ' + egysor(s.helyszin.cim) : ''], ['Ár', sz.ar != null ? ft(sz.ar) + ' alkalmanként, a helyszínen fizetendő' : '']];
  }
  function alkSz(a) { return szepDatum(a.datum) + ', ' + a.kezd; }
  function alkListaH(alk, linkkel) {
    var lat = alk.slice(0, LISTA_MAX), tobb = alk.length - lat.length;
    return '<ul style="margin:8px 0 16px;padding-left:20px">' + lat.map(function (a) {
      return '<li style="margin:0 0 6px">' + esc(alkSz(a)) + (linkkel !== false && a.lemondasUrl ? ' · <a href="' + esc(a.lemondasUrl) + '" style="color:' + SZIN.ink + '">lemondás vagy módosítás</a>' : '') + '</li>';
    }).join('') + '</ul>' + (tobb > 0 ? '<p>És még ' + tobb + ' alkalom, mindegyik ugyanebben az időpontban.</p>' : '');
  }
  function alkListaSz(alk, linkkel) {
    var lat = alk.slice(0, LISTA_MAX), tobb = alk.length - lat.length;
    return lat.map(function (a) { return '- ' + alkSz(a) + (linkkel !== false && a.lemondasUrl ? '\n  lemondás vagy módosítás: ' + a.lemondasUrl : ''); }).join('\n') +
      (tobb > 0 ? '\nÉs még ' + tobb + ' alkalom, mindegyik ugyanebben az időpontban.' : '');
  }
  function sorozatVisszaigazolas(s, o) {
    var v = s.vendeg || {}, sz = o.szabalyok, alk = o.alkalmak || [];
    var targy = 'Állandó időpontod a Studio F360-ban · ' + ritmus(s);
    var bev = 'Rögzítettük az állandó időpontodat. Az alábbi alkalmakra a helyed le van foglalva.';
    var kezelo = 'Ha egy alkalomra mégsem tudsz jönni, a kezdés előtt ' + sz.lemondasOra + ' óráig az adott alkalom melletti linkkel lemondhatod vagy áthelyezheted. A link mindig csak arra az egy alkalomra vonatkozik, a többi időpontod megmarad.';
    var tel = sz.lemondasOra + ' órán belül, vagy ha az egész állandó időpontot módosítanád, hívj minket: ' + egysor(sz.telefon) + '.';
    var emlek = 'Minden alkalom előtt küldünk emlékeztetőt.';
    var ny = (s.vege || {}).tipus === 'nyitott', nyH = ny ? '<p>Az állandó időpontod visszavonásig érvényes: a további alkalmakat folyamatosan rögzítjük.</p>' : '';
    var html = keret(targy, '<p>Kedves ' + esc(egysor(v.nev)) + '!</p><p>' + bev + '</p>' + sTabla(sorozatSorok(s)) + '<p><strong>Alkalmak</strong></p>' + alkListaH(alk) + nyH +
      '<p>' + esc(kezelo) + '</p><p>' + esc(tel) + '</p><p>' + emlek + '</p><p>Várunk szeretettel,<br>a Studio F360 csapata</p>');
    var szoveg = 'Kedves ' + egysor(v.nev) + '!\n\n' + bev + '\n\n' + kszoveg(sorozatSorok(s)) + '\n\nAlkalmak:\n' + alkListaSz(alk) + '\n\n' +
      (ny ? 'Az állandó időpontod visszavonásig érvényes: a további alkalmakat folyamatosan rögzítjük.\n\n' : '') + kezelo + '\n' + tel + '\n' + emlek + '\n\nVárunk szeretettel,\na Studio F360 csapata\n';
    return { tipus: 'sorozat-visszaigazolas', sorozat: true, cimzett: v.email || '', targy: targy, html: html, szoveg: szoveg };
  }
  function sorozatKollegaErtesito(s, cimzett, o) {
    var v = s.vendeg || {}, uj = o.esemeny !== 'leallitva', alk = o.alkalmak || [];
    var targy = (uj ? 'Új állandó időpont' : 'Leállt állandó időpont') + ' · ' + egysor(v.nev) + ' · ' + ritmus(s);
    var bev = uj ? 'Új állandó időpontot vettek fel hozzád az adminban.' : 'Az adminban leállították egy vendég állandó időpontját. Az alábbi alkalmakat lemondtuk.';
    var sorok = sorozatSorok(s).filter(function (r) { return r[0] !== 'Ár'; }).concat([['Vendég', egysor(v.nev)], ['E-mail', egysor(v.email)], ['Telefon', egysor(v.telefon)], ['Megjegyzés', egysor(v.megjegyzes)]]);
    var cim = uj ? 'Alkalmak' : 'Lemondott alkalmak';
    var html = keret(targy, '<p>' + esc(bev) + '</p>' + sTabla(sorok) + (alk.length ? '<p><strong>' + cim + '</strong></p>' + alkListaH(alk, false) : ''));
    var szoveg = bev + '\n\n' + kszoveg(sorok) + '\n' + (alk.length ? '\n' + cim + ':\n' + alkListaSz(alk, false) + '\n' : '');
    return { tipus: 'sorozat-kollega', sorozat: true, esemeny: uj ? 'uj' : 'leallitva', cimzett: cimzett, targy: targy, html: html, szoveg: szoveg };
  }
  function sorozatLeallitvaLevel(s, o) {
    var v = s.vendeg || {}, lem = o.lemondott || [], mar = o.maradt || [];
    var targy = 'Az állandó időpontod véget ért · Studio F360';
    var bev = 'Az állandó időpontod (' + ritmus(s) + ', ' + egysor(s.kollega && s.kollega.nev) + ') véget ért.';
    var hivj = 'Ha kérdésed van, vagy újra állandó időpontot szeretnél, hívj minket: ' + egysor(o.szabalyok.telefon) + '.';
    var html = keret(targy, '<p>Kedves ' + esc(egysor(v.nev)) + '!</p><p>' + esc(bev) + '</p>' +
      (lem.length ? '<p><strong>Ezeket az alkalmakat lemondtuk</strong></p>' + alkListaH(lem, false) : '') +
      (mar.length ? '<p><strong>Ezek az alkalmak megmaradnak</strong></p>' + alkListaH(mar) : '') + '<p>' + esc(hivj) + '</p><p>Üdvözlettel,<br>a Studio F360 csapata</p>');
    var szoveg = 'Kedves ' + egysor(v.nev) + '!\n\n' + bev + '\n\n' + (lem.length ? 'Ezeket az alkalmakat lemondtuk:\n' + alkListaSz(lem, false) + '\n\n' : '') +
      (mar.length ? 'Ezek az alkalmak megmaradnak:\n' + alkListaSz(mar) + '\n\n' : '') + hivj + '\n\nÜdvözlettel,\na Studio F360 csapata\n';
    return { tipus: 'sorozat-leallitva', sorozat: true, cimzett: v.email || '', targy: targy, html: html, szoveg: szoveg };
  }
  /* ---- bemenet ---- */
  function sorozatBemenet(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw hiba('Hibás kérés.');
    if (JSON.stringify(d).length > 8192) throw HttpErr(413, 'Túl nagy kérés.');
    var kollega = d.kollega;
    if (typeof kollega !== 'string' || !kollega || kollega === 'barki') throw hiba('Állandó időponthoz válassz szakembert.');
    var r = hivatkozasok({ helyszin: d.helyszin, szolgaltatas: d.szolgaltatas, kollega: kollega });
    var nap = egesz(d.nap, 'nap (1 = hétfő, 7 = vasárnap)', 1, 7);
    var kezdPerc = hhmmToPerc(d.kezd);
    if (kezdPerc == null) throw hiba('Hibás kezdés (HH:MM, 15 perces lépésben).');
    var ism = d.ismetles == null ? 1 : d.ismetles;
    if (ism !== 1 && ism !== 2) throw hiba('Hibás ismétlés: 1 (hetente) vagy 2 (kéthetente).');
    var ma = F.most().datum;
    if (!ervenyesDatum(d.kezdoDatum)) throw hiba('Hibás kezdő dátum.');
    if (d.kezdoDatum < F.addDays(ma, -366) || d.kezdoDatum > F.addDays(ma, 366)) throw hiba('A kezdő dátum legfeljebb egy évvel lehet korábbi vagy későbbi a mainál.');
    var v = d.vege || {}, vege;
    if (v.tipus === 'datum') { if (!ervenyesDatum(v.datum) || v.datum < d.kezdoDatum) throw hiba('Hibás záró dátum: nem lehet a kezdés előtt.'); vege = { tipus: 'datum', datum: v.datum }; }
    else if (v.tipus === 'alkalom') vege = { tipus: 'alkalom', db: egesz(v.db, 'alkalmak száma', 1, SOROZAT_MAX) };
    else if (v.tipus === 'nyitott') vege = { tipus: 'nyitott' };
    else throw hiba('Hibás vége: datum, alkalom vagy nyitott.');
    return { helyszin: d.helyszin, szolgaltatas: d.szolgaltatas, kollega: kollega, nap: nap, kezdPerc: kezdPerc, kezd: hm(kezdPerc), ismetles: ism, kezdoDatum: d.kezdoDatum, vege: vege, hely: r.hely, szolg: r.szolg };
  }
  function sorozatHorizont() { return F.addDays(F.most().datum, T().szabalyok.maxEloreNap == null ? 60 : T().szabalyok.maxEloreNap); }
  // az alkalmak dátumai: az első a kezdő napon vagy utána, a napra esik; utána 7 vagy 14 naponként
  function sorozatDatumok(be, tol) {
    var d = be.kezdoDatum;
    while (hetNapja(d) !== be.nap) d = F.addDays(d, 1);
    var hor = sorozatHorizont(), out = [];
    for (;; d = F.addDays(d, 7 * be.ismetles)) {
      if (be.vege.tipus === 'alkalom' && out.length >= be.vege.db) break;
      if (be.vege.tipus === 'datum' && d > be.vege.datum) break;
      if (be.vege.tipus === 'nyitott' && d > hor) break;
      if (out.length >= SOROZAT_MAX) throw hiba('Egy állandó időpontnak legfeljebb ' + SOROZAT_MAX + ' alkalma lehet. Válassz korábbi záró dátumot.');
      out.push(d);
    }
    if (tol) out = out.filter(function (x) { return x >= tol; });
    return out;
  }
  function percAtfed(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }
  // miért nem foglalható az alkalom (null = szabad); kiveve: a saját foglalás (áthelyezésnél)
  function alkalomOk(be, datum, kezdPerc, kiveve) {
    var t = T(), szolg = be.szolg, veg = kezdPerc + szolg.perc, puffer = szolg.puffer == null ? 10 : szolg.puffer;
    var k = t.kollegak.filter(function (x) { return x.id === be.kollega; })[0];
    if (helyiToUtc(datum, kezdPerc) < Date.now()) return 'mult';
    if (!k || !aktivANapon(k, datum)) return 'kollega_inaktiv';
    if (kezdPerc < F.perc(be.hely.nyit) || veg > F.perc(be.hely.zar)) return 'zarva';
    var kiv = db.kivetelek.filter(function (x) { return datum >= x.tol && datum <= x.ig && (x.kezd == null || percAtfed(kezdPerc, veg, x.kezd, x.veg)); });
    if (kiv.some(function (x) { return !x.kollega && x.helyszin === be.helyszin; })) return 'zarva';
    if (kiv.some(function (x) { return x.kollega === be.kollega && (!x.helyszin || x.helyszin === be.helyszin); })) return 'szabadsag';
    var nap = hetNapja(datum);
    if (!db.beosztas.some(function (b) { return b.kollega === be.kollega && b.nap === nap && b.helyszin === be.helyszin && b.kezd <= kezdPerc && veg <= b.veg; })) return 'nincs_beosztas';
    var fs = {}; foglaltLista(kiveve).forEach(function (f) { fs[f.kollega + '|' + f.datum + '|' + f.slot] = 1; });
    if (foglalasSlotjai({ kollega: be.kollega, datum: datum, kezd: kezdPerc, perc: szolg.perc, puffer: puffer }).some(function (s) { return fs[s.kollega + '|' + s.datum + '|' + s.slot]; })) return 'foglalt';
    if (O().sessions.some(function (x) { return x.kollega === be.kollega && x.datum === datum && x.status !== 'elmarad' && percAtfed(kezdPerc, veg + puffer, x.kezd, x.kezd + x.perc); })) return 'foglalt';
    return null;
  }
  function sorozatElonezet(d) {
    var be = sorozatBemenet(d), alk = sorozatDatumok(be).map(function (datum) {
      var ok = alkalomOk(be, datum, be.kezdPerc);
      return ok ? { datum: datum, kezd: be.kezd, allapot: 'utkozik', ok: ok } : { datum: datum, kezd: be.kezd, allapot: 'szabad' };
    });
    var hor = be.vege.tipus === 'nyitott' ? sorozatHorizont() : (alk.length ? alk[alk.length - 1].datum : be.kezdoDatum);
    return { alkalmak: alk, osszes: alk.length, utkozik: alk.filter(function (a) { return a.allapot === 'utkozik'; }).length, horizontVege: hor };
  }
  function sorozatFoglal(s, be, datum, kezdPerc) {
    var row = sor({ kollega: be.kollega, datum: datum, kezdPerc: kezdPerc, szolg: be.szolg, hely: be.hely, nev: s.name, email: s.email, telefon: s.phone, megjegyzes: s.note, source: 'admin' });
    row.sorozat_id = s.id;
    db.bookings.push(row);
    return row;
  }
  function sorozatBe(s) {
    var t = T();
    return { helyszin: s.location_id, szolgaltatas: s.service_id, kollega: s.staff_id, nap: s.weekday, kezdPerc: s.start_min, kezd: hm(s.start_min), ismetles: s.interval_het,
      kezdoDatum: s.kezdo_datum, vege: s.vege_tipus === 'datum' ? { tipus: 'datum', datum: s.vege_datum } : s.vege_tipus === 'alkalom' ? { tipus: 'alkalom', db: s.alkalmak_szama } : { tipus: 'nyitott' },
      hely: t.helyszinek.filter(function (h) { return h.id === s.location_id; })[0], szolg: t.szolgaltatasok.filter(function (x) { return x.id === s.service_id; })[0] };
  }
  function sorozatLetrehoz(d) {
    var be = sorozatBemenet(d), vb = ugyfelBemenet(Object.assign({}, d.vendeg || {}), true);
    var kihagy = Array.isArray(d.kihagy) ? d.kihagy : [], ath = Array.isArray(d.athelyez) ? d.athelyez : [];
    var datumok = sorozatDatumok(be), letre = [], kimaradt = [];
    if (kihagy.some(function (x) { return datumok.indexOf(x) < 0; })) throw hiba('A kihagyott dátum nem tartozik az állandó időponthoz.');
    var athM = {};
    ath.forEach(function (a) {
      if (!a || typeof a !== 'object' || datumok.indexOf(a.datum) < 0) throw hiba('Az áthelyezett dátum nem tartozik az állandó időponthoz.');
      if (!ervenyesDatum(a.ujDatum) || hhmmToPerc(a.ujKezd) == null) throw hiba('Hibás áthelyezés (ujDatum, ujKezd).');
      athM[a.datum] = { datum: a.ujDatum, kezdPerc: hhmmToPerc(a.ujKezd) };
    });
    if (!datumok.length) throw HttpErr(409, 'A megadott időszakban nincs ilyen nap.', { kimaradt: [] });
    var s = { id: ujId('R'), location_id: be.helyszin, service_id: be.szolgaltatas, staff_id: be.kollega, weekday: be.nap, start_min: be.kezdPerc, interval_het: be.ismetles,
      kezdo_datum: be.kezdoDatum, vege_tipus: be.vege.tipus, vege_datum: be.vege.datum || null, alkalmak_szama: be.vege.db || null,
      name: vb.nev, email: vb.email, phone: vb.telefon, note: vb.megjegyzes, status: 'aktiv', created_at: Date.now(), leallitva_at: null, kimaradt: [], gorditve: '' };
    var mentes = db.bookings.length;
    datumok.forEach(function (datum) {
      var ok = alkalomOk(be, datum, be.kezdPerc);
      if (kihagy.indexOf(datum) >= 0) { kimaradt.push({ datum: datum, ok: ok || 'kihagyva' }); return; }
      if (athM[datum] && ok) { // csak ütköző alkalom helyezhető át, a nem ütközőnél az áthelyezés nem számít
        var u = athM[datum], uok = alkalomOk(be, u.datum, u.kezdPerc);
        if (uok) { kimaradt.push({ datum: datum, ok: uok }); return; }
        var r1 = sorozatFoglal(s, be, u.datum, u.kezdPerc); letre.push({ id: r1.id, datum: r1.date, kezd: hm(r1.start_min), athelyezve: datum }); return;
      }
      if (ok) { kimaradt.push({ datum: datum, ok: ok }); return; }
      var r = sorozatFoglal(s, be, datum, be.kezdPerc); letre.push({ id: r.id, datum: r.date, kezd: hm(r.start_min) });
    });
    if (!letre.length) { db.bookings.length = mentes; throw HttpErr(409, 'Egyetlen alkalom sem foglalható. Válassz másik napot, időpontot vagy szakembert.', { kimaradt: kimaradt }); }
    s.kimaradt = kimaradt.filter(function (x) { return x.ok !== 'kihagyva'; });
    s.gorditve = F.most().datum;
    S().push(s);
    var sn = sorozatNezet(s), sz = T().szabalyok;
    var alk = letre.slice().sort(function (a, b) { return a.datum.localeCompare(b.datum); }).map(function (a) {
      var row = db.bookings.filter(function (x) { return x.id === a.id; })[0];
      return { datum: a.datum, kezd: a.kezd, lemondasUrl: linkek(row.token).lemondasUrl };
    });
    outboxIr(s.id, [sorozatVisszaigazolas(sn, { alkalmak: alk, szabalyok: sz }), sorozatKollegaErtesito(sn, kollegaCim(s.staff_id), { alkalmak: alk, esemeny: 'uj' })]);
    save();
    return { sorozat: sn, letrejott: letre, kimaradt: kimaradt };
  }
  function sorozatNezet(s, reszletes) {
    var t = T(), ma = F.most().datum, most = Date.now();
    var h = t.helyszinek.filter(function (x) { return x.id === s.location_id; })[0] || { id: s.location_id, nev: s.location_id, cim: '' };
    var sz = t.szolgaltatasok.filter(function (x) { return x.id === s.service_id; })[0] || { id: s.service_id, nev: s.service_id };
    var k = t.kollegak.filter(function (x) { return x.id === s.staff_id; })[0] || { id: s.staff_id, nev: s.staff_id };
    var sajat = db.bookings.filter(function (b) { return b.sorozat_id === s.id; }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.start_min - b.start_min; });
    var jov = sajat.filter(function (b) { return b.status === 'megerositett' && helyiToUtc(b.date, b.start_min) > most; });
    var n = { id: s.id, vendeg: { nev: s.name, email: s.email, telefon: s.phone, megjegyzes: s.note },
      helyszin: { id: h.id, nev: h.nev, cim: h.cim }, szolgaltatas: { id: sz.id, nev: sz.nev, perc: sz.perc, ar: sz.ar }, kollega: { id: k.id, nev: k.nev, szin: k.szin },
      nap: s.weekday, kezd: hm(s.start_min), ismetles: s.interval_het, kezdoDatum: s.kezdo_datum,
      vege: s.vege_tipus === 'datum' ? { tipus: 'datum', datum: s.vege_datum } : s.vege_tipus === 'alkalom' ? { tipus: 'alkalom', db: s.alkalmak_szama } : { tipus: 'nyitott' },
      status: s.status, letrehozva: new Date(s.created_at).toISOString(), leallitva: s.leallitva_at ? new Date(s.leallitva_at).toISOString() : null,
      kovetkezo: jov[0] ? { datum: jov[0].date, kezd: hm(jov[0].start_min) } : null, jovobeli: jov.length,
      lemondott: sajat.filter(function (b) { return b.status === 'lemondva'; }).length, kimaradt: (s.kimaradt || []).filter(function (x) { return x.datum >= ma; }) };
    if (reszletes) n.alkalmak = sajat.map(function (b) { return { id: b.id, datum: b.date, kezd: hm(b.start_min), allapot: b.status === 'lemondva' ? 'lemondva' : 'megerositett' }; });
    return n;
  }
  function sorozatOf(id) {
    var s = SOROZAT_RE.test(String(id || '')) ? S().filter(function (x) { return x.id === id; })[0] : null;
    if (!s) throw HttpErr(404, 'Nincs ilyen állandó időpont.');
    return s;
  }
  function sorozatLista(q) {
    var a = q.get('allapot') || 'aktiv';
    if (['aktiv', 'leallitva', 'mind'].indexOf(a) < 0) throw hiba('Hibás állapot: aktiv, leallitva vagy mind.');
    return { sorozatok: S().filter(function (s) { return a === 'mind' || s.status === a; }).map(function (s) { return sorozatNezet(s); })
      .sort(function (x, y) { return x.nap - y.nap || x.kezd.localeCompare(y.kezd) || x.vendeg.nev.localeCompare(y.vendeg.nev, 'hu'); }) };
  }
  function sorozatLeallit(id, d) {
    var s = sorozatOf(id), ma = F.most().datum, tol = d && d.tol != null && d.tol !== '' ? d.tol : ma;
    if (!ervenyesDatum(tol)) throw hiba('Hibás dátum: tol (ÉÉÉÉ-HH-NN).');
    if (tol < ma) throw hiba('A leállítás napja nem lehet a múltban.');
    if (s.status === 'leallitva') throw HttpErr(409, 'Ez az állandó időpont már le van állítva.');
    var sajat = db.bookings.filter(function (b) { return b.sorozat_id === s.id && b.status === 'megerositett'; });
    var most = Date.now(), lem = sajat.filter(function (b) { return b.date >= tol && helyiToUtc(b.date, b.start_min) > most; });
    lem.forEach(function (b) { b.status = 'lemondva'; b.cancelled_at = most; });
    var maradt = sajat.filter(function (b) { return b.date < tol && helyiToUtc(b.date, b.start_min) > most; });
    s.status = 'leallitva'; s.leallitva_at = most;
    var sn = sorozatNezet(s), sz = T().szabalyok, ki = function (b) { return { datum: b.date, kezd: hm(b.start_min), lemondasUrl: linkek(b.token).lemondasUrl }; };
    outboxIr(s.id, [sorozatLeallitvaLevel(sn, { lemondott: lem.map(ki), maradt: maradt.map(ki), szabalyok: sz }),
      sorozatKollegaErtesito(sn, kollegaCim(s.staff_id), { alkalmak: lem.map(ki), esemeny: 'leallitva' })]);
    save();
    return { sorozat: sn, lemondott: lem.map(function (b) { return { id: b.id, datum: b.date }; }) };
  }
  // a „visszavonásig” sorozat gördítése (élesben a 15 perces cron): a horizontig elkészülnek az alkalmak
  function sorozatGordit() {
    var ma = F.most().datum, valt = false;
    S().forEach(function (s) {
      if (s.status !== 'aktiv' || s.vege_tipus !== 'nyitott' || s.gorditve === ma) return;
      var be = sorozatBe(s);
      sorozatDatumok(be, ma).forEach(function (datum) {
        if (db.bookings.some(function (b) { return b.sorozat_id === s.id && b.date === datum; })) return;
        if ((s.kimaradt || []).some(function (x) { return x.datum === datum; })) return;
        var ok = alkalomOk(be, datum, be.kezdPerc);
        if (ok) s.kimaradt.push({ datum: datum, ok: ok }); else sorozatFoglal(s, be, datum, be.kezdPerc);
      });
      s.gorditve = ma; valt = true;
    });
    if (valt) save();
  }
  function sorozatJel(r) {
    if (!r.sorozat_id) return null;
    var s = S().filter(function (x) { return x.id === r.sorozat_id; })[0];
    return s ? { id: s.id, nap: s.weekday, kezd: hm(s.start_min), ismetles: s.interval_het } : null;
  }

  /* ---------------- HTTP ---------------- */
  function json(status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
  function kesleltet(res, ms) { return new Promise(function (ok) { setTimeout(function () { ok(res); }, ms); }); }

  function kezel(u, method, body) {
    var p = u.pathname, q = u.searchParams, m;
    /* ---- nyilvános ---- */
    if (/\/foglalas-api\//.test(p)) {
      var nev = p.replace(/^.*\/foglalas-api\/?/, '').replace(/\/+$/, '');
      if (nev === 'katalogus' && method === 'GET') return json(200, katalogus());
      if (nev === 'orak' && method === 'GET') return json(200, oraLista(q, false));
      if (nev === 'ora-foglalas' && method === 'POST') {
        if (!body || typeof body !== 'object') throw HttpErr(400, 'Hibás kérés.');
        if (body.web != null && String(body.web).trim() !== '') return json(200, { ok: true });
        var ub = ugyfelBemenet(body, false);
        return json(201, oraFoglal(ub, oraBemenet(body), false));
      }
      // a tokenes végpontok a csoportos tokent („C…”) is kezelik
      var tq = q.get('t') || (body && typeof body.t === 'string' ? body.t : '');
      if (csoportosToken(tq)) {
        if (nev === 'foglalas' && method === 'GET') return json(200, oraFoglalasTokennel(tq));
        if (nev === 'lemondas' && method === 'GET') return json(200, oraLemondasInfo(tq));
        if (nev === 'lemondas' && method === 'POST') return json(200, oraLemond(oraTokenFoglalas(tq), false));
        if (nev === 'modositas' && method === 'POST') {
          if ('datum' in body || 'kezd' in body || 'kollega' in body) throw HttpErr(400, 'Csoportos jelentkezésnél másik órát kell választani (ora).');
          return json(200, oraModosit(oraTokenFoglalas(tq), oraBemenet(body), false));
        }
        if (nev === 'foglalas.ics' && method === 'GET') {
          var ob = oraTokenFoglalas(tq), ocf = cfNezet(ob);
          if (ob.status !== 'megerositett') throw HttpErr(410, 'Ezt a jelentkezést lemondták.');
          if (ocf.oraAllapot === 'elmarad') throw HttpErr(410, 'Ez az óra elmarad.');
          return new Response(icsKeszit(cfIcs(ocf), linkek(ob.token).lemondasUrl), { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
        }
      }
      if (nev === 'modositas' && method === 'POST' && body && 'ora' in body) throw HttpErr(400, 'Egyéni foglalásnál az időpontot kell megadni (datum, kezd).');
      if (nev === 'szabad' && method === 'GET') {
        // módosításhoz: ?t=<token> (a saját foglalás ideje szabad, helyszín és szolgáltatás a foglalásból)
        if (q.has('t')) return json(200, szabadModositashoz(tokenFoglalas(q.get('t')), q, false));
        var tol = q.get('tol'), ig = q.get('ig');
        if (!ervenyesDatum(tol) || !ervenyesDatum(ig) || ig < tol) throw HttpErr(400, 'Hibás dátum-tartomány.');
        if (napok(tol, ig, 15).length > 14) throw HttpErr(400, 'Egyszerre legfeljebb 14 nap kérhető le.');
        var pp = { helyszin: q.get('helyszin'), szolgaltatas: q.get('szolgaltatas'), kollega: q.get('kollega') || 'barki' };
        hivatkozasok(pp);
        return json(200, szabadIdopontok({ torzs: T(), foglalt: foglaltLista(), helyszin: pp.helyszin, szolgaltatas: pp.szolgaltatas, kollega: pp.kollega, tol: tol, ig: ig }));
      }
      // a köszönő oldal adatai tokennel (foglalasTokennel): publikus nézet + mérési adat (személyes adat nélkül)
      if (nev === 'foglalas' && method === 'GET') {
        var tr = tokenFoglalas(q.get('t')), kf = tr.forras || {}, lk = linkek(tr.token), meres = { szolgaltatas: tr.service_id, helyszin: tr.location_id, ar: tr.price };
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (x) { if (kf[x]) meres[x] = kf[x]; });
        return json(200, { azonosito: tr.id, lemondasUrl: lk.lemondasUrl, ics: lk.icsUrl, foglalas: publikusNezet(nezet(tr)), meres: meres });
      }
      if (nev === 'foglalas' && method === 'POST') {
        if (!body || typeof body !== 'object') throw HttpErr(400, 'Hibás kérés.');
        if (body.web != null && String(body.web).trim() !== '') return json(200, { ok: true });
        return json(201, foglal(foglalasBemenet(body, false), false));
      }
      if (nev === 'lemondas' && method === 'GET') return json(200, lemondasInfo(q.get('t')));
      if (nev === 'lemondas' && method === 'POST') return json(200, lemond(tokenFoglalas(body && typeof body.t === 'string' ? body.t : ''), false));
      if (nev === 'modositas' && method === 'POST') {
        if (!body || typeof body !== 'object') throw HttpErr(400, 'Hibás kérés.');
        return json(200, modosit(tokenFoglalas(typeof body.t === 'string' ? body.t : ''), modositasBemenet(body), false));
      }
      if (nev === 'foglalas.ics' && method === 'GET') {
        var row = tokenFoglalas(q.get('t'));
        if (row.status !== 'megerositett') throw HttpErr(410, 'Ezt a foglalást lemondták.');
        return new Response(icsKeszit(nezet(row), linkek(row.token).lemondasUrl), { status: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
      }
      return json(404, { error: 'Ismeretlen végpont.' });
    }
    /* ---- admin ---- */
    var reszek = p.replace(/^.*\/api\/foglalo\/?/, '').split('/').filter(Boolean);
    var r0 = reszek[0], r1 = reszek[1] && decodeURIComponent(reszek[1]), r2 = reszek[2];
    var tilt = function () { return json(405, { error: 'Ez a művelet itt nem engedélyezett.' }); };
    if (r0 === 'orak') {
      if (reszek.length === 1) return method === 'GET' ? json(200, oraLista(q, true)) : tilt();
      if (reszek.length === 2 && r1 === 'general') { if (method !== 'POST') return tilt(); O(); var g = oraGeneral(); save(); return json(200, g); }
      if (reszek.length === 2) return method === 'PATCH' ? json(200, oraModositAdmin(r1, body)) : tilt();
      if (reszek.length === 3 && r2 === 'resztvevok') {
        if (method === 'GET') return json(200, oraResztvevok(r1));
        if (method === 'POST') return json(201, oraFoglal(ugyfelBemenet(body || {}, true), r1, true));
        return tilt();
      }
      if (reszek.length === 3 && r2 === 'elmarad') return method === 'POST' ? json(200, oraElmarad(r1, body || {})) : tilt();
    }
    if (r0 === 'ora-foglalasok' && reszek.length === 3 && r2 === 'lemondas') return method === 'POST' ? json(200, oraLemond(oraAdminFoglalas(r1), true)) : tilt();
    if (r0 === 'ora-tipusok') {
      if (reszek.length === 1) { if (method === 'GET') return json(200, { tipusok: O().tipusok.slice().sort(function (a, b) { return a.nev.localeCompare(b.nev, 'hu'); }).map(tipusKi) }); if (method === 'POST') return json(201, tipusLetrehoz(body)); return tilt(); }
      if (reszek.length === 2) return method === 'PATCH' ? json(200, tipusModosit(r1, body)) : tilt();
    }
    if (r0 === 'ora-sablonok') {
      if (reszek.length === 1) { if (method === 'GET') return json(200, { sablonok: O().sablonok.slice().sort(function (a, b) { return a.nap - b.nap || a.kezd - b.kezd; }).map(sablonKi) }); if (method === 'POST') return json(201, sablonLetrehoz(body)); return tilt(); }
      if (reszek.length === 2) { if (method === 'PATCH') return json(200, sablonModosit(r1, body)); if (method === 'DELETE') return json(200, sablonTorol(r1)); return tilt(); }
    }
    if (r0 === 'sorozatok') {
      sorozatGordit();
      if (reszek.length === 1) { if (method === 'GET') return json(200, sorozatLista(q)); if (method === 'POST') return json(201, sorozatLetrehoz(body)); return tilt(); }
      if (reszek.length === 2 && r1 === 'elonezet') return method === 'POST' ? json(200, sorozatElonezet(body)) : tilt();
      if (reszek.length === 2) return method === 'GET' ? json(200, sorozatNezet(sorozatOf(r1), true)) : tilt();
      if (reszek.length === 3 && r2 === 'leallitas') return method === 'POST' ? json(200, sorozatLeallit(r1, body || {})) : tilt();
    }
    if (reszek.length === 3 && reszek[0] === 'foglalasok' && reszek[2] === 'lemondas' && method === 'POST') {
      return json(200, lemond(foglalasId(decodeURIComponent(reszek[1])), true));
    }
    // PATCH /api/foglalo/foglalasok/:id  áthelyezés { datum, kezd, kollega } (határidő nélkül)
    if (reszek.length === 2 && reszek[0] === 'foglalasok') {
      if (method !== 'PATCH') return json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      return json(200, modosit(foglalasId(decodeURIComponent(reszek[1])), modositasBemenet(body), true));
    }
    if (reszek.length === 2 && reszek[0] === 'riport' && reszek[1] === 'forrasok') {
      if (method !== 'GET') return json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      return json(200, forrasRiport(q));
    }
    // Google Naptár (naptar.js naptarAllapot / studioNaptarMent / naptarUjraszinkron)
    if (reszek[0] === 'naptar') {
      if (reszek.length === 2 && reszek[1] === 'allapot') return method === 'GET' ? json(200, naptarAllapot()) : json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      if (reszek.length === 2 && reszek[1] === 'ujraszinkron') return method === 'POST' ? json(200, naptarUjraszinkron(body || {})) : json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      if (reszek.length === 1) {
        if (method !== 'PATCH') return json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw hiba('Hibás kérés.');
        var nk = Object.keys(body);
        if (nk.length !== 1 || nk[0] !== 'studioNaptarId') throw hiba('Itt csak a studioNaptarId mező módosítható.');
        var sn = naptarAzonosito(body.studioNaptarId, 'stúdiónaptár-azonosító');
        db.torzs = Object.assign({}, T(), { szabalyok: Object.assign({}, T().szabalyok, { studioNaptarId: sn }) }); save();
        return json(200, { studioNaptarId: sn });
      }
      return json(404, { error: 'Ismeretlen API-végpont.' });
    }
    if (reszek.length === 2 && reszek[0] === 'emlekezteto' && reszek[1] === 'futtat') {
      if (method !== 'POST') return json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      var em = emlekeztetoFuttat();
      return json(200, Object.assign({ mod: 'outbox' }, em, { levelek: { mod: 'outbox', kuldve: 0, hibas: 0, vegleges: 0, elavult: 0 } }));
    }
    if (reszek.length === 2 && reszek[0] === 'kollegak') {
      if (method !== 'PATCH') return json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      return json(200, kollegaModosit(decodeURIComponent(reszek[1]), body));
    }
    if (reszek.length === 3 && reszek[0] === 'kollegak' && reszek[2] === 'archivalas') {
      if (method !== 'POST') return json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      return json(200, kollegaModosit(decodeURIComponent(reszek[1]), { archivalt: true }));
    }
    var ut = reszek[0];
    if (ut === 'kollegak' && method === 'POST' && reszek.length === 1) return json(201, kollegaLetrehoz(body));
    // GET /api/foglalo/szabad?foglalas=&kollega=&tol=&ig=  az áthelyezés szabad időpontjai
    if (ut === 'szabad' && method === 'GET') {
      if (q.has('foglalas')) return json(200, szabadModositashoz(foglalasId(q.get('foglalas')), q, true));
      // kézi felvétel: bármely 15 perces rácspont, minEloreOra és maxEloreNap nélkül (foglalas.js szabad, admin ág)
      var at = q.get('tol'), ai = q.get('ig');
      if (!ervenyesDatum(at) || !ervenyesDatum(ai) || ai < at) throw HttpErr(400, 'Hibás dátum-tartomány.');
      if (napok(at, ai, 15).length > 14) throw HttpErr(400, 'Egyszerre legfeljebb 14 nap kérhető le.');
      var ap = { helyszin: q.get('helyszin'), szolgaltatas: q.get('szolgaltatas'), kollega: q.get('kollega') || 'barki' };
      hivatkozasok(ap);
      return json(200, szabadIdopontok({ torzs: adminTorzs(T()), foglalt: foglaltLista(), helyszin: ap.helyszin, szolgaltatas: ap.szolgaltatas, kollega: ap.kollega, tol: at, ig: ai }));
    }
    // PATCH /api/foglalo/szolgaltatasok/:id { kinalas }  (admin.js szolgaltatasKinalasMent)
    if (ut === 'szolgaltatasok' && reszek.length === 2) {
      if (method !== 'PATCH') return json(405, { error: 'Ez a művelet itt nem engedélyezett.' });
      csakKinalas(body);
      var sid = decodeURIComponent(reszek[1]), kv = kinalasSzolgaltatas(body.kinalas, sid);
      if (!T().szolgaltatasok.some(function (x) { return x.id === sid; })) throw HttpErr(404, 'Ismeretlen szolgáltatás.');
      db.torzs = Object.assign({}, T(), { szolgaltatasok: T().szolgaltatasok.map(function (x) {
        if (x.id !== sid) return x; var c = Object.assign({}, x); delete c.kinalas; if (kv != null) c.kinalas = kv; return c; }) });
      save();
      var sk = db.torzs.szolgaltatasok.filter(function (x) { return x.id === sid; })[0];
      return json(200, Object.assign({}, sk, { kinalas: sk.kinalas == null ? null : sk.kinalas }));
    }
    if (ut === 'beallitasok') {
      if (method === 'GET') return json(200, T());
      // PATCH { kinalas }: a globális kínálás (admin.js kinalasMent)
      if (method === 'PATCH') {
        csakKinalas(body);
        var kg = kinalasGlobalis(body.kinalas);
        db.torzs = Object.assign({}, T(), { szabalyok: Object.assign({}, T().szabalyok, { kinalas: kg }) }); save(); return json(200, db.torzs);
      }
      if (method === 'PUT') {
        // mint a backend beallitasokMent: a meg nem küldött új mezők a mentett értéket tartják, a szűkítés 409
        var be = torzsEllenoriz(body), regiT = T(), regiK = {};
        regiT.kollegak.forEach(function (k) { regiK[k.id] = k; });
        var kl = szinKioszt(be.kollegak.map(function (k) {
          var r = regiK[k.id] || {}, megtart = {};
          KOLLEGA_UJ_MEZOK.forEach(function (m) { if (!(m in k) && m in r) megtart[m] = r[m]; });
          var e = kollegaAlap(Object.assign({}, megtart, k, { szin: k.szin || r.szin }));
          aktivSorrend(e); return e;
        }));
        var szab = Object.assign({}, SZABALY_UJ_ALAP);
        Object.keys(SZABALY_UJ_ALAP).forEach(function (m) { if (regiT.szabalyok[m] !== undefined) szab[m] = regiT.szabalyok[m]; });
        szukitesOr(regiT.kollegak, kl);
        var regiS = {}; regiT.szolgaltatasok.forEach(function (x) { regiS[x.id] = x; });
        var szl = be.szolgaltatasok.map(function (x) {
          var kin = 'kinalas' in x ? x.kinalas : (regiS[x.id] || {}).kinalas, c = Object.assign({}, x);
          delete c.kinalas; if (kin != null) c.kinalas = kin; return c;
        });
        db.torzs = Object.assign({}, be, { szolgaltatasok: szl, kollegak: kl, szabalyok: Object.assign(szab, be.szabalyok) }); save(); return json(200, db.torzs);
      }
    }
    if (ut === 'kollegak' && method === 'PATCH') {
      var kk = q.get('kollega');
      if (!kk) throw hiba('Hiányzó paraméter: kollega.');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw hiba('Hibás kérés.');
      var uj = szinNormal(body.szin);
      if (!uj) throw hiba('Hibás szín: #rrggbb alakú hex kell, például #4f6d8a.');
      if (!T().kollegak.some(function (k) { return k.id === kk; })) throw HttpErr(404, 'Ismeretlen szakember.');
      db.torzs.kollegak = szinKioszt(T().kollegak.map(function (k) { return k.id === kk ? Object.assign({}, k, { szin: uj }) : k; }));
      save(); return json(200, { id: kk, szin: uj });
    }
    if (ut === 'beosztas') {
      if (method === 'GET') return json(200, beosztasLekerd(q.get('kollega')));
      if (method === 'PUT') return json(200, beosztasMent(q.get('kollega'), body));
    }
    if (ut === 'kivetelek') {
      if (method === 'GET') {
        var kt = q.get('tol') || '0000-01-01', ki = q.get('ig') || '9999-12-31';
        return json(200, { kivetelek: db.kivetelek.filter(function (k) { return k.ig >= kt && k.tol <= ki; })
          .sort(function (a, b) { return a.tol.localeCompare(b.tol) || (a.kezd || 0) - (b.kezd || 0); }).map(kiKivetel) });
      }
      if (method === 'POST') return json(201, kivetelFelvesz(body || {}));
      if (method === 'DELETE') {
        var did = q.get('id');
        if (!/^[0-9a-f-]{36}$/.test(String(did || ''))) throw hiba('Hibás azonosító.');
        var el = db.kivetelek.length;
        db.kivetelek = db.kivetelek.filter(function (k) { return k.id !== did; });
        if (db.kivetelek.length === el) throw HttpErr(404, 'Nincs ilyen kivétel.');
        save(); return json(200, { torolve: did });
      }
    }
    if (ut === 'foglalasok') {
      if (method === 'GET') { sorozatGordit(); return json(200, foglalasLista(q)); }
      if (method === 'POST') return json(201, foglal(foglalasBemenet(body || {}, true), true));
    }
    if (ut === 'outbox' && method === 'GET') {
      return json(200, { mod: 'outbox', levelek: db.outbox.map(function (o) {
        return { id: o.id, azonosito: o.booking_id, tipus: o.tipus, csoportos: !!o.csoportos || /^C/.test(String(o.booking_id || '')), sorozat: /^R/.test(String(o.booking_id || '')), cimzett: o.cimzett, targy: o.targy, html: o.html, szoveg: o.szoveg, ics: o.ics,
          elkuldve: o.sent === 1, sikertelen: o.sent === 2, hiba: null, probalkozas: 0, kuldve: null, letrehozva: new Date(o.created_at).toISOString() };
      }) });
    }
    return json(404, { error: 'Ismeretlen API-végpont.' });
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var u = new URL(url, location.href);
    if (!/\/(foglalas-api|api\/foglalo)(\/|$)/.test(u.pathname)) return realFetch(input, init);
    init = init || {};
    var method = (init.method || 'GET').toUpperCase(), body = null;
    if (init.body && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
    var res;
    try { res = kezel(u, method, body); } catch (e) {
      if (e && e.status) res = json(e.status, Object.assign({ error: e.message }, e.extra || {}));
      else { console.error('[foglalo-mock]', e); res = json(500, { error: 'Váratlan hiba történt a teszt-API-ban.' }); }
    }
    return kesleltet(res, method === 'GET' ? 160 : 520);
  };

  load();
  O();
  window.F360FoglaloMock = {
    db: function () { return db; },
    reset: function () { localStorage.removeItem(KEY); try { sessionStorage.removeItem(FLAG); } catch (e) { /* nincs */ } seed(); },
    utkozes: function () { sessionStorage.setItem(FLAG, '1'); },
    // az .ics a mockban nem letölthető URL (statikus szerver), ezért a foglaló ebből készít fájlt
    ics: function (token) {
      if (csoportosToken(token)) { var cb = O().foglalasok.filter(function (x) { return x.token === token; })[0]; return cb ? icsKeszit(cfIcs(cfNezet(cb)), linkek(cb.token).lemondasUrl) : ''; }
      var b = db.bookings.filter(function (x) { return x.token === token; })[0]; return b ? icsKeszit(nezet(b), linkek(b.token).lemondasUrl) : '';
    },
    token: function (azonosito) { var b = db.bookings.filter(function (x) { return x.id === azonosito; })[0] || (db.orak && db.orak.foglalasok.filter(function (x) { return x.id === azonosito; })[0]); return b && b.token; },
    // csoportos órák (tesztekhez): az órák listája és egy jelentkezés tokenje
    orak: function () { return O().sessions; },
    oraToken: function (kozeli) {
      var b = O().foglalasok.filter(function (x) {
        if (x.status !== 'megerositett') return false;
        var s = db.orak.sessions.filter(function (y) { return y.id === x.session; })[0], ms = helyiToUtc(s.datum, s.kezd) - Date.now();
        return kozeli ? ms > 30 * 60e3 && ms < 24 * 3600e3 : ms > 48 * 3600e3 && s.status === 'aktiv';
      })[0];
      return b && b.token;
    },
    // bemutatóhoz: egy lemondható és egy 24 órán belüli foglalás tokenje
    mintaToken: function (kozeli) {
      var b = db.bookings.filter(function (x) {
        if (x.status !== 'megerositett') return false;
        var ms = helyiToUtc(x.date, x.start_min) - Date.now();
        return kozeli ? ms > 30 * 60e3 && ms < 24 * 3600e3 : ms > 48 * 3600e3;
      })[0];
      return b && b.token;
    }
  };
})();
