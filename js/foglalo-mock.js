/* =====================================================================
   STUDIO F360 · IDŐPONTFOGLALÓ · foglalo-mock.js
   CSAK HELYI TESZTHEZ ÉS BEMUTATÓHOZ. A foglalas.js és az admin.js csak
   ?mock=1 mellett vagy file://-ról tölti be, élesben nem töltődik le.
   A backend (ág foglalo, d0f50c1) PONTOS másolata böngészőben:
     functions/_lib/booking/{foglalas,admin,szabad,levelek,levelek-kollega,emlekezteto,forras,torzs-alap,ics,seed}.js
     nyilvános: /foglalas-api/katalogus | szabad | foglalas (GET ?t= is) | lemondas | modositas | foglalas.ics
     admin:     /api/foglalo/beallitasok | kollegak (POST, PATCH /:id, POST /:id/archivalas) | beosztas
                | kivetelek | foglalasok | szabad | outbox | emlekezteto/futtat | riport/forrasok
   Ha a backend változik, ezt a fájlt is hozzá kell igazítani.
   Az adat a localStorage-ban él (a foglaló és az admin ugyanazt látja).
   Alaphelyzet: F360FoglaloMock.reset(). Ütközés-próba: ?utkozes=1 (a következő
   foglalás időpontját „közben” elviszi valaki, a válasz 409).
   Előfeltétel: js/foglalo-kozos.js (window.F360Foglalo).
   ===================================================================== */
