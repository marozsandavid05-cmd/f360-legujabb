/* =====================================================================
   STUDIO F360 — motion.js
   GSAP-enhancementek. MINDEN degradálható: gsap nélkül az oldal teljes.
   Oldal-blokkok body-class-ra kapuzva (.p-index, .p-gerinc, ...).
   ===================================================================== */
(function(){
'use strict';
var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
if(reduce || typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
gsap.registerPlugin(ScrollTrigger);
var mm = gsap.matchMedia();
var body = document.body;
function on(cls){ return body.classList.contains(cls); }

/* ---------- KÖZÖS: parallax (I2) ---------- */
gsap.utils.toArray('[data-parallax]').forEach(function(el){
  var amt = parseFloat(el.getAttribute('data-parallax')) || 0.12;
  gsap.to(el, {yPercent:amt*100, ease:'none',
    scrollTrigger:{trigger:el.closest('section') || el.parentElement, start:'top bottom', end:'bottom top', scrub:true}});
});

/* ---------- KÖZÖS: side-slide (S13, scrubbal) ---------- */
mm.add('(min-width:769px)', function(){
  gsap.utils.toArray('[data-slide]').forEach(function(fig){
    var dir = fig.getAttribute('data-slide') === 'right' ? 1 : -1;
    var row = fig.closest('[data-slide-row]') || fig.parentElement;
    gsap.fromTo(fig, {xPercent:dir*14, autoAlpha:0},
      {xPercent:0, autoAlpha:1, ease:'none',
       scrollTrigger:{trigger:row, start:'top 88%', end:'top 46%', scrub:1}});
  });
});

/* ---------- KÖZÖS: [data-scale-img] belső kép ráközelítés ---------- */
gsap.utils.toArray('[data-scale-img] img').forEach(function(img){
  gsap.fromTo(img, {scale:1.18}, {scale:1, ease:'none',
    scrollTrigger:{trigger:img.closest('[data-scale-img]'), start:'top 95%', end:'top 30%', scrub:1}});
});

/* =====================================================================
   P-INDEX — atlasz-címlap
   ===================================================================== */
if(on('p-index')){
  /* S11: manifesto szó-highlight scrub (muted → ink) */
  var words = gsap.utils.toArray('.manifesto .w');
  if(words.length){
    gsap.set(words, {color:'var(--muted)', opacity:.45});
    gsap.to(words, {color:'var(--ink)', opacity:1, ease:'none', stagger:.06,
      scrollTrigger:{trigger:'.manifesto', start:'top 78%', end:'center 45%', scrub:1}});
  }
  /* S16: fork két fele ellentétes irányból (desktop) */
  mm.add('(min-width:900px)', function(){
    gsap.fromTo('.fork__half--paper', {xPercent:-7, autoAlpha:0},
      {xPercent:0, autoAlpha:1, ease:'none',
       scrollTrigger:{trigger:'.fork', start:'top 88%', end:'top 42%', scrub:1}});
    gsap.fromTo('.fork__half--ink', {xPercent:7, autoAlpha:0},
      {xPercent:0, autoAlpha:1, ease:'none',
       scrollTrigger:{trigger:'.fork', start:'top 88%', end:'top 42%', scrub:1}});
  });
  /* TOC sor-vonalak rajzolása */
  gsap.utils.toArray('.toc__row').forEach(function(row,i){
    gsap.fromTo(row, {'--rule':'0%'}, {'--rule':'100%', ease:'none',
      scrollTrigger:{trigger:row, start:'top 92%', end:'top 70%', scrub:1}});
  });
}

/* =====================================================================
   P-MEXIKOI — T3 sticky hero + T1 fejezet-váltó split
   ===================================================================== */
if(on('p-mexikoi')){
  mm.add('(min-width:900px)', function(){
    /* T1: bal szöveg görög, jobb képek fejezetenként váltanak */
    var figs = gsap.utils.toArray('.chapters__fig');
    var steps = gsap.utils.toArray('.chapters__step');
    if(figs.length && steps.length){
      steps.forEach(function(step, i){
        ScrollTrigger.create({
          trigger:step, start:'top 55%', end:'bottom 55%',
          onToggle:function(self){
            if(!self.isActive) return;
            figs.forEach(function(f,j){
              gsap.to(f, {autoAlpha: j===i ? 1 : 0, duration:.45, ease:'power2.out', overwrite:'auto'});
            });
          }
        });
      });
    }
  });
}

/* =====================================================================
   P-REITTER — T13 sticky bal-index fejezetjelölő
   ===================================================================== */
if(on('p-reitter')){
  var marks = gsap.utils.toArray('.proto__idx b');
  gsap.utils.toArray('.proto__step').forEach(function(step,i){
    ScrollTrigger.create({
      trigger:step, start:'top 60%', end:'bottom 60%',
      onToggle:function(self){
        if(!self.isActive) return;
        marks.forEach(function(m,j){ m.classList.toggle('on', j===i); });
      }
    });
  });
}

/* =====================================================================
   P-GYOGYASZAT — A8 sticky-stack hátraléptetés
   ===================================================================== */
if(on('p-gyogyaszat')){
  mm.add('(min-width:769px)', function(){
    var cards = gsap.utils.toArray('.techstack > article');
    cards.forEach(function(card,i){
      if(i === cards.length-1) return;
      gsap.to(card, {scale:.965, opacity:.55, ease:'none',
        scrollTrigger:{trigger:card, start:'top 14%', end:'bottom 14%', scrub:true}});
    });
  });
}

/* =====================================================================
   P-GERINC — A1 pinned színpad: két gerinc rajzolódik + Cobb-címkék
   (a path-rajzolást anatomy.js adja data-draw="scrub"-bal; itt a pin +
    a címke-beúszás fut ugyanarra a triggerre)
   ===================================================================== */
if(on('p-gerinc')){
  mm.add('(min-width:769px)', function(){
    var stage = document.querySelector('.spine-stage');
    if(!stage) return;
    var tl = gsap.timeline({scrollTrigger:{
      trigger:stage, start:'top top', end:'+=160%', scrub:1, pin:true,
      anticipatePin:1, invalidateOnRefresh:true
    }});
    tl.fromTo('.spine-stage__labels .lab', {autoAlpha:0, y:18},
      {autoAlpha:1, y:0, stagger:.25, duration:.5, ease:'power2.out'}, .35)
      .fromTo('.spine-stage__verdict', {autoAlpha:0, y:24},
      {autoAlpha:1, y:0, duration:.4, ease:'power2.out'}, .78);
  });
}

/* =====================================================================
   P-MASSZAZS — T6 pinned horizontal kartoték (desktop), natív mobil
   ===================================================================== */
if(on('p-masszazs')){
  mm.add('(min-width:900px)', function(){
    var wrapEl = document.querySelector('.recipes');
    var track = document.querySelector('.recipes__track');
    if(!wrapEl || !track) return;
    wrapEl.classList.add('is-pinned');
    var getDist = function(){ return track.scrollWidth - innerWidth; };
    gsap.to(track, {x:function(){ return -getDist(); }, ease:'none',
      scrollTrigger:{trigger:wrapEl, start:'top top', end:function(){ return '+=' + getDist(); },
        pin:true, scrub:1, anticipatePin:1, invalidateOnRefresh:true}});
    return function(){ wrapEl.classList.remove('is-pinned'); };
  });
}

/* =====================================================================
   P-TAPLALKOZAS — A17 scrub-counterek a mérőszám-sávban
   (a data-count RB5 countere IO-val megy; itt csak a sáv kis csúszása)
   ===================================================================== */
if(on('p-taplalkozas')){
  gsap.utils.toArray('.metric-strip .metric').forEach(function(m,i){
    gsap.fromTo(m, {y:26*(i%3+1), autoAlpha:0}, {y:0, autoAlpha:1, ease:'none',
      scrollTrigger:{trigger:'.metric-strip', start:'top 92%', end:'top 55%', scrub:1}});
  });
}

/* =====================================================================
   P-REITTER-TERAPIA — T8 grid → fókusz (sticky-alapú tompítás)
   ===================================================================== */
if(on('p-terapia')){
  mm.add('(min-width:900px)', function(){
    gsap.utils.toArray('.devices article').forEach(function(card){
      gsap.fromTo(card, {autoAlpha:0, y:34}, {autoAlpha:1, y:0, ease:'none',
        scrollTrigger:{trigger:card, start:'top 96%', end:'top 68%', scrub:1}});
    });
  });
}

/* =====================================================================
   P-CSOMAGOK — S17 kártyák a szélről, váltott irányból
   ===================================================================== */
if(on('p-csomagok')){
  mm.add('(min-width:769px)', function(){
    gsap.utils.toArray('.packs > article').forEach(function(card,i){
      var dir = i%2 ? 9 : -9;
      gsap.fromTo(card, {xPercent:dir, autoAlpha:0}, {xPercent:0, autoAlpha:1, ease:'none',
        scrollTrigger:{trigger:card, start:'top 94%', end:'top 58%', scrub:1}});
    });
  });
}

/* =====================================================================
   P-ROLUNK — T2 sticky-média caption-váltó
   ===================================================================== */
if(on('p-rolunk')){
  gsap.utils.toArray('.story__cap').forEach(function(cap){
    gsap.fromTo(cap, {autoAlpha:0, y:30}, {autoAlpha:1, y:0, ease:'none',
      scrollTrigger:{trigger:cap, start:'top 85%', end:'top 55%', scrub:1}});
  });
}

/* ---------- Magnetic gombok (K1) — csak egér ---------- */
if(matchMedia('(hover:hover) and (pointer:fine)').matches){
  document.querySelectorAll('[data-magnet]').forEach(function(btn){
    btn.addEventListener('mousemove', function(e){
      var r = btn.getBoundingClientRect();
      gsap.to(btn, {x:(e.clientX-(r.left+r.width/2))*.3, y:(e.clientY-(r.top+r.height/2))*.3, duration:.5, ease:'power3.out'});
    });
    btn.addEventListener('mouseleave', function(){
      gsap.to(btn, {x:0, y:0, duration:.55, ease:'elastic.out(1,.45)'});
    });
  });
}
})();
