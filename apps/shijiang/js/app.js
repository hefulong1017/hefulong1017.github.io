/* ==========================================================================
   app.js — 编排层：准备 → 录制 → 生成报告 → 历史
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;
  var ui = App.ui;

  var $ = function (id) { return document.getElementById(id); };

  /* 运行时状态（与 App.state 分工：这里放流程相关的临时对象） */
  var S = {
    sessionId: null,
    stream: null,
    screenStream: null,
    screenVideo: null,
    facing: 'user',
    mirror: true,
    zoom: 1,
    hwZoom: false,
    zoomCaps: null,

    recorder: null,
    audio: null,
    asr: null,
    posture: null,
    wake: null,

    startedAt: 0,
    durationMin: 10,
    captureMode: 'av',
    tick: 0,
    timerId: 0,
    draftId: 0,
    lastFillers: 0,
    silenceWarned: false,
    stopping: false,
    recording: false,

    videoBlob: null,
    videoUrl: '',
    report: null,

    playerVideo: null,
    playerUrl: ''
  };

  /* ======================================================================
     一、准备页
     ====================================================================== */
  function setNotice(msg, type) {
    var el = $('prepNotice');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'notice' + (type ? ' ' + type : '');
  }

  function setPerm(el, state, text) {
    if (!el) return;
    el.className = 'perm-dot' + (state ? ' ' + state : '');
    el.textContent = text;
  }

  function updatePerms(stream) {
    var hasV = stream.getVideoTracks().length > 0;
    var hasA = stream.getAudioTracks().length > 0;
    setPerm($('permMic'), hasA ? 'ok' : 'err', hasA ? '已授权' : '未获取到麦克风');
    if (S.captureMode === 'audio') {
      setPerm($('permCam'), '', '本次不用');
    } else {
      setPerm($('permCam'), hasV ? 'ok' : 'err', hasV ? '已授权' : '未获取到摄像头');
    }
  }

  /* 硬件能不能接下这个倍率：能接就别再用 CSS 缩一次，否则会缩两遍（黑边） */
  function hwActive() {
    var lo = (S.zoomCaps && S.zoomCaps.min != null) ? S.zoomCaps.min : 1;
    return !!(S.hwZoom && S.zoom >= lo - 1e-6);
  }

  function applyPreviewTransform() {
    var v = $('previewVideo');
    if (!v) return;
    var z = hwActive() ? 1 : S.zoom;
    v.style.transformOrigin = '50% 50%';
    v.style.transform = 'scaleX(' + (S.mirror ? -1 : 1) + ') scale(' + z.toFixed(3) + ')';
  }

  /* 录制页那块画面也要跟着变：否则预览是 1×、录出来是 0.5×，对不上。 */
  function applyRecordTransform() {
    var v = $('recVideo');
    if (!v) return;
    var z = hwActive() ? 1 : S.zoom;
    v.style.transformOrigin = '50% 50%';
    v.style.transform = 'scaleX(' + (S.mirror ? -1 : 1) + ') scale(' + z.toFixed(3) + ')';
  }

  function setZoom(v, silent) {
    /* 1× 以上是「放大裁切」，1× 以下是「缩小留边」（0.几倍的广角观感）。
       硬件支持到 0.5 就让摄像头自己缩，硬件只支持 1× 以上就在画布里缩。 */
    var hwMin = (S.hwZoom && S.zoomCaps && S.zoomCaps.min != null) ? S.zoomCaps.min : 1;
    /* 只有摄像头真的支持广角（min ≤ 0.5）才让滑块进 1× 以下：
       否则网页自己缩会留黑边，不如不给这个档位。 */
    var zlo = (S.hwZoom && hwMin <= 0.5) ? Math.max(0.5, hwMin) : 1;
    var zhi = (S.hwZoom && S.zoomCaps && S.zoomCaps.max) ? S.zoomCaps.max : 3;
    S.zoom = util.clamp(v, zlo, zhi);
    var label = S.zoom.toFixed(1) + '×';
    if ($('zoomLabel')) $('zoomLabel').textContent = label;
    if ($('zoomBadge')) $('zoomBadge').textContent = label;
    var slider = $('zoomSlider');
    if (slider && Math.abs(parseFloat(slider.value) - S.zoom) > 0.01) slider.value = String(S.zoom);

    if (hwActive() && S.stream) {
      var track = S.stream.getVideoTracks()[0];
      if (track && track.applyConstraints) {
        track.applyConstraints({ advanced: [{ zoom: S.zoom }] }).catch(function () {
          S.hwZoom = false;
          if ($('zoomMode')) $('zoomMode').textContent = '数字变焦';
          applyPreviewTransform();
        });
      }
    }
    if ($('zoomMode')) {
      $('zoomMode').textContent = (S.zoom < 1) ? '广角' : (S.hwZoom ? '硬件变焦' : '数字变焦');
    }
    applyPreviewTransform();
    applyRecordTransform();
    if (S.recorder) S.recorder.setZoom(hwActive() ? 1 : S.zoom);
    if (!silent) util.haptic(6);
  }

  function setupZoom(stream) {
    var track = stream.getVideoTracks()[0];
    var caps = (track && track.getCapabilities) ? track.getCapabilities() : {};
    var slider = $('zoomSlider');
    S.zoomCaps = null;

    if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) {
      S.hwZoom = true;
      S.zoomCaps = caps.zoom;
      /* 摄像头给的变焦范围可能从 0.5 起（广角），直接拿最小值当初始值，
         画面会变成「0.几倍」的缩边构图。默认永远从 1× 开始，范围只在 1 之外才放宽。 */
      var zmin = caps.zoom.min || 1;
      var zmax = caps.zoom.max || 3;
      var zbase = Math.min(Math.max(1, zmin), zmax);
      if (slider) {
        slider.min = String(zmin <= 0.5 ? zmin : 1);
        slider.max = String(zmax);
        slider.step = String(caps.zoom.step || 0.1);
        slider.value = String(zbase);
      }
      S.zoom = zbase;
      if ($('zoomMode')) $('zoomMode').textContent = '硬件变焦';
    } else {
      S.hwZoom = false;
      if (slider) { slider.min = '1'; slider.max = '3'; slider.step = '0.1'; slider.value = '1'; }
      S.zoom = 1;
      if ($('zoomMode')) $('zoomMode').textContent = '数字变焦';
    }
    setZoom(S.zoom, true);
  }

  function openPreviewStream(facing) {
    var video = $('previewVideo');
    var placeholder = $('previewPlaceholder');
    setNotice('');
    setPerm($('permMic'), '', '请求中…');
    setPerm($('permCam'), '', '请求中…');

    return App.Media.getUserMedia({ facing: facing || S.facing }).then(function (stream) {
      if (S.stream) App.Media.stopStream(S.stream);
      S.stream = stream;
      S.facing = (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().facingMode) || facing || 'user';
      App.state.stream = stream;
      App.Media.attach(video, stream);
      if (placeholder) placeholder.hidden = true;
      updatePerms(stream);
      stopPrepMeter();
      setupZoom(stream);
      applyPreviewTransform();
      return stream;
    }).catch(function (err) {
      setPerm($('permMic'), 'err', '未授权');
      setPerm($('permCam'), 'err', '未授权');
      var msg = App.Media.friendlyError(err);
      var tip = '';
      if (App.env.isIOS) tip = 'iOS：设置 → Safari 浏览器 → 相机 / 麦克风，改为「允许」。';
      else if (App.env.isAndroid) tip = '安卓：浏览器地址栏左侧的锁图标 → 权限 → 相机 / 麦克风允许。';
      else tip = '请在地址栏的权限图标里允许摄像头与麦克风，并确认页面是 https 或 localhost。';
      setNotice(msg + ' ' + tip, 'err');
      if (!App.env.secure) {
        setNotice('当前不是安全上下文（https 或 localhost），浏览器会拒绝摄像头。', 'err');
      }
      throw err;
    });
  }

  /* 纯语音模式：只申请麦克风。手机少弹一个权限，暗光/没支架也能练，
     板书与仪态两项按「没有画面」处理，其余照评。 */
  function openAudioStream() {
    setNotice('');
    setPerm($('permMic'), '', '请求中…');
    return App.Media.getUserMedia({ audio: true, video: false }).then(function (stream) {
      if (S.stream) App.Media.stopStream(S.stream);
      S.stream = stream;
      App.state.stream = stream;
      updatePerms(stream);
      if (S.captureMode === 'audio') startPrepMeter(stream);
      return stream;
    }).catch(function (err) {
      setPerm($('permMic'), 'err', '未授权');
      var msg = App.Media.friendlyError(err);
      var tip = App.env.isIOS
        ? 'iOS：设置 → Safari 浏览器 → 麦克风，改为「允许」。'
        : App.env.isAndroid
          ? '安卓：地址栏左侧的锁图标 → 权限 → 麦克风允许。'
          : '请在地址栏的权限图标里允许麦克风，并确认页面是 https 或 localhost。';
      setNotice(msg + ' ' + tip, 'err');
      throw err;
    });
  }

  /* 录制方式切换：换界面 + 换权限，两种模式互斥 */
  function paintCaptureMode() {
    var audio = S.captureMode === 'audio';
    var group = $('captureMode');
    if (group) {
      util.$$('.seg-item', group).forEach(function (b) {
        var on = b.getAttribute('data-cap') === S.captureMode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }

    var hint = $('capHint');
    if (hint) {
      hint.textContent = audio
        ? '只录音频：不申请摄像头，板书和仪态两项不评，其余照评——适合对着手机练口述、录音频复盘。'
        : '视频 + 语音：七项全评。只录音频：不申请摄像头，板书和仪态两项不评，其余照评——适合对着手机练口述、录音频复盘。';
    }

    ['previewWrap', 'zoomBar', 'screenHint', 'audioPrep'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (id === 'audioPrep') el.hidden = !audio;
      else el.hidden = audio;
    });
    var zoomHint = document.querySelector('.zoom-hint');
    if (zoomHint) zoomHint.hidden = audio;
    var tools = document.querySelector('.preview-tools');
    if (tools) tools.hidden = audio;
    var camRow = $('permCamRow');
    if (camRow) camRow.hidden = audio;

    if ($('btnBegin')) $('btnBegin').textContent = audio ? '开始录音' : '开始录制';
    var fine = document.querySelector('.prep-form > .fine.center');
    if (fine) {
      fine.textContent = audio
        ? '开始后会有 3 秒倒计时。只录音频，不录画面。'
        : '开始后会有 3 秒倒计时。录制中请勿锁屏。';
    }
    var place = $('previewPlaceholder');
    if (place && !audio) place.hidden = !!(S.stream && S.stream.active);
  }

  /* 电平条：准备页与录制页各一条，纯语音模式下让人看到「麦克风真的在收」 */
  function meterWidth(rms) {
    return Math.min(100, Math.max(3, (rms || 0) * 420)).toFixed(0) + '%';
  }

  function stopPrepMeter() {
    clearInterval(S.prepMeterId);
    S.prepMeterId = 0;
    if (S.prepMonitor) { try { S.prepMonitor.stop(); } catch (e) {} S.prepMonitor = null; }
  }

  function startPrepMeter(stream) {
    stopPrepMeter();
    if (!stream || !stream.getAudioTracks().length) return;
    S.prepMonitor = new App.AudioMonitor(stream);
    S.prepMonitor.start();
    S.prepMeterId = setInterval(function () {
      var el = $('prepLevel');
      if (!el || !S.prepMonitor || !S.prepMonitor.stats) return;
      el.style.width = meterWidth(S.prepMonitor.stats.lastRms);
    }, 120);
  }

  /* 评估形式：模拟试讲 / 完整课堂 / 教学片段。片段不要求导入小结，也不按时长折算。 */
  function paintLessonMode() {
    var modeGroup = $('lessonMode');
    if (modeGroup) {
      util.$$('.seg-item', modeGroup).forEach(function (b) {
        var on = b.getAttribute('data-mode') === S.lessonMode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    var hint = $('modeHint');
    if (hint) {
      hint.textContent = S.lessonMode === 'full'
        ? '完整课堂：一节 40 分钟左右的课。按五个环节、教学时长和板书全套评。'
        : S.lessonMode === 'clip'
          ? '教学片段：只评这一段讲得怎么样。不要求导入/小结/作业，也不按时长折算完成度。'
          : '模拟试讲：10 分钟上下，按五个环节评。';
    }
    var field = $('durationField');
    if (field) field.hidden = S.lessonMode === 'clip';
  }

  /* 分析精度：标准（自适应抽帧）/ 精细（1 秒 1 帧）。决定手势、快速转身这类瞬时动作能不能看见。 */
  function paintFrameMode() {
    var g = $('frameMode');
    if (g) {
      util.$$('.seg-item', g).forEach(function (b) {
        var on = (b.getAttribute('data-fm') || 'standard') === (S.frameMode || 'standard');
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    var hint = $('frameModeHint');
    if (hint) {
      hint.textContent = S.frameMode === 'fine'
        ? '精细：每秒 1 帧。眨眼、快速转身、短暂低头都能抓到，但 10 分钟素材要多花好几分钟。'
        : '标准：每 3 秒 1 帧（10 分钟约 200 帧），姿态、板书、面部都按这个节奏判断；眨眼、口型这类瞬时动作会标「不评」。';
    }
  }

  function enterPrepare() {
    injectAiSettings();
    var topic = $('topicInput');
    if (topic) topic.value = App.settings.data.topic || '';
    S.durationMin = App.settings.data.durationMin || 10;
    S.lessonMode = App.settings.data.lessonMode || 'micro';
    paintLessonMode();
    S.captureMode = App.settings.data.captureMode === 'audio' ? 'audio' : 'av';
    paintCaptureMode();
    S.frameMode = App.settings.data.frameMode === 'fine' ? 'fine' : 'standard';
    paintFrameMode();
    var group = $('durationGroup');
    if (group) {
      util.$$('.seg-item', group).forEach(function (b) {
        var on = parseInt(b.getAttribute('data-min'), 10) === S.durationMin;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    var mirrorBadge = $('mirrorBadge');
    if (mirrorBadge) mirrorBadge.hidden = !S.mirror;

    var needVideo = S.captureMode !== 'audio';
    var hasVideo = !!(S.stream && S.stream.getVideoTracks().length);
    if (!S.stream || !S.stream.active || (needVideo && !hasVideo)) {
      var open = needVideo ? openPreviewStream(S.facing) : openAudioStream();
      open.catch(function () {});
    } else if (needVideo) {
      App.Media.attach($('previewVideo'), S.stream);
      if ($('previewPlaceholder')) $('previewPlaceholder').hidden = true;
    }
    if (!App.env.hasDisplayMedia && $('btnScreen')) {
      $('btnScreen').disabled = true;
      $('btnScreen').style.opacity = '.4';
      if ($('screenHint')) $('screenHint').textContent = '当前设备不支持录屏（浏览器未提供 getDisplayMedia），已自动切换为仅摄像头录制。';
    }
    if (!App.env.hasSpeechRecognition && $('prepNotice')) {
      // 提示但不清空其它错误
      var n = $('prepNotice');
      if (n.hidden) setNotice('这台设备的浏览器没有实时语音识别：录像照常，停顿、语速、板书、仪态都照评；' +
        '「教学内容」和「语气词」这两项这次会标「未评估」，不出完整分。' +
        '要看完整评分：① 用系统浏览器重开（Safari / Chrome；在微信、QQ 里请点右上角「在浏览器中打开」）；' +
        '② 或者录完改用「上传视频 + 字幕」。', 'warn');
    }
    updatePrepClock();
  }

  function updatePrepClock() {
    var el = $('prepClock');
    if (!el) return;
    var d = new Date();
    el.textContent = util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
  }

  /* ------------------------------------------------------------- 变焦手势 */
  function bindGestures() {
    var wrap = $('previewWrap');
    if (!wrap) return;
    var startDist = 0, startZoom = 1, pinching = false, lastTap = 0;

    function dist(t) {
      var dx = t[0].clientX - t[1].clientX;
      var dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    wrap.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        pinching = true;
        startDist = dist(e.touches);
        startZoom = S.zoom;
      }
    }, { passive: true });

    wrap.addEventListener('touchmove', function (e) {
      if (!pinching || e.touches.length !== 2) return;
      var d = dist(e.touches);
      if (startDist > 0) {
        var z = startZoom * (d / startDist);
        var max = S.hwZoom && S.zoomCaps ? S.zoomCaps.max : 3;
        setZoom(util.clamp(z, 1, max), true);
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    wrap.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) pinching = false;
      var now = Date.now();
      if (now - lastTap < 280 && e.touches.length === 0) {
        setZoom(S.zoom > 1.4 ? 1 : 2);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }, { passive: true });
  }

  /* ======================================================================
     二、录制
     ====================================================================== */
  /* 手机浏览器经常在画面还没就绪时就 play()，失败后不会自己重试，
     结果录制页是一片黑。这里连着踢几次，切回前台也补一次。 */
  function ensureVideoPlaying(v) {
    if (!v) return;

    function kick() {
      if (!v.isConnected) return;
      if (v.paused || v.readyState < 2) {
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
    }

    var tries = 0;
    (function loop() {
      kick();
      if (tries++ < 8 && S.recording) setTimeout(loop, 500);
    })();

    if (!ensureVideoPlaying.bound) {
      ensureVideoPlaying.bound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        var el = $('recVideo');
        if (el && S.recording) {
          var p = el.play();
          if (p && p.catch) p.catch(function () {});
        }
        /* 切回前台常常是识别被系统掐掉的时刻，顺手续上 */
        if (S.asr && S.recording && S.asr.pending && S.asr.resume()) setLiveState('listening');
      });
    }

    /* 老浏览器不认 aspect-ratio，取景框会被压成 0 高：按真实画面比例手动撑开 */
    fitCamBox(v);
    if (!fitCamBox.bound) {
      fitCamBox.bound = true;
      window.addEventListener('orientationchange', function () {
        setTimeout(function () { var el = $('recVideo'); if (el) fitCamBox(el); }, 350);
      });
      window.addEventListener('resize', function () {
        var el = $('recVideo'); if (el) fitCamBox(el);
      });
    }
  }

  function fitCamBox(v) {
    if (!v) return;
    var box = v.closest ? v.closest('.rec-cam') : null;
    if (!box) return;
    var apply = function () {
      var w = box.clientWidth || box.offsetWidth;
      var vw = v.videoWidth || 0;
      var vh = v.videoHeight || 0;
      if (!w || !vw || !vh) return;
      var h = Math.round(w * vh / vw);
      h = Math.max(150, Math.min(h, Math.round(w * 1.9)));
      box.style.height = h + 'px';
    };
    apply();
    if (v.readyState < 1) v.addEventListener('loadedmetadata', apply, { once: true });
    setTimeout(apply, 400);
    setTimeout(apply, 1200);
  }

  function startRecording() {
    if (S.recording) return;
    var audioOnly = S.captureMode === 'audio';
    if (!S.stream || !S.stream.active) {
      ui.toast(audioOnly ? '麦克风还没准备好' : '摄像头还没准备好', 'warn');
      return;
    }

    S.sessionId = util.uid();
    S.stopping = false;
    S.recording = true;
    S.tick = 0;
    S.lastFillers = 0;
    S.silenceWarned = false;

    ui.go('record');

    var recVideo = $('recVideo');
    var recMain = document.querySelector('.rec-main');
    if (recMain) recMain.classList.toggle('audio-mode', audioOnly);
    if ($('recAudio')) $('recAudio').hidden = !audioOnly;
    /* 纯语音模式下拍板书、变焦都用不上，藏起来省得点了没反应 */
    if ($('btnBoardShot')) $('btnBoardShot').hidden = audioOnly;
    if ($('btnRecZoom')) $('btnRecZoom').hidden = audioOnly;
    if (!audioOnly) {
      App.Media.attach(recVideo, S.stream);
      ensureVideoPlaying(recVideo);
      recVideo.style.transform = 'scaleX(' + (S.mirror ? -1 : 1) + ')';
      recVideo.style.transformOrigin = '50% 50%';
    }

    // 屏幕共享：作为画中画叠在右上角（纯语音模式没有画面，不用录屏）
    if (!audioOnly && S.screenStream && S.screenStream.active) {
      if (!S.screenVideo) {
        S.screenVideo = document.createElement('video');
        S.screenVideo.muted = true;
        S.screenVideo.playsInline = true;
        S.screenVideo.style.display = 'none';
        document.body.appendChild(S.screenVideo);
      }
      S.screenVideo.srcObject = S.screenStream;
      S.screenVideo.play().catch(function () {});
    }

    var topic = ($('topicInput') && $('topicInput').value.trim()) || App.settings.data.topic || '未填写课题';
    App.settings.save({ topic: topic, durationMin: S.durationMin });

    if ($('recTopic')) $('recTopic').textContent = topic;
    if ($('recTimer')) $('recTimer').textContent = '00:00';
    if ($('recRemain')) $('recRemain').textContent = '/ ' + util.fmtTime(S.durationMin * 60);
    if ($('btnStop')) $('btnStop').classList.remove('stopping');

    /* 录像：canvas 合成管线；纯语音模式只录音轨 */
    S.recorder = new App.Media.Recorder({
      video: recVideo,
      stream: S.stream,
      sessionId: S.sessionId,
      topic: topic,
      showHud: !audioOnly,
      audioOnly: audioOnly,
      onChunk: function (blob, idx) {
        App.db.putChunk(S.sessionId, idx, blob).catch(function () {});
      },
      onError: function (e) {
        ui.toast('录制中断：' + (e.message || e), 'err', 5000);
      }
    });
    if (S.screenStream && S.screenStream.active && S.screenVideo) {
      S.recorder.pip = S.screenVideo;
    }
    S.recorder.setZoom(hwActive() ? 1 : S.zoom);
    applyRecordTransform();
    if (!audioOnly && App.Board.has()) {
      S.recorder.setBoard(App.Board.url());
    }

    /* 音频分析 */
    if (S.stream.getAudioTracks().length) {
      S.audio = new App.AudioMonitor(S.stream);
      S.audio.start();
    }

    /* 语音识别 */
    resetLive();
    if (App.ASR.isSupported()) {
      S.asr = new App.ASR({
        onResult: function () { renderLive(); },
        onPartial: function () { renderLive(); },
        onDegrade: function (reason) { setLiveState('degraded', reason); },
        onState: function (state) {
          /* 自动续上之后要把「识别暂停了」改回来，否则界面一直停在暂停态 */
          if (state === 'listening' && S.recording) setLiveState('listening');
        },
        onError: function (code) {
          if (code === 'network') setLiveState('network');
          App.log('asr error', code);
        }
      });
      if (S.asr.start()) setLiveState('listening');
      else setLiveState('degraded', S.asr.reason || 'unsupported');
    } else {
      S.asr = null;
      setLiveState('unsupported');
    }

    /* 仪态不再在录制时打分：录完把整段录像交给 App.Frames 逐帧分析关键点，
       只保留「连续片段」这类可证伪的结论。这里不再起 Posture 采样器——
       之前那版按「出镜率/居中度」采样，既和现在的评分口径冲突，也会在它
       挂掉时把整个 startRecording 拖崩（时间不走、语速停顿全 0 就是这个原因）。 */
    S.posture = null;

    /* 屏幕常亮 */
    S.wake = App.Media.keepAwake();

    S.startedAt = performance.now();
    S.recorder.start().then(function () {
      if ($('recStatus')) $('recStatus').textContent = '本机录制 · 不上传 · 结束自动出分';
    }).catch(function (e) {
      S.recording = false;
      ui.toast('无法开始录制：' + (e.message || e), 'err', 5000);
      teardown();
      ui.go('prepare');
    });

    S.timerId = setInterval(tickRecording, 250);
    S.draftId = setInterval(saveDraft, 10000);
    saveDraft();

    /* 识别被系统掐掉后，隔一会儿自己再试一次：有用户手势的浏览器会直接续上，
       iOS 会继续挂着（按钮还在），但不会让整段试讲的文字停在半句话上。 */
    if (S.asr) {
      S.asrWatch = setInterval(function () {
        if (!S.recording || !S.asr || !S.asr.pending) return;
        S.asr.retryPending();
      }, 9000);
    }

    bindUnload();
    util.haptic(16);
  }

  /* ---- 实时字幕 ---- */
  function resetLive() {
    var box = $('recLines');
    if (box) {
      box.innerHTML = '<p class="rec-empty">开始讲话，这里会实时出现文字。</p>';
      box.removeAttribute('data-hinted');
    }
    var retry = $('btnAsrRetry');
    if (retry) retry.hidden = true;
    var dot = $('liveDot');
    if (dot) dot.className = 'live-dot';
    var st = $('liveState');
    if (st) st.textContent = '实时识别';
    var c = $('liveCount');
    if (c) c.textContent = '';
    S.liveHinted = false;
  }

  /* —— 语音识别失败时给一条能走通的路 ——
       Chrome 的 Web Speech 走 Google 服务器，国内几乎必然 network 报错；
       Edge 走微软 Azure，同一个页面直接就正常。所以这里不重试到死，
       而是在第一次报错时直接把「换 Edge」摆在用户面前。 */
    var IS_EDGE = /Edg\//.test(navigator.userAgent);
    var IS_CHROME = /Chrome\//.test(navigator.userAgent) && !IS_EDGE;

    function copyUrl() {
      var url = location.href;
      return util.copy(url).catch(function () {
        /* 不是 https 或没给剪贴板权限时退回老办法 */
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.cssText = 'position:fixed;top:-100px;left:-100px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
      });
    }

    function ensureAsrHint() {
      var box = $('asrHint');
      if (box) return box;

      box = document.createElement('div');
      box.id = 'asrHint';
      box.className = 'asr-hint';
      box.innerHTML =
        '<span>Chrome 用的是 Google 的语音服务，国内连不上，所以没有字幕。' +
        '<b>换成 Edge 打开这个页面</b>就有了，其它功能完全一样。</span>' +
        '<button type="button" data-role="copy">复制地址</button>' +
        '<button type="button" class="ghost" data-role="close">就这样录</button>';

      var host = $('recLines');
      var parent = host ? host.parentNode : $('page-record');
      if (parent) parent.insertBefore(box, host || null);

      box.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.getAttribute ? ev.target.closest('[data-role]') : null;
        if (!b) return;
        if (b.getAttribute('data-role') === 'copy') {
          copyUrl().then(function () {
            b.textContent = '已复制';
            setTimeout(function () { b.textContent = '复制地址'; }, 1600);
          });
        } else {
          box.remove();
        }
      });
      return box;
    }

    function setLiveState(kind, reason) {
    var dot = $('liveDot');
    var st = $('liveState');
    if (dot) {
      dot.className = 'live-dot' +
        (kind === 'listening' ? ' on' :
         (kind === 'degraded' || kind === 'network' || kind === 'unsupported') ? ' err' : '');
    }
    if (st) {
      if (kind === 'listening') st.textContent = '实时识别中';
      else if (kind === 'network') st.textContent = '语音服务连不上，正在重试';
      else if (kind === 'unsupported') st.textContent = '这个浏览器不支持实时识别';
      else if (reason === 'needs-gesture') st.textContent = '识别暂停了，点一下继续';
      else if (reason === 'start-failed') st.textContent = '识别没能启动，点「重试识别」';
      else if (reason === 'service-off') st.textContent = '系统听写没开（设置里启用听写）';
      else if (reason === 'not-allowed') st.textContent = (S.asr && !S.asr.startedOnce) ? '识别没能启动，点右边重试' : '麦克风被拒绝，无法识别';
      else if (reason === 'no-mic') st.textContent = '找不到麦克风';
      else st.textContent = '识别已停止';
    }

    /* 暂停/降级时把「重试识别」摆出来，用户点一下就能续上（iOS 必须靠点击给手势） */
    var retryBtn = $('btnAsrRetry');
    if (retryBtn) retryBtn.hidden = !(kind === 'degraded' && reason !== 'unsupported');
    App.log('live state', kind, reason || '');

    /* Chrome 在国内基本拿不到 Google 的语音服务，第一次报错就把「换 Edge」摆出来 */
    if (kind === 'network' && IS_CHROME && !S.asrHintShown) {
      S.asrHintShown = true;
      ensureAsrHint();
    }

    if (kind === 'unsupported') {
      var box = $('recLines');
      if (box) {
        box.innerHTML = '<p class="rec-empty">这个浏览器没有实时识别：停顿、语速、板书、仪态照评，' +
          '「教学内容」「语气词」这次会标未评估。<br>想有逐字稿：用系统浏览器（Safari / Chrome）重开，' +
          '或录完改用「上传视频 + 字幕」。</p>';
      }
    }

    if (kind === 'degraded' && reason !== 'unsupported') {
      var box2 = $('recLines');
      if (box2 && (!S.asr || !S.asr.transcript.length) && box2.getAttribute('data-hinted') !== '1') {
        box2.setAttribute('data-hinted', '1');
        box2.innerHTML = '<p class="rec-empty">实时识别暂时没起来：停顿、语速、板书、仪态照评。' +
          '点「重试识别」再试一次；iPhone 还要确认「设置 → 通用 → 键盘 → 启用听写」是开着的。' +
          '两次都不行，就录完改用「上传视频 + 字幕」。</p>';
      }
    }
  }

  function renderLive() {
    var box = $('recLines');
    if (!box) return;
    var asr = S.asr;
    /* 录制时把识别出的文字直接铺出来：不只留最后一句，用户要能看见自己都说了什么。
       太多行也没意义，留最近 6 句，剩下的在报告里看全文。 */
    var finals = asr ? asr.transcript.slice(-6) : [];
    var interim = asr ? (asr.interim || '') : '';
    var html = '';

    for (var i = 0; i < finals.length; i++) {
      var last = (i === finals.length - 1) && !interim;
      html += '<p class="rec-line ' + (last ? 'now' : 'past') + '">' +
        util.escape(finals[i].text) + '</p>';
    }
    if (interim) html += '<p class="rec-line live">' + util.escape(interim) + '</p>';
    box.innerHTML = html || '<p class="rec-empty">开始讲话，这里会实时出现文字。</p>';
    /* 新的一句进来要自动滚到底，否则看起来像「文字没出来」 */
    if (html) {
      try { box.scrollTop = box.scrollHeight; } catch (e) {}
    }

    var c = $('liveCount');
    if (c && asr) {
      var n = asr.fullText().length;
      var fixed = asr.corrected || 0;
      c.textContent = n ? (n + ' 字' + (fixed ? ' · 已自动纠正 ' + fixed + ' 处' : '')) : '';
    }
  }

  function tickRecording() {
    if (!S.recording) return;
    S.tick++;
    var elapsed = (performance.now() - S.startedAt) / 1000;

    /* 纯语音模式：录音时也要有可见反馈，否则用户不知道麦克风有没有在工作 */
    if (S.captureMode === 'audio') {
      var lv = $('recLevel');
      if (lv) lv.style.width = meterWidth(S.audio && S.audio.stats ? S.audio.stats.lastRms : 0);
    }

    if ($('recTimer')) $('recTimer').textContent = util.fmtTime(elapsed);
    var remain = S.durationMin * 60 - elapsed;
    if ($('recRemain')) {
      $('recRemain').textContent = remain >= 0 ? '/ ' + util.fmtTime(remain) : '+ ' + util.fmtTime(-remain);
      $('recRemain').classList.toggle('warn', remain <= 60);
    }

    var snap = S.audio ? S.audio.snapshot() : null;
    var chars = 0;
    if (S.asr && S.asr.transcript.length) {
      chars = App.text.charCount(S.asr.fullText());
    } else if (snap) {
      chars = snap.estimatedChars;
    }

    /* 语速 = 字数 ÷ 真正在说话的时长。
       麦克风的「有声秒数」受噪声校准影响，偶尔会低到离谱（于是语速飙到 1000+），
       所以用识别出来的时间跨度兜一下，并且给个上限。 */
    var speechSec = snap ? (snap.speechSeconds || 0) : 0;
    var span = 0;
    if (S.asr && S.asr.transcript.length > 1) {
      span = S.asr.transcript[S.asr.transcript.length - 1].t - S.asr.transcript[0].t;
    }
    if (span > 3 && !(speechSec >= span * 0.55)) speechSec = span * 0.95;
    if (!(speechSec > 2)) speechSec = Math.max(3, elapsed * 0.9);

    var rate = chars ? Math.round(chars / (speechSec / 60)) : 0;
    if (rate > 420) rate = 420;

    if ($('recSpeed')) $('recSpeed').textContent = rate || '—';
    if ($('recPauses')) $('recPauses').textContent = snap ? snap.pauseCount : 0;
    if ($('recWords')) $('recWords').textContent = chars;

    if (S.tick % 4 === 0) {
      if (S.asr && S.asr.transcript.length) {
        var n = App.text.fillers(S.asr.fullText()).filter(function (f) { return f.counted; }).length;
        S.lastFillers = n;
      }
      if ($('recFillers')) $('recFillers').textContent = S.lastFillers;
    }

    drawWave(snap);

    /* 说了 8 秒还是一句话都没识别出来 —— 把原因说清楚，别让用户干等 */
    if (S.asr && S.asr.active && !S.asr.sawFinal && elapsed > 8 && !S.liveHinted) {
      S.liveHinted = true;
      var stEl = $('liveState');
      if (stEl) stEl.textContent = '一直没识别到文字 · 换 Edge 打开通常就好了';
      var dotEl = $('liveDot');
      if (dotEl) dotEl.className = 'live-dot err';
    }

    /* 连续静音 5 秒 */
    if (S.audio && S.audio.inSilence) {
      var quiet = S.audio.elapsed - S.audio.silenceStart;
      if (quiet >= 5 && !S.silenceWarned) {
        S.silenceWarned = true;
        util.haptic(80);
        showSilenceToast();
      }
    } else if (S.audio) {
      S.silenceWarned = false;
    }
  }

  function showSilenceToast() {
    var el = $('silenceToast');
    if (!el) return;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  var waveAccent = 0;
  function drawWave(snap) {
    var c = $('recWave');
    if (!c) return;
    var ctx = c.getContext('2d');
    var w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    var data = (snap && snap.wave) || (S.audio && S.audio.wave) || [];
    var n = Math.min(72, data.length);
    if (!n) return;
    var barW = w / 72;
    var max = Math.max(0.06, (snap && snap.maxRms) || 0.2);
    waveAccent += 0.08;

    for (var i = 0; i < n; i++) {
      var v = data[data.length - n + i] || 0;
      var norm = util.clamp(v / max, 0, 1);
      var bh = Math.max(2, norm * h * 0.92);
      var x = i * barW + barW * 0.22;
      var bw = barW * 0.56;
      var y = (h - bh) / 2;
      ctx.fillStyle = norm > 0.55 ? 'rgba(29,29,31,.85)' : 'rgba(29,29,31,.28)';
      ctx.beginPath();
      var r = bw / 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + bw, y, x + bw, y + bh, r);
      ctx.arcTo(x + bw, y + bh, x, y + bh, r);
      ctx.arcTo(x, y + bh, x, y, r);
      ctx.arcTo(x, y, x + bw, y, r);
      ctx.closePath();
      ctx.fill();
    }
  }

  function saveDraft() {
    if (!S.recording) return;
    App.draft.save({
      id: S.sessionId,
      startedAt: Date.now(),
      elapsed: Math.round((performance.now() - S.startedAt) / 1000),
      topic: ($('topicInput') && $('topicInput').value.trim()) || '',
      durationMin: S.durationMin,
      duration: Math.round((performance.now() - S.startedAt) / 1000)
    });
  }

  function bindUnload() {
    if (bindUnload._bound) return;
    bindUnload._bound = true;
    window.addEventListener('beforeunload', function (e) {
      if (!S.recording) return;
      e.preventDefault();
      e.returnValue = '正在录制，离开会丢失本次试讲。';
      return e.returnValue;
    });
  }

  function askStop() {
    if (!S.recording || S.stopping) return;
    ui.modal({
      title: '结束这次试讲？',
      text: '停止后会立刻生成评分报告，录像保存在本机。',
      okText: '结束并评分',
      cancelText: '继续讲',
      danger: true
    }).then(function (ok) {
      if (ok) stopRecording();
    });
  }

  /* 分析时盖一层，别让人对着冻结的录制页猜「是不是卡死了」 */
  function showAnalyzing(text) {
    var el = document.getElementById('analyzing');
    if (!el) {
      el = document.createElement('div');
      el.id = 'analyzing';
      el.className = 'analyzing';
      el.innerHTML = '<div class="an-card"><div class="an-spin"></div>' +
        '<div class="an-title">正在分析录像</div><p class="an-text"></p>' +
        '<p class="an-hint">第一次要载入姿态与表情模型，大约一分钟；之后同样的录像会快很多。</p></div>';
      document.body.appendChild(el);
    }
    var t = el.querySelector('.an-text');
    if (t) t.textContent = text || '准备中…';
    el.classList.add('on');
  }
  function hideAnalyzing() {
    var el = document.getElementById('analyzing');
    if (el) el.classList.remove('on');
  }

  function stopRecording() {
    if (!S.recording || S.stopping) return;
    S.stopping = true;
    S.recording = false;

    clearInterval(S.timerId);
    clearInterval(S.draftId);
    clearInterval(S.asrWatch);
    S.asrWatch = null;
    if ($('btnStop')) $('btnStop').classList.add('stopping');
    if ($('recStatus')) $('recStatus').textContent = '正在收敛数据…';
    util.haptic(20);

    var audioSnap = null;
    if (S.audio) audioSnap = S.audio.stop();
    if (S.asr) S.asr.stop();
    var posture = null;
    if (S.posture) { S.posture.stop(); posture = S.posture.score(); }
    if (S.wake) { S.wake.release(); S.wake = null; }

    var transcript = S.asr ? S.asr.transcript.slice() : [];
    /* 只要有文字就算拿到了逐字稿：中途降级（比如识别被系统掐掉）不该把已经说的话丢掉 */
    var asrOK = transcript.length > 0;

    /* 麦克风的「有声秒数」偏低时用识别跨度兜底，否则语速会被算成 1000+ 字/分钟 */
    if (audioSnap && transcript.length > 1) {
      var tSpan = transcript[transcript.length - 1].t - transcript[0].t;
      if (tSpan > 5 && !((audioSnap.speechSeconds || 0) >= tSpan * 0.55)) {
        audioSnap.speechSeconds = Math.round(tSpan * 0.95 * 10) / 10;
      }
    }

    var rec = S.recorder;
    var done = rec ? rec.stop() : Promise.resolve(null);

    done.then(function (result) {
      buildReport({
        result: result,
        audio: audioSnap,
        posture: posture,
        transcript: transcript,
        asrOK: asrOK,
        /* 报告里要说清楚「自动纠正了几处」，否则用户以为纠错没生效 */
        asr: { corrected: (S.asr && S.asr.corrected) || 0 }
      });
    }).catch(function (e) {
      console.warn('[app] stop failed', e);
      ui.toast('停止录制时出错：' + (e.message || e), 'err', 5000);
      buildReport({ result: null, audio: audioSnap, posture: posture, transcript: transcript, asrOK: asrOK });
    });
  }

  /* ======================================================================
     三、生成与保存报告
     ====================================================================== */
  function buildReport(pack) {
    if ($('recStatus')) $('recStatus').textContent = '正在分析画面…第一次要载入姿态模型（约 5.5 MB），可能要等一分钟';
    showAnalyzing('准备分析…');

    var topic = ($('topicInput') && $('topicInput').value.trim()) || App.settings.data.topic || '未填写课题';
    var audioOnly = S.captureMode === 'audio';
    var boardUrl = audioOnly ? '' : App.Board.url();
    var duration = (pack.result && pack.result.duration) || (pack.audio && pack.audio.duration) || 0;

    var boardPromise;
    if (boardUrl) {
      boardPromise = App.Scoring.analyzeBoard(boardUrl)
        .catch(function () { return null; })
        .then(function (auto) { return { url: boardUrl, auto: auto, from: 'photo', at: null }; });
    } else {
      boardPromise = Promise.resolve({ url: null, auto: null, from: 'none', at: null });
    }

    /* 真正看画面：姿态模型逐帧跑，产出「看到了什么行为」而不是「人在不在中间」。
       没有录像就跳过（上传纯音频、或录制失败时）。 */
    /* 先让「正在分析」这行字真正画到屏幕上，再开始跑重活：
       姿态/表情模型首次加载要几十秒，会把主线程占满，不先让出一次绘制就会看起来像卡死。 */
    function deferStart(fn) {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () { setTimeout(function () { resolve(fn()); }, 60); });
      });
    }
    var visionPromise = (!audioOnly && pack.result && pack.result.blob && pack.result.blob.size && App.Frames && App.Frames.analyze)
      ? deferStart(function () {
          return App.Frames.analyze(pack.result.blob, {
            fine: S.frameMode === 'fine',
            onProgress: function (p) {
              if ($('recStatus') && p && p.text) $('recStatus').textContent = p.text;
              if (p && p.text) showAnalyzing(p.text);
            }
          });
        }).catch(function (e) {
          console.warn('[app] 画面分析失败', e);
          return null;
        })
      : Promise.resolve(null);

    Promise.all([boardPromise, visionPromise]).then(function (out) {
      var bd = out[0];
      var vision = out[1];

      /* 板书内容核对挪到 buildWithBoard：那里的 report 才是最终对象，这里赋值会被丢掉 */

      /* 录像里找到的板书：还用像素分析给出可测量项，但可读性/极性由视觉引擎给 */
      if (!bd.url && vision && vision.board && vision.board.dataUrl) {
        bd = {
          url: vision.board.dataUrl,
          auto: null,
          from: 'frames',
          at: vision.board.crop ? vision.board.crop.t : null,
          readability: vision.board.readability || null,
          polarity: vision.board.polarity || null
        };
      }

      var shots = (vision && vision.shots) || [];

      return App.Scoring.analyzeBoard(bd.url || '').catch(function () { return null; }).then(function (auto) {
        if (auto && bd.readability) auto.readability = bd.readability;
        if (auto && bd.polarity) auto.polarity = bd.polarity;
        return buildWithBoard(bd, auto, shots, vision);
      });
    }).catch(function (e) {
      console.error('[app] buildReport failed', e);
      teardown();
      ui.go('prepare');
      ui.toast('评分没有跑完：' + (e.message || e) + '。录像可能已丢失，请重试一次。', 'err', 6000);
    });

    function buildWithBoard(bd, boardAuto, shots, vision) {
      /* 语言指标先算：评分里的「语速」要跟报告「语言与节奏」用同一口径 */
      var speechMetrics = null;
      if (App.MetricsSpeech && App.MetricsSpeech.analyze) {
        try {
          speechMetrics = App.MetricsSpeech.analyze({
            segments: (pack.transcript || []).map(function (s) {
              return { t: s.t, text: s.text, raw: s.raw != null ? s.raw : s.text };
            }),
            audio: pack.audio || {},
            duration: duration
          });
        } catch (e) {
          console.warn('[app] 语言指标计算失败', e);
        }
      }

      var report = App.Scoring.evaluate({
        ts: Date.now(),
        topic: topic,
        duration: duration,
        targetMin: App.settings.data.durationMin || 10,
        mode: S.lessonMode || 'micro',
        audio: pack.audio || {},
        transcript: pack.transcript,
        asrAvailable: pack.asrOK,
        posture: pack.posture,
        board: bd.url ? { dataUrl: bd.url } : null,
        boardAuto: boardAuto,
        visual: vision,
        audioOnly: audioOnly,
        speech: speechMetrics,
        hasVideo: !audioOnly && !!(pack.result && pack.result.blob && pack.result.blob.size)
      });

      report.board = bd.url
        ? {
          dataUrl: bd.url, auto: bd.from === 'frames', at: bd.at,
          readability: bd.readability || null,
          overlay: (vision && vision.board && vision.board.overlay) || null,
          confidence: (vision && vision.board && vision.board.confidence) || null,
          quality: (vision && vision.board && vision.board.quality) || [],
          reason: (vision && vision.board && vision.board.reason) || ''
        }
        : null;
      report.visual = vision || null;
      report.shots = shots || [];

      /* 板书内容核对：只看「要点里的字在不在 OCR 认出来的板书文字里」 */
      try {
        if (App.BoardCheck && !audioOnly) {
          var ocrText = (vision && vision.board && vision.board.crop && vision.board.crop.ocr && vision.board.crop.ocr.text) || '';
          var items = String(App.settings.data.boardPoints || '').split(/[,，;；\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
          report.boardCheck = App.BoardCheck.check({ items: items, text: ocrText });
        }
      } catch (e2) { console.warn('[app] 板书内容核对失败', e2); }
      report.transcript = (pack.transcript || []).map(function (t) { return t.text; }).join('');

      /* 逐字稿分段：报告里要能逐段看原始转写、点时间码跳回录像 */
      report.segments = (pack.transcript || []).map(function (s) {
        return { t: s.t, text: s.text, raw: s.raw != null ? s.raw : s.text };
      });
      report.asr = {
        available: !!pack.asrOK,
        imported: false,
        source: pack.asrOK ? 'live' : 'none',
        segments: report.segments.length,
        corrected: (pack.asr && pack.asr.corrected) || 0
      };

      S.report = report;
      S.videoBlob = pack.result ? pack.result.blob : null;
      report.audioOnly = audioOnly;
      report.hasVideo = !audioOnly && !!(pack.result && pack.result.blob && pack.result.blob.size);

      /* 语言与节奏：语速分母是「有效语音时长」而不是总时长，另给 30 秒一条的曲线与突变帧。
         停顿分三级（300/500/1000ms），句内停顿与句间停顿分开算。 */
      if (speechMetrics) report.speech = speechMetrics;
      if (App.Theory && report.segments) report.theory = App.Theory.check({ segments: report.segments, duration: duration });

      /* 仪态八项：抽帧时已用完整关键点算好（frames.js 里就地瘦身），这里只搬过来 */
      if (vision && vision.posture) report.posture = vision.posture;
      report.sampling = (vision && vision.sampling) || null;
      if (vision && vision.face) report.face = vision.face;

      /* 评分细则 v2：A 语音 40 / B 仪态 30 / C 板书 30 − D 红线，按阈值表查分 */
      if (App.Rubric2 && speechMetrics) {
        speechMetrics.text = (report.segments || []).map(function (s) { return s.text || s.raw || ''; }).join('');
        report.rubric2 = App.Rubric2.compute({
          speech: speechMetrics,
          posture: report.posture,
          face: report.face,
          board: (report.visual && report.visual.board && report.visual.board.crop && report.visual.board.crop.metrics) || null,
          theory: report.theory,
          boardCheck: report.boardCheck || null,
          audio: pack.audio || {},
          duration: duration
        });
      }

      persist(report, pack).then(function () {
        teardown();
        ui.go('report');
        renderReport(report, S.videoBlob);
        if (bd.from === 'frames') {
          ui.toast('板书没单独拍，从录像 ' + util.fmtAt(bd.at || 0) + ' 那一帧找到了。', 'ok', 5000);
        }
      }).catch(function (e) {
        console.warn('[app] persist failed', e);
        teardown();
        ui.go('report');
        renderReport(report, S.videoBlob);
        ui.toast('报告已生成，但写入本地存储失败：' + (e.message || e), 'err', 5000);
      });
    }
  }

  /* 从录像里抓一帧当缩略图。失败就算了，历史卡片退回纯文字版。 */
  function makePoster(blob) {
    return new Promise(function (resolve) {
      if (!blob || !blob.size) { resolve(''); return; }
      var url = URL.createObjectURL(blob);
      var v = document.createElement('video');
      var done = false;

      function finish(out) {
        if (done) return;
        done = true;
        try { v.removeAttribute('src'); v.load(); } catch (e) {}
        URL.revokeObjectURL(url);
        resolve(out || '');
      }

      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.addEventListener('loadeddata', function () {
        try { v.currentTime = Math.min(1, (v.duration || 2) / 3); } catch (e) { finish(''); }
      });
      v.addEventListener('seeked', function () {
        try {
          var w = 480;
          var h = Math.round(w * (v.videoHeight / v.videoWidth) || 270);
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(v, 0, 0, w, h);
          finish(c.toDataURL('image/jpeg', 0.62));
        } catch (e) { finish(''); }
      });
      v.addEventListener('error', function () { finish(''); });
      setTimeout(function () { finish(''); }, 6000);
      v.src = url;
    });
  }

  function persist(report, pack) {
    var id = S.sessionId;
    var blob = pack.result ? pack.result.blob : null;
    var mime = pack.result ? pack.result.mime : '';

    var light = JSON.parse(JSON.stringify(report));
    var rawText = light.transcript || '';
    delete light.board;
    delete light.transcript;

    return makePoster(report.audioOnly ? null : blob).then(function (poster) {
      /* 新版按细则计分：分数在 rubric2.total 里，而且证据不够时是「不出分」，
         历史卡片不能拿老的 report.total（那时恒为 0）当分数显示 */
      var rbT = (report.rubric2 && report.rubric2.total) || null;
      var histTotal = rbT ? (rbT.graded && rbT.pct != null ? Math.round(rbT.pct * 10) / 10 : null) : report.total;
      var histGrade = rbT ? (rbT.graded ? { key: rbT.grade, label: '' } : null) : report.grade;
      var session = {
        id: id,
        createdAt: report.ts,
        ts: report.ts,
        topic: report.topic,
        duration: report.duration,
        total: histTotal,
        grade: histGrade,
        dims: report.dims.map(function (d) { return { key: d.key, name: d.name, score: d.score, weight: d.weight }; }),
        stats: report.stats,
        hasVideo: !!(blob && blob.size),
        hasReport: true,
        mime: mime,
        size: blob ? blob.size : 0,
        board: report.board ? report.board.dataUrl : '',
        poster: poster,
        snippet: rawText.replace(/\s+/g, ' ').slice(0, 120),
        chars: rawText.length,
        report: light
      };

      var tasks = [];
      if (blob && blob.size) tasks.push(App.db.putVideo(id, blob, mime));
      tasks.push(App.db.putSession(session));
      tasks.push(App.db.putText(id, {
        transcript: pack.transcript || [],
        raw: rawText
      }));
      tasks.push(App.db.clearChunks(id).catch(function () {}));
      if (report.shots && report.shots.length) {
        tasks.push(App.db.putShots(id, report.shots).catch(function () {}));
      }

      return Promise.all(tasks);
    }).then(function () {
      App.draft.clear();
    });
  }

  function teardown() {
    clearInterval(S.timerId);
    clearInterval(S.draftId);
    clearInterval(S.asrWatch);
    S.timerId = 0; S.draftId = 0; S.asrWatch = 0;
    S.recording = false;
    S.stopping = false;
    S.recorder = null;
    S.audio = null;
    S.asr = null;
    S.posture = null;
    if (S.wake) { try { S.wake.release(); } catch (e) {} S.wake = null; }
    if (S.videoUrl) { URL.revokeObjectURL(S.videoUrl); S.videoUrl = ''; }

    /* 摄像头 / 屏幕共享必须真的关掉，否则指示灯一直亮着 */
    stopPrepMeter();
    App.Media.stopStream(S.stream);
    App.Media.stopStream(S.screenStream);
    S.stream = null;
    S.screenStream = null;
    S.screenOn = false;

    var recMain = document.querySelector('.rec-main');
    if (recMain) recMain.classList.remove('audio-mode');
    if ($('recAudio')) $('recAudio').hidden = true;
  }

  /* ======================================================================
     三·五、上传已录好的视频
     ----------------------------------------------------------------------
     浏览器没法对一个文件跑实时语音识别（Web Speech 只认麦克风），所以这条路
     只解析音轨：停顿、语速、音量稳定性都能量出来，内容与语气词两项留空。
     ====================================================================== */
  /* 上传不设大小/时长上限：文件多大、录多久都交给浏览器本机解码。
     真正的边界只剩浏览器自身的内存与存储配额。 */

  function pickUpload() {
    var input = $('uploadFile');
    if (!input) return;
    /* 趁用户还在挑文件，先把姿态/表情模型下载并编译好；
       选完文件就能直接分析，不用再等 15MB 模型。 */
    try { if (App.Pose && App.Pose.load) App.Pose.load(); } catch (e) { /* noop */ }
    try { if (App.Face && App.Face.load) App.Face.load(); } catch (e2) { /* noop */ }
    input.value = '';
    input.click();
  }

  function uploadMask(on, title, sub) {
    var mask = $('uploadMask');
    if (!mask) return;
    if (title) { var t = $('uploadTitle'); if (t) t.textContent = title; }
    if (sub != null) { var s = $('uploadSub'); if (s) s.textContent = sub; }
    mask.hidden = !on;
  }

  function onUploadPicked(file) {
    if (!file) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(file.name || '')) {
      ui.toast('这不是视频文件。', 'err', 4000);
      return;
    }

    uploadMask(true, '正在读这段录像…',
      util.bytes(file.size) + ' · 音轨和画面都只在本机读，不上传');

    /* 画面分析（姿态逐帧 + 板书区域）跟音轨解析并行；画面那个要下载 15MB 模型，
       所以进度条显示的是真实字节数，不是编的百分比。 */
    var visionTask = (App.Frames && App.Frames.analyze)
      ? App.Frames.analyze(file, {
          shotEvery: 30,
          fine: S.frameMode === 'fine',
          onProgress: function (p) {
            var s = $('uploadSub');
            if (!s || !p) return;
            s.textContent = (p.text || '正在看画面…') + ' · 不会上传任何内容';
          }
        }).catch(function (e) {
          console.warn('[app] vision failed', e);
          return null;
        })
      : Promise.resolve(null);

    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      uploadMask(false);
      ui.toast('这个浏览器不支持解析音频，换 Edge 或 Chrome。', 'err', 5000);
      return;
    }
    /* 只做停顿/语速/音量分析，16k 单声道足够；比默认 48k 少解码 2/3 的数据，
       大文件的内存峰值也低得多。浏览器不支持指定采样率时退回默认。 */
    var ctx;
    try { ctx = new Ctx({ sampleRate: 16000 }); } catch (e) { ctx = new Ctx(); }

    var audioTask = file.arrayBuffer().then(function (buf) {
      return new Promise(function (resolve, reject) {
        /* 老 Safari 只有回调式 decodeAudioData，返回值不是 Promise */
        var ret = ctx.decodeAudioData(buf, resolve, reject);
        if (ret && ret.then) ret.then(resolve, reject);
      });
    }).then(function (audioBuf) {
      var audio = analyzeAudioBuffer(audioBuf);
      /* 顺手把音轨抽成 16k 单声道 WAV：确认弹窗里如果没附字幕，
         就用它去走语音识别，生成真正的逐字稿。 */
      try {
        S.uploadWav = (App.AsrFile && App.AsrFile.toWav) ? App.AsrFile.toWav(audioBuf, 16000) : null;
      } catch (e) {
        console.warn('[app] wav encode failed', e);
        S.uploadWav = null;
      }
      try { ctx.close(); } catch (e) {}
      return { audio: audio };
    }).catch(function (e) {
      try { ctx.close(); } catch (err) {}
      return { audio: null, error: e };
    });

    Promise.all([audioTask, visionTask]).then(function (both) {
      var got = both[0], frames = both[1];
      uploadMask(false);

      /* 先验长度：有限正数、且够长。无声分支也要过这一关，不能绕过去。 */
      var dur = (got.audio && got.audio.duration) || (frames && frames.duration) || 0;
      if (!isFinite(dur) || dur <= 0) {
        ui.toast('读不出这段录像的长度（文件可能损坏），换一个再试。', 'err', 6000);
        return;
      }

      /* 没有音轨（或解不开）时，只要画面读到了，就按「只看画面」评一次 */
      if (!got.audio) {
        if (!frames || !frames.frames || !frames.frames.length) {
          ui.toast('这个文件既没有声音、也读不出画面，换一个再试。', 'err', 6000);
          return;
        }
        var silent = {
          duration: dur, speechSeconds: 0, pauses: [], microPauses: [],
          peaks: 0, estimatedChars: 0, wave: [], volumeCV: 0, rmsMean: 0, rmsStd: 0, noAudio: true
        };
        ui.toast('这段录像没有音轨（或解不开），下面只按画面分析评教态与板书。', 'warn', 6000);
        confirmUpload(file, silent, frames, true);
        return;
      }

      var audio = got.audio;
      audio.duration = dur;
      confirmUpload(file, audio, frames, false);
    }).catch(function (e) {
      try { ctx.close(); } catch (err) {}
      uploadMask(false);
      console.warn('[app] upload failed', e);
      ui.toast('这个视频解不开（' + ((e && e.message) || e) +
        '）。换成 mp4 或 webm 再试。', 'err', 7000);
    });
  }

  /* 把 40 分钟的音频拆成 50ms 一帧，算 RMS，再按阈值判「在说」还是「停着」 */
  function analyzeAudioBuffer(buf) {
    var sr = buf.sampleRate;
    var ch0 = buf.getChannelData(0);
    var ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    var win = Math.max(256, Math.round(sr * 0.05));
    var frames = Math.floor(buf.length / win);

    var rmsArr = new Float32Array(frames);
    for (var f = 0; f < frames; f++) {
      var base = f * win, sum = 0;
      for (var i = 0; i < win; i++) {
        var v = ch0[base + i];
        if (ch1) v = (v + ch1[base + i]) / 2;
        sum += v * v;
      }
      rmsArr[f] = Math.sqrt(sum / win);
    }

    /* 噪声底取最低 30% 分位：安静段的平均电平 */
    var sorted = Array.prototype.slice.call(rmsArr).sort(function (a, b) { return a - b; });
    var cut = Math.max(1, Math.floor(sorted.length * 0.3));
    var floorSum = 0;
    for (var k = 0; k < cut; k++) floorSum += sorted[k];
    var floor = floorSum / cut;
    var thr = util.clamp(floor * 1.6, 0.008, 0.06);

    var peaks = 0, speechFrames = 0, lastAbove = false, start = -1;
    var pauses = [], micro = [], loud = [];

    function closeGap(endFrame) {
      if (start < 0) return;
      var d = (endFrame - start) * 0.05;
      var rec = { start: util.round1(start * 0.05), end: util.round1(endFrame * 0.05), duration: util.round1(d) };
      /* 只有 ≥2 秒的静默才算「停顿」（讲课中的卡壳、翻页、写板书）。
         0.8–2 秒是人说话的正常换气与断句，真实课堂里一分钟就有好几次，
         把它算成停顿会让每一段正常讲课都被判「停顿过多」。 */
      if (d >= 5) { rec.long = true; pauses.push(rec); }
      else if (d >= 2) { rec.long = false; pauses.push(rec); }
      else if (d >= 0.8) micro.push(rec);
      start = -1;
    }

    for (var j = 0; j < frames; j++) {
      var above = rmsArr[j] > thr;
      if (above) {
        speechFrames++;
        loud.push(rmsArr[j]);
        if (!lastAbove) { peaks++; closeGap(j); }
      } else if (lastAbove) {
        start = j;
      }
      lastAbove = above;
    }
    closeGap(frames);

    /* 音量波动系数：说话段 RMS 的标准差 / 均值 */
    var mean = 0, n = loud.length;
    for (var m = 0; m < n; m++) mean += loud[m];
    mean = n ? mean / n : 0;
    var varSum = 0;
    for (var q = 0; q < n; q++) varSum += (loud[q] - mean) * (loud[q] - mean);
    var sd = n ? Math.sqrt(varSum / n) : 0;
    var cv = mean > 0 ? sd / mean : 0;

    /* 波形图取 120 个点，按最大帧归一化 */
    var wave = [], step = Math.max(1, Math.floor(frames / 120)), maxRms = 0;
    for (var w = 0; w < frames; w += step) if (rmsArr[w] > maxRms) maxRms = rmsArr[w];
    for (var z = 0; z < frames; z += step) wave.push(maxRms ? Math.min(1, rmsArr[z] / maxRms) : 0);

    /* 音节数：包络的局部峰。中文一个音节基本就是一个字，比「开口次数」
       （peaks）靠谱得多 —— 一口气说十个字只算一次开口。 */
    var env = new Float32Array(frames);
    for (var e = 0; e < frames; e++) {
      var acc = 0, cnt = 0;
      for (var d2 = -2; d2 <= 2; d2++) {
        var ix = e + d2;
        if (ix >= 0 && ix < frames) { acc += rmsArr[ix]; cnt++; }
      }
      env[e] = acc / cnt;
    }
    var onsets = 0, lastOnset = -99;
    for (var o = 1; o < frames - 1; o++) {
      if (env[o] > thr && env[o] >= env[o - 1] && env[o] > env[o + 1] && (o - lastOnset) >= 2) {
        onsets++;
        lastOnset = o;
      }
    }

    var speechSeconds = util.round1(speechFrames * 0.05);
    var minutes = Math.max(0.3, speechSeconds / 60);
    var rate = onsets / minutes;

    /* 换算出来离谱（<100 或 >420）就宁可不给：语速项会按「未测到」走缺省分 */
    var reliable = rate >= 100 && rate <= 420;
    var chars = reliable ? onsets : 0;

    return {
      duration: util.round1(buf.duration),
      speechSeconds: speechSeconds,
      pauses: pauses,
      microPauses: micro,
      /* 统一口径的静默段：metrics-speech 用这个算句内停顿与语速曲线 */
      gaps: pauses.concat(micro).map(function (g) {
        return { start: g.start, end: g.end, dur: g.duration };
      }),
      volumeCV: cv,
      peaks: peaks,
      syllables: onsets,
      estimatedChars: chars,
      rateReliable: reliable,
      wave: wave
    };
  }

  function confirmUpload(file, audio, frames, noAudio) {
    var guess = (file.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').trim().slice(0, 32);
    var longCount = audio.pauses.filter(function (p) { return p.long; }).length;

    var lines = [];
    if (noAudio) {
      lines.push('这段录像没有音轨（时长 ' + util.fmtTime(Math.round(audio.duration)) +
        '），所以停顿、语速、语气词都测不到，只有画面能被评。');
    } else {
      lines.push('时长 ' + util.fmtTime(Math.round(audio.duration)) + '，测到 ' + audio.pauses.length +
        ' 次停顿（其中 ' + longCount + ' 次超过 5 秒）。');
    }

    var hasFrames = !!(frames && frames.frames && frames.frames.length);
    if (hasFrames) {
      var cov = frames.coverage || {};
      var poseRate = cov.poseRate != null ? Math.round(cov.poseRate * 100) : null;
      lines.push('画面抽了 ' + frames.frames.length + ' 帧（约每 ' + (cov.step || '?') +
        ' 秒一帧，覆盖 ' + Math.round((cov.sampleCoverage || 0) * 100) + '% 的时长）' +
        (poseRate != null ? '，其中 ' + poseRate + '% 的帧识别出了人体姿态' : '') + '。');
      var issues = (frames.behaviors || []).filter(function (b) { return b.kind === 'issue'; });
      if (issues.length) {
        lines.push('看到 ' + issues.length + ' 段可定位到时间的仪态问题：' +
          issues.map(function (b) { return b.title; }).join('；') + '。');
      } else if (poseRate && poseRate > 0) {
        lines.push('没有发现「持续背向」「讲解时挡住板书」这类有连续证据的问题。');
      } else {
        lines.push('人体姿态没识别出来，仪态这一项这次不算分（不会因为「没居中」扣分）。');
      }
      lines.push(frames.board && frames.board.found
        ? '板书区域在 ' + util.fmtTime(Math.round((frames.board.crop && frames.board.crop.t) || 0)) +
          ' 那一帧定位到了，' + (frames.board.readability && frames.board.readability.ok
            ? '拍得清楚，按可测量项评。' : '但拍得不够清楚，会先说清是拍摄问题。')
        : '没有找到像板书的区域，板书这一项这次不算分。');
    } else {
      lines.push('这段没有画面（或浏览器解不开），仪态与板书这两项这次不算分。');
    }
    lines.push('评分要逐字稿才能对到具体原话，所以这次必须附一份字幕文件——没有它就不出评分。');
    lines.push('不算分的项不参与总分：总分只按测到的那几项折算，报告顶部会标「部分评估」。');

    ui.modal({
      title: '这段录像可以评',
      text: lines.join('\n'),
      bodyHTML:
        '<label class="field"><span class="field-label">字幕文件（必填）</span>' +
        '<input class="input" id="uploadSubs" type="file" accept=".srt,.vtt,.txt,text/plain" />' +
        '<span class="field-hint">' +
          '<b>没有字幕文件就无法评分。</b>评分要逐条对到你说的话：教学内容、语气词、问题清单里的原话，' +
          '都来自逐字稿；没有它这几项没法评，整体也只剩半张表。' +
          '<br>字幕怎么来：剪映「识别字幕→导出 SRT」、录课平台下载字幕、或语音转文字工具导出 .txt 都行。' +
        '</span></label>' +
        '<label class="field"><span class="field-label">课题</span>' +
        '<input class="input" id="uploadTopic" type="text" maxlength="40" value="' + util.escape(guess) +
        '" placeholder="例如：函数的单调性"></label>' +
        '<label class="field"><span class="field-label">这是什么</span>' +
        '<select class="input" id="uploadMode">' +
          '<option value="micro">模拟试讲（10 分钟上下，按五个环节评）</option>' +
          '<option value="full">完整课堂（一节 40 分钟左右的课）</option>' +
          '<option value="clip">教学片段（只评这一段，不要求导入小结）</option>' +
        '</select></label>',
      okText: '出评分',
      cancelText: '不评了',
      onMount: function (el) {
        var sel = el.querySelector('#uploadMode');
        if (sel) {
          var d = audio && audio.duration ? audio.duration : (frames && frames.duration) || 0;
          sel.value = d > 0 && d < 180 ? 'clip' : d >= 1500 ? 'full' : 'micro';
        }

        /* 字幕是必填：没选文件之前，出评分按钮是灰的，点了也过不去 */
        var inp = el.querySelector('#uploadSubs');
        var okBtn = el.querySelector('[data-m="ok"]');
        function sync() {
          var has = !!(inp && inp.files && inp.files.length);
          if (okBtn) {
            okBtn.disabled = !has;
            okBtn.textContent = has ? '出评分' : '请先选字幕文件';
            okBtn.title = has ? '' : '没有字幕文件无法评分';
          }
        }
        if (inp) inp.addEventListener('change', sync);
        sync();
      },
      collect: function (el) {
        var v = el.querySelector('#uploadTopic');
        var m = el.querySelector('#uploadMode');
        var f = el.querySelector('#uploadSubs');
        return {
          topic: (v && v.value.trim()) || guess || '未填写课题',
          mode: (m && m.value) || 'micro',
          subsFile: (f && f.files && f.files[0]) || null
        };
      }
    }).then(function (r) {
      if (!r) return;
      var topic = (r && r.topic) || guess || '未填写课题';
      var mode2 = (r && r.mode) || 'micro';
      var sf = r && r.subsFile;
      if (!sf) {
        /* 字幕是硬门槛：没有逐字稿，评出来的只有半张表，不如不给分 */
        ui.toast('必须选择字幕文件才能评分', 'err', 4200);
        return;
      }
      uploadMask(true, '正在读字幕', sf.name || '');
      var reader = new FileReader();
      reader.onload = function () {
        uploadMask(false);
        var parsed = { segments: [], timed: false };
        try {
          parsed = App.text.parseSubtitles(String(reader.result || ''));
        } catch (e) {
          console.warn('[subs] parse failed', e);
        }
        if (!parsed.segments.length) {
          ui.toast('这份字幕读不出内容，换一份 .srt / .vtt / .txt 再来。', 'err', 4800);
          return;
        }
        ui.toast('读到 ' + parsed.segments.length + ' 段字幕，内容与语气词这次按真实原话评。', 'ok', 4200);
        buildUploadReport(file, audio, topic, frames, mode2, parsed);
      };
      reader.onerror = function () {
        uploadMask(false);
        ui.toast('字幕文件读取失败，换一份再来。', 'err', 4200);
      };
      reader.readAsText(sf, 'utf-8');
    });
  }

  function buildUploadReport(file, audio, topic, frames, mode, subs) {
    var keep = true;   /* 不按大小丢录像：上传多大都保留回放 */
    S.sessionId = 'up' + Date.now().toString(36);
    S.videoBlob = keep ? file : null;

    var board = null;
    if (frames && frames.board && frames.board.dataUrl) board = { dataUrl: frames.board.dataUrl };
    var lesson = mode === 'full' || mode === 'clip' ? mode : 'micro';

    /* 逐字稿的三个来源，按优先级：
       ① 用户在确认弹窗里附的字幕  ② 上传录像的语音自动转写  ③ 都没有 → 明确写没有逐字稿 */
    var subsSegs = (subs && subs.segments && subs.segments.length) ? subs.segments : null;
    var segSource = subsSegs ? 'subtitle' : 'none';
    var segPromise;

    if (subsSegs) {
      segPromise = Promise.resolve(subsSegs);
    } else if (S.uploadWav && App.AsrFile && App.AsrFile.enabled()) {
      uploadMask(true, '正在转写语音…', '只把这段音轨发到你配置的识别接口');
      segPromise = App.AsrFile.transcribe(S.uploadWav, function (done, total) {
        var sub = $('uploadSub');
        if (sub && total > 1) sub.textContent = '正在转写语音 ' + done + '/' + total + ' 段 · 只发音频，不发视频';
      }).then(function (list) {
        uploadMask(false);
        segSource = 'asr';
        ui.toast('转写出 ' + list.length + ' 段逐字稿。', 'ok', 4200);
        return list;
      }).catch(function (e) {
        uploadMask(false);
        console.warn('[asr] failed', e);
        ui.toast('语音转写没成功：' + (e.message || e) + '。这次不生成逐字稿。', 'warn', 6500);
        segSource = 'failed';
        return null;
      });
    } else {
      segPromise = Promise.resolve(null);
    }

    segPromise.then(function (segs) {
      /* 板书还要跑一遍像素分析（可测量项），异步，等它回来再评分 */
      (board ? App.Scoring.analyzeBoard(board.dataUrl).catch(function () { return null; })
        : Promise.resolve(null)).then(function (boardAuto) {
        if (boardAuto && frames && frames.board) {
          if (frames.board.readability) boardAuto.readability = frames.board.readability;
          if (frames.board.polarity) boardAuto.polarity = frames.board.polarity;
        }
        build(boardAuto, segs);
      });
    });

    function build(boardAuto, segs) {

    var transcript = segs ? segs.map(function (s) {
      return { t: s.start, text: s.correctedText || s.text, isFinal: true, id: s.id };
    }) : [];

    /* 语言指标先算：评分里的「语速」要与报告「语言与节奏」同一口径 */
    var speechMetrics = null;
    if (App.MetricsSpeech && App.MetricsSpeech.analyze) {
      try {
        speechMetrics = App.MetricsSpeech.analyze({
          segments: segs ? segs.map(function (s) {
            return { t: s.start, text: s.correctedText || s.text, raw: s.text };
          }) : [],
          audio: audio,
          duration: audio.duration
        });
      } catch (e) {
        console.warn('[app] 上传：语言指标计算失败', e);
      }
    }

    var report = App.Scoring.evaluate({
      ts: Date.now(),
      topic: topic,
      duration: audio.duration,
      targetMin: lesson === 'full' ? 40 : 10,   /* 完整课堂按 40 分钟，片段的时长不参与折算 */
      mode: lesson,
      audio: audio,
      transcript: transcript,
      asrAvailable: !!segs,
      segments: segs,
      speech: speechMetrics,
      posture: null,
      board: board,
      boardAuto: boardAuto,
      visual: frames || null,
      shots: (frames && frames.shots) || [],
      hasVideo: keep
    });
    report.transcript = segs ? segs.map(function (s) { return s.correctedText || s.text; }).join('') : '';
    report.visual = frames || null;
    report.shots = (frames && frames.shots) || [];

    /* 字幕导入路径：text 是修正版，raw 保留字幕原文 */
    report.segments = segs ? segs.map(function (s) {
      return { t: s.start, text: s.correctedText || s.text, raw: s.text };
    }) : [];
    report.asr = {
      available: !!segs,
      source: segSource,                 /* subtitle | asr | failed | none */
      imported: segSource === 'subtitle',
      segments: report.segments.length
    };
    if (report.board && frames && frames.board) {
      report.board.overlay = frames.board.overlay || null;
      report.board.confidence = frames.board.confidence || null;
      report.board.quality = frames.board.quality || [];
      report.board.reason = frames.board.reason || '';
    }
    report.subtitle = subs ? (subs.timed ? 'timed' : 'plain') : (segs ? 'asr' : null);

    /* 语言与节奏 + 仪态八项：上传路径也要有，口径与录制路径一致 */
    report.speech = speechMetrics;
    if (App.Theory && report.segments) report.theory = App.Theory.check({ segments: report.segments, duration: audio.duration || duration });
    if (frames && frames.posture) report.posture = frames.posture;
    report.sampling = (frames && frames.sampling) || null;
    if (frames && frames.face) report.face = frames.face;

    /* 板书内容核对（上传路径）：同上，只做字面比对 */
    try {
      if (App.BoardCheck) {
        var ocrText2 = (frames && frames.board && frames.board.crop && frames.board.crop.ocr && frames.board.crop.ocr.text) || '';
        var items2 = String(App.settings.data.boardPoints || '').split(/[,，;；\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        report.boardCheck = App.BoardCheck.check({ items: items2, text: ocrText2 });
      }
    } catch (e2) { console.warn('[app] 板书内容核对失败', e2); }

    /* 评分细则 v2（上传路径与录制路径同一套口径） */
    if (App.Rubric2 && speechMetrics) {
      speechMetrics.text = (report.segments || []).map(function (s) { return s.text || s.raw || ''; }).join('');
      report.rubric2 = App.Rubric2.compute({
        speech: speechMetrics,
        posture: report.posture,
        face: report.face,
        board: (report.visual && report.visual.board && report.visual.board.crop && report.visual.board.crop.metrics) || null,
        theory: report.theory,
        boardCheck: report.boardCheck || null,
        audio: audio || {},
        duration: audio.duration || duration
      });
    }

    S.report = report;
    App.settings.save({ topic: topic });

    var pack = {
      result: keep ? { blob: file, mime: file.type || 'video/mp4', duration: audio.duration } : null,
      transcript: transcript,
      asrOK: !!segs
    };

    function show() {
      ui.go('report');
      renderReport(report, S.videoBlob);
      if (subs && segs && subs.timed === false) {
        ui.toast('这份字幕没有时间码，只能按整体分析，问题清单里不会带时间点。', 'warn', 5200);
      }
      if (!segs && segSource === 'none' && !(subs && subs.segments && subs.segments.length)) {
        // 既没字幕、也没配语音识别时要说清楚，不能让人以为「转写坏了」
        if (!(App.AsrFile && App.AsrFile.enabled())) {
          ui.toast('这次没有逐字稿：没附字幕，也没配置语音识别接口。到准备页「AI 点评与语音识别」里填一个就能自动转写。', 'warn', 8000);
        }
      }
      /* AI 点评不再自动触发：要发逐字稿出去，必须用户自己点 */
    }

    persist(report, pack).then(show, function (e) {
      console.warn('[app] upload persist failed', e);
      ui.toast('报告生成了，但存到本地失败：' + (e.message || e), 'warn', 6000);
      show();
    });
    }
  }

  /* ======================================================================
     四、报告页
     ====================================================================== */
  function renderReport(report, blob) {
    hideAnalyzing();
    var sub = $('reportBody');
    if (!sub) return;
    window.scrollTo(0, 0);

    App.report.render(report, {
      noVideo: !blob,
      onSeek: function (t) { openPlayer(blob, t); },
      onPlay: function () { openPlayer(blob, 0); },
      onDownload: function () { downloadVideo(blob, report); },
      onExport: function () { exportJSON(report); },
      onAgain: function () {
        App.report.destroy();
        ui.go('prepare');
      }
    });
  }

  function downloadVideo(blob, report) {
    if (!blob) { ui.toast('这次没有录像文件', 'warn'); return; }
    var ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
    var name = '试讲-' + (report.topic || '未命名').replace(/[\\/:*?"<>|]/g, '_') + '-' + util.fmtDate(report.ts).replace(/[: ]/g, '-') + '.' + ext;
    util.download(blob, name);
    ui.toast('已保存到下载目录', 'ok');
  }

  function exportJSON(report) {
    var data = JSON.parse(JSON.stringify(report));
    delete data.board;
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    util.download(blob, '试讲评分-' + util.fmtDate(report.ts).replace(/[: ]/g, '-') + '.json');
    ui.toast('报告已导出', 'ok');
  }

  function openPlayer(blob, at) {
    var audioOnly = !!(S.report && S.report.audioOnly) || /^audio\//.test((blob && blob.type) || '');
    if (!blob) { ui.toast(audioOnly ? '这次没有录音可回放' : '这次没有录像可回放', 'warn'); return; }
    var url = util.blobUrl(blob);
    S.playerUrl = url;

    ui.modal({
      title: audioOnly ? '录音回放' : '录像回放',
      bodyHTML: (audioOnly
        ? '<div class="audio-player"><p class="audio-player-tip">这一遍只录了音频。</p>' +
          '<audio id="playerVid" controls style="width:100%;display:block"></audio></div>'
        : '<video id="playerVid" playsinline controls style="width:100%;max-height:56vh;border-radius:12px;background:#000;display:block"></video>') +
        '<p class="fine" id="playerHint" style="margin-top:10px">' +
        (at ? '已跳到第 ' + util.fmtAt(at) : '从头播放') + '</p>',
      okText: '关闭',
      cancelText: null,
      onMount: function (el) {
        var v = el.querySelector('#playerVid');
        S.playerVideo = v;
        v.src = url;
        v.addEventListener('loadedmetadata', function () {
          if (at) { try { v.currentTime = Math.max(0, at - 0.5); } catch (e) {} }
          v.play().catch(function () {});
        });
      }
    }).then(function () {
      S.playerVideo = null;
      setTimeout(function () {
        if (S.playerUrl) { URL.revokeObjectURL(S.playerUrl); S.playerUrl = ''; }
      }, 400);
    });
  }

  function seekPlayer(t) {
    if (S.playerVideo) {
      try { S.playerVideo.currentTime = Math.max(0, t - 0.5); S.playerVideo.play(); } catch (e) {}
    } else {
      openPlayer(S.videoBlob, t);
    }
  }

  /* ======================================================================
     五、历史
     ====================================================================== */
  function openSession(id) {
    App.db.getSession(id).then(function (session) {
      if (!session) { ui.toast('找不到这条记录', 'warn'); return; }
      if (!session.report) { ui.toast('这条记录只有录像，没有评分数据', 'warn'); return; }

      var report = session.report;
      report.board = session.board ? { dataUrl: session.board } : null;
      report.advice = report.advice || { must: [], should: [], bonus: [] };

      /* 截图、录像、逐字稿都要拿到再渲染，否则画面时间线和逐字稿会缺一段 */
      Promise.all([
        App.db.getShots(id).catch(function () { return null; }),
        App.db.getVideo(id).catch(function () { return null; }),
        App.db.getText(id).catch(function () { return null; })
      ]).then(function (both) {
        report.shots = both[0] || report.shots || [];
        var blob = both[1] && both[1].blob ? both[1].blob : null;
        var txt = both[2];
        if ((!report.segments || !report.segments.length) && txt && txt.transcript && txt.transcript.length) {
          report.segments = txt.transcript.map(function (s) {
            return {
              t: s.t != null ? s.t : s.start,
              text: s.text || s.correctedText || '',
              raw: s.raw != null ? s.raw : (s.text || '')
            };
          });
        }
        S.report = report;
        S.videoBlob = blob;
        ui.go('report');
        renderReport(report, blob);
      });
    }).catch(function (e) {
      ui.toast('读取失败：' + (e.message || e), 'err');
    });
  }

  function playSession(id) {
    App.db.getVideo(id).then(function (v) {
      if (!v || !v.blob) { ui.toast('这条记录没有录像', 'warn'); return; }
      openPlayer(v.blob, 0);
    });
  }

  /* ======================================================================
     六、崩溃恢复
     ====================================================================== */
  function checkRecovery() {
    var draft = App.draft.read();
    if (!draft || !draft.id) return;
    if (Date.now() - (draft.startedAt || 0) < 20000) return;   // 刚开的草稿不打扰

    App.db.listChunks(draft.id).then(function (chunks) {
      if (!chunks || !chunks.length) { App.draft.clear(); return; }
      var banner = $('recoveryBanner');
      var meta = $('recoveryMeta');
      if (meta) {
        meta.textContent = '共 ' + chunks.length + ' 个分段 · 已录约 ' + util.fmtTime(draft.duration || draft.elapsed || 0) +
          (draft.topic ? ' · ' + draft.topic : '');
      }
      if (banner) banner.hidden = false;

      var btn = $('btnRecover');
      var discard = $('btnDiscardRecovery');

      if (btn) btn.onclick = function () {
        btn.disabled = true;
        btn.textContent = '恢复中…';
        var parts = chunks.map(function (c) { return c.blob; });
        var blob = new Blob(parts, { type: 'video/webm' });
        var session = {
          id: draft.id,
          createdAt: Date.now(),
          ts: Date.now(),
          topic: draft.topic || '未完成的试讲',
          duration: draft.duration || draft.elapsed || 0,
          total: null,
          grade: { key: '—', label: '仅录像' },
          dims: [],
          stats: {},
          hasVideo: true,
          hasReport: false,
          mime: blob.type,
          size: blob.size,
          report: null
        };
        App.db.putVideo(draft.id, blob, blob.type).then(function () {
          return App.db.putSession(session);
        }).then(function () {
          return App.db.clearChunks(draft.id);
        }).then(function () {
          App.draft.clear();
          if (banner) banner.hidden = true;
          ui.toast('录像已恢复到历史记录', 'ok');
          App.history.load().then(function () { ui.go('history'); });
        }).catch(function (e) {
          btn.disabled = false;
          btn.textContent = '恢复';
          ui.toast('恢复失败：' + (e.message || e), 'err');
        });
      };

      if (discard) discard.onclick = function () {
        App.db.clearChunks(draft.id).catch(function () {});
        App.draft.clear();
        if (banner) banner.hidden = true;
      };
    }).catch(function () {});
  }

  /* ======================================================================
     七、AI 设置（注入到准备页底部）
     ====================================================================== */
  function injectAiSettings() {
    var form = document.querySelector('.prep-form');
    if (!form || document.getElementById('aiSettings')) return;

    var d = App.settings.data;
    var box = document.createElement('details');
    box.className = 'ai-settings';
    box.id = 'aiSettings';
    box.innerHTML =
      '<summary>AI 深度点评（填一次 Key）</summary>' +
      '<p class="fine" id="aiServerNote" style="margin:10px 0 14px">接口和模型已经填好，你只要粘一个 Key。Key 只存在这台设备的浏览器里，不上传；点评时逐字稿会直接发到上面那个接口。不填也能用，七维度评分全程本地完成。</p>' +
      '<div id="aiKeyFields">' +
        '<label class="field"><span class="field-label">API Key</span>' +
          '<input class="input" id="aiKey" type="password" autocomplete="off" placeholder="sk-…" value="' + util.escape(d.aiKey || '') + '"></label>' +
        '<label class="field"><span class="field-label">接口地址</span>' +
          '<input class="input" id="aiEndpoint" type="url" autocomplete="off" value="' + util.escape(d.aiEndpoint || '') + '"></label>' +
        '<label class="field"><span class="field-label">模型</span>' +
          '<input class="input" id="aiModel" type="text" autocomplete="off" value="' + util.escape(d.aiModel || '') + '"></label>' +
      '</div>' +
      '<div class="asr-settings" id="aiAsrBlock">' +
        '<p class="field-label" style="margin:18px 0 6px">本机语音识别（可选，不进评分流程）</p>' +
        '<p class="fine" style="margin:0 0 10px">评分现在<b>必须附字幕文件</b>；这里配的识别只在你自己这台电脑上有效，' +
          '别人打开网页时用不到，也不会替代字幕。留着它是为了你本机调试或以后接云端识别。</p>' +
        '<div class="asr-presets">' +
          '<button class="btn btn-ghost btn-xs" type="button" data-preset="deepseek">DeepSeek（只做文字）</button>' +
          '<button class="btn btn-ghost btn-xs" type="button" data-preset="siliconflow">填硅基流动地址</button>' +
          '<button class="btn btn-ghost btn-xs" type="button" data-preset="openai">填 OpenAI 官方地址</button>' +
        '</div>' +
        '<p class="fine" id="asrHintLine" style="margin:0 0 12px">DeepSeek 的开放接口只提供文字模型（deepseek-chat / deepseek-reasoner），' +
          '没有语音识别接口，也不接受图片输入。所以：文字点评可以走你的 DeepSeek 额度，' +
          '<b>语音转写必须另配一个识别接口</b>（或者在上传时附一份字幕）。</p>' +
        '<label class="field"><span class="field-label">识别接口地址</span>' +
          '<input class="input" id="asrEndpoint" type="url" autocomplete="off" placeholder="https://api.openai.com/v1/audio/transcriptions" value="' + util.escape(d.asrEndpoint || '') + '"></label>' +
        '<label class="field"><span class="field-label">识别 Key</span>' +
          '<input class="input" id="asrKey" type="password" autocomplete="off" placeholder="sk-…" value="' + util.escape(d.asrKey || '') + '"></label>' +
        '<label class="field"><span class="field-label">识别模型</span>' +
          '<input class="input" id="asrModel" type="text" autocomplete="off" placeholder="whisper-1" value="' + util.escape(d.asrModel || '') + '"></label>' +
      '</div>' +
      '<button class="btn btn-ghost btn-block" type="button" id="btnAiTest" style="margin-top:12px">测试连接</button>' +
      '<button class="btn btn-ghost btn-block" type="button" id="btnModelList" style="margin-top:8px">检查这个 Key 能用哪些模型</button>' +
      '<pre class="fine" id="modelListOut" style="margin-top:10px;white-space:pre-wrap;line-height:1.7"></pre>' +
      '<div class="ocr-box">' +
        '<p class="field-label" style="margin:18px 0 6px">板书 OCR（可选）</p>' +
        '<p class="fine" style="margin:0 0 10px">字距、字号这两项，靠像素连通域只能估。填一个 OCR 地址，或者开本机 OCR，就能拿到真实字符框。都不配就照实写「按连通域估算」。</p>' +
        '<label class="field"><span class="field-label">OCR 服务地址</span>' +
          '<input class="input" id="ocrEndpoint" type="url" autocomplete="off" placeholder="https://your-ocr.example.com/ocr" value="' + util.escape(d.ocrEndpoint || '') + '"></label>' +
        '<label class="field" style="display:flex;align-items:center;gap:10px;margin-top:8px">' +
          '<input type="checkbox" id="ocrLocal" ' + (d.ocrLocal ? 'checked' : '') + '>' +
          '<span class="field-label" style="margin:0">用本机 OCR（tesseract.js，需自托管到 vendor/tesseract/）</span></label>' +
      '</div>' +
      '<div class="ver-box">' +
        '<p class="field-label" style="margin:20px 0 6px">版本</p>' +
        '<p class="fine" id="verLine" style="margin:0 0 10px">当前 ' + util.escape(App.build || '?') + '</p>' +
        '<button class="btn btn-ghost btn-block" type="button" id="btnForceUpdate">清缓存，更新到最新版</button>' +
        '<p class="fine" style="margin:8px 0 0">按钮点了还跳回首页、或者看到的内容跟上次一样，就点它：' +
          '会把本机缓存的旧程序清掉再重开，不会删你的历史记录和录像。</p>' +
      '</div>';
    form.appendChild(box);

    function refreshAiBox() {
      var server = !!(App.ai && App.ai.serverMode);
      var note = document.getElementById('aiServerNote');
      var wrap = document.getElementById('aiKeyFields');
      if (note) {
        if (server) {
          note.innerHTML = '本站已统一配置模型接口' +
            (App.ai.serverModel ? '（' + util.escape(App.ai.serverModel) + '）' : '') +
            '，<b>不用填 Key</b>。逐字稿经本站服务器转发，Key 不会出现在浏览器里。' +
            (App.ai.dailyPerIp ? '每台设备每天限 ' + App.ai.dailyPerIp + ' 次。' : '');
        } else {
          note.innerHTML = '接口和模型已经填好，<b>粘一个 Key 就能用</b>。Key 只存在这台设备的浏览器里，不上传；' +
            '点评时逐字稿会直接发到上面那个接口。不填也能用，七维度评分全程本地完成。';
        }
      }
      if (wrap) wrap.hidden = server;
      /* 本站已配好模型时，本机识别那块也收起来：评分本来就必须附字幕 */
      var asrBlock = document.getElementById('aiAsrBlock');
      if (asrBlock) asrBlock.hidden = server;
      /* 本站已配好 Key，那两个调试按钮（测试连接 / 查模型）也没意义 */
      ['btnAiTest', 'btnModelList', 'modelListOut'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.hidden = server;
      });
      // 服务器已经统一配好模型，这块「可选设置」就不该再出现在准备页上，
      // 只留一行「已启用」的说明，省得用户以为还要自己填
      if (box) box.open = false;
      var sum = box && box.querySelector('summary');
      if (sum) sum.textContent = server ? 'AI 深度点评（本站已启用）' : 'AI 深度点评（填一次 Key）';
      /* 服务器已配好模型时，Key 输入框藏掉，但整个折叠框要留着——
         里面还有「版本 + 清缓存更新」，用户报「按钮还跳回首页」时就靠它确认版本。 */
      if (box) box.hidden = false;
    }

    refreshAiBox();
    if (App.bus) App.bus.on('ai-ready', refreshAiBox);

    function save() {
      App.settings.save({
        aiKey: ($('aiKey') || {}).value || '',
        aiEndpoint: ($('aiEndpoint') || {}).value || '',
        aiModel: ($('aiModel') || {}).value || '',
        asrEndpoint: ($('asrEndpoint') || {}).value || '',
        asrKey: ($('asrKey') || {}).value || '',
        asrModel: ($('asrModel') || {}).value || '',
        ocrEndpoint: ($('ocrEndpoint') || {}).value || '',
        ocrLocal: !!($('ocrLocal') || {}).checked
      });
    }
    ['aiKey', 'aiEndpoint', 'aiModel', 'asrEndpoint', 'asrKey', 'asrModel', 'ocrEndpoint', 'ocrLocal'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', save);
    });

    /* 一键填地址：只填接口与模型，Key 仍然要用户自己粘 */
    var PRESETS = {
      deepseek: {
        aiEndpoint: 'https://api.deepseek.com/chat/completions',
        aiModel: 'deepseek-chat'
      },
      siliconflow: {
        asrEndpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
        asrModel: 'FunAudioLLM/SenseVoiceSmall',
        aiEndpoint: 'https://api.siliconflow.cn/v1/chat/completions',
        aiModel: 'Qwen/Qwen2.5-VL-72B-Instruct'
      },
      openai: {
        asrEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
        asrModel: 'whisper-1',
        aiEndpoint: 'https://api.openai.com/v1/chat/completions',
        aiModel: 'gpt-4o-mini'
      }
    };
    box.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = PRESETS[btn.getAttribute('data-preset')];
        if (!p) return;
        Object.keys(p).forEach(function (k) {
          var el = $(k);
          if (el) el.value = p[k];
        });
        save();
        ui.toast('已填好接口地址与模型名，Key 请自己粘贴。', 'ok', 4200);
      });
    });

    var test = $('btnAiTest');
    if (test) test.addEventListener('click', function () {
      save();
      test.disabled = true;
      test.textContent = '测试中…';
      App.ai.test().then(function () {
        ui.toast('连接正常，Key 可用', 'ok');
      }).catch(function (e) {
        ui.toast('连接失败：' + (e.message || e), 'err', 5000);
      }).then(function () {
        test.disabled = false;
        test.textContent = '测试连接';
      });
    });

    /* 用你自己的 Key 问一次 /models：这个账户能不能跑语音、能不能看图，列表说了算 */
    var ml = $('btnModelList');
    if (ml) ml.addEventListener('click', function () {
      save();
      var out = $('modelListOut');
      ml.disabled = true;
      ml.textContent = '查询中…';
      if (out) out.textContent = '';
      App.ai.listModels().then(function (r) {
        var all = (r.models || []).join(' ');
        var hasAudio = /whisper|audio|asr|sensevoice|speech|paraformer/i.test(all);
        var hasVision = /\bvl\b|vision|multimodal|omni|visual/i.test(all);
        var lines = [
          '接口：' + r.url,
          '可用模型（' + r.models.length + '）：' + (r.models.join('、') || '（空）'),
          hasAudio ? '✓ 这个账户里有语音类模型，可以直接把识别接口指过来。'
            : '✗ 没有语音识别模型 —— 听写要另外接一家（或上传时附字幕）。',
          hasVision ? '✓ 有视觉类模型，板书/画面复核可以走同一个 Key。'
            : '✗ 没有视觉模型 —— 图片复核要另外接一家。'
        ];
        if (out) out.textContent = lines.join('\n');
      }).catch(function (e) {
        if (out) out.textContent = '查询失败：' + (e.message || e) + (e.detail ? '\n' + e.detail : '');
      }).then(function () {
        ml.disabled = false;
        ml.textContent = '检查这个 Key 能用哪些模型';
      });
    });

    var fu = $('btnForceUpdate');
    if (fu) fu.addEventListener('click', function () {
      fu.disabled = true;
      fu.textContent = '正在清缓存…';
      hardRefresh();
    });

    /* 顺便把线上版本号抓回来：用户报 bug 时让他报这个号，能立刻分辨是不是旧缓存 */
    var verLine = $('verLine');
    if (verLine && window.fetch) {
      fetch('./sw.js?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (txt) {
          var m = /var VERSION = '([^']+)'/.exec(txt || '');
          if (!m) return;
          verLine.textContent = m[1] === App.build
            ? '当前 ' + App.build + '（已是最新）'
            : '当前 ' + App.build + '，线上已是 ' + m[1] + ' —— 点下面这个按钮更新';
        })
        .catch(function () {});
    }
  }

  /* ======================================================================
     八、事件绑定与启动
     ====================================================================== */
  /* 示例报告只生成一次：首页预览和「打开完整报告」用同一份数据，
     否则首页写 77.6、报告里写 80.2，又是两套数。 */
  function demoReport() {
    if (!S.demoReport && window.App.demo && App.demo.build) {
      S.demoReport = App.demo.build();
    }
    return S.demoReport || null;
  }

  /* 首页那张预览卡：分数、等级、时长、前几条建议全部来自示例报告本身 */
  function renderHomePreview() {
    var r = demoReport();
    if (!r) return;
    var ring = $('shotRing');
    if (ring) {
      var C = 2 * Math.PI * 54;
      ring.setAttribute('stroke-dasharray', C.toFixed(1));
      ring.setAttribute('stroke-dashoffset', (C * (1 - r.total / 100)).toFixed(1));
    }
    var sc = $('shotScore');
    if (sc) sc.textContent = r.total.toFixed(1);
    var gd = $('shotGrade');
    if (gd) gd.textContent = r.grade.key + ' · ' + r.grade.label;
    var meta = $('shotMeta');
    if (meta) meta.textContent = r.topic + ' · ' + util.fmtTime(r.duration);

    var list = $('shotAdvList');
    var title = $('shotAdvTitle');
    if (!list) return;
    var items = [];
    (r.advice.must || []).forEach(function (t) { items.push({ kind: 'must', text: t }); });
    (r.advice.should || []).forEach(function (t) { items.push({ kind: 'should', text: t }); });
    items = items.slice(0, 3);
    if (title) title.textContent = '这次先改这 ' + items.length + ' 处';
    list.innerHTML = items.map(function (it) {
      return '<li><span class="' + it.kind + '">' +
        (it.kind === 'must' ? '必须改' : '建议改') + '</span>' +
        util.escape(it.text.replace(/。$/, '')) + '</li>';
    }).join('');
  }

  function bind() {

    /* 首页 */
    ['btnStart', 'btnCta', 'btnNavStart'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('click', function () { ui.go('prepare'); });
    });
    var hist = $('btnViewHistory');
    if (hist) hist.addEventListener('click', function () { ui.go('history'); });

    /* 示例报告：不碰摄像头，直接渲染一份样例 */
    ['btnDemo', 'btnDemo2', 'btnDemoHero'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function () {
        var demoRep = demoReport();
        if (!demoRep) return;
        ui.go('report');
        renderReport(demoRep, null);
      });
    });

    /* 上传录像：解析音轨，出节奏类评分 */
    ['btnUpload', 'btnUpload2', 'btnNavUpload'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('click', pickUpload);
    });
    var upFile = $('uploadFile');
    if (upFile) upFile.addEventListener('change', function () {
      var f = upFile.files && upFile.files[0];
      if (f) onUploadPicked(f);
    });

    /* 准备页 */
    var begin = $('btnBegin');
    if (begin) begin.addEventListener('click', function () {
      var audioMode = S.captureMode === 'audio';
      if (!S.stream || !S.stream.active) {
        ui.toast(audioMode ? '麦克风未就绪，正在重试…' : '摄像头未就绪，正在重试…', 'warn');
        var open = audioMode ? openAudioStream() : openPreviewStream(S.facing);
        open.then(function () { startRecording(); }).catch(function () {});
        return;
      }
      startRecording();
    });

    var flip = $('btnFlip');
    if (flip) flip.addEventListener('click', function () {
      S.facing = S.facing === 'user' ? 'environment' : 'user';
      flip.disabled = true;
      openPreviewStream(S.facing).then(function () {
        flip.disabled = false;
        ui.toast(S.facing === 'user' ? '已切换到前置摄像头' : '已切换到后置摄像头', 'ok', 1400);
      }).catch(function () {
        flip.disabled = false;
        S.facing = S.facing === 'user' ? 'environment' : 'user';
      });
    });

    var mirror = $('btnMirror');
    if (mirror) mirror.addEventListener('click', function () {
      S.mirror = !S.mirror;
      applyPreviewTransform();
      var badge = $('mirrorBadge');
      if (badge) badge.hidden = !S.mirror;
      ui.toast(S.mirror ? '预览已镜像（录像不镜像）' : '预览已取消镜像', 'ok', 1500);
    });

    var screenBtn = $('btnScreen');
    if (screenBtn) screenBtn.addEventListener('click', function () {
      if (S.screenStream) {
        App.Media.stopStream(S.screenStream);
        S.screenStream = null;
        if (S.screenVideo) S.screenVideo.srcObject = null;
        screenBtn.classList.remove('active');
        ui.toast('已关闭录屏', 'ok');
        return;
      }
      App.Media.getDisplayMedia().then(function (s) {
        S.screenStream = s;
        screenBtn.classList.add('active');
        if ($('screenHint')) $('screenHint').textContent = '录屏已开启：屏幕会以画中画出现在录像右上角。';
        s.getVideoTracks()[0].addEventListener('ended', function () {
          S.screenStream = null;
          screenBtn.classList.remove('active');
          ui.toast('屏幕共享已结束', 'warn');
        });
        ui.toast('已开始屏幕共享', 'ok');
      }).catch(function (e) {
        ui.toast('无法开始录屏：' + (e.message || e), 'err');
      });
    });

    var boardPrep = $('btnBoardPrep');
    if (boardPrep) boardPrep.addEventListener('click', function () {
      App.Board.pick().then(function (b) {
        if (!b) return;
        var mini = $('boardMini');
        if (!mini) {
          mini = document.createElement('div');
          mini.id = 'boardMini';
          mini.className = 'board-mini';
          var wrap = $('previewWrap');
          if (wrap) wrap.appendChild(mini);
        }
        App.Board.mountInto(mini, { removable: true });
        ui.toast('板书已保存，会以画中画进入录像', 'ok');
      });
    });

    var slider = $('zoomSlider');
    if (slider) slider.addEventListener('input', function () { setZoom(parseFloat(slider.value), true); });

    var zin = $('btnZoomIn');
    if (zin) zin.addEventListener('click', function () { setZoom(S.zoom + 0.2); });
    var zout = $('btnZoomOut');
    if (zout) zout.addEventListener('click', function () { setZoom(S.zoom - 0.2); });

    var group = $('durationGroup');
    if (group) group.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-item');
      if (!b) return;
      util.$$('.seg-item', group).forEach(function (x) {
        x.classList.remove('active');
        x.setAttribute('aria-checked', 'false');
      });
      b.classList.add('active');
      b.setAttribute('aria-checked', 'true');
      S.durationMin = parseInt(b.getAttribute('data-min'), 10) || 10;
      App.settings.save({ durationMin: S.durationMin });
      util.haptic(6);
    });

    var modeGroup = $('lessonMode');
    if (modeGroup) modeGroup.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-item');
      if (!b) return;
      S.lessonMode = b.getAttribute('data-mode') || 'micro';
      App.settings.save({ lessonMode: S.lessonMode });
      paintLessonMode();
      util.haptic(6);
    });

    var fmGroup = $('frameMode');
    if (fmGroup) fmGroup.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-item');
      if (!b) return;
      S.frameMode = b.getAttribute('data-fm') === 'fine' ? 'fine' : 'standard';
      App.settings.save({ frameMode: S.frameMode });
      paintFrameMode();
      util.haptic(6);
    });

    var capGroup = $('captureMode');
    if (capGroup) capGroup.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-item');
      if (!b) return;
      var next = b.getAttribute('data-cap') === 'audio' ? 'audio' : 'av';
      if (next === S.captureMode) return;
      S.captureMode = next;
      App.settings.save({ captureMode: next });
      paintCaptureMode();
      /* 换模式必须换流：视频模式要摄像头，纯语音模式要把摄像头关掉 */
      stopPrepMeter();
      if (S.stream) { App.Media.stopStream(S.stream); S.stream = null; }
      if (next === 'audio') openAudioStream().catch(function () {});
      else openPreviewStream(S.facing).catch(function () {});
      util.haptic(6);
    });

    /* 提前把姿态/表情模型下好、编译好：真正卡人的是这一步，
       放在准备页后台做，等你录完就不会卡在「正在分析」上干等 */
    var warmModels = function () {
      if (warmModels.done) return;
      warmModels.done = true;
      try {
        var jobs = [];
        if (App.Pose) jobs.push(App.Pose.load(function () {}));
        if (App.Face) jobs.push(App.Face.load(function () {}));
        /* 光下载/建实例还不够：第一次推理要编译 wasm，实测会卡 9–10 秒。
           这里先拿一张空白图跑一遍，把这次卡顿挪到准备页后台，别让用户等到结分时才卡 */
        Promise.all(jobs).then(function () {
          try {
            var c = document.createElement('canvas');
            c.width = 320; c.height = 180;
            var g = c.getContext('2d');
            g.fillStyle = '#666'; g.fillRect(0, 0, 320, 180);
            if (App.Pose && App.Pose.detect) App.Pose.detect(c);
            if (App.Face && App.Face.detect) App.Face.detect(c);
          } catch (e2) { /* 预热失败无所谓 */ }
        });
      } catch (e) { /* 预热失败不影响主流程，分析时会再试一次 */ }
    };
    setTimeout(warmModels, 1500);

    var boardPointsInput = $('boardPoints');
    if (boardPointsInput) {
      boardPointsInput.value = App.settings.data.boardPoints || '';
      var savePoints = function () { App.settings.save({ boardPoints: boardPointsInput.value.trim() }); };
      boardPointsInput.addEventListener('change', savePoints);
      boardPointsInput.addEventListener('blur', savePoints);
    }

    var topicInput = $('topicInput');
    if (topicInput) topicInput.addEventListener('change', function () {
      App.settings.save({ topic: topicInput.value.trim() });
    });

    /* 录制页 */
    var stop = $('btnStop');
    if (stop) stop.addEventListener('click', askStop);

    var shot = $('btnBoardShot');
    if (shot) shot.addEventListener('click', function () {
      App.Board.pick().then(function (b) {
        if (!b) return;
        if (S.recorder) S.recorder.setBoard(b.dataUrl);
        ui.toast('板书已加入录像', 'ok');
      });
    });

    var rzoom = $('btnRecZoom');
    if (rzoom) rzoom.addEventListener('click', function () {
      var max = S.hwZoom && S.zoomCaps ? S.zoomCaps.max : 3;
      var next = S.zoom >= max - 0.01 ? 1 : Math.min(max, S.zoom + 0.5);
      setZoom(next);
      ui.toast('变焦 ' + next.toFixed(1) + '×', 'ok', 1100);
    });

    /* 识别被暂停后：点按钮或在页面上点一下就续上（iOS 的老规矩，必须带手势） */
    var asrRetry = $('btnAsrRetry');
    if (asrRetry) asrRetry.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!S.asr) return;
      if (S.asr.resume()) setLiveState('listening');
      else setLiveState('degraded', S.asr.reason || 'not-allowed');
    });

    document.addEventListener('click', function () {
      if (!S.asr || !S.recording) return;
      if (!S.asr.pending) return;
      if (S.asr.resume()) setLiveState('listening');
    }, true);

    /* 历史页 */
    App.history.bind();
    var wipe = $('btnWipe');
    if (wipe) wipe.addEventListener('click', function () {
      ui.confirm({
        title: '清除全部数据？',
        text: '所有记录、录像、逐字稿和板书照片都会从这台设备删除，无法恢复。',
        okText: '全部删除',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        App.db.wipe().then(function () {
          App.draft.clear();
          App.Board.clear();
          return App.history.load();
        }).then(function () {
          ui.toast('已清除全部数据', 'ok');
        }).catch(function (e) {
          ui.toast('清除失败：' + (e.message || e), 'err');
        });
      });
    });

    /* 路由副作用 */
    App.bus.on('page', function (d) {
      if (d.page === 'prepare') enterPrepare();
      if (d.page === 'history') App.history.load();
      if (d.page === 'record') window.scrollTo(0, 0);
    });

    /* 页面隐藏提醒 */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && S.recording) {
        ui.toast('页面切到后台，部分浏览器会中断录制，请保持前台', 'warn', 4000);
      }
    });

    window.addEventListener('resize', function () {
      if (S.report) App.report.drawTimeline($('timeline'), S.report, function (t) { seekPlayer(t); });
    });

    /* 双指捏合 / 双击变焦（一次性绑定） */
    bindGestures();
  }

  /* 用 http://局域网IP 打开时（最常见的是手机），浏览器一律不给摄像头。
   这里给一条常驻提示，写清楚该怎么办，而不是让用户点了「开始」才报错。 */
  function showInsecureBanner() {
    if (document.getElementById('insecureBanner')) return;
    var bar = document.createElement('div');
    bar.id = 'insecureBanner';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483000',
      'padding:12px 46px 12px 18px', 'background:#ff9f0a', 'color:#1d1d1f',
      'font-size:13px', 'line-height:1.55', 'text-align:center',
      'box-shadow:0 -4px 20px rgba(0,0,0,.18)'
    ].join(';');
    bar.innerHTML = '<b>这个地址开不了摄像头。</b>浏览器只允许 https 页面（或 localhost）使用摄像头。' +
      '在电脑上双击「启动服务.bat」，用它给出的 <b>https://…</b> 地址打开这个页面就可以。';
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', '关闭提示');
    x.textContent = '×';
    x.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);' +
      'width:28px;height:28px;border-radius:50%;font-size:18px;line-height:1;color:#1d1d1f;' +
      'background:rgba(0,0,0,.08)';
    x.onclick = function () { bar.remove(); };
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  /* ------------------------------------------------------------ 版本自更新
     浏览器会拿 Service Worker 的缓存先开页面，于是发版后第一次打开看到的
     往往是上一版 JS（用户点了按钮还按旧逻辑跳走）。这里在启动 1.2 秒后
     抓一次线上 sw.js 里的 VERSION，和本文件的 App.build 对不上就刷新一次。
     用 sessionStorage 记一次，避免和缓存打架时反复刷新。 */
  function ensureLatest() {
    if (!window.fetch || location.protocol === 'file:' || !App.build) return;
    setTimeout(function () {
      fetch('./sw.js?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (txt) {
          var m = /var VERSION = '([^']+)'/.exec(txt || '');
          if (!m || m[1] === App.build) return;
          /* 正在录就绝不刷新：一次模拟录到一半被刷掉，比看旧版更糟 */
          if (S.recording) return;
          var key = 'tsj-stale-' + m[1];
          try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) {}
          App.log('stale build', { running: App.build, live: m[1] });
          location.reload();
        })
        .catch(function () {});
    }, 1200);
  }

  /* 手动更新：注销 Service Worker、清掉所有缓存，再带时间戳重开。 */
  function hardRefresh() {
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
    } catch (e) {}
    try {
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
    } catch (e) {}
    return Promise.all(jobs).catch(function () {}).then(function () {
      location.replace(location.pathname + '?u=' + Date.now());
    });
  }

  function boot() {
    App.ui.init();

    App.db.init().catch(function (e) {
      console.warn('[app] idb init failed', e);
      ui.toast('本地存储不可用，本次记录将只保留在内存中', 'warn', 5000);
    });

    bind();
    checkRecovery();

    /* 评分标准只在首页渲染一次（报告里不再重复权重表） */
    var homeRubric = $('homeRubric');
    if (homeRubric && App.rubric && App.rubric.html) {
      homeRubric.innerHTML = App.rubric.html();
    }
    renderHomePreview();

    /* 问一下服务器有没有统一配好模型 Key（有的话前端就不显示 Key 输入框） */
    if (App.ai && App.ai.probe) App.ai.probe();

    /* 直接带 hash 进入某个页面 */
    var h = (location.hash || '').replace('#', '');
    if (['prepare', 'history'].indexOf(h) >= 0) {
      ui.go(h);
    }

    if (!App.env.secure) {
      showInsecureBanner();
    }

    /* 版本自更新：旧缓存不会一直赖着 */
    ensureLatest();
    console.info('[试讲评分官] 版本 ' + (App.build || '?') + '（页面里显示的就是这个号）');

    App.log('booted', {
      secure: App.env.secure,
      asr: App.env.hasSpeechRecognition,
      rec: App.env.hasMediaRecorder,
      display: App.env.hasDisplayMedia
    });
  }

  App.app = {
    openSession: openSession,
    playSession: playSession,
    stopRecording: stopRecording,
    analyzeAudioBuffer: analyzeAudioBuffer,
    state: S
  };

  util.ready(boot);

})(window);