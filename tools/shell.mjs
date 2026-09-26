// Studio F360 · közös „héj": fő navigáció, mobil menü, lábléc
// EGY forrás: a gyökér-HTML-ek (tools/apply-shell.mjs) és a blog (tools/build-blog.mjs) is ebből épül,
// így a menü és a lábléc nem csúszhat szét az oldalak között.
//
// prefix: relatív út a gyökérhez ('' a gyökérben, '../' a blog/ almappában)
// cur:    az aktuális oldal kulcsa (lásd PAGE_KEYS lent), vagy null
// world:  'mex' | 'reit' | null · melyik helyszín foglalója a nav-gomb célja

export const BOOK = {
  mex: 'https://f360.hu/idopontfoglalas/',
  reit: 'https://f360.hu/idopontfoglalo-reitter/',
};

export const SOCIAL = {
  instagram: 'https://www.instagram.com/studio_f360_egeszsegkozpont/',
  facebook: 'https://www.facebook.com/fitfoodfizio360',
};

export const PLACES = {
  mex: {
    name: 'Mexikói út',
    district: 'XIV. kerület',
    street: 'Mexikói út 32/b',
    hours: '7:00-21:00',
    href: 'mexikoi.html',
    lead: 'A Mexikói úti stúdió',
    items: [
      { key: 'gyogyaszat', href: 'gyogyaszat.html', label: 'Gyógytorna &amp; manuálterápia' },
      { key: 'gerinc', href: 'gyogyaszat.html#gerinc', label: 'Gerincferdülés-terápia', child: true },
      { key: 'masszazs', href: 'masszazs.html', label: 'Masszázsterápiák' },
      { key: 'joga', href: 'joga-pilates.html', label: 'Jóga &amp; Pilates' },
      { key: 'taplalkozas', href: 'taplalkozas.html', label: 'Táplálkozási tanácsadás &amp; InBody' },
    ],
  },
  reit: {
    name: 'Reitter Ferenc utca',
    district: 'XIII. kerület',
    street: 'Reitter Ferenc utca 48.',
    hours: '8:00-20:00',
    href: 'reitter.html',
    lead: 'Sport, rehab &amp; teljesítmény',
    items: [
      { key: 'terapia', href: 'reitter-terapia.html', label: 'Eszközös terápiák' },
    ],
  },
};

// oldal-kulcs → melyik helyszínhez tartozik (a menüpont kiemeléséhez)
const PLACE_OF = {
  mexikoi: 'mex', gyogyaszat: 'mex', gerinc: 'mex', masszazs: 'mex', joga: 'mex', taplalkozas: 'mex',
  reitter: 'reit', terapia: 'reit',
};

const MAIN = [
  { key: 'rolunk', href: 'rolunk.html', label: 'Rólunk', also: ['csapat'] },
  { key: 'arak', href: 'arak.html', label: 'Árak' },
  { key: 'blog', href: 'blog.html', label: 'Blog', prefixMatch: 'blog' },
  { key: 'kapcsolat', href: 'kapcsolat.html', label: 'Kapcsolat' },
];

const ICON = {
  instagram: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="17.3" cy="6.7" r="1.05" fill="currentColor"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M13.4 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.7v3h2.6V21h3.1z" fill="currentColor"/></svg>',
};

const isMain = (m, cur) =>
  !!cur && (cur === m.key || (m.also || []).includes(cur) || (m.prefixMatch && String(cur).startsWith(m.prefixMatch)));

function socialLinks(prefix, cls) {
  return `<a class="${cls}" href="${SOCIAL.instagram}" target="_blank" rel="noopener" aria-label="Instagram">${ICON.instagram}</a>
    <a class="${cls}" href="${SOCIAL.facebook}" target="_blank" rel="noopener" aria-label="Facebook">${ICON.facebook}</a>`;
}

function placeItem(prefix, cur, id) {
  const p = PLACES[id];
  const on = PLACE_OF[cur] === id;
  const topCur = (id === 'mex' && cur === 'mexikoi') || (id === 'reit' && cur === 'reitter');
  const sub = p.items
    .map((it) => `        <a href="${prefix}${it.href}"${it.child ? ' class="nav__sub-child"' : ''}${cur === it.key ? ' aria-current="page"' : ''}>${it.label}</a>`)
    .join('\n');
  return `    <div class="nav__item nav__item--sub nav__place nav__place--${id}${on ? ' is-on' : ''}">
      <a class="nav__link" href="${prefix}${p.href}"${topCur ? ' aria-current="page"' : ''}><span class="nav__place-t">${p.name}</span><span class="nav__place-k">${p.district}</span></a>
      <div class="nav__sub${id === 'reit' ? ' theme-rehab' : ''}">
        <a class="nav__sub-lead" href="${prefix}${p.href}">${p.lead}<span>${p.street} · ${p.hours}</span></a>
${sub}
      </div>
    </div>`;
}

