/* liquid-glass.js — pointer light, per-surface sheen, staggered entrance,
   nav scroll state. No dependencies; bails out gracefully. */
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ---------- entrance: stagger the glass surfaces ---------------------- */
  var SURF = '.portrait,.pinn-feature,.feature,.product,.app-card,.acc-block,' +
    '.code-card,.toolbox,.teach-card,.math-cover,.cat,.mock-card,.q-card,' +
    '.qa-card,.example,.method,.figure,.panel,.side,.reader,.paper';

  function stagger() {
    if (reduce.matches) { root.classList.add('lg-ready'); return; }
    var nodes = Array.prototype.slice.call(document.querySelectorAll(SURF));
    var seen = 0;
    nodes.forEach(function (el) {
      if (el.closest('.lg-stagger-done')) return;
      el.style.setProperty('--lg-i', String(seen % 8));
      seen++;
    });
    root.classList.add('lg-ready');
  }

  /* ---------- pointer light layer --------------------------------------- */
  function pointerLight() {
    if (!fine.matches || reduce.matches) return;
    var layer = document.createElement('div');
    layer.className = 'lg-pointer-light';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);

    var px = window.innerWidth / 2, py = window.innerHeight * 0.3;
    var cx = px, cy = py, raf = 0, first = true;

    function paint() {
      raf = 0;
      px += (cx - px) * 0.18;
      py += (cy - py) * 0.18;
      root.style.setProperty('--mx', px.toFixed(1) + 'px');
      root.style.setProperty('--my', py.toFixed(1) + 'px');
      if (Math.abs(cx - px) > 0.4 || Math.abs(cy - py) > 0.4) raf = requestAnimationFrame(paint);
    }
    function move(e) {
      cx = e.clientX; cy = e.clientY;
      if (first) { layer.classList.add('is-on'); first = false; }
      if (!raf) raf = requestAnimationFrame(paint);
    }
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', function () { layer.classList.remove('is-on'); });
  }

  /* ---------- per-surface sheen ----------------------------------------- */
  function sheen() {
    if (!fine.matches || reduce.matches) return;
    var current = null;
    document.addEventListener('pointermove', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(SURF) : null;
      if (current && current !== el) { current.style.removeProperty('--gx'); current.style.removeProperty('--gy'); }
      current = el;
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--gx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--gy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* ---------- colour field behind the glass ----------------------------- */
  function colourField() {
    if (document.querySelector('.lg-backdrop')) return;
    var bd = document.createElement('div');
    bd.className = 'lg-backdrop';
    if (document.querySelector('.paper, #cats, .reader, .q-card, .mock-card')) {
      bd.className += ' is-warm';
    }
    bd.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 5; i++) bd.appendChild(document.createElement('i'));
    document.body.insertBefore(bd, document.body.firstChild);
  }

  /* ---------- nav scroll state ------------------------------------------ */
  function navState() {
    var nav = document.querySelector('.nav') || document.querySelector('header.top');
    if (!nav) return;
    var on = false;
    function check() {
      var next = window.scrollY > 8;
      if (next !== on) { on = next; nav.classList.toggle('is-scrolled', on); }
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
  }

  /* ---------- scroll-linked reveal for long articles --------------------- */
  function reveal() {
    if (reduce.matches || !('IntersectionObserver' in window)) return;
    var targets = document.querySelectorAll('.paper h2, .paper h3');
    if (!targets.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.style.transition = 'opacity .6s cubic-bezier(.22,1,.36,1), translate .6s cubic-bezier(.22,1,.36,1)';
        en.target.style.opacity = '1';
        en.target.style.translate = '0 0';
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });
    targets.forEach(function (el, i) {
      var top = el.getBoundingClientRect().top;
      if (top < window.innerHeight * 0.9) return;
      el.style.opacity = '0';
      el.style.translate = '0 14px';
      io.observe(el);
    });
  }

  function init() {
    colourField();
    stagger();
    pointerLight();
    sheen();
    navState();
    reveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
