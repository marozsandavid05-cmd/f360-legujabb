/* =====================================================================
   STUDIO F360 · ADMIN · nyitvatartas.js
   A helyszín napi nyitvatartásának adatkezelése a Beállítások fülhöz
   (a felületet a foglalo.js rajzolja). Tiszta függvények, DOM nélkül,
   hogy Node-ban is tesztelhetők legyenek (tests/admin-nyitvatartas.test.mjs).
   Formátum = a backend admin.js napiNyitvatartasEllenoriz szerint:
     napiNyitvatartas: { '1'-'7': { nyit:'HH:MM', zar:'HH:MM' } | null }
   1 = hétfő ... 7 = vasárnap. Hiányzó nap: az alap nyit/zar szerint nyitva.
   null: aznap zárva. Üresen a mező nem marad meg (a backend is null-ra veszi).
   ===================================================================== */
(function (g) {
  'use strict';

  var NAPOK = [[1, 'Hétfő'], [2, 'Kedd'], [3, 'Szerda'], [4, 'Csütörtök'], [5, 'Péntek'], [6, 'Szombat'], [7, 'Vasárnap']];
  // a backend (ido.js hhmmToPerc) a nyitást és a zárást csak negyedórás rácson fogadja el
  // (a kezdések rácsa 15 perc, a zárak 5 percesek), ezért a választó is 15 perces lépésű
  var RACS = 15;
  var IDO = (function () {
    var o = [];
    for (var t = 6 * 60; t <= 22 * 60; t += RACS) o.push((t < 600 ? '0' : '') + Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + t % 60);
    return o;
  })();
  var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  function perc(hm) { if (!HHMM.test(hm)) return null; var p = +hm.slice(0, 2) * 60 + +hm.slice(3); return p % RACS === 0 ? p : null; }
  function van(h, n) { return !!h.napiNyitvatartas && Object.prototype.hasOwnProperty.call(h.napiNyitvatartas, String(n)); }

  /** Egy nap állapota: nyitva-e, mettől meddig, és saját (eltérő) beállítás-e vagy az alap szerint megy. */
  function nap(h, n) {
    if (!van(h, n)) return { nyitva: true, nyit: h.nyit, zar: h.zar, sajat: false };
    var x = h.napiNyitvatartas[String(n)];
    if (!x) return { nyitva: false, nyit: h.nyit, zar: h.zar, sajat: true };
    return { nyitva: true, nyit: x.nyit, zar: x.zar, sajat: true };
  }

  function rendez(h) {
    var o = h.napiNyitvatartas;
    if (!o) return;
    var ki = {};
    NAPOK.forEach(function (d) { var k = String(d[0]); if (Object.prototype.hasOwnProperty.call(o, k)) ki[k] = o[k]; });
    if (Object.keys(ki).length) h.napiNyitvatartas = ki; else delete h.napiNyitvatartas;
  }

  /** A nap visszaáll az alapra (nincs külön bejegyzés). */
  function alapra(h, n) {
    if (h.napiNyitvatartas) delete h.napiNyitvatartas[String(n)];
    rendez(h);
  }

  /**
   * Egy nap módosítása. valt = { nyitva?, nyit?, zar? }: a meg nem adott mező a nap eddigi értéke marad.
   * Zárva = null; az alappal pontosan egyező nyitott nap nem kap külön bejegyzést (így az alap
   * későbbi módosítását követi).
   */
  function beallit(h, n, valt) {
    var most = nap(h, n);
    var nyitva = valt.nyitva == null ? most.nyitva : !!valt.nyitva;
    if (!nyitva) {
      h.napiNyitvatartas = h.napiNyitvatartas || {};
      h.napiNyitvatartas[String(n)] = null;
      return rendez(h);
    }
    var ny = valt.nyit || most.nyit, z = valt.zar || most.zar;
    if (ny === h.nyit && z === h.zar) return alapra(h, n);
    h.napiNyitvatartas = h.napiNyitvatartas || {};
    h.napiNyitvatartas[String(n)] = { nyit: ny, zar: z };
    rendez(h);
  }

  /** Mentés előtti ellenőrzés magyarul; üres szöveg = rendben. */
  function ellenoriz(h) {
    var nev = h.nev || h.id || 'Helyszín';
    var o = h.napiNyitvatartas || {};
    for (var i = 0; i < NAPOK.length; i++) {
      var k = String(NAPOK[i][0]);
      if (!Object.prototype.hasOwnProperty.call(o, k) || o[k] === null) continue;
      var a = perc(o[k].nyit), b = perc(o[k].zar);
      if (a == null || b == null) return nev + ', ' + NAPOK[i][1].toLowerCase() + ': a nyitás és a zárás negyedórás lehet (például 8:00, 8:15, 8:30).';
      if (a >= b) return nev + ', ' + NAPOK[i][1].toLowerCase() + ': a zárás legyen későbbi a nyitásnál.';
    }
    return '';
  }

  /** Rövid, ember által olvasható összefoglaló a helyszín hetéről („Hétfő-péntek 07:00-21:00, szombat 08:00-14:00, vasárnap zárva”). */
  function osszegzes(h) {
    var cs = [];
    NAPOK.forEach(function (d) {
      var x = nap(h, d[0]), kulcs = x.nyitva ? x.nyit + '-' + x.zar : 'zárva', u = cs[cs.length - 1];
      if (u && u.kulcs === kulcs) u.ig = d; else cs.push({ kulcs: kulcs, tol: d, ig: d });
    });
    return cs.map(function (c, i) {
      var nev = c.tol[0] === c.ig[0] ? c.tol[1] : c.tol[1] + '-' + c.ig[1].toLowerCase();
      if (i) nev = nev.charAt(0).toLowerCase() + nev.slice(1);
      return nev + ' ' + c.kulcs;
    }).join(', ');
  }

  g.F360Nyitva = { NAPOK: NAPOK, IDO: IDO, nap: nap, beallit: beallit, alapra: alapra, ellenoriz: ellenoriz, osszegzes: osszegzes };
})(window);
