/* =====================================================================
   STUDIO F360 · IDŐPONTFOGLALÓ · foglalo-kozos.js
   Közös segédek a nyilvános foglalóhoz (foglalas.html) és az adminhoz:
   Budapest-idő, dátum-formázás, ár, .ics-letöltés. A levelek szövegét a
   backend írja (functions/_lib/booking/levelek.js), a felület csak megmutatja.
   Keretrendszer nélkül, globális: window.F360Foglalo.
   Minden időpont Europe/Budapest helyi idő: datum 'YYYY-MM-DD' + perc (éjfél óta).
   ===================================================================== */
(function (g) {
  'use strict';

  var TZ = 'Europe/Budapest';
  var TELEFON = '+36 30 503 0578';
  var TELEFON_HREF = 'tel:+36305030578';
  var NAPOK = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  var NAPOK_ROVID = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
  var HONAPOK = ['január', 'február', 'március', 'április', 'május', 'június',
    'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- Budapest-idő ---------- */
  function partsIn(date) {
    var p = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  // most Budapesten: { datum, perc }
  function most() {
    var p = partsIn(new Date());
    return { datum: p.year + '-' + p.month + '-' + p.day, perc: Number(p.hour) * 60 + Number(p.minute) };
  }
  // helyi (Budapest) datum + perc → UTC Date
  function utcDate(datum, perc) {
    var d = datum.split('-').map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], Math.floor(perc / 60), perc % 60);
    for (var i = 0; i < 2; i++) {
      var p = partsIn(new Date(guess));
      var asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
      var want = Date.UTC(d[0], d[1] - 1, d[2], Math.floor(perc / 60), perc % 60);
      guess += want - asUtc;
    }
    return new Date(guess);
  }
  // perc a mostani pillanattól a megadott helyi időpontig
  function percIg(datum, perc) {
    return Math.round((utcDate(datum, perc).getTime() - Date.now()) / 60000);
  }

  /* ---------- dátum ---------- */
  function addDays(iso, n) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function hetNapja(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); } // 0 = vasárnap
  function hetfo(iso) { var w = hetNapja(iso); return addDays(iso, w === 0 ? -6 : 1 - w); }
  function napKulonbseg(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
  function hm(perc) { return Math.floor(perc / 60) + ':' + pad(perc % 60); }
  function hm2(perc) { return pad(Math.floor(perc / 60)) + ':' + pad(perc % 60); }
  function perc(hmStr) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hmStr || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }
  function honapNap(iso) {
    var d = iso.split('-').map(Number);
    return HONAPOK[d[1] - 1] + ' ' + d[2] + '.';
  }
  // „szeptember 29., kedd”
  function datumNap(iso) { return honapNap(iso) + ', ' + NAPOK[hetNapja(iso)]; }
  // „2026. szeptember 29., kedd”
  function datumHosszu(iso) { return iso.slice(0, 4) + '. ' + datumNap(iso); }
  // „kedden” / „szerdán” (ragozott napnév a köszönő mondathoz)
  var NAPON = ['vasárnap', 'hétfőn', 'kedden', 'szerdán', 'csütörtökön', 'pénteken', 'szombaton'];
  function napon(iso) { return NAPON[hetNapja(iso)]; }
  // „szeptember 29-én”
  function honapNapRagos(iso) {
    var d = iso.split('-').map(Number);
    var n = d[2];
    var rag = { 1: 'jén', 2: 'án', 3: 'án', 4: 'én', 5: 'én', 6: 'án', 7: 'én', 8: 'án', 9: 'én', 10: 'én',
      11: 'én', 12: 'én', 13: 'án', 14: 'én', 15: 'én', 16: 'án', 17: 'én', 18: 'án', 19: 'én', 20: 'án',
      21: 'én', 22: 'én', 23: 'án', 24: 'én', 25: 'én', 26: 'án', 27: 'én', 28: 'án', 29: 'én', 30: 'án', 31: 'én' }[n];
    return HONAPOK[d[1] - 1] + ' ' + n + '-' + rag;
  }
  // „9:15-kor” (a -kor rag nem illeszkedik, mindig -kor)
  function idoKor(perc) { return hm(perc) + '-kor'; }

  /* ---------- pénz, szöveg ---------- */
  function ft(n) {
    if (n === null || n === undefined || n === '') return '';
    return Number(n).toLocaleString('hu-HU').replace(/\s/g, '\u00a0') + '\u00a0Ft';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nev(x) { return x && typeof x === 'object' ? (x.nev || x.id || '') : (x || ''); }
  function id(x) { return x && typeof x === 'object' ? x.id : x; }

  /* ---------- .ics letöltés (a mockban nincs letölthető URL, ott a szövegből készül fájl) ---------- */
  function icsLetolt(szoveg, fajlnev) {
    var blob = new Blob([szoveg], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fajlnev || 'studio-f360-foglalas.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  g.F360Foglalo = {
    TZ: TZ, TELEFON: TELEFON, TELEFON_HREF: TELEFON_HREF,
    NAPOK: NAPOK, NAPOK_ROVID: NAPOK_ROVID, HONAPOK: HONAPOK,
    most: most, utcDate: utcDate, percIg: percIg,
    addDays: addDays, hetNapja: hetNapja, hetfo: hetfo, napKulonbseg: napKulonbseg,
    hm: hm, hm2: hm2, perc: perc, honapNap: honapNap, datumNap: datumNap, datumHosszu: datumHosszu,
    napon: napon, honapNapRagos: honapNapRagos, idoKor: idoKor,
    ft: ft, esc: esc, nev: nev, id: id,
    icsLetolt: icsLetolt
  };
})(window);
