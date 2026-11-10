/* ==========================================================================
   ai.js — 可选的「AI 深度点评」
   · 默认关闭；用户自己填 Key 才启用，且必须在 UI 上明示"逐字稿会发到第三方"
   · 任何失败都只提示、不影响本地评分（本地评分永远可用）
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;

  /* 没填 Key 时的统一提示：说清楚去哪儿填、填一次就够 */
  var NO_KEY = '还没填模型 Key：在准备页最下面的「AI 深度点评（填一次 Key）」里粘一次，就存在这台设备的浏览器里，下次不用再填。';

  /* 120 秒：服务端（统一额度模式）就是 120 秒超时，而且 v4.1-flash 在高推理强度下
   先想再答，一次复核经常要 40–70 秒。客户端比服务端短，就会在服务端还在算的时候
   先把请求掐掉，屏幕上只剩一句「请求超时」。 */
  /* 带图的流式复核在慢接口上要更久，给 5 分钟 */
var TIMEOUT = 300000;

  function cfg() {
    var d = App.settings.data;
    return {
      key: (d.aiKey || '').trim(),
      endpoint: (d.aiEndpoint || 'https://api.deepseek.com/chat/completions').trim(),
      model: (d.aiModel || 'deepseek-chat').trim()
    };
  }

  /* 去掉标点空白，只用「文字本身」判断引用是否存在 */
