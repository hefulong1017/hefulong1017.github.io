/* ============================================================================
   theory.js —— 理论错误三层校验
   ----------------------------------------------------------------------------
   三条硬规矩（这一版重写时定下的，改代码前先读这段）：

   1. 字面规则只产出「候选」，不直接定罪。
      正则命中只说明「这句话里有这个字面组合」，不说明用户讲错了。
      否定（不一定 / 并不是 / 不能说）、引用反例、反问、先错后纠正，
      都会让同一串字变成正确表达。所以命中后一律先过语境检查，
      语境没核实的一律 pending=true，不扣分、不封顶。

   2. 引用必须落在真正命中的那一段。
      逐字稿是「多段拼接」的，拼接时补的句号也让字符位置整体后移。
      flatten() 里保证 map.length === text.length，命中位置用 exec 的 index，
      不用 replace 回调的 offset（回调参数个数随捕获组数量变化，极易错位）。

   3. 规则置信度是「人工设定的规则可靠度」，不是识别准确率。
      界面上只说「高/中/低」，不写 0.9/0.92 这种像是测出来的数字。
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App = window.App || {};

  /* 规则版本：改规则就升这个号，旧报告按旧版本展示，不静默改分 */
  var RULE_VERSION = 'theory-2';

  /* ---------------- 第一层：术语与固定搭配 ---------------- */
  var TERMS = [
    { bad: /函授(的)?(单调性|性质|图像|定义域)/g, good: '函数', type: 'asr', why: '「函数」被识别成「函授」' },
    { bad: /单挑(性|区间|递增|递减)/g, good: '单调', type: 'asr', why: '「单调」被识别成「单挑」' },
    { bad: /真函数/g, good: '增函数', type: 'asr', why: '「增函数」被识别成「真函数」' },
    { bad: /正压柱|正压体|正压锥/g, good: '正棱柱 / 正棱锥', type: 'concept', why: '「棱」念成「压」，学生听不出来是什么几何体' },
    { bad: /圆函数/g, good: '余弦函数（或原名）', type: 'concept', why: '三角函数里没有「圆函数」这个说法' },
    /* 只有真正说错的版本才匹配：「学高为师」不是这句，「行为示范」也不是 */
    { bad: /学高为师.{0,6}行为世范/g, good: '学为人师，行为世范', type: 'quote', why: '前半句常被说成「学高为师」' },
    { bad: /学为人师.{0,6}行为示范/g, good: '学为人师，行为世范', type: 'quote', why: '「世范」常被说成「示范」' },
    { bad: /立德树仁/g, good: '立德树人', type: 'quote', why: '固定说法是「立德树人」' }
  ];

  /* 断言类：必须先命中「绝对化 + 错误结论」，再排除语境。
     bad 里不允许出现「正确的说法」——正确说法出现了也不能算错。 */
  var CLAIMS = [
    {
      key: 'period',
      bad: /(一定|肯定|必然|必定|都)存在最小正周期/g,
      /* 「不一定存在」「不是一定存在」都是对的 */
      guard: function (m, text, at) {
        var before = text.slice(Math.max(0, at - 6), at);
        if (/[不没未非]\s*$/.test(before)) return false;          /* 不｜没有｜未必 */
        if (/并不$|并不是$|并不能$|不能说$/.test(before)) return false;
        if (/[吗么]\s*[？?]?\s*$/.test(text.slice(at + m.length, at + m.length + 3))) return false;  /* 反问 */
        return true;
      },
      good: '周期函数不一定有最小正周期（常数函数就没有）',
      why: '把「有周期」说成了「一定有最小正周期」',
      level: 'high'
    },
    {
      key: 'cos-odd',
      bad: /余弦(函数)?(是|为)奇函数/g,
      /* 「并不是余弦…而是正弦…」「余弦不是奇函数」都对 */
      guard: function (m, text, at) {
        var before = text.slice(Math.max(0, at - 8), at);
        if (/[不非]\s*$|不是$|并不是$|并非$|不能说$/.test(before)) return false;
        var after = text.slice(at + m.length, at + m.length + 16);
        if (/^(吗|么|？|\?)/.test(after)) return false;
        /* 同句里如果同时给出「正弦是奇函数」这种对比，说明是在讲区别 */
        var sent = sentenceAround(text, at);
        if (/正弦.{0,6}(是|为)奇函数/.test(sent) && /(而|但|其实)/.test(sent)) return false;
        return true;
      },
      good: '正弦函数是奇函数，余弦函数是偶函数',
      why: '余弦是偶函数，说成奇函数就是把两个说反了',
      level: 'high'
    },
    {
      key: 'tan-domain',
      bad: /正切(函数)?[^。；！？\n]{0,12}?定义域[^。；！？\n]{0,12}?(全体实数|R(?![a-zA-Z]))/g,
      /* 只要句子里出现了「不等于 π/2 + kπ」这类正确限定，就不是错 */
      guard: function (m, text, at) {
        var sent = sentenceAround(text, at);
        if (/不等于|≠|π\/2|π\/2|kπ|kπ/.test(sent)) return false;
        if (/[不非]\s*$|不是$/.test(text.slice(Math.max(0, at - 8), at))) return false;
        return true;
      },
      good: '正切函数的定义域是 {x | x ≠ π/2 + kπ}',
      why: '正切在 π/2 处没有定义，不能说定义域是全体实数',
      level: 'high'
    },
    {
      key: 'log-domain',
      bad: /对数(函数)?[^。；！？\n]{0,10}?定义域[^。；！？\n]{0,10}?(全体实数|R(?![a-zA-Z]))/g,
      guard: function (m, text, at) {
        var sent = sentenceAround(text, at);
        if (/大于\s*0|＞\s*0|\(0,|（0,|>0/.test(sent)) return false;
        if (/[不非]\s*$|不是$/.test(text.slice(Math.max(0, at - 8), at))) return false;
        return true;
      },
      good: '对数函数的定义域是 (0, +∞)',
      why: '真数必须大于 0',
      level: 'high'
    }
  ];

  /* 该讲的环节：不是「错」，是「缺」 */
  var STAGES = [
    { key: 'summary', name: '课堂小结', re: /(小结|总结一下|回顾一下今天|今天我们学了)/, why: '一节课收尾要有小结，把知识点串起来', tip: '收尾用「今天我们学了……」，把两三个知识点串一遍' },
    { key: 'homework', name: '布置作业', re: /(作业|课后|练习册|回去做)/, why: '试讲也要有作业环节，哪怕一句话', tip: '留一道题，或一句「课后把练习册第 X 页做了」' },
    { key: 'example', name: '例题讲解', re: /(例题|比如|举个例子|看这道题)/, why: '概念讲完必须有例题，否则学生不会用', tip: '讲完概念立刻跟一道例题，师生一起算一遍' },
    { key: 'question', name: '课堂提问', re: /(谁来回答|想一想|大家说|是不是|对不对|有没有同学)/, why: '没有提问就是满堂灌', tip: '至少问一次「谁来回答」，等两秒再自己接' }
  ];

  var SELF_FIX = /(不对|说错|口误|应该是|应该是说|纠正一下|重新说|刚才说错|我这里说错|说反了)/;
  var NEGATION = /(不是|并非|并不|不能说|别把|不要把|错误地|有人会说|常有人以为|反例)/;

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* 命中位置所在的整句（用句末标点切，找不到就返回整段） */
  function sentenceAround(text, at) {
    var start = at;
    while (start > 0 && !/[。！？；\n]/.test(text.charAt(start - 1))) start--;
    var end = at;
    while (end < text.length && !/[。！？；\n]/.test(text.charAt(end))) end++;
    return text.slice(start, end + 1);
  }

  /* 全量匹配：用 exec 的 index，绝不依赖 replace 回调的参数个数。
     回调参数会随捕获组数量变化（0 组时 offset 会变成整段字符串），
     这是上一版把「第二句的错」引到「第一句」上的直接原因。 */
  function findAll(re, text) {
    var out = [];
    var rx = new RegExp(re.source, re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g');
    rx.lastIndex = 0;
    var m;
    var guardCount = 0;
    while ((m = rx.exec(text)) !== null && guardCount++ < 2000) {
      out.push({ text: m[0], at: m.index, groups: m.slice(1) });
      if (m[0] === '') rx.lastIndex++;
    }
    return out;
  }

  /* 把多段逐字稿拼成一条，并给出「每个字符属于第几段」。
     关键：map 的长度必须等于 text.length——拼接时补的句号也要占一个位置，
     否则后面每一段的偏移都会整体错位（上一版的段错位就是这么来的）。 */
  function flatten(segments, field) {
    var text = '';
    var map = [];
    var segStart = [];
    var segEnd = [];
    (segments || []).forEach(function (seg, si) {
      var body = String((field ? seg[field] : seg.text) || '');
      segStart[si] = text.length;
      for (var i = 0; i < body.length; i++) map.push(si);
      text += body;
      segEnd[si] = text.length;
      var needsDot = body.length > 0 && !/[。！？；\n]$/.test(body);
      if (needsDot) { text += '。'; map.push(si); }
    });
    return { text: text, map: map, segStart: segStart, segEnd: segEnd };
  }

  function segIndexFor(flat, at) {
    if (!flat.map.length) return 0;
    var i = Math.max(0, Math.min(at, flat.map.length - 1));
    return flat.map[i];
  }

  /* 语境判定：返回 { status, reason }
     status: 'confirmed' | 'candidate' | 'slip' */
  function contextOf(sentence, text, at, matchText, selfFixWindow) {
    /* 先错后改：同一句或紧邻的下一句开头出现「不对/说错/应该是」 */
    if (SELF_FIX.test(sentence) || (selfFixWindow && SELF_FIX.test(selfFixWindow))) {
      return { status: 'slip', reason: '这句里当场改口了，按口误算，不作知识错误' };
    }
    /* 否定/反例/引用他人错误观点：整句是在否定这个说法 */
    if (NEGATION.test(sentence)) {
      var negAt = sentence.search(NEGATION);
      var hitInSentence = sentence.indexOf(matchText);
      /* 否定词出现在命中之前，说明是在否定这句话本身 */
      if (negAt >= 0 && hitInSentence >= 0 && negAt < hitInSentence) {
        return { status: 'candidate', reason: '这句里有否定/反例语境，需要人工确认是不是在否定这个说法' };
      }
    }
    return { status: 'confirmed', reason: '' };
  }

  /* 第 1 层：术语与断言 */
  function ruleLayer(segments) {
    var out = [];
    var segs = segments || [];
    /* 术语/同音误认看「识别原文」；断言看纠正后的文本 */
    var hasRaw = segs.some(function (s) { return !!s.raw; });
    var flat = hasRaw ? flatten(segs, 'raw') : flatten(segs);
    var text = flat.text;

    function segAt(at) {
      var si = segIndexFor(flat, at);
      var seg = segs[si] || {};
      var startInSeg = (flat.segStart[si] != null) ? flat.segStart[si] : 0;
      return {
        si: si,
        segmentId: seg.segmentId || seg.id || ('s' + (si + 1)),
        t: seg.t != null ? seg.t : null,
        text: seg.text || '',
        startInSeg: startInSeg
      };
    }

    function push(rule, hit, kind, opts) {
      var at = hit.at;
      var se = segAt(at);
      var sentence = sentenceAround(text, at);
      var next = segs[se.si + 1];
      var nextText = next ? String(next.text || '') : '';
      /* 只有下一句以「不对/说错…」开头，才算接着改口 */
      var selfFixWindow = /^(不对|说错|应该是|纠正|重新说|说反了)/.test(nextText) ? nextText : '';
      var ctx = (opts && opts.forceSlip)
        ? { status: 'slip', reason: '这句给的是正确限定（改口/补充说明），按口误算' }
        : contextOf(sentence, text, at, hit.text, selfFixWindow);
      /* 同音误认（函授/函数）本来就有可能是识别错，永远只当候选 */
      if (rule.type === 'asr' && ctx.status === 'confirmed') {
        ctx = { status: 'candidate', reason: '同音词，可能是语音识别错了，先当候选，不进结论' };
      }

      var item = {
        id: (kind === 'claim' ? 'claim-' : 'term-') + rule.key + '-' + at,
        segmentId: se.segmentId,
        segIndex: se.si,
        layer: 1,
        kind: kind,
        type: rule.type || 'concept',
        severity: rule.level || (rule.type === 'asr' ? 'low' : 'high'),
        status: ctx.status,
        /* 字面规则先给「候选」；语境明确才升级成 confirmed */
        pending: ctx.status !== 'confirmed',
        quote: se.text,
        quoteRange: { start: Math.max(0, at - se.startInSeg), end: Math.max(0, at - se.startInSeg) + hit.text.length },
        sentence: sentence,
        at: se.t,
        wrong: hit.text,
        correct: rule.good,
        why: rule.why,
        contextReason: ctx.reason,
        confidence: rule.type === 'asr' ? 0.4 : 0.8,
        confidenceNote: '规则可靠度（人工设定），不是识别准确率'
      };
      if (ctx.status === 'slip') {
        item.type = 'slip';
        item.severity = 'low';
        item.why = item.why + '（这句里当场改口了，按口误算，不作知识错误）';
      }
      out.push(item);
    }

    TERMS.forEach(function (rule) {
      findAll(rule.bad, text).forEach(function (hit) { push(rule, hit, 'terminology'); });
    });

    CLAIMS.forEach(function (rule) {
      findAll(rule.bad, text).forEach(function (hit) {
        var sentence = sentenceAround(text, hit.at);
        var guarded = rule.guard ? rule.guard(hit.text, text, hit.at) : true;
        /* 语境说不算错（否定了、给了正确限定）：默认不报。
           但如果这句里紧接着改口了（「…全体实数，不对，是…」），
           仍要留下一条口误，免得「说了又改」被完全抹掉。 */
        if (!guarded && !SELF_FIX.test(sentence)) return;
        push(rule, hit, 'claim', { forceSlip: !guarded });
      });
    });

    return out;
  }

  /* 第 2 层：环节缺失（只依赖逐字稿里有没有这话） */
  function structureLayer(segments, duration) {
    var out = [];
    if (!segments || !segments.length) return out;
    var all = segments.map(function (s) { return s.text || ''; }).join('。');
    if (duration > 0 && duration < 240) return out;

    STAGES.forEach(function (st) {
      if (!st.re.test(all)) {
        out.push({
          id: 'stage-' + st.key,
          layer: 2,
          kind: 'missing-stage',
          type: 'structure',
          severity: st.key === 'example' || st.key === 'summary' ? 'high' : 'mid',
          status: 'confirmed',
          quote: '',
          quoteRange: null,
          at: null,
          wrong: '全程没提到「' + st.name + '」',
          correct: st.tip || st.why,
          why: '',
          confidence: 0.8,
          confidenceNote: '按逐字稿关键词判定，不做语义推断',
          pending: false
        });
      }
    });
    return out;
  }

  /* 第 3 层：模型结论，一律先按「待确认」 */
  function fromModel(items) {
    return (items || []).map(function (it, i) {
      var conf = typeof it.confidence === 'number' ? it.confidence : 0.5;
      var pending = conf < 0.7 || it.type === 'slip';
      return {
        id: 'ai-' + i,
        layer: 3,
        kind: it.kind || 'concept',
        type: it.type || 'concept',
        severity: it.severity || (conf >= 0.7 ? 'high' : 'low'),
        status: pending ? 'candidate' : 'confirmed',
        quote: it.quote || '',
        quoteRange: null,
        at: it.at != null ? it.at : null,
        wrong: it.wrong || '',
        correct: it.correct || '',
        why: it.why || '',
        confidence: conf,
        confidenceNote: '模型自评置信度，不是准确率',
        pending: pending
      };
    });
  }

  function check(input) {
    input = input || {};
    var segments = input.segments || [];
    var duration = input.duration || 0;

    var items = [];
    try { items = items.concat(ruleLayer(segments)); } catch (e) { /* 一层挂掉不影响整份报告 */ }
    try { items = items.concat(structureLayer(segments, duration)); } catch (e) {}
    if (input.modelItems && input.modelItems.length) {
      try { items = items.concat(fromModel(input.modelItems)); } catch (e) {}
    }

    var seen = {};
    items = items.filter(function (it) {
      var k = it.kind + '|' + (it.segmentId || '') + '|' + (it.wrong || '') + '|' + (it.quote || '');
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });

    items.sort(function (a, b) {
      if (a.pending !== b.pending) return a.pending ? 1 : -1;
      var r = { high: 0, mid: 1, low: 2 };
      if (r[a.severity] !== r[b.severity]) return r[a.severity] - r[b.severity];
      return (a.at || 0) - (b.at || 0);
    });
    items.forEach(function (it, i) { it.order = i + 1; });

    var confirmed = items.filter(function (it) { return !it.pending; });
    var pending = items.filter(function (it) { return it.pending; });

    return {
      version: RULE_VERSION,
      available: segments.length > 0,
      items: items,
      confirmed: confirmed,
      pending: pending,
      counts: {
        total: items.length,
        confirmed: confirmed.length,
        pending: pending.length,
        byLayer: [1, 2, 3].map(function (l) { return items.filter(function (it) { return it.layer === l; }).length; })
      },
      note: items.length ? '' : '逐字稿里没有查到可确认的理论错误。'
    };
  }

  App.Theory = {
    version: RULE_VERSION,
    check: check,
    ruleLayer: ruleLayer,
    structureLayer: structureLayer,
    fromModel: fromModel,
    findAll: findAll,
    sentenceAround: sentenceAround,
    TERMS: TERMS,
    CLAIMS: CLAIMS,
    STAGES: STAGES,
    _flatten: flatten
  };
})(window);