export function navBlock(prefix, cur, world) {
  const book = BOOK[world === 'reit' ? 'reit' : 'mex'];
  const main = MAIN.map((m) => {
    const exact = cur === m.key;
    const on = isMain(m, cur);
    return `    <div class="nav__item${on ? ' is-on' : ''}"><a class="nav__link" href="${prefix}${m.href}"${exact ? ' aria-current="page"' : ''}>${m.label}</a></div>`;
  }).join('\n');
  return `<nav class="nav" aria-label="Fő navigáció">
  <a href="${prefix}index.html" class="nav__brand" aria-label="Studio F360 főoldal">
    <img class="nav__logo nav__logo--dark" src="${prefix}media/logo/brand-wide-anthracite.png" alt="Studio F360" width="571" height="120"><img class="nav__logo nav__logo--light" src="${prefix}media/logo/brand-wide-cream.png" alt="" aria-hidden="true" width="571" height="120">
  </a>
  <div class="nav__links">
${placeItem(prefix, cur, 'mex')}
${placeItem(prefix, cur, 'reit')}
    <span class="nav__rule" aria-hidden="true"></span>
${main}
  </div>
  <div class="nav__end">
    ${socialLinks(prefix, 'nav__soc')}
    <a class="nav__cta" href="${book}" target="_blank" rel="noopener">Időpontfoglalás</a>
    <button class="nav__burger" aria-label="Menü" aria-expanded="false" aria-controls="menu">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>`;
}

function menuPlace(prefix, id) {
  const p = PLACES[id];
  const items = p.items
    .map((it) => `        <li><a href="${prefix}${it.href}"${it.child ? ' class="menu__child"' : ''}>${it.label}</a></li>`)
    .join('\n');
  return `    <div class="menu__place menu__place--${id}">
      <a class="menu__place-t" href="${prefix}${p.href}"><span class="no">${p.district}</span>${p.name}</a>
      <ul>
        <li><a href="${prefix}${p.href}">${p.lead}</a></li>
${items}
      </ul>
    </div>`;
}

export function menuBlock(prefix, cur, world) {
  const book = BOOK[world === 'reit' ? 'reit' : 'mex'];
  const main = MAIN.map((m) => `    <li><a href="${prefix}${m.href}">${m.label}</a></li>`).join('\n');
  return `<div class="menu" id="menu" data-lenis-prevent>
  <div class="menu__places">
${menuPlace(prefix, 'mex')}
${menuPlace(prefix, 'reit')}
  </div>
  <ol class="menu__main">
${main}
  </ol>
  <div class="menu__social">
    ${socialLinks(prefix, 'menu__soc')}
  </div>
  <div class="menu__cta">
    <a class="btn btn--accent" href="${book}" target="_blank" rel="noopener">Időpontfoglalás</a>
  </div>
</div>`;
}

export function footerBlock(prefix, cur, world) {
  const book = BOOK[world === 'reit' ? 'reit' : 'mex'];
  const m = PLACES.mex, r = PLACES.reit;
  return `<footer class="footer theme-ink">
  <div class="wrap">
    <div class="footer__grid">
      <div class="footer__brand">
        <a class="footer__mark" href="${prefix}index.html" aria-label="Studio F360 főoldal"><img class="footer__logo" src="${prefix}media/logo/brand-primary-cream-lg.png" alt="Studio F360 · Fitness · Food · Fizio · Estd 2019" width="792" height="760" loading="lazy"></a>
        <p>Prevenció, rekreáció, rehabilitáció és teljesítményfokozás. Úgy kint, mint bent.</p>
      </div>
      <div>
        <h4>Helyszínek</h4>
        <address>
          <a href="${prefix}${m.href}">${m.street} · ${m.district}</a>
          <a href="${prefix}${r.href}">${r.street} · ${r.district}</a>
          <span class="footer__hours">H-P: 7:00-20:00</span>
        </address>
      </div>
      <div>
        <h4>Oldalak</h4>
        <ul>
          <li><a href="${prefix}${m.href}">${m.name}</a></li>
          <li><a href="${prefix}${r.href}">${r.name}</a></li>
          <li><a href="${prefix}rolunk.html">Rólunk</a></li>
          <li><a href="${prefix}arak.html">Árak</a></li>
          <li><a href="${prefix}blog.html">Blog</a></li>
          <li><a href="${prefix}kapcsolat.html">Kapcsolat</a></li>
        </ul>
      </div>
      <div>
        <h4>Kapcsolat</h4>
        <ul>
          <li><a href="tel:+36305030578">+36 30 503 0578</a></li>
          <li><a href="mailto:info@f360.hu">info@f360.hu</a></li>
          <li><a href="${SOCIAL.facebook}" target="_blank" rel="noopener">Facebook</a></li>
          <li><a href="${SOCIAL.instagram}" target="_blank" rel="noopener">Instagram</a></li>
          <li><a href="${book}" target="_blank" rel="noopener">Időpontfoglalás</a></li>
        </ul>
      </div>
    </div>
    <div class="footer__bar">
      <span>© 2026 F360 Mozgás és Vitalitás Kft.</span>
      <span>Adószám 27970054-1-42 · Cégjegyzékszám 01-09-359579</span>
    </div>
  </div>
</footer>`;
}
