/* ============================================================================
   ocr.js —— 板书 OCR 字符框
   ----------------------------------------------------------------------------
   字距、字号这两项，靠「连通域的块」估不准：
     · 「口」「日」「回」会被拆成好几个块，估出来的字比实际小一半；
     · 连笔、擦不干净的地方又会把两个字连成一块，字距直接算成 0。
   所以这里接真的 OCR 拿字符框，两种后端：
     1) 服务端：设置里填一个地址，POST {image: dataURL, lang} → {boxes:[{x,y,w,h,text}]}
     2) 本机：tesseract.js（自托管在 vendor/tesseract/，不联网也能跑）
   两个都没配就不启用，报告里照实写「按连通域估算」。
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App = window.App || {};

  var state = { worker: null, loading: null, failReason: '' };

  function cfg() {
    var s = (App.settings && App.settings.data) || {};
    return {
      endpoint: (s.ocrEndpoint || '').trim(),
      local: !!s.ocrLocal,
      lang: (s.ocrLang || 'chi_sim').trim()
    };
  }

  function enabled() {
    var c = cfg();
    return !!(c.endpoint || c.local);
  }

  /* 把 canvas 缩到长边不超过 1600，OCR 更快，框坐标再按比例还原 */
  function shrink(canvas, maxSide) {
    maxSide = maxSide || 1600;
    var w = canvas.width, h = canvas.height;
    var k = Math.min(1, maxSide / Math.max(w, h));
    if (k >= 1) return { canvas: canvas, scale: 1 };
    var c2 = document.createElement('canvas');
    c2.width = Math.round(w * k);
    c2.height = Math.round(h * k);
    c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
    return { canvas: c2, scale: 1 / k };
  }

  function normalize(list, scale) {
    return (list || []).map(function (b) {
      var x = (b.x != null ? b.x : b.left) * scale;
      var y = (b.y != null ? b.y : b.top) * scale;
      var w = (b.w != null ? b.w : b.width) * scale;
      var h = (b.h != null ? b.h : b.height) * scale;
      return { x: x, y: y, w: w, h: h, text: b.text || '', conf: b.conf != null ? b.conf : null };
    }).filter(function (b) { return b.w > 0 && b.h > 0; });
  }

  function viaServer(canvas, c) {
    var dataUrl = canvas.toDataURL('image/png');
    var t0 = Date.now();
    return fetch(c.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, lang: c.lang, format: 'boxes' })
    }).then(function (r) {
      if (!r.ok) throw new Error('OCR 服务返回 HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var list = j.boxes || (j.data && j.data.boxes) || j.lines || [];
      if (!list.length) throw new Error('OCR 服务没有返回字符框');
      return { ok: true, source: 'server', boxes: list, ms: Date.now() - t0 };
    });
  }

  function loadLocal() {
    if (state.worker) return Promise.resolve(state.worker);
    if (state.loading) return state.loading;
    state.loading = new Promise(function (resolve, reject) {
      function fail(msg) {
        state.failReason = msg;
        reject(new Error(msg));
      }
      /* 资产走 CDN：wasm + 语言包一共 14MB，塞进站点会让部署包超过上传上限。
         jsDelivr 上这几个文件都是现成的，路径写死在下面，换版本时一起改。 */
      var CDN = {
        js: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
        worker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        core: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/',
        lang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int'
      };
      if (!window.Tesseract) {
        var s = document.createElement('script');
        s.src = CDN.js;
        s.onload = function () { boot(); };
        s.onerror = function () { fail('本机 OCR 的脚本没加载下来（cdn.jsdelivr.net 可能被挡了），可以改配一个服务端 OCR 地址。'); };
        document.head.appendChild(s);
      } else boot();

      function boot() {
        try {
          var w = window.Tesseract.createWorker(cfg().lang, 1, {
            workerPath: CDN.worker,
            corePath: CDN.core,
            langPath: CDN.lang,
            cacheMethod: 'none',
            logger: function () {}
          });
          Promise.resolve(w).then(function (worker) {
            state.worker = worker;
            resolve(worker);
          }).catch(function (e) { fail('本机 OCR 起不来：' + (e && e.message)); });
        } catch (e) {
          fail('本机 OCR 起不来：' + (e && e.message));
        }
      }
    });
    return state.loading;
  }

  function boxes(canvas) {
    var c = cfg();
    if (!canvas) return Promise.resolve({ ok: false, source: 'none', boxes: [], error: '没有板面图像' });
    if (!c.endpoint && !c.local) {
      return Promise.resolve({ ok: false, source: 'none', boxes: [], error: '没有配置 OCR' });
    }
    var small = shrink(canvas);
    var t0 = Date.now();

    var run = c.endpoint ? viaServer(small.canvas, c) : Promise.reject(new Error('skip'));
    return run.catch(function (err) {
      if (!c.local) throw err;
      /* 服务端不行（或没配）就退到本机 tesseract */
      return loadLocal().then(function (worker) {
        return worker.recognize(small.canvas, {}, { blocks: true }).then(function (res) {
          var words = [];
          var data = res && res.data;
          if (data && data.blocks) {
            data.blocks.forEach(function (bl) {
              (bl.paragraphs || []).forEach(function (p) {
                (p.lines || []).forEach(function (ln) {
                  (ln.words || []).forEach(function (wd) {
                    if (wd.bbox) words.push({ x: wd.bbox.x0, y: wd.bbox.y0, w: wd.bbox.x1 - wd.bbox.x0, h: wd.bbox.y1 - wd.bbox.y0, text: wd.text, conf: wd.confidence });
                  });
                });
              });
            });
          }
          if (!words.length) throw new Error('本机 OCR 没认出字');
          return { ok: true, source: 'local', boxes: words, text: (data && data.text) || '', ms: Date.now() - t0 };
        });
      });
    }).then(function (out) {
      var rawText = out.text || (out.boxes || []).map(function (b) { return b.text || ''; }).join('');
      return {
        ok: out.ok,
        source: out.source,
        boxes: normalize(out.boxes, small.scale),
        text: String(rawText || '').replace(/\s+/g, ' ').trim(),
        ms: out.ms != null ? out.ms : Date.now() - t0
      };
    }).catch(function (e) {
      return { ok: false, source: 'none', boxes: [], error: (e && e.message) || 'OCR 失败' };
    });
  }

  App.Ocr = {
    enabled: enabled,
    boxes: boxes,
    cfg: cfg,
    state: state,
    _normalize: normalize,
    _shrink: shrink
  };
})(window);
