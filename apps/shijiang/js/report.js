/* ==========================================================================
   report.js — 评分报告页渲染
   · 总分环形图（SVG stroke-dashoffset）+ 七维雷达图（手写 SVG）
   · 维度卡扣分明细、可点击跳转的问题时间轴（Canvas 自绘）
   · 板书五项评分可手动校准，改动即时反映到总分
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;

  var ICONS = {
    content: 'i-content', fluency: 'i-fluency', pause: 'i-pause', filler: 'i-filler',
    board: 'i-board', speed: 'i-speed', posture: 'i-posture'
  };

  var TL_COLORS = {
    pause: '#0071e3',
    longpause: '#ff3b30',
    filler: '#ff9f0a',
    repeat: '#5e5ce6',
    stall: '#8e8e93'
  };

  var TL_NAMES = {
    pause: '停顿', longpause: '长停顿', filler: '口头禅', repeat: '整句重复', stall: '句中卡顿'
  };

  var state = {
    report: null,
    onSeek: null,
    canvas: null,
    cleanup: [],
    aiConsent: false        /* 同一次报告里同意过一次就不再问 */
  };

  function esc(s) { return util.escape(s); }

  /* 不满一分钟就说秒，别写「0 分钟」 */
  function fmtSpeech(minutes) {
    var m = Number(minutes) || 0;
    if (m < 1) return Math.round(m * 60) + ' 秒';
    return (Math.round(m * 10) / 10) + ' 分钟';
  }

  function fmtMinute(minutes) {
    return fmtSpeech(minutes);
  }

  /* ------------------------------------------------------------------ 环形 */
  function ringHTML(report, rated) {
    var C = 2 * Math.PI * 100;
    return '' +
      '<div class="ring-wrap">' +
        '<svg viewBox="0 0 220 220" aria-hidden="true">' +
          '<circle class="ring-track" cx="110" cy="110" r="100"></circle>' +
          '<circle class="ring-val" id="ringVal" cx="110" cy="110" r="100" ' +
            'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"></circle>' +
        '</svg>' +
        '<div class="ring-center">' +
          '<span class="ring-score" id="ringScore">' + (rated === false ? '—' : '0') + '</span>' +
          '<span class="ring-unit" id="ringUnit">' + (rated === false ? '已测项参考分' : 'TOTAL / 100') + '</span>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ 雷达 */
  function radarHTML(dims) {
    var W = 340, H = 320, cx = 170, cy = 158, R = 104;
    var n = dims.length;
    var rings = [0.25, 0.5, 0.75, 1];

    function pt(i, ratio) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + Math.cos(a) * R * ratio, cy + Math.sin(a) * R * ratio];
    }

    /* 没评估的项不画成 0 分（那会被读成「这项很差」），画到内侧的虚线位并标「—」 */
    function ratioOf(d) {
      return (d.missing || d.score == null) ? 0.12 : Math.max(0.06, d.score / 100);
    }

    var s = '<svg id="radar" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="七维度能力雷达图">';

    rings.forEach(function (r) {
      var p = [];
      for (var i = 0; i < n; i++) p.push(pt(i, r).map(function (v) { return v.toFixed(1); }).join(','));
      s += '<polygon class="radar-grid" points="' + p.join(' ') + '"></polygon>';
    });

    for (var i = 0; i < n; i++) {
      var e = pt(i, 1);
      s += '<line class="radar-axis" x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '"></line>';
    }

    var shape = [];
    dims.forEach(function (d, i) {
      var p = pt(i, ratioOf(d));
      shape.push(p.map(function (v) { return v.toFixed(1); }).join(','));
    });
    s += '<polygon class="radar-shape" id="radarShape" points="' + shape.join(' ') + '" opacity="0"></polygon>';

    dims.forEach(function (d, i) {
      var p = pt(i, ratioOf(d));
      s += '<circle class="radar-dot' + ((d.missing || d.score == null) ? ' is-none' : '') + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6"></circle>';
    });

    dims.forEach(function (d, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      var lx = cx + Math.cos(a) * (R + 30);
      var ly = cy + Math.sin(a) * (R + 26);
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      s += '<text class="radar-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + anchor + '">' + esc(d.name) + '</text>';
      s += '<text class="radar-val" x="' + lx.toFixed(1) + '" y="' + (ly + 13).toFixed(1) + '" text-anchor="' + anchor + '">' +
        ((d.missing || d.score == null) ? '—' : d.score) + '</text>';
    });

    s += '</svg>';
    return s;
  }

  /* ---------------------------------------------------------------- 维度卡 */
  function ptsLabel(points) {
    if (typeof points === 'number') return '−' + points;
    if (points === 'density') return '判不及格';
    if (points === 'rate') return '判不及格';
    return '';
  }

  function dimCardHTML(d) {
    var decs = d.deductions || [];
    var notes = d.notes || [];
    var total = decs.length + notes.length;

    var rows = decs.map(function (dd) {
      var timeChip = dd.at != null
        ? '<span class="ded-time" data-seek="' + util.round1(dd.at) + '">' + util.fmtTime(dd.at) + '</span>'
        : '<span class="ded-time plain">—</span>';
      var isNum = typeof dd.points === 'number';
      return '<div class="ded">' + timeChip +
        '<span>' + esc(dd.reason) + '</span>' +
        '<span class="ded-pts' + (isNum ? '' : ' zero') + '">' + ptsLabel(dd.points) + '</span></div>';
    }).join('');

    var noteRows = notes.map(function (n) {
      return '<div class="ded note"><span class="ded-time plain">—</span><span>' + esc(n) + '</span>' +
        '<span class="ded-pts">说明</span></div>';
    }).join('');

    var detail = total
      ? '<details><summary>扣分明细 · ' + total + ' 条</summary><div class="ded-list">' + rows + noteRows + '</div></details>'
      : '';

    var fix = d.fix
      ? '<p class="dim-fix"><b>下次怎么改</b><span>' + esc(d.fix) + '</span></p>'
      : '';

    var weighted = (d.missing || d.score == null) ? null : util.round1(d.score * d.weight);
    var formula = traceLine(d);

    var miss = !!(d.missing || d.score == null);
    var scoreHTML = miss
      ? '<span class="dim-score dim-none">—</span>'
      : '<span class="dim-score">' + d.score + '<small>/100</small></span>';
    var subHTML = miss
      ? '<div class="dim-sub">这次没评估 · 不计入分数</div>'
      : '<div class="dim-sub">加权 ' + weighted + ' 分</div>';

    return '' +
      '<div class="dim-card' + (miss ? ' is-missing' : '') + '" data-dim="' + d.key + '">' +
        '<div class="dim-head">' +
          '<span class="dim-icon"><svg width="18" height="18" aria-hidden="true"><use href="#' + (ICONS[d.key] || 'i-content') + '"></use></svg></span>' +
          '<div><div class="dim-name">' + esc(d.name) + '</div>' +
          subHTML + '</div>' +
          '<span class="dim-sub">' + Math.round(d.weight * 100) + '%</span>' +
          scoreHTML +
        '</div>' +
        '<div class="dim-bar"><i data-w="' + (miss ? 0 : d.score) + '"></i></div>' +
        formula +
        fix +
        detail +
      '</div>';
  }

  /* 这一项的分数是怎么来的：起始分 → 扣分 → 折算/封顶 → 最终分。
     用户原话：「每个维度应能从起始分、扣分、折算或封顶推导出最终分」。 */
  function traceText(d) {
    var t = d.trace;
    if (!t) return '';
    if (t.mode === 'missing') {
      return '这一项这次没有可用的证据，不评分、也不扣分，不计入总分';
    }
    if (t.mode === 'manual') {
      return '这一项是你自己打的分（' + d.score + ' 分），不是自动测出来的';
    }
    if (t.mode === 'measured' && t.parts) {
      var expr = t.parts.map(function (p) {
        return p.label + ' ' + p.value + '% × ' + p.weight + '%';
      }).join(' + ');
      var txt0 = expr + ' = ' + t.base + ' 分';
      if (t.delta) txt0 += '，再' + (t.delta < 0 ? '扣 ' + (-t.delta) : '加 ' + t.delta) + '（见下面扣分明细）';
      return txt0 + ' = ' + t.final + ' 分';
    }
    if (t.mode === 'sum') {
      var n = t.measuredItems || t.steps.length;
      return n + ' 项各 0–20 分相加，再按 ' + n + ' 项折算成百分制 = ' + t.final + ' 分' +
        (t.manual ? '（你在下面手动调过）' : '（没测到的项不参与折算）');
    }
    var txt = '起始 100 − 扣 ' + (t.deducted || 0);
    if (t.folded) {
      txt += ' = ' + t.folded.before + '，再 × ' +
        (t.folded.factor != null ? t.folded.factor : Math.round(t.folded.density * 100) / 100) +
        '（核心内容只占目标时长的 ' + Math.round((t.folded.density || 0) * 100) + '%）';
    }
    if (t.capped && t.capped.value != null) txt += ' → 封顶 ' + t.capped.value;
    txt += ' = ' + t.final;
    if (d.rawVerdict) txt += '（触发了判不及格的条件）';
    if (d.key === 'posture' && !(t.deducted > 0)) {
      txt += '（没有达到门槛的行为问题；不等于「无可挑剔」，只是没看到可定位的事实）';
    }
    return txt;
  }

  function traceLine(d) {
    var txt = traceText(d);
    if (!txt) return '';
    return '<p class="dim-trace"><b>怎么算的</b><span>' + esc(txt) + '</span></p>';
  }

  /* ---------------------------------------------------------------- 时间轴 */
  function drawTimeline(canvas, report, onSeek) {
    if (!canvas) return;
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    var cssW = canvas.clientWidth || 640;
    var cssH = 88;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var padL = 2, padR = 2;
    var W = cssW - padL - padR;
    var dur = Math.max(1, report.duration);

    function X(t) { return padL + util.clamp(t / dur, 0, 1) * W; }

    // 底
    ctx.fillStyle = '#f5f5f7';
    roundRect(ctx, 0, 8, cssW, cssH - 18, 10);
    ctx.fill();

    // 分钟刻度
    ctx.strokeStyle = 'rgba(0,0,0,.06)';
    ctx.lineWidth = 1;
    for (var m = 60; m < dur; m += 60) {
      ctx.beginPath();
      ctx.moveTo(X(m), 12);
      ctx.lineTo(X(m), cssH - 14);
      ctx.stroke();
    }

    // 环节色带
    var sections = (report.sections || []).filter(function (s) { return s.at != null; });
    var colors = ['#0071e3', '#5e5ce6', '#00a862', '#ff9f0a', '#8e8e93'];
    sections.forEach(function (s, i) {
      var next = sections[i + 1];
      var x0 = X(s.at), x1 = next ? X(next.at) : X(dur);
      ctx.fillStyle = colors[i % colors.length] + '22';
      ctx.fillRect(x0, 12, Math.max(1, x1 - x0), 4);
      ctx.fillStyle = colors[i % colors.length] + 'cc';
      ctx.font = '9px -apple-system, "PingFang SC", system-ui, sans-serif';
      if (x1 - x0 > 26) ctx.fillText(s.name, x0 + 3, 24);
    });

    // 事件
    var items = report.timeline || [];
    var laneTop = 40;
    items.forEach(function (it) {
      var x = X(it.t);
      var color = TL_COLORS[it.type] || '#8e8e93';
      var h = it.type === 'longpause' ? 30 : 18;
      ctx.strokeStyle = color;
      ctx.lineWidth = it.type === 'longpause' ? 2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(x, laneTop);
      ctx.lineTo(x, laneTop + h);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, laneTop + h, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });

    // 悬停命中区
    var hit = [];
    items.forEach(function (it) { hit.push({ x: X(it.t), item: it }); });

    canvas._hit = hit;
    canvas._dur = dur;
    canvas._padL = padL;
    canvas._W = W;

    canvas.onclick = function (ev) {
      var rect = canvas.getBoundingClientRect();
      var px = ev.clientX - rect.left;
      var best = null, bestD = 14;
      hit.forEach(function (h) {
        var d = Math.abs(h.x - px);
        if (d < bestD) { bestD = d; best = h; }
      });
      if (best) { onSeek && onSeek(best.item.t); return; }
      // 没命中标记点时按比例跳转
      var t = util.clamp((px - padL) / W, 0, 1) * dur;
      onSeek && onSeek(t);
    };

    canvas.onmousemove = function (ev) {
      var rect = canvas.getBoundingClientRect();
      var px = ev.clientX - rect.left;
      var near = hit.some(function (h) { return Math.abs(h.x - px) < 8; });
      canvas.style.cursor = near ? 'pointer' : 'crosshair';
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------------------------------------------------------- 建议 */
  function suggHTML(advice) {
    function col(cls, tag, list, empty) {
      var items = (list || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      return '<div class="sugg-col"><span class="sugg-tag ' + cls + '">' + tag + '</span>' +
        (items ? '<ul>' + items + '</ul>' : '<p class="sugg-empty">' + esc(empty) + '</p>') + '</div>';
    }
    return '<div class="sugg-grid">' +
      col('must', '必须改', advice.must, '没有必须改的硬伤，保持。') +
      col('should', '建议改', advice.should, '暂无明显可优化项。') +
      col('bonus', '加分项', advice.bonus, '') +
      '</div>';
  }

  /* 三档建议：每条一行，编号，左对齐。比三列卡片好读。 */
  function adviceHTML(advice) {
    advice = advice || {};
    var groups = [
      ['must', '必须改', '不改就过不了', advice.must || []],
      ['should', '建议改', '改了明显涨分', advice.should || []],
      ['bonus', '加分项', '有余力再做', advice.bonus || []]
    ];
    var out = '<div class="adv-list">';
    groups.forEach(function (g) {
      if (g[0] === 'bonus' && !g[3].length) return;
      out += '<section class="adv-group ' + g[0] + '">' +
        '<header><span class="adv-tag">' + g[1] + '</span><em>' + g[2] + '</em>' +
        '<b>' + g[3].length + '</b></header>';
      if (g[3].length) {
        out += '<ol>' + g[3].map(function (x, i) {
          return '<li><i>' + (i + 1) + '</i><span>' + esc(x) + '</span></li>';
        }).join('') + '</ol>';
      } else {
        out += '<p class="adv-empty">这一档没有。</p>';
      }
      out += '</section>';
    });
    out += '</div>';
    return out;
  }

  /* 示范：这一节课讲到 90 分，嘴上应该是什么样 */
  function examplesHTML() {
    var list = (App.rubric && App.rubric.examples) || [];
    if (!list.length) return '';
    var cards = list.map(function (e) {
      return '<article class="ex-card">' +
        '<span class="ex-tag">' + esc(e.tag) + '</span>' +
        '<h3>' + esc(e.title) + '</h3>' +
        '<p class="ex-script">' + esc(e.script) + '</p>' +
        '<p class="ex-note">' + esc(e.note) + '</p>' +
      '</article>';
    }).join('');

    /* 十条示范太长，默认收起。想看的人点一下，不想看的不会被它挡路。 */
    return '<section class="report-section section-light" id="examples"><div class="wrap">' +
      '<p class="eyebrow">示范</p>' +
      '<h2 class="h2" style="font-size:clamp(24px,3.2vw,34px)">讲到 90 分，嘴上应该是什么样</h2>' +
      '<p class="lede" style="margin-bottom:24px">以「函数的单调性」为例。每一条都能直接照着练，不是形容词。</p>' +
      '<details class="ex-fold"><summary>展开全部 ' + list.length + ' 条示范</summary>' +
        '<div class="ex-grid">' + cards + '</div>' +
      '</details>' +
    '</div></section>';
  }

  /* 画面时间线：每 30 秒截一张，逐张说这一帧里有什么 */
  var SHOT_KIND = {
    both: '板书 + 人在画面里',
    board: '只有板书',
    face: '人在画面里',
    other: '既没板书也没人'
  };

  function shotLine(s) {
    var parts = [];
    parts.push(SHOT_KIND[s.kind] || SHOT_KIND.other);
    /* 站位左右属于正常教学行为，只描述画面，不做评价 */
    if (s.lum != null && s.lum < 95) parts.push('这一帧画面偏暗');
    if (s.ink != null && s.ink < 0.004 && s.kind !== 'board' && s.kind !== 'both') parts.push('画面里没有可读的板书');
    return parts.join('，');
  }

  function shotsHTML(report) {
    var shots = report.shots || [];
    if (!shots.length) return '';

    var boards = shots.filter(function (s) { return s.kind === 'board' || s.kind === 'both'; }).length;
    var faceless = shots.filter(function (s) { return !s.face; }).length;

    return '<section class="report-section section-light" id="frames"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">画面时间线</h2>' +
      '<p class="lede" style="margin-bottom:22px">每隔 30 秒截一张，一共 ' + shots.length + ' 张。' +
        '有板书的 ' + boards + ' 张，看不到人的 ' + faceless + ' 张。点图跳到那一秒。</p>' +
      '<div class="frame-grid">' + shots.map(function (s, i) {
        return '<figure class="frame-card" data-t="' + s.t + '" data-i="' + i + '">' +
          (s.img ? '<img src="' + s.img + '" alt="第 ' + util.fmtTime(Math.round(s.t)) + ' 秒的画面">'
                 : '<div class="frame-blank"></div>') +
          '<figcaption><b>' + util.fmtTime(Math.round(s.t)) + '</b>' +
            '<span class="frame-kind k-' + (s.kind || 'other') + '">' + esc(SHOT_KIND[s.kind] || SHOT_KIND.other) + '</span>' +
            '<em>' + esc(shotLine(s)) + '</em>' +
          '</figcaption>' +
        '</figure>';
      }).join('') + '</div>' +
    '</div></section>';
  }

  /* 评分细则不在报告里重复：权重表与规则只在首页「评分标准」出现一次 */

  /* --------------------------------------------------------------- 主渲染 */
  /* 问题清单：一条问题 = 一个可核对的证据 + 一句能照做的改法 */
  var SEV_TEXT = { high: '必须改', mid: '建议改', low: '有余力再改' };

  function issueHTML(it) {
    var head = '<div class="issue-head">' +
      '<span class="issue-num">' + (it.order < 10 ? '0' : '') + it.order + '</span>' +
      '<span class="issue-cat">' + esc(it.categoryName) + '</span>' +
      '<span class="issue-sev ' + it.severity + '">' + (SEV_TEXT[it.severity] || '') + '</span>' +
      (it.start != null
        ? '<button type="button" class="issue-time" data-t="' + it.start + '">' +
            util.fmtAt(it.start) + '</button>'
        : '<span class="issue-time is-none">没有时间点</span>') +
      (it.points != null && it.points > 0
        ? '<span class="issue-impact">−' + it.points + '</span>'
        : (it.scoringImpact ? '<span class="issue-impact">判不及格项</span>' : '')) +
      '</div>';

    var body = '<p class="issue-problem">' + esc(it.problem) + '</p>';

    if (it.quote) {
      body += '<blockquote class="issue-quote"><span>原话</span><q>' + esc(it.quote) + '</q>' +
        '<em>' + (it.start != null ? util.fmtAt(it.start) + ' 附近' : '') +
        (it.startFrame != null ? ' · 第 ' + it.startFrame + ' 帧' : '') +
        ' · 置信度 ' + (it.confidence === 'high' ? '高' : it.confidence === 'medium' ? '中' : '低') +
        '</em></blockquote>';
    }

    if (it.visualEvidence) {
      body += '<figure class="issue-shot">' +
        '<img src="' + esc(it.visualEvidence.src) + '" alt="证据画面" />' +
        '<figcaption>' +
          (it.visualEvidence.kind === 'board' ? '板书' : '画面') +
          (it.visualEvidence.at != null ? ' · ' + util.fmtAt(it.visualEvidence.at) : '') +
        '</figcaption></figure>' +
        (it.visualEvidence.kind === 'board'
          ? '<p class="issue-shot-note">这是自动从录像里挑出来的板书帧。清晰度会影响判断，但它只说明「拍得清不清」，不等于「写得好不好」。</p>'
          : '');
    }

    if (!it.quote && !it.visualEvidence) {
      body += '<p class="issue-note">这条是从整体数据里判出来的，没有可以截取的单一原话或画面。</p>';
    }

    if (it.suggestion) body += '<p class="issue-fix"><b>怎么改</b>' + esc(it.suggestion) + '</p>';

    /* 详细分析默认收起：首屏只留「问题 / 时间码 / 截图 / 原话 / 一条建议」 */
    var detail = '';
    if (it.explanation) detail += '<p class="issue-why">' + esc(it.explanation) + '</p>';
    if (it.suggestedWording) detail += '<p class="issue-fix issue-say"><b>可以这么说</b>' + esc(it.suggestedWording) + '</p>';
    if (it.traceText) detail += '<p class="issue-why">判分依据：' + esc(it.traceText) + '</p>';
    if (detail) {
      body += '<details class="issue-more"><summary>展开详情</summary>' + detail + '</details>';
    }

    return '<li class="issue sev-' + it.severity + '">' + head + body + '</li>';
  }

  /* ------------------------------------------------------------------ 画面证据
     报告里最容易被糊弄过去的一块：写清楚「看到了什么、在第几秒、用多少帧支持、
     什么情况下这个判断不成立」。 */
  var VIS_KIND = {
    back_turned: '背对镜头讲解',
    board_occluded: '讲解时挡住板书',
    writing: '书写板书（正常行为）',
    gesture_board: '手势指向板书',
    repeated_motion: '重复动作'
  };

  /* 每条画面结论都要写清「这条证据能支持什么、不能支持什么」——
     单帧推断不出「一直」「频繁」，镜头方向也不等于学生方向。 */
  var VIS_SUPPORT = {
    back_turned: {
      can: '这段时间里，镜头连续看到的是背面：脸的关键点消失、肩还在画面里。',
      cannot: '不能据此断定「背对学生」。镜头方向不等于学生方向，也可能是机位在侧后方。'
    },
    board_occluded: {
      can: '这段时间里，人物包围盒压住了板面区域，同时板面没有在变。',
      cannot: '不能据此断定挡住了全班视线——它只说明挡在镜头里的那块板面。'
    },
    writing: {
      can: '这段时间板面在变、人朝向板面，属于书写板书（正常行为，不扣分）。',
      cannot: '不能据此评价字写得好不好，也判断不了「书写稳定度」。'
    },
    gesture_board: {
      can: '手部关键点落在板面附近，属于边指边讲。',
      cannot: '不能说明指的就是正在讲的那一行。'
    }
  };

  function visualHTML(report) {
    /* 「画面里看到的」这一段整段下线：没有够门槛的问题时它只是噪声，
       有问题的情形（整段背对、压住板书）已经在「仪态八项」里讲清楚了。 */
    return '';
    var v = report.visual;
    if (!v) return '';

    var cov = v.coverage || {};
    var pose = v.pose || {};
    var shots = report.shots || [];
    var behaviors = v.behaviors || [];
    var issues = behaviors.filter(function (b) { return b.kind === 'issue'; });
    var positives = behaviors.filter(function (b) { return b.kind === 'positive'; });

    function shotAt(t) {
      if (!shots.length) return null;
      var best = null, gap = 1e9;
      shots.forEach(function (s) {
        var d = Math.abs(s.t - t);
        if (d < gap) { gap = d; best = s; }
      });
      if (!best || !best.img) return null;
      /* 优先用 6 秒内那一帧；实在没有就退到最近的，并在图注里说明「最接近」 */
      return { shot: best, exact: gap <= 6 };
    }

    function card(b) {
      var hit = shotAt(b.from);
      var tone = b.kind === 'issue' ? (b.severity === 'high' ? 'high' : 'mid') : 'ok';
      var out = '<li class="vis-card vis-' + tone + '">' +
        '<div class="vis-head"><span class="vis-dot"></span>' +
          '<b>' + esc(VIS_KIND[b.key] || b.title) + '</b>' +
          '<button class="issue-time" data-t="' + util.round1(b.from) + '">' +
            util.fmtTime(Math.round(b.from)) + ' – ' + util.fmtTime(Math.round(b.to)) + '</button>' +
          '<span class="vis-sec">' + b.seconds + ' 秒</span>' +
        '</div>' +
        '<p class="vis-detail">' + esc(b.detail) + '</p>';
      if (hit) {
        var s = hit.shot;
        out += '<figure class="vis-shot"><img src="' + s.img + '" alt="' +
          util.fmtTime(Math.round(s.t)) + ' 的画面">' +
          '<figcaption>' + (hit.exact ? '' : '最接近的一帧：') +
          util.fmtTime(Math.round(s.t)) + '（' + esc(s.frameId || '—') + '）</figcaption></figure>';
      }
      out += '<p class="vis-how">怎么判的：' + esc(howText(b, v)) + '</p>';
      if (b.evidence) {
        var e = b.evidence;
        out += '<p class="vis-ev">证据：<b>' + e.poseFrames + '/' + e.frames + '</b> 帧检测到关键点' +
          ' · 关键点均值 <b>' + e.kpAvg + '/33</b>' +
          ' · 覆盖 <b>' + e.seconds + ' 秒</b>' +
          ' · 采样覆盖 <b>' + Math.round((e.sampleCoverage || 0) * 100) + '%</b>' +
          ' · 置信度 <b>' + (e.confidence === 'high' ? '高' : e.confidence === 'medium' ? '中' : '低') + '</b></p>';
      }
      var sp = VIS_SUPPORT[b.key];
      if (sp) {
        out += '<p class="vis-can"><b>能支持</b>' + esc(sp.can) + '</p>' +
          '<p class="vis-cannot"><b>不能支持</b>' + esc(sp.cannot) + '</p>';
      }
      return out + '</li>';
    }

    var head = '<p class="eyebrow">画面里看到的</p>' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">' +
      (issues.length ? '从画面里找到 ' + issues.length + ' 段可定位的行为问题' : '画面里没有可定位的行为问题') +
      '</h2>';

    var lamp = [];
    if (cov.samples) {
      lamp.push('抽了 <b>' + cov.samples + '</b> 帧，约每 ' + (cov.step || '?') + ' 秒一帧，覆盖 ' +
        util.fmtTime(Math.round(cov.from || 0)) + '–' + util.fmtTime(Math.round(cov.to || 0)) +
        '（时长的 ' + Math.round((cov.sampleCoverage || 0) * 100) + '%）');
    }
    if (pose.available) {
      lamp.push('其中 <b>' + Math.round((cov.poseRate || 0) * 100) + '%</b> 的帧定位到了人体关键点');
    } else {
      lamp.push('这次<b>没跑成人体姿态</b>：' + esc(pose.reason || '模型没加载成功'));
    }
    if (v.board && v.board.found) {
      lamp.push('板书区域已定位（' + (v.board.polarity === 'dark' ? '深色板' : '浅色板') + '）');
    } else {
      lamp.push('画面里没找到板面区域，板书那几项这次不评');
    }

    var body = issues.length
      ? '<ol class="vis-list">' + issues.map(card).join('') + '</ol>'
      : '<p class="vis-empty">在抽到的 ' + (cov.samples || 0) + ' 帧里，没有出现「连续 ≥8 秒背对讲解」' +
        '或「讲解时身体压住 ≥35% 板面连续 ≥5 秒」这类够门槛的情况。<br>' +
        '这不等于满分：门槛是故意设高的，两帧的画面说明不了「全程」，所以不会写进扣分。</p>';

    /* 「正常行为（不扣分）」不再写进报告：正常动作不列出来，只保留真问题 */
    var pos = '';

    return '<section class="report-section" id="visual"><div class="wrap">' + head +
      '<p class="lede">位置、是否居中、脸朝哪边，都只用来判断「这段素材能不能分析」，不用来打分。' +
      '下面这些结论都要求连续多帧支持；只有一两帧的地方没有写成结论。</p>' +
      '<ul class="vis-lamp">' + lamp.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
      body + pos +
      '<p class="vis-note">模型：' + esc((pose.model && pose.model.model) || '未加载') +
      '；分析在本机浏览器里完成，画面不上传。镜头方向不等于学生方向，「背对镜头」只描述拍到的画面。</p>' +
      '</div></section>';
  }

  function howText(b, v) {
    if (b.key === 'back_turned') {
      return '面部关键点缺失、肩部仍在画面内，且该时段板面没有变化（不是在写字）；连续 ' +
        b.seconds + ' 秒、用 ' + ((b.frames && b.frames.length) || 1) + ' 帧以上支持，超过 8 秒门槛才记一条。';
    }
    if (b.key === 'board_occluded') {
      return '人物包围盒与板面区域重叠超过 35%，且该时段板面没有变化；连续 ' + b.seconds +
        ' 秒才记一条。挡的是「镜头里的板面」，不一定等于挡住全班。';
    }
    if (b.key === 'writing') {
      return '板面签名在变（板书在写）＋人转向板面，合并成一段；这不是问题，只作复习入口。';
    }
    if (b.key === 'gesture_board') {
      return '手腕关键点落在板面区域内，至少 2 帧；它只能说明手在板面附近，说明不了指的就是那一行。';
    }
    return '连续多帧的判据，门槛详见首页的评分标准。';
  }

  function issuesHTML(report) {
    var list = report.issues || [];
    if (!list.length) {
      return '<section class="report-section section-light" id="issues"><div class="wrap">' +
        '<p class="eyebrow">问题清单</p>' +
        '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">没有触发扣分的具体问题</h2>' +
        '<p class="lede">这不代表满分——只代表在这次能测到的范围里，没有出现能被定位到秒或画面的问题。' +
        '没测到的项在下面单独标了出来。</p>' +
        '</div></section>';
    }

    var high = list.filter(function (i) { return i.severity === 'high'; }).length;
    return '<section class="report-section section-light" id="issues"><div class="wrap">' +
      '<p class="eyebrow">问题清单</p>' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">这次一共 ' + list.length + ' 个具体问题</h2>' +
      '<p class="lede">每条都挂证据：能定位到原话的引原话，能定位到画面的贴截图；' +
      (high ? '其中 ' + high + ' 条必须改。' : '没有必须改的硬伤。') +
      '点时间码可以跳到录像那一秒。</p>' +
      '<ol class="issue-list">' + list.map(issueHTML).join('') + '</ol>' +
      '</div></section>';
  }

  /* ======================================================================
     首屏状态：只回答「算不算完整评估 / 哪些项真评了 / 哪些没评为什么 /
     最要紧的两三件事」。其余内容全部下移，不让总分卡和七维卡把首屏塞满。
     ====================================================================== */
  function statusHTML(report) {
    var dims = report.dims || [];
    var measured = dims.filter(function (d) { return !d.missing && d.score != null; });
    var missing = dims.filter(function (d) { return d.missing || d.score == null; });
    var ev = report.evidence || {};
    var complete = ev.status === 'complete';
    var tooShort = !!ev.tooShort;
    var graded = complete && report.grade && report.grade.key && report.grade.key !== '—';

    var out = '<section class="rp-status"><div class="wrap">';

    out += '<div class="rp-top">' +
      (report.demo ? '<div class="rp-demo-row"><span class="rp-demo">示例报告 · 不是你的录像</span></div>' : '') +
      (report.audioOnly ? '<div class="rp-demo-row"><span class="rp-demo">纯语音 · 只录音频，板书与仪态不评</span></div>' : '') +
      '<div class="rp-top-line">' +
        '<span class="rp-chip ' + (complete ? 'ok' : 'partial') + '">' +
          (tooShort ? '样本不足' : (complete ? '完整评估' : (graded ? '部分评估' : '证据不足'))) + '</span>' +
        '<span class="rp-grade">' + (graded
          ? esc(report.grade.key + ' · ' + report.grade.label)
          : '— / 不足以评级') + '</span>' +
      '</div>' +
      '<div class="rp-score-line">' +
        '<span class="rp-total">' + (tooShort || report.total == null ? '—' : report.total.toFixed(1)) + '</span>' +
        '<span class="rp-total-label">' + (tooShort ? '样本不足，不出总分' : (complete ? '总分' : '已测项参考分')) + '</span>' +
      '</div>' +
    '</div>';

    out += '<p class="rp-summary">' + esc(report.summary || '') + '</p>';

    out += '<div class="rp-cols' + (missing.length ? '' : ' rp-cols-single') + '">' +
      '<div class="rp-col"><h3>已评估 ' + measured.length + ' 项</h3><ul>' +
        (measured.length
          ? measured.map(function (d) {
              return '<li><b>' + esc(d.name) + '</b><span>' + (d.score == null ? '—' : Math.round(d.score)) + '</span></li>';
            }).join('')
          : '<li class="rp-none">没有一项拿到足够证据</li>') +
      '</ul></div>' +
      (missing.length
        ? '<div class="rp-col"><h3>未评估 ' + missing.length + ' 项</h3><ul>' +
            missing.map(function (d) {
              var why = (d.raw && d.raw.reason) || (d.notes && d.notes[0]) || '证据不足';
              return '<li class="rp-miss"><b>' + esc(d.name) + '</b><span>' + esc(why) + '</span></li>';
            }).join('') +
          '</ul></div>'
        : '<div class="rp-col rp-col-ok"><h3>缺测项</h3><p class="rp-ok-line">7 项全部拿到了证据，没有缺测。</p></div>') +
    '</div>';

    var top = (report.issues || []).slice(0, 3);
    if (top.length) {
      out += '<div class="rp-issues"><h3>先看这 ' + top.length + ' 条</h3><ol>' +
        top.map(function (it) {
          return '<li class="rp-issue sev-' + esc(it.severity || 'mid') + '">' +
            '<span class="rp-sev">' + esc(SEV_TEXT[it.severity] || '') + '</span>' +
            '<span class="rp-problem">' + esc(it.problem || '') + '</span>' +
            (it.start != null
              ? '<button type="button" class="issue-time" data-t="' + it.start + '">' + util.fmtAt(it.start) + '</button>'
              : '') +
          '</li>';
        }).join('') +
      '</ol></div>';
    }

    out += '<div class="rp-actions">' +
      '<button type="button" class="btn btn-primary" data-scroll="transcript">查看完整逐字稿</button>' +
      '<button type="button" class="btn btn-ghost" data-scroll="issues">全部 ' + (report.issues || []).length + ' 条问题</button>' +
    '</div>';

    return out + '</div></section>';
  }

  /* ======================================================================
     完整逐字稿：原始转写 / 术语修正版 两版可切，每段带时间码。
     ====================================================================== */
  function transcriptHTML(report) {
    var segs = (report.segments || []).filter(function (s) { return s && (s.text || s.raw); });
    var head = '<section class="report-section section-light" id="transcript"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(24px,3.2vw,34px)">完整逐字稿</h2>';

    if (!segs.length) {
      return head +
        '<p class="lede">本次没有可用逐字稿，请录入语音或导入字幕文件。</p>' +
        '<p class="panel-note">没有逐字稿时，「教学表达」「语气词」这两项不评分，问题清单里也不会出现「原话」——不会用示范答案或模型生成的文字冒充你说过的话。</p>' +
      '</div></section>';
    }

    var chars = segs.reduce(function (a, s) { return a + String(s.text || '').length; }, 0);
    var out = head +
      '<div class="ts-toolbar">' +
        '<span class="ts-count">' + segs.length + ' 段 · ' + chars + ' 字 · 点时间码可跳转</span>' +
        '<div class="ts-switch" role="group" aria-label="逐字稿版本">' +
          '<button type="button" class="ts-btn is-on" data-ts="fixed">术语修正版</button>' +
          '<button type="button" class="ts-btn" data-ts="raw">原始转写</button>' +
        '</div>' +
      '</div>' + habitsHTML(segs) + '<ol class="ts-list">';

    segs.forEach(function (s) {
      var t = (s.t != null ? s.t : (s.start != null ? s.start : null));
      var fixed = String(s.text || s.raw || '');
      var raw = String(s.raw != null ? s.raw : fixed);
      out += '<li class="ts-row">' +
        (t != null
          ? '<button type="button" class="ts-time" data-t="' + t + '">' + util.fmtTime(Math.round(t)) + '</button>'
          : '<span class="ts-time is-none">—</span>') +
        '<span class="ts-text" data-fixed="' + esc(fixed) + '" data-raw="' + esc(raw) + '">' + esc(fixed) + '</span>' +
      '</li>';
    });

    return out + '</ol>' +
      '<p class="panel-note">修正版只改明显的识别错误、数学术语和标点，不改你的原意；原始转写保持识别结果，方便对照。' +
      '说话人：考生（单路麦克风，只有一个人说话）。' +
      '浏览器语音识别与字幕文件都不返回逐段置信度，所以这里不显示置信度分数——不编造。</p>' +
    '</div></section>';
  }

  /* 口头禅逐项：不光给一个总数，把「那」「呢」「呃」这些逐个数出来，
     再点出「那……呢……」这种套式——总数说不清问题，逐项才改得动。 */
  function habitsHTML(segs) {
    var T = App.text;
    if (!T || !T.habits) return '';
    var plain = segs.map(function (s) { return String(s.text || s.raw || ''); }).join(' ');
    var habits = T.habits(plain);
    if (!habits.length) return '';

    var total = habits.reduce(function (a, h) { return a + h.n; }, 0);
    var chars = T.charCount(plain);
    var per100 = chars ? Math.round(total / chars * 100 * 10) / 10 : 0;
    var max = habits[0].n || 1;
    var frames = T.frames ? T.frames(plain) : [];

    var rows = habits.slice(0, 8).map(function (h) {
      var w = Math.max(4, Math.round(h.n / max * 100));
      var hot = (h.word === '那' || h.word === '呢') ? ' is-hot' : '';
      return '<li class="habit-row">' +
        '<b class="habit-word' + hot + '">' + esc(h.word) + '</b>' +
        '<span class="habit-bar"><i style="width:' + w + '%"></i></span>' +
        '<em class="habit-n">' + h.n + ' 次<small>每百字 ' + h.per100 + '</small></em>' +
      '</li>';
    }).join('');

    return '<div class="habits">' +
      '<div class="habits-head">口头禅逐项' +
        '<span>共 ' + total + ' 次 · 每百字 ' + per100 + ' 次' +
        (frames.length >= 2 ? ' · 「那……呢……」' + frames.length + ' 处' : '') + '</span>' +
      '</div>' +
      '<ul class="habit-list">' + rows + '</ul>' +
      (frames.length >= 2
        ? '<p class="habit-tip">「那……呢……」这种套式有 ' + frames.length + ' 处，例如「' + esc(frames[0].sentence.slice(0, 28)) + '」。' +
          '把「那 X 呢，」整句删掉，直接说「X 是」，句子会立刻变硬。</p>'
        : '') +
      '<p class="habit-tip">这一栏只数逐字稿里出现过的，不做推测。括号里的「每百字」是你个人的习惯密度，跟讲了多久无关。</p>' +
    '</div>';
  }

  /* 语言与节奏：语速（分母＝有效讲话时长）、30 秒一条的曲线、三级停顿、口头禅密度。
     口径写在明面上，用户才能判断「这个数可信不可信」。 */
  function speechHTML(report) {
    var s = report.speech;
    if (!s || !s.speed) return '';
    var sp = s.speed;
    var out = '';

    /* 语速曲线：SVG 折线，横轴是整个时长，纵轴是字/分 */
    var curve = (s.curve || []).filter(function (p) { return p && p.cpm != null; });
    var spark = '';
    if (curve.length >= 2) {
      var maxCpm = Math.max.apply(null, curve.map(function (p) { return p.cpm; }).concat([120]));
      var minCpm = Math.min.apply(null, curve.map(function (p) { return p.cpm; }));
      var w = 300, h = 72, pad = 6;
      var span = s.duration || curve[curve.length - 1].t || 1;
      var pts = curve.map(function (p, i) {
        var x = pad + (p.t / span) * (w - pad * 2);
        var y = h - pad - ((p.cpm - minCpm) / Math.max(20, maxCpm - minCpm)) * (h - pad * 2);
        return (i ? ' ' : '') + round1(x) + ',' + round1(y);
      }).join(' ');
      spark = '<svg class="sp-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-label="语速曲线">' +
        '<line x1="0" y1="' + (h - pad) + '" x2="' + w + '" y2="' + (h - pad) + '" class="sp-axis"/>' +
        '<polyline points="' + pts + '" class="sp-line"/></svg>';
    }

    var jumps = (s.jumps || []).slice(0, 4);
    var scopeWord = (s.window && s.window.partial) ? '这一段' : '全片';
    var jumpHTML = jumps.length
      ? '<ul class="sp-jumps">' + jumps.map(function (j) {
          return '<li>' + timeChip(j.t) + ' 语速从 ' + j.from + ' 跳到 ' + j.to + ' 字/分（' + (j.delta > 0 ? '+' : '') + j.delta + '）</li>';
        }).join('') + '</ul>'
      : '<p class="panel-note">' + scopeWord + '语速平稳，没有出现 30 秒内超过 60 字/分的突变。</p>';

    out += '<section class="report-section" id="speech"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">语言与节奏</h2>' +
      '<p class="lede" style="margin-bottom:22px">语速的分母是<strong>有效讲话时长</strong>（去掉静默），不是整段视频的时长；停顿分三级单独计数，句内停顿与句间停顿分开算。</p>' +
      '<div class="panel sp-panel">' +
        '<div class="sp-head">' +
          '<div class="sp-num"><b>' + sp.cpm + '</b><span>字 / 分钟</span></div>' +
          '<div class="sp-band"><i class="chip">' + esc(sp.band || '—') + '</i>' +
            '<em>有效讲话 ' + fmtSpeech(s.speechSeconds / 60) + '，共 ' + s.chars + ' 字</em></div>' +
        '</div>' +
        (spark ? '<div class="sp-chart">' + spark + '<div class="sp-axis-x"><span>0:00</span><span>' + util.fmtTime(span / 2) + '</span><span>' + util.fmtTime(span) + '</span></div></div>'
          : '<p class="panel-note">逐字稿太短，还画不出语速曲线（至少要有两段 30 秒以上的讲话）。</p>') +
        '<p class="panel-note">' + speedNote(s) + '</p>' +
        jumpHTML +
      '</div>' +

      '<div class="sp-grid">' +
        '<div class="panel"><div class="panel-title">停顿</div>' +
          '<div class="stat-row" style="grid-template-columns:repeat(3,1fr);gap:14px">' +
            stat(s.pauses.tiers.light, '0.3–0.5 秒') +
            stat(s.pauses.tiers.clear, '0.5–1 秒') +
            stat(s.pauses.tiers.severe, '超过 1 秒') +
          '</div>' +
          '<p class="panel-note">句内停顿时长占讲话时长的 ' + Math.round(s.pauses.rate * 100) + '%，平均每句 ' +
            (Math.round(s.pauses.perSentence * 100) / 100) + ' 处；' +
            '另有 ' + s.pauses.outsideCount + ' 处出现在句子之间（换气、翻页，不计入卡顿）。</p>' +
        '</div>' +
        '<div class="panel"><div class="panel-title">口头禅密度</div>' +
          '<div class="stat-row" style="grid-template-columns:repeat(2,1fr);gap:14px">' +
            stat(s.filler.total, '次') +
            stat(s.filler.per100, '次 / 百字') +
          '</div>' +
          '<p class="panel-note">' + (s.filler.top.length
            ? '最多的是「' + s.filler.top.slice(0, 3).map(function (t) { return esc(t.word) + ' ' + t.n + ' 次'; }).join('」「') + '」。'
            : '没有统计到填充词。') + '</p>' +
        '</div>' +
      '</div>' +
    '</div></section>';

    return out;
  }

  /* 仪态八项：每项都是逐帧关键点算出来的，写清数值、门槛、判据；不写「整体观感」。 */
  /* 评分点表：一行一个点，后面写「拿什么算的」。
     有分就打百制，没分的写「这次没测到」并说明原因。 */
  /* 评分点：一行一个点（名字 + 得分），只在「扣分」或「不评」时才多一行说明原因。
     以前是四列表格（评分点/得分/权重/怎么算的），一屏塞不下，还跟上面的指标表重复。 */
  function pointsHTML(pts, opts) {
    if (!pts || !pts.items || !pts.items.length) return '';
    opts = opts || {};
    var rows = pts.items.map(function (it) {
      var has = it.score != null;
      var cls = has ? (it.score < 60 ? 'is-bad' : (it.score >= 85 ? 'is-good' : '')) : 'is-na';
      var why = (!has || it.score < 60) && it.detail ? '<p class="pt-why">' + esc(it.detail) + '</p>' : '';
      return '<li class="pt-row ' + cls + '">' +
        '<span class="pt-name">' + esc(it.name) + '</span>' +
        '<span class="pt-score">' + (has ? it.score : '—') + '</span>' +
        '<span class="pt-wt">' + (has ? '×' + it.weight : '不评') + '</span>' +
        why +
        '</li>';
    }).join('');
    return '<div class="panel pt-panel"><div class="panel-title">' + esc(opts.title || '评分点') +
      (pts.score != null ? '<span class="pt-total">合计 ' + pts.score + ' 分（权重 ' + pts.weight + '）</span>' : '') +
      '</div><ul class="pt-list">' + rows + '</ul>' +
      '<p class="pt-note">达到门槛记满分，离得越远扣得越多；标「不评」的是这项量不出来（采样太稀或画面条件不够），不计入合计。</p>' +
      '</div>';
  }

  function postureHTML(report) {
    var p = report.posture;
    if (!p || !p.available || !p.metrics) return '';
    var rows = p.metrics.map(function (m) {
      var v = (m.value == null) ? '—' : (m.value + (m.unit || ''));
      return '<tr class="' + (m.abnormal ? 'is-bad' : '') + '">' +
        '<th scope="row">' + esc(m.name) + '</th>' +
        '<td class="po-val">' + v + '</td>' +
        '<td class="po-th">' + esc(m.threshold || '—') + '</td>' +
        '<td class="po-fo">' + esc(m.formula || '') + '</td>' +
      '</tr>';
    }).join('');

    var side = (p.sideRuns || []).filter(function (r) { return r.dur >= 10; }).map(function (r) {
      return '<li>' + timeChip(r.from) + ' 整段背对约 ' + Math.round(r.dur) + ' 秒' +
        '<em>（超过 10 秒，这段时间学生只能看你的后背）</em></li>';
    }).join('');
    var down = (p.downRuns || []).filter(function (r) { return r.dur >= 1; }).map(function (r) {
      return '<li>' + timeChip(r.from) + ' 低头约 ' + Math.round(r.dur) + ' 秒' + (r.dur >= 8 ? '<em>（超过 8 秒，像在念稿）</em>' : '') + '</li>';
    }).join('');

    return '<section class="report-section" id="posture"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">仪态八项</h2>' +
      '<p class="lede" style="margin-bottom:22px">这些数全部从逐帧人体关键点算出来（' + p.withPose + ' / ' + p.total +
        ' 帧有有效关键点，采样间隔约 ' + p.step + ' 秒）。视频画面里的位置和角度是代理指标，不追求精确到度，只看趋势和异常段。</p>' +
      '<details class="mt-fold"><summary>指标与算法（' + p.metrics.length + ' 项，点开看每一项怎么算的）</summary>' +
      '<div class="panel po-panel"><table class="po-table"><thead><tr>' +
        '<th>指标</th><th>这次</th><th>门槛</th><th>怎么算的</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' +
      pointsHTML(p.points, { title: '身体仪态评分点（8 项，占仪态表情 6 成）' }) +
      problemShotsHTML(p) +
      framesAIHTML(report) +
      ((side || down) && !(p.problemShots && p.problemShots.length) ? '<div class="sp-grid">' +
        (side ? '<div class="panel"><div class="panel-title">整段背对的时间段（写板书转身不算）</div><ul class="po-runs">' + side + '</ul></div>' : '') +
        (down ? '<div class="panel"><div class="panel-title">低头看稿的时间段</div><ul class="po-runs">' + down + '</ul></div>' : '') +
      '</div>' : '') +
    '</div></section>';
  }

  /* 通用的截图墙：仪态、表情、板书共用一套，点时间码能跳回那一秒 */
  function shotsGallery(shots, title, note) {
    if (!shots || !shots.length) return '';
    var items = shots.map(function (s) {
      var reason = s.reason ? '<span class="ps-reason">' + esc(s.reason) + '</span>' : '';
      return '<li class="ps-item">' +
        '<img class="ps-img" alt="" decoding="async" src="' + s.img + '">' +
        '<div class="ps-cap">' + timeChip(s.at) + reason + '</div>' +
        '</li>';
    }).join('');
    return '<div class="panel ps-panel" style="margin-top:14px">' +
      '<div class="panel-title">' + esc(title) + '（' + shots.length + ' 张，点时间码跳到那一秒）</div>' +
      '<ul class="ps-grid">' + items + '</ul>' +
      (note ? '<p class="panel-note">' + esc(note) + '</p>' : '') +
      '</div>';
  }

  /* 仪态出问题的那几秒：背对/低头/抱臂，逐张铺出来 */
  function problemShotsHTML(p) {
    return shotsGallery((p && p.problemShots) || [], '仪态问题截图',
      '这些是程序判出来「这一秒仪态有问题」的画面，逐张截的，没有挑选。');
  }

  /* 逐帧仪态复核：模型一帧一帧说「这一帧里身体和脸是什么样」，
     每张卡片都能对回具体那一帧（缩略图 + 时间码），说不了的帧不补。 */
  /* 每张截图的分析：模型对 shotList 里每一张各写一条，按 id 对上就显示。
     分批请求后，没拿到分析的那几张也保留条目，标成「这几张没拿到分析」。 */
  function shotAnalysesHTML(report) {
    var a = (report && report.ai) || {};
    var list = a.images || [];
    if (!list.length) return '';
    var shotCount = a.shotCount != null ? a.shotCount : list.length;
    var analyzed = a.analyzedCount != null ? a.analyzedCount : list.filter(function (it) {
      return it && (it.observe || it.consistent);
    }).length;
    var items = list.map(function (it) {
      var at = (it.at != null && isFinite(it.at)) ? it.at : null;
      var when = at != null ? timeChip(at) : '<span class="fr-ai-t">—</span>';
      var miss = !(it.observe || it.consistent);
      var body = miss
        ? '<p class="sa-line sa-miss" style="color:#a86200">这几张没拿到分析' +
            (it.reason ? '<span style="opacity:.7">（程序判断：' + esc(it.reason) + '）</span>' : '') + '</p>'
        : (it.observe ? '<p class="sa-line"><b>看到</b>' + esc(it.observe) + '</p>' : '') +
          (it.consistent ? '<p class="sa-line"><b>与程序判断</b>' + esc(it.consistent) + '</p>' : '');
      return '<li class="sa-item"><div class="sa-head">' + when +
        '<span class="sa-id">' + esc(it.id || '') + '</span></div>' + body +
        '</li>';
    }).join('');
    return '<div class="panel sa-panel" style="margin-top:14px">' +
      '<div class="panel-title">逐张分析（' + shotCount + ' 张截图，' + analyzed + ' 条分析）</div>' +
      '<ul class="sa-list">' + items + '</ul>' +
      '<p class="panel-note">每张截图对应一条；模型没返回的那几张也保留在列表里，标为「这几张没拿到分析」。</p></div>';
  }
  function framesAIHTML(report) {
    var a = report.ai || {};
    var list = a.frames || [];
    if (!list.length) return '';
    var pool = {};
    (report.shots || []).forEach(function (s) { if (s && s.img) pool[String(s.frameId)] = s; });
    var ev = eventsOf(report);
    /* 把这一帧和最接近的事件绑在一起（10 秒内才算），
       这样「模型说身体侧身」和报告里「P1 整段背对」指向同一条记录 */
    var nearestEvent = function (t) {
      if (t == null || !isFinite(t)) return null;
      var pick = function (onlyPosture) {
        var best = null, bd = 1e9;
        ev.forEach(function (e) {
          if (e.at == null || !isFinite(e.at)) return;
          if (onlyPosture && e.domain !== 'posture') return;
          var d = Math.abs(e.at - t);
          if (d < bd) { bd = d; best = e; }
        });
        return (best && bd <= 10) ? { ev: best, gap: bd } : null;
      };
      /* 仪态帧优先绑仪态事件，绑不到再退到任意事件 */
      return pick(true) || pick(false);
    };
    var items = list.map(function (f) {
      var hit = pool[String(f.frameId)] || null;
      var at = (f.at != null && isFinite(f.at)) ? f.at : (hit ? hit.t : null);
      var thumb = hit ? '<img class="fr-ai-thumb" alt="" src="' + hit.img + '">' : '';
      var when = (at != null && isFinite(at)) ? timeChip(at) : '<span class="fr-ai-t">—</span>';
      var link = nearestEvent(at);
      var linkTxt = link
        ? '<span class="fr-ai-ev">对应事件 ' + esc(link.ev.id) + '：' + esc(link.ev.reason || '') + '</span>'
        : '<span class="fr-ai-ev is-none">这一刻没有对应的事件记录（只有数值指标）</span>';
      return '<li class="fr-ai-item">' + thumb +
        '<div class="fr-ai-body">' +
          '<div class="fr-ai-head">' + when +
            '<span class="fr-ai-fid">' + esc(f.frameId || '—') + '</span></div>' +
          linkTxt +
          (f.posture ? '<p class="fr-ai-line"><b>身体</b>' + esc(f.posture) + '</p>' : '') +
          (f.face ? '<p class="fr-ai-line"><b>面部</b>' + esc(f.face) + '</p>' : '') +
          (f.note ? '<p class="fr-ai-note">' + esc(f.note) + '</p>' : '') +
        '</div></li>';
    }).join('');
    return '<div class="panel fr-ai-panel" style="margin-top:16px">' +
      '<div class="panel-title">逐帧仪态复核（模型看这 ' + list.length + ' 帧，逐帧说身体和脸）</div>' +
      '<ul class="fr-ai-list">' + items + '</ul>' +
      '<p class="fr-ai-tip">这几帧是程序从全片均匀挑出来的，不是挑最好看的；模型只描述画面里看得见的动作，不猜情绪。</p>' +
      '</div>';
  }

  function timeChip(t) {
    return '<button type="button" class="ts-time" data-t="' + t + '">' + util.fmtTime(Math.round(t)) + '</button>';
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  /* 语速这句话要分开写：讲解段和提问段的语速本来就该不一样，
     再补一句「逐字稿只覆盖了多少」，免得看到的数字跟视频对不上 */
  function speedNote(s) {
    var bits = [];
    if (s.speedExplain) bits.push('讲解段 ' + s.speedExplain + ' 字/分');
    if (s.speedAsk) bits.push('提问段 ' + s.speedAsk + ' 字/分');
    if (s.askSentences && s.askSentences.length) bits.push('（其中 ' + s.askSentences.length + ' 句是问句）');
    var w = s.window;
    if (w && w.partial) {
      bits.push('逐字稿只覆盖 ' + Math.round(w.coverRatio * 100) + '% 的时长（' +
        util.fmtTime(Math.floor(w.from)) + '–' + util.fmtTime(Math.ceil(w.to)) + '），语速与曲线只按这一段算');
    }
    if (!bits.length) return '语速按有效讲话时长算，已经去掉静默。';
    return bits.join('；') + '。';
  }

  /* 表情六项：只写画面里能看见的面部动作，不写「看起来紧张/不自信」 */
  function faceHTML(report) {
    var f = report.face;
    if (!f || !f.metrics || !f.metrics.length) return '';

    var cards = f.metrics.map(function (m) {
      return '<div class="fa-cell' + (m.abnormal ? ' is-bad' : '') + '">' +
        '<div class="fa-name">' + esc(m.name) + '</div>' +
        '<div class="fa-val">' + (m.value == null ? '—' : m.value) + '<i>' + esc(m.unit || '') + '</i></div>' +
        '<div class="fa-th">' + esc(m.threshold || '') + '</div>' +
        '<div class="fa-fo">' + esc(m.formula || '') + '</div>' +
      '</div>';
    }).join('');

    var runs = (f.longRuns || []).slice().sort(function (a, b) { return a.from - b.from; }).map(function (r) {
      return '<li>' + timeChip(r.from) + ' ' + esc(r.text) + '约 ' + Math.round(r.dur) + ' 秒</li>';
    }).join('');

    /* 视线落在哪：四类各占多少，用一条横条说清楚，比只给一个百分数直观 */
    var g = f.gaze || {};
    var gTotal = (g.camera || 0) + (g.down || 0) + (g.up || 0) + (g.side || 0);
    var gazeBox = '';
    if (gTotal > 0) {
      var parts = [
        { label: '看镜头', n: g.camera || 0, cls: 'gz-cam' },
        { label: '低头看稿', n: g.down || 0, cls: 'gz-down' },
        { label: '看侧边', n: g.side || 0, cls: 'gz-side' },
        { label: '抬头', n: g.up || 0, cls: 'gz-up' }
      ].filter(function (x) { return x.n > 0; });
      gazeBox = '<div class="panel" style="margin-top:16px"><div class="panel-title">视线落在哪（有脸的 ' + gTotal + ' 帧）</div>' +
        '<div class="gz-bar">' + parts.map(function (x) {
          return '<i class="' + x.cls + '" style="width:' + (x.n / gTotal * 100).toFixed(1) + '%"></i>';
        }).join('') + '</div>' +
        '<div class="gz-legend">' + parts.map(function (x) {
          return '<span><i class="' + x.cls + '"></i>' + esc(x.label) + ' ' + (x.n / gTotal * 100).toFixed(0) + '%（' + x.n + ' 帧）</span>';
        }).join('') + '</div></div>';
    }

    return '<section class="report-section" id="face"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">面部动作</h2>' +
      '<p class="lede" style="margin-bottom:22px">这一块只描述<strong>画面里看得见的面部动作</strong>（嘴角、眉头、嘴唇、眼球方向），不给情绪或心理下结论。' +
        '检测到脸的帧 ' + f.withFace + ' / ' + f.total + '（出脸率 ' + f.faceRate + '%），采样间隔约 ' +
        (Math.round(f.step * 10) / 10) + ' 秒。</p>' +
      '<div class="fa-grid">' + cards + '</div>' +
      pointsHTML(f.points, { title: '面部评分点（8 项，占仪态表情 4 成）' }) +
      shotsGallery(f.problemShots || [], '表情问题截图',
        '这些是「表情几乎不变」「视线长时间朝下」持续较久的那几秒，逐张截的。') +
      gazeBox +
      (runs ? '<div class="panel" style="margin-top:16px"><div class="panel-title">持续 3 秒以上的片段</div>' +
        '<ul class="po-runs">' + runs + '</ul></div>' : '') +

    '</div></section>';
  }

  /* 板书几何：只算「写在哪、写多大、排得齐不齐」，不管内容对不对。
     内容完整性在「试讲内容」那一项和 AI 复核里看，不能混在一起。 */
  function boardGeoHTML(report) {
    var b = report.visual && report.visual.board;
    var m = b && (b.metrics || (b.crop && b.crop.metrics));
    if (!m || !m.available || !m.metrics || !m.metrics.length) return '';

    var rows = m.metrics.map(function (x) {
      var v = (x.value == null) ? '—' : (x.value + (x.unit || ''));
      return '<tr class="' + (x.abnormal ? 'is-bad' : '') + '">' +
        '<th scope="row">' + esc(x.name) + '</th>' +
        '<td class="po-val">' + v + '</td>' +
        '<td class="po-th">' + esc(x.threshold || '—') + '</td>' +
        '<td class="po-fo">' + esc(x.formula || '') + '</td>' +
      '</tr>';
    }).join('');

    /* 每一行写在哪：给一张行位置示意图，比数字直观 */
    var bands = (m.rows && m.rows.list) || [];
    var spark = '';
    if (m.measurable && bands.length >= 2) {
      var hs = bands.map(function (r) { return r.charH || 4; });
      var maxH = Math.max.apply(null, hs);
      spark = '<div class="br-rows">' + bands.map(function (r) {
        var top = (r.y0 / m.height * 100).toFixed(1);
        var hh = Math.max(6, (r.y1 - r.y0) / m.height * 100);
        var left = (r.x0 / m.width * 100).toFixed(1);
        var ww = ((r.x1 - r.x0) / m.width * 100).toFixed(1);
        return '<i style="top:' + top + '%;left:' + left + '%;width:' + ww + '%;height:' + hh + '%"></i>';
      }).join('') + '</div>';
    }

    return '<section class="report-section" id="boardgeo"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">板书几何</h2>' +
      '<p class="lede" style="margin-bottom:22px">这些数全部从裁剪出来的板面像素算（' + m.width + '×' + m.height +
        '，取的是第 ' + util.fmtTime(Math.round(b.at || 0)) + ' 秒那一帧）。只看「写在哪、多大、齐不齐」，不看内容对不对。' +
        '内容完整性另有校验，模型不给板书打分。' + (m.measurable ? '' : '这一帧的字块只有 ' + (m.charHeight || '几') + ' 像素高，字号与行距只是参考，量不准。') + '</p>' +
      (spark ? '<div class="panel" style="margin-bottom:18px"><div class="panel-title">行位置（' + bands.length + ' 行）</div>' + spark + '</div>' : '') +
      '<details class="mt-fold"><summary>指标与算法（' + m.metrics.length + ' 项，点开看每一项怎么算的）</summary>' +
      '<div class="panel po-panel"><table class="po-table"><thead><tr>' +
        '<th>指标</th><th>这次</th><th>门槛</th><th>怎么算的</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' +
      pointsHTML(m.points, { title: '板书评分点（11 项，合计即「板书工整性」）' }) +
      shotsGallery(b.shots || [], '板面画面',
        '从录像里按时间挑的板面裁剪，用来看板面在不同阶段的样子（不是只取一张「最佳图」）。') +
      (function () {
        var ocr = m.ocr || (b.crop && b.crop.ocr);
        var srcTxt;
        if (m.charSource === 'ocr' && ocr) {
          srcTxt = '字距、字号用 OCR 字符框算（' + (ocr.count || 0) + ' 个框' +
            (ocr.source === 'local' ? '，本机识别' : '，服务端识别') +
            (ocr.ms ? '，' + Math.round(ocr.ms / 100) / 10 + ' 秒' : '') + '）。';
        } else if (ocr && !ocr.ok) {
          srcTxt = 'OCR 没成功（' + esc(ocr.error || '未返回字符框') + '），字距、字号只能按连通域估算。';
        } else {
          srcTxt = '没有配 OCR，字距、字号按像素连通域估算。';
        }
        return '<p class="panel-note" style="margin-top:12px">' + srcTxt + '</p>';
      })() +

    '</div></section>';
  }

  /* 总览第二块：把问题按发生的秒数摆到一条时间轴上。
     看得见「哪里问题密集」，比读一串列表快。 */
  function timelineHTML(report) {
    var list = (report.issues || []).filter(function (it) { return it.start != null; });
    if (!list.length) return '';
    var dur = report.duration || 0;
    if (!dur) {
      var last = list[list.length - 1];
      dur = Math.max(last.end || last.start || 1, 60);
    }
    var counts = { high: 0, mid: 0, low: 0 };
    list.forEach(function (it) { counts[it.severity] = (counts[it.severity] || 0) + 1; });

    var ticks = list.map(function (it) {
      var p = Math.min(100, Math.max(0, it.start / dur * 100));
      return '<button type="button" class="tl-tick is-' + it.severity + '" style="left:' + p.toFixed(2) + '%"' +
        ' data-t="' + it.start + '" title="' + esc(util.fmtTime(Math.round(it.start)) + '　' + (it.problem || '')) + '"></button>';
    }).join('');

    /* 每 1/6 报一个刻度，够看出位置，又不至于挤成一团 */
    var axis = '';
    for (var i = 0; i <= 6; i++) {
      var t = Math.round(dur * i / 6);
      axis += '<span style="left:' + (i / 6 * 100).toFixed(2) + '%">' + util.fmtTime(t) + '</span>';
    }

    return '<section class="report-section" id="timeline"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(24px,3vw,34px)">问题分布</h2>' +
      '<p class="lede" style="margin-bottom:18px">' + list.length + ' 条问题按发生的秒数摆在时间轴上：' +
        '<b class="tl-k is-high">严重 ' + counts.high + '</b>　<b class="tl-k is-mid">该改 ' + counts.mid + '</b>　<b class="tl-k is-low">可优化 ' + (counts.low || 0) + '</b>' +
        '。点一下竖条跳到录像那一段。</p>' +
      '<div class="panel"><div class="tl-track">' + ticks + '</div>' +
        '<div class="tl-axis">' + axis + '</div></div>' +
    '</div></section>';
  }

  /* 优先改进清单：只给三条，按「严重度 × 扣分」排，并把改法写成能照做的一句话 */
  function priorityHTML(report) {
    var list = (report.issues || []).slice();
    if (!list.length) return '';
    var rank = { high: 0, mid: 1, low: 2 };
    list.sort(function (a, b) {
      var ra = rank[a.severity]; var rb = rank[b.severity];
      var d = (ra == null ? 9 : ra) - (rb == null ? 9 : rb);
      if (d) return d;
      return (Math.abs(b.points || 0)) - (Math.abs(a.points || 0));
    });
    var top = list.slice(0, 3);
    var cards = top.map(function (it, i) {
      return '<li class="pr-item">' +
        '<span class="pr-n">' + (i + 1) + '</span>' +
        '<div class="pr-main"><p class="pr-prob">' + esc(it.problem || '') + '</p>' +
          '<p class="pr-fix">' + esc(it.suggestion || it.explanation || '') + '</p>' +
          '<p class="pr-where">' + (it.start != null ? timeChip(it.start) : '<span class="pr-scope">全片</span>') +
            ' <span class="pr-mod">' + esc(it.categoryName || '') + '</span></p>' +
        '</div></li>';
    }).join('');
    return '<section class="report-section" id="priority"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(24px,3vw,34px)">先改这三条</h2>' +
      '<p class="lede" style="margin-bottom:18px">按严重程度和扣分排的前三条。一次改不了全部，先把这三条改掉，分就上来了。</p>' +
      '<ol class="pr-list">' + cards + '</ol>' +
    '</div></section>';
  }

  /* 理论错误专章：分「能确认的」和「待人工确认的」两堆。
     能确认的写错误表述、正确说法、原句、秒数；待确认的只列出来，不当结论。 */
  function theoryHTML(report) {
    var th = report.theory;
    if (!th || !th.available) return '';
    var all = th.items || [];
    if (!all.length) {
      return '<section class="report-section" id="theory"><div class="wrap">' +
        '<h2 class="h2" style="font-size:clamp(24px,3vw,34px)">理论错误</h2>' +
        '<p class="lede">逐字稿里没有查到可确认的理论错误；该讲的环节也都听到了。</p>' +
      '</div></section>';
    }

    var conf = all.filter(function (it) { return !it.pending; });
    var pend = all.filter(function (it) { return it.pending; });

    function card(it, isPending) {
      var where = it.at != null ? timeChip(it.at) : '<span class="ts-time is-none">—</span>';
      var q = it.quote ? '<p class="th-quote">「' + esc(it.quote) + '」</p>' : '';
      var wrong = it.wrong ? '<p class="th-wrong"><b>说成了</b>' + esc(it.wrong) + '</p>' : '';
      var right = it.correct ? '<p class="th-right"><b>应该是</b>' + esc(it.correct) + '</p>' : '';
      var why = it.why ? '<p class="th-why">' + esc(it.why) + '</p>' : '';
      var confTxt = (Math.round((it.confidence || 0) * 100)) + '%';
      return '<li class="th-item' + (isPending ? ' is-pending' : '') + '">' +
        '<div class="th-head">' + where +
          '<span class="th-badge">' + (it.layer === 1 ? '规则' : it.layer === 2 ? '结构' : '模型') + '</span>' +
          '<span class="th-conf">置信度 ' + confTxt + '</span>' +
        '</div>' + q + wrong + right + why +
      '</li>';
    }

    return '<section class="report-section" id="theory"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(24px,3vw,34px)">理论错误</h2>' +
      '<p class="lede" style="margin-bottom:18px">三层校验：规则层只看字面（能百分百复现）、结构层看该讲的环节讲没讲、模型层做语义判断。' +
        '模型层置信度不到 70% 的一律放进「待人工确认」，不写进结论。<br>这次：确认 ' + conf.length + ' 条，待确认 ' + pend.length + ' 条。</p>' +
      (conf.length ? '<ol class="th-list">' + conf.map(function (it) { return card(it, false); }).join('') + '</ol>' : '') +
      (pend.length ? '<details class="th-pending"><summary>待人工确认 ' + pend.length + ' 条（可能是识别错或口误，先别改）</summary>' +
        '<ol class="th-list">' + pend.map(function (it) { return card(it, true); }).join('') + '</ol></details>' : '') +
    '</div></section>';
  }

  /* 评分细则 v2：一张总分卡 + A/B/C 三张明细表 + D 红线。
     每一行都能追到「实测多少、落在哪一档、拿了几分」，没有一句是模型编的。 */
  /* 证据截图墙：仪态、表情、板书各自出问题（或需要示例）的那几帧，
     全部铺在评分表后面，点时间码跳回录像。这是「分数之外要能看见」的部分。 */
  /* 逐帧明细：把每一个采样帧的仪态与表情数值摊开，不只给汇总
     （板书几何只在选中的那一帧上算，逐帧只给时间与截图，见「板面画面」） */
  function frameTableHTML(report) {
    var po = (report.posture && report.posture.series) || null;
    var fc = (report.face && report.face.series) || null;
    if (!po && !(fc && fc.length)) return '';
    var rows = [];
    var faceAt = {};
    (fc || []).forEach(function (f) { faceAt[Math.round(f.t)] = f.label; });
    var facing = function (v) { return v == null ? '—' : (v >= 0.32 ? '正面' : (v >= 0.18 ? '侧身' : '背对')); };
    var bIssues = ((report.visual && report.visual.board && report.visual.board.issues) || []);
    var boardAt = function (sec) {
      var hit = null;
      bIssues.forEach(function (s) { if (s.at != null && Math.abs(s.at - sec) <= 6) hit = (s.kind === 'layout' ? '排版' : (s.kind === 'occlusion' ? '遮挡' : (s.kind === 'glare' ? '反光' : '模糊'))); });
      return hit;
    };
    if (po && po.t) {
      for (var i = 0; i < po.t.length; i++) {
        var tsec = Math.round(po.t[i]);
        var bd = boardAt(tsec);
        var bad = (po.facing && po.facing[i] != null && po.facing[i] < 0.18) || (po.noseUp && po.noseUp[i] != null && po.noseUp[i] < 0.12) || !!bd || /不变|朝下/.test(faceAt[tsec] || '');
        rows.push('<tr' + (bad ? ' class="is-bad"' : '') + '><td>' + util.fmtTime(tsec) + '</td><td>' + facing(po.facing ? po.facing[i] : null) +
          '</td><td>' + (po.noseUp && po.noseUp[i] != null && po.noseUp[i] < 0.12 ? '低头' : '平视') +
          '</td><td>' + esc(faceAt[tsec] || '—') + '</td><td>' + (bd ? esc(bd) : '正常') + '</td></tr>');
      }
    } else {
      (fc || []).forEach(function (f) {
        rows.push('<tr><td>' + util.fmtTime(Math.round(f.t)) + '</td><td>—</td><td>—</td><td>' + esc(f.label || '—') + '</td></tr>');
      });
    }
    if (!rows.length) return '';
    return '<details class="mt-fold"><summary>逐帧明细（共 ' + rows.length + ' 行：每一帧的朝向、低头、表情）</summary>' +
      '<table class="po-table"><thead><tr><th>时间</th><th>朝向</th><th>头部</th><th>表情</th><th>板书</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody></table>' +
      '<p class="panel-note">这一表是程序逐帧量出来的原始值，不是模型写的；板书几何只在选中的那一帧上算，逐帧只保留截图。</p>' +
      '</details>';
  }
  function evidenceShotsHTML(report) {
    var out = '';
    var bd = (report.visual && report.visual.board) || {};
    var ev = eventsOf(report);
    var pose = ev.filter(function (e) { return e.domain === 'posture'; });
    var face = ev.filter(function (e) { return e.domain === 'face'; });
    var boardList = ev.filter(function (e) { return e.domain === 'board'; });
    out += shotsGallery(pose, '仪态问题截图',
      '背对、低头、抱臂持续较久的那几秒，逐张截的；写板书转身不算。');
    out += shotsGallery(face, '表情问题截图',
      '表情几乎不变、视线长时间朝下的那几秒，逐张截的。');
    out += shotsGallery(bd.shots || [], '板面画面',
      '从录像里按时间挑的板面裁剪，用来看板面在不同阶段的样子。');
    out += boardIssuesHTML(boardList);
    return out;
  }

  /* 统一事件：截图、评分、AI 读同一份，不再各算各的。
     {id, domain, rubricItemId, at, requested, eventAt, reason, img, full, frameId, status} */
  function eventsOf(report) {
    if (report && report.events && report.events.length) return report.events;
    var po = report.posture || {};
    var fc = report.face || {};
    var bd = (report.visual && report.visual.board) || {};
    var list = [];
    (po.problemShots || []).forEach(function (s, i) {
      list.push({
        id: 'P' + (i + 1), domain: 'posture', rubricItemId: 'B2',
        at: s.at, requested: s.requested, eventAt: s.eventAt, timeSource: s.timeSource,
        reason: s.reason, img: s.img, status: 'confirmed'
      });
    });
    (fc.problemShots || []).forEach(function (s, i) {
      list.push({
        id: 'F' + (i + 1), domain: 'face', rubricItemId: 'B4',
        at: s.at, requested: s.requested, eventAt: s.eventAt, timeSource: s.timeSource,
        reason: s.reason, img: s.img, status: 'confirmed'
      });
    });
    (bd.issues || []).forEach(function (s, i) {
      list.push({
        id: 'C' + (i + 1), domain: 'board', kind: s.kind || 'quality', rubricItemId: s.kind === 'layout' ? 'C1' : 'C2',
        at: s.at, frameId: s.frameId, reason: s.reason, img: s.img, full: s.full,
        box: s.box, boxFull: s.boxFull, hasLocalBox: !!s.hasLocalBox,
        status: s.kind === 'layout' ? 'observed' : 'confirmed'
      });
    });
    return list;
  }

  /* 板书问题：每条都给整帧 + 板面局部（红框标出问题位置）+ 原因 + 时间码 */
  function boardIssuesHTML(list) {
    if (!list.length) return '';
    var cards = list.map(function (it) {
      return '<li class="ps-item is-issue">' +
        '<img class="ps-img" alt="" decoding="async" src="' + it.img + '">' +
        (it.full ? '<img class="ps-full" alt="" decoding="async" src="' + it.full + '">' : '') +
        '<div class="ps-cap">' + timeChip(it.at) +
          '<span class="ps-reason">' + esc(it.reason) + '</span>' +
          '<span class="ps-kind">' + (it.kind === 'occlusion' ? '遮挡' : it.kind === 'glare' ? '反光' : it.kind === 'layout' ? '排版' : '模糊') + '</span>' +
        '</div>' +
        '</li>';
    }).join('');
    return '<div class="panel ps-panel">' +
      '<div class="panel-title">板书问题（' + list.length + ' 处' + (list.some(function (x) { return x.hasLocalBox; }) ? '，红框是问题位置' : '') + '）</div>' +
      '<ul class="ps-grid ps-grid-issue">' + cards + '</ul>' +
      '<p class="panel-note">' + (list.some(function (x) { return x.hasLocalBox; }) ? '上面那张是板面局部（红框=挡板的位置），下面那张是整帧。' : '这条是整块板面的质量提醒，定位不到具体是哪一笔，所以没有红框。') + '时间码是这一帧的实际时间。</p>' +
      '</div>';
  }
  /* 板书内容核对：把「本课必写要点」逐条对照 OCR 认出来的板书文字。
     只报「在认出文字里找没找到」，不做「写得对不对」的判断——那要学科知识，留给 AI 复核。 */
  function boardCheckHTML(report) {
    var bc = report.boardCheck;
    if (!bc) return '';
    if (bc.available === false) {
      return '<div class="panel bc-panel">' +
        '<div class="panel-title">板书内容核对</div>' +
        '<p class="bc-note">' + esc(bc.reason || '这一项这次不评。') + '</p>' +
        '</div>';
    }
    var rows = (bc.items || []).map(function (it) {
      var mark = it.state === 'hit' ? '写了' : it.state === 'partial' ? '只写到一部分' : it.state === 'skip' ? '太短，不评' : '没找到';
      var cls = it.state === 'hit' ? 'is-good' : it.state === 'partial' ? 'is-warn' : it.state === 'skip' ? 'is-na' : 'is-bad';
      return '<li class="bc-row ' + cls + '">' +
        '<span class="bc-item">' + esc(it.item) + '</span>' +
        '<span class="bc-mark">' + mark + '</span>' +
        (it.evidence ? '<span class="bc-ev">板书上写着「' + esc(it.evidence) + '」</span>' : '') +
        '</li>';
    }).join('');
    var head = bc.counts.hit + ' 条写到、' + bc.counts.partial + ' 条只写一半、' + bc.counts.miss + ' 条没找到';
    return '<div class="panel bc-panel">' +
      '<div class="panel-title">板书内容核对（' + bc.counts.scored + ' 条要点，' + head + '）</div>' +
      '<ul class="bc-list">' + rows + '</ul>' +
      '<p class="bc-note">' + esc(bc.note || '') + '</p>' +
      (bc.text ? '<details class="bc-ocr"><summary>OCR 认出来的板书文字（' + bc.text.length + ' 字）</summary><p>' + esc(bc.text) + '</p></details>' : '') +
      '</div>';
  }

  function rubric2HTML(report) {
    var r = report.rubric2;
    var t = r.total;
    var has = t.base != null;
    var pct = function (m) {
      if (m.score == null || !m.max) return 0;
      return Math.max(0, Math.min(100, Math.round(m.score / m.max * 100)));
    };
    var cover = t.coverage == null ? 0 : t.coverage;
    /* 覆盖率不到一半就只给参考，不摆一个漂亮的大数字误导人 */
    var enough = has && cover >= 50;
    var num = enough && t.pct != null ? t.pct : null;
    var cls = !enough ? 'partial' : (num >= 75 ? 'ok' : (num >= 55 ? 'partial' : 'bad'));

    var out = '<section class="rp-status"><div class="wrap">';

    out += '<div class="rp-top">' +
      (report.demo ? '<div class="rp-demo-row"><span class="rp-demo">示例报告 · 不是你的录像</span></div>' : '') +
      (report.audioOnly ? '<div class="rp-demo-row"><span class="rp-demo">纯语音 · 只录音频，板书与仪态不评</span></div>' : '') +
      '<div class="rp-top-line">' +
        '<span class="rp-chip ' + cls + '">' + (enough ? (t.reference ? '已测项参考分' : '按细则计分') : '证据不足') + '</span>' +
        '<span class="rp-grade">' + (enough ? (t.grade || '— / 不足以评级') : '— / 证据不足，不出等级') + '</span>' +
      '</div>' +
      '<div class="rp-score-line">' +
        '<span class="rp-total">' + (num != null ? num.toFixed(1) : '—') + '</span>' +
        '<span class="rp-total-label">' + (enough
          ? (t.reference ? '参考分' : '百分制') + ' · 按已测项折算（测到 ' + t.measuredMax + '/' + t.totalMax + ' 分，覆盖 ' + cover + '%）' +
            (t.deduction ? ' · 红线 −' + t.deduction : '')
          : (has
            ? '证据太少（只测到 ' + t.measuredMax + '/' + t.totalMax + ' 分，覆盖 ' + cover + '%），这次不出分'
            : '没有可用证据，这次不出分')) +
        '</span>' +
      '</div>' +
    '</div>';

    var mods = [
      { key: 'A', mod: r.A, name: '语音与表达', cls: 'a' },
      { key: 'B', mod: r.B, name: '仪态与表情', cls: 'b' },
      { key: 'C', mod: r.C, name: '板书', cls: 'c' }
    ];
    out += '<ul class="rb-bars">' + mods.map(function (m) {
      var s = m.mod.score;
      return '<li class="rb-bar ' + m.cls + '">' +
        '<span class="rb-bar-name">' + m.key + ' ' + m.name + '</span>' +
        '<span class="rb-bar-track"><i style="width:' + pct(m.mod) + '%"></i></span>' +
        '<span class="rb-bar-num">' + (s == null ? '—' : s) + '<i>/' + (m.mod.max || m.mod.maxTotal) + '</i></span>' +
      '</li>';
    }).join('') + '</ul>';

    if (r.worstThree && r.worstThree.length) {
      out += '<div class="rb-worst">' +
        '<div class="rb-worst-t">最该补的三项</div>' +
        '<ol>' + r.worstThree.map(function (w) {
          return '<li><b>' + w.id + ' ' + esc(w.name) + '</b>' +
            '<span>' + w.score + '/' + w.max + '</span></li>';
        }).join('') + '</ol></div>';
    } else if (has && cover >= 85) {
      out += '<div class="rb-worst"><div class="rb-worst-t">本次没有明显短板</div>' +
        '<p class="rb-note">已测项目里没有低于 85% 的项，先把上面三块保持住。</p></div>';
    } else if (has) {
      out += '<div class="rb-worst"><div class="rb-worst-t">证据还不够排短板</div>' +
        '<p class="rb-note">这次只测到 ' + cover + '% 的分值（' + t.measuredMax + '/' + t.totalMax + ' 分），剩下的项没拿到证据，所以不排最弱项、也不给等级。</p></div>';
    } else {
      out += '<div class="rb-worst"><div class="rb-worst-t">为什么没有分</div>' +
        '<p class="rb-note">这次没有拿到任何可测量的证据（逐字稿、人体关键点、板面像素都没有），所以不出总分、不排最弱项，也不给等级。</p></div>';
    }

    /* 首屏只留三件事：状态、覆盖、最该补的三条；再给三个入口，
       明细（每一项怎么算的）默认折叠，想追证据的人才点开。 */
    out += '<div class="rp-entries">' +
      '<button type="button" class="rp-entry" data-scroll="issues">问题与证据</button>' +
      '<button type="button" class="rp-entry" data-scroll="transcript">完整逐字稿</button>' +
      '<button type="button" class="rp-entry" data-scroll="rubricBasis">评分依据</button>' +
      '</div>';

    out += '</div></section>';

    out += boardCheckHTML(report);
    out += evidenceShotsHTML(report);
    out += frameTableHTML(report);
    /* AI 逐帧复核：模型对每一帧仪态图的描述，逐条铺在这里（新版式下也要显示） */
    out += framesAIHTML(report);
    out += '<details class="mt-fold" id="rubricBasis">' +
      '<summary>评分依据（A/B/C 每一项怎么算出来的 · 点开）</summary>' +
      modTable('A', '语音与表达', r.A, 'a') +
      modTable('B', '仪态与表情', r.B, 'b') +
      modTable('C', '板书', r.C, 'c') +
      dTable(r.D, t) +
      '</details>';

    if (r.unmeasured && r.unmeasured.length) {
      out += '<section class="report-section section-light"><div class="wrap">' +
        '<p class="lede">这些项这次没有证据，不参与计分，也不按「没做错」算满分：' +
        esc(r.unmeasured.join('、')) + '。</p></div></section>';
    }
    return out;
  }

  function modTable(key, name, mod, cls) {
    var rows = (mod.items || []).map(function (d) {
      var has = d.score != null;
      var ratio = has ? d.score / d.max : 0;
      var state = !has ? 'is-na' : (ratio < 0.6 ? 'is-bad' : (ratio >= 0.85 ? 'is-good' : ''));
      var meta = [];
      if (d.measured != null) meta.push('实测 ' + d.measured + (d.unit && d.unit !== '—' ? ' ' + d.unit : ''));
      /* 测不出来的项统一由下面那句说明讲清楚，不再堆一行档位 */
      if (has && d.bucket && d.bucket !== '—') meta.push(d.bucket);
      var metaTxt = meta.join(' · ');
      var noteTxt = d.note || '';
      if (noteTxt === metaTxt) noteTxt = '';
      return '<li class="rb-row ' + state + '">' +
        '<div class="rb-row-top">' +
          '<span class="rb-name"><b>' + d.id + '</b> ' + esc(d.name) + '</span>' +
          '<span class="rb-score">' + (has ? d.score : '—') + '<i>/' + (d.measurableMax != null ? d.measurableMax : (d.nominalMax != null ? d.nominalMax : d.max)) + '</i></span>' +
      (has && d.measurableMax != null && d.measurableMax < (d.nominalMax || d.max) ? '<span class="rb-nom">标准 ' + (d.nominalMax || d.max) + '</span>' : '') +
        '</div>' +
        (metaTxt ? '<div class="rb-meta">' + esc(metaTxt) + '</div>' : '') +
        (noteTxt ? '<p class="rb-note">' + esc(noteTxt) + '</p>' : '') +
      '</li>';
    }).join('');
    return '<section class="report-section' + (cls === 'b' ? ' section-light' : '') + '" id="rb' + key + '">' +
      '<div class="wrap">' +
        '<div class="rb-head"><h2 class="h2" style="font-size:clamp(24px,3.2vw,34px)">' + key + ' · ' + name + '</h2>' +
          '<span class="rb-sum">' + (mod.earned != null ? mod.earned : '—') + ' / ' + mod.measurableMax +
      (mod.measurableMax < mod.nominalMax ? '<i class="rb-nom">标准 ' + mod.nominalMax + '</i>' : '') + '</span></div>' +
        '<ul class="rb-list">' + rows + '</ul>' +
      '</div></section>';
  }

  function dTable(D, t) {
    var errs = D.errors || [];
    var body;
    if (!errs.length) {
      body = '<p class="rb-none">这次没有查出知识性错误。</p>';
    } else {
      body = '<ul class="rb-list">' + errs.map(function (e) {
        return '<li class="rb-row is-bad">' +
          '<div class="rb-row-top">' +
            '<span class="rb-name"><b>' + esc(e.level) + '</b>' + (e.at != null ? ' · ' + util.fmtTime(e.at) : '') + '</span>' +
            '<span class="rb-score">−' + e.cut + '</span>' +
          '</div>' +
          (e.quote ? '<div class="rb-quote">「' + esc(e.quote) + '」</div>' : '') +
          (e.correct ? '<p class="rb-note">正确表述：' + esc(e.correct) + '</p>' : '') +
        '</li>';
      }).join('') + '</ul>';
    }
    return '<section class="report-section" id="rbD"><div class="wrap">' +
      '<div class="rb-head"><h2 class="h2" style="font-size:clamp(24px,3.2vw,34px)">D · 红线扣分</h2>' +
        '<span class="rb-sum">' + (D.deduction ? '−' + D.deduction : '0') + '</span></div>' +
      '<p class="lede" style="margin-bottom:18px">概念 6 分、推理 5 分、术语 3 分、数值口误 1 分、当场改口 0.5 分（最多累计 2 分）。有红线的还会封顶总分。</p>' +
      body +
      '<p class="rb-meta">基础分 ' + t.base + ' − 红线 ' + t.deduction + ' = ' + t.raw + '，最终 ' + t.capped + '。</p>' +
    '</div></section>';
  }

  function render(report, opts) {
    opts = opts || {};
    state.report = report;
    state.onSeek = opts.onSeek || null;
    state.aiConsent = false;
    destroy();

    var serverAi = !!(App.ai && App.ai.serverMode);

    var body = document.getElementById('reportBody');
    if (!body) return;
    if (!report) { body.innerHTML = ''; return; }

    var meta = [];
    if (report.topic) meta.push('<span>课题 <b>' + esc(report.topic) + '</b></span>');
    meta.push('<span>时长 <b>' + util.fmtTime(report.duration) + '</b></span>');
    meta.push('<span>有效讲话 <b>' + fmtSpeech(report.stats.speechMinutes) + '</b></span>');
    if (report.stats.rate) meta.push('<span>语速 <b>' + report.stats.rate + ' 字/分</b></span>');
    else meta.push('<span>语速 <b>—</b></span>');
    meta.push('<span>评分时间 <b>' + util.fmtDate(report.ts) + '</b></span>');

    var html = '';

    /* 首屏：评估状态、已测/未测、一句结论、最要紧的三条、逐字稿入口 */
    var rated = report.rated !== false && (!report.evidence || report.evidence.status !== 'insufficient');
    state.rated = rated;

    /* 新版（评分细则 v2）：总分 + A/B/C/D 四块，其余明细不再平铺 */
    if (report.rubric2) {
      html += rubric2HTML(report);
    } else if (report.speech && App.Rubric2) {
      /* 旧报告（细则版之前）不静默改分：标明版本，给一个主动重评的按钮 */
      html += '<section class="report-section section-light"><div class="wrap">' +
        '<p class="lede">这份报告是旧口径（评分细则版之前）生成的，分数与现在的标准不同，不会自动改。</p>' +
        '<p><button type="button" class="btn btn-ghost" id="btnRerate">按新版细则重算这份报告</button></p>' +
        '</div></section>';
      html += statusHTML(report);
      html += priorityHTML(report);
    } else {
    html += statusHTML(report);
    /* 「先改这三条」紧跟结论：用户最需要的是「下一步做什么」，不是先看一堆表 */
    html += priorityHTML(report);
    /* 时间轴：没有标记也画出来，否则用户会以为这块没做 */
    var tlItems = report.timeline || [];
    html += '<section class="report-section section-light"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">问题时间轴</h2>' +
      '<p class="lede" style="margin-bottom:20px">' + (tlItems.length ? '点任意标记，跳到录像对应秒数。' : '这一遍没有触发任何扣分点，时间轴是空的。') + '</p>' +
      '<div class="panel timeline-panel">' +
        '<div class="tl-legend">' +
          '<span><i style="background:' + TL_COLORS.pause + '"></i>停顿</span>' +
          '<span><i style="background:' + TL_COLORS.longpause + '"></i>长停顿</span>' +
          '<span><i style="background:' + TL_COLORS.filler + '"></i>语气词</span>' +
          '<span><i style="background:' + TL_COLORS.repeat + '"></i>整句重复</span>' +
          '<span><i style="background:' + TL_COLORS.stall + '"></i>句中卡顿</span>' +
        '</div>' +
        '<div class="tl-canvas-wrap"><canvas id="timeline" height="88"></canvas></div>' +
        '<div class="tl-axis"><span>0:00</span><span>' + util.fmtTime(report.duration / 2) + '</span><span>' + util.fmtTime(report.duration) + '</span></div>' +
        '<p class="tl-hint">' + (tlItems.length
          ? '共 ' + tlItems.length + ' 个标记。标记密集的地方，就是听课人最难受的地方。'
          : '零标记不代表满分——也可能是讲得太短，还没有机会暴露问题。') + '</p>' +
      '</div>' +
    '</div></section>';
    }

    /* 逐字稿：紧接着首屏，默认收在自己的区域里，点一下就能全文对照 */
    html += transcriptHTML(report);
    /* 问题清单：证据指向具体原话/画面，放在建议之前 */
    html += issuesHTML(report);

    /* 改进建议：放在最前面。先看要改什么，再看分项。 */
    var nMust = (report.advice.must || []).length;
    var nTop = nMust ? nMust : Math.min(3, (report.advice.should || []).length);
    html += '<section class="report-section section-light" id="advice"><div class="wrap">' +
      '<p class="eyebrow">改进建议</p>' +
      '<h2 class="h2" style="font-size:clamp(24px,3.2vw,34px)">这次先改这 ' + nTop + ' 处</h2>' +
      '<p class="lede" style="margin-bottom:24px">按优先级排。第一档不改，其它都是白搭。</p>' +
      '<div id="adviceList">' + adviceHTML(report.advice) + '</div>' +
      '<p class="adv-jump"><button class="btn btn-ghost" type="button" data-scroll="examples">看看 90 分的示范 →</button></p>' +
    '</div></section>';

    /* 示范 */
    html += examplesHTML();

    /* 雷达 + 关键数据 */
    html += '<section class="report-section"><div class="wrap report-grid-2">' +
      '<div class="panel"><div class="panel-title">能力雷达</div>' + radarHTML(report.dims) +
        '<p class="panel-note">面积越大越均衡。凹进去的角，就是最该补的那一块。</p></div>' +
      '<div class="panel"><div class="panel-title">关键数据</div>' +
        '<div class="stat-row" style="grid-template-columns:repeat(2,1fr);gap:18px">' +
          stat(report.stats.pauses, '次停顿') +
          stat(report.stats.longPauses, '次长停顿') +
          stat(report.stats.fillers == null ? '—' : report.stats.fillers, '次语气词') +
          stat(report.stats.rate || '—', '字 / 分钟') +
        '</div>' +
        '<p class="panel-note" id="modeNote">' + modeNote(report) + '</p>' +
      '</div>' +
    '</div></section>';

    /* 七维度 + 老的四块明细：只有旧报告（没有细则 v2 数据）才渲染 */
    if (!report.rubric2) {
    /* 七维度 */
    html += '<section class="report-section" style="padding-top:8px"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">七维度明细</h2>' +
      '<p class="lede" style="margin-bottom:26px">每一项都写清楚扣了几分、为什么扣、对应录像第几秒。</p>' +
      '<div class="dim-list">' + report.dims.map(dimCardHTML).join('') + '</div>' +
    '</div></section>';

    /* 语言与节奏 + 仪态八项：新口径的两块，放在维度明细之后、画面时间线之前 */
    html += speechHTML(report);
    html += postureHTML(report);
    html += faceHTML(report);
    html += boardGeoHTML(report);
    html += theoryHTML(report);
    }

    /* 画面时间线 */
    html += shotsHTML(report);


    /* 仪态自评：只在自动评估没做成时出现，而且明确写着「不计分」 */
    if (!(report.mode && report.mode.posture)) {
      html += '<section class="report-section section-light"><div class="wrap">' +
        '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">仪态自评（只作备忘，不计分）</h2>' +
        '<p class="lede" style="margin-bottom:20px">这一段没拿到可用的人体姿态，所以「仪态」这一项<strong>未评估</strong>：既不扣分，也不会因为自评而变成有分。想自己留个数就照实打，它只写进这份报告的备忘。</p>' +
        '<div class="panel">' +
          '<div class="rubric" id="postureRubric">' + postureRubricHTML() + '</div>' +
          '<p class="panel-note" id="selfPostureOut" hidden></p>' +
          '<p class="panel-note">自评不会改变总分、雷达图和覆盖率——这几样只按真正测到的项算。</p>' +
        '</div>' +
      '</div></section>';
    }

    /* 板书 */
    if (report.board && report.board.dataUrl) {
      var boardSrc = report.board.auto && report.board.at != null
        ? '没单独拍板书，这张是从录像 ' + util.fmtTime(Math.round(report.board.at)) + ' 那一帧自动截的。'
        : '这是你在准备页拍的那张板书。';
      html += '<section class="report-section" id="board"><div class="wrap">' +
        '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">板书</h2>' +
        '<p class="lede" style="margin-bottom:20px">' + esc(boardSrc) + '自动粗评只判断图像质量，符号写得规不规范要你自己拖。</p>' +
        '<div class="report-grid-2">' +
          '<div class="panel"><div class="board-strip">' +
            '<figure><img src="' + report.board.dataUrl + '" alt="板书"><figcaption>板书 · ' +
              (report.board.at != null ? util.fmtTime(Math.round(report.board.at)) : '准备页拍摄') + '</figcaption></figure>' +
          '</div></div>' +
          '<div class="panel"><div class="panel-title">五项评分（每项 20 分）</div>' +
            '<div class="rubric" id="rubric">' + rubricHTML(report) + '</div>' +
            '<p class="panel-note">拖动即改分，总分实时更新。改动只影响本次报告，不回写原文。</p>' +
          '</div>' +
        '</div>' +
      '</div></section>';
    }

    /* AI 深度点评 */
    html += '<section class="report-section section-light"><div class="wrap">' +
      '<h2 class="h2" style="font-size:clamp(26px,3.4vw,38px)">AI 深度点评</h2>' +
      '<p class="lede" style="margin-bottom:20px">' + (serverAi
        ? '本站已经配好模型，不用你填 Key。<b>默认不会自动发送</b>——你点了才会发，发之前会先告诉你要发什么、发给谁。'
        : '可选。需要你自己填 API Key，点击后逐字稿会发送到第三方模型，点之前会先跟你确认发什么。') + '</p>' +
      '<div class="panel" id="aiPanel">' +
        '<p class="panel-note" style="margin-top:0">' +
          (serverAi
            ? '统一额度模式' + (App.ai.dailyPerIp ? '，每台设备每天限 ' + App.ai.dailyPerIp + ' 次' : '') + '。点下方按钮让模型复核自动评分。'
            : (App.ai.enabled()
              ? '已配置接口，点击下方按钮让模型复核自动评分。'
              : '未配置 API Key。本地七维度评分不依赖它，可在准备页底部填写。')) +
        '</p>' +
        '<div class="report-actions" style="margin-top:16px">' +
          '<button class="btn btn-primary" type="button" id="btnAi">用 AI 复核</button>' +
        '</div>' +
        '<div id="aiResult"></div>' +
      '</div>' +
    '</div></section>';

    /* 底部操作。没有录像时（示例报告、或历史报告里没留下录像），回放/下载直接置灰并说明原因，
       免得点下去以为坏了。 */
    var noVideo = !!opts.noVideo || report.demo === true;
    var why = report.demo ? '示例报告没有录像' : '这份报告没有保存录像';
    var playTxt = report.audioOnly ? '回放录音' : '回放录像';
    var dlTxt = report.audioOnly ? '下载录音' : '下载录像';
    html += '<section class="report-section section-dark"><div class="wrap">' +
      '<div class="report-actions">' +
        '<button class="btn btn-primary" type="button" id="btnPlay"' + (noVideo ? ' disabled' : '') + '>' + playTxt + '</button>' +
        '<button class="btn btn-ghost" type="button" id="btnDownload"' + (noVideo ? ' disabled' : '') + '>' + dlTxt + '</button>' +
        '<button class="btn btn-ghost" type="button" id="btnExport">导出报告 JSON</button>' +
        '<button class="btn btn-ghost" type="button" id="btnPrint">打印 / 存为 PDF</button>' +
        '<button class="btn btn-ghost" type="button" id="btnAgain">重新试讲</button>' +
      '</div>' +
      (noVideo ? '<p class="fine" style="margin-top:14px">' + esc(why) + '，所以回放和下载不可用；其余功能正常。</p>' : '') +
    '</div></section>';

    body.innerHTML = html;

    /* ---------------- 动画与事件 ---------------- */
    var C = 2 * Math.PI * 100;
    var ring = document.getElementById('ringVal');
    var scoreEl = document.getElementById('ringScore');

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var anyMeasured = (report.dims || []).some(function (d) { return !d.missing && d.score != null; });
        if (ring) ring.style.strokeDashoffset = (C * (anyMeasured ? 1 - report.total / 100 : 1)).toFixed(1);
        if (scoreEl) {
          if (anyMeasured) util.countUp(scoreEl, report.total, { decimals: 1, duration: 900 });
          else scoreEl.textContent = '—';
        }
        var shape = document.getElementById('radarShape');
        if (shape) {
          shape.style.transition = 'opacity .6s ease .25s';
          shape.setAttribute('opacity', '1');
        }
        body.querySelectorAll('.dim-bar i').forEach(function (bar) {
          var w = bar.getAttribute('data-w');
          requestAnimationFrame(function () { bar.style.width = w + '%'; });
        });
      });
    });

    var canvas = document.getElementById('timeline');
    if (canvas) {
      state.canvas = canvas;
      drawTimeline(canvas, report, function (t) { if (state.onSeek) state.onSeek(t); });
      var onResize = util.debounce(function () { drawTimeline(canvas, report, function (t) { if (state.onSeek) state.onSeek(t); }); }, 180);
      window.addEventListener('resize', onResize);
      state.cleanup.push(function () { window.removeEventListener('resize', onResize); });
    }

    // 时间点跳转（onclick 覆盖式绑定，避免重复渲染时事件叠加）
    body.onclick = function (ev) {
      /* 逐字稿版本切换：原始 / 修正 */
      var tsBtn = ev.target.closest('[data-ts]');
      if (tsBtn) {
        var mode = tsBtn.getAttribute('data-ts');
        body.querySelectorAll('.ts-btn').forEach(function (b) {
          b.classList.toggle('is-on', b === tsBtn);
        });
        body.querySelectorAll('.ts-text').forEach(function (el) {
          var v = el.getAttribute(mode === 'raw' ? 'data-raw' : 'data-fixed');
          el.textContent = v == null ? '' : v;
        });
        return;
      }
      /* 首屏的「查看完整逐字稿 / 全部问题」 */
      var jump = ev.target.closest('[data-scroll]');
      if (jump) {
        var target = document.getElementById(jump.getAttribute('data-scroll'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      var chip = ev.target.closest('[data-seek]');
      if (chip) {
        var t = parseFloat(chip.getAttribute('data-seek'));
        if (state.onSeek) state.onSeek(t);
        return;
      }
      var frame = ev.target.closest('.frame-card[data-t]');
      if (frame) {
        var ft = parseFloat(frame.getAttribute('data-t'));
        if (state.onSeek) state.onSeek(ft);
        return;
      }
      var iss = ev.target.closest('.issue-time[data-t]');
      if (iss) {
        var it = parseFloat(iss.getAttribute('data-t'));
        if (state.onSeek) state.onSeek(it);
        return;
      }
      /* 逐字稿每一段的时间码 */
      var tst = ev.target.closest('.ts-time[data-t]');
      if (tst) {
        var tt = parseFloat(tst.getAttribute('data-t'));
        if (state.onSeek) state.onSeek(tt);
      }
    };

    // 板书滑块
    var rubric = document.getElementById('rubric');
    if (rubric) {
      rubric.addEventListener('input', function (ev) {
        var input = ev.target;
        if (!input || input.type !== 'range') return;
        var item = input.getAttribute('data-item');
        var b = input.parentNode.querySelector('b');
        if (b) b.textContent = input.value;
        var dim = report.dims.filter(function (d) { return d.key === 'board'; })[0];
        if (!dim) return;
        var it = dim.raw.items.filter(function (x) { return x.key === item; })[0];
        if (it) it.score = parseInt(input.value, 10);
        recalc(report);
      });
    }

    // 仪态自评
    var prubric = document.getElementById('postureRubric');
    if (prubric) {
      prubric.addEventListener('input', function (ev) {
        var input = ev.target;
        if (!input || input.type !== 'range') return;
        var b = input.parentNode.querySelector('b');
        if (b) b.textContent = input.value;
        var all = prubric.querySelectorAll('input[type="range"]');
        var sum = 0;
        Array.prototype.forEach.call(all, function (i) { sum += parseInt(i.value, 10) || 0; });
        var avg = sum / Math.max(1, all.length);
        setPosture(report, Math.round(avg / 5 * 100));
      });
    }

    document.getElementById('btnAi').addEventListener('click', function () {
      runAI(report, opts);
    });

    /* 旧报告：用户主动点才按新细则重算，重算结果写回这份报告并重新渲染 */
    (function bindRerate() {
      var rb = document.getElementById('btnRerate');
      if (!rb || !App.Rubric2) return;
      rb.addEventListener('click', function () {
        try {
          var vb = (report.visual && report.visual.board) || {};
          var boardM = (vb.crop && vb.crop.metrics) || vb.metrics || null;
          report.rubric2 = App.Rubric2.compute({
            speech: report.speech, posture: report.posture, face: report.face,
            board: boardM, theory: report.theory, boardCheck: report.boardCheck || null,
            audio: report.audio || {}, duration: report.duration || 0
          });
          report.ruleVersion = 'rubric2';
          if (opts && opts.onSave) opts.onSave(report);
          render(report, opts);
        } catch (e) {
          alert('重算失败：' + (e && e.message));
        }
      });
    })();

    /* 页面写着「只有点击才发送」，那就真的只有点击才发：
       不自动调 autoAI，用户点「用 AI 复核」才会把逐字稿和截图发出去 */

    ['btnPlay', 'btnDownload', 'btnExport', 'btnPrint', 'btnAgain'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', function () {
        if (id === 'btnPlay') opts.onPlay && opts.onPlay();
        if (id === 'btnDownload') opts.onDownload && opts.onDownload();
        if (id === 'btnExport') opts.onExport && opts.onExport();
        if (id === 'btnPrint') printReport();
        if (id === 'btnAgain') opts.onAgain && opts.onAgain();
      });
    });

    return body;
  }

  /** 打印：先展开所有折叠明细，打完再还原（否则 PDF 里的扣分明细是空的） */
  function printReport() {
    var closed = [];
    document.querySelectorAll('#reportBody details:not([open])').forEach(function (d) {
      closed.push(d);
      d.setAttribute('open', '');
    });
    document.body.classList.add('printing');

    var done = false;
    function restore() {
      if (done) return;
      done = true;
      closed.forEach(function (d) { d.removeAttribute('open'); });
      document.body.classList.remove('printing');
      window.removeEventListener('afterprint', restore);
    }
    window.addEventListener('afterprint', restore);
    setTimeout(restore, 5000);

    if (state.canvas && state.report) {
      drawTimeline(state.canvas, state.report, function (t) { if (state.onSeek) state.onSeek(t); });
    }
    setTimeout(function () { window.print(); }, 80);
  }

  function stat(v, label) {
    return '<div class="stat"><b>' + esc(String(v)) + '</b><span>' + esc(label) + '</span></div>';
  }

  function modeNote(report) {
    var m = report.mode || {};
    var e = report.evidence || {};
    var parts = [];
    if (m.lesson === 'clip') parts.push('按「教学片段」评估：片段里没有导入/小结/作业是正常的，不按整堂课的环节清单扣分。');
    if (m.lesson === 'full') parts.push('按「完整课堂」评估。');
    if (m.speechEstimated) parts.push('有效讲话时长是按视频长度估算的（没拿到精确值）。');
    if (m.postureSelfReported) parts.push('仪态项按自评题改写，不是摄像头测量值。');
    if (report.partial) {
      parts.push('这次评估到 ' + report.partial.count + ' 项，没评估的（' +
        report.partial.missing.join('、') + '）不计分、也不算低分。');
    }
    if (e.warn) parts.push(e.warn);
    if (!parts.length) parts.push('七项数据全部来自本次采集。');
    return parts.join('');
  }

  function rubricHTML(report) {
    var dim = report.dims.filter(function (d) { return d.key === 'board'; })[0];
    if (!dim || !dim.raw || !dim.raw.items || !dim.raw.items.length) return '';
    return App.RULES.board.items.map(function (item) {
      var hit = dim.raw.items.filter(function (x) { return x.key === item.key; })[0] || {};
      var measured = hit.score != null;
      var cur = measured ? hit.score : 12;
      return '<div class="rubric-row' + (measured ? '' : ' is-guess') + '">' +
        '<span>' + esc(item.name) + (measured ? '' : ' <em class="dim-none">未测</em>') + '</span>' +
        '<input type="range" min="0" max="20" step="1" value="' + cur + '" data-item="' + item.key + '" aria-label="' + esc(item.name) + '">' +
        '<b>' + (measured ? cur : '—') + '</b>' +
      '</div>';
    }).join('');
  }

  var SELF_NOTE = '仪态分数由自评题改写，不是摄像头测量值。';

  var POSTURE_QS = [
    ['q1', '站姿稳定：没有来回晃、靠桌、插兜'],
    ['q2', '不长时间低头看稿；写板书转身不算问题，整段背对才扣'],
    ['q3', '手势自然有指向：不是无处安放，也不是挥个不停'],
    ['q4', '表情有变化：讲到重点时有强调感，不是全程平脸'],
    ['q5', '眼神给到「学生」：看镜头，而不是盯屏幕或天花板']
  ];

  function postureRubricHTML() {
    return POSTURE_QS.map(function (q) {
      return '<div class="rubric-row">' +
        '<span>' + esc(q[1]) + '</span>' +
        '<input type="range" min="1" max="5" step="1" value="3" data-q="' + q[0] + '" aria-label="' + esc(q[1]) + '">' +
        '<b>3</b>' +
      '</div>';
    }).join('');
  }

  /** 重算「已测项参考分」、覆盖率与评级状态；缺测项不参与任何计算 */
  function applyTotal(report) {
    var measured = report.dims.filter(function (d) { return !d.missing && d.score != null; });
    var weightSum = measured.reduce(function (a, d) { return a + d.weight; }, 0);
    var sum = measured.reduce(function (a, d) { return a + d.score * d.weight; }, 0);
    var total = weightSum > 0.05 ? sum / weightSum : 0;
    total = Math.round(total * 10) / 10;

    report.total = total;
    var cov = Math.round(weightSum * 100) / 100;
    var E = (App.RULES && App.RULES.evidence) || { fullCoverage: 0.99, partialCoverage: 0.55 };
    var status = cov >= E.fullCoverage ? 'complete' : cov >= E.partialCoverage ? 'partial' : 'insufficient';
    if (report.evidence) { report.evidence.coverage = cov; report.evidence.status = status; }
    report.status = status;
    report.rated = status === 'complete';
    report.partial = measured.length < report.dims.length ? {
      count: measured.length,
      total: report.dims.length,
      weight: cov,
      missing: report.dims.filter(function (d) { return d.missing || d.score == null; })
        .map(function (d) { return d.name; })
    } : null;

    if (status === 'complete') {
      var g = App.Scoring.grade(total);
      report.grade = { key: g.key, label: g.label, desc: g.desc };
    } else {
      report.grade = {
        key: '—',
        label: '不足以评级',
        desc: status === 'insufficient'
          ? '可评估的维度太少，这次不给等级结论。'
          : '只评估了部分维度，下面是已测项的参考分，不构成完整试讲的等级结论。'
      };
    }

    var scoreEl = document.getElementById('ringScore');
    var ring = document.getElementById('ringVal');
    var unitEl = document.getElementById('ringUnit');
    var badge = document.getElementById('gradeBadge');
    var C = 2 * Math.PI * 100;

    /* 一项都没测到时不能显示 0 分——那是「考了 0 分」，不是「没考」 */
    var none = measured.length === 0;
    if (scoreEl) scoreEl.textContent = none ? '—' : total.toFixed(1);
    if (ring) ring.style.strokeDashoffset = (C * (none ? 1 : 1 - total / 100)).toFixed(1);
    if (unitEl) unitEl.textContent = none ? '没有可评的证据' : (report.rated ? 'TOTAL / 100' : '已测项参考分');
    if (badge) {
      badge.classList.toggle('is-unrated', !report.rated);
      badge.innerHTML = '<i class="dot"></i>' + report.grade.key + ' · ' + report.grade.label;
    }

    /* 头部总评首句同步，避免环形图与文字两套分数 */
    var sumEl = document.querySelector('.report-summary');
    if (sumEl && sumEl.textContent) {
      var head = report.rated
        ? '总分 ' + total.toFixed(1) + '，' + report.grade.key + '（' + report.grade.label + '）。'
        : '部分评估：已测 ' + measured.length + ' 项，参考分 ' + total.toFixed(1) + '。';
      sumEl.textContent = report.rated
        ? sumEl.textContent.replace(/^总分 [^。]*。/, head)
        : sumEl.textContent.replace(/^(部分评估|总分)[^。]*。/, head);
    }
  }

  /** 手动改分后同步该维度卡片 */
  function updateDimCard(report, key) {
    var dim = report.dims.filter(function (d) { return d.key === key; })[0];
    if (!dim) return null;
    dim.weighted = util.round1(dim.score * dim.weight);

    var sel = '.dim-card[data-dim="' + key + '"]';
    var card = document.querySelector(sel + ' .dim-score');
    if (card) card.innerHTML = dim.score + '<small>/100</small>';
    var bar = document.querySelector(sel + ' .dim-bar i');
    if (bar) { bar.style.width = dim.score + '%'; bar.setAttribute('data-w', dim.score); }
    var sub = document.querySelector(sel + ' .dim-sub');
    if (sub) sub.textContent = '加权 ' + dim.weighted + ' 分';
    var tr = document.querySelector(sel + ' .dim-trace span');
    if (tr && dim.trace) tr.textContent = traceText(dim);
    return dim;
  }

  /** 手动改分之后，把所有跟分数有关的区块重新对齐 */
  function refreshDerived(report) {
    report.dims.forEach(function (d) { updateDimCard(report, d.key); });

    var radar = document.getElementById('radar');
    if (radar) radar.innerHTML = radarHTML(report.dims);

    if (App.Scoring && App.Scoring.advice && report.ctxLite) {
      report.advice = App.Scoring.advice(report.dims, report.ctxLite);
      var list = document.getElementById('adviceList');
      if (list) list.innerHTML = adviceHTML(report.advice);
      var title = document.querySelector('#advice .h2');
      if (title) {
        var n = (report.advice.must || []).length;
        title.textContent = '这次先改这 ' +
          (n || Math.min(3, (report.advice.should || []).length)) + ' 处';
      }
    }

    applyTotal(report);
  }

  /** 板书手动校准后重算总分 */
  function recalc(report) {
    var board = report.dims.filter(function (d) { return d.key === 'board'; })[0];
    if (!board || !board.raw || !board.raw.items) return;
    var measured = board.raw.items.filter(function (b) { return b.score != null; });
    if (!measured.length) return;
    /* 只把测到/手动打过分的项折算成百分制 */
    var sum = measured.reduce(function (a, b) { return a + b.score; }, 0);
    board.score = Math.max(0, Math.min(100, Math.round(sum / (20 * measured.length) * 100)));
    board.missing = false;      /* 手动打过分就算测到了 */
    board.notes = (board.notes || []).filter(function (n) { return n.indexOf('不评估') < 0 && n.indexOf('20 分计入') < 0; });
    board.raw.missing = false;
    board.manuallyAdjusted = true;
    board.trace = {
      mode: 'sum',
      steps: measured.slice(),
      final: board.score,
      deducted: 0,
      manual: true,
      measuredItems: measured.length
    };
    refreshDerived(report);
  }

  /** 仪态自评改分 */
  /* 自评只作为备忘记录：不填自动分、不改覆盖率、不进总分。
     用户要求「自评不能制造完整评估」，所以这里只写一段话，不动 dims。 */
  function setPosture(report, score) {
    var v = util.clamp(Math.round(score), 0, 100);
    report.selfPosture = { score: v, at: Date.now() };
    var box = document.getElementById('selfPostureOut');
    if (box) {
      box.textContent = '你的自评：' + v + ' 分。已记在这份报告里，只作备忘——上面那一项的自动分与总覆盖率不受影响。';
      box.hidden = false;
    }
  }

  /* ------------------------------------------------------------------ AI */
  /* 报告出来就自动复核：不用用户再点一次按钮。
     只在配了 Key / 站点额度可用时跑；同一份报告只跑一次。 */
  function autoAI(report) {
    if (!App.ai || !App.ai.enabled || !App.ai.enabled()) return;
    if (!report || report._aiTried) return;
    if (report.ai && report.ai.ok) return;
    if (report.rated === false) return;            /* 样本不足就不折腾模型了 */
    report._aiTried = true;
    var btn = document.getElementById('btnAi');
    var out = document.getElementById('aiResult');
    if (!btn || !out) return;
    out.innerHTML = '<p class="sugg-empty" style="margin-top:16px">正在自动复核（逐字稿 + 板书与画面帧）……</p>';
    setTimeout(function () { sendToAI(report, btn, out); }, 600);
  }

  function runAI(report, opts) {
    var btn = document.getElementById('btnAi');
    var out = document.getElementById('aiResult');
    if (!btn || !out) return;
    if (state.aiBusy) return;                       /* 防重复提交：看状态，不看按钮 */

    if (!App.ai.enabled()) {
      out.innerHTML = '<p class="sugg-empty" style="margin-top:16px">还没有配置 API Key。到准备页最下方的「AI 深度点评」填写后再来。</p>' +
        '<p class="panel-note">没有配置时，这里会写「未运行」，不会假装复核过。</p>';
      report.ai = { ok: false, error: '未配置 API Key / 视觉模型，AI 视觉复核没有运行' };
      markAI(report);
      return;
    }

    /* 报告生成时已经自动发过一次；这里的按钮只用于「再复核一遍」。 */
    sendToAI(report, btn, out);
  }

  function sendToAI(report, btn, out) {
    if (state.aiBusy) return;
    state.aiBusy = true;
    var resetBtn = function () {
      state.aiBusy = false;
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = '重新复核';
    };
    if (btn) { btn.disabled = true; btn.textContent = '复核中…'; }
    out.innerHTML = '<p class="sugg-empty" style="margin-top:16px">正在把逐字稿发给模型，最多等两分钟——它在先想后答。</p>';

    /* 图片要带身份：每张图对应哪一帧、第几秒，模型必须能说出来，报告也才能回溯 */
    var vision = [];
    var vb = report.visual && report.visual.board;
    if (report.board && report.board.dataUrl) {
      vision.push({
        frameId: (vb && vb.frameId) || (report.board.crop && report.board.crop.frameId) || 'board',
        at: report.board.at != null ? report.board.at : ((vb && vb.at) || 0),
        role: 'board',
        dataUrl: report.board.dataUrl
      });
    }
    (report.shots || []).filter(function (s) { return s && s.img; }).slice(0, 2).forEach(function (s) {
      vision.push({
        frameId: s.frameId || ('t' + Math.round(s.t || 0)),
        at: s.t || 0,
        role: 'frame',
        dataUrl: s.img
      });
    });
    vision = vision.slice(0, 3);

    /* 逐帧仪态：从全片均匀挑 4 帧（首/中/后/末），让模型一帧一帧说身体和脸 */
    var posePool = (report.shots || []).filter(function (s) { return s && s.img; });
    /* 截下来的每一张都给模型：仪态/表情/板面的问题截图全进一个列表，去重后最多 12 张 */
    var allShots = [];
    (function () {
      var seenKey = {};
      var add = function (dom, at, dataUrl, reason) {
        if (!dataUrl) return;
        if (allShots.length >= 12) return;
        var k = dom + '|' + Math.round(at || 0);
        if (seenKey[k]) return;
        seenKey[k] = 1;
        allShots.push({ id: dom + Math.round(at || 0), domain: dom, at: Math.round(at || 0), dataUrl: dataUrl, reason: reason || '' });
      };
      var evAll = eventsOf(report);
      evAll.forEach(function (e) { if (e.img) add(e.domain, e.at, e.img, e.reason); });
      ((report.visual && report.visual.board && report.visual.board.shots) || []).forEach(function (s) {
        add('board', s.at, s.img, '板面画面');
      });
    })();
    var poseShots = [];
    if (posePool.length) {
      var idxs = [0, Math.floor(posePool.length / 3), Math.floor(posePool.length * 2 / 3), posePool.length - 1];
      var seen = {};
      idxs.forEach(function (i) {
        if (seen[i] || !posePool[i]) return;
        seen[i] = 1;
        var s = posePool[i];
        var hint = s.facing === 'back' ? '背对镜头' : (s.facing === 'side' ? '侧身' : (s.facing === 'front' ? '正面' : ''));
        poseShots.push({
          frameId: s.frameId || ('t' + Math.round(s.t || 0)),
          at: s.t || 0,
          dataUrl: s.img,
          hint: hint
        });
      });
    }

    var imgs = vision.map(function (v) { return v.dataUrl; });

    /* 截图按 4 张一组切分：一组一次请求，模型一次只看 4 张，少看漏；
       每组都必须按 shotList 的 id 逐张回，凑不齐的由 ai.js 补占位，报告里标出来。 */
    var SHOT_BATCH = 4;
    var groups = [];
    for (var gi = 0; gi < allShots.length; gi += SHOT_BATCH) {
      groups.push(allShots.slice(gi, gi + SHOT_BATCH));
    }
    if (!groups.length) groups.push([]);

    var basePayload = {
      topic: report.topic,
      duration: report.duration,
      lesson: (report.mode && report.mode.lesson) || 'micro',
      total: report.total,
      rated: state.rated,
      grade: report.grade,
      dims: report.dims,
      /* 有新版细则就只给细则，避免模型混用两套分数 */
      rubric2: report.rubric2 || null,
      events: eventsOf(report).map(function (e) { return { id: e.id, domain: e.domain, rubricItemId: e.rubricItemId, at: e.at, reason: e.reason, status: e.status }; }),
      stats: report.stats || null,
      sections: report.sections || null,
      shots: report.shots || null,
      board: report.board || null,
      visual: report.visual || null,
      segments: report.segments || null,
      transcript: report.transcript || '',
      vision: vision,
      poseShots: poseShots,
      images: imgs
    };

    var mergedImages = [];
    var first = null;
    var lastError = null;
    var batch = Promise.resolve();
    groups.forEach(function (group, idx) {
      batch = batch.then(function () {
        if (allShots.length && groups.length > 1) {
          out.innerHTML = '<p class="sugg-empty" style="margin-top:16px">正在分批分析截图（第 ' +
            (idx + 1) + '/' + groups.length + ' 组，共 ' + allShots.length + ' 张）…</p>';
        }
        var payload = {};
        for (var k in basePayload) payload[k] = basePayload[k];
        payload.shotList = group;
        /* 板面/仪态图只在第一组发；后面各组只发这一组的截图，省 token 也避免重复。 */
        if (idx > 0) {
          payload.vision = [];
          payload.poseShots = [];
          payload.images = [];
        }
        return App.ai.review(payload).then(function (r) {
          if (!first) first = r;
          var byId = {};
          (r.images || []).forEach(function (it) {
            if (it && it.id) byId[String(it.id)] = it;
          });
          group.forEach(function (s) {
            var hit = byId[String(s.id)];
            var observe = (hit && hit.observe) || '';
            var consistent = (hit && hit.consistent) || '';
            mergedImages.push({
              id: s.id, at: s.at, domain: s.domain, reason: s.reason,
              observe: observe, consistent: consistent,
              missing: !(observe || consistent)
            });
          });
        }).catch(function (e) {
          lastError = e;
          group.forEach(function (s) {
            mergedImages.push({
              id: s.id, at: s.at, domain: s.domain, reason: s.reason,
              observe: '', consistent: '', missing: true
            });
          });
        });
      });
    });

    batch.then(function () {
      if (!first) {
        var msg = (lastError && (lastError.message || lastError)) || '截图分析没有返回结果';
        report.ai = {
          ok: false, error: '截图分析全部失败：' + msg,
          images: mergedImages, shotCount: allShots.length,
          analyzedCount: 0, missingCount: mergedImages.length, description: ''
        };
        out.innerHTML = '<p class="sugg-empty" style="margin-top:16px">复核失败：' + esc(msg) +
          '<br><span style="opacity:.7">下面是这次发出去的截图清单，都标成「这几张没拿到分析」。</span></p>' +
          shotAnalysesHTML(report);
        markAI(report);
        return;
      }

      var r = {};
      for (var k in first) r[k] = first[k];
      r.images = mergedImages;
      r.shotCount = allShots.length;
      r.analyzedCount = mergedImages.filter(function (x) { return !x.missing; }).length;
      r.missingCount = mergedImages.length - r.analyzedCount;
      r.visionCount = (first.vision || []).length;
      r.frameCount = (first.frames || []).length;

      /* 把这次复核的结果写回报告，诊断表要跟着变（成功也写、失败也写原因） */
      var vn = r.visionCount;
      var fn = r.frameCount;
      if (r.visionLimited) {
        report.ai = {
          ok: false, model: r.model, error: '当前接口不接受图片输入（模型不支持视觉），视觉复核没有完成',
          images: mergedImages, shotCount: allShots.length,
          analyzedCount: r.analyzedCount, missingCount: r.missingCount, description: ''
        };
      } else if (r.visionFailed) {
        report.ai = {
          ok: false, model: r.model, error: r.visionFailed,
          images: mergedImages, shotCount: allShots.length,
          analyzedCount: r.analyzedCount, missingCount: r.missingCount, description: ''
        };
      } else if (vn || fn || mergedImages.length) {
        report.ai = {
          ok: true, model: r.model, visionCount: vn, frameCount: fn,
          shotCount: allShots.length, analyzedCount: r.analyzedCount, missingCount: r.missingCount,
          images: mergedImages,
          frames: (r.frames || []).map(function (f) {
            return { frameId: f.frameId || null, at: f.at != null ? Number(f.at) : null,
              posture: f.posture || '', face: f.face || '', note: f.note || '' };
          }),
          description: '已复核 ' + vn + ' 张画面图' + (fn ? '、' + fn + ' 帧仪态' : '') +
            '；截图 ' + allShots.length + ' 张，拿到 ' + r.analyzedCount + ' 条分析' +
            (r.missingCount ? '（' + r.missingCount + ' 条缺失）' : '') +
            '，模型 ' + (r.model || '—')
        };
      } else if (vision.length || poseShots.length) {
        report.ai = { ok: false, model: r.model, error: '图片发出去了，但返回里没有任何视觉观察' };
      } else {
        report.ai = { ok: true, model: r.model, description: '这次没有图片可发，只复核了文字部分' };
      }
      /* report.ai 写完了再渲染逐帧卡片，否则拿到的是上一次的结果 */
      out.innerHTML = aiResultHTML(r) + framesAIHTML(report) + shotAnalysesHTML(report);
      markAI(report);
    }).catch(function (e) {
      out.innerHTML = '<p class="sugg-empty" style="margin-top:16px">复核失败：' + esc(e.message || e) +
        (e.detail ? '<br><span style="opacity:.7">' + esc(e.detail) + '</span>' : '') +
        '<br><span style="opacity:.7">上面如果是超时，点「重新复核」再来一次通常就过了——模型在长文本上偶尔会卡住。</span></p>';
      report.ai = { ok: false, error: '视觉复核失败：' + (e.message || e) };
      markAI(report);
    }).then(function () {
      resetBtn();
    });
  }

  /* 诊断表里那一行就地更新，不用整页重画（重画会把已经出来的复核结果冲掉） */
  function markAI(report) {
    var row = document.getElementById('dg-ai');
    if (!row) return;
    var a = report.ai || {};
    var td = row.querySelector('td');
    row.className = a.ok ? 'dg-ok' : 'dg-fail';
    if (td) td.innerHTML = '<i class="dg-dot"></i>' + esc(a.ok ? (a.description || '已返回结果') : (a.error || '视觉复核失败'));
  }

  function aiResultHTML(r) {
    var issues = (r.issues || []).map(function (i) {
      var tag = i.level === 'must' ? '必须改' : (i.level === 'bonus' ? '加分项' : '建议改');
      var at = (i.at != null && isFinite(i.at))
        ? '<button type="button" class="issue-time" data-t="' + i.at + '">' + util.fmtAt(i.at) + '</button> '
        : '';
      var qtag = (i.quote && i.quoteOk === false) ? '<span class="ai-qmiss">（这条引文在逐字稿里没找到）</span>' : '';
      return '<li>' + at + '<b style="font-weight:600">[' + tag + ']</b> ' +
        (i.quote ? '「' + esc(i.quote) + '」——' : '') + esc(i.advice || '') + qtag + '</li>';
    }).join('');
    var adjust = (r.adjust || []).map(function (a) {
      return '<li>' + esc(a.dimension) + '：' + (a.delta > 0 ? '+' : '') + esc(String(a.delta)) + ' 分 —— ' + esc(a.reason || '') + '</li>';
    }).join('');
    var challenge = (r.challenge || []).map(function (c) {
      return '<li>' + esc(c.target || '') + ' —— ' + esc(c.why || '') + '</li>';
    }).join('');
    var strengths = (r.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');

    /* 视觉观察：每条必须带帧号与时间码，点一下能跳回那一秒 */
    var visionList = (r.vision || []).map(function (v) {
      var at = (v.at != null && isFinite(v.at))
        ? '<button type="button" class="issue-time" data-t="' + v.at + '">' + util.fmtAt(v.at) + '</button> '
        : '';
      return '<li>' + at + '<b style="font-weight:600">' + esc(v.frameId || '—') + '</b> ' + esc(v.observe || '') + '</li>';
    }).join('');

    return '<div style="margin-top:18px">' +
      (r.summary ? '<p style="font-size:15px;line-height:1.6">' + esc(r.summary) + '</p>' : '') +
      (r.visionLimited
        ? '<p class="panel-note" style="color:#a86200">这次没能把截图传过去（当前模型不接受图像输入），所以板书与教态没有被复核。' +
          '换一个支持图片的模型，或者以本地自动评分为准。</p>'
        : '') +
      (r.visionFailed ? '<p class="panel-note" style="color:#a86200">' + esc(r.visionFailed) + '</p>' : '') +
      (visionList ? '<div class="panel-title" style="margin-top:18px">它在画面里看到的</div><ul class="sugg-col" style="box-shadow:none;padding:0">' + visionList + '</ul>' : '') +
      (strengths ? '<div class="panel-title" style="margin-top:18px">模型认可的地方</div><ul class="sugg-col" style="box-shadow:none;padding:0">' + strengths + '</ul>' : '') +
      (issues ? '<div class="panel-title" style="margin-top:18px">逐条问题</div><ul class="sugg-col" style="box-shadow:none;padding:0">' + issues + '</ul>' : '') +
      (challenge ? '<div class="panel-title" style="margin-top:18px">它不同意本地规则的哪一条</div><ul class="sugg-col" style="box-shadow:none;padding:0">' + challenge + '</ul>' : '') +
      (adjust ? '<div class="panel-title" style="margin-top:18px">它认为自动分该调整</div><ul class="sugg-col" style="box-shadow:none;padding:0">' + adjust + '</ul>' : '') +
      '<p class="panel-note">模型：' + esc(r.model || '') + '。以上是模型观点；与本地规则不一致的地方，报告里按本地规则给分，但要改哪条规则值得你自己判断。</p>' +
    '</div>';
  }

  function destroy() {
    state.cleanup.forEach(function (fn) { try { fn(); } catch (e) {} });
    state.cleanup = [];
    state.canvas = null;
  }

  App.report = {
    render: render,
    destroy: destroy,
    drawTimeline: drawTimeline,
    current: function () { return state.report; }
  };

})(window);