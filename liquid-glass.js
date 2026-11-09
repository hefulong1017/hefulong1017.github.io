/* liquid-glass.js — the cheap half: stagger the entrance and mark the nav
   once it starts scrolling. No pointer tracking, no per-frame work. */
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var SURF = '.portrait,.pinn-feature,.feature,.product,.app-card,.acc-block,' +
    '.code-card,.toolbox,.cat,.mock-card';

  function stagger() {
    if (reduce.matches) { root.classList.add('lg-ready'); return; }
    var nodes = document.querySelectorAll(SURF);
    for (var i = 0; i < nodes.length && i < 8; i++) {
      nodes[i].style.setProperty('--lg-i', String(i));
    }
    root.classList.add('lg-ready');
  }

  function navState() {
    var nav = document.querySelector('.nav') || document.querySelector('header.top');
    if (!nav) return;
    var on = null;
    function check() {
      var next = window.scrollY > 8;
      if (next !== on) { on = next; nav.classList.toggle('is-scrolled', on); }
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
  }

  function init() { stagger(); navState(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
