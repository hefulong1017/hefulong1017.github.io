/* ==========================================================================
   metrics-pose.js — 仪态八项指标（纯计算，输入是逐帧关键点序列）
   --------------------------------------------------------------------------
   按《改造提示词》第三节：所有指标逐帧算，输出时间序列；不用多模态模型「看」姿态。

   指标与口径（全部可复现，同一段素材算两次结果一致）：
     1. 出镜率        双肩＋双髋都可见的帧数 ÷ 总帧数，<60% 异常
     2. 正面朝向占比   肩宽/躯干高 ≥0.32 的帧占比（正面时肩最宽），<50% 异常
     3. 侧身/背身时长  肩宽/躯干高 <0.18 的连续时长，单次 >5 秒异常
     4. 站姿稳定性     肩线倾角标准差（只统计肩宽足够的帧），>8° 记为晃动
     5. 重心漂移       髋部中点横向位移标准差 ÷ 画面宽度，>15% 记为走动过多
     6. 手势幅度       手腕每秒位移 ÷ 画面高度，>20%/秒 记为幅度过大
     7. 低头看稿时长   鼻尖高出肩线的距离 ÷ 躯干高 <0.12 的连续时长，单次 >8 秒记为念稿
     8. 身体遮挡板书   人体框与板书框 IoU >0.15 的帧占比

   为什么用「肩宽 ÷ 躯干高」而不是鼻尖角度判朝向：实拍里人在画面中很小，
   肩宽只有 0.002–0.13（归一化坐标），用肩宽归一化的横向偏移会被放大到 ±90°，
   而躯干高（肩中点到髋中点）稳定得多（0.13–0.30）。比值是身体自身比例，
   与远近无关：正面≈0.45、侧身≈0.25、背身≈0.05。
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App || (window.App = {});

  /* MediaPipe Pose 的 33 点下标 */
  var L = {
    nose: 0,
    earL: 7, earR: 8,
    shoulderL: 11, shoulderR: 12,
    elbowL: 13, elbowR: 14,
    wristL: 15, wristR: 16,
    hipL: 23, hipR: 24,
    kneeL: 25, kneeR: 26,
    ankleL: 27, ankleR: 28
  };

  var CFG = {
    vis: 0.5,
    frontRatio: 0.32,        /* 肩宽/躯干高 ≥ 0.32 算正面 */
    sideRatio: 0.18,         /* < 0.18 算侧身或背身 */
    sideRunSec: 10,          /* 单次「整段背对」超过 10 秒才算问题：写板书转身、侧身写字本来就正常 */
    armsGap: 0.10,           /* 两手腕间距 < 画面宽 10% 且都在躯干高度内 → 抱臂/插手 */
    shoulderStd: 8,          /* 肩线倾角标准差 > 8° 算晃动 */
    minSpanForAngle: 0.05,   /* 肩宽小于这个值（人很小/侧身）时肩线角不可信，不统计 */
    driftRatio: 0.15,        /* 髋部横向漂移 > 画面宽 15% 算走动过多 */
    gesturePerSec: 0.20,     /* 手腕每秒位移 > 画面高 20% 算幅度过大 */
    minStepForGesture: 3,    /* 采样间隔 > 3 秒时手势看不出来，只出说明不出分 */
    downNoseUp: 0.12,        /* 鼻尖高出肩线不足躯干高 12% 算低头 */
    downRunSec: 8,           /* 单次低头 > 8 秒算念稿 */
    boardIou: 0.15           /* 人体框与板书框 IoU > 0.15 算遮挡 */
  };

  function deg(rad) { return rad * 180 / Math.PI; }
  function round(v, n) { var p = Math.pow(10, n == null ? 2 : n); return Math.round(v * p) / p; }

  function P(lm, i) {
    if (!lm || !lm[i]) return null;
    var p = lm[i];
    if (p.visibility != null && p.visibility < CFG.vis) return null;
    return p;
  }

  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  /* 单帧几何量 */
  function frameGeom(f) {
    var lm = f.landmarks;
    if (!lm || !lm.length) return null;

    var sl = P(lm, L.shoulderL), sr = P(lm, L.shoulderR);
    var hl = P(lm, L.hipL), hr = P(lm, L.hipR);
    var nose = P(lm, L.nose);
    var wl = P(lm, L.wristL), wr = P(lm, L.wristR);

    var hasTorso = !!(sl && sr && hl && hr);
    var shMid = (sl && sr) ? mid(sl, sr) : null;
    var hipMid = (hl && hr) ? mid(hl, hr) : null;
    var span = (sl && sr) ? Math.abs(sl.x - sr.x) : null;
    var torso = (shMid && hipMid) ? Math.abs(hipMid.y - shMid.y) : null;

    /* 朝向比值：正面≈0.45，侧身≈0.25，背身≈0.05 */
    var facingRatio = (span != null && torso > 0.02) ? span / torso : null;

    /* 低头：鼻尖高出肩线多少（以躯干高为单位）。自然站姿≈0.30–0.45，低头≈0 或负 */
    var noseUp = (nose && shMid && torso > 0.02) ? (shMid.y - nose.y) / torso : null;

    /* 肩线倾角：肩宽太小时 atan2 会乱跳（±180 翻转），只保留可信帧并折到 ±90 */
    var shoulderAngle = null;
    if (sl && sr && span != null && span >= CFG.minSpanForAngle) {
      var a = deg(Math.atan2(sr.y - sl.y, sr.x - sl.x));
      if (a > 90) a -= 180;
      if (a < -90) a += 180;
      shoulderAngle = round(a, 1);
    }

    var hipX = hipMid ? round(hipMid.x, 4) : null;

    /* 人体框：可见关键点包围盒 */
    var minX = 1, maxX = 0, minY = 1, maxY = 0, seen = 0;
    for (var i = 0; i < lm.length; i++) {
      var p = lm[i];
      if (!p || (p.visibility != null && p.visibility < CFG.vis)) continue;
      seen++;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      t: f.t,
      upperOK: hasTorso,
      span: span == null ? null : round(span, 4),
      torso: torso == null ? null : round(torso, 4),
      facingRatio: facingRatio == null ? null : round(facingRatio, 2),
      noseUp: noseUp == null ? null : round(noseUp, 2),
      shoulderAngle: shoulderAngle,
      armsCrossed: (function () {
        if (!wl || !wr || !shMid || !hipMid || !torso) return null;
        /* 抱臂/插手：两只手都收在身体中线附近、胸口到小腹这一段，
           而且彼此靠得很近。举着粉笔写板书、手背在身后都不算。 */
        var gap = Math.abs(wl.x - wr.x);
        var yTop = shMid.y + torso * 0.20;
        var yBot = hipMid.y + torso * 0.10;
        var nearCenter = Math.abs(wl.x - hipMid.x) < 0.15 && Math.abs(wr.x - hipMid.x) < 0.15;
        var inTorso = (wl.y > yTop && wl.y < yBot) && (wr.y > yTop && wr.y < yBot);
        return !!(gap < CFG.armsGap && inTorso && nearCenter);
      })(),
      hipX: hipX,
      wristL: wl ? { x: round(wl.x, 4), y: round(wl.y, 4) } : null,
      wristR: wr ? { x: round(wr.x, 4), y: round(wr.y, 4) } : null,
      bbox: seen >= 4 && maxX > minX && maxY > minY
        ? { x: round(minX, 4), y: round(minY, 4), w: round(maxX - minX, 4), h: round(maxY - minY, 4) }
        : null,
      region: f.boardRegion || null
    };
  }

  function iou(a, b) {
    if (!a || !b) return 0;
    var ax2 = a.x + a.w, ay2 = a.y + a.h;
    var bx2 = b.x + b.w, by2 = b.y + b.h;
    var ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
    var inter = ix * iy;
    var uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  }

  function std(arr) {
    if (!arr.length) return 0;
    var m = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    var v = arr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / arr.length;
    return Math.sqrt(v);
  }

  function runsOf(list, test, minDur) {
    var out = [], cur = null;
    list.forEach(function (item) {
      if (test(item)) {
        if (!cur) cur = { from: item.t, to: item.t, items: [item] };
        else { cur.to = item.t; cur.items.push(item); }
      } else if (cur) {
        cur.dur = round(cur.to - cur.from, 1);
        if (!minDur || cur.dur >= minDur) out.push(cur);
        cur = null;
      }
    });
    if (cur) {
      cur.dur = round(cur.to - cur.from, 1);
      if (!minDur || cur.dur >= minDur) out.push(cur);
    }
    return out;
  }

  function sumDur(runs, step) {
    return runs.reduce(function (s, r) { return s + r.dur + (step || 0) * 0.5; }, 0);
  }

  function analyze(frames, opts) {
    opts = opts || {};
    var total = (frames || []).length;
    if (!total) return { available: false, reason: '没有抽到帧', total: 0 };

    var geoms = (frames || []).map(frameGeom).filter(Boolean);
    var step = opts.step || (frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 1);
    var boardRect = opts.board || null;

    var withPose = geoms.filter(function (g) { return g.facingRatio != null || g.noseUp != null || g.upperOK; });
    var available = withPose.length > 0;

    /* 1. 出镜率 */
    var upperOK = geoms.filter(function (g) { return g.upperOK; }).length;
    var onScreenRate = upperOK / total;

    /* 2. 正面朝向：肩宽/躯干高 */
    var ratioFrames = geoms.filter(function (g) { return g.facingRatio != null; });
    var front = ratioFrames.filter(function (g) { return g.facingRatio >= CFG.frontRatio; }).length;
    var facingRate = ratioFrames.length ? front / ratioFrames.length : 0;

    /* 3. 侧身/背身（含「转身写板书」，报告里要说清楚是转身还是背对） */
    var sideAll = runsOf(ratioFrames, function (g) { return g.facingRatio < CFG.sideRatio; }, 0);
    var sideLong = sideAll.filter(function (r) { return r.dur >= CFG.sideRunSec; });
    var sideSeconds = sumDur(sideAll, step);

    /* 4. 站姿稳定性 */
    var angles = geoms.filter(function (g) { return g.shoulderAngle != null; })
      .map(function (g) { return g.shoulderAngle; });
    var shoulderStd = std(angles);

    /* 5. 重心漂移 */
    var hips = geoms.filter(function (g) { return g.hipX != null; }).map(function (g) { return g.hipX; });
    var hipStd = std(hips);

    /* 6. 手势幅度：每秒位移（采样太稀时不出数值） */
    var gestureFine = step <= CFG.minStepForGesture;
    var gestureMax = 0, gestureBig = 0;
    if (gestureFine) {
      for (var i = 1; i < geoms.length; i++) {
        var a = geoms[i - 1], b = geoms[i];
        var d = 0;
        if (a.wristL && b.wristL) d = Math.max(d, Math.hypot(b.wristL.x - a.wristL.x, b.wristL.y - a.wristL.y));
        if (a.wristR && b.wristR) d = Math.max(d, Math.hypot(b.wristR.x - a.wristR.x, b.wristR.y - a.wristR.y));
        if (!d) continue;
        var perSec = d / Math.max(0.2, b.t - a.t);
        if (perSec > gestureMax) gestureMax = perSec;
        if (perSec > CFG.gesturePerSec) gestureBig++;
      }
    }

    /* 7. 低头看稿 */
    var pitchFrames = geoms.filter(function (g) { return g.noseUp != null; });
    var downAll = runsOf(pitchFrames, function (g) { return g.noseUp < CFG.downNoseUp; }, 0);
    var downLong = downAll.filter(function (r) { return r.dur >= CFG.downRunSec; });
    var downSeconds = sumDur(downAll, step);

    /* 8. 遮挡板书 */
    var blocked = geoms.filter(function (g) {
      var rect = g.region || boardRect;
      return g.bbox && rect && iou(g.bbox, { x: rect.x, y: rect.y, w: rect.w, h: rect.h }) > CFG.boardIou;
    });
    var blockRate = available ? blocked.length / geoms.length : 0;

    /* 9. 抱臂/插手：双手距离过近且都在躯干高度内 */
    /* 抱臂用「持续时长」而不是「帧占比」：3 秒一帧时手一抖就成一帧，
       占比会被噪声拉高；只有连着几帧都是抱臂才算真的抱了一会儿。 */
    var armsSeq = geoms.filter(function (g) { return g.armsCrossed != null; })
      .map(function (g) { return { t: g.t, v: !!g.armsCrossed }; });
    var armsRuns = runsOf(armsSeq, function (x) { return x.v; }, 0);
    var armsMax = armsRuns.length ? armsRuns.reduce(function (a, b) { return Math.max(a, b.dur); }, 0) : 0;
    var armsRate = armsSeq.length ? armsSeq.filter(function (x) { return x.v; }).length / armsSeq.length : null;

    var series = {
      t: geoms.map(function (g) { return g.t; }),
      facing: geoms.map(function (g) { return g.facingRatio; }),
      noseUp: geoms.map(function (g) { return g.noseUp; }),
      shoulder: geoms.map(function (g) { return g.shoulderAngle; }),
      hip: geoms.map(function (g) { return g.hipX; }),
      upper: geoms.map(function (g) { return g.upperOK ? 1 : 0; })
    };

    var metrics = [
      {
        key: 'onScreen', name: '出镜率',
        value: round(onScreenRate * 100, 1), unit: '%',
        formula: '双肩＋双髋都可见的帧数 ÷ 总帧数（' + upperOK + '/' + total + '）',
        threshold: '≥60%', abnormal: onScreenRate < 0.6
      },
      {
        key: 'facing', name: '正面朝向占比',
        value: round(facingRate * 100, 1), unit: '%',
        formula: '肩宽÷躯干高 ≥ ' + CFG.frontRatio + ' 的帧 ÷ 可判定的帧（' + front + '/' + ratioFrames.length + '）',
        threshold: '≥50%', abnormal: facingRate < 0.5
      },
      {
        key: 'side', name: '整段背对时长',
        value: round(sideSeconds, 1), unit: '秒',
        formula: '肩宽÷躯干高 < ' + CFG.sideRatio + '（整个人对着黑板）的累计时长。写板书转身、侧身写字都不算问题，只有单次超过 ' + CFG.sideRunSec + ' 秒才记',
        threshold: '单次 ≤' + CFG.sideRunSec + ' 秒', abnormal: sideLong.length > 0
      },
      {
        key: 'stance', name: '站姿稳定性',
        value: round(shoulderStd, 1), unit: '°',
        formula: '肩线倾角标准差（' + angles.length + ' 帧可信）',
        threshold: '≤8°', abnormal: shoulderStd > CFG.shoulderStd
      },
      {
        key: 'drift', name: '重心漂移',
        value: round(hipStd * 100, 1), unit: '% 画面宽',
        formula: '髋部中点横向位移标准差 ÷ 画面宽度',
        threshold: '≤15%', abnormal: hipStd > CFG.driftRatio
      },
      {
        key: 'gesture', name: '手势幅度',
        value: gestureFine ? round(gestureMax * 100, 1) : null, unit: '% 画面高/秒',
        formula: gestureFine
          ? '相邻帧手腕位移 ÷ 时间；> ' + CFG.gesturePerSec * 100 + '%/秒 记为幅度过大（' + gestureBig + ' 次）'
          : '采样间隔 ' + round(step, 1) + ' 秒，太稀，手势算不准（改「精细」模式才评）',
        threshold: '≤20%/秒', abnormal: gestureFine ? gestureMax > CFG.gesturePerSec : false
      },
      {
        key: 'down', name: '低头看稿时长',
        value: round(downSeconds, 1), unit: '秒',
        formula: '鼻尖高出肩线 < 躯干高 ' + CFG.downNoseUp + ' 倍的累计时长；单次 > ' + CFG.downRunSec + ' 秒记为念稿',
        threshold: '单次 ≤8 秒', abnormal: downLong.length > 0
      },
      {
        key: 'block', name: '身体遮挡板书',
        value: round(blockRate * 100, 1), unit: '% 帧',
        formula: '人体框与板书框 IoU > ' + CFG.boardIou + ' 的帧占比',
        threshold: '≤10%', abnormal: blockRate > 0.1
      },
      {
        key: 'arms', name: '抱臂／插手最长时长',
        value: armsRate == null ? null : round(armsMax, 1), unit: '秒',
        formula: '两手腕都收在身体中线附近（±15% 画面宽）、胸口到小腹之间、彼此距离 < ' + CFG.armsGap + ' 的连续时长；手抖一下不算，要连着 3 秒以上',
        threshold: '≤3 秒', abnormal: armsRate == null ? false : armsMax > 3
      }
    ];

    return {
      available: available,
      total: total,
      withPose: withPose.length,
      step: round(step, 2),
      metrics: metrics,
      series: series,
      sideRuns: sideAll.map(function (r) { return { from: r.from, to: r.to, dur: r.dur }; }),
      sideLong: sideLong.map(function (r) { return { from: r.from, to: r.to, dur: r.dur }; }),
      downRuns: downAll.map(function (r) { return { from: r.from, to: r.to, dur: r.dur }; }),
      downLong: downLong.map(function (r) { return { from: r.from, to: r.to, dur: r.dur }; }),
      blockedFrames: blocked.map(function (g) { return g.t; }),
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

  /* 身体仪态评分点：全部来自关键点序列，量不出来的 weight=0 */
  function points(p) {
    if (!p || !p.available) return { items: [], score: null, weight: 0 };
    var by = {};
    (p.metrics || []).forEach(function (x) { by[x.key] = x.value; });
    var runs = function (list) {
      var arr = (list || []).filter(function (r) { return r.dur >= 1; });
      return arr.length ? arr.reduce(function (a, b) { return Math.max(a, b.dur); }, 0) : 0;
    };
    var sideMax = runs(p.sideRuns);
    var downMax = runs(p.downRuns);

    var items = [
      {
        key: 'onScreen', name: '一直在画面里', weight: 2,
        score: bandRev(by.onScreen, 30, 75),
        detail: '出镜率 ' + (by.onScreen == null ? '—' : by.onScreen) + '%（门槛 60% 以上）'
      },
      {
        key: 'back', name: '不整段背对', weight: 2,
        score: by.side == null ? null : band(sideMax, CFG.sideRunSec, CFG.sideRunSec * 2),
        detail: sideMax > 0
          ? '最长一段背对 ' + Math.round(sideMax) + ' 秒（单次门槛 ' + CFG.sideRunSec + ' 秒；写板书转身、侧身写字不算）'
          : '没有超过 1 秒的整段背对（写板书时转身不算问题）'
      },
      {
        key: 'stance', name: '站姿挺拔', weight: 1.5,
        score: band(by.stance, 8, 20),
        detail: '肩线倾斜标准差 ' + (by.stance == null ? '—' : by.stance) + '°（门槛 8°，越小越稳）'
      },
      {
        key: 'drift', name: '走位适度', weight: 1,
        score: band(by.drift, 15, 35),
        detail: '重心横向漂移 ' + (by.drift == null ? '—' : by.drift) + '% 画面宽（门槛 15%，站定讲也可以）'
      },
      {
        key: 'gesture', name: '手势自然', weight: 1.5,
        score: bandRev(by.gesture, 2, 6),
        detail: by.gesture == null ? '采样太稀或没测到手腕，手势不算' : '手部每秒位移 ' + by.gesture + ' 画面宽（太少=手一直垂着，太多=乱挥）'
      },
      {
        key: 'down', name: '不一直低头', weight: 1.5,
        score: by.down == null ? null : (downMax > 0 ? band(downMax, 8, 25) : 100),
        detail: downMax > 0 ? '最长一段低头 ' + Math.round(downMax) + ' 秒（单次门槛 8 秒）' : '没有超过 1 秒的低头'
      },
      {
        key: 'arms', name: '不抱臂／插手', weight: 1,
        score: by.arms == null ? null : band(by.arms, 3, 12),
        detail: by.arms == null ? '没测到双手，抱臂判不了' : '最长一次抱臂/插手 ' + by.arms + ' 秒（门槛 3 秒；手垂着或拿粉笔不算）'
      },
      {
        key: 'block', name: '不挡板书', weight: 1,
        score: by.block == null ? null : band(by.block, 10, 30),
        detail: '遮挡板面的帧占 ' + (by.block == null ? '—' : by.block) + '%（门槛 10%）'
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

  App.MetricsPose = {
    analyze: analyze,
    points: points,
    CFG: CFG,
    _frameGeom: frameGeom,
    _iou: iou
  };
})(window);
