/* ==========================================================================
   metrics-speech.js — 语音模块的口径层（纯计算，不碰 DOM、不碰网络）
   --------------------------------------------------------------------------
   按《试讲视频分析小程序 · 改造提示词》第六、七节重算四件事：

   1. 语速 = 有效语音段内汉字数 ÷ 有效语音段总时长 × 60
      分母**不是**视频总时长 —— 静默、写板书、学生回答、翻页都不能算进去。
      同时给 30 秒滑窗的语速曲线，曲线跳变超过 60 字/分记一个突变点，带秒数（精细档即帧号）。

   2. 句内停顿只统计「一句话内部」的静默：
      300–500ms 轻微 / 500–1000ms 明显 / >1000ms 严重卡顿。
      句子之间、环节之间的静默是正常换气，单独记数但不计分。

   3. 停顿 ≠ 卡顿：只有「停顿 + 填充词 / 词语重复 / 句子没说完」才叫卡顿。

   4. 填充词单独统计：总次数、每百字密度、按分钟分布、密集片段。
      句末的「呢 / 吧 / 吗 / 啊」是语气助词，不算填充词。

   输入不依赖 ASR 的粒度：只要求 segments 有 t（起点秒）与 text。
   时间分配用「按字数比例」把句子摊到 segment 的时长里，误差在 ±0.3s 量级。
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App || (window.App = {});

  /* 填充词：只在句中出现、且不是句末语气助词时计数 */
  var FILLERS = ['呃', '额', '嗯', '唔', '这个', '那个', '就是说', '然后', '就是', '其实', '反正', '怎么说呢'];
  var TAIL_PARTICLES = /[呢吧吗啊呀嘛哦哈]/;

  /* 提问句特征：有问号，或以疑问词开头/结尾的短句 */
  var ASK_WORDS = /(吗|呢|什么|怎么|为什么|是不是|对不对|好不好|谁|哪里|哪一|多少|想一想|思考一下|有没有)/;

  var CFG = {
    windowSec: 30,          /* 语速曲线滑窗 */
    minSpeechForCurve: 2,   /* 窗口内至少 2 秒有声才给语速点 */
    jumpCpm: 60,            /* 相邻窗口差多少算突变 */
    /* 句内停顿三级（秒） */
    light: 0.3,
    clear: 0.5,
    severe: 1.0,
    /* 语速分档（字/分） */
    bands: [
      { max: 150, label: '偏慢', note: '偏慢，显拖沓或不熟练' },
      { max: 200, label: '偏稳', note: '偏稳，偏保守' },
      { max: 240, label: '正常', note: '正常区间' },
      { max: 280, label: '偏快', note: '偏快，重点处容易听不清' },
      { max: Infinity, label: '过快', note: '过快，需要放慢' }
    ]
  };

  function round1(v) { return Math.round(v * 10) / 10; }

  function charCount(s) {
    if (!s) return 0;
    var m = String(s).replace(/\s+/g, '').match(/[\u4e00-\u9fa5A-Za-z0-9]/g);
    return m ? m.length : 0;
  }

  /* 把一段文字按句末标点切句，同时保留每句在原文里的起止字符位置 */
  function splitSentences(text) {
    var out = [];
    var buf = '';
    var from = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      buf += ch;
      if (ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '!' || ch === '?' || ch === ';') {
        out.push({ text: buf, from: from, to: i + 1 });
        buf = '';
        from = i + 1;
      }
    }
    if (buf.replace(/\s/g, '')) out.push({ text: buf, from: from, to: text.length });
    return out;
  }

  /* 把句子摊到时间轴上：segments 是 {t, text, end?}，end 缺省时按时长推算 */
  function buildSentenceTimeline(segments, duration) {
    var segs = (segments || []).filter(function (s) { return s && s.text; });
    if (!segs.length) return [];

    /* 补 end：用「到下一段起点」的一半估算，最后一段用 duration */
    for (var i = 0; i < segs.length; i++) {
      var next = segs[i + 1];
      var guess = next ? next.t : Math.max(segs[i].t + 1, duration || 0);
      if (segs[i].end == null) {
        var byChars = segs[i].t + Math.max(0.8, charCount(segs[i].text) / 4);
        segs[i].end = Math.min(byChars, guess || byChars);
      }
      if (!(segs[i].end > segs[i].t)) segs[i].end = segs[i].t + 0.8;
    }

    var out = [];
    segs.forEach(function (seg) {
      var span = Math.max(0.3, seg.end - seg.t);
      var total = Math.max(1, charCount(seg.text));
      var parts = splitSentences(seg.text);
      var cursor = seg.t;
      parts.forEach(function (p, idx) {
        var c = charCount(p.text);
        var share = c / total;
        var s = cursor;
        var e = idx === parts.length - 1 ? seg.end : cursor + span * share;
        if (e <= s) e = s + 0.3;
        out.push({
          index: out.length,
          t: round1(s),
          end: round1(e),
          text: p.text.trim(),
          chars: c,
          ask: ASK_WORDS.test(p.text) || /[？?]$/.test(p.text.trim())
        });
        cursor = e;
      });
    });
    return out;
  }

  /* 用静默段反推「某个时间窗口里真正在说话」的秒数 */
  function speechSecondsIn(gaps, from, to, fallbackRatio) {
    var span = Math.max(0, to - from);
    if (!span) return 0;
    if (!gaps || !gaps.length) return span * (fallbackRatio || 1);
    var silent = 0;
    for (var i = 0; i < gaps.length; i++) {
      var g = gaps[i];
      var a = Math.max(from, g.start);
      var b = Math.min(to, g.end);
      if (b > a) silent += (b - a);
    }
    return Math.max(0, span - silent);
  }

  function bandOf(cpm) {
    for (var i = 0; i < CFG.bands.length; i++) if (cpm < CFG.bands[i].max) return CFG.bands[i];
    return CFG.bands[CFG.bands.length - 1];
  }

  /* 填充词：逐句扫描，句末语气助词不算 */
  function scanFillers(sentences) {
    var hits = [];
    sentences.forEach(function (s) {
      var text = s.text;
      var i = 0;
      while (i < text.length) {
        var matched = null;
        for (var k = 0; k < FILLERS.length; k++) {
          var w = FILLERS[k];
          if (text.substr(i, w.length) === w) { matched = w; break; }
        }
        if (!matched) { i++; continue; }
        /* 句末的「呢吧吗啊呀嘛」是语气助词 */
        var after = text.slice(i + matched.length);
        var atEnd = !after || /^[。！？；，、\s]/.test(after);
        if (matched.length === 1 && TAIL_PARTICLES.test(matched) && atEnd) { i += matched.length; continue; }
        /* 「然后」「就是」在句中做连接词时仍算口语填充：这里保守处理，只在句首或逗号后算 */
        if ((matched === '然后' || matched === '就是') && i > 0 && !/[，。！？；、\s]/.test(text[i - 1])) {
          i += matched.length;
          continue;
        }
        /* 「这个函数」「这个区间」「这个条件」是指代，不是口头禅：
           后面紧跟名词时直接跳过，避免把正常的数学表达算成填充词 */
        if (matched === '这个' || matched === '那个') {
          var tail = text.slice(i + matched.length, i + matched.length + 2);
          if (/^(函数|区间|条件|式子|结论|图像|定义|方法|步骤|题目|定理|公式|性质|问题|点|值|数|集合|不等式|方程|变量|参数|结果|答案|过程|思路)/.test(tail)) {
            i += matched.length;
            continue;
          }
        }
        /* 「然后」后面接的是推导动作（代入/得到/我们/再/把），当连接词用，不扣分 */
        if (matched === '然后') {
          var nx = text.slice(i + matched.length, i + matched.length + 3);
          if (/^(我们|把|得到|代入|再|就|看|算|写|可以)/.test(nx)) {
            i += matched.length;
            continue;
          }
        }
        hits.push({ t: s.t, word: matched, sentence: s.index });
        i += matched.length;
      }
    });
    return hits;
  }

  function analyze(input) {
    input = input || {};
    var segments = input.segments || [];
    var audio = input.audio || {};
    var duration = input.duration || 0;
    var gaps = (audio.gaps || []).slice().sort(function (a, b) { return a.start - b.start; });

    var sentences = buildSentenceTimeline(segments, duration);
    var fullText = sentences.map(function (s) { return s.text; }).join('');
    var chars = charCount(fullText);

    /* 逐字稿只覆盖一部分时长时（例如只导入了前两分钟的字幕），语速必须只在
       有字幕的那一段里算——用整段音轨的有声秒数会把它压成假「偏慢」。 */
    var coverFrom = sentences.length ? sentences[0].t : 0;
    var coverTo = sentences.length ? sentences[sentences.length - 1].end : duration;
    var coverSpan = Math.max(0, coverTo - coverFrom);
    var partial = !!(duration > 0 && sentences.length && coverSpan > 0 && coverSpan < duration * 0.8);
    var workFrom = partial ? coverFrom : 0;
    var workSpan = partial ? coverSpan : duration;

    /* 有效语音时长：有音频分析出来的有声秒数就用它（那是实测，最可信）；
       只有字幕覆盖一部分、并且拿得到静默段时，才把分母收窄到那一段里 */
    /* 三种状态必须分清：测到 0 / 测到了多少 / 根本没测到。
       以前用 `speechSeconds > 0` 判断，会把「测到 0 秒」当成「没测」，
       再按 75% 估一个时长出来——那是编数据，不是测量。 */
    var speechSeconds = null;
    var speechState = 'unknown';
    if (typeof audio.speechSeconds === 'number' && isFinite(audio.speechSeconds)) {
      speechSeconds = Math.max(0, audio.speechSeconds);
      speechState = 'measured';
      /* 字幕只覆盖一小段时，分母必须收到那一段里，否则「两分钟的字幕 ÷ 十分钟的有声时间」
         会把语速算成 29 字/分，白白背上「太慢」。仍然只用实测静默段，不估。 */
      if (partial && gaps.length) {
        speechSeconds = Math.max(0, speechSecondsIn(gaps, coverFrom, coverTo, 0));
        speechState = 'measured-window';
      }
    } else if (gaps.length) {
      /* 拿得到静默段就按「除静默外都是讲话」算，这是从音频推出来的实测，不是拍脑袋的 75% */
      speechSeconds = Math.max(0, speechSecondsIn(gaps, workFrom, workSpan + workFrom, 0));
      speechState = 'from-gaps';
    }

    /* 字幕说有内容、音频却说一句都没讲：数据打架，先别给语速结论 */
    var speechConflict = !!(/^measured/.test(speechState) && speechSeconds === 0 && chars > 0);
    var cpm = (!speechConflict && speechSeconds != null && speechSeconds > 1)
      ? chars / speechSeconds * 60
      : null;
    var band = cpm == null ? null : bandOf(cpm);

    /* ---- 句内停顿 ---- */
    var inside = [], outside = [];
    gaps.forEach(function (g) {
      var mid = (g.start + g.end) / 2;
      var host = null;
      for (var i = 0; i < sentences.length; i++) {
        var s = sentences[i];
        if (mid > s.t + 0.05 && mid < s.end - 0.05) { host = s; break; }
      }
      var rec = {
        t: round1(g.start), end: round1(g.end), dur: round1(g.duration || (g.end - g.start)),
        sentence: host ? host.index : -1,
        quote: host ? host.text : ''
      };
      if (!host) { outside.push(rec); return; }
      if (rec.dur < CFG.light) return;                     /* 300ms 以下不记 */
      rec.tier = rec.dur >= CFG.severe ? 'severe' : (rec.dur >= CFG.clear ? 'clear' : 'light');
      /* 停顿≠卡顿：句内停顿且紧邻填充词 / 句子没说完，才算卡顿 */
      var near = scanFillers([sentences[host.index]]).filter(function (f) {
        return Math.abs(f.t - host.t) < 3;
      }).length > 0;
      var unfinished = !/[。！？；!?;]$/.test(host.text.trim());
      rec.stutter = !!(near || unfinished);
      inside.push(rec);
    });

    var sentCount = Math.max(1, sentences.length);
    var sentencesWithPause = {};
    inside.forEach(function (p) { sentencesWithPause[p.sentence] = true; });
    var tiers = { light: 0, clear: 0, severe: 0 };
    inside.forEach(function (p) { tiers[p.tier]++; });

    /* ---- 语速曲线（30s 滑窗） ---- */
    var curve = [];
    /* 窗口只在有逐字稿的那一段里滑：字幕只覆盖两分钟时，不能拿整片去做曲线 */
    var curveFrom = Math.max(0, partial ? Math.floor(coverFrom) : 0);
    var curveTo = partial ? Math.min(duration, Math.ceil(coverTo)) : duration;
    if (curveTo - curveFrom > 5) {
      var fallbackRatio = (curveTo - curveFrom) > 0 ? Math.min(1, speechSeconds / (curveTo - curveFrom)) : 1;
      for (var w = curveFrom; w + CFG.windowSec <= curveTo + 0.001; w += CFG.windowSec) {
        var a = w, b = w + CFG.windowSec;
        var ss = speechSecondsIn(gaps, a, b, fallbackRatio);
        var c = 0;
        sentences.forEach(function (s) {
          var lo = Math.max(a, s.t), hi = Math.min(b, s.end);
          if (hi > lo && s.end > s.t) c += s.chars * ((hi - lo) / (s.end - s.t));
        });
        if (ss < CFG.minSpeechForCurve) {
          curve.push({ t: a, cpm: null, speechSeconds: round1(ss) });
          continue;
        }
        curve.push({ t: a, cpm: Math.round(c / ss * 60), speechSeconds: round1(ss) });
      }
    }

    var jumps = [];
    for (var i = 1; i < curve.length; i++) {
      var p = curve[i - 1], q = curve[i];
      if (p.cpm == null || q.cpm == null) continue;
      var d = q.cpm - p.cpm;
      if (Math.abs(d) >= CFG.jumpCpm) {
        jumps.push({
          t: q.t, from: p.cpm, to: q.cpm, delta: d,
          frame: Math.round(q.t),          /* 精细档是 1fps，帧号≈秒 */
          band: bandOf(q.cpm).label
        });
      }
    }

    /* ---- 讲解语速 / 提问语速 ---- */
    function cpmOf(list) {
      var c = 0, sec = 0;
      list.forEach(function (s) {
        var span = Math.max(0, s.end - s.t);
        c += s.chars;
        sec += span;
      });
      return sec > 1 ? Math.round(c / sec * 60) : 0;
    }
    var explain = sentences.filter(function (s) { return !s.ask; });
    var ask = sentences.filter(function (s) { return s.ask; });

    /* ---- 填充词 ---- */
    var fills = scanFillers(sentences);
    var per100 = chars > 0 ? fills.length / chars * 100 : 0;
    var byWord = {};
    fills.forEach(function (f) { byWord[f.word] = (byWord[f.word] || 0) + 1; });
    var top = Object.keys(byWord).map(function (w) { return { word: w, n: byWord[w] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 5);

    var minuteBuckets = {};
    fills.forEach(function (f) { var m = Math.floor(f.t / 60); minuteBuckets[m] = (minuteBuckets[m] || 0) + 1; });
    var minuteCurve = Object.keys(minuteBuckets).map(function (m) {
      return { t: Number(m) * 60, n: minuteBuckets[m] };
    }).sort(function (a, b) { return a.t - b.t; });

    var denseSpans = [];
    for (var b2 = 0; b2 + 30 <= (duration || 0); b2 += 30) {
      var n = fills.filter(function (f) { return f.t >= b2 && f.t < b2 + 30; }).length;
      if (n >= 3) denseSpans.push({ start: b2, end: b2 + 30, n: n });
    }

    return {
      duration: duration,
      speechSeconds: speechSeconds == null ? null : round1(speechSeconds),
    speechState: speechState,
    speechMeasured: speechState !== 'unknown',
    speechConflict: speechConflict,
      chars: chars,
      /* 逐字稿覆盖到哪儿：语速、曲线、停顿率都只在这个窗口里算 */
      window: {
        from: round1(workFrom),
        to: round1(partial ? coverTo : (duration || coverTo)),
        partial: partial,
        coverRatio: duration > 0 ? round1(Math.min(1, coverSpan / duration)) : 1
      },
      speed: { cpm: Math.round(cpm), band: band.label, note: band.note },
      curve: curve,
      jumps: jumps,
      speedExplain: cpmOf(explain),
      speedAsk: cpmOf(ask),
      askSentences: ask.length,
      sentences: sentences.length,
      pauses: {
        inside: inside,
        outsideCount: outside.length,
        tiers: tiers,
        rate: Math.min(1, Object.keys(sentencesWithPause).length / sentCount),
        perSentence: inside.length / sentCount,
        severe: inside.filter(function (p) { return p.tier === 'severe'; })
      },
      filler: {
        total: fills.length,
        per100: Math.round(per100 * 10) / 10,
        top: top,
        minuteCurve: minuteCurve,
        denseSpans: denseSpans,
        hits: fills
      },
      gapsAll: gaps,
      cfg: CFG
    };
  }

  App.MetricsSpeech = {
    analyze: analyze,
    CFG: CFG,
    /* 供单测直接调 */
    _splitSentences: splitSentences,
    _buildSentenceTimeline: buildSentenceTimeline,
    _charCount: charCount,
    _bandOf: bandOf
  };
})(window);
