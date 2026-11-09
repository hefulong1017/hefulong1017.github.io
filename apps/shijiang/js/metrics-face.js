/* 试讲评分官 · 表情指标（纯计算，不依赖模型）
 *
 * 输入是逐帧的面部动作分量（App.Face.detect 的输出），输出是「看得见」的六项：
 *   微笑占比 / 中性占比 / 皱眉占比 / 抿嘴占比 / 视线方向分布 / 表情变化频率
 * 再加「连续 ≥3 秒的极端片段」（一直皱眉、一直面无表情）。
 *
 * 这里的每一条都能回溯到具体帧号；不写「看起来很紧张」这类推断。
 */
(function (window) {
  'use strict';

  var App = window.App || (window.App = {});

  var CFG = {
    /* 三个动作的判定线：都是 blendshape 分值，0..1 */
    smileOn: 0.35, browUpOn: 0.30, frownOn: 0.25,
    browOn: 0.30,
    pressOn: 0.35,
    /* 视线：眼球向下超过这个值算「看稿/低头」，向上算「看天花板」，两侧算「看旁边」 */
    gazeDownOn: 0.28,
    gazeUpOn: 0.25,
    gazeSideOn: 0.35,
    /* 连续片段：极端表情持续多久算一段 */
    runSec: 3,
    /* 两次采样间隔超过它就不把相邻帧当作连续（避免稀采样被当成「一直」） */
    maxGap: 4,
    /* 变化频率：前后两帧的主表情不同即记一次变化 */
    minSegment: 3
  };

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }

  function labelOf(b) {
    if (!b) return 'none';
    if (b.smile >= CFG.smileOn) return 'smile';
    if (b.brow >= CFG.browOn) return 'brow';
    if (b.press >= CFG.pressOn) return 'press';
    return 'neutral';
  }

  var LABEL_CN = {
    smile: '嘴角上扬',
    brow: '眉头下压',
    press: '抿嘴',
    neutral: '无明显表情变化',
    none: '没检测到脸'
  };

  function gazeOf(b) {
    if (!b) return 'none';
    if (b.gazeDown - b.gazeUp >= CFG.gazeDownOn) return 'down';
    if (b.gazeUp - b.gazeDown >= CFG.gazeUpOn) return 'up';
    if (Math.abs(b.gazeSide) >= CFG.gazeSideOn) return 'side';
    return 'camera';
  }

  var GAZE_CN = { camera: '看向镜头', down: '低头看稿', up: '视线上扬', side: '看向侧方', none: '没检测到脸' };

  /* 把逐帧记录压成连续片段 */
  function runsOf(list, test, gapLimit) {
    var runs = [];
    var cur = null;
    list.forEach(function (f) {
      if (!f.present || !test(f)) {
        if (cur) { runs.push(cur); cur = null; }
        return;
      }
      if (cur && (f.t - cur.end) <= (gapLimit || CFG.maxGap)) {
        cur.end = f.t;
        cur.n++;
      } else {
        if (cur) runs.push(cur);
        cur = { from: f.t, end: f.t, n: 1 };
      }
    });
    if (cur) runs.push(cur);
    return runs.map(function (r) { return { from: r1(r.from), to: r1(r.end), dur: r1(r.end - r.from), frames: r.n }; });
  }

  function analyze(frames, opts) {
    opts = opts || {};
    frames = (frames || []).slice().sort(function (a, b) { return a.t - b.t; });
    var withFace = frames.filter(function (f) { return f.present && f.blends; });
    var step = opts.step || 1;

    if (!frames.length) {
      return { available: false, reason: '没有抽到帧', total: 0, withFace: 0, step: step, metrics: [], cfg: CFG };
    }
    if (!withFace.length) {
      return {
        available: false,
        reason: '逐帧都没有检测到人脸（可能一直背对黑板，或离镜头太远）',
        total: frames.length, withFace: 0, step: step, metrics: [], cfg: CFG
      };
    }

    var n = withFace.length;
    var smile = 0, brow = 0, press = 0;
    var gazeCount = { camera: 0, down: 0, up: 0, side: 0 };
    var labels = [];

    withFace.forEach(function (f) {
      var b = f.blends;
      if (b.smile >= CFG.smileOn) smile++;
      if (b.brow >= CFG.browOn) brow++;
      if (b.press >= CFG.pressOn) press++;
      gazeCount[gazeOf(b)] = (gazeCount[gazeOf(b)] || 0) + 1;
      labels.push({ t: f.t, label: labelOf(b) });
    });

    /* 变化频率：主表情每变一次记一次，折成「每分钟」 */
    var changes = 0;
    for (var i = 1; i < labels.length; i++) {
      if (labels[i].label !== labels[i - 1].label) changes++;
    }
    var spanSec = Math.max(1, withFace[n - 1].t - withFace[0].t);
    var perMin = changes / spanSec * 60;

    var neutralCnt = labels.filter(function (l) { return l.label === 'neutral'; }).length;
    var pct = function (c) { return Math.round(c / n * 1000) / 10; };

    var smileRuns = runsOf(withFace, function (f) { return f.blends.smile >= CFG.smileOn; });
    var browRuns = runsOf(withFace, function (f) { return f.blends.brow >= CFG.browOn; });
    var neutralRuns = runsOf(withFace, function (f) { return labelOf(f.blends) === 'neutral'; });
    var downRuns = runsOf(withFace, function (f) { return gazeOf(f.blends) === 'down'; });

    var longRuns = [];
    function pushRuns(list, kind, text) {
      list.forEach(function (r) {
        if (r.dur >= CFG.runSec) longRuns.push({ kind: kind, from: r.from, to: r.to, dur: r.dur, text: text });
      });
    }
    pushRuns(browRuns, 'brow', '连续皱眉');
    pushRuns(neutralRuns, 'neutral', '连续没有表情变化');
    pushRuns(downRuns, 'down', '连续低头看稿');
    longRuns.sort(function (a, b) { return b.dur - a.dur; });

    /* ---- 眨眼、眉毛上扬、嘴角下撇、口型幅度 ----
       这几个都能直接在 blendshape 上量，不涉及情绪命名。 */
    var blinks = 0;
    for (var bi = 1; bi < withFace.length; bi++) {
      var bPrev = withFace[bi - 1].blends.blink || 0;
      var bNow = withFace[bi].blends.blink || 0;
      if (bPrev < 0.5 && bNow >= 0.5) blinks++;
    }
    var blinkPerMin = blinks / spanSec * 60;

    var browUpCnt = 0, frownCnt = 0;
    var jaws = [];
    withFace.forEach(function (f) {
      if ((f.blends.browUp || 0) >= CFG.browUpOn) browUpCnt++;
      if ((f.blends.frown || 0) >= CFG.frownOn) frownCnt++;
      if (f.blends.jaw != null) jaws.push(f.blends.jaw);
    });
    var jawMean = jaws.length ? jaws.reduce(function (a, b) { return a + b; }, 0) / jaws.length : null;
    var jawStd = null;
    if (jaws.length > 1 && jawMean != null) {
      var jv = jaws.reduce(function (a, b) { return a + (b - jawMean) * (b - jawMean); }, 0) / jaws.length;
      jawStd = Math.sqrt(jv);
    }

    var metrics = [
      {
        key: 'smile', name: '微笑占比', value: pct(smile), unit: '%',
        threshold: '≥20% 更亲切（不是硬指标）',
        abnormal: false,
        formula: '嘴角上扬分值 ≥' + CFG.smileOn + ' 的帧 ÷ 检测到脸的帧（' + smile + '/' + n + '）'
      },
      {
        key: 'brow', name: '皱眉占比', value: pct(brow), unit: '%',
        threshold: '≤25%',
        abnormal: pct(brow) > 25,
        formula: '眉头下压分值 ≥' + CFG.browOn + ' 的帧 ÷ 检测到脸的帧（' + brow + '/' + n + '）'
      },
      {
        key: 'press', name: '抿嘴占比', value: pct(press), unit: '%',
        threshold: '≤30%',
        abnormal: pct(press) > 30,
        formula: '抿嘴/上下唇压紧分值 ≥' + CFG.pressOn + ' 的帧 ÷ 检测到脸的帧（' + press + '/' + n + '）'
      },
      {
        key: 'neutral', name: '无明显表情变化', value: pct(neutralCnt), unit: '%',
        threshold: '无硬门槛，长时间不变更值得注意',
        abnormal: false,
        formula: '既没上扬、也没皱眉、也没抿嘴的帧 ÷ 检测到脸的帧（' + neutralCnt + '/' + n + '）'
      },
      {
        key: 'gaze', name: '视线方向', value: pct(gazeCount.camera || 0), unit: '% 看镜头',
        threshold: '看稿占比 ≤40%',
        abnormal: pct(gazeCount.down || 0) > 40,
        formula: '看向镜头 ' + (gazeCount.camera || 0) + ' 帧、低头看稿 ' + (gazeCount.down || 0) +
          ' 帧、视线上扬 ' + (gazeCount.up || 0) + ' 帧、看向侧方 ' + (gazeCount.side || 0) + ' 帧'
      },
      {
        key: 'changes', name: '表情变化频率', value: Math.round(perMin * 10) / 10, unit: '次/分',
        threshold: '≥3 次/分更自然',
        abnormal: false,
        formula: '主表情相邻帧变化 ' + changes + ' 次 ÷ 有效时长 ' + r1(spanSec) + ' 秒'
      },
      {
        key: 'blink', name: '眨眼频率', value: step > 2 ? null : Math.round(blinkPerMin * 10) / 10, unit: '次/分',
        threshold: '10–30 次/分（人正常眨眼区间）',
        abnormal: step <= 2 && (blinkPerMin < 6 || blinkPerMin > 45),
        formula: step > 2
          ? '采样间隔 ' + r1(step) + ' 秒，眨一次眼睛要 0.1–0.4 秒，这么稀的采样根本抓不到，这一项不算'
          : '眼睑闭合分值由低变高的次数 ÷ 有效时长（' + blinks + ' 次 / ' + r1(spanSec) + ' 秒）'
      },
      {
        key: 'browUp', name: '扬眉占比', value: pct(browUpCnt), unit: '%',
        threshold: '≥5% 说明讲到重点时有强调动作',
        abnormal: false,
        formula: '眉心上提分值 ≥' + CFG.browUpOn + ' 的帧 ÷ 检测到脸的帧（' + browUpCnt + '/' + n + '）'
      },
      {
        key: 'frown', name: '嘴角下撇占比', value: pct(frownCnt), unit: '%',
        threshold: '≤15%',
        abnormal: pct(frownCnt) > 15,
        formula: '嘴角下撇分值 ≥' + CFG.frownOn + ' 的帧 ÷ 检测到脸的帧（' + frownCnt + '/' + n + '）'
      },
      {
        key: 'jaw', name: '口型幅度', value: jawStd == null ? null : Math.round(jawStd * 1000) / 10, unit: '',
        threshold: '≥30（张口变化幅度）',
        abnormal: jawStd != null && jawStd * 1000 < 30,
        formula: jawStd == null
          ? '没有可用的张口数据'
          : '张口分值（0–1）的标准差 ×1000；说话时口型一直不动，听起来会像含着东西'
      }
    ];

    return {
      available: true,
      total: frames.length,
      withFace: n,
      faceRate: Math.round(n / frames.length * 1000) / 10,
      step: step,
      metrics: metrics,
      gaze: gazeCount,
      labels: labels,
      longRuns: longRuns.slice(0, 6),
      /* 稠稀采样要说清楚，不然「变化频率」会被误解 */
      density: step >= 3 ? 'sparse' : 'dense',
      note: step >= 3
        ? '这次采样间隔约 ' + step + ' 秒，表情只取样到 ' + n + ' 帧；变化频率按取样结果算，会偏低一些（改精细模式更准）。'
        : '',
      series: labels.map(function (l) { return { t: l.t, label: l.label }; }),
      cfg: CFG
    };
  }

  function clamp100(v) { return Math.max(0, Math.min(100, Math.round(v))); }
  function band(v, good, bad) {
    if (v == null) return null;
    if (v <= good) return 100;
    if (v >= bad) return 0;
    return clamp100((bad - v) / (bad - good) * 100);
  }
  function bandRev(v, bad, good) {
    if (v == null) return null;
    if (v >= good) return 100;
    if (v <= bad) return 0;
    return clamp100((v - bad) / (good - bad) * 100);
  }

  /* 面部评分点：每一项都写清「拿什么算的」，量不出来的 weight=0 */
  function points(f) {
    if (!f || !f.available) return { items: [], score: null, weight: 0 };
    var by = {};
    (f.metrics || []).forEach(function (x) { by[x.key] = x.value; });
    var g = f.gaze || {};
    var n = f.withFace || 1;
    var cameraShare = Math.round((g.camera || 0) / n * 1000) / 10;

    var items = [
      {
        key: 'present', name: '脸在画面里', weight: 2,
        score: bandRev(f.faceRate, 20, 60),
        detail: '检测到脸 ' + f.withFace + '/' + f.total + ' 帧（' + f.faceRate + '%，门槛 60%）'
      },
      {
        key: 'camera', name: '看镜头', weight: 2,
        score: bandRev(cameraShare, 15, 40),
        detail: '看镜头 ' + cameraShare + '%（门槛 40%），低头看稿 ' +
          Math.round((g.down || 0) / n * 1000) / 10 + '%'
      },
      {
        key: 'changes', name: '表情有变化', weight: 1.5,
        score: bandRev(by.changes, 1, 3),
        detail: '主表情每分钟变化 ' + (by.changes == null ? '—' : by.changes) + ' 次（门槛 3）'
      },
      {
        key: 'smile', name: '有笑意', weight: 1,
        score: bandRev(by.smile, 5, 20),
        detail: '嘴角上扬的帧占 ' + (by.smile == null ? '—' : by.smile) + '%（20% 以上更亲切）'
      },
      {
        key: 'blink', name: '眨眼自然', weight: 1.5,
        score: by.blink == null ? null : (by.blink < 10 ? bandRev(by.blink, 3, 10) : by.blink > 30 ? band(by.blink, 30, 55) : 100),
        detail: by.blink == null ? '采样太稀，抓不到眨眼' : '眨眼 ' + by.blink + ' 次/分（正常 10–30）'
      },
      {
        key: 'browUp', name: '有强调动作', weight: 1,
        score: bandRev(by.browUp, 0, 5),
        detail: '扬眉帧占 ' + (by.browUp == null ? '—' : by.browUp) + '%（5% 以上说明讲到重点有强调）'
      },
      {
        key: 'jaw', name: '口型清楚', weight: 1.5,
        /* 采样间隔超过 2 秒时，两句之间张没张嘴根本看不见，这一项不评而不是判 0 */
        score: (f.step != null && f.step > 2) ? null : bandRev(by.jaw, 10, 30),
        detail: (f.step != null && f.step > 2)
          ? '采样间隔 ' + (Math.round(f.step * 10) / 10) + ' 秒，抓不到口型变化，这一项不评'
          : '张口幅度波动 ' + (by.jaw == null ? '—' : by.jaw) + '（门槛 30；太低像含着东西说话）'
      },
      {
        key: 'frown', name: '不常撇嘴', weight: 1,
        score: band(by.frown, 5, 15),
        detail: '嘴角下撇的帧占 ' + (by.frown == null ? '—' : by.frown) + '%（门槛 15%）'
      }
    ];

    var wsum = 0, ssum = 0;
    items.forEach(function (it) {
      if (it.score == null) { it.weightUsed = 0; return; }
      it.weightUsed = it.weight;
      wsum += it.weight;
      ssum += it.weight * it.score;
    });
    return { items: items, score: wsum ? clamp100(ssum / wsum) : null, weight: wsum };
  }

  App.MetricsFace = {
    analyze: analyze,
    points: points,
    CFG: CFG,
    _labelOf: labelOf,
    _gazeOf: gazeOf,
    _runsOf: runsOf,
    LABEL_CN: LABEL_CN,
    GAZE_CN: GAZE_CN
  };
})(window);
