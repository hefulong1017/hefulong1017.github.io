/* 试讲评分官 · 人体姿态（MediaPipe Pose Landmarker，按需加载）
 *
 * 为什么要有这个文件：
 *   浏览器确实没有「原生姿态 API」，但「浏览器做不到」不是长期留空的理由。
 *   这里真的把一个姿态模型跑起来：MediaPipe Tasks Vision 的 pose_landmarker_lite，
 *   推理引擎（wasm ≈ 9.0 MB）与模型（≈ 5.5 MB）都放在本项目的 vendor/models 里，
 *   不走第三方 CDN，第一次用时才下载，下载进度是真实字节数。
 *
 * 它只回答一件事：这一帧里，人的关键点在哪、哪些关键点看得见。
 * 「这些关键点说明他背对学生」「说明他挡住了板书」是上层 frames.js 结合时间序列、
 * 板书区域、讲课阶段去判断的——关键点本身不等于仪态评价。
 */
(function (window) {
  'use strict';

  var App = window.App || (window.App = {});

  /* 实际资源（字节数来自文件本身，不是估计值） */
  var ASSETS = {
    bundle: 'vendor/mediapipe/vision_bundle.mjs',
    wasmJs: 'vendor/mediapipe/vision_wasm_internal.js',
    wasm: 'vendor/mediapipe/vision_wasm_internal.wasm',
    model: 'models/pose_landmarker_lite.task'
  };

  var META = {
    engine: 'MediaPipe Tasks Vision @mediapipe/tasks-vision 0.10.14',
    model: 'pose_landmarker_lite (float16)',
    runtime: 'WASM SIMD, 单线程，运行在页面主线程（每帧一次，非实时循环）',
    bytes: { bundle: 136870, wasmJs: 209826, wasm: 9423986, model: 5777746 }
  };

  var state = 'idle';      // idle | loading | ready | failed
  var failReason = '';
  var progress = 0;        // 0..1
  var loadedBytes = 0;
  var totalBytes = META.bytes.wasm + META.bytes.model;
  var loadingPromise = null;
  var landmarker = null;
  var videoLandmarker = null;
  var videoAssets = null;
  var videoReady = false;
  var blobUrls = [];
  var lastError = '';

  /* 资源路径以「本文件所在的 js/ 目录」为基准，往上退一级就是项目根。
     这样无论页面在根目录、子目录还是 _lab/ 里，都能找到 vendor/ 与 models/。 */
  var SELF_BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) return new URL('../', s.src).href;
    return new URL('./', document.baseURI).href;
  })();

  function base(name) {
    return new URL(name, SELF_BASE).href;
  }

  /* 带进度的二进制下载：读到多少字节就报多少，不猜 */
  function fetchWithProgress(url, onBytes) {
    return fetch(url, { cache: 'force-cache' }).then(function (res) {
      if (!res.ok) throw new Error('下载失败 ' + res.status + ' ' + url);
      var total = Number(res.headers.get('content-length') || 0);
      if (!res.body || !res.body.getReader) {
        return res.arrayBuffer().then(function (buf) {
          if (onBytes) onBytes(buf.byteLength, total || buf.byteLength);
          return buf;
        });
      }
      var reader = res.body.getReader();
      var chunks = [];
      var got = 0;
      var prev = 0;   /* 只报「这一次新增了多少」；报累计值会让上层重复累加 */
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(got);
            var off = 0;
            chunks.forEach(function (c) { out.set(c, off); off += c.byteLength; });
            return out.buffer;
          }
          chunks.push(r.value);
          got += r.value.byteLength;
          if (onBytes) { onBytes(got - prev, total); prev = got; }
          return pump();
        });
      })();
    });
  }

  function trackBytes(onProgress) {
    return function (delta) {
      loadedBytes = Math.min(totalBytes, loadedBytes + delta);
      progress = Math.min(1, loadedBytes / totalBytes);
      if (onProgress) onProgress({ loaded: loadedBytes, total: totalBytes, ratio: progress });
    };
  }

  function load(onProgress) {
    if (state === 'ready') return Promise.resolve(true);
    if (state === 'failed') return Promise.resolve(false);
    if (loadingPromise) return loadingPromise;

    state = 'loading';
    progress = 0;
    loadedBytes = 0;

    var tick = trackBytes(onProgress);

    loadingPromise = Promise.all([
      fetchWithProgress(base(ASSETS.wasmJs), null),
      fetchWithProgress(base(ASSETS.wasm), tick),
      fetchWithProgress(base(ASSETS.model), tick)
    ]).then(function (parts) {
      var wasmJsBuf = parts[0];
      var wasmBuf = parts[1];
      var modelBuf = parts[2];

      var jsUrl = URL.createObjectURL(new Blob([wasmJsBuf], { type: 'text/javascript' }));
      var wasmUrl = URL.createObjectURL(new Blob([wasmBuf], { type: 'application/wasm' }));
      blobUrls.push(jsUrl, wasmUrl);
      /* 留着给「视频模式」再建一个 landmarker 用：帧间跟踪比逐帧重检快得多 */
      videoAssets = { fileset: { wasmLoaderPath: jsUrl, wasmBinaryPath: wasmUrl }, model: modelBuf };

      return import(/* webpackIgnore: true */ base(ASSETS.bundle)).then(function (vision) {
        var fileset = {
          wasmLoaderPath: jsUrl,
          wasmBinaryPath: wasmUrl
        };
        return vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetBuffer: new Uint8Array(modelBuf),
            delegate: 'GPU'
          },
          runningMode: 'IMAGE',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5
        }).then(function (lm) {
          landmarker = lm;
          state = 'ready';
          progress = 1;
          return true;
        }).catch(function (e) {
          /* GPU delegate 在部分环境会失败，退回 CPU 再来一次 */
          lastError = (e && e.message) || String(e);
          return vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetBuffer: new Uint8Array(modelBuf), delegate: 'CPU' },
            runningMode: 'IMAGE',
            numPoses: 1
          }).then(function (lm) {
            landmarker = lm;
            state = 'ready';
            progress = 1;
            META.runtime = 'WASM，CPU delegate（GPU 委托不可用，已自动退回）';
            return true;
          });
        });
      });
    }).catch(function (e) {
      state = 'failed';
      failReason = (e && e.message) || String(e);
      throw e;
    });

    return loadingPromise;
  }

  /* 视频模式：帧与帧之间靠跟踪，比每帧独立检测快得多。
     tsMs 必须单调递增（这里传视频时间轴上的毫秒）。创建失败就返回 null，
     调用方会自动退回 detect()。 */
  function ensureVideoLandmarker() {
    if (videoReady) return Promise.resolve(videoLandmarker);
    if (!videoAssets) return Promise.resolve(null);
    return import(/* webpackIgnore: true */ base(ASSETS.bundle)).then(function (vision) {
      return vision.PoseLandmarker.createFromOptions(videoAssets.fileset, {
        baseOptions: { modelAssetBuffer: new Uint8Array(videoAssets.model), delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5
      }).catch(function () {
        return vision.PoseLandmarker.createFromOptions(videoAssets.fileset, {
          baseOptions: { modelAssetBuffer: new Uint8Array(videoAssets.model), delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1
        });
      });
    }).then(function (lm) {
      videoLandmarker = lm;
      videoReady = true;
      return lm;
    }).catch(function (e) {
      lastError = (e && e.message) || String(e);
      videoReady = true;
      videoLandmarker = null;
      return null;
    });
  }

  function detectAt(canvas, tsMs) {
    if (state !== 'ready') return null;
    if (!videoLandmarker) return detect(canvas);
    var res;
    try {
      res = videoLandmarker.detectForVideo(canvas, Math.max(0, Math.round(tsMs)));
    } catch (e) {
      lastError = (e && e.message) || String(e);
      videoLandmarker = null;
      return detect(canvas);
    }
    if (!res || !res.landmarks || !res.landmarks.length) return { landmarks: null, empty: true };
    return {
      landmarks: res.landmarks[0],
      world: (res.worldLandmarks && res.worldLandmarks[0]) || null,
      empty: false
    };
  }

  /* 单帧检测。canvas 必须已经画好这一帧。
     返回的关键点数组来自模型，visibility 是模型自己给的置信度。 */
  function detect(canvas) {
    if (state !== 'ready' || !landmarker) return null;
    var res;
    try {
      res = landmarker.detect(canvas);
    } catch (e) {
      lastError = (e && e.message) || String(e);
      return null;
    }
    if (!res || !res.landmarks || !res.landmarks.length) return { landmarks: null, empty: true };
    return {
      landmarks: res.landmarks[0],
      world: (res.worldLandmarks && res.worldLandmarks[0]) || null,
      empty: false
    };
  }

  function close() {
    try { if (landmarker && landmarker.close) landmarker.close(); } catch (e) { /* noop */ }
    landmarker = null;
    blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
    blobUrls = [];
    if (state !== 'failed') state = 'idle';
    loadingPromise = null;
    progress = 0;
    loadedBytes = 0;
  }

  App.Pose = {
    META: META,
    get state() { return state; },
    get progress() { return progress; },
    get failReason() { return failReason || lastError; },
    get loadedBytes() { return loadedBytes; },
    get totalBytes() { return totalBytes; },
    load: load,
    detect: detect,
    detectAt: detectAt,
    ensureVideoLandmarker: ensureVideoLandmarker,
    close: close
  };
})(window);