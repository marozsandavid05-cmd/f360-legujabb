/* Studio F360 — blog kedvelés + hozzászólás (demó)
   localStorage-ben tárol, file://-ből is működik, szerver nélkül.
   Kulcsok: f360BlogLikes {slug:1}, f360BlogComments {slug:[{n,t}]}   */
(function () {
  'use strict';

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch (e) { return {}; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* privát mód */ }
  }

  var LIKES_KEY = 'f360BlogLikes';
  var CMTS_KEY = 'f360BlogComments';

  function initWidget(root) {
    var slug = root.getAttribute('data-slug');
    if (!slug) return;
    var base = parseInt(root.getAttribute('data-likes') || '0', 10) || 0;

    var likeBtn = root.querySelector('[data-like]');
    var likeCount = root.querySelector('[data-like-count]');
    var cmtToggle = root.querySelector('[data-cmt-toggle]');
    var cmtCount = root.querySelector('[data-cmt-count]');
    var cmtList = root.querySelector('[data-cmt-list]');
    var cmtForm = root.querySelector('[data-cmt-form]');
    var cmtBox = cmtToggle
      ? document.getElementById(cmtToggle.getAttribute('aria-controls'))
      : null;

    /* --- kedvelés --- */
    function paintLike() {
      var likes = lsGet(LIKES_KEY);
      var liked = !!likes[slug];
      if (likeBtn) {
        likeBtn.classList.toggle('is-liked', liked);
        likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      }
      if (likeCount) likeCount.textContent = String(base + (liked ? 1 : 0));
    }
    if (likeBtn) {
      likeBtn.addEventListener('click', function () {
        var likes = lsGet(LIKES_KEY);
        if (likes[slug]) delete likes[slug];
        else likes[slug] = 1;
        lsSet(LIKES_KEY, likes);
        paintLike();
        likeBtn.classList.remove('is-pop');
        void likeBtn.offsetWidth; /* restart animáció */
        likeBtn.classList.add('is-pop');
      });
    }
    paintLike();

    /* --- hozzászólások --- */
    var seeded = cmtList ? cmtList.children.length : 0;

    function addCommentEl(name, text) {
      if (!cmtList) return;
      var li = document.createElement('li');
      li.className = 'cmt';
      var n = document.createElement('span');
      n.className = 'cmt__n';
      n.textContent = name;
      var t = document.createElement('span');
      t.className = 'cmt__t';
      t.textContent = text;
      li.appendChild(n);
      li.appendChild(t);
      cmtList.appendChild(li);
    }

    function paintCmtCount() {
      if (!cmtCount || !cmtList) return;
      cmtCount.textContent = String(cmtList.children.length);
    }

    var stored = lsGet(CMTS_KEY)[slug] || [];
    for (var i = 0; i < stored.length; i++) {
      if (stored[i] && stored[i].n && stored[i].t) addCommentEl(stored[i].n, stored[i].t);
    }
    paintCmtCount();

    if (cmtToggle && cmtBox) {
      cmtToggle.addEventListener('click', function () {
        var open = !cmtBox.hidden;
        cmtBox.hidden = open;
        cmtToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (!open) {
          var firstInput = cmtBox.querySelector('input');
          if (firstInput) firstInput.focus({ preventScroll: true });
        }
      });
    }

    if (cmtForm) {
      cmtForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var nameEl = cmtForm.querySelector('[name="nev"]');
        var textEl = cmtForm.querySelector('[name="szoveg"]');
        var name = (nameEl && nameEl.value || '').trim().slice(0, 40);
        var text = (textEl && textEl.value || '').trim().slice(0, 400);
        if (!name || !text) return;
        var all = lsGet(CMTS_KEY);
        if (!all[slug]) all[slug] = [];
        all[slug].push({ n: name, t: text });
        lsSet(CMTS_KEY, all);
        addCommentEl(name, text);
        paintCmtCount();
        if (textEl) textEl.value = '';
      });
    }
  }

  function init() {
    var roots = document.querySelectorAll('[data-slug]');
    for (var i = 0; i < roots.length; i++) initWidget(roots[i]);

    /* keskeny nézetben az aktív kategória-chip kerüljön látótérbe */
    var list = document.querySelector('.wall-tabs');
    var active = list && list.querySelector('.wtab.is-on');
    if (list && active && list.scrollWidth > list.clientWidth) {
      var lr = list.getBoundingClientRect();
      var ar = active.getBoundingClientRect();
      list.scrollLeft = Math.max(0,
        (ar.left - lr.left) + list.scrollLeft - (lr.width - ar.width) / 2);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
