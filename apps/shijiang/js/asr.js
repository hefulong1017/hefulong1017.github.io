/* ==========================================================================
   asr.js — 实时语音识别（Web Speech API）+ 文本分析
   · lang zh-CN / continuous / interimResults，每段结果记 { text, t, isFinal }
   · iOS Safari 不支持时抛出结构化错误，由上层降级为纯音频分析（不白屏）
   · 文本分析：语气词词表 + 语境豁免、整句重复、无意义重读、字数统计
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;

  /* ======================================================================
     一、语音识别
     ====================================================================== */
  function ASR(opts) {
    opts = opts || {};
    this.lang = opts.lang || 'zh-CN';
    this.onResult = opts.onResult || function () {};
    this.onPartial = opts.onPartial || function () {};
    this.onError = opts.onError || function () {};
    this.onDegrade = opts.onDegrade || function () {};
    this.onState = opts.onState || function () {};

    this.rec = null;
    this.active = false;
    this.degraded = false;
    this.reason = '';
    this.startedOnce = false;
    this.restarts = 0;
    this.networkErrors = 0;
    this.transcript = [];
    this.interim = '';
    this.t0 = 0;
    this.lastFinalAt = 0;
    this.lastResultAt = 0;
    this.sawFinal = false;
    this.corrected = 0;
    this.noSpeech = 0;
    this.gestureRetries = 0;
    this.captureRetries = 0;
    this.pending = false;
  }

  ASR.isSupported = function () {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  };

  ASR.prototype.now = function () {
    /* t0 用 null 判空：performance.now() 在页面刚加载时可能正好是 0，
       写成 `this.t0 ? ... : 0` 会让整段时间戳全变成 0（评分里的时间码就全错）。 */
    return this.t0 != null ? (performance.now() - this.t0) / 1000 : 0;
  };

  ASR.prototype.start = function () {
    var self = this;
    if (this.active && !this.degraded && !this.pending) return true;
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      this.degraded = true;
      this.onDegrade('unsupported');
      return false;
    }
    if (!this.rec) {
      this.rec = new Ctor();
      this.rec.lang = this.lang;
      this.rec.continuous = true;
      this.rec.interimResults = true;
      this.rec.maxAlternatives = 1;

      this.rec.onresult = function (ev) { self._handleResult(ev); };
      this.rec.onerror = function (ev) { self._handleError(ev); };
      this.rec.onend = function () { self._handleEnd(); };
      this.rec.onstart = function () { self.onState('listening'); };
    }
    /* 上一次是被判死的，重新开始时要把死旗子摘掉，否则 _begin() 立刻 return false */
    this.degraded = false;
    this.reason = '';
    this.pending = false;
    this.captureRetries = 0;
    this.networkErrors = 0;
    this.active = true;
    this.t0 = performance.now();
    this.lastFinalAt = 0;
    return this._begin();
  };

  ASR.prototype._begin = function () {
    if (!this.active || this.degraded) return false;
    try {
      this.rec.start();
      this.startedOnce = true;
      this.pending = false;
      this.reason = '';
      return true;
    } catch (e) {
      // 已经在运行 / 无用户手势
      var name = String(e && e.name);
      if (name === 'InvalidStateError') return true;
      /* iOS 在没有手势的自动重启里会直接抛错：别判死，挂着等用户点一下 */
      if (this.startedOnce) {
        this.reason = 'needs-gesture';
        this.pending = true;
        this.onDegrade('needs-gesture');
        return false;
      }
      /* 第一次就起不来：NotAllowedError 是没给麦克风权限，其余是启动失败 */
      this.degraded = true;
      this.active = false;
      this.reason = (name === 'NotAllowedError' || name === 'SecurityError') ? 'not-allowed' : 'start-failed';
      this.onDegrade(this.reason);
      return false;
    }
  };

  ASR.prototype._handleResult = function (ev) {
    var res = ev.results;
    var interim = '';
    for (var i = ev.resultIndex; i < res.length; i++) {
      var r = res[i];
      var text = (r[0] && r[0].transcript || '').trim();
      if (!text) continue;
      if (r.isFinal) {
        var t = this.now();
        var fixed = (App.text && App.text.correct) ? App.text.correct(text) : text;
        /* 安卓上偶尔会把同一条 final 再抛一次：同一句、一秒多之内，直接丢掉，
           否则报告里的「整句重复」会被识别抖动污染。 */
        var prev = this.transcript[this.transcript.length - 1];
        this.lastResultAt = t;
        if (prev && prev.text === fixed && (t - prev.t) < 1.6) {
          this.lastFinalAt = t;
          this.sawFinal = true;
          this.restarts = 0;
          this.networkErrors = 0;
          this.noSpeech = 0;
          continue;
        }
        if (fixed !== text) this.corrected++;
        this.transcript.push({ t: t, text: fixed, raw: text, isFinal: true });
        this.lastFinalAt = t;
        this.lastResultAt = t;
        this.sawFinal = true;
        this.restarts = 0;
        this.networkErrors = 0;
        this.noSpeech = 0;
        this.onResult({ text: fixed, raw: text, t: t, isFinal: true, transcript: this.transcript });
      } else {
        interim += text;
      }
    }
    // 中间结果也纠错：字幕里不该出现「单挑性」这种错字，哪怕它下一秒还会变
    if (interim && App.text && App.text.correct) interim = App.text.correct(interim);
    this.interim = interim;
    if (interim) {
      this.lastResultAt = this.now();
      var patch = { text: interim, t: this.now(), isFinal: false, transcript: this.transcript };
      this.onPartial(patch);
      this.onResult(patch);
    }
  };

  /** 已经多久没有收到任何识别结果了（秒）
   *  lastResultAt 存的是 now() 的返回值（相对 t0 的秒），所以这里必须用 now() 相减；
   *  之前写成 performance.now() - last（毫秒减秒）会算出极大的数。 */
  ASR.prototype.silentFor = function () {
    if (this.t0 == null) return 0;
    var last = this.lastResultAt || 0;      /* 还没收到任何结果 → 从 0 秒算起 */
    if (!last) return this.now();
    return Math.max(0, this.now() - last);
  };

  ASR.prototype._handleError = function (ev) {
    var code = ev && ev.error ? ev.error : 'unknown';

    // 没有声音不算错误：说完一句话、识别器自动结束，都走这里
    if (code === 'no-speech') {
      this.noSpeech++;
      return;
    }
    if (code === 'aborted') return;

    if (code === 'service-not-allowed') {
      /* iOS 把「设置 → 通用 → 键盘 → 启用听写」关掉时就是这个错，跟麦克风权限无关。
         一条字都没识别出来过 → 基本可以断定是听写没开；已经识别出内容了 → 是自动重启
         没拿到手势，挂起等用户点一下就好，别把「听写没开」的错误提示张冠李戴。 */
      if (!this.transcript.length) {
        this.degraded = true;
        this.reason = 'service-off';
        this.active = false;
        this.onDegrade('service-off');
        return;
      }
      this.reason = 'needs-gesture';
      this.pending = true;
      this.onDegrade('needs-gesture');
      return;
    }

    if (code === 'not-allowed') {
      /* iOS 只允许在「用户手势」里启动识别：静默的自动重启会被拒。
         只要之前成功过就不算降级——挂起，等用户点一下「重试识别」。 */
      if (this.startedOnce) {
        this.reason = 'needs-gesture';
        this.pending = true;
        this.onDegrade('needs-gesture');
        return;
      }
      this.degraded = true;
      this.reason = 'not-allowed';
      this.active = false;
      this.onDegrade('not-allowed');
      return;
    }

    if (code === 'audio-capture') {
      /* 麦克风可能被别的标签页占着，等一秒再试，别一次就判死 */
      if (this.captureRetries < 3) {
        this.captureRetries++;
        var selfCap = this;
        setTimeout(function () {
          if (selfCap.active && !selfCap.degraded) selfCap._begin();
        }, 900);
        this.onError('audio-capture');
        return;
      }
      this.degraded = true;
      this.reason = 'no-mic';
      this.active = false;
      this.onDegrade('no-mic');
      return;
    }

    // 网络类：国内直连 Google 语音服务常常失败，但不是每次都会失败，
    // 所以先重试若干次，真起不来再降级，别第一次就放弃。
    if (code === 'network') {
      this.networkErrors++;
      this.onError('network');
      if (this.networkErrors >= 4) {
        this.degraded = true;
        this.reason = 'network';
        this.active = false;
        this.onDegrade('network');
      }
      return;
    }

    this.onError(code);
  };

  ASR.prototype._handleEnd = function () {
    var self = this;
    this.onState('end');
    if (!this.active || this.degraded) return;
    /* 挂起等手势时不能再自动重启：iOS 上 onerror 之后还常跟一个 onend，
       如果这里照常 200ms 重来一次，就会变成「抛错→挂起→onend→再抛」的死循环，
       一秒好几次地去撞系统接口。等用户点，或者等 9 秒的 retryPending。 */
    if (this.pending) return;
    if (this.restarts > 240) {
      this.degraded = true;
      this.reason = 'restart-limit';
      this.onDegrade('restart-limit');
      return;
    }
    this.restarts++;
    // 网络抖动时退避久一点，正常静音时立刻续上
    var delay = this.networkErrors ? Math.min(1600, 300 + this.networkErrors * 400) : 200;
    setTimeout(function () {
      if (!self.active || self.degraded) return;
      self._begin();
    }, delay);
  };

  /** 定时器里悄悄再试一次（不消耗用户手势，失败就继续挂着） */
  ASR.prototype.retryPending = function () {
    if (!this.pending) return false;
    this.pending = false;
    this.degraded = false;
    this.active = true;
    var ok = this._begin();
    if (ok) this.onState('listening');
    return ok;
  };

  /** 用户在页面上点一下之后调用：把手势续上，继续识别 */
  ASR.prototype.resume = function () {
    if (this.degraded) {
      this.degraded = false;
      this.reason = '';
    }
    this.pending = false;
    this.active = true;
    this.captureRetries = 0;
    this.networkErrors = 0;
    var ok = this._begin();
    if (ok) this.onState('listening');
    return ok;
  };

  ASR.prototype.stop = function () {
    this.active = false;
    if (this.rec) {
      try { this.rec.onend = null; this.rec.stop(); } catch (e) {}
      try { this.rec.onerror = null; } catch (e) {}
      try { this.rec.onresult = null; } catch (e) {}
      this.rec = null;
    }
  };

  ASR.prototype.fullText = function () {
    return this.transcript.map(function (s) { return s.text; }).join('');
  };

  App.ASR = ASR;

  /* ======================================================================
     二、文本分析
     ====================================================================== */
  var FILLERS = ['怎么说呢', '这个', '那个', '然后', '就是', '对吧', '那么',
                 '其实', '反正', '的话', '是不是', '对不对', '好不好',
                 '那', '呢', '吧', '嘛', '嗯', '啊', '呃', '额'];

  // 「然后 / 那么」用于正当逻辑连接时不计数
  var CONNECTIVES = ['然后', '那么'];

  /* 「那 / 呢」是教师口语里最高频的两个口头禅，但不能见一个算一个：
     「那时候」「哪些」「什么呢」是正常用词。
     判据：那——必须在分句开头，且后面不是时间/方位/指量词；
           呢——必须不是疑问词「什么呢」的一部分，也不是「呢绒」这类实词。 */
  var NA_TAIL = /^(时|候|里|些|个|么|边|样|种|会|次|天|晚|阵|段|点|本|把|位|名|家|件|条|句|门|节|段儿)/;
  var NE_PREV = /(什么|怎么|哪|谁|为啥|这是|那是)$/;
  var NE_TAIL = /^(绒|子|喃)/;

  function habitOK(word, clause, idx) {
    var before = clause.slice(0, idx);
    var after = clause.slice(idx + word.length);
    if (word === '那') {
      if (before.trim() !== '') return false;      // 只在分句开头
      if (NA_TAIL.test(after)) return false;       // 那时候 / 那些 / 那么
      return true;
    }
    if (word === '呢') {
      if (NE_PREV.test(before)) return false;      // 什么呢 / 怎么呢
      if (NE_TAIL.test(after)) return false;       // 呢绒
      return true;
    }
    if (word === '吧' && /^(台|巴|吧台)$/.test(after)) return false;
    return true;
  }

  var text = App.text = {
    FILLERS: FILLERS,

    /** 规范化：全角转半角、去零宽字符、压缩空白 */
    normalize: function (s) {
      return String(s || '')
        .replace(/[\u200b-\u200f\ufeff]/g, '')
        .replace(/\u3000/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },

    /** 有效字数：汉字 + 字母 + 数字（标点、空格不计） */
    charCount: function (s) {
      var m = String(s || '').match(/[\u4e00-\u9fa5a-zA-Z0-9α-ωΑ-Ω]/g);
      return m ? m.length : 0;
    },

    /** 切句：按中文句末标点与换行 */
    sentences: function (s) {
      return String(s || '')
        .split(/(?<=[。！？!?；;])|\n+/)
        .map(function (x) { return x.trim(); })
        .filter(function (x) { return text.charCount(x) >= 2; });
    },

    /** 切分句（含逗号），用于语气词语境判断 */
    clauses: function (s) {
      return String(s || '')
        .split(/[，,。！？!?；;、\n]+/)
        .map(function (x) { return x.trim(); })
        .filter(Boolean);
    },

    /** 是否属于正当逻辑连接：句首 + 后接完整分句（≥6 字且不是以虚词结尾的碎句） */
    isLegitConnective: function (clause, word, at) {
      if (CONNECTIVES.indexOf(word) === -1) return false;
      var before = clause.slice(0, at).trim();
      if (before.length > 0) return false;              // 不在分句开头
      var after = clause.slice(at + word.length).trim();
      if (text.charCount(after) < 6) return false;      // 后面不成句
      return true;
    },

    /**
     * 语气词统计
     * @param {string} str
     * @param {function(number):number} timeAt 字符下标 → 秒
     */
    fillers: function (str, timeAt) {
      str = String(str || '');
      var found = [];
      // 长的先匹配，避免"怎么说呢"被拆成"说"
      var sorted = FILLERS.slice().sort(function (a, b) { return b.length - a.length; });
      var consumed = [];

      function overlap(i, len) {
        for (var k = 0; k < consumed.length; k++) {
          var c = consumed[k];
          if (i < c[0] + c[1] && i + len > c[0]) return true;
        }
        return false;
      }

      // 先定位分句边界，便于判断句首
      var bounds = [];
      var re = /[，,。！？!?；;、\n]+/g, m;
      var last = 0;
      while ((m = re.exec(str)) !== null) {
        bounds.push([last, m.index]);
        last = m.index + m[0].length;
      }
      bounds.push([last, str.length]);

      bounds.forEach(function (b) {
        var clause = str.slice(b[0], b[1]);
        sorted.forEach(function (w) {
          var from = 0, idx;
          while ((idx = clause.indexOf(w, from)) !== -1) {
            var abs = b[0] + idx;
            var ok = habitOK(w, clause, idx);
            if (!ok) { from = idx + w.length; continue; }
            if (!overlap(abs, w.length)) {
              var clauseStart = idx === 0 || /^[\s，,。]/.test(clause.slice(0, idx)) && clause.slice(0, idx).trim() === '';
              var atStart = clause.slice(0, idx).trim() === '';
              var legit = (CONNECTIVES.indexOf(w) > -1) && atStart && text.isLegitConnective(clause, w, idx);
              consumed.push([abs, w.length]);
              found.push({
                word: w,
                index: abs,
                at: timeAt ? timeAt(abs) : 0,
                clause: clause,
                counted: !legit,
                exempt: legit
              });
            }
            from = idx + w.length;
          }
        });
      });

      found.sort(function (a, b) { return a.index - b.index; });
      return found;
    },

    /** 口头禅逐项：每个词出现几次、每千字多少、举三处原话 */
    habits: function (str, timeAt) {
      str = String(str || '');
      var list = text.fillers(str, timeAt).filter(function (f) { return f.counted; });
      var chars = Math.max(1, text.charCount(str));
      var by = {};
      list.forEach(function (f) {
        var o = by[f.word] || (by[f.word] = { word: f.word, n: 0, at: [], samples: [] });
        o.n++;
        if (o.samples.length < 3) o.samples.push(f.clause.trim());
      });
      return Object.keys(by).map(function (w) {
        var o = by[w];
        o.per100 = Math.round(o.n / chars * 100 * 10) / 10;
        return o;
      }).sort(function (a, b) { return b.n - a.n; });
    },

    /** 「那……呢……」句式：一个短句里前后挂着那和呢，是教师口语最典型的模板句 */
    frames: function (str) {
      var out = [];
      text.sentences(str).forEach(function (s) {
        var m = /那([^。！？]{0,18}?)呢/.exec(s);
        if (m) out.push({ sentence: s.trim(), middle: m[1] });
      });
      return out;
    },

    /** 编辑距离相似度 0–1 */
    similarity: function (a, b) {
      a = String(a || ''); b = String(b || '');
      if (!a.length || !b.length) return 0;
      var m = a.length, n = b.length;
      if (m > 220 || n > 220) {           // 长句降级为字符集合相似度，避免 O(mn) 过大
        var setA = {}, setB = {}, inter = 0, i;
        for (i = 0; i < m; i++) setA[a[i]] = (setA[a[i]] || 0) + 1;
        for (i = 0; i < n; i++) setB[b[i]] = (setB[b[i]] || 0) + 1;
        Object.keys(setA).forEach(function (c) { if (setB[c]) inter += Math.min(setA[c], setB[c]); });
        return (2 * inter) / (m + n);
      }
      var prev = new Array(n + 1), cur = new Array(n + 1), j;
      for (j = 0; j <= n; j++) prev[j] = j;
      for (i = 1; i <= m; i++) {
        cur[0] = i;
        for (j = 1; j <= n; j++) {
          var cost = a[i - 1] === b[j - 1] ? 0 : 1;
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        var tmp = prev; prev = cur; cur = tmp;
      }
      var dist = prev[n];
      return 1 - dist / Math.max(m, n);
    },

    /** 连续两句相似度 > 0.85 → 整句重复 */
    repeatedSentences: function (sentences, times) {
      var out = [];
      for (var i = 1; i < sentences.length; i++) {
        var sim = text.similarity(sentences[i - 1], sentences[i]);
        if (sim > 0.85) {
          out.push({ at: times[i] || 0, sim: sim, a: sentences[i - 1], b: sentences[i] });
        }
      }
      return out;
    },

    /** 无意义重读：同一个词（2–4 字）连续出现 ≥2 次 */
    wordRepeats: function (str, timeAt) {
      var out = [];
      var re = /([\u4e00-\u9fa5]{2,4})\1+/g, m;
      while ((m = re.exec(str)) !== null) {
        out.push({ word: m[1], at: timeAt ? timeAt(m.index) : 0, times: m[0].length / m[1].length });
      }
      return out;
    },

    /**
     * 把纯文本映射到时间：用 ASR 的 final 片段做插值
     * @returns {{fullText:string, timeAt:function, units:Array}}
     */
    buildTimeline: function (segments, duration) {
      var units = [], full = [];
      var offset = 0;
      (segments || []).forEach(function (s, i) {
        var t = text.normalize(s.text);
        if (!t) return;
        units.push({ start: offset, end: offset + t.length, t: s.t, i: i });
        full.push(t);
        offset += t.length;
      });
      var fullText = full.join('');

      function timeAt(idx) {
        if (!units.length) return 0;
        if (idx <= 0) return units[0].t;
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (idx >= u.start && idx < u.end) {
            var next = units[i + 1];
            var span = next ? Math.max(0.4, next.t - u.t) : Math.max(0.8, text.charCount(fullText.slice(u.start, u.end)) / 3.6);
            var ratio = (u.end - u.start) ? (idx - u.start) / (u.end - u.start) : 0;
            return u.t + span * util.clamp(ratio, 0, 1);
          }
        }
        var lastU = units[units.length - 1];
        return Math.min(duration || lastU.t + 2, lastU.t + Math.max(1, (idx - lastU.end) / 4));
      }

      return { fullText: fullText, timeAt: timeAt, units: units };
    },

    /** 各句起点时间 */
    sentenceTimes: function (sentences, fullText, timeAt) {
      var out = [], cursor = 0;
      sentences.forEach(function (s) {
        var idx = fullText.indexOf(s, cursor);
        if (idx < 0) idx = cursor;
        out.push(timeAt(idx));
        cursor = Math.max(cursor, idx + s.length);
      });
      return out;
    }
  };

  /* ======================================================================
     三、语音纠错
     识别引擎会按发音给你字，数学课上错得很有规律：
     「单调性」被听成「单挑性」，「函数」被听成「函授」，
     「增函数」被听成「真函数」。这里按高中数学的常用词表做替换。
     ====================================================================== */
  // 只写「错的 → 对的」。相同的写法不用写，写了也会被丢掉。
  var TERMS = [
    /* 函数与单调性 */
    ['函授', '函数'], ['韩数', '函数'], ['寒数', '函数'], ['含数', '函数'],
    ['单挑', '单调'], ['单吊', '单调'], ['单调函授', '单调函数'],
    ['真函数', '增函数'], ['曾函数', '增函数'], ['增函授', '增函数'],
    ['减函授', '减函数'], ['剪函数', '减函数'], ['建函数', '减函数'],
    ['其函数', '奇函数'], ['奇函授', '奇函数'], ['偶函授', '偶函数'],
    ['定意域', '定义域'], ['定语域', '定义域'], ['丁义域', '定义域'], ['定义玉', '定义域'],
    ['直域', '值域'], ['之余', '值域'], ['值玉', '值域'],
    ['气间', '区间'], ['区箭', '区间'], ['曲间', '区间'], ['去间', '区间'],
    ['对阵轴', '对称轴'], ['对趁轴', '对称轴'], ['对趁', '对称'],
    /* 导数 */
    ['导函授', '导函数'], ['倒函数', '导函数'],
    ['求倒', '求导'], ['导述', '导数'],
    ['极值电', '极值点'], ['极致点', '极值点'], ['机制点', '极值点'],
    ['最直', '最值'], ['最大直', '最大值'], ['最小直', '最小值'],
    /* 不等式与方程 */
    ['不等事', '不等式'], ['不等试', '不等式'], ['不的式', '不等式'],
    ['横成立', '恒成立'], ['很成立', '恒成立'], ['衡成立', '恒成立'],
    ['判别是', '判别式'], ['判定式', '判别式'], ['判别试', '判别式'],
    ['维达定理', '韦达定理'], ['违达定理', '韦达定理'], ['伟大定理', '韦达定理'],
    ['因式分解', '因式分解'], ['换言法', '换元法'], ['换员法', '换元法'],
    /* 数列 */
    ['等差说列', '等差数列'], ['等比说列', '等比数列'],
    ['等差数例', '等差数列'], ['等比数例', '等比数列'],
    ['通相', '通项'], ['通相公式', '通项公式'], ['通向公式', '通项公式'],
    ['前N项和', '前n项和'], ['前恩项和', '前n项和'],
    /* 三角 */
    ['挣钱', '正弦'], ['于弦', '余弦'], ['正切函授', '正切函数'],
    ['三角函授', '三角函数'], ['二倍角', '二倍角'],
    ['正弦地理', '正弦定理'], ['余玄定理', '余弦定理'],
    /* 几何 */
    ['做标系', '坐标系'], ['坐表系', '坐标系'], ['坐标细', '坐标系'],
    ['平面直角做标系', '平面直角坐标系'], ['空间直角做标系', '空间直角坐标系'],
    ['投影项链', '投影向量'], ['法相量', '法向量'], ['发向量', '法向量'],
    ['直角三角行', '直角三角形'], ['平行四边行', '平行四边形'],
    ['圆追', '圆锥'], ['原著', '圆柱'], ['球体', '球体'],
    ['相切', '相切'], ['中垂线', '中垂线'],
    /* 概率统计 */
    ['概律', '概率'], ['概绿', '概率'],
    ['期望值', '期望值'], ['方叉', '方差'], ['标准叉', '标准差'],
    ['回规', '回归'], ['散点图', '散点图'],
    /* 通用 */
    ['周其', '周期'], ['周期性', '周期性'],
    ['指数函授', '指数函数'], ['对数函授', '对数函数'],
    ['幂函授', '幂函数'], ['反函授', '反函数'],
    ['选秀', '选修'], ['必修一', '必修一'],
    ['性质', '性质'], ['图像', '图像'],
    ['解系', '解析'], ['解西', '解析']
  ];

  // 只做「整词」替换，避免把正确的字也改掉
  var TERM_MAP = (function () {
    var m = {};
    TERMS.forEach(function (pair) {
      if (pair[0] !== pair[1]) m[pair[0]] = pair[1];
    });
    return m;
  })();

  var TERM_KEYS = Object.keys(TERM_MAP).sort(function (a, b) { return b.length - a.length; });

  text.correct = function (s) {
    if (!s) return '';
    var out = String(s);

    // 1) 术语替换（长词优先）
    for (var i = 0; i < TERM_KEYS.length; i++) {
      var k = TERM_KEYS[i];
      if (out.indexOf(k) >= 0) out = out.split(k).join(TERM_MAP[k]);
    }

    // 2) 同一句里连着重复的字词，多半是识别抖动：「xxx 的 的」
    out = out.replace(/([\u4e00-\u9fa5]{1,3})\1{2,}/g, '$1');

    // 3) 句末补标点，方便后面切句
    out = out.replace(/\s+/g, '');
    if (out && !/[，。！？；、,.!?;]$/.test(out)) out += '。';

    // 4) 收尾：连续的标点只留一个
    out = out.replace(/([，。！？；])\1+/g, '$1');
    out = out.replace(/^[，。；]+/, '');

    return out;
  };

  /* 同 correct()，但顺便告诉你改了哪几处，报告里要用 */
  text.correctInfo = function (s) {
    var fixes = [];
    var out = String(s || '');
    for (var i = 0; i < TERM_KEYS.length; i++) {
      var k = TERM_KEYS[i];
      if (out.indexOf(k) >= 0) {
        var n = out.split(k).length - 1;
        out = out.split(k).join(TERM_MAP[k]);
        fixes.push({ from: k, to: TERM_MAP[k], n: n });
      }
    }
    return { text: text.correct(s), fixes: fixes };
  };

  /* ----------------------------------------------------------------------
     导入字幕：SRT / VTT / 带时间戳的 TXT
     浏览器自带的实时识别只能边录边转，不能给一个视频文件做转写，
     所以上传的录像允许带一份字幕——这份字幕就是「真实原话」，不会编造。
     ---------------------------------------------------------------------- */
  function hmsToSec(h, m, s, ms) {
    return (+h) * 3600 + (+m) * 60 + (+s) + (ms ? (+ms) / 1000 : 0);
  }

  text.parseSubtitles = function (raw) {
    var src = String(raw || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    var segs = [];
    var hasTime = false;

    /* 1) SRT / VTT：时间行后面跟着若干行文本 */
    var blocks = src.split(/\n\s*\n/);
    blocks.forEach(function (block) {
      var lines = block.split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!lines.length) return;
      var ti = -1;
      for (var i = 0; i < lines.length; i++) {
        if (/-->/.test(lines[i])) { ti = i; break; }
      }
      if (ti < 0) return;
      var m = lines[ti].match(/(\d{1,2}):(\d{2}):(\d{2})[,.]?(\d{1,3})?\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.]?(\d{1,3})?/);
      if (!m) return;
      var body = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (!body) return;
      hasTime = true;
      segs.push({
        start: hmsToSec(m[1], m[2], m[3], m[4]),
        end: hmsToSec(m[5], m[6], m[7], m[8]),
        text: body
      });
    });

    /* 2) 带 [mm:ss] / 00:12 前缀的 TXT */
    if (!segs.length) {
      var cur = null;
      src.split('\n').forEach(function (line) {
        var mm = line.match(/^\s*\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(.+)$/);
        if (mm) {
          if (cur) segs.push(cur);
          var t0 = mm[3] != null ? (+mm[1]) * 3600 + (+mm[2]) * 60 + (+mm[3])
            : (+mm[1]) * 60 + (+mm[2]);
          cur = { start: t0, end: t0, text: mm[4].trim() };
          hasTime = true;
        } else if (cur && line.trim()) {
          cur.text += ' ' + line.trim();
        }
      });
      if (cur) segs.push(cur);
    }

    /* 3) 纯文本：只有稿子、没有时间戳。承认它没有时间信息 */
    if (!segs.length) {
      var plain = src.replace(/\s+/g, ' ').trim();
      if (!plain) return { segments: [], timed: false };
      segs.push({ start: 0, end: 0, text: plain });
    }

    var out = [];
    segs.forEach(function (s, i) {
      var fixed = text.correct(s.text);
      var body = fixed.trim();
      if (!body) return;
      out.push({
        id: 'sub-' + (out.length + 1),
        start: Math.round(s.start * 10) / 10,
        end: Math.round(s.end * 10) / 10,
        speaker: 'teacher',
        rawText: s.text.trim(),
        correctedText: body,
        confidence: hasTime ? 'high' : 'low'
      });
    });
    return { segments: out, timed: hasTime };
  };

})(window);