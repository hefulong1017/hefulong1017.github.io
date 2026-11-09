/* ==========================================================================
   ui.js — 路由器 / Toast / 弹窗 / 滚动进场 / 数字滚动 / 导航收缩 / 叙事联动
   ========================================================================== */
(function (window, document) {
  'use strict';

  var App = window.App;
  var util = App.util;
  var ui = App.ui = {};

  var PAGES = ['home', 'prepare', 'record', 'report', 'history'];
  var current = 'home';

  /* ------------------------------------------------------------- 页面路由 */
  function pageEl(name) { return document.getElementById('page-' + name); }

  ui.go = function (name, opts) {
    opts = opts || {};
    if (PAGES.indexOf(name) === -1) name = 'home';
    if (name === current && !opts.force) {
      if (opts.scrollTop !== false) window.scrollTo(0, 0);
      return;
    }

    PAGES.forEach(function (p) {
      var el = pageEl(p);
      if (!el) return;
      if (p === name) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    document.body.classList.toggle('no-scroll', name === 'record');
    current = name;
    App.state.page = name;

    if (opts.scrollTop !== false) window.scrollTo(0, 0);

    if (!opts.silent) {
      try {
        var hash = '#' + name;
        if (location.hash !== hash) history.pushState({ page: name }, '', hash);
      } catch (e) { /* file:// 下 pushState 可能受限 */ }
    }

    App.bus.emit('page', { page: name, prev: opts.prev });
  };

  ui.current = function () { return current; };

  window.addEventListener('popstate', function (e) {
    var p = (e.state && e.state.page) || (location.hash || '').replace('#', '') || 'home';
    if (PAGES.indexOf(p) > -1) ui.go(p, { silent: true, prev: current });
  });

  /* ------------------------------------------------------------ 滚动到区块 */
  /* 报告页自己的区块（#transcript / #issues / #diagnostics / #examples）也叫这些 id，
     以前这里一律先跳主页再滚，导致报告页上点「查看完整逐字稿」直接被踢回首页。
     规则：先看当前页里有没有这个 id，有就原地滚。 */
  ui.scrollTo = function (id) {
    var cur = pageEl(current);
    if (cur) {
      if (cur.id === id) { smoothScroll(cur); return; }
      var inside = cur.querySelector('#' + id);
      if (inside && !inside.closest('.page:not(.active)')) { smoothScroll(inside); return; }
    }

    var el = document.getElementById(id);
    if (!el) return;
    var host = el.closest ? el.closest('.page') : null;
    if (host && host.classList.contains('active')) { smoothScroll(el); return; }
    if (current !== 'home') {
      ui.go('home', { silent: true, scrollTop: false });
      // 等页面显示后再滚动
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { smoothScroll(el); });
      });
      return;
    }
    smoothScroll(el);
  };

  function smoothScroll(target) {
    var top = target.getBoundingClientRect().top + window.pageYOffset - 48;
    window.scrollTo({ top: top, behavior: util.reducedMotion() ? 'auto' : 'smooth' });
  }

  /* ----------------------------------------------------------------- Toast */
  var toastBox = null;
  ui.toast = function (msg, type, ms) {
    toastBox = toastBox || document.getElementById('toasts');
    if (!toastBox) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    toastBox.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, ms || 2600);
    return el;
  };

  /* ------------------------------------------------------------------ 弹窗 */
  var modalRoot = null;
  var activeModal = null;

  function closeModal(result) {
    if (!modalRoot || !activeModal) return;
    var m = activeModal;
    activeModal = null;
    if (m.handler) modalRoot.removeEventListener('click', m.handler);
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    document.body.classList.remove('no-scroll');
    if (m.resolve) m.resolve(result);
  }
  ui.closeModal = closeModal;

  /**
   * ui.modal({ title, text, bodyHTML, okText, cancelText, danger, onMount })
   * 返回 Promise：确认 → true，取消/关闭 → false
   */
  ui.modal = function (opts) {
    opts = opts || {};
    modalRoot = modalRoot || document.getElementById('modalRoot');
    if (!modalRoot) return Promise.resolve(false);
    if (activeModal) closeModal(false);

    return new Promise(function (resolve) {
      var html = '';
      html += '<div class="modal" role="dialog" aria-modal="true">';
      if (opts.title) html += '<h3>' + util.escape(opts.title) + '</h3>';
      if (opts.text) html += '<p>' + util.escape(opts.text).replace(/\n/g, '<br />') + '</p>';
      if (opts.bodyHTML) html += opts.bodyHTML;
      html += '<div class="modal-actions">';
      if (opts.cancelText !== null) {
        html += '<button class="btn btn-ghost" type="button" data-m="cancel">' + util.escape(opts.cancelText || '取消') + '</button>';
      }
      html += '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" type="button" data-m="ok">' +
        util.escape(opts.okText || '确定') + '</button>';
      html += '</div></div>';

      modalRoot.innerHTML = html;
      modalRoot.hidden = false;
      document.body.classList.add('no-scroll');

      var modalEl = modalRoot.querySelector('.modal');

      function handler(e) {
        if (e.target === modalRoot) { closeModal(false); return; }
        var btn = e.target.closest('[data-m]');
        if (!btn) return;
        var val = true;
        if (btn.getAttribute('data-m') === 'cancel') val = false;
        else if (opts.collect) {
          try { val = opts.collect(modalEl) || true; } catch (err) { val = true; }
        }
        closeModal(val);
      }

      activeModal = { resolve: resolve, handler: handler };
      modalRoot.addEventListener('click', handler);

      if (opts.onMount) { try { opts.onMount(modalEl); } catch (e) { console.warn(e); } }
    });
  };

  ui.confirm = function (opts) {
    return ui.modal({
      title: opts.title || '确认',
      text: opts.text || '',
      okText: opts.okText || '确定',
      cancelText: opts.cancelText || '取消',
      danger: !!opts.danger
    });
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && activeModal) closeModal(false);
  });

  /* --------------------------------------------------------------- 导航收缩 */
  function initNav() {
    var sentinel = document.getElementById('scrollSentinel');
    var nav = document.getElementById('nav');
    if (!nav) return;

    /* 首页已改成浅色单屏，导航不再需要反白。
       这个函数保留，是为了把历史上可能残留的 nav-over-dark 清掉。 */
    function syncDark() {
      document.body.classList.remove('nav-over-dark');
    }

    if (sentinel && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          nav.classList.toggle('scrolled', !en.isIntersecting);
          syncDark();
        });
      }, { threshold: 0 });
      io.observe(sentinel);
    } else {
      var onScroll = util.rafThrottle(function () {
        nav.classList.toggle('scrolled', window.pageYOffset > 8);
        syncDark();
      });
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    syncDark();
    App.bus.on('page', syncDark);
  }

  /* --------------------------------------------------------------- 进场动画 */
  function initReveal() {
    // 给各区块内的直接子元素自动加 reveal，避免逐个手写
    util.$$('.section .wrap').forEach(function (wrap) {
      Array.prototype.forEach.call(wrap.children, function (child) {
        if (child.hasAttribute('data-reveal')) return;
        if (child.tagName === 'DIV' && (child.classList.contains('grade-grid') || child.classList.contains('stat-row'))) return;
        child.setAttribute('data-reveal', '');
      });
    });

    var els = util.$$('[data-reveal]');
    if (!('IntersectionObserver' in window) || util.reducedMotion()) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });

    // 兜底：无论 IntersectionObserver 有没有触发，2.4 秒后一律可见。
    // 宁可丢动画，也不能让整块内容因为没滚到而永久空白。
    setTimeout(function () {
      util.$$('[data-reveal]:not(.in)').forEach(function (el) { el.classList.add('in'); });
    }, 2400);

    // 页面切换后重新观察（报告页内容是动态生成的）
    App.bus.on('page', function (d) {
      if (d.page !== 'report' && d.page !== 'history') return;
      setTimeout(function () {
        var fresh = util.$$('[data-reveal]:not(.in)');
        fresh.forEach(function (el) { io.observe(el); });
      }, 30);
    });
  }

  /* --------------------------------------------------------------- 数字滚动 */
  ui.observeCounters = function (root) {
    var els = util.$$('[data-count]', root || document).filter(function (el) { return !el.dataset.done; });
    if (!els.length) return;
    function run(el) {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      var to = parseFloat(el.getAttribute('data-count')) || 0;
      var suffix = el.getAttribute('data-suffix') || '';
      util.countUp(el, to, { suffix: suffix, duration: 800 });
    }
    if (!('IntersectionObserver' in window) || util.reducedMotion()) {
      els.forEach(run);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        run(en.target);
        io.unobserve(en.target);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
    /* 兜底：没滚到也要把数字填上，否则整块统计永远是 0 */
    setTimeout(function () { els.forEach(run); }, 2600);
  };

  /* ------------------------------------------------------------- 滚动叙事联动 */
  function initNarrative() {
    var steps = util.$$('#narrativeSteps .step');
    if (!steps.length) return;
    var headline = document.getElementById('narrativeHeadline');
    var desc = document.getElementById('narrativeDesc');
    var idxEl = document.getElementById('narrativeIndex');
    var weightEl = document.getElementById('narrativeWeight');
    var bar = document.getElementById('narrativeBar');

    function activate(i) {
      var step = steps[i];
      if (!step) return;
      steps.forEach(function (s, k) { s.classList.toggle('active', k === i); });

      var name = step.dataset.name, d = step.dataset.desc, w = step.dataset.weight;
      if (headline && !util.reducedMotion()) {
        headline.classList.add('swap');
        desc.classList.add('swap');
        setTimeout(function () {
          headline.textContent = name;
          desc.textContent = d;
          headline.classList.remove('swap');
          desc.classList.remove('swap');
        }, 170);
      } else if (headline) {
        headline.textContent = name;
        desc.textContent = d;
      }
      if (idxEl) idxEl.textContent = util.pad2(i + 1) + ' / ' + util.pad2(steps.length);
      if (weightEl) weightEl.textContent = w + '%';
      if (bar) bar.style.width = (parseFloat(w) * 3.3) + '%';
      App.state.narrativeIndex = i;
    }

    activate(0);

    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) activate(parseInt(en.target.dataset.i, 10) || 0);
      });
    }, { rootMargin: '-42% 0px -42% 0px', threshold: 0 });
    steps.forEach(function (s) { io.observe(s); });
  }

  /* ----------------------------------------------------------- 全局点击委托 */
  function initBindings() {
    document.addEventListener('click', function (e) {
      var goBtn = e.target.closest('[data-go]');
      if (goBtn) {
        e.preventDefault();
        var dest = goBtn.getAttribute('data-go');
        if (dest === 'prepare') {
          if (App.flow && App.flow.enterPrepare) App.flow.enterPrepare();
          else ui.go('prepare');
        } else {
          ui.go(dest);
        }
        return;
      }

      var jump = e.target.closest('[data-scroll]');
      if (jump) {
        e.preventDefault();
        ui.scrollTo(jump.getAttribute('data-scroll'));
      }
    });
  }

  /* -------------------------------------------------------------------- init */
  ui.init = function () {
    initNav();
    initReveal();
    initNarrative();
    initBindings();
    ui.observeCounters(document);
  };

})(window, document);