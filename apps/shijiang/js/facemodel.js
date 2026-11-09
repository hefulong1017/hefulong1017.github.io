/* 试讲评分官 · 面部动作（MediaPipe Face Landmarker + blendshapes，按需加载）
 *
 * 只回答一件事：这一帧里，脸上的可观测动作是什么样——嘴角上扬多少、眉头下压多少、
 * 嘴唇有没有抿紧、眼球往哪边看。
 * 「紧张」「不自信」这类判断不在这里，也不在报告里：那是对心理的推断，不是画面里的事实。
 *
 * 模型：face_landmarker.task（float16，3.6 MB），与姿态模型共用同一套 wasm。
 */
(function (window) {
  'use strict';

  var App = window.App || (window.App = {});

  var ASSETS = {
    bundle: 'vendor/mediapipe/vision_bundle.mjs',
    wasmJs: 'vendor/mediapipe/vision_wasm_internal.js',
    wasm: 'vendor/mediapipe/vision_wasm_internal.wasm',
    model: 'models/face_landmarker.task'
  };

  var META = {
    engine: 'MediaPipe Tasks Vision @mediapipe/tasks-vision 0.10.14',
    model: 'face_landmarker (float16) + blendshapes(52)',
    bytes: { model: 3758596 }
  };

  var state = 'idle';       // idle | loading | ready | failed
  var failReason = '';
  var lastError = '';
  var loadingPromise = null;
  var landmarker = null;
  var progress = 0;
  var loadedBytes = 0;
  var totalBytes = META.bytes.model;

  var SELF_BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) return new URL('../', s.src).href;
    return new URL('./', document.baseURI).href;
  })();

  function base(name) { return new URL(name, SELF_BASE).href; }

  function fetchBytes(url, onBytes) {
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
      var prev = 0;
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

  function load(onProgress) {
    if (state === 'ready') return Promise.resolve(true);
    if (state === 'failed') return Promise.resolve(false);
    if (loadingPromise) return loadingPromise;

    state = 'loading';
    progress = 0;
    loadedBytes = 0;

    var tick = function (delta, total) {
      loadedBytes = Math.min(totalBytes, loadedBytes + delta);
      progress = Math.min(1, loadedBytes / totalBytes);
      if (onProgress) onProgress({ loaded: loadedBytes, total: totalBytes, ratio: progress });
    };

    loadingPromise = fetchBytes(base(ASSETS.model), tick).then(function (modelBuf) {
      return import(/* webpackIgnore: true */ base(ASSETS.bundle)).then(function (vision) {
        var fileset = {
          wasmLoaderPath: base(ASSETS.wasmJs),
          wasmBinaryPath: base(ASSETS.wasm)
        };
        var opts = {
          baseOptions: { modelAssetBuffer: new Uint8Array(modelBuf), delegate: 'GPU' },
          runningMode: 'IMAGE',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4
        };
        return vision.FaceLandmarker.createFromOptions(fileset, opts).then(function (lm) {
          landmarker = lm;
          state = 'ready';
          progress = 1;
          return true;
        }).catch(function (e) {
          /* GPU 委托在部分机器上起不来，退回 CPU */
          lastError = (e && e.message) || String(e);
          opts.baseOptions.delegate = 'CPU';
          return vision.FaceLandmarker.createFromOptions(fileset, opts).then(function (lm) {
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

  function pick(cats, name) {
    for (var i = 0; i < cats.length; i++) if (cats[i].categoryName === name) return cats[i].score || 0;
    return 0;
  }

  /* 单帧检测：把 52 个 blendshape 压成 5 个「看得见」的量。
     这些名字都对应脸上真实的肌肉动作，不做情绪命名。 */
  function detect(canvas) {
    if (state !== 'ready' || !landmarker) return null;
    var res;
    try {
      res = landmarker.detect(canvas);
    } catch (e) {
      lastError = (e && e.message) || String(e);
      return null;
    }
    if (!res || !res.faceBlendshapes || !res.faceBlendshapes.length) {
      return { present: false, blends: null };
    }
    var cats = res.faceBlendshapes[0].categories || [];
    var smileL = pick(cats, 'mouthSmileLeft');
    var smileR = pick(cats, 'mouthSmileRight');
    var browL = pick(cats, 'browDownLeft');
    var browR = pick(cats, 'browDownRight');
    var pressL = pick(cats, 'mouthPressLeft');
    var pressR = pick(cats, 'mouthPressRight');
    var rollLower = pick(cats, 'mouthRollLower');
    var eyeDownL = pick(cats, 'eyeLookDownLeft');
    var eyeDownR = pick(cats, 'eyeLookDownRight');
    var eyeUpL = pick(cats, 'eyeLookUpLeft');
    var eyeUpR = pick(cats, 'eyeLookUpRight');
    var eyeOutL = pick(cats, 'eyeLookOutLeft');
    var eyeInL = pick(cats, 'eyeLookInLeft');
    var jaw = pick(cats, 'jawOpen');
    var blinkL = pick(cats, 'eyeBlinkLeft');
    var blinkR = pick(cats, 'eyeBlinkRight');
    var browUpL = pick(cats, 'browInnerUp');
    var browUpR = (pick(cats, 'browOuterUpLeft') + pick(cats, 'browOuterUpRight')) / 2;
    var frownL = pick(cats, 'mouthFrownLeft');
    var frownR = pick(cats, 'mouthFrownRight');
    var pucker = pick(cats, 'mouthPucker');

    return {
      present: true,
      /* 0..1，都是模型自己给的分值，不二次加工 */
      blends: {
        smile: (smileL + smileR) / 2,
        brow: (browL + browR) / 2,
        press: Math.max(pressL, pressR, rollLower),
        gazeDown: (eyeDownL + eyeDownR) / 2,
        gazeUp: (eyeUpL + eyeUpR) / 2,
        gazeSide: (eyeOutL - eyeInL) / 2,
        jaw: jaw,
        blink: (blinkL + blinkR) / 2,
        browUp: (browUpL + browUpR) / 2,
        frown: (frownL + frownR) / 2,
        pucker: pucker
      }
    };
  }

  function close() {
    try { if (landmarker && landmarker.close) landmarker.close(); } catch (e) { /* noop */ }
    landmarker = null;
    if (state !== 'failed') state = 'idle';
    loadingPromise = null;
    progress = 0;
    loadedBytes = 0;
  }

  App.Face = {
    META: META,
    get state() { return state; },
    get progress() { return progress; },
    get failReason() { return failReason || lastError; },
    load: load,
    detect: detect,
    close: close
  };
})(window);
