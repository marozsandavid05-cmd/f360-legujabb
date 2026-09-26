/* =====================================================================
   STUDIO F360 — core.js
   GSAP-FÜGGETLEN robusztus gerinc: Lenis (self-rAF), reveal, nav, counter,
   mobilmenü, horgony-scroll, <details> dosszié.
   A kritikus vizuál ebből + CSS-ből él. A gsap csak extra (motion.js).
   ===================================================================== */
(function(){
'use strict';

var reduce  = matchMedia('(prefers-reduced-motion:reduce)').matches;
var hasGSAP = typeof gsap !== 'undefined';
var hasST   = typeof ScrollTrigger !== 'undefined';

/* ---------- REVEAL (RB2/RB3): scroll-listener, soha nem marad ki ---------- */
var revealEls = [].slice.call(document.querySelectorAll('[data-reveal],[data-stagger]'));
function runReveal(){
  for(var i=0;i<revealEls.length;i++){
    var el = revealEls[i];
    if(el.classList.contains('in')) continue;
    if(el.getBoundingClientRect().top < innerHeight*0.92) el.classList.add('in');
  }
  var heads = document.querySelectorAll('[data-headin]:not(.is-in)');
  for(var j=0;j<heads.length;j++){
    if(heads[j].getBoundingClientRect().top < innerHeight*0.9) heads[j].classList.add('is-in');
  }
}
addEventListener('scroll', runReveal, {passive:true});
addEventListener('resize', runReveal, {passive:true});

/* ---------- HERO belépő (RB1) — load után CSS-transition kapcsol ---------- */
function heroIn(){
  var h = document.querySelector('[data-hero]');
  if(h) h.classList.add('is-in');
  runReveal();
  if(hasST) ScrollTrigger.refresh();
}
if(document.readyState === 'complete') setTimeout(heroIn, 60);
else addEventListener('load', function(){ setTimeout(heroIn, 60); });
setTimeout(heroIn, 2500); /* safety net */

/* ---------- NAV hide-on-scroll (RB4) — delta-hiszterézissel (Lenis alatt kötelező) ---------- */
var nav = document.querySelector('.nav');
var lastY = scrollY, acc = 0;
var HIDE_AFTER = 34, SHOW_AFTER = 14;
function navScroll(){
  var y = scrollY, d = y - lastY; lastY = y;
  if(!nav) return;
  if(y < 140){ nav.classList.remove('nav--hidden'); acc = 0; return; }
  if((d > 0) !== (acc > 0)) acc = 0;    /* irányváltás: számláló nulláz */
  acc += d;
  if(acc > HIDE_AFTER && !document.body.classList.contains('menu-open')) nav.classList.add('nav--hidden');
  else if(acc < -SHOW_AFTER) nav.classList.remove('nav--hidden');
}
addEventListener('scroll', navScroll, {passive:true});

/* ---------- COUNTER (RB5): IO + rAF ---------- */
if('IntersectionObserver' in window){
  var cio = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      var el = e.target; cio.unobserve(el);
      var end = parseFloat(el.getAttribute('data-count')) || 0;
      var dec = (String(el.getAttribute('data-count')).split('.')[1]||'').length;
      if(reduce){ el.textContent = end.toFixed(dec); return; }
      var t0 = performance.now(), dur = 1400;
      (function tick(t){
        var p = Math.min(1,(t-t0)/dur);
        el.textContent = (end*(1-Math.pow(1-p,3))).toFixed(dec);
        if(p<1) requestAnimationFrame(tick);
      })(t0);
    });
  },{threshold:.6});
  [].forEach.call(document.querySelectorAll('[data-count]'), function(el){ cio.observe(el); });
}

/* ---------- LENIS — helyesen: self-rAF, syncTouch:false ---------- */
var lenis = null;
if(!reduce && typeof Lenis !== 'undefined'){
  lenis = new Lenis({
    duration:1.1,
    easing:function(t){ return Math.min(1, 1.001 - Math.pow(2,-10*t)); },
    smoothWheel:true, syncTouch:false
  });
  (function lraf(time){ lenis.raf(time); requestAnimationFrame(lraf); })();
  lenis.on('scroll', function(){
    if(hasST) ScrollTrigger.update();
    runReveal(); navScroll();
  });
}
window.__lenis = lenis;