(function () {
  'use strict';

  var F = window.F360Foglalo;
  var KEY = 'f360-foglalo-mock-v2';
  var FLAG = 'f360-foglalo-mock-utkozes';
  var script = document.currentScript;
  var ROOT = new URL('../', script ? script.src : location.href).href; // a webhely gyökere (js/ fölött)
  var ORIGIN = ROOT.replace(/\/$/, '');
  var realFetch = window.fetch.bind(window);
  var RACS = 15;

  if (/[?&]utkozes=1(&|$)/.test(location.search)) { try { sessionStorage.setItem(FLAG, '1'); } catch (e) { /* nincs */ } }

  /* ---------------- MINTA törzsadat = a backend seed.js-e ---------------- */
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
        { id: 'gepi-nyirokmasszazs', nev: 'Gépi nyirokmasszázs, nyirokcsizma', perc: 45, ar: 10000, puffer: 10, helyszinek: ['reitter'] }
      ],
      kollegak: [
        { id: 'kodacsine-labancz-agnes', szin: '#4f6d8a', nev: 'Kodácsiné Labancz Ágnes', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'] },
        { id: 'vas-luca', szin: '#a0553c', nev: 'Vas Luca', szerep: 'gyógytornász, perinatális tréner', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna', 'kismama-masszazs'] },
        { id: 'szegedi-botond', szin: '#5b7d55', nev: 'Szegedi Botond', szerep: 'gyógymasszőr, nyirokmasszőr, sportmasszőr', helyszinek: ['mexikoi', 'reitter'],
          szolgaltatasok: ['gyogymasszazs-50', 'gyogymasszazs-90', 'relaxalo-masszazs', 'nyirokmasszazs-teljes', 'kismama-masszazs', 'sportmasszazs', 'gepi-nyirokmasszazs'] },
        { id: 'adorjani-anna', szin: '#7d5a8e', nev: 'Adorjáni Anna', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna'] },
        { id: 'kovacs-sebestyen', szin: '#8c6b2a', nev: 'Kovács Sebestyén', szerep: 'gyógytornász, sportrehabilitáció', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna', 'kinvent-pro', 'gepi-nyirokmasszazs'] },
        { id: 'osvath-bence', szin: '#2f6e6e', nev: 'Osváth Bence', szerep: 'személyi edző, erőnléti edző', helyszinek: ['reitter'], szolgaltatasok: ['kinvent-pro'] }
      ],
      szabalyok: { minEloreOra: 2, maxEloreNap: 60, lemondasOra: 24, telefon: '+36 30 503 0578', studioEmail: 'info@f360.hu' }
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
    try { var raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); if (db && db.v === 2) { szinPotol(); db.torzs = torzsAlap(db.torzs); return; } } } catch (e) { /* sérült */ }
    seed();
  }
  /* ---------------- torzs-alap.js: a kolléga Lilla-kör mezői és az új szabályok ---------------- */
  var KOLLEGA_UJ_MEZOK = ['email', 'aktiv_tol', 'aktiv_ig', 'foto', 'bemutatkozas', 'archivalt'];
  var SZABALY_UJ_ALAP = { ertesitKollega: true, emlekeztetoBe: true, emlekeztetoOra: 30 };
  function kollegaAlap(k) {
    return Object.assign({}, k, {
      email: typeof k.email === 'string' ? k.email : '', aktiv_tol: typeof k.aktiv_tol === 'string' ? k.aktiv_tol : '',
      aktiv_ig: typeof k.aktiv_ig === 'string' ? k.aktiv_ig : '', foto: typeof k.foto === 'string' ? k.foto : '',
      bemutatkozas: typeof k.bemutatkozas === 'string' ? k.bemutatkozas : '', archivalt: k.archivalt === true
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
  function T() { if (!db.torzs.szabalyok || db.torzs.szabalyok.emlekeztetoOra == null || db.torzs.kollegak.some(function (k) { return k.archivalt == null; })) db.torzs = torzsAlap(db.torzs); return db.torzs; }
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
    var nyit = F.perc(hely.nyit), zar = F.perc(hely.zar);
    osszes.forEach(function (datum) {
      if (datum > utolso) return;
      if (helyiToUtc(datum, 24 * 60 - 1) <= legkorabbi) return;
      var nap = hetNapja(datum), kezdesek = {};
      // belépés előtt és kilépés után a kolléga nem foglalható (a „bárki” sem osztja rá)
      jeloltek.filter(function (k) { return aktivANapon(k, datum); }).map(function (k) { return k.id; }).forEach(function (kid) {
        db.beosztas.forEach(function (b) {
          if (b.kollega !== kid || b.nap !== nap || b.helyszin !== o.helyszin) return;
          var t0 = Math.max(b.kezd, nyit), i0 = Math.min(b.veg, zar);
          for (var k = Math.ceil(t0 / RACS) * RACS; k + szolg.perc <= i0; k += RACS) {
            if (helyiToUtc(datum, k) < legkorabbi) continue;
            if (kivetelUtkozik(o.kivetelek || db.kivetelek, { kollega: kid, helyszin: o.helyszin, datum: datum, kezd: k, veg: k + szolg.perc })) continue;
            var sl = foglalasSlotjai({ kollega: kid, datum: datum, kezd: k, perc: szolg.perc, puffer: puffer });
            if (sl.some(function (s) { return fs[kid + '|' + datum + '|' + s.slot]; })) continue;
            (kezdesek[k] = kezdesek[k] || []).indexOf(kid) < 0 && kezdesek[k].push(kid);
          }
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
  function visszaigazolas(f, o) {
    var sz = o.szabalyok, targy = 'Időpontfoglalás visszaigazolása · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · Studio F360';
    var g = F.googleNaptarUrl(f, o.lemondasUrl);
    var html = keret(targy, '<p>Kedves ' + esc(f.nev) + '!</p><p>Köszönjük a foglalásodat, az időpontodat rögzítettük.</p>' + adatTabla(f) +
      naptarHtml(o.icsUrl, g) + kezeloHtml(o.lemondasUrl, sz) + '<p>Várunk szeretettel,<br>a Studio F360 csapata</p>');
    var szoveg = 'Kedves ' + f.nev + '!\n\nKöszönjük a foglalásodat, az időpontodat rögzítettük.\n\n' + adatSzoveg(f) + '\n\n' + naptarSzoveg(o.icsUrl, g) +
      '\n\n' + kezeloSzoveg(o.lemondasUrl, sz) + '\n\nVárunk szeretettel,\na Studio F360 csapata\n';
    return { tipus: 'visszaigazolas', cimzett: f.email, targy: targy, html: html, szoveg: szoveg, ics: o.ics };
  }
  function modositasLevel(f, o) {
    var sz = o.szabalyok, targy = 'Időpont módosítva · ' + szepDatum(f.datum) + ' ' + f.kezd + ' · Studio F360';
    var g = F.googleNaptarUrl(f, o.lemondasUrl);
    var html = keret(targy, '<p>Kedves ' + esc(f.nev) + '!</p><p>Az időpontodat módosítottuk. A korábbi időpont (' + esc(regiIdopont(o.regi)) + ') már nem érvényes, az új:</p>' +
      adatTabla(f) + naptarHtml(o.icsUrl, g) + '<p>Ha a naptáradban a korábbi időpont is szerepel, azt töröld.</p>' + kezeloHtml(o.lemondasUrl, sz) +
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
      szolgaltatas: { id: szolg.id, nev: szolg.nev, perc: r.dur_min, ar: r.price }, kollega: koll.szin ? { id: koll.id, nev: koll.nev, szin: koll.szin } : { id: koll.id, nev: koll.nev },
      datum: r.date, kezd: hm(r.start_min), veg: hm(r.start_min + r.dur_min), kezdPerc: r.start_min,
      nev: r.name, email: r.email, telefon: r.phone, megjegyzes: r.note, forras: r.source
    };
  }
  function publikusNezet(f) {
    return { azonosito: f.azonosito, allapot: f.allapot, helyszin: f.helyszin, szolgaltatas: f.szolgaltatas, kollega: { id: f.kollega.id, nev: f.kollega.nev }, datum: f.datum, kezd: f.kezd, veg: f.veg, nev: f.nev };
  }
  function katalogus() {
    var t = T();
    return {
      minta: t.minta === true,
      helyszinek: t.helyszinek.map(function (h) { return { id: h.id, nev: h.nev, cim: h.cim, nyit: h.nyit, zar: h.zar }; }),
      szolgaltatasok: t.szolgaltatasok.map(function (s) { return { id: s.id, nev: s.nev, perc: s.perc, ar: s.ar, helyszinek: s.helyszinek }; }),
      // az archivált és a már kilépett kolléga nem látszik; a privát e-mail soha nem kerül ide
      kollegak: t.kollegak.filter(function (k) { return k.archivalt !== true && !(k.aktiv_ig && k.aktiv_ig < F.most().datum); })
        .map(function (k) { return { id: k.id, nev: k.nev, szerep: k.szerep, helyszinek: k.helyszinek, szolgaltatasok: k.szolgaltatasok, foto: k.foto, bemutatkozas: k.bemutatkozas }; }),
      szabalyok: { lemondasOra: t.szabalyok.lemondasOra, minEloreOra: t.szabalyok.minEloreOra, maxEloreNap: t.szabalyok.maxEloreNap, telefon: t.szabalyok.telefon }
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
      db.outbox.unshift({ id: ++db.seq, booking_id: bookingId, tipus: l.tipus, cimzett: l.cimzett, targy: l.targy, html: l.html, szoveg: l.szoveg, ics: l.ics || null, sent: 0, created_at: Date.now() });
    });
    if (db.outbox.length > 100) db.outbox.length = 100;
  }
  function foglal(be, admin) {
    var r = hivatkozasok(be), hely = r.hely, szolg = r.szolg, t = T();
    var szT = admin ? Object.assign({}, t, { szabalyok: Object.assign({}, t.szabalyok, { minEloreOra: 0, maxEloreNap: 3660 }) }) : t;
    var kezd = hm(be.kezdPerc);
    var alap = { torzs: szT, helyszin: be.helyszin, szolgaltatas: be.szolgaltatas, kollega: be.kollega, tol: be.datum, ig: be.datum };
    var beoSz = (szabadIdopontok(Object.assign({}, alap, { foglalt: [] })).napok[be.datum] || []).filter(function (s) { return s.kezd === kezd; })[0];
    if (!beoSz) throw HttpErr(409, 'Ez az időpont nem foglalható. Kérjük, válassz a szabad időpontok közül.');
    // ütközés-próba: a kért időpontot „közben” elviszi egy másik vendég (mindegyik jelöltnél)
    var utk = false;
    if (!admin) { try { utk = sessionStorage.getItem(FLAG) === '1'; if (utk) sessionStorage.removeItem(FLAG); } catch (e) { /* nincs */ } }
    if (utk) {
      beoSz.kollegak.forEach(function (kid) {
        db.bookings.push(sor({ kollega: kid, datum: be.datum, kezdPerc: be.kezdPerc, szolg: szolg, hely: hely, nev: 'Farkas Dóra', email: 'dora.farkas@gmail.com', telefon: '+36 30 412 7781', megjegyzes: '', source: 'web' }));
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
    if (admin) t = Object.assign({}, t, { szabalyok: Object.assign({}, t.szabalyok, { minEloreOra: 0, maxEloreNap: 3660 }) });
    if (row) t = Object.assign({}, t, { szolgaltatasok: t.szolgaltatasok.map(function (s) { return s.id === row.service_id ? Object.assign({}, s, { perc: row.dur_min, puffer: row.buffer_min }) : s; }) });
    return t;
  }
  function modosit(row, be, admin) {
    modosithatoAllapot(row, admin);
    hivatkozasok({ helyszin: row.location_id, szolgaltatas: row.service_id, kollega: be.kollega });
    if (be.datum === row.date && be.kezdPerc === row.start_min && (be.kollega === 'barki' || be.kollega === row.staff_id)) throw HttpErr(400, 'Ez a jelenlegi időpontod. Válassz másikat.');
    var t = T(), szT = szamitasra(admin, row), kezd = hm(be.kezdPerc);
    var alap = { torzs: szT, helyszin: row.location_id, szolgaltatas: row.service_id, kollega: be.kollega, tol: be.datum, ig: be.datum };
    var beoSz = (szabadIdopontok(Object.assign({}, alap, { foglalt: [] })).napok[be.datum] || []).filter(function (s) { return s.kezd === kezd; })[0];
    if (!beoSz) throw HttpErr(409, 'Ez az időpont nem foglalható. Kérjük, válassz a szabad időpontok közül.');
    // ütközés-próba: ?utkozes=1 mellett az új időpontot „közben” elviszi valaki (mindegyik jelöltnél)
    var utk = false;
    if (!admin) { try { utk = sessionStorage.getItem(FLAG) === '1'; if (utk) sessionStorage.removeItem(FLAG); } catch (e) { /* nincs */ } }
    if (utk) {
      var r0 = hivatkozasok({ helyszin: row.location_id, szolgaltatas: row.service_id, kollega: 'barki' });
      beoSz.kollegak.forEach(function (kid) {
        db.bookings.push(sor({ kollega: kid, datum: be.datum, kezdPerc: be.kezdPerc, szolg: r0.szolg, hely: r0.hely, nev: 'Farkas Dóra', email: 'dora.farkas@gmail.com', telefon: '+36 30 412 7781', megjegyzes: '', source: 'web' }));
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
  function foglalasId(id) {
    var r = /^F[0-9A-Z]{10}$/.test(String(id || '')) ? db.bookings.filter(function (b) { return b.id === id; })[0] : null;
    if (!r) throw HttpErr(404, 'Nincs ilyen foglalás.');
    return r;
  }

  /* ---------------- admin.js ---------------- */
  var ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
  function hiba(m) { return HttpErr(400, m); }
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
      return { id: s.id, nev: str(s.nev, 'név', 120), perc: perc, ar: s.ar == null ? null : egesz(s.ar, 'ár', 0, 10000000),
        puffer: s.puffer == null ? 10 : egesz(s.puffer, 'puffer', 0, 120), helyszinek: idLista(s.helyszinek, 'szolgáltatás helyszínei', hIds) };
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
      f.letrehozva = new Date(r.created_at).toISOString(); f.lemondva = r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null;
      return f;
    }) };
  }

  /* ---------------- minta-foglalások, hogy a naptár élő legyen ---------------- */
  var VEZ = ['Nagy', 'Kovács', 'Tóth', 'Szabó', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp', 'Takács', 'Juhász', 'Mészáros', 'Simon', 'Rácz', 'Fekete'];
  var KER = ['Eszter', 'Bence', 'Réka', 'Dániel', 'Zsófia', 'Gergely', 'Dóra', 'Márton', 'Kinga', 'Ádám', 'Petra', 'Levente', 'Nóra', 'Tamás', 'Judit', 'Balázs', 'Viktória', 'Anikó'];
  function prng(s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function asc(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function seed() {
    var ma = F.most().datum;
    db = { v: 2, seq: 0, torzs: torzsAlap(seedTorzs()), beosztas: seedBeosztas(), kivetelek: [], bookings: [], outbox: [] };
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
            var vn = VEZ[Math.floor(r() * VEZ.length)], kn = KER[Math.floor(r() * KER.length)];
            var rec = sor({ kollega: k.id, datum: d, kezdPerc: tt, szolg: s, hely: t.helyszinek.filter(function (h) { return h.id === b.helyszin; })[0],
              nev: vn + ' ' + kn, email: asc(kn) + '.' + asc(vn) + '@gmail.com',
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

  /* ---------------- HTTP ---------------- */
  function json(status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
  function kesleltet(res, ms) { return new Promise(function (ok) { setTimeout(function () { ok(res); }, ms); }); }

  function kezel(u, method, body) {
    var p = u.pathname, q = u.searchParams, m;
    /* ---- nyilvános ---- */
    if (/\/foglalas-api\//.test(p)) {
      var nev = p.replace(/^.*\/foglalas-api\/?/, '').replace(/\/+$/, '');
      if (nev === 'katalogus' && method === 'GET') return json(200, katalogus());
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
    if (ut === 'szabad' && method === 'GET') return json(200, szabadModositashoz(foglalasId(q.get('foglalas')), q, true));
    if (ut === 'beallitasok') {
      if (method === 'GET') return json(200, T());
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
        db.torzs = Object.assign({}, be, { kollegak: kl, szabalyok: Object.assign(szab, be.szabalyok) }); save(); return json(200, db.torzs);
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
      if (method === 'GET') return json(200, foglalasLista(q));
      if (method === 'POST') return json(201, foglal(foglalasBemenet(body || {}, true), true));
    }
    if (ut === 'outbox' && method === 'GET') {
      return json(200, { mod: 'outbox', levelek: db.outbox.map(function (o) {
        return { id: o.id, azonosito: o.booking_id, tipus: o.tipus, cimzett: o.cimzett, targy: o.targy, html: o.html, szoveg: o.szoveg, ics: o.ics,
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
  window.F360FoglaloMock = {
    db: function () { return db; },
    reset: function () { localStorage.removeItem(KEY); try { sessionStorage.removeItem(FLAG); } catch (e) { /* nincs */ } seed(); },
    utkozes: function () { sessionStorage.setItem(FLAG, '1'); },
    // az .ics a mockban nem letölthető URL (statikus szerver), ezért a foglaló ebből készít fájlt
    ics: function (token) { var b = db.bookings.filter(function (x) { return x.token === token; })[0]; return b ? icsKeszit(nezet(b), linkek(b.token).lemondasUrl) : ''; },
    token: function (azonosito) { var b = db.bookings.filter(function (x) { return x.id === azonosito; })[0]; return b && b.token; },
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
