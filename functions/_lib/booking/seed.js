// Időpontfoglaló · MINTA törzsadat a bemutatóhoz.
// MINDEN itt MINTA: a helyszínek és árak az arak.html szerint, a kollégák a rolunk.html szerint,
// de a szolgáltatás ↔ kolléga összerendelés és a heti beosztás kitalált. Lilla adja meg a valódit,
// az adminban (/api/foglalo/beallitasok, /api/foglalo/beosztas) szerkeszthető.
// A seed csak akkor kerül be, ha az adatbázisban még nincs törzsadat; a szerkesztettet nem írja felül.

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
  ],
  // a rolunk.html csapatából azok, akiknek van foglalható szolgáltatása (a jógaoktatók csoportos órát
  // tartanak, a táplálkozási tanácsadás nincs a foglalható listában, ezért ők most nem szerepelnek)
  kollegak: [
    { id: 'kodacsine-labancz-agnes', nev: 'Kodácsiné Labancz Ágnes', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna'] },
    { id: 'vas-luca', nev: 'Vas Luca', szerep: 'gyógytornász, perinatális tréner', helyszinek: ['mexikoi'], szolgaltatasok: ['gyogytorna', 'kismama-masszazs'] },
    {
      id: 'szegedi-botond', nev: 'Szegedi Botond', szerep: 'gyógymasszőr, nyirokmasszőr, sportmasszőr', helyszinek: ['mexikoi', 'reitter'],
      szolgaltatasok: ['gyogymasszazs-50', 'gyogymasszazs-90', 'relaxalo-masszazs', 'nyirokmasszazs-teljes', 'kismama-masszazs', 'sportmasszazs', 'gepi-nyirokmasszazs'],
    },
    { id: 'adorjani-anna', nev: 'Adorjáni Anna', szerep: 'gyógytornász, manuálterapeuta', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna'] },
    { id: 'kovacs-sebestyen', nev: 'Kovács Sebestyén', szerep: 'gyógytornász, sportrehabilitáció', helyszinek: ['reitter'], szolgaltatasok: ['sportrehab-felmeres', 'sportrehab-gyogytorna', 'kinvent-pro', 'gepi-nyirokmasszazs'] },
    { id: 'osvath-bence', nev: 'Osváth Bence', szerep: 'személyi edző, erőnléti edző', helyszinek: ['reitter'], szolgaltatasok: ['kinvent-pro'] },
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