function normFlat(s) {
  return String(s || '').replace(/[\s，。、；：！？,.;:!?"'“”‘’（）()《》〈〉【】\[\]—…·~～]/g, '');
}
function buildPrompt(payload) {
    /* 评分口径只认一个来源：新版按细则（rubric2）给，旧报告才退回七维。
       两个都塞给模型，它一定会把两套分数混着说。 */
    var dimLines = '';
    var rb = payload.rubric2;
    if (rb && rb.total && rb.total.pct != null) {
      var rows = [];
      ['A', 'B', 'C'].forEach(function (mod) {
        var m = rb[mod];
        if (!m || !m.items) return;
        m.items.forEach(function (d) {
          if (d.score == null) {
            rows.push('- ' + d.id + ' ' + d.name + '：未评估（' + (d.note || '没有可用证据') + '）');
            return;
          }
          rows.push('- ' + d.id + ' ' + d.name + '：' + d.score + '/' + (d.measurableMax != null ? d.measurableMax : d.max) +
            '（标准 ' + (d.nominalMax != null ? d.nominalMax : d.max) + ' 分' + (d.status === 'partial' ? '，本次只能评其中一部分' : '') + '）' +
            (d.note ? '；' + d.note : ''));
        });
      });
      dimLines = '【按细则的得分】总分参考分 ' + rb.total.pct + '（覆盖 ' + rb.total.coverage + '%' +
        (rb.total.grade ? '，等级 ' + rb.total.grade : '，覆盖不足不出等级') + '）\n' + rows.join('\n');
      if (rb.D && rb.D.deduction) {
        dimLines += '\n【红线扣分】共 −' + rb.D.deduction + ' 分：' + (rb.D.errors || []).map(function (e) {
          return (e.quote || e.name || '') + (e.reason ? '（' + e.reason + '）' : '');
        }).join('；');
      }
    } else {
      dimLines = (payload.dims || []).map(function (d) {
        if (d.missing) return '- ' + d.name + '：未评估（没有可用证据，不计分）';
        return '- ' + d.name + '：' + d.score + ' 分（权重 ' + Math.round(d.weight * 100) + '%）' +
          (d.deductions && d.deductions.length ? '；扣分点：' + d.deductions.map(function (x) { return x.reason; }).join(' / ') : '');
      }).join('\n');
    }

    var st = payload.stats || null;

    /* 逐字稿：优先按带时间戳的片段给，不用「砍前 7000 字」这种会丢掉后半节课的做法。
       太长就隔段抽样，并在提示词里如实说明覆盖范围，不许对没给到的部分下结论。 */
    var segs = (payload.segments && payload.segments.length) ? payload.segments : null;
    var scriptBlock = '';
    var coverage = '';
    /* 片段的字段名在不同来源里不一样：实时识别给 {t,text,raw}，上传字幕给 {start,end,text}。
       这里统一取，别再把 undefined 塞给模型；空片段直接剔掉。 */
    var segT = function (s) { return s.start != null ? s.start : (s.t != null ? s.t : 0); };
    var segText = function (s) { return s.correctedText || s.text || s.raw || ''; };
    var filled = segs ? segs.filter(function (s) { return !!String(segText(s)).trim(); }) : [];
    if (filled.length) {
      /* 每段带段号 + 起止时间：模型引用时能落到具体段，
         报告里也能用段号回指（不再是「第几秒」这种模糊定位） */
      var all = filled.map(function (s, i) {
        var a = Math.round(segT(s));
        var b = s.end != null ? Math.round(s.end) : (s.tEnd != null ? Math.round(s.tEnd) : null);
        var span = b != null && b > a ? util.fmtTime(a) + '–' + util.fmtTime(b) : util.fmtTime(a);
        return '[#' + (i + 1) + ' ' + span + '] ' + segText(s);
      });
      var total = all.join('\n').length;
      var picked = all;
      if (total > 14000) {
        var step = Math.ceil(all.length / 90);
        picked = all.filter(function (_, i) { return i % step === 0; });
        coverage = '（全文 ' + all.length + ' 段、约 ' + Math.round(total / 100) / 10 +
          ' 万字；这里给的是每 ' + step + ' 段取 1 段的抽样，覆盖约 ' +
          Math.round(100 / step) + '%，没给到的段落不要下结论。）';
      }
      scriptBlock = ['【逐字稿】（每行开头是段号与录像里的起止时间，引用时请带段号）' + coverage].concat(picked).join('\n');
    } else if (payload.transcript) {
      scriptBlock = '【逐字稿】（没有时间码，只能整体看）\n' + String(payload.transcript).slice(0, 12000);
    } else {
      segs = null;
    }

    // 上传的录像如果没有字幕，只能靠可测量的部分：停顿、语速、音量。
    var metricBlock = '';
    if (!segs && !payload.transcript && st) {
      metricBlock = [
        '【可测量数据】（这段素材没有逐字稿，下面是程序从音轨里量出来的）',
        '- 总时长 ' + Math.round(payload.duration || 0) + ' 秒，其中开口说话约 ' + Math.round((st.speechMinutes || 0) * 60) + ' 秒',
        '- 停顿 ' + (st.pauses == null ? '未测到' : st.pauses + ' 次') +
          '，其中超过 5 秒的长停顿 ' + (st.longPauses == null ? 0 : st.longPauses) + ' 次',
        '- 语速 ' + (st.rate ? st.rate + ' 字/分钟' : '未测到'),
        '',
        '（这些维度请只就上面这些事实说话，不要编造逐字稿内容）',
        dimLines.replace(/^- /gm, '  - ')
      ].join('\n');
    }

    var SHOT_KIND = { both: '板书 + 人在画面里', board: '只有板书', face: '人在画面里', other: '既没板书也没人' };

    var shotBlock = '';
    if (payload.shots && payload.shots.length) {
      shotBlock = [
        '',
        '【画面】（每 30 秒一帧，下面是程序对这一帧的判定，不是评分）',
        payload.shots.map(function (s) {
          return '- ' + util.fmtTime(Math.round(s.t)) + '：' + (SHOT_KIND[s.kind] || SHOT_KIND.other) +
            (s.lum != null ? '，平均亮度 ' + s.lum : '') +
            (s.ink != null ? '，笔画占比 ' + (s.ink * 100).toFixed(1) + '%' : '');
        }).join('\n'),
        '板书截图：' + (payload.board && payload.board.dataUrl ? '有' : '没有')
      ].join('\n');
    }

    var hasImages = !!((payload.images && payload.images.length) ||
      (payload.vision && payload.vision.length) ||
      (payload.poseShots && payload.poseShots.length) ||
      (payload.shotList && payload.shotList.length));

    /* 逐帧仪态：把几帧单独拎出来，让模型一帧一帧说「这一帧里身体和脸是什么样」，
       而不是笼统给一个「教态良好」的印象分。 */
    var poseShots = (Array.isArray(payload.poseShots) ? payload.poseShots : [])
      .filter(function (p) { return p && /^data:image\/(?:png|jpe?g|webp);/i.test(String(p.dataUrl || '')); })
      .slice(0, 4);
    /* 事件清单：截图/评分/AI 用的是同一份事件，引用时带事件号，避免模型自己另编时间 */
    var eventBlock = '';
    if (payload.events && payload.events.length) {
      eventBlock = [
        '',
        '【程序抓到的事件】（与报告里的截图、扣分是同一条记录，引用时请写事件号）',
        payload.events.slice(0, 20).map(function (e) {
          return '- ' + (e.id || '?') + '（' + (e.domain || '') + '，对应 ' + (e.rubricItemId || '?') + '）：' +
            util.fmtTime(Math.round(e.at || 0)) + ' ' + (e.reason || '') +
            (e.status === 'observed' ? '（观察项，不是错）' : '');
        }).join('\n')
      ].join('\n');
    }
    /* 截下来的每一张图都要单独说一句，先用清单把 id/时间/域 告诉模型 */
    var shotListBlock = '';
    var sl = (Array.isArray(payload.shotList) ? payload.shotList : []);
    if (sl.length) {
      shotListBlock = [
        '',
        '【需要逐张分析的图片】共 ' + sl.length + ' 张，每张都附在消息里：',
        sl.map(function (s, i) {
          return '- ' + (s.id || ('s' + i)) + '：第 ' + Math.round(s.at || 0) + ' 秒，' +
            (s.domain || '') + (s.reason ? '，程序判断：' + s.reason : '');
        }).join('\n'),
        '要求：images 必须正好返回 ' + sl.length + ' 条，一条不能少、也不要多；' +
          'id 必须原样抄上面清单里的值，顺序与清单一致。每条写 {id, at, observe, consistent}；' +
          'observe 只写这张图里看得见的动作或画面状态；consistent 写「与程序判断一致/不一致/看不清」；' +
          '看不清就写看不清，不许猜。'
      ].join('\n');
    }
    var poseBlock = '';
    if (poseShots.length) {
      poseBlock = [
        '',
        '【逐帧仪态】（下面是单独挑出来的 ' + poseShots.length + ' 帧，每帧都附了图）',
        poseShots.map(function (p, i) {
          return '- 仪态帧 ' + (i + 1) + '：frameId=' + (p.frameId || ('p' + i)) + '，录像第 ' +
            Math.round(p.at || 0) + ' 秒' + (p.hint ? '，程序判断：' + p.hint : '');
        }).join('\n')
      ].join('\n');
    }
    var imgCount = (sl.length || 0) +
      ((payload.vision && payload.vision.length) || 0) +
      ((payload.poseShots && payload.poseShots.length) || 0);
    var imgBlock = hasImages
      ? '\n【随消息附上的图片】' + imgCount + ' 张（板书截图、画面帧与逐帧仪态帧）。请真的看它们再评板书与教态；' +
        '如果这个模型读不到图像，请在 summary 里明确写「当前模型不支持图像，板书与教态这次没有复核」，不要假装看过。'
      : '\n【没有附图】这次没有把画面传给你，板书与教态的内容不要评价。';

    /* 视觉证据：把「程序看到了什么、门槛多少、哪里判断不了」如实交代。
       这一段存在的意义就是防止模型把「没测到」当「做得差」。 */
    var visualBlock = '';
    var vis = payload.visual;
    if (vis) {
      var cov = vis.coverage || {};
      var pose = vis.pose || {};
      var lines = ['', '【画面分析的事实】（本机姿态模型跑出来的，不是评分结论）'];
      if (cov.samples) {
        lines.push('- 抽了 ' + cov.samples + ' 帧，约每 ' + (cov.step || '?') + ' 秒一帧，覆盖 ' +
          util.fmtTime(Math.round(cov.from || 0)) + '–' + util.fmtTime(Math.round(cov.to || 0)) +
          '（时长的 ' + Math.round((cov.sampleCoverage || 0) * 100) + '%）');
      }
      lines.push('- 人体姿态：' + (pose.available
        ? '定位成功率 ' + Math.round((cov.poseRate || 0) * 100) + '%，模型 ' + ((pose.model && pose.model.model) || 'pose_landmarker_lite')
        : '没跑成（' + (pose.reason || '模型不可用') + '）→ 这些内容不能评价'));
      if (vis.board && vis.board.found) {
        var rd = vis.board.readability || {};
        lines.push('- 板书区域：已定位（' + (vis.board.polarity === 'dark' ? '深色板' : '浅色板') + '），拍摄质量' +
          (rd.ok ? '够看清' : '不够看清（' + (rd.reasons || []).map(function (r) { return r.text; }).join('；') + '）→ 只能说拍摄问题，不能说写得差'));
      } else {
        lines.push('- 板书区域：没定位到 → 板书内容不要评价');
      }
      var beh = vis.behaviors || [];
      var iss = beh.filter(function (b) { return b.kind === 'issue'; });
      var pos = beh.filter(function (b) { return b.kind === 'positive'; });
      if (iss.length) {
        lines.push('- 有连续证据的行为问题：');
        iss.forEach(function (b) {
          lines.push('  · ' + util.fmtTime(Math.round(b.from)) + '–' + util.fmtTime(Math.round(b.to)) +
            '（' + b.seconds + ' 秒）：' + b.title);
        });
      } else {
        lines.push('- 没有达到门槛的行为问题（门槛：背对连续 ≥8 秒、遮挡板面连续 ≥5 秒）。' +
          '没有达到门槛不等于做得好，也不要据此推断「全程都正常」。');
      }
      if (pos.length) {
        lines.push('- 被看到的正常行为：' + pos.map(function (b) {
          return util.fmtTime(Math.round(b.from)) + ' ' + b.title;
        }).join('；'));
      }
      lines.push('（这一段的数字可以用，但不要把它们改写成「站姿得分」「板书写得如何」这类结论）');
      visualBlock = lines.join('\n');
    }

    return [
      '你是一位高中数学教研员，任务是复核一份已经自动算过分的教师编面试试讲报告。你的价值在于纠错，不在于再压一遍分。',
      '规则：',
      '1. 只指出有证据的问题。说话类问题必须引用逐字稿里的原话（带上时间），画面类问题必须引用具体时间点的画面；没证据就不要写。',
      '2. 如果你认为本地规则判得不合理（比如把正常的留白算成卡顿、把学生思考时间算成教学失误、把站到边上写板书算成仪态差），请直接指出并说明理由，我们允许你推翻本地结论。',
      '3. 不要为了凑数生成问题，也不要因为「应该更严格」而加码。没有足够证据就少写几条。',
      '',
      '【课题】' + (payload.topic || '未填写'),
      '【时长】' + Math.round(payload.duration || 0) + ' 秒',
      '【形式】' + ({ micro: '模拟试讲', full: '完整课堂', clip: '教学片段' }[payload.lesson] || '模拟试讲'),
      '【自动评分】' + (payload.rated === false
        ? '未评级（证据不足），已测项的参考分 ' + payload.total
        : '总分 ' + payload.total + '，' + payload.grade.key + '（' + payload.grade.label + '）'),
      dimLines,
      metricBlock,
      shotBlock,
      poseBlock,
      shotListBlock,
      eventBlock,
      imgBlock,
      visualBlock,
      '',
      scriptBlock,
      '',
      '请只输出 JSON，不要任何解释性文字，格式：',
      '{"summary":"三句话以内的总评","strengths":["..."],' +
        '"issues":[{"level":"must|should|bonus","category":"content|fluency|pause|filler|board|speed|posture",' +
        '"at":192.5,"quote":"逐字稿原话，必须逐字匹配","advice":"具体怎么改","confidence":"high|medium|low"}],' +
        '"images":[{"id":"s1","at":12,"observe":"这张图里看得见的动作或画面状态","consistent":"与程序判断一致/不一致/看不清"}],' +
        '"vision":[{"frameId":"f7","at":363,"observe":"这一帧里真的看得见什么"}],' +
        '"frames":[{"frameId":"f3","at":120,"posture":"这一帧的身体状态","face":"这一帧的面部动作","note":"和数值指标是否一致"}],' +
        '"challenge":[{"target":"哪条本地规则/哪一个扣分","why":"为什么你认为不合理"}],' +
        '"adjust":[{"dimension":"维度名","delta":-5,"reason":"为什么"}]}',
      '要求：issues 3–8 条，quote 必须是上面逐字稿里真实存在的片段（不要改写、不要编）；' +
        'at 用秒数，和 quote 所在位置一致。challenge 只在你真的不同意本地规则时才写，可以为空数组。' +
        'adjust 里偏差不超过 3 分就不要列。',
      (payload.shotList && payload.shotList.length)
        ? 'images 必须正好 ' + payload.shotList.length + ' 条，id 与上面【需要逐张分析的图片】清单逐一对应；' +
          '宁可写「看不清」，也不能漏条或自己加条。'
        : '',
      (payload.vision && payload.vision.length)
        ? 'vision 必须对每一张附图各写一条：frameId 与 at 原样抄上面的标注，observe 只写这一帧里真的看得见的东西（板书文字、公式、遮挡、反光）。看不清就写「看不清」并说明原因，不许按题目猜板书内容。'
        : '',
      (payload.poseShots && payload.poseShots.length)
        ? 'frames 必须对每一张仪态帧各写一条，frameId 与 at 原样抄标注：' +
          'posture 只写这一帧里身体肉眼可见的状态（站姿、朝向、手在哪、有没有低头、离板远近），' +
          'face 只写面部可见动作（嘴角、眉毛、眼睛看哪、口型），' +
          'note 写它与上面的数值指标是否一致（例如「这一帧确实侧身，和『侧身 24 秒』吻合」）。' +
          '不许写紧张、自信、情绪、心理这类看不见的东西；看不清就写「看不清」并说明原因。'
        : ''
    ].filter(Boolean).join('\n');
  }

  function parseJSON(text) {
    if (!text) return null;
    var s = String(text).trim();
    // 去掉 ```json 包裹
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    var start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); }
    catch (e) { return null; }
  }

  var ai = App.ai = {

    /** 服务器是否配了统一 Key（启动时探测一次） */
    serverMode: false,
    serverModel: '',
    dailyPerIp: 0,
    _probing: null,

    /** 只有本地起服务时才有 /api/ai/* 后端；静态托管上不探测，避免 404 噪音 */
    hasServer: function () {
      var h = location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '';
    },

    probe: function (force) {
      if (ai._probing && !force) return ai._probing;
      if (typeof fetch !== 'function' || !ai.hasServer()) {
        ai._probing = Promise.resolve(false);
        return ai._probing;
      }
      ai._probing = fetch('api/ai/health', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          ai.serverMode = !!(j && j.ai);
          ai.serverModel = (j && j.model) || '';
          ai.dailyPerIp = (j && j.dailyPerIp) || 0;
          if (App.bus) App.bus.emit('ai-ready', ai.serverMode);
          return ai.serverMode;
        })
        .catch(function () {
          // 网络慢（隧道/手机热点）时第一次探测很容易超时，别把它当成「没有」
          ai.serverMode = false;
          ai._probing = null;
          return false;
        });
      return ai._probing;
    },

    enabled: function () {
      if (ai.serverMode) return true;
      var c = cfg();
      return !!(c.key && c.endpoint);
    },

    /**
     * 问这个 Key 到底能用哪些模型：GET /models。
     * 用来回答「DeepSeek 的额度能不能跑语音/看图」——它返回的列表就是答案。
     */
    listModels: function () {
      var c = cfg();
      if (!c.key) return Promise.reject(new Error('还没有填写 API Key'));
      var base = c.endpoint.replace(/\/chat\/completions\/?$/, '');
      var url = base + '/models';
      return fetch(url, {
        headers: { Authorization: 'Bearer ' + c.key },
        cache: 'no-store'
      }).then(function (res) {
        return res.text().then(function (t) {
          if (!res.ok) {
            var e = new Error(res.status === 401 ? 'Key 无效（401）' : ('查询失败 HTTP ' + res.status));
            e.detail = String(t || '').slice(0, 200);
            throw e;
          }
          var json = null;
          try { json = JSON.parse(t); } catch (e2) { throw new Error('返回的不是 JSON'); }
          var list = (json.data || json.models || []).map(function (m) {
            return String((m && (m.id || m.name)) || m);
          }).filter(Boolean);
          return { url: url, models: list };
        });
      });
    },

    /** 测试连通性与 Key 是否有效 */
    test: function () {      var c = cfg();
      if (ai.serverMode) {
        return ai._postServer([
          { role: 'system', content: '你是测试助手，只回复 OK。' },
          { role: 'user', content: 'ping' }
        ], 8).then(function (txt) { return { ok: true, sample: (txt || '').slice(0, 40) }; });
      }
      if (!c.key) return Promise.reject(new Error('还没有填写 API Key。'));
      return ai._post(c, [
        { role: 'system', content: '你是测试助手，只回复 OK。' },
        { role: 'user', content: 'ping' }
      ], 8).then(function (txt) {
        return { ok: true, sample: (txt || '').slice(0, 40) };
      });
    },

    /**
     * 深度点评
     * @returns {Promise<{summary,strengths,issues,adjust}>}
     */
    review: function (payload) {
      var c = cfg();
      var promptText = buildPrompt(payload);

      /* 图片要带身份：模型必须能说清「这是哪一帧、第几秒」，否则它的结论无法回溯。
         所以每张图前面插一条文字标注（frameId + 秒数 + 是板面还是画面）。 */
      /* 只发位图。SVG 这类矢量 data URL 有些中转直接拒收，
         而且返回的还是「模型不存在」这种误导性的错——干脆不发给它。 */
      var vision = (Array.isArray(payload.vision) ? payload.vision : [])
        .filter(function (v) { return v && /^data:image\/(?:png|jpe?g|webp);/i.test(String(v.dataUrl || '')); })
        .slice(0, 3);
      /* 把 shotList 的图也发出去（最多 12 张），保持与提示词清单一致 */
      var slFrames = (Array.isArray(payload.shotList) ? payload.shotList : [])
        .filter(function (s) { return s && /^data:image\/(?:png|jpe?g|webp);/i.test(String(s.dataUrl || '')); })
        .slice(0, 12);
      var poseFrames = (Array.isArray(payload.poseShots) ? payload.poseShots : [])
        .filter(function (p) { return p && /^data:image\/(?:png|jpe?g|webp);/i.test(String(p.dataUrl || '')); })
        .slice(0, 4);
      var imgs = slFrames.length ? slFrames.map(function (s) { return s.dataUrl; }) : vision.map(function (v) { return v.dataUrl; });
      if (!imgs.length) {
        imgs = poseFrames.map(function (p) { return p.dataUrl; });
      }
      if (!imgs.length) {
        imgs = (payload.images || []).filter(function (u) {
          return /^data:image\/(?:png|jpe?g|webp);/i.test(String(u || ''));
        }).slice(0, 3);
      }

      /* shotList、vision、poseShots 都要真的附在消息里：以前只在有 vision/pose 时
         拼局部部件，shotList 的图算进了 imgs 却没标注，模型根本对不上 id。 */
      var hasVisual = !!(slFrames.length || vision.length || poseFrames.length);
      var userContent = promptText;
      if (hasVisual) {
        var parts = [{ type: 'text', text: promptText }];
        var sentUrls = {};
        var imgNo = 0;
        var pushImage = function (label, url) {
          if (!url || sentUrls[url]) return;
          sentUrls[url] = 1;
          imgNo++;
          parts.push({ type: 'text', text: '图片 ' + imgNo + '：' + label });
          parts.push({ type: 'image_url', image_url: { url: url } });
        };
        slFrames.forEach(function (s) {
          pushImage('id=' + (s.id || '?') + '，录像第 ' + Math.round(s.at || 0) + ' 秒，' +
            (s.domain || '截图') + (s.reason ? '（程序判断：' + s.reason + '）' : ''), s.dataUrl);
        });
        vision.forEach(function (v) {
          pushImage('frameId=' + (v.frameId || '?') + '，录像第 ' + Math.round(v.at || 0) + ' 秒，' +
            (v.role === 'board' ? '板面裁剪图' : '画面帧'), v.dataUrl);
        });
        poseFrames.forEach(function (p) {
          pushImage('仪态帧 frameId=' + (p.frameId || '?') + '，录像第 ' + Math.round(p.at || 0) + ' 秒' +
            '（只评姿态与面部可见动作）', p.dataUrl);
        });
        userContent = parts;
      } else if (imgs.length) {
        var bare = [{ type: 'text', text: promptText }];
        imgs.forEach(function (u) { bare.push({ type: 'image_url', image_url: { url: u } }); });
        userContent = bare;
      }

      var messages = [
        { role: 'system', content: '你只输出合法 JSON，不输出其它任何内容。' },
        { role: 'user', content: userContent }
      ];
      var textOnly = [
        { role: 'system', content: '你只输出合法 JSON，不输出其它任何内容。' },
        { role: 'user', content: promptText + '\n\n（附注：这次没有图片，请忽略板书与教态。）' }
      ];

      function run(msgs) {
        var p;
        if (!ai.serverMode && !c.key && ai.probe) {
          // 开机时那次探测可能只是网络慢，真正点「复核」的时候再确认一次
          p = ai.probe(true).then(function (ok) {
            return ok ? ai._postServer(msgs, 2200) : Promise.reject(new Error(NO_KEY));
          });
        } else if (ai.serverMode) {
          // 统一额度：Key 在服务器上，浏览器只发逐字稿
          p = ai._postServer(msgs, 2200);
        } else {
          if (!c.key) return Promise.reject(new Error(NO_KEY));
          p = ai._post(c, msgs, 2200);
        }
        return p;
      }

      var p = run(messages);
      if (imgs.length) {
        /* 有的模型不吃图片：先带图试一次，被拒就退回纯文本，并如实说明 */
        p = p.catch(function (e) {
          var msg = String((e && e.message) || '') + ' ' + String((e && e.detail) || '');
          if (/HTTP (400|404|415|422)/.test(msg) || /image|content|vision|model_not_found|multimodal/i.test(msg)) {
            ai.visionLimited = true;
            return run(textOnly);
          }
          throw e;
        });
      }

      return p.then(function (txt) {
        var data = parseJSON(txt);
        if (!data) throw new Error('模型返回的不是合法 JSON，请换一个模型或稍后重试。');

        /* shotList 逐张回执：模型少写、写错 id 都要补齐成 N 条。
           缺的条目标 missing:true，报告里显示「这几张没拿到分析」，不静默丢掉。 */
        var shotReq = (Array.isArray(payload.shotList) ? payload.shotList : []);
        var gotImages = Array.isArray(data.images) ? data.images : [];
        var normImages;
        if (shotReq.length) {
          var byId = {}, byAt = {};
          gotImages.forEach(function (x) {
            if (!x) return;
            var id = x.id != null ? String(x.id).trim() : '';
            if (id) byId[id] = x;
            if (x.at != null && isFinite(x.at)) byAt[String(Math.round(Number(x.at)))] = x;
          });
          normImages = shotReq.map(function (s, i) {
            var id = s.id != null ? String(s.id) : ('s' + i);
            var hit = byId[id] ||
              ((s.at != null && isFinite(s.at)) ? byAt[String(Math.round(Number(s.at)))] : null);
            var observe = (hit && hit.observe) ? String(hit.observe) : '';
            var consistent = (hit && hit.consistent) ? String(hit.consistent) : '';
            return {
              id: id,
              at: (s.at != null ? Number(s.at) : (hit && hit.at != null ? Number(hit.at) : null)),
              observe: observe,
              consistent: consistent,
              missing: !(observe || consistent)
            };
          });
        } else {
          normImages = gotImages.filter(function (x) {
            return x && x.id && (x.observe || x.consistent);
          }).slice(0, 12);
        }

        /* 视觉观察必须能回溯到具体帧：没有 frameId / 时间码的「我看过了」一律不算数 */
        var vOut = Array.isArray(data.vision) ? data.vision.filter(function (v) {
          return v && (v.frameId || v.at != null) && v.observe;
        }).slice(0, 6) : [];
        var visionFailed = '';
        if (imgs.length && !vOut.length && !normImages.length && !ai.visionLimited) {
          visionFailed = '视觉模型返回里没有带 frameId / 时间码的观察，这次视觉复核不算完成';
        }

        /* 逐帧仪态：同样要求能回溯（有 frameId 或秒数），没说的帧不补 */
        var fOut = Array.isArray(data.frames) ? data.frames.filter(function (f) {
          return f && (f.frameId || f.at != null) && (f.posture || f.face);
        }).slice(0, 8) : [];

        /* 引用校验：模型写的问题原话必须真的在逐字稿里（去掉标点空白后包含）。
           对不上的不直接展示成结论，标出来并计数，报告里会说明「有 N 条引文对不上」。 */
        var flat = normFlat((payload && payload.transcript) || (payload && payload.subtitle) || '');
        var dropped = 0;
        var issues = Array.isArray(data.issues) ? data.issues.filter(function (it) {
          if (!it) return false;
          var q = normFlat(it.quote);
          if (!q) { it.quoteOk = false; dropped++; return true; }
          it.quoteOk = !flat || flat.indexOf(q) >= 0;
          if (!it.quoteOk) dropped++;
          return true;
        }).slice(0, 8) : [];

        return {
          summary: String(data.summary || ''),
          strengths: Array.isArray(data.strengths) ? data.strengths.slice(0, 6) : [],
          issues: issues,
          quoteMissed: dropped,
          images: normImages,
          vision: vOut,
          frames: fOut,
          visionFailed: visionFailed,
          challenge: Array.isArray(data.challenge) ? data.challenge.slice(0, 5) : [],
          adjust: Array.isArray(data.adjust) ? data.adjust.slice(0, 7) : [],
          visionLimited: !!ai.visionLimited,
          model: ai.serverMode ? ai.serverModel : c.model
        };
      });
    },

    _post: function (c, messages, maxTokens) {
      var controller = null;
      var timer = null;
      var signal;
      try {
        controller = new AbortController();
        signal = controller.signal;
      } catch (e) { signal = undefined; }

      var body = {
        model: c.model,
        messages: messages,
        temperature: 0.3,
        max_tokens: maxTokens || 6000,
        /* 有些中转站已经禁掉非流式请求（返回 400「请设置 stream: true」），
           统一用流式，再在下面把 SSE 拼回一整段文本 */
        stream: true
      };

      var fetchOpts = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.key
        },
        body: JSON.stringify(body)
      };
      if (signal) fetchOpts.signal = signal;

      /* 本机打开时走同源转发：中转站对浏览器直连时不时会掐连接（ERR_CONNECTION_CLOSED），
         由本机服务代发一次就稳定了；公开网址上没有这层，仍是直连。 */
      var url = c.endpoint;
      try {
        var h = location.hostname;
        if (h === '127.0.0.1' || h === 'localhost') {
          fetchOpts.headers['x-asr-endpoint'] = c.endpoint;
          url = '/api/asr-proxy';
        }
      } catch (e) { /* 忽略 */ }

      var p = fetch(url, fetchOpts).then(function (res) {        if (!res.ok) {
          return res.text().then(function (t) {
            var msg = 'HTTP ' + res.status;
            if (res.status === 401) msg = 'API Key 无效或已过期（401）';
            else if (res.status === 402 || res.status === 403) msg = 'Key 余额不足或无权限（' + res.status + '）';
            else if (res.status === 429) msg = '请求过于频繁，被限流（429）';
            else if (res.status >= 500) msg = '模型服务异常（' + res.status + '）';
            var err = new Error(msg);
            err.detail = String(t || '').slice(0, 300);
            throw err;
          });
        }
        var ct = '';
        try { ct = String(res.headers.get('content-type') || ''); } catch (e2) { ct = ''; }
        if (ct.indexOf('event-stream') >= 0) {
          /* 模型按 SSE 流式返回：把每个 data: 包里的增量拼回整段文字 */
          return res.text().then(function (raw) {
            var out = '';
            String(raw || '').split(/\r?\n/).forEach(function (line) {
              var s = String(line).trim();
              if (s.indexOf('data:') !== 0) return;
              var payload = s.slice(5).trim();
              if (!payload || payload === '[DONE]') return;
              try {
                var j = JSON.parse(payload);
                var ch = j && j.choices && j.choices[0];
                var d = ch && (ch.delta || ch.message);
                if (d && d.content) out += d.content;
                else if (d && d.reasoning_content) out += d.reasoning_content;
              } catch (e3) { /* 坏包跳过 */ }
            });
            return { choices: [{ message: { content: out } }] };
          });
        }
        return res.json();
      }).then(function (json) {
        var text = '';
        if (json && json.choices && json.choices[0]) {
          var m = json.choices[0].message;
          text = (m && (m.content || m.reasoning_content)) || '';
        }
        if (!text && json && json.output && json.output.text) text = json.output.text;
        return text;
      }).catch(function (e) {
        /* fetch 自己的 TypeError 只有一句 “Failed to fetch”，对用户没有信息量 */
        if (e && (e.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(e.message || ''))) {
          throw new Error('连不上接口（网络不可达，或接口地址写错、被跨域拦下）');
        }
        throw e;
      });

      /* 中转站偶尔会直接掐断连接（ECONNRESET / 502）。这种是瞬时的，
         自动再试一次，比让用户去点「重新复核」友好。 */
      p = p.catch(function (e) {
        var msg = String((e && e.message) || '') + ' ' + String((e && e.detail) || '');
        if (!/连不上|ECONNRESET|502|network/i.test(msg)) throw e;
        return new Promise(function (r) { setTimeout(r, 1200); }).then(function () {
          return fetch(url, fetchOpts);
        }).then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              var err = new Error('HTTP ' + res.status);
              err.detail = String(t || '').slice(0, 300);
              throw err;
            });
          }
          return res.json();
        }).then(function (json) {
          var m = json && json.choices && json.choices[0] && json.choices[0].message;
          return (m && (m.content || m.reasoning_content)) || '';
        });
      });

      return new Promise(function (resolve, reject) {
        var settled = false;
        timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          if (controller) { try { controller.abort(); } catch (e) {} }
          reject(new Error('请求超时（五分钟），请检查网络或换一个接口地址；带图的复核在慢接口上确实会久一点。'));
        }, TIMEOUT);

        p.then(function (v) {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(v);
        }).catch(function (e) {
          if (settled) return;
          settled = true; clearTimeout(timer);
          reject(e);
        });
      });
    },

    /** 走本站服务器转发：浏览器不接触 Key */
    _postServer: function (messages, maxTokens) {
      var c = cfg();
      var controller = null;
      var signal;
      try { controller = new AbortController(); signal = controller.signal; } catch (e) { signal = undefined; }

      var opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          max_tokens: maxTokens || 6000,
          temperature: 0.3,
          model: c.model || undefined
        })
      };
      if (signal) opts.signal = signal;

      var p = fetch('api/ai/review', opts).then(function (res) {
        var ct = '';
        try { ct = String(res.headers.get('content-type') || ''); } catch (e) { ct = ''; }

        /* Edge Function 会把上游的 SSE 原样转回来。
           这里先把 data: 包里的增量拼成整段文字，后面 review() 仍按 JSON 解析。 */
        if (ct.indexOf('event-stream') >= 0) {
          return res.text().then(function (raw) {
            if (!res.ok) {
              var err = new Error('HTTP ' + res.status);
              err.detail = String(raw || '').slice(0, 300);
              err.status = res.status;
              throw err;
            }
            var out = '';
            String(raw || '').split(/\r?\n/).forEach(function (line) {
              var s = String(line).trim();
              if (s.indexOf('data:') !== 0) return;
              var payload = s.slice(5).trim();
              if (!payload || payload === '[DONE]') return;
              try {
                var j = JSON.parse(payload);
                var ch = j && j.choices && j.choices[0];
                var d = ch && (ch.delta || ch.message);
                if (d && d.content) out += d.content;
                else if (d && d.reasoning_content) out += d.reasoning_content;
              } catch (e3) { /* 坏包跳过 */ }
            });
            return out;
          });
        }

        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok && j && j.ok) return String(j.text || '');
          var msg = (j && j.error) || ('HTTP ' + res.status);
          if (res.status === 429) msg = msg || '今天的次数用完了';
          if (res.status === 503) msg = msg || '这台服务器还没有配置模型 Key';
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        });
      });

      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          if (controller) { try { controller.abort(); } catch (e) {} }
          reject(new Error('请求超时（五分钟）'));
        }, TIMEOUT);
        p.then(function (v) { if (settled) return; settled = true; clearTimeout(timer); resolve(v); })
         .catch(function (e) { if (settled) return; settled = true; clearTimeout(timer); reject(e); });
      });
    }
  };

})(window);