/* ---------- MOBILMENÜ — lenis.stop()/start() ---------- */
var burger = document.querySelector('.nav__burger');
if(burger){
  burger.addEventListener('click', function(){
    var open = document.body.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if(lenis){ open ? lenis.stop() : lenis.start(); }
  });
  [].forEach.call(document.querySelectorAll('.menu a'), function(a){
    a.addEventListener('click', function(){
      document.body.classList.remove('menu-open');
      burger.setAttribute('aria-expanded','false');
      if(lenis) lenis.start();
    });
  });
}

/* ---------- HORGONY-linkek Lenis-szel ---------- */
[].forEach.call(document.querySelectorAll('a[href^="#"]'), function(a){
  a.addEventListener('click', function(ev){
    var id = a.getAttribute('href');
    if(id.length < 2) return;
    var target = document.querySelector(id);
    if(!target) return;
    ev.preventDefault();
    if(lenis) lenis.scrollTo(target, {offset:-84});
    else target.scrollIntoView({behavior: reduce ? 'auto' : 'smooth'});
  });
});

/* ---------- <details> dosszié: sima nyitás/zárás (degradálható) ---------- */
if(!reduce){
  [].forEach.call(document.querySelectorAll('details.dossier'), function(d){
    var body = d.querySelector('.dossier__body');
    var summary = d.querySelector('summary');
    if(!body || !summary || typeof body.animate !== 'function') return;
    summary.addEventListener('click', function(ev){
      ev.preventDefault();
      body.style.overflow = 'clip';
      if(d.open){
        var h = body.offsetHeight;
        var anim = body.animate(
          [{height:h+'px',opacity:1,paddingBottom:'1.6rem'},{height:'0px',opacity:0,paddingBottom:'0rem'}],
          {duration:280, easing:'cubic-bezier(.77,0,.175,1)'}
        );
        anim.onfinish = function(){ d.open = false; body.style.overflow=''; if(hasST) ScrollTrigger.refresh(); };
      }else{
        d.open = true;
        var h2 = body.offsetHeight;
        body.animate(
          [{height:'0px',opacity:0,paddingBottom:'0rem'},{height:h2+'px',opacity:1,paddingBottom:'1.6rem'}],
          {duration:380, easing:'cubic-bezier(.16,1,.3,1)'}
        ).onfinish = function(){ body.style.overflow=''; if(hasST) ScrollTrigger.refresh(); };
      }
    });
  });
}

/* ---------- ANATÓMIA-SVG előkészítés ----------
   CSS-default: kirajzolt állapot (no-JS / reduced = komponált végállapot).
   Csak akkor rejtjük el induláskor, ha gsap + ST él és nincs reduce —
   a tényleges rajzolást a motion.js/anatomy.js köti be. */
window.__anatReady = false;
if(hasGSAP && hasST && !reduce){
  [].forEach.call(document.querySelectorAll('.anat[data-draw] path, .anat[data-draw] line, .anat[data-draw] circle, .anat[data-draw] ellipse'), function(p){
    try{
      var len = p.getTotalLength ? p.getTotalLength() : 0;
      if(!len) return;
      p.style.strokeDasharray = len + ' ' + len;
      p.style.strokeDashoffset = len;
    }catch(err){ /* nem-rajzolható elem: marad látható */ }
  });
  window.__anatReady = true;
}

/* ---------- ÁRAK: T12 fejezethatár témaváltás (gsap-független, reduce alatt is) ---------- */
var flip = document.querySelector('.price-flip');
if(flip){
  function flipCheck(){
    var r = flip.getBoundingClientRect();
    var mid = innerHeight * 0.55;
    document.body.classList.toggle('is-ink', r.top < mid && r.bottom > 0);
  }
  addEventListener('scroll', flipCheck, {passive:true});
  addEventListener('resize', flipCheck, {passive:true});
  flipCheck();
}

/* ---------- Kezdő állapotok ---------- */
runReveal();
navScroll();

/* ---------- ST idle-refresh (görgetés-csendre vár) ---------- */
if(hasST){
  var lastScrollT = 0;
  addEventListener('scroll', function(){ lastScrollT = performance.now(); }, {passive:true});
  var tries = 0;
  function queueIdleRefresh(){
    if(tries++ > 40) return;
    if(performance.now() - lastScrollT > 600){ ScrollTrigger.refresh(); }
    else setTimeout(queueIdleRefresh, 500);
  }
  addEventListener('load', function(){ setTimeout(queueIdleRefresh, 400); });
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ setTimeout(queueIdleRefresh, 200); });
  setTimeout(queueIdleRefresh, 2500);
  setTimeout(queueIdleRefresh, 6000);
  if(typeof ScrollTrigger.config === 'function') ScrollTrigger.config({ignoreMobileResize:true});
}

})();
