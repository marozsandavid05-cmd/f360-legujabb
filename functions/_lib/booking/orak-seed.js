// Időpontfoglaló · csoportos órák kezdő adata (MINTA): a Mexikói út órarendje a mexikoi.html
// táblája szerint (oszloponként ellenőrizve), az árak az arak.html szerint.
// MINDEN itt MINTA: a kapacitás (alap 8, aerial 6) és a nem az Árak oldalon szereplő órák ára
// Lillától megerősítendő; az adminban (/api/foglalo/ora-tipusok, /api/foglalo/ora-sablonok) szerkeszthető.
// Csak egyszer kerül be (settings `orak:seed` jelző), így a törölt sablon nem jön vissza.

const t = (id, nev, kategoria, perc, ar, { arMegerositendo = false, leiras = '' } = {}) => ({
  id, nev, kategoria, perc, ar, helyszin: 'mexikoi', kapacitas: kategoria === 'aerial' ? 6 : 8,
  kapacitas_megerositendo: true, ar_megerositendo: arMegerositendo, leiras, aktiv: true,
});

// MINTA
export const ORA_TIPUSOK = [
  t('csiponyito-joga', 'Csípőnyitó jóga', 'joga', 60, 4000, { arMegerositendo: true }),
  t('aerial-yoga-trapeze', 'Aerial yoga trapeze', 'aerial', 60, 4700),
  t('core-trening', 'Core tréning', 'core', 60, 4000),
  t('slow-flow', 'Slow Flow', 'joga', 60, 4000, { arMegerositendo: true }),
  t('pilates', 'Pilates', 'pilates', 60, 4000),
  t('gerinctorna', 'Gerinctorna', 'gerinc', 60, 4000, { arMegerositendo: true }),
  t('gyertyafenyes-gerincjoga', 'Gyertyafényes gerincjóga', 'joga', 60, 4000, { arMegerositendo: true }),
  t('yin-joga', 'Yin jóga', 'joga', 90, 4000),
  t('funkcionalis-trening', 'Funkcionális tréning', 'egyeb', 60, 4000),
  t('hatha-joga', 'Hatha jóga', 'joga', 60, 4000),
  t('aerial-slow-flow', 'Aerial slow flow', 'aerial', 60, 4700),
  t('gyerek-core-trening', 'Gyerek core tréning', 'core', 45, 4000, { arMegerositendo: true }),
];

const s = (ora, nap, kezd, kollega) => ({ id: `${ora}-${nap}-${kezd.replace(':', '')}`, ora, nap, kezd, kollega });

// MINTA heti órarend (nap 1 = hétfő). A szerdai gyertyafényes gerincjógánál a táblában nincs név,
// a csütörtöki funkcionális tréningnek nincs oktatója (üres): mindkettő Lillától megerősítendő.
export const ORA_SABLONOK = [
  s('csiponyito-joga', 1, '09:00', 'aczel-gabriella'),
  s('gyerek-core-trening', 1, '17:00', 'vas-luca'),
  s('aerial-yoga-trapeze', 1, '18:15', 'barkoczy-barbara'),
  s('core-trening', 2, '07:30', 'vas-luca'),
  s('slow-flow', 2, '19:30', 'barkoczy-barbara'),
  s('pilates', 3, '09:30', 'vas-luca'),
  s('gerinctorna', 3, '17:00', 'vas-luca'),
  s('gyertyafenyes-gerincjoga', 3, '20:00', 'aczel-gabriella'),
  s('yin-joga', 4, '10:00', 'aczel-gabriella'),
  s('funkcionalis-trening', 4, '17:00', null),
  s('hatha-joga', 5, '09:00', 'aczel-gabriella'),
  s('aerial-yoga-trapeze', 5, '18:15', 'barkoczy-barbara'),
  s('aerial-slow-flow', 6, '10:00', 'barkoczy-barbara'),
];
