/* 试讲评分官 · Service Worker
 *
 * 只做两件事：
 *   1. 把整个应用外壳缓存下来，第二次打开是瞬开的，地铁里没网也能用；
 *   2. 发版时换 VERSION，旧的缓存会被清掉。
 *
 * 刻意不做的事：
 *   - 不缓存录像/板书/历史（那些在 IndexedDB 里，跟这里无关）；
 *   - 不拦截跨域请求（AI 复核要发到你填的接口，必须直连）；
 *   - 不拦截非 GET。
 */

var VERSION = 'v119';
var CACHE = 'tsj-' + VERSION;

/* 应用外壳。路径全部相对 sw.js 所在目录，所以放在子路径下也能用。
   注意：vendor/mediapipe/* 与 models/*.task 合起来约 15MB（WASM 9.0MB + 模型 5.5MB），
   故意不放进预缓存清单——它们只在第一次真的要分析画面时才按需下载，
   而且要显示真实进度。预缓存会在装 SW 时白耗用户 15MB 流量。 */
var CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/v2.css',
  './css/print.css',
  './js/core.js',
  './js/store.js',
  './js/ui.js',
  './js/audio.js',
  './js/asr.js',
  './js/asrfile.js',
  './js/media.js',
  './js/pose.js',
  './js/frames.js',
  './js/board.js',
  './js/metrics-speech.js',
  './js/metrics-pose.js',
  './js/facemodel.js',
  './js/metrics-face.js',
  './js/metrics-board.js',
    './js/boardcheck.js',
  './js/rubric2.js',
  './js/theory.js',
  './js/ocr.js',
  './js/scoring.js',
  './js/rubric.js',
  './js/ai.js',
  './js/report.js',
  './js/history.js',
  './js/demo.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

/* 装好即缓存。任何一个文件 404 都不能让整次安装失败，所以逐个 add。 */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(CORE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          console.warn('[sw] 跳过缓存失败的文件', url, err && err.message);
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* 激活时清掉旧版本缓存。 */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

function isHTML(req) {
  return req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;
}

/* 页面导航：先走网络（保证拿到最新 HTML），断了就用缓存。 */
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || caches.match('./index.html');
    });
  });
}

/* 静态资源：先给缓存（所以快），后台顺手更新。 */
function staleWhileRevalidate(req) {
  return caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* 跨域（AI 接口、字体等）一律放行，不碰。 */
  if (url.origin !== self.location.origin) return;

  /* 服务端的健康检查不要缓存。 */
  if (url.pathname.indexOf('/api/') === 0) return;

  if (isHTML(req)) {
    e.respondWith(networkFirst(req));
    return;
  }

  /* 代码资源（js / css / manifest）也走网络优先：
     旧做法是「先给缓存、后台更新」，结果每次发版后第一次打开看到的还是上一版
     （之前在线上真的复现过：报告写着上一版的文案和分数）。
     代码只有几百 KB，多等一次网络换来「一打开就是最新版」是划算的；
     断网时依旧回落到缓存，离线可用不受影响。 */
  if (/\.(?:js|css|webmanifest)$/i.test(url.pathname)) {
    e.respondWith(networkFirst(req));
    return;
  }

  e.respondWith(staleWhileRevalidate(req));
});