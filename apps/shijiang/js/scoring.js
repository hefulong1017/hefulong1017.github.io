/* ==========================================================================
   scoring.js — 评分模型（核心）
   七个维度、权重、扣分规则全部集中在这一份可配置规则表里。
   所有扣分项都带「扣多少 / 为什么 / 第几秒」，报告页据此逐条渲染。
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;
  var T = App.text;

  /* ======================================================================
     一、规则表（改这里就能调标准）
     ====================================================================== */
  var RULES = App.RULES = {

    weights: {
      content: 0.30,
      fluency: 0.15,
      pause: 0.10,
      filler: 0.10,
      board: 0.15,
      speed: 0.10,
      posture: 0.10
    },

    grades: [
      { key: 'A+', min: 92, label: '优秀', desc: '达到教师编面试优秀线，可以上场。' },
      { key: 'A', min: 85, label: '良好', desc: '整体成型，细节打磨后具备竞争力。' },
      { key: 'B', min: 75, label: '合格', desc: '结构基本完整，但存在会被扣分的硬伤。' },
      { key: 'C', min: 60, label: '待提升', desc: '有明显缺项，按当前状态难以通过。' },
      { key: 'D', min: 0, label: '不合格', desc: '未达到教师编试讲的基本要求。' }
    ],

    /* ---------------------------------------------------------------------
       「证据够不够」只决定「这次评估覆盖了哪些项」，不再决定「分数上限」。
       教学表现分 = 已测维度的加权均值；证据覆盖 = 已测维度的权重占比。
       两者分开：看不到身体、没有转写，只说明这些项「未评估」，不代表老师讲得差。
       --------------------------------------------------------------------- */
    evidence: {
      missing: null,          /* 缺测维度没有分数，报告里显示「未评估」 */
      missingNote: '这一项这次没评估，不计入教学表现分。',
      /* 覆盖率达到这个比例才算「完整评估」，否则报告只给参考分、不给等级结论。
         0.85 的取法：少一整个维度（比如浏览器给不出姿态关键点时的「仪态」）仍然算完整，
         但报告里那一项会明确标「未评估」；少两项以上才算部分评估。 */
      fullCoverage: 0.85,
      partialCoverage: 0.55,
      /* 素材时长相对目标时长过短时才提示「可能不完整」——按视频时长算，
         不再用「有效讲话秒数」冒充课堂长度（板书、提问、学生回答都是教学时间）。 */
      durationWarnRatio: 0.4,
      /* 样本太短时，「流畅 / 停顿 / 语速」这类靠统计得出的项不许拿高分——
         这跟「缺数据」不是一回事，是同一个测量里样本太少。 */
      weakCaps: [
        { maxSpeechMin: 0.75, cap: 30, keys: ['fluency', 'pause', 'speed'] },
        { maxSpeechMin: 2, cap: 45, keys: ['fluency', 'pause', 'speed'] },
        { maxSpeechMin: 4, cap: 65, keys: ['fluency', 'pause', 'speed'] }
      ],
      /* 这些项至少要讲够 1 分钟才有统计意义，否则直接算没测到。
         片段模式（clip）按素材长度放宽到 20–45 秒：一段 1 分钟的切片本来就只有这么点开口时间，
         再用整堂课的门槛去卡，等于把「片段」判成「没测到」。 */
      minSpeechFor: { fluency: 60, pause: 60, filler: 60, speed: 60 }
    },
    /* 片段模式的门槛下限与上限（秒） */
    clipSpeechFloor: { min: 18, max: 45 },

    sections: [
      {
        key: 'intro', name: '导入', deduct: 8, icon: 'i-play',
        patterns: ['上课', '同学们好', '大家好', '今天我们来', '今天我们一起', '我们先来看',
                   '大家回忆', '上节课', '上一节', '请看大屏幕', '看这个画面', '生活中',
                   '大家想一想', '听说过', '有没有同学'],
        hint: '导入环节缺失：没有情境、复习或问题引入，学生没有思考起点。'
      },
      {
        key: 'explore', name: '新知探究', deduct: 12, icon: 'i-content',
        patterns: ['我们来探究', '我们来看一下这个', '观察这个', '定义', '概念', '定理',
                   '猜想', '推导', '证明', '为什么', '怎么来的', '性质', '公式的由来',
                   '一般地', '我们把这样的'],
        hint: '新知探究环节缺失：只有结论，没有概念的生成过程。'
      },
      {
        key: 'example', name: '例题讲解', deduct: 10, icon: 'i-board',
        patterns: ['例题', '例1', '例 1', '例2', '例 2', '请看这道题', '我们来做一道',
                   '我们来解', '变式', '练习一下', '大家试着'],
        hint: '例题讲解环节缺失：没有示范解题，学生无法迁移。'
      },
      {
        key: 'summary', name: '课堂小结', deduct: 6, icon: 'i-check',
        patterns: ['小结', '总结一下', '我们来回顾', '回顾一下', '这节课我们', '今天学了',
                   '本节课', '梳理一下'],
        hint: '课堂小结环节缺失：没有回顾与结构化收束。'
      },
      {
        key: 'homework', name: '作业布置', deduct: 4, icon: 'i-download',
        patterns: ['作业', '课后', '课下', '练习册', '完成课本', '回去思考', '思考题'],
        hint: '作业布置环节缺失：没有课后任务，课堂不闭环。'
      }
    ],

    transitions: ['刚才我们', '接下来', '下面我们', '那么', '因此', '所以', '由此',
                  '在此基础上', '带着这个', '既然', '我们再来', '紧接着', '最后'],

    /** 口语化替代规范表述 */
    informal: [
      { re: /这个(就)?等于那个/g, word: '这个就等于那个' },
      { re: /(约掉|消掉|约去|消去)/g, word: '约掉/消掉' },
      { re: /(挪过去|移过去|拎出来|搞一下|弄一下|搞定)/g, word: '挪过去/搞一下' },
      { re: /(这个东西|那个东西|这玩意儿)/g, word: '这个东西' },
      { re: /就(变成|成了)这(个|样)/g, word: '就变成这样' },
      { re: /不用管/g, word: '不用管' }
    ],

    /** 条件遗漏 / 概念硬伤（正则命中即视为一处） */
    rigor: [
      {
        re: /(对数|log|ln|lg)/i, need: /(定义域|x\s*[>＞]\s*0|真数)/,
        msg: '讲到对数但未交代定义域（真数大于 0）', points: 8
      },
      {
        re: /(分母|分式|除以)/, need: /(不等于零|不等于0|≠\s*0|不为零|非零)/,
        msg: '出现分母但未强调分母不为零', points: 8
      },
      {
        re: /(根号|平方根|开方|偶次根)/, need: /(非负|大于等于零|大于等于0|≥\s*0|≥0)/,
        msg: '出现偶次根式但未强调被开方数非负', points: 8
      },
      {
        re: /(向量)/, need: /(方向|模|共线|夹角)/,
        msg: '提到向量但未讲清方向与模（易与数量混淆）', points: 8
      },
      {
        re: /(当且仅当|等价于)/, need: /(反过来|反之|充分|必要)/,
        msg: '使用「当且仅当」但未说明必要性与充分性的双向关系', points: 4
      }
    ],

    /** 五环节之间应有的过渡语窗口（字符） */
    transitionWindow: 90,

    fluency: {
      microFreePer10Min: 5,
      microPenalty: 2,
      repeatPenalty: 3,
      wordRepeatPenalty: 1,
      longSentenceBreaks: 3,
      longSentencePenalty: 2
    },

    pause: {
      idealPerMin: 1.2,
      overPenalty: 3,
      longPenalty: 5,
      edgeWindow: 60,
      edgePenalty: 3
    },

    filler: {
      freeCount: 3,
      bands: [
        { max: 8, per: 2, base: 0 },
        { max: 15, per: 3, base: 10 },
        { max: Infinity, per: 4, base: 31 }
      ],
      densityFail: 4.0,
      densityFailScore: 55
    },

    board: {
      missingScore: 60,
      missingNote: '未提交板书，这一项这次没测到，不参与总分。',
      items: [
        { key: 'clarity', name: '字迹清晰度' },
        { key: 'layout', name: '版面布局' },
        { key: 'symbols', name: '数学符号规范' },
        { key: 'structure', name: '层次结构' },
        { key: 'neat', name: '整洁度' }
      ]
    },

    speed: {
      idealMin: 200,
      idealMax: 260,
      step: 10,
      stepPenalty: 2,
      failHigh: 320,
      failLow: 150,
      failScore: 55,
      volatility: 45,
      volatilityPenalty: 10,
      volumeCV: 0.4,
      volumePenalty: 5
    },

    /* ---------------------------------------------------------------------
       仪态：只按「有连续帧证据的教学行为」扣分，不按位置、不看表情多少。
       门槛来自 vision 引擎：没有足够的姿态样本就整项不评。 */
    posture: {
      minPoseRate: 0.25,     /* 抽到的帧里至少 25% 能把人体关键点定位出来 */
      minSamples: 6,         /* 至少 6 个可用的姿态样本，才谈得上「持续」 */
      perEvent: { back_turned: 6, board_occluded: 5, repeated_motion: 4 },
      cap: { back_turned: 18, board_occluded: 15, repeated_motion: 8 },
      labels: {
        back_turned: '背对镜头讲解',
        board_occluded: '讲解时身体挡住板书',
        repeated_motion: '重复动作'
      }
    }
  };

  /* ======================================================================
     二、工具
     ====================================================================== */
  function clampScore(v) { return Math.max(0, Math.min(100, Math.round(v))); }

  /* ---------------------------------------------------------------------
     每个维度都要能「算式还原」：起始分 → 扣分 → 封顶/折算 → 最终分。
     报告里直接显示这条算式，避免出现「74 分但只列了 16 分扣分」这种说不清的情况。
     --------------------------------------------------------------------- */
  function buildTrace(d) {
    var t = { mode: 'deduct', base: 100, deducted: 0, steps: [], folded: null, capped: null, final: d.score };

    if (d.missing) {
      t.mode = 'missing';
      t.base = null;
      t.final = null;
      return t;
    }

    /* 板书是「五项各自 0–20 相加」，不走扣分制 */
    if (d.key === 'board' && d.raw && d.raw.items && d.raw.items.length) {
      var measuredItems = d.raw.items.filter(function (i) { return i.score != null; });
      t.mode = 'sum';
      t.base = 0;
      t.steps = measuredItems.map(function (i) { return { label: i.name, points: i.score }; });
      t.measuredItems = measuredItems.length;
      t.final = d.score;
      return t;
    }

    /* 仪态：旧的「按站姿稳定性折算」只在没有行为证据时兜底；
       现在正常走的是上面 deductions（每个可定位的教学行为扣一次） */
    if (d.key === 'posture' && d.raw && d.raw.measured && d.raw.mode !== 'behaviors') {
      var sta = d.raw.stability != null ? d.raw.stability : d.score;
      t.mode = 'measured';
      t.parts = [{ label: '站姿稳定', value: sta, weight: 100 }];
      t.base = sta;
      t.delta = d.score - sta;
      t.final = d.score;
      return t;
    }

    var sum = 0;
    (d.deductions || []).forEach(function (x) {
      if (typeof x.points === 'number' && x.points > 0) {
        sum += x.points;
        t.steps.push({ label: x.reason, points: x.points });
      } else if (typeof x.points !== 'number') {
        /* 「判不及格」这类不是扣分数值，单独标记，算式里写文字 */
        t.rawVerdict = true;
      }
    });
    t.deducted = sum;

    if (d.raw && d.raw.fold) t.folded = d.raw.fold;
    if (d.raw && d.raw.cap) t.capped = d.raw.cap;
    return t;
  }

  function grade(total) {
    for (var i = 0; i < RULES.grades.length; i++) {
      if (total >= RULES.grades[i].min) return RULES.grades[i];
    }
    return RULES.grades[RULES.grades.length - 1];
  }

  /** 从某个起点开始在全文里找第一个命中的环节关键词 */
  function findFirst(fullText, patterns, from) {
    var best = -1, bestWord = '';
    for (var i = 0; i < patterns.length; i++) {
      var idx = fullText.indexOf(patterns[i], from || 0);
      if (idx >= 0 && (best < 0 || idx < best)) { best = idx; bestWord = patterns[i]; }
    }
    return best < 0 ? null : { index: best, word: bestWord };
  }

  function containsAny(str, list) {
    for (var i = 0; i < list.length; i++) if (str.indexOf(list[i]) >= 0) return true;
    return false;
  }

  /* ======================================================================
     三、逐字稿 → 句子（带起止时间、句内间隙）
     ====================================================================== */
  function buildSentences(transcript) {
    var out = [];
    var cur = null;

    function push() {
      if (cur && T.charCount(cur.text) >= 2) {
        cur.chars = T.charCount(cur.text);
        out.push(cur);
      }
      cur = null;
    }

    (transcript || []).forEach(function (u) {
      var t = T.normalize(u.text);
      if (!t) return;
      if (!cur) cur = { text: '', start: u.t, end: u.t, gaps: [], segIds: [] };
      else {
        var gap = u.t - cur.end;
        if (gap > 0.4) cur.gaps.push({ at: cur.end, dur: gap });
      }
      cur.text += t;
      if (u.id) cur.segIds.push(u.id);
      cur.end = u.t + Math.max(0.6, T.charCount(t) / 4);
      if (/[。！？!?]$/.test(t) || T.charCount(cur.text) > 70) push();
    });
    push();
    out.forEach(function (s, i) { s.id = 'sent-' + i; });
    return out;
  }

  /* ======================================================================
     四、① 试讲内容
     ====================================================================== */
  function scoreContent(ctx) {
    var dim = { key: 'content', name: '试讲内容', weight: RULES.weights.content, score: 100, deductions: [], notes: [], raw: {} };

    if (!ctx.asrOK) {
      dim.score = null;
      dim.missing = true;
      dim.notes.push('没有逐字稿，无法检查五环节完整性。' + RULES.evidence.missingNote);
      dim.raw = { asr: false };
      return dim;
    }

    var full = ctx.fullText;
    var timeAt = ctx.timeAt;
    var duration = ctx.duration || 1;
    /* 「教学片段」模式只评这一段里的讲解质量：片段没有导入/小结/作业是正常的，
       不能按完整课堂的环节清单一律扣分。 */
    var isClip = ctx.mode === 'clip';

    /* --- 五环节定位 --- */
    var found = [];
    RULES.sections.forEach(function (sec) {
      var hit = findFirst(full, sec.patterns, 0);
      found.push({ key: sec.key, name: sec.name, index: hit ? hit.index : -1, word: hit ? hit.word : '', sec: sec });
    });

    var located = found.filter(function (f) { return f.index >= 0; })
      .sort(function (a, b) { return a.index - b.index; });

    // 起点时间
    located.forEach(function (f) { f.at = timeAt(f.index); });

    var order = located.map(function (f) { return f.key; });

    if (!isClip) {
      found.forEach(function (f) {
        if (f.index < 0) {
          dim.deductions.push({ reason: f.sec.hint, points: f.sec.deduct, at: null, kind: 'section' });
          dim.score -= f.sec.deduct;
        }
      });

      // 顺序错乱：出现逆序，视为后一个环节"位置不对"，扣一半
      var seq = ['intro', 'explore', 'example', 'summary', 'homework'];
      var lastPos = -1;
      located.forEach(function (f) {
        var pos = seq.indexOf(f.key);
        if (pos < lastPos) {
          dim.deductions.push({
            reason: '环节顺序异常：「' + f.name + '」出现在更靠前的环节之前，课堂结构倒置。',
            points: Math.round(f.sec.deduct / 2), at: f.at, kind: 'section'
          });
          dim.score -= Math.round(f.sec.deduct / 2);
        }
        lastPos = Math.max(lastPos, pos);
      });
    }

    /* --- 新知探究只有结论 --- */
    var explore = located.filter(function (f) { return f.key === 'explore'; })[0];
    if (explore) {
      var span = 500;
      var region = full.slice(Math.max(0, explore.index), Math.min(full.length, explore.index + span));
      var processWords = ['为什么', '怎么来', '推导', '证明', '猜想', '探究', '观察',
                          '发现', '一般地', '由特殊到一般', '归纳', '从…到', '类比'];
      if (!containsAny(region, processWords)) {
        dim.deductions.push({
          reason: '新知探究只有结论，没有概念的生成过程（缺少观察—猜想—验证的推进）。',
          points: 6, at: explore.at, kind: 'section'
        });
        dim.score -= 6;
      }
    }

    /* --- 例题：缺 / 无梯度 --- */
    var example = located.filter(function (f) { return f.key === 'example'; })[0];
    if (example) {
      var exCount = (full.match(/(例题|例\s?\d|变式|我们来做一道|请看这道题)/g) || []).length;
      if (exCount <= 1 && !/变式/.test(full)) {
        dim.deductions.push({
          reason: '例题只有一道且没有变式，缺少由「会做」到「会想」的梯度。',
          points: 4, at: example.at, kind: 'section'
        });
        dim.score -= 4;
      }
    }

    /* --- 数学严谨性 --- */
    RULES.rigor.forEach(function (r) {
      if (r.re.test(full) && !r.need.test(full)) {
        var m = full.match(r.re);
        var at = m ? timeAt(full.indexOf(m[0])) : null;
        dim.deductions.push({ reason: r.msg, points: r.points, at: at, kind: 'rigor' });
        dim.score -= r.points;
      }
    });

    /* --- 数学语言规范 --- */
    var informalCount = 0, informalList = [];
    RULES.informal.forEach(function (r) {
      var mm, re = new RegExp(r.re.source, 'g');
      while ((mm = re.exec(full)) !== null) {
        informalCount++;
        informalList.push({ word: r.word, at: timeAt(mm.index) });
      }
    });
    if (informalCount > 0) {
      var langPenalty = Math.min(8, informalCount);
      dim.deductions.push({
        reason: '数学语言口语化 ' + informalCount + ' 处（如「' + informalList[0].word + '」），应改用「由…得」「设…则」等规范表述。',
        points: langPenalty,
        at: informalList[0].at,
        kind: 'language',
        samples: informalList.slice(0, 6)
      });
      dim.score -= langPenalty;
    }

    /* --- 重难点突出度：核心概念时长占比 --- */
    var coreStart = explore ? explore.at : null;
    var exStart = example ? example.at : null;
    if (coreStart != null) {
      var coreEnd = exStart != null && exStart > coreStart ? exStart : duration;
      var ratio = (coreEnd - coreStart) / duration;
      dim.raw.coreRatio = ratio;
      if (ratio < 0.35) {
        var p = Math.min(15, Math.round((0.35 - ratio) / 0.35 * 15));
        if (p > 0) {
          dim.deductions.push({
            reason: '核心概念讲解只占全程 ' + Math.round(ratio * 100) + '%，低于 35% 的重难点底线。',
            points: p, at: coreStart, kind: 'focus'
          });
          dim.score -= p;
        }
      }
    }

    /* --- 逻辑连贯性：环节过渡语 --- */
    var pairs = [];
    for (var i = 1; i < located.length; i++) pairs.push([located[i - 1], located[i]]);
    pairs.forEach(function (pair) {
      var a = pair[0], b = pair[1];
      var win = full.slice(Math.max(0, b.index - RULES.transitionWindow), Math.min(full.length, b.index + 30));
      if (!containsAny(win, RULES.transitions)) {
        dim.deductions.push({
          reason: '「' + a.name + '」到「' + b.name + '」之间没有过渡语，环节切换生硬。',
          points: 2, at: b.at, kind: 'transition'
        });
        dim.score -= 2;
      }
    });

    dim.score = clampScore(dim.score);

    /* --- 信息量：只在「真的没什么内容」时才打折 ---
       这里不看「有效讲话秒数 ÷ 目标时长」（板书、提问等待、让学生思考都是教学时间，
       算进去只会冤枉人）。只看一件事：按开口说话的时长算，你到底说出了多少话。
       阈值放得很低（60% 才动手），教学片段一律不折——片段本来就只截一段。 */
    var expectChars = Math.max(120, (ctx.speechSeconds / 60) * 200);
    var density = util.clamp(ctx.chars / expectChars, 0, 1);
    dim.raw.density = util.round1(density);
    if (!isClip && density < 0.60) {
      var before = dim.score;
      dim.score = clampScore(Math.round(dim.score * (0.5 + 0.5 * density)));
      dim.raw.fold = { before: before, after: dim.score, density: util.round1(density), factor: Math.round((0.5 + 0.5 * density) * 100) / 100 };
      dim.notes.push('开口说话的 ' + Math.round(ctx.speechSeconds / 60) + ' 分钟里只说了 ' + ctx.chars +
        ' 字（同样的时间一般能讲 ' + Math.round(expectChars) + ' 字），信息量偏少，内容分从 ' +
        before + ' 折到 ' + dim.score + ' 分。');
    }

    /* 五环节少一个就是一个硬伤：环节数直接压住内容分上限（教学片段不算） */
    var foundCount = found.filter(function (f) { return f.index >= 0; }).length;
    dim.raw.foundCount = foundCount;
    dim.raw.clip = isClip;
    if (!isClip) {
      var secCap = [25, 45, 60, 75, 90, 100][Math.min(5, foundCount)];
      if (dim.score > secCap) {
        dim.raw.cap = { value: secCap, why: '五环节只讲到了 ' + foundCount + ' 个' };
        dim.notes.push('五环节只讲到了 ' + foundCount + ' 个，内容分最高 ' + secCap + '。');
        dim.score = secCap;
      }
    }

    dim.raw.sections = found.map(function (f) {
      return { key: f.key, name: f.name, at: f.index >= 0 ? util.round1(f.at) : null, found: f.index >= 0 };
    });
    dim.raw.order = order;
    return dim;
  }

  /* ======================================================================
     五、② 语气流畅性
     ====================================================================== */
  function scoreFluency(ctx) {
    var dim = { key: 'fluency', name: '语气流畅性', weight: RULES.weights.fluency, score: 100, deductions: [], notes: [], raw: {} };
    var R = RULES.fluency;

    if ((ctx.speechSeconds || 0) < (ctx.minSpeech || RULES.evidence.minSpeechFor.fluency)) {
      dim.score = null;
      dim.missing = true;
      dim.notes.push('有效讲话不到 1 分钟，看不出说话习不习惯打结。' + RULES.evidence.missingNote);
      dim.raw = { tooShort: true };
      return dim;
    }

    if (!ctx.asrOK) {
      // 无逐字稿：用音频微停顿粗略折算
      var micro = ctx.audio.microPauses || [];
      var minutes = Math.max(0.5, (ctx.duration || 0) / 60);
      var allowed = Math.ceil(minutes / 10 * R.microFreePer10Min);
      var over = Math.max(0, micro.length - allowed);
      if (over > 0) {
        dim.score -= Math.min(40, over * R.microPenalty);
        dim.deductions.push({
          reason: '音频检测到 ' + micro.length + ' 次句中卡顿（0.8–1.2 秒），超出允许的 ' + allowed + ' 次。',
          points: Math.min(40, over * R.microPenalty),
          at: micro[0] ? micro[0].start : null,
          kind: 'stall'
        });
      }
      dim.notes.push('未获得逐字稿，本维度仅依据音频能量变化估算，精度下降。');
      dim.raw = { asr: false };
      dim.score = clampScore(dim.score);
      return dim;
    }

    var sents = ctx.sentences;
    var minutes = Math.max(0.5, (ctx.duration || 0) / 60);

    /* --- 句中异常卡顿（0.8–1.2s，不含换段） --- */
    var stalls = [];
    sents.forEach(function (s) {
      s.gaps.forEach(function (g) {
        if (g.dur >= 0.8 && g.dur < 1.2) stalls.push(g);
      });
    });
    var allowedStalls = Math.ceil(minutes / 10 * R.microFreePer10Min);
    if (stalls.length > allowedStalls) {
      var p1 = (stalls.length - allowedStalls) * R.microPenalty;
      dim.deductions.push({
        reason: '句中异常卡顿 ' + stalls.length + ' 次（允许 ' + allowedStalls + ' 次），每次 0.8–1.2 秒没有输出。',
        points: p1, at: stalls[allowedStalls] ? stalls[allowedStalls].at : stalls[0].at,
        kind: 'stall', samples: stalls.slice(0, 8)
      });
      dim.score -= p1;
    }

    /* --- 整句重复 --- */
    var texts = sents.map(function (s) { return s.text; });
    var starts = sents.map(function (s) { return s.start; });
    var reps = T.repeatedSentences(texts, starts);
    if (reps.length) {
      dim.deductions.push({
        reason: '整句重复 ' + reps.length + ' 次（连续两句相似度 > 0.85）。',
        points: reps.length * R.repeatPenalty,
        at: reps[0].at, kind: 'repeat',
        samples: reps.slice(0, 5)
      });
      dim.score -= reps.length * R.repeatPenalty;
    }

    /* --- 无意义重读 --- */
    var wordReps = T.wordRepeats(ctx.fullText, ctx.timeAt);
    if (wordReps.length) {
      dim.deductions.push({
        reason: '同一个词连续重复 ' + wordReps.length + ' 处（如「' + wordReps[0].word + '」）。',
        points: wordReps.length * R.wordRepeatPenalty,
        at: wordReps[0].at, kind: 'wordrepeat',
        samples: wordReps.slice(0, 8)
      });
      dim.score -= wordReps.length * R.wordRepeatPenalty;
    }

    /* --- 长句断裂 --- */
    var broken = sents.filter(function (s) {
      return T.charCount(s.text) > 30 && s.gaps.filter(function (g) { return g.dur >= 0.5; }).length >= R.longSentenceBreaks;
    });
    if (broken.length) {
      dim.deductions.push({
        reason: '长句断裂 ' + broken.length + ' 句（一句超过 3 次中断，听感破碎）。',
        points: broken.length * R.longSentencePenalty,
        at: broken[0].start, kind: 'break',
        samples: broken.slice(0, 4).map(function (s) { return { at: s.start, text: s.text.slice(0, 40) }; })
      });
      dim.score -= broken.length * R.longSentencePenalty;
    }

    dim.raw = { stalls: stalls.length, repeats: reps.length, wordRepeats: wordReps.length, broken: broken.length };
    dim.score = clampScore(dim.score);
    return dim;
  }

  /* ======================================================================
     六、③ 停顿次数
     ====================================================================== */
  function scorePause(ctx) {
    var dim = { key: 'pause', name: '停顿次数', weight: RULES.weights.pause, score: 100, deductions: [], notes: [], raw: {} };
    var R = RULES.pause;
    var pauses = (ctx.audio.pauses || []).slice();

    if ((ctx.speechSeconds || 0) < (ctx.minSpeech || RULES.evidence.minSpeechFor.pause)) {
      dim.score = null;
      dim.missing = true;
      dim.notes.push('有效讲话不到 1 分钟，停顿次数不构成样本。' + RULES.evidence.missingNote);
      dim.raw = { tooShort: true };
      return dim;
    }

    var minutes = Math.max(0.5, ctx.speechSeconds / 60);
    var ideal = Math.max(1, Math.round(minutes * R.idealPerMin));
    var count = pauses.length;
    var longCount = pauses.filter(function (p) { return p.long; }).length;

    if (count > ideal) {
      var p1 = (count - ideal) * R.overPenalty;
      dim.deductions.push({
        reason: '停顿 ' + count + ' 次，超过有效讲话 ' + minutes.toFixed(1) + ' 分钟对应的理想上限 ' + ideal + ' 次。',
        points: p1, at: pauses[ideal] ? pauses[ideal].start : pauses[0].start,
        kind: 'pause', samples: pauses.slice(ideal, ideal + 10)
      });
      dim.score -= p1;
    }

    if (longCount > 0) {
      var p2 = longCount * R.longPenalty;
      var longs = pauses.filter(function (p) { return p.long; });
      dim.deductions.push({
        reason: '长停顿（> 5 秒）' + longCount + ' 次，最久一次 ' + longs[0].duration.toFixed(1) + ' 秒。',
        points: p2, at: longs[0].start, kind: 'longpause',
        samples: longs.slice(0, 5)
      });
      dim.score -= p2;
    }

    /* 分布：开头 1 分钟 / 结尾 1 分钟 */
    var dur = ctx.duration || 0;
    var head = pauses.filter(function (p) { return p.start <= R.edgeWindow; });
    var tail = pauses.filter(function (p) { return p.end >= dur - R.edgeWindow; });
    if (head.length >= 2 || tail.length >= 2) {
      var where = head.length >= tail.length ? '开头 1 分钟（紧张）' : '结尾（收不住）';
      dim.deductions.push({
        reason: '停顿集中在' + where + '：该区间内 ' + Math.max(head.length, tail.length) + ' 次停顿。',
        points: R.edgePenalty,
        at: (head.length >= tail.length ? head[0] : tail[0]).start,
        kind: 'distribution'
      });
      dim.score -= R.edgePenalty;
    }

    dim.raw = {
      count: count, ideal: ideal, longCount: longCount,
      minutes: util.round1(minutes),
      micro: (ctx.audio.microPauses || []).length,
      avg: count ? util.round1(pauses.reduce(function (a, p) { return a + p.duration; }, 0) / count) : 0
    };
    dim.notes.push('只统计 2 秒以上的静默：' + (dim.raw.micro > 0
      ? '另有 ' + dim.raw.micro + ' 处 0.8–2 秒的自然换气，不计入扣分。'
      : '更短的换气不算停顿。'));
    dim.score = clampScore(dim.score);
    return dim;
  }

  /* ======================================================================
     七、④ 语气词次数
     ====================================================================== */
  function scoreFiller(ctx) {
    var dim = { key: 'filler', name: '口头禅次数', weight: RULES.weights.filler, score: 100, deductions: [], notes: [], raw: {} };
    var R = RULES.filler;

    if (!ctx.asrOK) {
      dim.score = null;
      dim.missing = true;
      dim.notes.push('没有逐字稿，无法统计语气词。' + RULES.evidence.missingNote);
      dim.raw = { asr: false, count: null };
      return dim;
    }

    /* 字数太少：没讲话自然也就没有语气词，不能白拿满分。
       这里看的是「逐字稿本身有多少字」——语速那项可能已经把字数换成音频估计值，
       拿那个数当依据会让只覆盖两分钟的字幕也拿到满分。 */
    var textChars = T.charCount(ctx.fullText);
    if (textChars < 200 || (ctx.speechSeconds || 0) < (ctx.minSpeech || RULES.evidence.minSpeechFor.filler)) {
      dim.score = null;
      dim.missing = true;
      dim.notes.push('逐字稿只有 ' + textChars + ' 字，样本不够判断语气词习惯。' + RULES.evidence.missingNote);
      dim.raw = { asr: true, count: null, tooShort: true };
      return dim;
    }

    var list = T.fillers(ctx.fullText, ctx.timeAt);
    var counted = list.filter(function (f) { return f.counted; });
    var exempt = list.length - counted.length;

    /* 分两类：纯填充（呃/嗯/这个/那个/然后…）与口头禅（那/呢/吧/嘛/是不是…）。
       口头禅按 0.4 折算——教师口语里「那……呢……」很像正常引导，但一句一挂就是模板病，
       全算会冤枉所有人，全不算又测不出这类毛病。 */
    var CORE = ['呃', '额', '嗯', '啊', '这个', '那个', '然后', '就是', '对吧', '其实', '反正', '的话', '怎么说呢', '那么'];
    var coreN = 0, habitN = 0;
    counted.forEach(function (f) {
      if (CORE.indexOf(f.word) > -1) coreN++; else habitN++;
    });
    var n = counted.length;
    var eff = coreN + habitN * 0.4;
    var minutes = Math.max(0.5, ctx.speechSeconds / 60);
    var density = eff / minutes;
    var per100 = metricsDensity(counted.length, T.charCount(ctx.fullText));

    var penalty = 0;
    if (eff > R.freeCount) {
      if (eff <= 8) penalty = Math.round((eff - R.freeCount) * 2);
      else if (eff <= 15) penalty = Math.round(10 + (eff - 8) * 3);
      else penalty = Math.round(31 + (eff - 15) * 4);
    }

    if (penalty > 0) {
      dim.deductions.push({
        reason: '语气词与口头禅共 ' + n + ' 次（折算 ' + util.round1(eff) + ' 次），超出 3 次的部分按阶梯扣分。',
        points: penalty, at: counted[0].at, kind: 'filler',
        samples: counted.slice(0, 12)
      });
      dim.score -= penalty;
    }

    if (density > R.densityFail) {
      dim.deductions.push({
        reason: '折算后密度 ' + density.toFixed(1) + ' 次/分钟，超过 ' + R.densityFail + ' 次/分钟的红线，直接判本维度不及格。',
        points: 'density', at: counted[0] ? counted[0].at : null, kind: 'density'
      });
      dim.score = Math.min(dim.score, R.densityFailScore);
    }

    // 高频词排行
    var byWord = {};
    counted.forEach(function (f) { byWord[f.word] = (byWord[f.word] || 0) + 1; });
    var top = Object.keys(byWord).sort(function (a, b) { return byWord[b] - byWord[a]; })
      .slice(0, 5).map(function (w) { return { word: w, n: byWord[w] }; });

    var habits = T.habits ? T.habits(ctx.fullText, ctx.timeAt) : [];
    var frames = T.frames ? T.frames(ctx.fullText) : [];

    if (top.length && n >= 5) {
      dim.notes.push('最多的三个：' + top.slice(0, 3).map(function (t) { return '「' + t.word + '」' + t.n + ' 次'; }).join('、') +
        '。每百字 ' + per100 + ' 次，占全部字数的 ' + Math.round(counted.length * 100 / Math.max(1, T.charCount(ctx.fullText)) * 10) / 10 + '%。');
    }
    if (frames.length >= 3) {
      dim.notes.push('「那……呢……」这种套式有 ' + frames.length + ' 处，例如「' + frames[0].sentence.slice(0, 24) + '」——把「那 X 呢，」整句删掉，直接说「X 是」，句子会立刻变硬。');
    }

    dim.raw = {
      count: n, core: coreN, habit: habitN, eff: util.round1(eff),
      exempt: exempt, density: util.round1(density), per100: per100,
      top: top, habits: habits, frames: frames.length, minutes: util.round1(minutes)
    };
    dim.score = clampScore(dim.score);
    return dim;
  }

  /** 每百字出现次数（和字数无关的口头禅密度） */
  function metricsDensity(n, chars) {
    if (!chars) return 0;
    return Math.round(n / chars * 100 * 10) / 10;
  }

  /* ======================================================================
     八、⑤ 板书工整性
     ====================================================================== */
  function scoreBoard(ctx) {
    var dim = { key: 'board', name: '板书工整性', weight: RULES.weights.board, score: 100, deductions: [], notes: [], raw: {} };
    var auto = ctx.boardAuto;

    /* 画面分析给出的失败原因要一路传到报告里：
       「没定位到板面」和「定位到了但拍糊了」是两种完全不同的事，不能都写成一句「未评估」。 */
    var vb = (ctx.visual && ctx.visual.board) || null;
    var vWhy = '';
    if (vb) {
      if (!vb.found) vWhy = '未定位到可读板面';
      else if (vb.readability && vb.readability.ok === false) {
        vWhy = (vb.readability.reasons || []).map(function (r) { return r.text; }).join('；');
      }
    }

    if (!ctx.board || !ctx.board.dataUrl) {
      dim.score = null;
      dim.missing = true;
      var whyMissing = ctx.audioOnly
        ? '这次只录了音频，没有画面，看不到板书'
        : (vWhy || '没有提交板书照片，也没有从录像里找到板书');
      dim.raw = { missing: true, items: [], reason: whyMissing, audioOnly: !!ctx.audioOnly };
      dim.notes.push(whyMissing + '。这一项不评估，也不计入总分。');
      return dim;
    }

    /* 拍得糊、反光、只有一小角：属于「读不清」，不是「写得差」 */
    if ((auto && auto.readable === false) || (vb && vb.readability && vb.readability.ok === false)) {
      dim.score = null;
      dim.missing = true;
      var whyBad = vWhy || (auto && auto.reason) || '板书画面读不清，这一项无法评估。';
      dim.raw = { missing: true, metrics: (auto && auto.metrics) || null, reason: whyBad };
      dim.notes.push(whyBad + '。这一项不评估——它说明的是拍摄问题，不是书写质量。');
      return dim;
    }

    /* ---- 有画面几何就按几何打分：每一项都是量出来的，不靠模型 ----
       量不出来的项（字太小、分不出行）在 points 里 weight=0，不参与平均。 */
    var geo = (vb && vb.crop && vb.crop.metrics) || null;
    var gp = (geo && geo.points) || null;
    if (gp && gp.score != null && gp.items && gp.items.length) {
      var seen = 0;
      dim.raw.items = gp.items.map(function (it) {
        if (it.score == null) return { key: it.key, name: it.name, score: null, detail: it.detail };
        seen++;
        return { key: it.key, name: it.name, score: Math.round(it.score / 5), detail: it.detail };
      });
      dim.raw.measuredItems = seen;
      dim.raw.geoScore = gp.score;
      dim.raw.charSource = geo.charSource || null;
      dim.score = clampScore(gp.score);
      gp.items.forEach(function (it) {
        if (it.score == null || it.score >= 60) return;
        dim.deductions.push({
          reason: it.name + '只有 ' + it.score + ' 分：' + it.detail + '。',
          points: Math.round((100 - it.score) / 5), at: null, kind: 'board',
          raw: { key: it.key, score: it.score, detail: it.detail }
        });
      });
      dim.notes.push('这一项是按板面像素量出来的 ' + seen + ' 个评分点算的（字号、行平直、行距、字距、行首对齐、留白、版面利用、分区分块、清洁度、遮挡、对比度），不用模型打印象分。' +
        (geo.charSource === 'ocr' ? '字距与字号用的是 OCR 字符框。' : '没拿到 OCR 字段，字距与字号按连通域估算，只作参考。'));
      if (gp.weight < 8) dim.notes.push('只量到 ' + gp.weight + ' 分权重（总共 14），样本偏少，这个分数参考价值有限。');
      return dim;
    }

    var measured = [];
    dim.raw.items = RULES.board.items.map(function (i) {
      var v = auto && auto.items && auto.items[i.key] != null ? auto.items[i.key] : null;
      if (v == null) return { key: i.key, name: i.name, score: null };
      var s = Math.round(util.clamp(v, 0, 20));
      measured.push(s);
      return { key: i.key, name: i.name, score: s };
    });

    if (!measured.length) {
      dim.score = null;
      dim.missing = true;
      dim.raw = { missing: true, metrics: (auto && auto.metrics) || null };
      dim.notes.push('板书照片里没有能自动识别的部分，这一项这次不评估。');
      return dim;
    }

    /* 只按测到的项折算成百分制，没测到的项不拉低也不抬高 */
    var sum = measured.reduce(function (a, b) { return a + b; }, 0);
    dim.score = clampScore(Math.round(sum / (20 * measured.length) * 100));
    dim.raw.measuredItems = measured.length;
    dim.raw.polarity = (auto && auto.polarity) || 'unknown';

    if (auto && auto.metrics) {
      dim.raw.metrics = auto.metrics;
      if (auto.metrics.leftMarginCV > 0.55) {
        dim.deductions.push({ reason: '各行起始位置不齐，左侧留边宽度不一致。', points: 0, at: null, kind: 'board' });
      }
      if (auto.metrics.lineGapCV > 0.45) {
        dim.deductions.push({ reason: '行距忽大忽小，版面节奏不匀。', points: 0, at: null, kind: 'board' });
      }
    }

    dim.notes.push('自动只评了能测量的 ' + measured.length + ' 项（字迹、版面、整洁）。数学符号是否规范、推导层次对不对，需要看图才能判断，可以手动校准或用 AI 深度点评。');
    if (dim.raw.polarity === 'dark') dim.notes.push('这块是深色板（黑板/绿板），按浅色粉笔字识别的。');
    else if (dim.raw.polarity === 'light') dim.notes.push('这块是浅色板（白板/电子板/投影），按深色笔迹识别的。');
    return dim;
  }

  /* ======================================================================
     九、⑥ 语气语速
     ====================================================================== */
  function scoreSpeed(ctx) {
    var dim = { key: 'speed', name: '语气语速', weight: RULES.weights.speed, score: 100, deductions: [], notes: [], raw: {} };
    var R = RULES.speed;

    var chars = ctx.chars;
    var minutes = Math.max(0.3, ctx.speechSeconds / 60);
    var rate = chars / minutes;

    /* 逐字稿只覆盖一部分时，语言与节奏那一块是按覆盖区间算的；
       这里跟着用同一个口径，免得同一份报告里出现两个语速数字 */
    var sp = ctx.speech;
    if (sp && sp.window && sp.window.partial && sp.speed && sp.speed.cpm > 0) {
      rate = sp.speed.cpm;
      minutes = Math.max(0.3, (sp.speechSeconds || 0) / 60);
      chars = sp.chars || chars;
    }

    dim.raw = { chars: chars, minutes: util.round1(minutes), rate: Math.round(rate), asr: ctx.asrOK };
    if (ctx.charsFromAudio) {
      dim.notes.push('这份字幕的字数（' + T.charCount(ctx.fullText) + ' 字）跟音频里实际说的话对不上，语速改用音频估的字数算。');
    }

    if (!chars || chars < 100 || (ctx.speechSeconds || 0) < (ctx.minSpeech || RULES.evidence.minSpeechFor.speed)) {
      dim.score = null;
      dim.missing = true;
      dim.notes.push('有效字数只有 ' + chars + ' 个字，算不出可信的语速。' + RULES.evidence.missingNote);
      return dim;
    }

    if (rate > R.failHigh || rate < R.failLow) {
      var dir = rate > R.failHigh ? '过快' : '过慢';
      dim.deductions.push({
        reason: '语速 ' + Math.round(rate) + ' 字/分钟，' + dir + '到理想区间（200–260）之外，直接判不及格。',
        points: 'rate', at: null, kind: 'rate'
      });
      dim.score = Math.min(dim.score, R.failScore);
    } else {
      var dev = 0;
      if (rate < R.idealMin) dev = R.idealMin - rate;
      else if (rate > R.idealMax) dev = rate - R.idealMax;
      if (dev > 0) {
        var p = Math.ceil(dev / R.step) * R.stepPenalty;
        dim.deductions.push({
          reason: '语速 ' + Math.round(rate) + ' 字/分钟，偏离理想区间 ' + Math.round(dev) + ' 字，每 10 字扣 2 分。',
          points: p, at: null, kind: 'rate'
        });
        dim.score -= p;
      }
    }

    /* 语速波动：每分钟语速的标准差 */
    var perMin = ctx.ratePerMinute || [];
    if (perMin.length >= 3) {
      var mean = perMin.reduce(function (a, b) { return a + b; }, 0) / perMin.length;
      var varr = perMin.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / perMin.length;
      var std = Math.sqrt(varr);
      dim.raw.volatility = Math.round(std);
      if (std > R.volatility) {
        dim.deductions.push({
          reason: '每分钟语速标准差 ' + Math.round(std) + ' 字，超过 45，语速忽快忽慢。',
          points: R.volatilityPenalty, at: null, kind: 'volatility'
        });
        dim.score -= R.volatilityPenalty;
      }
    }

    /* 音量稳定性 */
    var cv = ctx.audio.volumeCV || 0;
    dim.raw.volumeCV = util.round1(cv);
    if (cv > R.volumeCV) {
      dim.deductions.push({
        reason: '音量波动系数 ' + cv.toFixed(2) + '，超过 0.4，声音忽大忽小。',
        points: R.volumePenalty, at: null, kind: 'volume'
      });
      dim.score -= R.volumePenalty;
    }

    dim.score = clampScore(dim.score);
    return dim;
  }

  /* ======================================================================
     十、⑦ 仪态表情
     ====================================================================== */
  function scorePosture(ctx) {
    var dim = { key: 'posture', name: '仪态表情', weight: RULES.weights.posture, score: 100, deductions: [], notes: [], raw: {} };
    var R = RULES.posture;
    var v = ctx.visual;
    var cov = (v && v.coverage) || {};
    var pose = v && v.pose;

    function missing(reason, extra) {
      dim.score = null;
      dim.missing = true;
      dim.raw = Object.assign({ measured: false, reason: reason, coverage: cov || null, model: pose ? pose.model : null }, extra || {});
      dim.notes.push(reason + '这项不参与评分，也不当成低分。');
      return dim;
    }

    if (ctx.audioOnly && !v) {
      return missing('这次只录了音频，没有画面，站姿、手势与走位都看不见。', { audioOnly: true });
    }

    if (!v) return missing('这次没有可用的画面，站姿与手势无从判断。');

    if (!pose || !pose.available) {
      return missing('这次没跑成人体姿态分析（' + ((pose && pose.reason) || '模型没加载成功') + '），所以站姿、遮挡这些行为都判断不了。',
        { observations: { poseRate: cov.poseRate || 0, samples: cov.samples || 0 } });
    }

    if (!cov.samples) return missing('这一段没有抽到有效画面。');

    if (!cov.poseSamples) {
      return missing('仪态未评估：画面没有足够的身体关键点（抽到的 ' + cov.samples +
        ' 帧里，没有任何一帧检测到可用的人体关键点）。',
        { observations: { poseRate: 0, samples: cov.samples } });
    }

    if (cov.poseRate < R.minPoseRate || cov.poseSamples < R.minSamples) {
      return missing('抽到的 ' + cov.samples + ' 帧里只有 ' + cov.poseSamples +
        ' 帧能定位到人体（' + Math.round(cov.poseRate * 100) + '%），样本太少，不足以谈「持续」或「频繁」。',
        { observations: { poseRate: cov.poseRate, samples: cov.samples } });
    }

    /* 只看有连续帧证据的教学行为：背对讲解、讲解时遮挡板书。
       站位靠左靠右、转身板书、为板书让位——一律不扣分，所以这里没有位置项。 */
    var events = (v.behaviors || []).filter(function (b) {
      return b.kind === 'issue' && R.perEvent[b.key] != null;
    });

    var byKey = {};
    var penalty = 0;
    events.forEach(function (e) {
      var pts = Math.min(R.cap[e.key], (byKey[e.key] || 0) + R.perEvent[e.key]);
      var add = pts - (byKey[e.key] || 0);
      byKey[e.key] = pts;
      penalty += add;
      dim.deductions.push({
        reason: e.title + '（' + util.fmtAt(e.from) + ' – ' + util.fmtAt(e.to) + '）：' + e.detail,
        points: add,
        at: Math.round(e.from * 10) / 10,
        kind: 'posture',
        eventId: e.id || e.key + '@' + Math.round(e.from),
        evidence: (e.frames || []).slice(0, 2)
      });
    });

    /* ---- 有评分点就按评分点算：身体 6 分权重 + 面部 4 分权重 ----
       行为扣分（背对、遮挡）仍然照扣，只是不再从 100 一路减到不及格。 */
    var bodyPts = (ctx.visual && ctx.visual.posture && ctx.visual.posture.points) || null;
    var facePts = (ctx.visual && ctx.visual.face && ctx.visual.face.points) || null;
    if (bodyPts && bodyPts.score != null) {
      var bodyScore = clampScore(bodyPts.score - penalty);
      var parts = [{
        key: 'body', name: '身体仪态', weight: 6, score: bodyScore,
        points: bodyPts.items || [], penalty: penalty
      }];
      var total = bodyScore;
      if (facePts && facePts.score != null) {
        parts.push({ key: 'face', name: '面部动作', weight: 4, score: facePts.score, points: facePts.items || [], penalty: 0 });
        total = clampScore((bodyScore * 6 + facePts.score * 4) / 10);
      }
      dim.score = total;
      dim.raw = {
        measured: true,
        mode: 'points',
        parts: parts,
        events: events.map(function (e) {
          return { key: e.key, label: R.labels[e.key] || e.key, from: e.from, to: e.to, seconds: e.seconds, frames: (e.frames || []).slice(0, 2) };
        }),
        /* 正常行为（转身写板书、边指边讲）不写进报告，也不喂给模型：只说问题 */
      positives: [].map(function (b) {
          return { key: b.key, title: b.title, from: b.from, to: b.to };
        }),
        coverage: cov
      };
      dim.notes.push('这一项由 16 个评分点组成：身体 8 项（出镜、整段背对、站姿、走位、手势、低头、抱臂、遮挡）占 6 成，面部 8 项（露出、看镜头、表情变化、笑意、眨眼、扬眉、口型、撇嘴）占 4 成。写板书时转身、侧身写字不算问题。' +
        (facePts && facePts.score != null ? '' : '这次没跑成面部动作分析，只按身体部分算。'));
      if (penalty > 0) dim.notes.push('另有 ' + penalty + ' 分是按「连续帧证据」扣的（背对、遮挡板书），已经从身体部分里扣掉了。');
      return dim;
    }

    dim.score = clampScore(100 - penalty);

    /* 样本太薄时把上限压到 90：6 帧、覆盖 77% 的结论，只代表抽到的那几段。
       这不影响「有问题才扣分」的原则，只是不把「没看到」说成「完美」。 */
    var thin = (cov.samples < 12 || cov.sampleCoverage < 0.5);
    if (thin && dim.score > 90) {
      dim.score = 90;
      dim.notes.push('有效样本只有 ' + cov.samples + ' 帧（覆盖时长的 ' + Math.round(cov.sampleCoverage * 100) +
        '%），结论只代表抽到的时间段，这一项的上限压到 90 分。');
    }
    dim.raw = {
      measured: true,
      mode: 'behaviors',
      events: events.map(function (e) {
        return { key: e.key, label: R.labels[e.key] || e.key, from: e.from, to: e.to, seconds: e.seconds, frames: (e.frames || []).slice(0, 2) };
      }),
      /* 正常行为（转身写板书、边指边讲）不写进报告，也不喂给模型：只说问题 */
      positives: [].map(function (b) {
        return { key: b.key, title: b.title, from: b.from, to: b.to };
      }),
      coverage: cov,
      model: pose.model,
      caps: R.cap
    };

    if (!events.length) {
      dim.notes.push('在 ' + cov.samples + ' 帧（覆盖率 ' + Math.round(cov.sampleCoverage * 100) +
        '%）里没有出现「持续背向讲解」或「讲解时挡住板书」这类有连续证据的问题。这不等于满分，只是没有可扣的事实。');
    }
    dim.notes.push('只按身体姿态关键点判断教学行为：站位靠左靠右、转身写板书、为板书让位都不扣分；镜头方向不等于学生方向，' +
      '「背对镜头」只描述画面：写板书时转身、侧身写字都是正常教态，只有整段背对超过 10 秒才当作问题。');
    if (cov.sampleCoverage < 0.5) {
      dim.notes.push('这段只覆盖了 ' + Math.round(cov.sampleCoverage * 100) + '% 的时长，结论只代表抽到的时间段。');
    }
    return dim;
  }

  /* ======================================================================
     十一、板书图像自动粗评
     ====================================================================== */
  function analyzeBoard(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try { resolve(boardMetrics(img)); }
        catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  function boardMetrics(img) {
    var maxW = 720;
    var scale = Math.min(1, maxW / Math.max(1, img.width));
    var w = Math.max(2, Math.round(img.width * scale));
    var h = Math.max(2, Math.round(img.height * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    var data = ctx.getImageData(0, 0, w, h).data;
    var gray = new Float32Array(w * h);
    var sum = 0;
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      var g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gray[p] = g;
      sum += g;
    }
    var mean = sum / (w * h);
    var varSum = 0;
    for (var q = 0; q < gray.length; q++) varSum += (gray[q] - mean) * (gray[q] - mean);
    var contrast = Math.sqrt(varSum / gray.length);

    /* 极性：深色板（黑板/绿板，浅色粉笔字）还是浅色板（白板/电子板/投影，深色笔迹） */
    var polarity = mean >= 130 ? 'light' : 'dark';

    // 拉普拉斯方差：拍摄清晰度
    var lapSum = 0, lapSq = 0, lapN = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var idx = y * w + x;
        var v = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w];
        lapSum += v; lapSq += v * v; lapN++;
      }
    }
    var lapMean = lapSum / lapN;
    var sharpness = Math.sqrt(Math.max(0, lapSq / lapN - lapMean * lapMean));

    /* 笔画像素：深色板上取比背景亮很多的，浅色板上取比背景暗很多的 */
    var band = Math.max(18, contrast * 0.35);
    var inkTh = polarity === 'light' ? mean - band : mean + band;
    var rowInk = new Array(h).fill(0);
    var rowFirst = new Array(h).fill(-1);
    var inkTotal = 0;
    var runs = [];
    for (var yy = 0; yy < h; yy++) {
      var run = 0;
      for (var xx = 0; xx < w; xx++) {
        var gv = gray[yy * w + xx];
        var isInk = polarity === 'light' ? gv < inkTh : gv > inkTh;
        if (isInk) {
          rowInk[yy]++;
          run++;
          if (rowFirst[yy] < 0) rowFirst[yy] = xx;
          inkTotal++;
        } else if (run > 0) { runs.push(run); run = 0; }
      }
      if (run > 0) runs.push(run);
    }
    var inkRatio = inkTotal / (w * h);

    // 行间距规律性
    var gaps = [], gapRun = 0, lines = 0;
    for (var ry = 0; ry < h; ry++) {
      var has = rowInk[ry] > w * 0.01;
      if (has) { lines++; if (gapRun > 0) { gaps.push(gapRun); gapRun = 0; } }
      else gapRun++;
    }
    var gapCV = cv(gaps);

    // 左侧留边一致性
    var firsts = [];
    for (var fy = 0; fy < h; fy++) if (rowFirst[fy] >= 0) firsts.push(rowFirst[fy]);
    var marginCV = cv(firsts);

    // 笔画粗细一致性（只看中等长度的笔画段，避免把整行连成一段）
    var strokes = runs.filter(function (r) { return r >= 2 && r <= 14; });
    var strokeCV = cv(strokes);

    /* 读不清 ≠ 写得差：糊了、太暗、几乎没有笔画，就判定为不可评估 */
    var readable = true, reason = '';
    if (sharpness < 28) { readable = false; reason = '这张照片偏糊（清晰度 ' + Math.round(sharpness) + '），笔画边缘糊在一起，没法判断写得怎么样。'; }
    else if (inkRatio < 0.003) { readable = false; reason = '画面里几乎没有可读的笔画，可能镜头没对准板。'; }
    else if (inkRatio > 0.34) { readable = false; reason = '画面里非板面区域太多（人、桌面、字幕），没法把板书单独取出来。'; }
    else if (lines < 2) { readable = false; reason = '只看到不到两行内容，不足以评版面。'; }

    var items = {
      clarity: readable ? Math.round(util.clamp(20 * (1 - Math.min(1, strokeCV)), 4, 20)) : null,
      layout: readable ? Math.round(util.clamp(20 * (0.55 * (1 - Math.min(1, marginCV)) + 0.45 * (1 - Math.min(1, gapCV))), 4, 20)) : null,
      neat: readable ? Math.round(util.clamp(20 * (0.45 * Math.min(1, contrast / 55) + 0.55 * Math.min(1, inkRatio / 0.12)), 4, 20)) : null,
      symbols: null,     /* 符号是否规范要认字，自动测不出来 */
      structure: null    /* 推导层次要看懂内容，自动测不出来 */
    };

    return {
      readable: readable,
      reason: reason,
      polarity: polarity,
      items: items,
      metrics: {
        sharpness: Math.round(sharpness),
        contrast: Math.round(contrast),
        inkRatio: Math.round(inkRatio * 1000) / 10,
        lines: lines,
        strokeCV: Math.round(strokeCV * 100) / 100,
        leftMarginCV: Math.round(marginCV * 100) / 100,
        lineGapCV: Math.round(gapCV * 100) / 100
      }
    };
  }

  function cv(arr) {
    if (arr.length < 2) return 0;
    var m = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    if (m <= 0) return 0;
    var v = arr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / arr.length;
    return Math.sqrt(v) / m;
  }

  /* ======================================================================
     十二、建议生成（必须改 / 建议改 / 加分项）
     ====================================================================== */
  /* 每一维给一句「下一次怎么改」，报告里每张维度卡都带一条 */
  function dimFix(d, ctx) {
    if (d.missing) {
      switch (d.key) {
        case 'content':
          return '没有逐字稿，就看不出五环节在不在。下次用 Edge 打开（它带实时字幕），讲完这段话会自动被拆进「导入—探究—例题—小结—作业」。';
        case 'filler':
          return '语气词要逐字稿才数得准。开着实时字幕讲一遍，报告会把每个「这个」「然后」标到秒。';
        case 'board':
          return '板书没测到。讲完把手机横过来对着黑板拍一张，或者让录像里出现整块板书——系统会自己截一帧出来评。';
        case 'posture':
          return '没拿到可用的人体姿态（画面里没有完整的人、或这一段没有抽到帧）。机位往后退一点，让上半身和板书都在画面里，这一项才能自动评。';
        case 'speed':
          return '字数不够，语速算不出来。至少讲满 2 分钟、说够 100 字，这一项才有参考价值。';
        default:
          return '这一项这次没有采到数据，下一次把对应的素材补上就能评。';
      }
    }

    var s = d.score;
    switch (d.key) {
      case 'content': {
        var secs = (d.raw && d.raw.sections) || [];
        var missing = secs.filter(function (x) { return !x.found; }).map(function (x) { return x.name; });
        if (missing.length) {
          return '先把缺的环节补上：' + missing.join('、') +
            '。缺一个就是一个硬伤，补回去这一项立刻涨分；其它环节的顺序和过渡语已经不用动。';
        }
        if (s < 55) return '骨架有了但撑不住。导入 1 分钟 → 探究 4 分钟 → 例题 3 分钟 → 小结 40 秒 → 作业 20 秒，按时长分配重讲一遍。';
        if (s < 75) return '五环节都在，缺的是「为什么」。每个定义补一句动机：为什么想到这么定义、不用它行不行、换一种说法会漏掉什么。';
        return '结构已经站住了。下一步做例题梯度：第一问直接套定义，第二问要移项，第三问反过来问「不满足条件会怎样」。';
      }

      case 'fluency':
        if (s < 60) return '卡顿多半来自「边想边说」。把每段的第一句话背下来（只背第一句），后面自然就顺了。';
        if (s < 85) return '重复和口头禅出现在推导中间。推导时手上跟着写，让嘴跟着笔走，比边说边想要稳。';
        return '流畅度够用了。可以开始练「故意停顿」——在关键结论前停 1.5 秒，比说得更顺更能抓注意力。';

      case 'pause':
        if (s < 55) return '停顿太多太长。把长停顿的地方改成过渡句：「我们来看这个式子，它和刚才学过的…有什么联系」。';
        if (s < 80) return '停顿分布不均匀——前半段问题不大，后半段偏密。隔 2 分钟留一次 3 秒的「让学生想」的空档，其余地方少停。';
        return '停顿节奏已经像真课堂了。剩下可以练的是「问完真的等」：提问后停 3 秒，别自己抢答。';

      case 'filler':
        if (s < 55) return '语气词已经影响听感。规则很简单：想说「这个」的时候闭嘴半秒。录一遍只盯这一件事。';
        if (s < 80) return '处在临界。把「然后」换成「接下来」，「就是」换成「也就是说」，词换了语气词就自然少了。';
        return '控制得不错。保持每 10 分钟 3 次以内，把注意力放到内容上。';

      case 'board':
        if (s < 55) return '板书写满但很挤。改成「左定义、右例题、上方留图」，标题和正文用两种字号，一屏之内只讲一块。';
        if (s < 80) return '版面和清晰度还行，缺的是层次。用「一、二、」标出推导步骤，圈出最后的结论，学生抄得下来才算板书成功。';
        return '板书质量在线。可以再练一手「边讲边画函数图像」，比事先画好更有说服力。';

      case 'speed': {
        var rate = (d.raw && d.raw.rate) || 0;
        var R = RULES.speed;
        if (!rate) return '语速这一项没有算出可信数字，下一次讲满 2 分钟再看。';
        if (rate > R.idealMax) return '整体 ' + rate + ' 字/分，比理想区间 200–260 快。定义句刻意放慢，例题演算可以快一点——现在是一路快到底。';
        if (rate < R.idealMin) return '整体 ' + rate + ' 字/分，比理想区间 200–260 慢。多半是废话多、推导少：删掉重复解释，把省下的时间加到例题上。';
        if (s < 80) return '平均 ' + rate + ' 字/分，整体在 200–260 的理想区间里，问题是段落之间忽快忽慢。每讲完一环停两秒，再进下一段。';
        return '平均 ' + rate + ' 字/分，落在 200–260 的理想区间。剩下练重音：把每句话的核心词加重，学生才知道该记什么。';
      }

      case 'posture':
        if (d.missing) return '这一项这次没评估（没拿到可用的人体姿态）。想有个数，可以录一条全身入镜的视频，让整个人和板书都在画面里。';
        if (d.raw && d.raw.events && d.raw.events.length) {
          var first = d.raw.events[0];
          if (first.key === 'back_turned') {
            return '「' + first.label + '」持续了 ' + first.seconds + ' 秒。讲关键句时侧身半步、把脸和板书同时留给学生，比整段背对更稳。';
          }
          if (first.key === 'board_occluded') {
            return '「' + first.label + '」持续了 ' + first.seconds + ' 秒。写完让开半步再讲解，让最后一行和等号露出来。';
          }
          return '「' + first.label + '」出现了 ' + first.seconds + ' 秒，长句讲完停一下、换口气再继续。';
        }
        return '在有证据的范围内，没有看到持续背向或挡住板书。下一步可以练「讲重点时站定：脚不动、上身正、手指向内容」。';

      default:
        return '这一项还有提升空间，按上面列的扣分点逐条改。';
    }
  }

  function buildAdvice(dims, ctx) {
    var must = [], should = [], bonus = [];
    var byKey = {};
    dims.forEach(function (d) { byKey[d.key] = d; });

    /* 按「丢了多少分」排序，挑最划算的两项，直接给具体改法 */
    dims.filter(function (d) { return !d.missing && d.fix; })
      .map(function (d) { return { d: d, v: (100 - d.score) * d.weight }; })
      .sort(function (a, b) { return b.v - a.v; })
      .slice(0, 2)
      .forEach(function (x) { should.push(x.d.fix); });

    /* 时长与结构的整体判断 */
    var targetMin = ctx.targetMin || 10;
    var actualMin = (ctx.duration || 0) / 60;
    if (actualMin && actualMin < targetMin * 0.75) {
      should.push('这次只讲了 ' + util.round1(actualMin) + ' 分钟，目标是 ' + targetMin +
        ' 分钟。内容撑不满，后面所有分项都会被拉低：每个例题多问一句「为什么可以这样」，每个定义多给一个反例，十分钟就出来了。');
    } else if (actualMin > targetMin * 1.15) {
      should.push('讲了 ' + util.round1(actualMin) + ' 分钟，超出 ' + targetMin +
        ' 分钟的目标。多出来的时间通常花在重复例题上，砍掉一半练习、把时间给「为什么」。');
    }

    /* ---- 必须改 ---- */
    var content = byKey.content;
    var missing = content.deductions.filter(function (d) { return d.kind === 'section' && /缺失/.test(d.reason); });
    missing.slice(0, 3).forEach(function (d) {
      must.push(d.reason + '补齐这一环节后，五环节才成立。');
    });

    var rigor = content.deductions.filter(function (d) { return d.kind === 'rigor'; });
    rigor.slice(0, 2).forEach(function (d) {
      must.push('第 ' + (d.at != null ? util.fmtAt(d.at) : '—') + '：' + d.reason + '。这是概念性硬伤，评委会直接判错。');
    });

    var longPauses = dims.filter(function (d) { return d.key === 'pause'; })[0]
      .deductions.filter(function (d) { return d.kind === 'longpause'; });
    if (longPauses.length && longPauses[0].samples && longPauses[0].samples.length) {
      var lp = longPauses[0].samples[0];
      must.push('第 ' + util.fmtAt(lp.start) + ' 出现 ' + lp.duration.toFixed(1) + ' 秒长停顿。此处应改用过渡句，例如「我们来看这个式子，它和我们刚学过的…有什么联系」。');
    }

    if (byKey.filler.raw && byKey.filler.raw.count >= 9) {
      var top = byKey.filler.raw.top && byKey.filler.raw.top[0];
      must.push('语气词 ' + byKey.filler.raw.count + ' 次' + (top ? '，其中「' + top.word + '」' + top.n + ' 次' : '') +
        '。把「' + (top ? top.word : '这个') + '」换成停顿或「也就是说」，每 10 分钟压到 3 次以内。');
    }

    if (byKey.speed.deductions.some(function (d) { return d.points === 'rate'; })) {
      must.push('语速 ' + (byKey.speed.raw.rate || '—') + ' 字/分钟，脱离 200–260 的理想区间。逐段掐表练，把每分钟字数稳定在这个区间。');
    }

    if (byKey.board.raw && byKey.board.raw.missing) {
      must.push('没有提交板书照片。教师编面试板书是必考项，练完随手拍一张再复盘。');
    }

    /* ---- 建议改 ---- */
    var trans = content.deductions.filter(function (d) { return d.kind === 'transition'; });
    trans.slice(0, 2).forEach(function (d) {
      should.push('第 ' + (d.at != null ? util.fmtAt(d.at) : '—') + '：' + d.reason + '加一句「刚才我们…，那么接下来…」。');
    });

    var focus = content.deductions.filter(function (d) { return d.kind === 'focus'; })[0];
    if (focus) should.push(focus.reason + '把核心概念的推导时间拉长，压缩练习与重复。');

    var repeats = byKey.fluency.deductions.filter(function (d) { return d.kind === 'repeat'; })[0];
    if (repeats) {
      should.push(repeats.reason + '重复往往来自「怕讲不清」，改成换一种表征（图、表、例子）再讲一遍。');
    }

    if (byKey.filler.raw && byKey.filler.raw.count > 3 && byKey.filler.raw.count < 9) {
      should.push('语气词 ' + byKey.filler.raw.count + ' 次，处于临界。录完回听，把每处语气词替换成 0.5 秒的停顿。');
    }

    var volatility = byKey.speed.deductions.filter(function (d) { return d.kind === 'volatility'; })[0];
    if (volatility) should.push(volatility.reason + '按环节分配时间，导入 1 分钟、探究 4 分钟、例题 3 分钟。');

    if (byKey.posture.deductions.length && !byKey.posture.missing) {
      var praw = byKey.posture.deductions[0].reason;
      should.push((/。$/.test(praw) ? praw : praw + '。') + '先把「站定再开口」练成习惯，再考虑手势。');
    }

    /* ---- 加分项 ---- */
    if (ctx.asrOK) {
      if (content.raw && content.raw.coreRatio != null && content.raw.coreRatio >= 0.35) {
        bonus.push('核心概念占比 ' + Math.round(content.raw.coreRatio * 100) + '%，重难点是突出的。继续把「为什么」讲透。');
      }
      if (/(由.{0,6}得|设.{0,8}则|不妨设|当且仅当)/.test(ctx.fullText)) {
        bonus.push('出现了「由…得」「设…则」这类规范表述，保持住，这是数学课的语言标志。');
      }
      if (/(同学们|大家|我们一起|谁来试试|有没有不同意见)/.test(ctx.fullText)) {
        bonus.push('有明确的「对学生说话」的句子，互动感是试讲的加分点，可以再多两处。');
      }
    }
    bonus.push('板书拍照时保持手机与黑板平行，光线均匀，避免反光——这直接影响板书项的自动评分。');
    bonus.push('每次只改一个毛病，连录三遍做对比，比自己觉得「讲顺了」有效得多。');

    function trim(list, n) {
      return list.filter(function (v, i) { return list.indexOf(v) === i; }).slice(0, n || 5);
    }

    /* 「必须改」和「建议改」讲同一件事时只留必须改，否则读起来像复读机 */
    var TOPICS = ['导入', '新知探究', '例题讲解', '课堂小结', '作业布置', '语气词', '语速', '停顿', '板书', '仪态'];
    function topicsOf(s) {
      return TOPICS.filter(function (k) { return s.indexOf(k) >= 0; });
    }
    var mustUsed = {};
    must.forEach(function (s) { topicsOf(s).forEach(function (k) { mustUsed[k] = 1; }); });
    var mustKept = trim(must, 6);
    mustKept.forEach(function (s) { topicsOf(s).forEach(function (k) { mustUsed[k] = 1; }); });
    var shouldKept = trim(should, 12).filter(function (s) {
      return !topicsOf(s).some(function (k) { return mustUsed[k]; });
    });

    return {
      must: mustKept,
      should: shouldKept.slice(0, 9),
      bonus: trim(bonus, 7)
    };
  }

  /* ======================================================================
     十三、时间轴
     ====================================================================== */
  function buildTimeline(ctx, dims) {
    var items = [];
    (ctx.audio.pauses || []).forEach(function (p) {
      /* 时长兜底：外部传进来的停顿可能只带 start/end，别让时间轴因为少一个字段整份报告崩掉 */
      var dur = p.duration;
      if (typeof dur !== 'number' || !isFinite(dur)) {
        dur = (typeof p.end === 'number' && typeof p.start === 'number') ? p.end - p.start : 0;
      }
      var isLong = p.long != null ? p.long : dur > 5;
      items.push({
        t: util.round1(p.start), dur: util.round1(dur),
        type: isLong ? 'longpause' : 'pause',
        label: (isLong ? '长停顿 ' : '停顿 ') + dur.toFixed(1) + ' 秒'
      });
    });
    dims.forEach(function (d) {
      if (d.key === 'filler') {
        var fsrc = (d.raw && d.raw.samples) ? d.raw.samples.slice() : [];
        d.deductions.forEach(function (dd) {
          if (dd.kind === 'filler' && dd.samples) fsrc = fsrc.concat(dd.samples);
        });
        fsrc.forEach(function (f) {
          if (f && f.at != null) items.push({ t: util.round1(f.at), type: 'filler', label: '语气词「' + f.word + '」' });
        });
      }
      if (d.key === 'fluency') {
        d.deductions.forEach(function (dd) {
          if (dd.kind === 'repeat' && dd.samples) {
            dd.samples.forEach(function (s) {
              items.push({ t: util.round1(s.at), type: 'repeat', label: '整句重复（相似度 ' + Math.round(s.sim * 100) + '%）' });
            });
          }
          if (dd.kind === 'stall' && dd.samples) {
            dd.samples.forEach(function (s) {
              items.push({ t: util.round1(s.at), type: 'stall', label: '句中卡顿 ' + s.dur.toFixed(1) + ' 秒' });
            });
          }
        });
      }
    });
    items.sort(function (a, b) { return a.t - b.t; });
    return items;
  }

  /* ======================================================================
     十四、主入口
     ====================================================================== */
  function evaluate(input) {
    input = input || {};
    var audio = input.audio || {};
    var transcript = (input.transcript || []).filter(function (s) { return s.isFinal !== false; });
    var asrOK = !!input.asrAvailable && transcript.length > 0;
    var duration = input.duration || audio.duration || 0;
    var durationKnown = isFinite(duration) && duration > 0;
    /* 评什么：模拟试讲（10 分钟左右）/ 完整课堂（40 分钟左右）/ 教学片段（只要这一段讲得好） */
    var mode = input.mode === 'full' || input.mode === 'clip' ? input.mode : 'micro';

    var tl = T.buildTimeline(transcript, duration);
    var fullText = tl.fullText;
    var sentences = asrOK ? buildSentences(transcript) : [];

    var chars = asrOK ? T.charCount(fullText) : (audio.estimatedChars || 0);

    /* 字幕可能只盖了一部分（导出被截断、只识别了开头几分钟）。这时逐字稿的字数
       会远远少于音频里真实的音节数，语速就会被算成「一分钟 30 字」这种离谱值。
       两者差得太远就以音频估的字数为准。 */
    var audioChars = audio.estimatedChars || 0;
    var charsFromAudio = false;
    if (asrOK && audioChars > 200) {
      var ratio = chars / audioChars;
      if (ratio < 0.55 || ratio > 1.9) {
        chars = audioChars;
        charsFromAudio = true;
      }
    }
    /* 0 秒和「不知道」是两回事：真的没说话就按 0 算，不能拿时长比例顶上去 */
    var speechKnown = typeof audio.speechSeconds === 'number' && isFinite(audio.speechSeconds);
    var speechSeconds = speechKnown ? Math.max(0, audio.speechSeconds) : 0;
    if (!speechKnown && durationKnown) speechSeconds = duration * (asrOK ? 0.78 : 0.7);

    // 每分钟字数（用于语速波动）
    var ratePerMinute = [];
    if (asrOK && sentences.length) {
      var buckets = {};
      sentences.forEach(function (s) {
        var m = Math.floor(s.start / 60);
        buckets[m] = (buckets[m] || 0) + T.charCount(s.text);
      });
      Object.keys(buckets).forEach(function (k) {
        if (buckets[k] > 4) ratePerMinute.push(buckets[k]);
      });
    }

    var ctx = {
      duration: duration,
      durationKnown: durationKnown,
      mode: mode,
      speechKnown: speechKnown,
      targetMin: input.targetMin,
      asrOK: asrOK,
      fullText: fullText,
      timeAt: tl.timeAt,
      sentences: sentences,
      chars: chars,
      charsFromAudio: charsFromAudio,
      speechSeconds: speechSeconds,
      audio: audio,
      board: input.board || null,
      boardAuto: input.boardAuto || null,
      posture: input.posture || null,
      visual: input.visual || null,
      audioOnly: !!input.audioOnly,
      speech: input.speech || null,
      postureMeasured: false,
      ratePerMinute: ratePerMinute
    };

    /* 片段模式：按素材长度放宽「够不够统计」的门槛 */
    var floorSec = RULES.evidence.minSpeechFor.fluency;
    if (mode === 'clip') {
      var span = speechKnown ? Math.max(speechSeconds, duration) : duration;
      floorSec = util.clamp(span * 0.4, RULES.clipSpeechFloor.min, RULES.clipSpeechFloor.max);
    }
    ctx.minSpeech = floorSec;

    var dims = [
      scoreContent(ctx),
      scoreFluency(ctx),
      scorePause(ctx),
      scoreFiller(ctx),
      scoreBoard(ctx),
      scoreSpeed(ctx),
      scorePosture(ctx)
    ];

    /* 仪态这一项是否真的评了，以 scorePosture 的结论为准（有姿态样本、有证据门槛） */
    var postureDim = dims.filter(function (d) { return d.key === 'posture'; })[0];
    ctx.postureMeasured = !!(postureDim && !postureDim.missing);

    /* 逐字稿只覆盖一部分（字幕导出被截断、只识别了前几分钟）时，
       依赖字幕的项只能代表覆盖到的那几分钟，必须在报告里说清楚 */
    if (asrOK && transcript.length && duration > 60) {
      var trFrom = transcript[0].t || 0;
      var trTo = transcript[transcript.length - 1].t || trFrom;
      var cover = Math.max(0, Math.min(1, (trTo - trFrom) / duration));
      ctx.transcriptCoverage = cover;
      if (cover < 0.85) {
        var pct = Math.round(cover * 100);
        var range = util.fmtAt(trFrom) + '–' + util.fmtAt(trTo);
        dims.forEach(function (d) {
          if (['content', 'fluency', 'filler'].indexOf(d.key) < 0) return;
          d.raw.partial = pct;
          if (cover < 0.5) {
            /* 大半段没有逐字稿，就没法对整堂课下结论：宁可标「没测到」，也不给一个假高分 */
            d.score = null;
            d.missing = true;
            d.notes.unshift('逐字稿只覆盖了全片约 ' + pct + '% 的时长（' + range +
              '），剩下的部分没有逐字稿，这一项这次不评，不计入教学表现分。');
          } else {
            d.notes.unshift('逐字稿只覆盖了全片约 ' + pct + '% 的时长（' + range + '），这一项只按覆盖到的部分评。');
          }
        });
      }
    }

    /* 样本太短：靠统计得出的项不许拿高分，否则 30 秒的片段会显示「流畅 100 分」 */
    var spokeMin = (speechSeconds || 0) / 60;
    RULES.evidence.weakCaps.forEach(function (w) {
      if (spokeMin < w.maxSpeechMin) {
        dims.forEach(function (d) {
          if (w.keys.indexOf(d.key) >= 0 && !d.missing && d.score > w.cap) {
            d.score = w.cap;
            d.raw.cap = { value: w.cap, why: '有效讲话只有 ' + util.round1(spokeMin) + ' 分钟' };
            d.notes.push('有效讲话只有 ' + util.round1(spokeMin) + ' 分钟，样本太少，这一项最多给 ' + w.cap + ' 分。');
          }
        });
      }
    });

    /* 缺项的维度不参与加权：把它们的权重剔掉，剩下的权重重新归一。
       得到的是「已测项的表现分」；证据覆盖率单独算，用来判断能不能给等级结论。 */
    var measured = dims.filter(function (d) { return !d.missing; });
    var measuredWeight = measured.reduce(function (a, d) { return a + d.weight; }, 0);
    /* 纯语音模式：板书、仪态两项是「这个模式根本不测」，不是「没测到」。
       把它们从覆盖率分母里剔掉，否则永远只能拿 75% 覆盖率、永远不给等级。 */
    var applicableWeight = dims.reduce(function (a, d) {
      return a + (d.missing && d.raw && d.raw.audioOnly ? 0 : d.weight);
    }, 0);
    var coverage = applicableWeight > 0
      ? Math.min(1, Math.round(measuredWeight / applicableWeight * 1000) / 1000)
      : 0;
    var performance = 0;
    dims.forEach(function (d) {
      d.weighted = d.missing ? null : util.round1(d.score * d.weight);
      d.fix = dimFix(d, ctx);
      d.trace = buildTrace(d);
      if (!d.missing) performance += d.score * d.weight;
    });
    if (measuredWeight > 0.05) performance = performance / measuredWeight;
    performance = Math.round(performance * 10) / 10;

    var evidence = checkEvidence(dims, ctx, input.targetMin);
    var status = coverage >= RULES.evidence.fullCoverage ? 'complete'
      : coverage >= RULES.evidence.partialCoverage ? 'partial' : 'insufficient';
    evidence.status = status;
    evidence.coverage = util.round1(coverage * 100) / 100;

    /* 素材本身太短就别给等级结论。
       10 分钟的目标只录了 2 分钟、有效讲话不到 1 分钟——这种样本算出来的
       「45 分」对用户没有意义，只会让人以为标准坏了。
       教学片段（clip）本来就不要求时长，不套这条。 */
    var targetSec = (input.targetMin || 10) * 60;
    var mode0 = input.mode || 'micro';
    if (mode0 !== 'clip') {
      var speechSec0 = Math.round(ctx.speechSeconds || 0);
      var tooShort = (duration > 0 && duration < targetSec * 0.4) || speechSec0 < 60;
      if (tooShort) {
        status = 'insufficient';
        evidence.status = status;
        evidence.tooShort = true;
        evidence.shortReason = '这次只录了 ' + Math.round(duration) + ' 秒、有效讲话 ' +
          speechSec0 + ' 秒（目标 ' + Math.round(targetSec / 60) + ' 分钟）。样本太少，' +
          '停顿、语速、语气词这些数字都会被放得很大，所以这次<b>不出总分、不给等级</b>——' +
          '只列出已经测到的项目，供你自己对照。';
      }
    }

    var total = performance;
    var g = status === 'complete' ? grade(total) : null;
    var gradeObj = g
      ? { key: g.key, label: g.label, desc: g.desc }
      : {
        key: '—',
        label: '不足以评级',
        desc: status === 'insufficient'
          ? '可评估的维度太少（只有 ' + Math.round(coverage * 100) + '% 的权重有数据），这次不给等级结论。'
          : '只测到了 ' + Math.round(coverage * 100) + '% 的评分项，下面是已测项的参考分，不构成完整试讲的等级结论。'
      };

    var advice = buildAdvice(dims, ctx);
    var timeline = buildTimeline(ctx, dims);

    /* 报告页手动改分后要能重算建议，所以把建议依赖的 ctx 留一份轻量副本 */
    var ctxLite = {
      duration: duration,
      targetMin: input.targetMin,
      asrOK: asrOK,
      fullText: fullText,
      speechSeconds: speechSeconds
    };

    /* 语速只有在字数与讲话时长都够的时候才算得出来，否则报出去的数字是假的 */
    var rateOK = chars >= 100 && speechSeconds >= (ctx.minSpeech || RULES.evidence.minSpeechFor.speed);

    var stats = {
      chars: chars,
      rate: rateOK ? Math.round(chars / Math.max(0.3, speechSeconds / 60)) : null,
      rateOK: rateOK,
      speechMinutes: util.round1(speechSeconds / 60),
      pauses: (audio.pauses || []).length,
      longPauses: (audio.pauses || []).filter(function (p) { return p.long; }).length,
      fillers: asrOK ? T.fillers(fullText).filter(function (f) { return f.counted; }).length : null,
      density: asrOK ? util.round1(T.fillers(fullText).filter(function (f) { return f.counted; }).length / Math.max(0.5, speechSeconds / 60)) : null,
      words: chars
    };

    return {
      version: 2,
      ts: input.ts || Date.now(),
      topic: input.topic || '',
      duration: util.round1(duration),
      total: total,
      rated: status === 'complete',
      status: status,
      grade: gradeObj,
      dims: dims,
      stats: stats,
      sections: (dims[0].raw && dims[0].raw.sections) || [],
      timeline: timeline,
      advice: advice,
      board: input.board || null,
      transcript: (input.transcript || []).map(function (t) { return (t && t.text) || ''; }).join(''),
      segments: input.segments || null,
      mode: {
        asr: asrOK,
        posture: ctx.postureMeasured,
        board: !!(input.board && input.board.dataUrl),
        video: !!input.hasVideo,
        audioOnly: !!input.audioOnly,
        lesson: ctx.mode,
        speechEstimated: !speechKnown
      },
      evidence: evidence,
      ctxLite: ctxLite,
      /* 画面分析原样带回去：报告要把「看到了什么、门槛多少」摊开给用户看，
         而不是只留一条「仪态 89 分」 */
      visual: input.visual || null,
      shots: input.shots || null,
      partial: measured.length < dims.length ? {
        count: measured.length,
        total: dims.length,
        weight: Math.round(measuredWeight * 100) / 100,
        missing: dims.filter(function (d) { return d.missing; }).map(function (d) { return d.name; })
      } : null,
      issues: buildIssues(dims, ctx, { board: input.board || null, shots: input.shots || null }),
      summary: buildSummary(total, gradeObj, dims, ctx, evidence, measured)
    };
  }

  /* 不到一分钟就说秒，别写「讲了 0 分钟」 */
  function speakLen(minutes) {
    var m = minutes || 0;
    if (m >= 1) return util.round1(m) + ' 分钟';
    return Math.max(0, Math.round(m * 60)) + ' 秒';
  }

  /* 证据门槛：只判断「这次能评到什么程度」，不再给总分封顶。
     返回 {minutes, targetMin, durationKnown, durationRatio, missing[], evaluated[], coverage, status, warn} */
  function checkEvidence(dims, ctx, targetMin) {
    var E = RULES.evidence;
    var missing = [], evaluated = [], covered = 0;
    dims.forEach(function (d) {
      if (d.missing) missing.push(d.name);
      else { evaluated.push(d.name); covered += d.weight; }
    });

    var minutes = (ctx.speechSeconds || 0) / 60;
    var mode = ctx.mode || 'micro';
    var target = Math.max(1, Math.round(targetMin || (mode === 'full' ? 40 : 10)));
    var durationKnown = !!ctx.durationKnown;
    var durationRatio = durationKnown && target ? ctx.duration / (target * 60) : null;

    var warn = '';
    if (mode !== 'clip' && durationRatio != null && durationRatio < E.durationWarnRatio) {
      warn = '这段素材只有 ' + util.round1(ctx.duration / 60) + ' 分钟，比' +
        (mode === 'full' ? '一堂完整课堂' : '一次 10 分钟试讲') + '短得多，可能只截了其中一段。' +
        '如果是片段，请在开始时选「教学片段」，就不会按整堂课的要求评判。';
    }
    if (!durationKnown) {
      warn = '没能读到这段素材的总时长，涉及「时长」的判断这次全部跳过。';
    }

    return {
      minutes: util.round1(minutes),
      targetMin: target,
      mode: mode,
      durationKnown: durationKnown,
      durationRatio: durationRatio == null ? null : Math.round(durationRatio * 100) / 100,
      missing: missing,
      evaluated: evaluated,
      coverage: covered,
      status: '',
      warn: warn
    };
  }

  /* ======================================================================
     问题清单：每个扣分事件只记一条，能引用原话就引用原话，能指画面就指画面
     ====================================================================== */
  var ISSUE_WHY = {
    content: '这一处影响的是「讲完整没有」：评委按环节是否齐、例题条件是否交代、结论是否点明来判。',
    fluency: '重复、断裂、长句会让听的人抓不住句子主干，评委记笔记时容易漏。',
    pause: '超过 1.2 秒的空白会被听成「卡住了」，紧接在关键结论之后尤其明显。',
    filler: '语气词把一句话切碎，连续出现时听起来像没准备好。',
    board: '板书是评委抬头就能看到的东西，直接影响「专不专业」的第一判断。',
    speed: '语速偏离舒适区，评委记笔记会跟不上，或者觉得你在赶进度。',
    posture: '仪态只在持续影响授课时才算问题，偶尔的走动、转身写板书都不算。'
  };

  function quoteNear(sentences, at, span) {
    if (at == null || !sentences || !sentences.length) return null;
    var best = null, bestD = Infinity;
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i];
      var d = (at >= s.start && at <= s.end + 1)
        ? 0
        : Math.min(Math.abs(s.start - at), Math.abs(s.end - at));
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > (span || 10)) return null;
    return {
      quote: best.text.slice(0, 140),
      segmentIds: (best.segIds || []).slice(0, 4),
      segmentId: best.id,
      confidence: bestD === 0 ? 'high' : 'medium'
    };
  }

  /* 一条问题对应一句能照做的改法：优先用扣分项自带的建议，其次按「这一类问题」给，
     不能拿维度的整体评语来套——那会出现「语气词超标」配「控制得不错」的自相矛盾。 */
  function adviceFor(d, dd) {
    if (dd && dd.suggestion) return dd.suggestion;
    var r = String((dd && dd.reason) || '');
    /* 仪态按「具体是哪种行为」给改法：背对和挡住板书是两种毛病，改法不一样 */
    if (d.key === 'posture') {
      if (r.indexOf('背对') >= 0) {
        return '讲关键句时侧身半步，让脸和板书同时留在画面里；整段背对超过 8 秒，评委看不到你的表情和口型。';
      }
      if (r.indexOf('挡') >= 0) {
        return '写完一个式子就退半步，让等号和结论露出来再开口讲；讲的时候手臂别横在板面上。';
      }
      return '讲重点时站定：脚不动、上身正、手指向内容；走动放在环节之间。';
    }
    if (d.key === 'filler') {
      return '把「这个 / 然后 / 就是」换成半秒停顿：想清楚下一句再开口，比用语气词占位更稳。';
    }
    if (d.key === 'pause') {
      return r.indexOf('长停顿') >= 0
        ? '长停顿前先把下一句的起头想好；实在要停，就用一句过渡（「我们来看这个式子」）把空白接上。'
        : '停顿总量不是问题，问题在位置：关键结论要一口气说完再停，别停在半句上。';
    }
    if (d.key === 'speed') {
      return '语速用「讲完一个例子看一次表」控制，不要靠感觉；每段开头刻意慢下来，计算过程可以快。';
    }
    if (d.key === 'fluency') {
      return '把超过 35 字的长句拆成两句；说到一半发现说错了就直接往下接，不要回头重说。';
    }
    if (d.key === 'content' && (r.indexOf('分母') >= 0 || r.indexOf('定义域') >= 0 || r.indexOf('根号') >= 0)) {
      return '写到分式或开方，先把条件说在前面：「这里 x 不等于零，所以……」，再往下推。';
    }
    if (d.key === 'content' && r.indexOf('小结') >= 0) {
      return '补 40 秒小结：一句话回到定义、一句话点出方法、一句话连到下一节。';
    }
    if (d.key === 'content' && r.indexOf('核心') >= 0) {
      return '把讲概念与例题的时长抬上去（占全程一半以上），杂事压缩到两分钟以内。';
    }
    if (d.key === 'content' && r.indexOf('环节') >= 0) {
      return '把缺的环节补上，顺序按「导入 → 探究 → 例题 → 小结 → 作业」走，过渡语一句话带过。';
    }
    return d.fix || '';
  }

  /* 把秒数换成「最接近的那张证据帧」的帧号：报告里的问题必须能点到具体一帧 */
  function frameNear(shots, sec) {
    if (sec == null || !shots || !shots.length) return null;
    var best = null, gap = 1e9;
    shots.forEach(function (s) {
      var d = Math.abs(s.t - sec);
      if (s.img && d < gap) { gap = d; best = s; }
    });
    if (!best || gap > 6) return null;
    return best.frameId != null ? best.frameId : Math.round(best.t * 10) / 10;
  }

  function buildIssues(dims, ctx, extra) {
    var list = [];
    var seen = {};

    /* 先按维度收拢扣分点，再统一裁剪：
       1) 同一件事只留一次；2) 每个维度最多 3 条、整份最多 12 条；
       3) 「缺环节」这类没有时间点的同类项合并成一条，否则 5 个环节缺失会刷 5 条；
       4) 0 分又没有时间点的不单独成条（评分点表里已经写过）；
       5) 字幕覆盖不到一半时，文字类维度本来就不评，不再往问题清单里灌。 */
    var TEXT_DIMS = { content: 1, fluency: 1, filler: 1 };
    var cover = (ctx && ctx.transcriptCoverage != null) ? ctx.transcriptCoverage : 1;

    dims.forEach(function (d) {
      if (d.missing) return;
      if (TEXT_DIMS[d.key] && cover < 0.5) return;

      var pool = (d.deductions || []).filter(function (dd) {
        if (dd.points === 0 && (dd.at == null || !isFinite(dd.at))) return false;
        return true;
      });

      var sections = pool.filter(function (dd) { return dd.kind === 'section'; });
      var others = pool.filter(function (dd) { return dd.kind !== 'section'; });
      if (sections.length > 1) {
        others.push({
          reason: '缺少 ' + sections.length + ' 个环节：' + sections.map(function (s) {
            return String(s.reason || '').replace(/^缺少|^没有/, '');
          }).join('、'),
          points: sections.reduce(function (a, s) { return a + (typeof s.points === 'number' ? s.points : 0); }, 0),
          at: null,
          kind: 'section'
        });
      } else if (sections.length === 1) {
        others.push(sections[0]);
      }

      others.sort(function (a, b) {
        return (typeof b.points === 'number' ? b.points : 0) - (typeof a.points === 'number' ? a.points : 0);
      });
      others.slice(0, 3).forEach(function (dd, i) {
        var key = d.key + '|' + (dd.reason || '') + '|' + (dd.kind || '');
        if (seen[key]) return;      /* 同一件事只记一次 */
        seen[key] = true;

        var at = dd.at != null && isFinite(dd.at) ? util.round1(dd.at) : null;
        var hard = dd.points === 'rate' || dd.points === 'density';
        var pts = typeof dd.points === 'number' ? dd.points : null;
        var severity = hard || (pts != null && pts >= 6) ? 'high'
          : (pts != null && pts >= 3) ? 'mid' : 'low';

        /* 画面类问题不引逐字稿：那段时间人可能在写板书，嘴上什么也没说，
           硬配一句原话就是编证据。 */
        var isVisual = dd.kind === 'posture';
        var q = isVisual ? null : quoteNear(ctx.sentences, at, 10);
        var visual = null;
        if (d.key === 'board' && extra.board && extra.board.dataUrl) {
          visual = { kind: 'board', at: extra.board.at != null ? extra.board.at : null, src: extra.board.dataUrl };
        } else if (isVisual && extra.shots && extra.shots.length && at != null) {
          /* 取「事件发生那一秒」最近的一帧，再把事件区间一起带上，图上就能对上号 */
          var near = null, gap = 1e9;
          extra.shots.forEach(function (s) {
            var ddlt = Math.abs(s.t - at);
            if (s.img && ddlt < gap) { gap = ddlt; near = s; }
          });
          if (near) {
            visual = {
              kind: 'frame',
              at: util.round1(near.t),
              src: near.img,
              frameId: near.frameId || null,
              eventAt: at,
              eventId: dd.eventId || null,
              exact: gap <= 6
            };
          }
        }

        var endAt = at != null && dd.duration ? util.round1(at + dd.duration) : null;
        list.push({
          id: d.key + '-' + (i + 1),
          module: d.key,
          type: dd.kind || d.key,
          category: d.key,
          categoryName: d.name,
          severity: severity,
          start: at,
          end: endAt,
          startFrame: frameNear(extra.shots, at),
          endFrame: frameNear(extra.shots, endAt),
          ms: { start: at != null ? Math.round(at * 1000) : null, end: endAt != null ? Math.round(endAt * 1000) : null },
          evidenceImages: visual ? [visual] : [],
          segmentIds: q ? q.segmentIds : [],
          segmentId: q ? q.segmentId : null,
          quote: q ? q.quote : '',
          visualEvidence: visual,
          problem: dd.reason,
          explanation: ISSUE_WHY[d.key] || '',
          suggestion: adviceFor(d, dd),
          suggestedWording: dd.wording || '',
          confidence: q ? q.confidence : (visual ? 'medium' : 'low'),
          scoringImpact: dd.points,
          points: pts
        });
      });
    });

    /* 整份最多 12 条：超了只留扣分最重的那些 */
    list.sort(function (a, b) {
      return (typeof b.points === 'number' ? b.points : 0) - (typeof a.points === 'number' ? a.points : 0);
    });
    list = list.slice(0, 12);

    list.sort(function (a, b) {
      var r = { high: 0, mid: 1, low: 2 };
      if (r[a.severity] !== r[b.severity]) return r[a.severity] - r[b.severity];
      return (a.start || 0) - (b.start || 0);
    });
    list.forEach(function (it, i) { it.order = i + 1; });
    return list;
  }

  function buildSummary(total, gradeObj, dims, ctx, evidence, measuredDims) {
    /* 只拿「测到了」的维度比高低：没测到的项不能当最薄弱项，也不能参与排名 */
    var usable = (measuredDims || []).filter(function (d) { return !d.missing && d.score != null; });
    var worst = usable.slice().sort(function (a, b) { return a.score - b.score; })[0];
    var best = usable.slice().sort(function (a, b) { return b.score - a.score; })[0];
    var parts = [];

    if (evidence && evidence.tooShort) {
      /* 素材太短：先把「为什么不出分」说清楚，再谈别的 */
      parts.push(String(evidence.shortReason || '').replace(/<\/?b>/g, ''));
      return parts.join('');
    }

    if (evidence && evidence.status === 'complete') {
      parts.push('总分 ' + total.toFixed(1) + '，' + gradeObj.key + '（' + gradeObj.label + '）。');
    } else {
      var cov = evidence ? Math.round(evidence.coverage * 100) : 0;
      parts.push('部分评估：这次只测到 ' + usable.length + ' 项（' +
        usable.map(function (d) { return d.name; }).join('、') + '），加权覆盖 ' + cov +
        '%。下面是这几项的参考分，不构成完整试讲的等级结论。');
    }

    if (evidence && evidence.warn) parts.push(evidence.warn);

    if (worst && worst.score < 75) {
      parts.push('已测项里最弱的是「' + worst.name + '」' + worst.score + ' 分，是当前最该补的一块。');
    }
    if (best && best.score >= 85 && (!worst || worst.key !== best.key)) {
      parts.push('「' + best.name + '」' + best.score + ' 分，是这次表现最稳的地方。');
    }
    if (evidence && evidence.missing && evidence.missing.length) {
      parts.push('没测到的（' + evidence.missing.join('、') + '）不参与评分——不扣分，也不当成低水平。');
    }
    return parts.join('');
  }

  App.Scoring = {
    RULES: RULES,
    evaluate: evaluate,
    grade: grade,
    analyzeBoard: analyzeBoard,
    buildSentences: buildSentences,
    dimFix: dimFix,
    advice: buildAdvice
  };

})(window);