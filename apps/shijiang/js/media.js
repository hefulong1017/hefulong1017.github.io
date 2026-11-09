/* ==========================================================================
   media.js — 摄像头取流 / canvas 合成录像 / 数字变焦 / 分片落盘
   · 预览只做 CSS 镜像，canvas 绘制原始帧 → 成片不反字
   · 数字变焦在 canvas 上裁剪绘制，因此"看到什么就录到什么"
   · MediaRecorder 每秒一片，边录边写 IndexedDB，刷新也能恢复
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;

  var FRIENDLY = {
    NotAllowedError: '摄像头或麦克风权限被拒绝。请在浏览器地址栏的权限图标里允许后重试。',
    PermissionDeniedError: '摄像头或麦克风权限被拒绝。请在浏览器设置里允许后重试。',
    NotFoundError: '没有找到可用的摄像头或麦克风。',
    DevicesNotFoundError: '没有找到可用的摄像头或麦克风。',
    NotReadableError: '设备被其他程序占用（比如会议软件），请关闭后重试。',
    TrackStartError: '设备被其他程序占用（比如会议软件），请关闭后重试。',
    OverconstrainedError: '当前设备不支持所需的画质，请换一个摄像头。',
    SecurityError: '浏览器阻止了摄像头访问，请确认页面运行在 https 或 localhost。',
    AbortError: '设备启动被中断，请重试。'
  };

  var Media = App.Media = {};

  Media.friendlyError = function (err) {
    if (!err) return '未知错误';
    return FRIENDLY[err.name] || err.message || String(err);
  };

  /**
   * 取流。约束从"理想"逐级降级，兼容老设备。
   */
  Media.getUserMedia = function (opts) {
    opts = opts || {};
    if (!App.env.hasGetUserMedia) {
      return Promise.reject(new Error('当前浏览器不支持摄像头采集，建议使用 Chrome / Edge / Safari 最新版。'));
    }
    var facing = opts.facing || 'user';
    var wantAudio = opts.audio !== false;
    var wantVideo = opts.video !== false;

    var base = {
      audio: wantAudio ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      } : false,
      video: wantVideo ? {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      } : false
    };

    var attempts = [
      base,
      {
        audio: base.audio,
        video: wantVideo ? { facingMode: { ideal: facing }, width: { ideal: 960 }, height: { ideal: 540 } } : false
      },
      {
        audio: base.audio,
        video: wantVideo ? { facingMode: facing } : false
      },
      {
        audio: base.audio,
        video: wantVideo ? true : false
      }
    ];
    if (opts.deviceId) {
      attempts.unshift({
        audio: base.audio,
        video: wantVideo ? { deviceId: { exact: opts.deviceId } } : false
      });
    }

    function tryNext(i) {
      if (i >= attempts.length) {
        return navigator.mediaDevices.getUserMedia({ audio: wantAudio, video: wantVideo })
          .catch(function (e) { throw e; });
      }
      return navigator.mediaDevices.getUserMedia(attempts[i]).catch(function (e) {
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
        return tryNext(i + 1);
      });
    }

    return tryNext(0);
  };

  /** 屏幕共享（选讲 PPT 时用） */
  Media.getDisplayMedia = function () {
    if (!App.env.hasDisplayMedia) {
      return Promise.reject(new Error('当前浏览器不支持屏幕共享。'));
    }
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
  };

  Media.attach = function (videoEl, stream) {
    if (!videoEl || !stream) return;
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    var p = videoEl.play();
    if (p && p.catch) p.catch(function () {});
  };

  Media.stopStream = function (stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (t) {
      try { t.stop(); } catch (e) {}
    });
  };

  Media.hasVideo = function (stream) {
    return !!stream && stream.getVideoTracks().length > 0;
  };

  Media.hasAudio = function (stream) {
    return !!stream && stream.getAudioTracks().length > 0;
  };

  /** 预览层数字变焦（纯视觉，不改流） */
  Media.applyZoom = function (videoEl, zoom, mode) {
    if (!videoEl) return;
    var z = util.clamp(zoom || 1, 0.5, 2.2);
    videoEl.style.transformOrigin = (mode === 'top' ? '50% 18%' : '50% 50%');
    videoEl.style.transform = 'scale(' + z + ')';
  };

  /* ======================================================================
     Recorder —— canvas 合成 + MediaRecorder 分片
     ====================================================================== */
  function Recorder(opts) {
    opts = opts || {};
    this.video = opts.video;
    this.stream = opts.stream;
    this.sessionId = opts.sessionId;
    this.onChunk = opts.onChunk || function () {};
    this.onError = opts.onError || function () {};
    this.onState = opts.onState || function () {};

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.zoom = 1;
    this.targetZoom = 1;
    this.zoomMode = 'center';
    this.mirror = false;
    this.board = null;          // { img, w, h }
    this.pip = null;            // 画中画（录屏时把屏幕缩到右上角）
    this.audioOnly = !!opts.audioOnly;   // 纯语音模式：只留音轨，不合成画面
    this.showHud = opts.showHud !== false;
    this.topic = opts.topic || '';
    this.startedAt = 0;
    this.paused = false;

    this.recorder = null;
    this.outStream = null;
    this.parts = [];
    this.chunks = 0;
    this.bytes = 0;
    this.mime = '';
    this.duration = 0;
    this.running = false;
    this.canComposite = typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
    this._raf = 0;
  }

  Recorder.prototype._fit = function () {
    var v = this.video;
    var vw = v.videoWidth || 1280;
    var vh = v.videoHeight || 720;
    var maxW = 1280, maxH = 720;
    var scale = Math.min(1, maxW / vw, maxH / vh);
    // 保证偶数尺寸，编码器更友好
    this.canvas.width = Math.max(2, Math.round(vw * scale / 2) * 2);
    this.canvas.height = Math.max(2, Math.round(vh * scale / 2) * 2);
  };

  Recorder.prototype._draw = function () {
    var v = this.video, ctx = this.ctx;
    var cw = this.canvas.width, ch = this.canvas.height;
    // 变焦平滑
    this.zoom += (this.targetZoom - this.zoom) * 0.18;
    if (Math.abs(this.targetZoom - this.zoom) < 0.001) this.zoom = this.targetZoom;

    var z = util.clamp(this.zoom, 0.5, 3);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    if (v && v.readyState >= 2) {
      try {
        if (z >= 1) {
          /* 放大：从源里裁一块出来铺满 */
          var sw = cw / z, sh = ch / z;
          var sx = (cw - sw) / 2;
          var sy = this.zoomMode === 'top' ? (ch - sh) * 0.18 : (ch - sh) / 2;
          ctx.drawImage(v, sx, sy, sw, sh, 0, 0, cw, ch);
        } else {
          /* 缩小（0.几倍）：整幅缩到中间，四周留黑边，就是「广角」的观感 */
          var dw = cw * z, dh = ch * z;
          ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        }
      } catch (e) { /* 偶发帧不可用，跳过 */ }
    }

    this._drawBoard(ctx, cw, ch);
    this._drawPip(ctx, cw, ch);
    if (this.showHud) this._drawHud(ctx, cw, ch);
  };

  Recorder.prototype._drawPip = function (ctx, cw, ch) {
    var v = this.pip;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    var pad = Math.round(cw * 0.018);
    var pw = Math.round(cw * 0.26);
    var ph = Math.round(pw * (v.videoHeight / Math.max(1, v.videoWidth)));
    var x = cw - pw - pad, y = pad + Math.round(ch * 0.06);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    roundRect(ctx, x - 3, y - 3, pw + 6, ph + 6, 10);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, pw, ph, 8);
    ctx.clip();
    ctx.drawImage(v, x, y, pw, ph);
    ctx.restore();

    // 小标签
    var fs = Math.max(9, Math.round(cw * 0.012));
    ctx.save();
    ctx.font = '600 ' + fs + 'px -apple-system, "PingFang SC", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    var tw = ctx.measureText('屏幕').width + fs * 1.2;
    ctx.beginPath();
    roundRect(ctx, x + 6, y + 6, tw, fs * 1.7, fs * 0.85);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('屏幕', x + 6 + fs * 0.6, y + 6 + fs * 1.15);
    ctx.restore();
  };

  Recorder.prototype._drawBoard = function (ctx, cw, ch) {
    if (!this.board || !this.board.img) return;
    var img = this.board.img;
    var pad = Math.round(cw * 0.018);
    var bw = Math.round(cw * 0.30);
    var bh = Math.round(bw * (img.height / Math.max(1, img.width)));
    var maxBh = Math.round(ch * 0.42);
    if (bh > maxBh) { bh = maxBh; bw = Math.round(bh * (img.width / Math.max(1, img.height))); }

    var x = pad, y = ch - bh - pad;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    var r = Math.round(bw * 0.03);
    roundRect(ctx, x, y, bw, bh, r);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, bw, bh, r);
    ctx.clip();
    ctx.drawImage(img, x, y, bw, bh);
    ctx.restore();
  };

  Recorder.prototype._drawHud = function (ctx, cw, ch) {
    var secs = this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
    var t = util.fmtTime(Math.floor(secs));
    var fs = Math.max(13, Math.round(cw * 0.020));
    var pad = Math.round(cw * 0.022);

    ctx.save();
    ctx.font = '600 ' + fs + 'px -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // 左上：红点 + 计时
    var label = t;
    var dotR = Math.max(4, fs * 0.28);
    var tw = ctx.measureText(label).width;
    var boxW = tw + dotR * 6 + fs * 0.8;
    var boxH = fs * 1.9;
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath();
    roundRect(ctx, pad, pad, boxW, boxH, boxH / 2);
    ctx.fill();

    var pulse = 0.55 + 0.45 * Math.abs(Math.sin(secs * Math.PI));
    ctx.fillStyle = 'rgba(255,59,48,' + pulse.toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(pad + boxH / 2, pad + boxH / 2, dotR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillText(label, pad + boxH * 0.95, pad + boxH / 2 + 1);

    // 右下：水印
    if (App.settings && App.settings.data && App.settings.data.hudWatermark !== false) {
      var wm = this.topic || '';
      if (wm) {
        var wmText = wm.length > 18 ? wm.slice(0, 18) + '…' : wm;
        ctx.font = '500 ' + Math.round(fs * 0.85) + 'px -apple-system, "PingFang SC", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.66)';
        ctx.textAlign = 'right';
        ctx.fillText(wmText, cw - pad, ch - pad - fs * 0.8);
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  Recorder.prototype._loop = function () {
    var self = this;
    if (!this.running) return;
    this._draw();
    this._raf = requestAnimationFrame(function () { self._loop(); });
  };

  Recorder.prototype.start = function () {
    var self = this;
    if (this.running) return Promise.resolve(this);
    if (!App.env.hasMediaRecorder) {
      return Promise.reject(new Error('当前浏览器不支持录制，建议使用 Chrome / Edge 最新版。'));
    }

    if (!this.audioOnly) this._fit();

    var videoTrack, audioTrack = null;
    if (this.audioOnly) {
      /* 纯语音：直接把麦克风音轨交给 MediaRecorder。
         不走 canvas 合成——那样会白编一段黑画面，手机白白耗电发热。 */
      var at = this.stream.getAudioTracks();
      if (!at.length) {
        return Promise.reject(new Error('没有可用的麦克风音轨，无法录音。'));
      }
      audioTrack = at[0];
      this.outStream = new MediaStream([audioTrack]);
    } else if (this.canComposite) {
      this.outStream = this.canvas.captureStream(30);
      videoTrack = this.outStream.getVideoTracks()[0];
      var audios = this.stream.getAudioTracks();
      if (audios.length) {
        audioTrack = audios[0];
        this.outStream.addTrack(audioTrack);
      }
    } else {
      // Safari 老版本无 canvas.captureStream：直接录原始流（变焦不进成片）
      this.outStream = this.stream;
      videoTrack = this.stream.getVideoTracks()[0];
      audioTrack = this.stream.getAudioTracks()[0] || null;
    }

    this.mime = this.audioOnly ? App.env.pickAudioMime() : App.env.pickMime();
    var options = {};
    if (this.mime) options.mimeType = this.mime;
    if (!this.audioOnly) options.videoBitsPerSecond = 2500000;
    if (audioTrack) options.audioBitsPerSecond = 128000;

    try {
      this.recorder = new MediaRecorder(this.outStream, options);
    } catch (e) {
      try {
        this.recorder = new MediaRecorder(this.outStream);
      } catch (e2) {
        return Promise.reject(new Error('无法启动录制：' + (e2.message || e2.name)));
      }
    }
    if (!this.mime) this.mime = this.recorder.mimeType || (this.audioOnly ? 'audio/webm' : 'video/webm');

    this.recorder.ondataavailable = function (ev) {
      if (!ev.data || !ev.data.size) return;
      var idx = self.chunks++;
      self.parts.push(ev.data);
      self.bytes += ev.data.size;
      self.onChunk(ev.data, idx, self.bytes);
    };
    this.recorder.onerror = function (ev) {
      self.onError(ev && ev.error ? ev.error : new Error('录制中断'));
    };
    this.recorder.onstart = function () { self.onState('recording'); };
    this.recorder.onpause = function () { self.paused = true; self.onState('paused'); };
    this.recorder.onresume = function () { self.paused = false; self.onState('recording'); };

    this.startedAt = performance.now();
    this.running = true;

    try {
      this.recorder.start(1000);
    } catch (e) {
      this.running = false;
      this.startedAt = 0;
      return Promise.reject(new Error('无法启动录制：' + (e.message || e.name || e)));
    }

    if (this.canComposite && !this.audioOnly) this._loop();

    return Promise.resolve(this);
  };

  Recorder.prototype.setZoom = function (z, mode) {
    this.targetZoom = util.clamp(z || 1, 0.5, 3);
    if (mode) this.zoomMode = mode;
  };

  Recorder.prototype.setBoard = function (dataUrl) {
    var self = this;
    if (!dataUrl) { this.board = null; return Promise.resolve(); }
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        self.board = { img: img };
        resolve(img);
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  };

  Recorder.prototype.pause = function () {
    if (this.recorder && this.recorder.state === 'recording') {
      try { this.recorder.pause(); } catch (e) {}
    }
  };

  Recorder.prototype.resume = function () {
    if (this.recorder && this.recorder.state === 'paused') {
      try { this.recorder.resume(); } catch (e) {}
    }
  };

  /**
   * 停止并返回成片
   * @returns {Promise<{blob:Blob, mime:string, duration:number, size:number, chunks:number, composited:boolean}>}
   */
  Recorder.prototype.stop = function () {
    var self = this;
    return new Promise(function (resolve) {
      self.running = false;
      if (self._raf) cancelAnimationFrame(self._raf);
      self.duration = self.startedAt ? (performance.now() - self.startedAt) / 1000 : 0;

      if (!self.recorder) {
        resolve(self._result());
        return;
      }
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        try { self.recorder.onstop = null; } catch (e) {}
        resolve(self._result());
      }
      try {
        self.recorder.onstop = done;
        if (self.recorder.state !== 'inactive') self.recorder.stop();
        else done();
      } catch (e) {
        done();
      }
      setTimeout(done, 1800);   // 兜底，避免 onstop 不触发时卡死
    });
  };

  Recorder.prototype._result = function () {
    var blob = new Blob(this.parts, { type: this.mime || (this.audioOnly ? 'audio/webm' : 'video/webm') });
    return {
      blob: blob,
      mime: this.mime || blob.type,
      duration: this.duration,
      size: blob.size,
      chunks: this.chunks,
      composited: this.canComposite
    };
  };

  Recorder.prototype.discard = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch (e) {}
    this.parts = [];
    this.recorder = null;
  };

  Media.Recorder = Recorder;

  /* ======================================================================
     屏幕常亮：录制时防止手机锁屏
     ====================================================================== */
  Media.keepAwake = function () {
    var sentinel = null;
    function acquire() {
      if (!navigator.wakeLock || !navigator.wakeLock.request) return null;
      return navigator.wakeLock.request('screen').then(function (s) {
        sentinel = s;
        s.addEventListener('release', function () { sentinel = null; });
        return s;
      }).catch(function () { return null; });
    }
    acquire();
    function onVisible() {
      if (document.visibilityState === 'visible' && !sentinel) acquire();
    }
    document.addEventListener('visibilitychange', onVisible);
    return {
      release: function () {
        document.removeEventListener('visibilitychange', onVisible);
        if (sentinel) { try { sentinel.release(); } catch (e) {} sentinel = null; }
      }
    };
  };

})(window);