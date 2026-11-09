/* 评分细则 v2（练习口径）：A 语音与表达 40 / B 仪态与表情 30 / C 板书 30 / D 红线扣分。
   这不是考编官方评分标准，是给自己练手用的参考框架，权重和等级线都可以调。

   四条硬规则：
   1) 测不出来的项 score = null，不进分子、不进分母、不排最弱项，绝不按比例补分；
   2) 扣分制项目从满分往下扣，最低 0 分，不倒扣别的项；
   3) 分数必须能追到实测值和区间；
   4) 没测到 ≠ 表现差：总分按「已测项」折算成百分制，并同时显示覆盖率。
*/
(function (window) {
  var App = window.App = window.App || {};

  /* 练习口径：这是给自己练手用的参考标准，不是考编官方评分。
     等级线按练习者的常见水平定，不按考试淘汰率定。 */
  var GRADE = function (s) {
    if (s >= 88) return '优秀';
    if (s >= 78) return '良好';
    if (s >= 68) return '合格';
    if (s >= 58) return '待提高';
    return '不合格';
  };

  function r1(v) { return Math.round(v * 10) / 10; }
  function num(v) { return typeof v === 'number' && isFinite(v); }

  /* 档位表：bands = [[上界, 分数], ...]，最后一档用 Infinity */
  function band(value, bands) {
    if (!num(value)) return null;
    for (var i = 0; i < bands.length; i++) {
      if (value <= bands[i][0]) return { score: bands[i][1], bucket: bands[i][2] };
    }
    return null;
  }

  /* 中间区间才得分的档位（两端都扣） */
  function bandMid(value, bands) {
    if (!num(value)) return null;
    for (var i = 0; i < bands.length; i++) {
      if (value >= bands[i][0] && value < bands[i][1]) return { score: bands[i][2], bucket: bands[i][3] };
    }
    return null;
  }

  /* A1 语速 */
  function a1(speech) {
    var max = 8;
    var cpm = speech && speech.speed ? speech.speed.cpm : null;
    var hit = band(lowHigh(cpm), null) || directSpeed(cpm);
    if (!cpm) return miss('A1', '语速', max, '没有逐字稿，算不出语速');
    var extra = 0;
    var cv = 0;
    if (speech.curve && speech.curve.length >= 2) {
      var vals = speech.curve.map(function (p) { return p.cpm; });
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / vals.length);
      cv = sd;
      if (sd > 60) extra = -1;
    }
    var score = Math.max(0, hit.score + extra);
    return {
      id: 'A1', name: '语速', max: max, score: r1(score),
      measured: r1(cpm), unit: '字/分', bucket: hit.bucket,
      note: '有效语音 ' + Math.round(speech.speechSeconds) + ' 秒、' + speech.chars + ' 字' +
        (extra ? '；30 秒窗口标准差 ' + Math.round(cv) + ' 字/分（>60），再扣 1 分' : '')
    };
  }
  function directSpeed(cpm) {
    if (!num(cpm)) return null;
    /* 讲课时快慢本来是手段：讲概念可以慢，做题可以快。
       这里只把「明显过快/过慢」当成扣分区间，中间一大段都算正常。 */
    if (cpm >= 170 && cpm <= 280) return { score: 8, bucket: '170–280（正常）' };
    if ((cpm >= 150 && cpm < 170) || (cpm > 280 && cpm <= 300)) return { score: 6.4, bucket: '150–170 / 280–300' };
    if ((cpm >= 125 && cpm < 150) || (cpm > 300 && cpm <= 330)) return { score: 4.6, bucket: '125–150 / 300–330' };
    return { score: 2.6, bucket: cpm < 125 ? '<125（偏慢）' : '>330（偏快）' };
  }
  function lowHigh() { return null; }

  /* A2 句内停顿 */
  function a2(speech) {
    var max = 10;
    if (!speech || !num(speech.sentences) || speech.sentences < 1) return miss('A2', '句内停顿', max, '没有逐字稿，切不出句子，这一项不评');
    if (!speech.pauses || !num(speech.pauses.rate)) return miss('A2', '句内停顿', max, '没有句内停顿的测量结果，这一项不评');
    var rate = speech.pauses.rate * 100;
    /* 说话有停顿是常态：讲完一句等学生反应、写完板书回头讲，都会停。
       只有「句子里半截停住、句子被切断」才算问题，所以门槛放得比较宽。 */
    var hit = band(rate, [
      [25, 10, '≤25%'], [35, 8.6, '25–35%'], [45, 6.6, '35–45%'], [55, 4.6, '45–55%'], [Infinity, 2.8, '>55%']
    ]);
    var severe = (speech.pauses.severe || []).length;
    var sub = Math.min(2.5, severe * 0.3);
    return {
      id: 'A2', name: '句内停顿与卡顿', max: max, score: r1(Math.max(0, hit.score - sub)),
      measured: r1(rate), unit: '% 句含停顿', bucket: hit.bucket,
      note: '共 ' + speech.sentences + ' 句' + (severe ? '；超 1 秒的严重卡顿 ' + severe + ' 次，扣 ' + r1(sub) + ' 分' : '；没有超 1 秒的卡顿') +
        '。句与句之间的停顿是正常换气，不计入'
    };
  }

  /* A3 填充词 */
  function a3(speech) {
    var max = 6;
    if (!speech || !num(speech.chars) || speech.chars < 50) return miss('A3', '填充词', max, '逐字稿太短（不到 50 字），数不出填充词密度，这一项不评');
    if (!speech.filler || !num(speech.filler.per100)) return miss('A3', '填充词', max, '没有填充词统计结果，这一项不评');
    var f = speech.filler;
    var hit = band(f.per100, [
      [2.5, 6, '≤2.5/百字'], [4, 5, '2.5–4'], [6, 3.8, '4–6'], [9, 2.4, '6–9'], [Infinity, 1.2, '>9']
    ]);
    var extra = 0;
    var top = f.top && f.top[0];
    if (top && f.total >= 8 && top.n / f.total >= 0.7) extra = -0.6;
    return {
      id: 'A3', name: '填充词', max: max, score: r1(Math.max(0, hit.score + extra)),
      measured: f.per100, unit: '次/百字', bucket: hit.bucket,
      note: '共 ' + f.total + ' 次' + (top ? '，最多的是「' + top.word + '」' + top.n + ' 次' : '') +
        (extra ? '（单类占 60% 以上，固定句式病，再扣 1 分）' : '')
    };
  }

  /* A4 清晰度、音量与语调（扣分制，8 分起） */
  function a4(audio) {
    var max = 8, ded = 0, notes = [];
    if (!audio || audio.noAudio) return miss('A4', '音量与语调', max, '这段素材没有音轨');
    if (!num(audio.volumeCV) && !num(audio.rmsMean)) return miss('A4', '音量与语调', max, '没有音量测量值（可能没解码到音轨），这一项不评');
    var cv = audio.volumeCV;
    if (num(cv) && cv > 0.55) { ded += 1; notes.push('音量波动系数 ' + r1(cv) + '（>0.55），扣 1'); }
    else if (num(cv)) notes.push('音量波动系数 ' + r1(cv) + '（正常范围）');
    if (num(audio.rmsMean) && audio.rmsMean < 0.008) { ded += 2; notes.push('平均音量偏低，扣 2'); }
    notes.push('语调（F0）、吐字清晰度、尾音这几项当前测不出来，不计分也不扣分');
    return {
      id: 'A4', name: '音量与语调', max: max, score: r1(Math.max(0, max - ded)),
      measured: num(cv) ? r1(cv) : null, unit: '音量波动系数', bucket: ded ? '扣 ' + r1(ded) + ' 分' : '不扣分',
      note: notes.join('；'), partial: true
    };
  }

  /* A5 表达组织（扣分制，8 分起） */
  function a5(speech, minutes) {
    var max = 8, ded = 0, notes = [];
    if (!speech || !speech.text) return miss('A5', '表达组织', max, '没有逐字稿，判断不了句子组织');
    var text = speech.text;
    var sents = String(text).split(/[。！？；\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var seen = {}, dup = 0;
    sents.forEach(function (s) {
      if (s.length < 8) return;
      var k = s.replace(/\s/g, '');
      if (seen[k]) dup++; else seen[k] = 1;
    });
    var dupPairs = Math.floor(dup / 2);
    if (dupPairs >= 2) { ded += Math.min(2, dupPairs * 0.6); notes.push('整句重复 ' + dup + ' 处，扣 ' + r1(Math.min(2, dupPairs * 0.6)) + ' 分'); }
    var selfFix = (text.match(/写错了|不对不对|说错了|说错|纠正一下/g) || []).length;
    if (selfFix) { ded += Math.min(2, selfFix * 0.8); notes.push('自我否定语 ' + selfFix + ' 处，扣 ' + r1(Math.min(2, selfFix * 0.8)) + ' 分'); }
    var conn = (text.match(/然后|那|就是|所以|因为|接着|首先/g) || []);
    var small = (text.match(/然后|那|就是/g) || []).length;
    if (conn.length >= 8 && small / conn.length >= 0.7) { ded += 1.5; notes.push('连接词单一（"然后/那/就是"占 ' + Math.round(small / conn.length * 100) + '%），扣 1.5'); }
    var ask = (text.match(/是不是|对不对|好不好/g) || []).length;
    if (minutes > 0 && ask / Math.max(1, minutes / 3) > 5) { ded += 1.5; notes.push('自问自答式反问平均每 3 分钟 ' + r1(ask / Math.max(1, minutes / 3)) + ' 次，扣 1.5'); }
    if (!ded) notes.push('没有整句重复、没有自我否定语、连接词不单一');
    return {
      id: 'A5', name: '表达组织', max: max, score: r1(Math.max(0, max - ded)),
      measured: ded, unit: '扣分', bucket: ded ? '扣 ' + r1(ded) + ' 分' : '不扣分',
      note: notes.join('；')
    };
  }

  /* B2 姿态（扣分制，10 分起） */
  function b2(posture) {
    var max = 10;
    if (!posture || !posture.available) return miss('B2', '姿态稳定', max, '画面里没有可用的人体关键点');
    var by = kv(posture.metrics);
    var ded = 0, notes = [];
    /* 站得稳不稳看趋势：讲课本来就会侧身写板书、走动、低头看讲稿。
       这里只扣「明显松垮/晃动」和「长时间不动地弓着」。 */
    if (num(by.stance) && by.stance > 14) { ded += 1.5; notes.push('肩线倾斜 ' + by.stance + '°（>14°），扣 1.5'); }
    if (num(by.drift) && by.drift > 28) { ded += 2; notes.push('重心漂移 ' + by.drift + '%（>28%），扣 2'); }
    else if (num(by.drift) && by.drift >= 20) { ded += 1; notes.push('重心漂移 ' + by.drift + '%（20–28%），扣 1'); }
    var downMax = maxRun(posture.downRuns);
    if (downMax > 40) { ded += 2; notes.push('低头单次 ' + Math.round(downMax) + ' 秒（>40 秒），扣 2'); }
    else if (downMax >= 25) { ded += 1; notes.push('低头单次 ' + Math.round(downMax) + ' 秒（25–40 秒），扣 1'); }
    notes.push('摸头发、倚讲台、持续晃动这几项当前测不出来，不计分也不扣分');
    return {
      id: 'B2', name: '姿态稳定', max: max, score: r1(Math.max(0, max - ded)),
      measured: ded, unit: '扣分', bucket: ded ? '扣 ' + r1(ded) + ' 分' : '不扣分',
      note: notes.join('；'), partial: true
    };
  }

  /* B3 手势（10 分）：幅度 5 分 + 「与讲解同步」5 分。
     同步要逐句语义对齐，当前测不出来 → 这 5 分不进分母，不补分。 */
  function b3(posture) {
    if (!posture || !posture.available) return miss('B3', '手势', 10, '画面里没有可用的人体关键点');
    var by = kv(posture.metrics);
    var g = by.gesture;
    if (!num(g)) return miss('B3', '手势', 10, '采样间隔太大，手部位移算不出来（精细模式才评）');
    var amp;
    if (g >= 2 && g <= 35) amp = { score: 5, bucket: '幅度适中（2–35 画面宽/秒）' };
    else if ((g >= 0.8 && g < 2) || (g > 35 && g <= 55)) amp = { score: 4, bucket: '幅度偏小/偏大' };
    else amp = { score: 2.8, bucket: g < 0.8 ? '几乎没有手势' : '幅度过大' };
    return {
      /* 这一项满分 10：幅度 5 分可测，「与讲解同步」5 分测不出，只把可测的 5 分计入分母 */
      id: 'B3', name: '手势', max: 10, measurableMax: 5, score: r1(amp.score),
      measured: g, unit: '画面宽/秒', bucket: amp.bucket,
      note: '幅度得 ' + r1(amp.score) + '/5；「手势与讲解是否同步」要逐句对齐语义，当前测不出来，这 5 分不计入',
      partial: true
    };
  }

  /* B4 表情与眼神（10 分） */
  function b4(face) {
    var max = 10;
    if (!face || !face.available) return miss('B4', '表情与眼神', max, '画面里没有检到人脸');
    var by = kv(face.metrics);
    /* 这一项只评「能不能看见、表情有没有变化」这类客观事实。
       微笑多少、看镜头多少、皱不皱眉、抿不抿嘴，都不再换算成扣分——
       这些和教学效果的因果关系没有依据，硬扣分就是编理由。 */
    var smile = by.smile, gaze = by.gazeCamera, still = maxRun(face.longRuns);
    var faceRate = num(face.faceRate) ? face.faceRate : null;
    var score, bucket;
    if (faceRate == null) { score = 6; bucket = '有脸帧比例测不出，按中间值'; }
    else if (faceRate >= 60) { score = 10; bucket = '一半以上的帧能看清脸'; }
    else if (faceRate >= 35) { score = 7.5; bucket = '部分帧能看清脸'; }
    else { score = 5; bucket = '大部分时间看不清脸（背对/出画/太远）'; }
    var notes = [];
    notes.push('表情变化：' + (still <= 3 ? '一直在变' : '最长 ' + Math.round(still) + ' 秒没有变化'));
    if (num(smile)) notes.push('微笑帧 ' + smile + '%（仅记录，不扣分）');
    if (num(gaze)) notes.push('看向镜头 ' + gaze + '%（仅记录，不扣分；镜头不等于学生）');
    if (num(by.brow)) notes.push('皱眉帧 ' + by.brow + '%（仅记录）');
    if (num(by.press)) notes.push('抿嘴帧 ' + by.press + '%（仅记录）');
    return {
      id: 'B4', name: '表情与眼神', max: max, score: r1(score),
      measured: faceRate, unit: '% 有脸帧', bucket: bucket,
      note: notes.join('；')
    };
  }

  /* C1 书写规范（10 分）：四项各自可测才计分，测不出的那项不补分、不进分母 */
  function c1(board) {
    var max = 10;
    var bd = boardData(board);
    if (!bd) return miss('C1', '书写规范', max, '这次没有板书分析结果');
    if (!bd.available) return miss('C1', '书写规范', max, '没有定位到可读的板面');

    var parts = [], got = 0, gotMax = 0;

    var straight = bd.by.straight;
    if (num(straight)) {
      var sHit = band(straight, [[32, 3, '≤32% 字高'], [45, 2.5, '32–45%'], [60, 1.9, '45–60%'], [80, 1.3, '60–80%'], [Infinity, 0.8, '>80%']]);
      got += sHit.score; gotMax += 3; parts.push('行平直度 ' + straight + '%→' + sHit.score + '/3');
    } else parts.push('行平直度测不出（字块太小或没定位到行，不补分）');

    var pitchCv = bd.rows && bd.rows.pitchCv;
    if (num(pitchCv)) {
      var pHit = band(pitchCv, [[0.22, 2.5, '≤0.22'], [0.32, 2, '0.22–0.32'], [0.45, 1.5, '0.32–0.45'], [0.6, 1, '0.45–0.60'], [Infinity, 0.6, '>0.60']]);
      got += pHit.score; gotMax += 2.5; parts.push('行距变异 ' + pitchCv + '→' + pHit.score + '/2.5');
    } else parts.push('行距变异测不出（不补分）');

    var gapCv = bd.chars && bd.chars.gapCv;
    if (num(gapCv)) {
      var gHit = band(gapCv, [[0.22, 2.5, '≤0.22'], [0.32, 2, '0.22–0.32'], [0.45, 1.5, '0.32–0.45'], [0.6, 1, '0.45–0.60'], [Infinity, 0.6, '>0.60']]);
      got += gHit.score; gotMax += 2.5; parts.push('字距变异 ' + gapCv + '→' + gHit.score + '/2.5');
    } else parts.push('字距变异测不出（不补分）');

    var sizeCv = bd.chars && bd.chars.sizeCv;
    if (num(sizeCv)) {
      var zHit = band(sizeCv, [[0.25, 2, '≤0.25'], [0.4, 1.6, '0.25–0.40'], [0.55, 1.2, '0.40–0.55'], [Infinity, 0.8, '>0.55']]);
      got += zHit.score; gotMax += 2; parts.push('字号变异 ' + sizeCv + '→' + zHit.score + '/2');
    } else parts.push('字号变异测不出（不补分）');

    if (!gotMax) return miss('C1', '书写规范', max, '四项书写规范指标都测不出来：' + parts.join('；'));
    return {
      id: 'C1', name: '书写规范', max: 10, measurableMax: gotMax, score: r1(got),
      measured: num(straight) ? straight : null, unit: num(straight) ? '% 字高' : '—',
      bucket: '按可测项计分', note: parts.join('；'), partial: gotMax < 10
    };
  }

  /* C2 版面布局（8 分）：利用率、分块、残留，各自可测才计 */
  function c2(board) {
    var max = 8;
    var bd = boardData(board);
    if (!bd) return miss('C2', '版面布局', max, '这次没有板书分析结果');
    if (!bd.available) return miss('C2', '版面布局', max, '没有定位到可读的板面');

    var parts = [], got = 0, gotMax = 0;
    var util = bd.by.utility;
    var uHit = num(util) ? bandMid(util, [
      [20, 80, 3, '20–80%（正常）'], [12, 20, 2.4, '12–20%'], [80, 90, 2.4, '80–90%'],
      [-1, 12, 1.8, '<12%（偏低）'], [90, Infinity, 1.6, '>90%（太满）']
    ]) : null;
    if (uHit) { got += uHit.score; gotMax += 3; parts.push('利用率 ' + util + '%→' + uHit.score + '/3'); }
    else parts.push('利用率测不出（不补分）');

    var blocks = bd.blocks ? bd.blocks.length : null;
    if (blocks != null) {
      var bs = (blocks >= 2 && blocks <= 5) ? 3 : (blocks === 1 ? 2.2 : 1.2);
      got += bs; gotMax += 3; parts.push(blocks + ' 块→' + bs + '/3');
    } else parts.push('分块测不出（不补分）');

    var residue = bd.by.residue;
    var rHit = num(residue) ? band(residue, [[15, 2, '≤15%'], [30, 1.6, '15–30%'], [50, 1.2, '30–50%'], [Infinity, 0.8, '>50%']]) : null;
    if (rHit) { got += rHit.score; gotMax += 2; parts.push('残留 ' + residue + '%→' + rHit.score + '/2'); }
    else parts.push('擦除残留测不出（不补分）');

    if (!gotMax) return miss('C2', '版面布局', max, '版面三项都测不出来：' + parts.join('；'));
    return {
      id: 'C2', name: '版面布局', max: 8, measurableMax: gotMax, score: r1(got),
      measured: num(util) ? util : null, unit: num(util) ? '% 板面利用率' : '—',
      bucket: '按可测项计分', note: parts.join('；'), partial: gotMax < 8
    };
  }

  /* C3 书写时机（6 分）：要板书区 1 秒 1 帧连续抽帧才看得出「边写边讲」。
     现在做不到，就留空——不补分，也不进分母。 */
  function c3() {
    return miss('C3', '书写时机与遮挡', 6, '要判断「边写边讲」得对板书区做 1 秒 1 帧的连续抽帧，当前采样间隔太大，这项没有数据');
  }

  /* C4 内容完整性（6 分）：要有学科检查清单才能逐条核对，现在留空 */
  /* C4 板书内容完整性（6 分）：只和 boardcheck 的结果挂钩。
     待核验（认到符号但顺序不对）的项既不算写了、也不算没写，从分母里拿掉。 */
  function c4(bc) {
    var max = 6;
    if (!bc) return miss('C4', '板书内容完整性', max, '这次没有做板书内容核对（要在准备页填「本课必写要点」才评）');
    if (!bc.available) return miss('C4', '板书内容完整性', max, bc.reason || '板书内容核对没有可用结果');
    var c = bc.counts || {};
    var scored = c.scored || 0, verify = c.verify || 0;
    var usable = scored - verify;
    if (!scored) return miss('C4', '板书内容完整性', max, '要点都太短，没法可靠匹配，这一项不评');
    if (usable <= 0) {
      return miss('C4', '板书内容完整性', max, '要点里的符号认到了，但顺序对不上，判不了对不对，这一项不评');
    }
    var measurable = max * usable / scored;
    var hit = c.hit || 0, part = c.partial || 0;
    var earned = measurable * (hit + part * 0.5) / usable;
    return {
      id: 'C4', name: '板书内容完整性',
      max: max, nominalMax: max, measurableMax: r1(measurable),
      score: r1(Math.max(0, Math.min(measurable, earned))),
      measured: hit + part, unit: '项命中',
      bucket: hit + ' 项写了、' + part + ' 项写一半' + (verify ? '、' + verify + ' 项待核验' : ''),
      note: '按你填的 ' + (c.total || scored) + ' 条要点逐条核对：' +
        hit + ' 条写了、' + part + ' 条写一半、' + (c.miss || 0) + ' 条没找到' +
        (verify ? '、' + verify + ' 条待核验（字认到了但顺序/关系对不上）' : '') +
        '；没找到不等于没写，可能是没认出来'
    };
  }

  /* D 红线：把理论错误条目折算成扣分与封顶 */
  function dRedline(theory) {
    var errors = [];
    var ded = 0;
    (theory && theory.items ? theory.items : []).forEach(function (it) {
      if (!it || it.pending) return;
      var level = '术语错误';
      var cut = 3;
      /* 环节缺失（没讲小结/例题/提问）不是知识性错误；没有原句的也不能当红线 */
      if (it.layer === 'structure' || it.type === 'structure' || !it.quote) return;
      if (it.type === 'concept') { level = '概念/定义错误'; cut = 6; }
      else if (it.type === 'reason') { level = '推理/逻辑错误'; cut = 5; }
      else if (it.type === 'slip') { level = '口误并当场纠正'; cut = 0.5; }
      errors.push({ level: level, quote: it.quote || '', at: it.at, correct: it.correct || '', confidence: it.confidence, cut: cut });
      ded += cut;
    });
    var slipTotal = errors.filter(function (e) { return e.cut === 0.5; }).length * 0.5;
    if (slipTotal > 2) { ded -= (slipTotal - 2); }
    ded = Math.min(25, r1(ded));

    var nConcept = errors.filter(function (e) { return e.level === '概念/定义错误'; }).length;
    var nReason = errors.filter(function (e) { return e.level === '推理/逻辑错误'; }).length;
    var caps = [];
    if (nConcept >= 2) caps.push({ cap: 70, why: '出现 2 处及以上概念/定义错误' });
    else if (nConcept === 1) caps.push({ cap: 78, why: '出现 1 处概念/定义错误' });
    if (nReason >= 1) caps.push({ cap: 82, why: '出现推理/逻辑错误' });
    if (ded >= 15) caps.push({ cap: 75, why: '红线扣分累计达 15 分' });
    caps.sort(function (a, b) { return a.cap - b.cap; });
    return { deduction: ded, errors: errors, cap: caps.length ? caps[0] : null, caps: caps };
  }

  function kv(metrics) {
    var out = {};
    (metrics || []).forEach(function (m) { out[m.key] = m.value; });
    return out;
  }
  function maxRun(list) {
    var arr = (list || []).filter(function (r) { return r && num(r.dur); });
    if (!arr.length) return 0;
    return arr.reduce(function (a, b) { return Math.max(a, b.dur); }, 0);
  }
  /* 测不出来就留空，绝不补分：没证据的项目不能变成分数，
     也不参与分子、分母、最弱项和扣分排名。 */
  function miss(id, name, max, why) {
    return {
      id: id, name: name, max: max, nominalMax: max, measurableMax: 0,
      score: null, earned: null, status: 'none',
      measured: null, unit: '—', bucket: '无法测量',
      note: why, unmeasured: true
    };
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  /* 三个数分清楚，不要混：
     nominalMax    标准里这一项固定多少分（永远不变，缺测也不改）
     measurableMax 这一次真正能评的分（缺测部分不算）
     earned        这一次实际得到的分（null = 没测） */
  function normalize(d) {
    if (d.nominalMax == null) d.nominalMax = d.max;
    if (d.measurableMax == null) d.measurableMax = isNum(d.score) ? d.nominalMax : 0;
    d.measurableMax = Math.min(d.measurableMax, d.nominalMax);
    if (d.earned == null && isNum(d.score)) d.earned = d.score;
    if (!d.status) d.status = !isNum(d.score) ? 'none' : (d.measurableMax >= d.nominalMax ? 'full' : 'partial');
    return d;
  }
  function agg(items) {
    items.forEach(normalize);
    var got = items.filter(function (d) { return isNum(d.score); });
    var earned = got.length ? r1(got.reduce(function (a, b) { return a + b.score; }, 0)) : null;
    var measurable = r1(got.reduce(function (a, b) { return a + b.measurableMax; }, 0));
    var nominal = r1(items.reduce(function (a, b) { return a + b.nominalMax; }, 0));
    return {
      items: items,
      earned: earned,
      score: earned,              /* 兼容旧字段 */
      measurableMax: measurable,
      nominalMax: nominal,
      max: measurable,            /* 兼容旧字段：本次可评分值 */
      maxTotal: nominal,          /* 兼容旧字段：标准总分 */
      measured: got.length,
      status: !got.length ? 'none' : (measurable >= nominal ? 'full' : 'partial')
    };
  }

  /* 板书数据口径：调用方可能传整个板书分析对象、crop.metrics、或直接传指标数组。
     这里统一成 { by, rows, chars, blocks, available }，别再用 `board.metrics || board` 猜。 */
  function boardData(board) {
    if (!board) return null;
    if (Object.prototype.toString.call(board) === '[object Array]') {
      return { by: kv(board), rows: null, chars: null, blocks: null, available: true, source: 'metrics-array' };
    }
    var obj = (board.crop && board.crop.metrics) ? board.crop.metrics : board;
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      return { by: kv(obj), rows: null, chars: null, blocks: null, available: true, source: 'metrics-array' };
    }
    var arr = Object.prototype.toString.call(obj.metrics) === '[object Array]' ? obj.metrics : [];
    return {
      by: kv(arr), rows: obj.rows || null, chars: obj.chars || null,
      blocks: obj.blocks || null, available: obj.available !== false,
      source: arr.length ? 'analysis' : 'object'
    };
  }

  function compute(input) {
    input = input || {};
    var speech = input.speech || null;
    var minutes = (input.duration || 0) / 60;
    var A = agg([a1(speech), a2(speech), a3(speech), a4(input.audio), a5(speech, minutes)]);
    var B = agg([b2(input.posture), b3(input.posture), b4(input.face)]);
    var C = agg([c1(input.board), c2(input.board), c3(input.board), c4(input.boardCheck)]);
    var D = dRedline(input.theory);

    var parts = [A, B, C].filter(function (x) { return x.earned != null; });
    var base = parts.length ? r1(parts.reduce(function (a, b) { return a + b.earned; }, 0)) : null;
    /* 两个分母分开：可评分值用于「参考分」，标准总分用于「覆盖率」 */
    var measuredMax = parts.reduce(function (a, b) { return a + b.measurableMax; }, 0);
    var totalMax = A.nominalMax + B.nominalMax + C.nominalMax;
    var coverage = totalMax ? Math.round(measuredMax / totalMax * 1000) / 10 : 0;

    /* 给等级要三个条件：覆盖率够、语音维度有证据、板书维度有证据。
       只有画面几何 + 声音，不能宣称已经完整评估了教学。 */
    var keyOk = A.measurableMax > 0 && C.measurableMax > 0 && B.measurableMax > 0;
    var graded = base != null && coverage >= 80 && keyOk;
    var capped = null, grade = null, pct = null, cap = D.cap;
    if (base != null && measuredMax > 0) {
      var raw = Math.max(0, base - D.deduction);
      /* 参考分 = 已测得分 ÷ 已测可评分值 × 100（分母不随缺测变化地“缩水”到评分里） */
      pct = r1(raw / measuredMax * 100);
      /* 红线封顶是百分制封顶，直接压在参考分上 */
      if (cap && num(cap.cap)) pct = Math.min(pct, cap.cap);
      capped = r1(pct / 100 * measuredMax);
      grade = graded && pct != null ? GRADE(pct) : null;
    }

    var all = A.items.concat(B.items, C.items);
    /* 只报「真的偏弱」的三项，而且比的是「已测部分」的表现：
       手势那样 10 分里只测了 5 分、5 分全拿到的，不该被当成 50% 拖进来 */
    var worst = all.filter(function (d) {
      return isNum(d.score) && d.measurableMax > 0 && d.score / d.measurableMax < 0.85;
    }).slice().sort(function (x, y) {
      return (x.score / x.measurableMax) - (y.score / y.measurableMax);
    }).slice(0, 3).map(function (d) {
      return { id: d.id, name: d.name, score: d.score, max: d.measurableMax, nominalMax: d.nominalMax, status: d.status };
    });

    return {
      A: A, B: B, C: C, D: D,
      total: {
        base: base, deduction: base == null ? 0 : D.deduction, raw: base, capped: capped,
        pct: pct,
        measuredMax: measuredMax, totalMax: totalMax, coverage: coverage,
        graded: graded, grade: grade,
        reference: base != null && !graded
      },
      worstThree: worst,
      unmeasured: all.filter(function (d) { return !isNum(d.score); }).map(function (d) { return d.id + ' ' + d.name; }),
      partial: all.filter(function (d) { return isNum(d.score) && d.partial; }).map(function (d) { return d.id + ' ' + d.name; })
    };
  }

  App.Rubric2 = { compute: compute, GRADE: GRADE, band: band, bandMid: bandMid };
})(window);
