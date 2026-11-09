/* ==========================================================================
   core.js — 运行时基础：工具函数 / 事件总线 / 全局状态 / 能力检测 / 本地设置
   纯经典脚本（非 ES Module），保证 file:// 直开也不会因跨域加载失败。
   所有模块挂在 window.App 下。
   ========================================================================== */
(function (window, document) {
  'use strict';

  var App = window.App || (window.App = {});
  App.version = '1.0.0';
  /* 构建版本号：必须与 sw.js 里的 VERSION 一致。
     页面启动时会拿它和线上 sw.js 的 VERSION 比对，不一致就自动刷新一次，
     免得用户一直看到 Service Worker 缓存里的旧 JS。 */
  App.build = 'v119';

  /* ---------------------------------------------------------------- 工具 */
  var util = App.util = {
    $: function (sel, root) { return (root || document).querySelector(sel); },
    $$: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },

    on: function (el, type, fn, opts) {
      if (!el) return function () {};
      el.addEventListener(type, fn, opts || false);
      return function () { el.removeEventListener(type, fn, opts || false); };
    },

    clamp: function (v, min, max) { return Math.min(max, Math.max(min, v)); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    round: function (v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; },

    uid: function () {
      return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    pad2: function (n) { return (n < 10 ? '0' : '') + n; },

    /** 保留一位小数 */
    round1: function (v) { return Math.round((v || 0) * 10) / 10; },

    /** 秒 → mm:ss */
    fmtTime: function (sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      var m = Math.floor(sec / 60), s = sec % 60;
      return util.pad2(m) + ':' + util.pad2(s);
    },

    /** 秒 → "第 3 分 12 秒"，报告里的人类可读定位 */
    fmtAt: function (sec) {
      sec = Math.max(0, Math.round(sec || 0));
      var m = Math.floor(sec / 60), s = sec % 60;
      if (m <= 0) return s + ' 秒';
      return s === 0 ? (m + ' 分') : (m + ' 分 ' + s + ' 秒');
    },

    fmtDate: function (ts) {
      var d = new Date(ts);
      return d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate()) +
        ' ' + util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
    },

    fmtDay: function (ts) {
      var d = new Date(ts), now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return '今天 ' + util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
      return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
    },

    bytes: function (n) {
      if (!n) return '0 B';
      var u = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(n) / Math.log(1024));
      i = Math.min(i, u.length - 1);
      return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
    },

    escape: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    },

    easeOutExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },

    /** 数字滚动：requestAnimationFrame + easeOutExpo，800ms */
    countUp: function (el, to, opts) {
      if (!el) return;
      opts = opts || {};
      var dur = opts.duration || 800;
      var from = parseFloat(el.getAttribute('data-from') || '0') || 0;
      var dec = opts.decimals != null ? opts.decimals : (opts.decimals === 0 ? 0 : (to % 1 === 0 ? 0 : 1));
      var suffix = opts.suffix || '';
      var reduce = App.util.reducedMotion();

      if (reduce) { el.textContent = util.fmtNum(to, dec) + suffix; return; }

      var start = null;
      function frame(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        var v = util.lerp(from, to, util.easeOutExpo(p));
        el.textContent = util.fmtNum(v, dec) + suffix;
        if (p < 1) requestAnimationFrame(frame);
        else { el.textContent = util.fmtNum(to, dec) + suffix; el.setAttribute('data-from', String(to)); }
      }
      requestAnimationFrame(frame);
    },

    fmtNum: function (v, dec) {
      var s = (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec);
      return s;
    },

    reducedMotion: function () {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    },

    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },

    debounce: function (fn, wait) {
      var t = null;
      return function () {
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(self, args); }, wait);
      };
    },

    rafThrottle: function (fn) {
      var locked = false, lastArgs = null;
      return function () {
        lastArgs = arguments;
        if (locked) return;
        locked = true;
        requestAnimationFrame(function () {
          locked = false;
          fn.apply(null, lastArgs);
        });
      };
    },

    /** 触发下载 */
    download: function (blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
    },

    haptic: function (ms) {
      try {
        /* Chrome 在没有用户手势时报错并往控制台写一条 log，先自己挡掉 */
        var activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
        if (navigator.vibrate && activated && !util.reducedMotion()) navigator.vibrate(ms || 12);
      } catch (e) { /* 部分浏览器禁用振动，忽略 */ }
    },

    /** 把 blob 转成可 seek 的 <video> 需要 mp4/h264；webm 在部分 Safari 上不可播 */
    blobUrl: function (blob) {
      if (!blob) return '';
      return URL.createObjectURL(blob);
    },

    /** 图片压缩到最长边 max，输出 jpeg dataURL */
    compressImage: function (file, max, quality) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          var scale = Math.min(1, (max || 1280) / Math.max(img.width, img.height));
          var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          try { resolve(c.toDataURL('image/jpeg', quality || 0.82)); }
          catch (e) { reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
        img.src = url;
      });
    },

    copy: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      return Promise.reject(new Error('clipboard unavailable'));
    }
  };

  /* ------------------------------------------------------------ 事件总线 */
  var bus = App.bus = (function () {
    var map = {};
    return {
      on: function (name, fn) {
        (map[name] || (map[name] = [])).push(fn);
        return function () { bus.off(name, fn); };
      },
      off: function (name, fn) {
        var arr = map[name];
        if (!arr) return;
        var i = arr.indexOf(fn);
        if (i > -1) arr.splice(i, 1);
      },
      emit: function (name, detail) {
        var arr = map[name];
        if (!arr) return;
        arr.slice().forEach(function (fn) {
          try { fn(detail); } catch (e) { console.error('[bus] ' + name, e); }
        });
      }
    };
  })();

  /* ------------------------------------------------------------ 全局状态 */
  App.state = {
    page: 'home',
    stream: null,          // 当前 MediaStream
    screenStream: null,    // 第二路：录屏
    facing: 'user',
    mirrorPreview: true,
    zoom: 1,
    zoomMode: 'digital',   // 'hardware' | 'digital'
    topic: '',
    boardPoints: '',
    /* 本机 OCR 默认开：只有填了「必写板书要点」才会真的跑，不会平白下载识别模型 */
    ocrLocal: true,
    durationMin: 10,
    recording: false,
    session: null          // 本次录制会话（含时间轴数据）
  };

  /* ------------------------------------------------------------- 能力检测 */
  var env = App.env = {
    secure: (function () {
      return window.isSecureContext ||
        location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1';
    })(),
    isIOS: /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
    isAndroid: /Android/i.test(navigator.userAgent),
    hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    hasDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
    hasMediaRecorder: typeof window.MediaRecorder !== 'undefined',
    hasSpeechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    hasFaceDetector: typeof window.FaceDetector !== 'undefined',
    hasWakeLock: !!(navigator.wakeLock && navigator.wakeLock.request),
    hasVibrate: !!navigator.vibrate,
    hasIDB: !!window.indexedDB
  };

  /** MediaRecorder mimeType 探测顺序（Safari 优先生成 mp4） */
  env.pickMime = function () {
    if (!env.hasMediaRecorder) return '';
    var list = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264',
      'video/webm'
    ];
    for (var i = 0; i < list.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(list[i])) return list[i];
      } catch (e) { /* ignore */ }
    }
    return '';
  };

  /* 纯语音模式用的音频容器：优先 webm/opus，苹果系回落到 mp4/aac */
  env.pickAudioMime = function () {
    if (!env.hasMediaRecorder) return '';
    var list = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ];
    for (var i = 0; i < list.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(list[i])) return list[i];
      } catch (e) { /* ignore */ }
    }
    return '';
  };

  /* ------------------------------------------------------------- 本地设置 */
  var SETTINGS_KEY = 'tsj.settings.v1';
  var settings = App.settings = {
    data: {
      topic: '',
      durationMin: 10,
      hudWatermark: true,
      aiKey: '',
      aiEndpoint: 'https://api3.codexcn.com/v1/chat/completions',
      aiModel: 'gpt-6.1-sol',
      boardPoints: '',
      /* 本机 OCR：只在填了「必写板书要点」时才真的跑，所以默认开着不费流量 */
      ocrLocal: true,
      ocrEndpoint: '',
      frameMode: 'standard',
      captureMode: 'av',
      lessonMode: 'micro',
      faceSelfScore: null
    },
    load: function () {
      try {
        var raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) Object.assign(settings.data, JSON.parse(raw));
      } catch (e) { console.warn('[settings] load failed', e); }
      return settings.data;
    },
    save: function (patch) {
      if (patch) Object.assign(settings.data, patch);
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.data)); }
      catch (e) { console.warn('[settings] save failed', e); }
    }
  };
  settings.load();

  /* ----------------------------------------------------------------- 日志 */
  App.log = function () {
    if (!App.debug) return;
    console.log.apply(console, ['[试讲评分官]'].concat(Array.prototype.slice.call(arguments)));
  };

  App.util.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

})(window, document);