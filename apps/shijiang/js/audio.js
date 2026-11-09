/* ==========================================================================
   audio.js — 音频兜底分析（不依赖 ASR）
   AnalyserNode(fftSize: 2048) 每 50ms 取 getByteTimeDomainData 计算 RMS：
     · RMS < 自适应阈值（前 10 秒环境噪声 × 1.6）→ 静音帧
     · 连续静音 ≥ 1.2s → 一次停顿；> 5s → 长停顿
     · 0.8–1.2s 的静音 → 句中异常卡顿（供「语气流畅性」使用）
     · 有声帧能量峰值 → 音节估计（ASR 不可用时估算语速）
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;

  var FRAME_MS = 50;
  var FRAME_S = FRAME_MS / 1000;

  function AudioMonitor(stream, opts) {
    opts = opts || {};
    this.stream = stream;
    this.fftSize = opts.fftSize || 2048;
    this.ctx = null;
    this.analyser = null;
    this.buf = null;
    this.timer = null;
    this.running = false;

    this.startedAt = 0;
    this.elapsed = 0;

    this.calib = [];
    this.noiseFloor = 0.012;
    this.threshold = 0.012;

    this.inSilence = false;
    this.silenceStart = 0;
    this.silenceFrames = 0;

    this.stats = {
      frames: 0,
      silentFrames: 0,
      speechFrames: 0,
      speechSeconds: 0,
      silenceSeconds: 0,
      rmsSum: 0,
      rmsSqSum: 0,
      rmsCount: 0,
      peaks: 0,
      lastRms: 0,
      lastAbove: false,
      maxRms: 0
    };
    this.pauses = [];      // 完整停顿 { start, end, duration, long }
    this.microPauses = []; // 句中卡顿 0.8–1.2s
    this.wave = [];        // 最近 120 帧电平，用于波形条
    this._subs = [];
  }

  AudioMonitor.isSupported = function () {
    return !!(window.AudioContext || window.webkitAudioContext);
  };

  AudioMonitor.prototype.start = function () {
    var self = this;
    if (this.running) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('浏览器不支持 Web Audio，无法进行音频分析');

    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
    var src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);

    this.buf = new Uint8Array(this.analyser.fftSize);
    this.startedAt = performance.now();
    this.elapsed = 0;
    this.running = true;

    this.timer = setInterval(function () { self._tick(); }, FRAME_MS);
  };

  AudioMonitor.prototype._tick = function () {
    if (!this.running) return;
    var now = performance.now();
    var t = (now - this.startedAt) / 1000;

    this.analyser.getByteTimeDomainData(this.buf);
    var len = this.buf.length;
    var sum = 0;
    for (var i = 0; i < len; i++) {
      var v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / len);

    // 前 10 秒根据环境噪声校准阈值；取最低 30% 分位的均值，避免用户先说话把阈值抬高
    if (t < 10) {
      this.calib.push(rms);
      if (this.calib.length >= 20) this._recalibrate();
    }

    var silent = rms < this.threshold;
    var st = this.stats;
    st.frames++;
    st.lastRms = rms;
    if (rms > st.maxRms) st.maxRms = rms;

    if (silent) {
      st.silentFrames++;
      if (!this.inSilence) { this.inSilence = true; this.silenceStart = t; }
      this.silenceFrames++;
    } else {
      st.speechFrames++;
      st.speechSeconds += FRAME_S;
      st.rmsSum += rms;
      st.rmsSqSum += rms * rms;
      st.rmsCount++;

      // 音节峰值检测（能量上升沿）
      if (!st.lastAbove && rms > this.threshold * 1.6) st.peaks++;

      if (this.inSilence) {
        var dur = t - this.silenceStart;
        this._classifySilence(this.silenceStart, t, dur);
        this.inSilence = false;
        this.silenceFrames = 0;
      }
    }

    if (silent) st.silenceSeconds += FRAME_S;

    // 记录本帧是否处于"有声"，供下一帧做上升沿判断
    st.lastAbove = !silent && rms > this.threshold * 1.6;

    // 波形缓冲（最近 120 帧 = 6 秒）
    this.wave.push(rms);
    if (this.wave.length > 120) this.wave.shift();

    this.elapsed = t;
    for (var k = 0; k < this._subs.length; k++) {
      try { this._subs[k]({ t: t, rms: rms, silent: silent, threshold: this.threshold }); }
      catch (e) { /* ignore */ }
    }
  };

  AudioMonitor.prototype._recalibrate = function () {
    var arr = this.calib.slice().sort(function (a, b) { return a - b; });
    var n = Math.max(1, Math.floor(arr.length * 0.3));
    var sum = 0;
    for (var i = 0; i < n; i++) sum += arr[i];
    var floor = sum / n;
    // 房间底噪通常在 0.002–0.02；留一点下限防止全静音房间把阈值压得过低
    this.noiseFloor = Math.max(floor, 0.0015);
    this.threshold = util.clamp(this.noiseFloor * 1.6, 0.008, 0.06);
  };

  AudioMonitor.prototype._classifySilence = function (start, end, dur) {
    if (dur >= 5) {
      this.pauses.push({ start: start, end: end, duration: dur, long: true });
    } else if (dur >= 1.2) {
      this.pauses.push({ start: start, end: end, duration: dur, long: false });
    } else if (dur >= 0.8) {
      this.microPauses.push({ start: start, end: end, duration: dur });
    }
  };

  AudioMonitor.prototype.on = function (fn) { this._subs.push(fn); };

  AudioMonitor.prototype.level = function () {
    return this.stats.lastRms;
  };

  AudioMonitor.prototype.normalizedLevel = function () {
    var l = this.stats.lastRms;
    var ref = Math.max(this.threshold * 4, 0.12);
    return util.clamp(l / ref, 0, 1);
  };

  AudioMonitor.prototype.stop = function () {
    if (!this.running) return this.snapshot();
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;

    if (this.inSilence) {
      var end = this.elapsed;
      var dur = end - this.silenceStart;
      this._classifySilence(this.silenceStart, end, dur);
      this.inSilence = false;
    }

    try { if (this.ctx && this.ctx.state !== 'closed') this.ctx.close(); } catch (e) {}
    this.ctx = null;
    return this.snapshot();
  };

  AudioMonitor.prototype.snapshot = function () {
    var st = this.stats;
    var mean = st.rmsCount ? st.rmsSum / st.rmsCount : 0;
    var variance = st.rmsCount ? Math.max(0, st.rmsSqSum / st.rmsCount - mean * mean) : 0;
    var std = Math.sqrt(variance);
    var cv = mean > 0 ? std / mean : 0;

    return {
      duration: this.elapsed,
      noiseFloor: this.noiseFloor,
      threshold: this.threshold,
      speechSeconds: st.speechSeconds,
      silenceSeconds: st.silenceSeconds,
      speechFrames: st.speechFrames,
      silentFrames: st.silentFrames,
      pauses: this.pauses.slice(),
      microPauses: this.microPauses.slice(),
      pauseCount: this.pauses.length,
      longPauseCount: this.pauses.filter(function (p) { return p.long; }).length,
      rmsMean: mean,
      rmsStd: std,
      volumeCV: cv,
      maxRms: st.maxRms,
      peaks: st.peaks,
      /** ASR 不可用时的估算字数：汉语普通话约 4 音节/秒 ≈ 4 字/秒 */
      estimatedChars: Math.round(st.peaks * 0.96)
    };
  };

  App.AudioMonitor = AudioMonitor;

})(window);