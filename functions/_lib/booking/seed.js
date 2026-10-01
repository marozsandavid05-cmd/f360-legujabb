// Időpontfoglaló · MINTA törzsadat a bemutatóhoz.
// MINDEN itt MINTA: a helyszínek és árak az arak.html szerint, a kollégák a rolunk.html szerint,
// de a szolgáltatás ↔ kolléga összerendelés és a heti beosztás kitalált. Lilla adja meg a valódit,
// az adminban (/api/foglalo/beallitasok, /api/foglalo/beosztas) szerkeszthető.
// A seed csak akkor kerül be, ha az adatbázisban még nincs törzsadat; a szerkesztettet nem írja felül.

// A taplalkozas.html „Mérés előtt” listája szó szerint: az InBody-mérést tartalmazó foglalás
// visszaigazolójába kerül (a szolgáltatás `elokeszites` mezője).
export const MERES_ELOTT = Object.freeze([
  'a mérés előtt 2 órával már ne étkezz',
  'csak tiszta víz vagy ízesítetlen tea',
  'előtte pár órával ne végezz megerőltető edzést',
  'fém ékszereket vedd le',
  'a mérés fehérneműben történik',
]);

// MINTA
export const SEED_TORZS = {
  minta: true,
  helyszinek: [
    { id: 'mexikoi', nev: 'Mexikói út', cim: 'Mexikói út 32/b, XIV. kerület', nyit: '07:00', zar: '21:00' },
    { id: 'reitter', nev: 'Reitter Ferenc utca', cim: 'Reitter Ferenc utca 48., XIII. kerület', nyit: '08:00', zar: '20:00' },
  ],
  // perc és ár az arak.html szerint; puffer = szünet a következő foglalásig (alap 10 perc)
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
    // táplálkozás (Kovács Anna, Mexikói út), az arak.html szerint; az időtartam Lillától megerősítendő
    {
      id: 'taplalkozas-alapcsomag', nev: 'Táplálkozási alapcsomag (felmérés + InBody + 3 konzultáció)', perc: 60, ar: 60000, puffer: 10, helyszinek: ['mexikoi'],
      leiras: 'Az alapcsomag további 3 konzultációját az első alkalmon egyeztetjük.', elokeszites: MERES_ELOTT, idotartam_megerositendo: true,
    },
    { id: 'taplalkozas-kiegeszito', nev: 'Kiegészítő tanácsadás', perc: 45, ar: 10000, puffer: 10, helyszinek: ['mexikoi'], idotartam_megerositendo: true },
    {
      id: 'inbody-770', nev: 'InBody 770 testösszetétel-elemzés, önálló', perc: 20, ar: 10000, puffer: 10, helyszinek: ['mexikoi'],
      elokeszites: MERES_ELOTT, idotartam_megerositendo: true,
    },
  ],
  // a rolunk.html csapata (9 szakember). A jógaoktatók (Barbara, Gabriella) csoportos órát tartanak,
  // egyéni szolgáltatásuk nincs. Kovács Annának nincs kitalált beosztása: Lilla adja meg az adminban.
  // szin: az admin naptárában a kolléga színe, a szin.js PALETTA elemei sorban (egyediek).
  // foto: a Rólunk oldal portréja (media/brand/csapat/), Kovács Sebestyénnek nincs.
  kollegak: [
    { id: 'kodacsine-labancz-agnes', szin: '#4f6d8a', nev: 'Kodácsiné Labancz Ágnes', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'], foto: '/media/brand/csapat/kodacsine-labancz-agnes.jpg' },
    { id: 'vas-luca', szin: '#a0553c', nev: 'Vas Luca', szerep: 'gyógytornász, perinatális tréner, SEAS terapeuta', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna', 'kismama-masszazs'], foto: '/media/brand/csapat/vas-luca.jpg' },
    {
      id: 'szegedi-botond', szin: '#5b7d55', nev: 'Szegedi Botond', szerep: 'gyógymasszőr, nyirokmasszőr (Mexikói út), sportmasszőr (Reitter)', helyszinek: ['mexikoi', 'reitter'],
      szolgaltatasok: ['gyogymasszazs-50', 'gyogymasszazs-90', 'relaxalo-masszazs', 'nyirokmasszazs-teljes', 'kismama-masszazs', 'sportmasszazs', 'gepi-nyirokmasszazs'],
      foto: '/media/brand/csapat/szegedi-botond.jpg',
    },
    { id: 'adorjani-anna', szin: '#7d5a8e', nev: 'Adorjáni Anna', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna'], foto: '/media/brand/csapat/adorjani-anna.jpg' },
    { id: 'kovacs-sebestyen', szin: '#8c6b2a', nev: 'Kovács Sebestyén', szerep: 'gyógytornász, sportrehabilitáció', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna', 'kinvent-pro', 'gepi-nyirokmasszazs'] },
    { id: 'osvath-bence', szin: '#2f6e6e', nev: 'Osváth Bence', szerep: 'személyi edző, erőnléti edző', helyszinek: ['reitter'], szolgaltatasok: ['kinvent-pro'], foto: '/media/brand/csapat/osvath-bence.jpg' },
    { id: 'barkoczy-barbara', szin: '#94485e', nev: 'Barkóczy Barbara', szerep: 'jógaoktató, aerial jóga, aerial trapéz', helyszinek: ['mexikoi'], szolgaltatasok: [], foto: '/media/brand/csapat/barkoczy-barbara.jpg' },
    { id: 'aczel-gabriella', szin: '#5a5f30', nev: 'Aczél Gabriella', szerep: 'jógaoktató, gerincjóga, Yin jóga', helyszinek: ['mexikoi'], szolgaltatasok: [], foto: '/media/brand/csapat/aczel-gabriella.jpg' },
    {
      id: 'kovacs-anna', szin: '#3b4580', nev: 'Kovács Anna', szerep: 'táplálkozási tanácsadó, InBody, alapító', helyszinek: ['mexikoi'],
      szolgaltatasok: ['taplalkozas-alapcsomag', 'taplalkozas-kiegeszito', 'inbody-770'], foto: '/media/brand/csapat/kovacs-anna.jpg',
    },
  ],
  szabalyok: {
    minEloreOra: 2, // legkorábban ennyi órával előre
    maxEloreNap: 60, // legkésőbb ennyi nappal előre
    lemondasOra: 24, // a linkkel eddig lehet lemondani a kezdés előtt
    telefon: '+36 30 503 0578', // a honlapon szereplő szám
    studioEmail: 'info@f360.hu', // a stúdió-értesítő címzettje (bemutatóban nem megy ki)
  },
};

const HP = [1, 2, 3, 4, 5];
// MINTA heti beosztás: nap 1 = hétfő ... 7 = vasárnap
export const SEED_BEOSZTAS = [
  ...[1, 2, 3, 4].map((nap) => ({ kollega: 'kodacsine-labancz-agnes', nap, helyszin: 'mexikoi', kezd: '08:00', veg: '16:00' })),
  ...[1, 3, 5].map((nap) => ({ kollega: 'vas-luca', nap, helyszin: 'mexikoi', kezd: '10:00', veg: '18:00' })),
  ...[2, 4].map((nap) => ({ kollega: 'vas-luca', nap, helyszin: 'mexikoi', kezd: '12:00', veg: '20:00' })),
  ...[1, 3, 5].map((nap) => ({ kollega: 'szegedi-botond', nap, helyszin: 'mexikoi', kezd: '09:00', veg: '17:00' })),
  ...[2, 4].map((nap) => ({ kollega: 'szegedi-botond', nap, helyszin: 'reitter', kezd: '10:00', veg: '18:00' })),
  ...HP.map((nap) => ({ kollega: 'adorjani-anna', nap, helyszin: 'reitter', kezd: '08:00', veg: '14:00' })),
  ...HP.map((nap) => ({ kollega: 'kovacs-sebestyen', nap, helyszin: 'reitter', kezd: '12:00', veg: '20:00' })),
  ...[1, 3, 5].map((nap) => ({ kollega: 'osvath-bence', nap, helyszin: 'reitter', kezd: '08:00', veg: '16:00' })),
  { kollega: 'kovacs-sebestyen', nap: 6, helyszin: 'reitter', kezd: '09:00', veg: '13:00' },
];
