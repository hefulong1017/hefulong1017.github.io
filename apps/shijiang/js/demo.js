/* ======================================================================
   示例报告 —— 不再手写分数，而是把一段合成课堂喂给 App.Scoring.evaluate()
   真跑一遍。这样首页预览、报告页、时间轴、改进建议全部来自同一份数据，
   每一条扣分都能从起始分推出来，不会出现「74 分却只写了 16 分扣分」。
   ====================================================================== */
(function (window) {
  var App = window.App;
  var util = App.util;
  var T = App.text;

  /* ---------------- 合成课堂逐字稿（约 1850 字，故意缺「课堂小结」） ----------------
     五环节里只讲了：导入 / 新知探究 / 例题 / 作业，小结没讲，
     评分时内容项的「缺环节 −6」会真的扣、并且建议里会点名「课堂小结」。
     例题里的分式函数全程没有强调分母不为零，严谨性扣分也真实发生。 */
  var RAW = [
    { text: '同学们好，上课。我们先看这张图。这是一天里某地气温的变化曲线，横轴是时间，纵轴是温度。大家观察一下，从早上六点到中午十二点，这条曲线一直在往上走。什么叫往上走？用数学的语言讲，随着时间增大，温度也跟着增大。生活里一个量变大、另一个量也跟着变大的现象很常见，比如水位和时间，比如路程和车速。今天我们就把它翻译成数学语言，研究函数的单调性。' },

    { text: '先明确今天要解决的问题。单调性说的是函数图像在某个区间上的升降，它描述的是整体的趋势，不是某一个点的大小。从图像上看很直观，但考试和评委要的是定义。所以今天只做一件事：把图上看到的升降，写成一句能用式子验证的话。这句话就是函数的单调性的定义。' },

    { text: '我们从最简单的例子开始。看 fx 等于 x 的平方，画出图像，是一条开口向上的抛物线。观察右半支，从原点往右走，图像越来越高。也就是说，x 越大，x 的平方越大。光看图不够，得用式子说清楚。我们任取两个数，x1 小于 x2，能不能推出 fx1 小于 fx2？能推出来，就说明函数在这个区间上是递增的。一般地，设函数 f 的定义域为 I，区间 D 包含在 I 里，如果对区间 D 内任意两个数 x1、x2，当 x1 小于 x2 时，都有 fx1 小于 fx2，我们就说 f 在区间 D 上是增函数。这句话就是增函数的定义。' },

    { text: '请把任意这两个字圈起来，它不能换成存在。换成存在，定义就完全变了：存在两个数满足，不代表整个区间都满足。另外要注意，定义里必须有区间。谁来举个例子，说说生活里还有什么量是随着另一个量一直增大的？好，你说身高和年龄，对，小的时候是这样，长大以后就不一定了，所以单调性必须限定在一个区间上，离开区间谈单调是没有意义的。' },

    { text: '定义里的每一句话都有用。任意两个数，保证的是整个区间的性质；区间 D 包含在定义域里，保证的是函数有意义；fx1 小于 fx2，描述的才是升降。这三件事少一件，定义就不成立。所以我们判断单调性，不能只看图像高不高，要看任意两个点的比较关系。' },

    { text: '下面看例题一。判断 fx 等于 x 分之一，在区间 0 到正无穷上的单调性。第一步，取值，任取 x1、x2 属于这个区间，并且 x1 小于 x2。第二步，作差。fx1 减 fx2 等于 x1 分之一减 x2 分之一，通分以后是 x1 乘 x2 分之 x2 减 x1。因为 x1 小于 x2，所以分子大于零，又因为都在正区间，分母也大于零，所以整个式子是正的。也就是说 fx1 减 fx2 大于零，fx1 大于 fx2，函数是减函数。过程里最关键的是第三步定号，很多同学作完差不写结论，等于白做。还有一处容易丢分：写结论时必须带上区间，只写它在正区间上是减函数，不能笼统说它是减函数。' },

    { text: '再看例题二。用定义证明 fx 等于 x 的平方，在 0 到正无穷上是增函数。还是三步。第一步取值，任取 x1、x2 大于零，并且 x1 小于 x2。第二步作差，x1 的平方减 x2 的平方，等于 x1 加 x2 乘以 x1 减 x2。第三步定号。因为 x1 加 x2 大于零，x1 减 x2 小于零，所以乘积小于零，函数在正区间上递增。注意，区间不能省。如果把区间换成负区间，结论正好相反。我们还可以反过来问，不限定区间，函数还能不能说单调？不能。所以做这类题，第一件事是把区间抄下来，第二件事是确认任取，这两步不出错，后面才有分。' },

    { text: '两道例题放在一起看，方法只有一个：取值、作差、定号。取值一定要任取，取特殊点不算；作差的目标是把 fx1 减 fx2 化成能判断符号的乘积或商；定号之后，结论就写出来了。这套流程是定义法证明单调性的完整套路，六步之内就能写完，比背结论可靠。以后遇到判断单调性的题，先想这三步，再看区间。区间错了，前面全白算。' },

    { text: '好，我们对着板书再走一遍。左边是定义，任意和区间两个词用红笔圈出来了。右边是两道例题的关键步骤，取值、作差、定号，三道竖线分开了。大家看结构，以后写作业就照这个格式来，不会被扣格式分。有的同学会问，为什么一定要任取。因为单调性说的是整个区间上的性质，只看两个特殊点不算数，这一点在填空题里也常考。' },

    { text: '作业分两层。必做，课本第三页练习一到练习三，用定义把每一步写完整，格式照板书来。选做，思考题：如果把函数改成 fx 等于 x 的立方，它在整个实数集上的单调性怎么判断，作差以后怎么定号，分几段讨论。好，今天就讲到这里。' }
  ];

  /* 时间戳按字数自动摊到 0–585 秒，并且拆到句子一级：
     否则整段共用同一个起点，每分钟字数的标准差会被算成「语速忽快忽慢」——
     那是分段粒度造成的假象，不是讲的人的毛病。 */
  var SENTENCES = (function () {
    var out = [];
    RAW.forEach(function (seg) {
      seg.text.split(/(?<=。)/).forEach(function (s) {
        if (s.trim()) out.push(s);
      });
    });
    return out;
  })();

  var TOTAL_CHARS = SENTENCES.reduce(function (a, s) { return a + s.length; }, 0);
  var SEGMENTS = (function () {
    var acc = 0;
    return SENTENCES.map(function (s, i) {
      var t = Math.round((acc / TOTAL_CHARS) * 585);
      acc += s.length;
      return { t: t, text: s, isFinal: true, i: i };
    });
  })();

  /* ---------------- 合成音频测量值 ----------------
     12 次停顿（每分钟约 1.3 次），其中 03:12 那一次 5.6 秒属于长停顿；
     停顿必须与逐字稿的时刻对得上，否则时间轴会指向错误的位置。 */
  function buildPauses() {
    var list = [
      { start: 44.0, end: 45.6 }, { start: 118.0, end: 119.4 },
      { start: 192.0, end: 197.6 },                       // 03:12 的 5.6 秒长停顿
      { start: 240.5, end: 241.9 }, { start: 288.2, end: 289.6 },
      { start: 316.0, end: 317.8 }, { start: 402.4, end: 403.8 },
      { start: 448.0, end: 449.5 }, { start: 470.2, end: 471.9 },
      { start: 536.0, end: 537.4 }, { start: 572.5, end: 574.0 },
      { start: 606.0, end: 607.3 }, { start: 128.0, end: 129.4 },
      { start: 372.6, end: 373.9 }
    ];
    return list.map(function (p) {
      var d = Math.round((p.end - p.start) * 10) / 10;
      return { start: p.start, end: p.end, duration: d, long: d > 5 };
    });
  }

  var AUDIO = {
    duration: 624,
    speechSeconds: 545,
    estimatedChars: 1850,
    peaks: 1850,
    volumeCV: 0.24,
    microPauses: [{ start: 130.5, end: 131.2 }, { start: 360.4, end: 361.1 }],
    pauses: buildPauses()
  };

  /* 板书：没单独拍照，是从录像 01:32 那一帧自动截的，自动粗评五项 */
  /* 示例的板书按「写得还行，但没到示范级」给分：板上没画图，符号也偏挤 */
  var BOARD_ITEMS = { clarity: 15, layout: 14, symbols: 15, structure: 15, neat: 14 };

  /* 示例的仪态：不是「站得居中」，而是两段有连续帧证据的教学行为。
     这是 vision 引擎真实会产出的结构（coverage + pose + behaviors），报告按行为出证据卡。 */
  var VISUAL = {
    duration: 624,
    coverage: {
      samples: 78, poseSamples: 71, poseRate: 0.91, sampleCoverage: 0.96,
      from: 2, to: 601, step: 8, maxGap: 16
    },
    pose: {
      available: true,
      model: { engine: 'MediaPipe Tasks Vision @mediapipe/tasks-vision 0.10.14', model: 'pose_landmarker_lite (float16)' },
      rate: 0.91,
      reason: ''
    },
    board: { found: true, polarity: 'dark', readability: { ok: true, reasons: [] } },
    behaviors: [
      {
        id: 'posture-back-1', key: 'back_turned', kind: 'issue', severity: 'mid',
        from: 236, to: 247, seconds: 11,
        title: '背对镜头讲解 11 秒',
        detail: '这 11 秒里看不到面部关键点、肩膀仍在画面内，同时板面没有变化——是在讲解而不是在写。' +
          '如果镜头方向就是学生方向，这 11 秒学生只看到背影；镜头若是侧机位则不算问题。',
        frames: [{ frameId: 'f31', t: 236, facing: 'back', phase: 'back' }, { frameId: 'f33', t: 247, facing: 'back', phase: 'back' }]
      },
      {
        id: 'posture-occ-1', key: 'board_occluded', kind: 'issue', severity: 'mid',
        from: 318, to: 325, seconds: 7,
        title: '讲解时身体挡住板书 7 秒',
        detail: '这段板面没在变化（不是在写），但身体占了板面 35% 以上。挡的是镜头能看到的那块板面，' +
          '不等于挡住全班——取决于机位，报告只按拍到的画面说。',
        frames: [{ frameId: 'f42', t: 318, facing: 'front', phase: 'talk', occludes: true }]
      },
      {
        key: 'writing', kind: 'positive', severity: 'none',
        from: 88, to: 124, seconds: 36,
        title: '有 3 段板书书写',
        detail: '这些时段板面在变化、人转向板面，属于正常板书行为，不扣分。',
        frames: [{ frameId: 'f12', t: 88, facing: 'back', phase: 'write' }]
      },
      {
        key: 'gesture_board', kind: 'positive', severity: 'none',
        from: 402, to: 409, seconds: 7,
        title: '5 帧里手停在板面附近',
        detail: '有手部关键点落在板书区域内，属于「边指边讲」的可见证据；它说明不了指的就是正在讲的那一行。',
        frames: [{ frameId: 'f52', t: 402, facing: 'profile', phase: 'talk' }]
      }
    ]
  };

  /* ---------------- 板书图 / 每 30 秒的画面缩略图（SVG，不依赖图片文件） ---------------- */
  function svg(inner, W, H) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '">' + inner + '</svg>');
  }

  function boardSvg() {
    var s = '<rect width="860" height="520" fill="#20302a"/>';
    s += '<text x="60" y="86" fill="#f2f5f1" font-size="34" font-family="sans-serif">函数的单调性</text>';
    s += '<line x1="60" y1="104" x2="800" y2="104" stroke="#7f9a8b" stroke-width="2"/>';
    s += '<text x="60" y="160" fill="#eef2ee" font-size="22" font-family="sans-serif">定义：任意 x1、x2 ∈ D，x1 &lt; x2 ⇒ f(x1) &lt; f(x2)</text>';
    s += '<text x="60" y="208" fill="#eef2ee" font-size="22" font-family="sans-serif">则 f(x) 在 D 上单调递增</text>';
    s += '<text x="60" y="286" fill="#f6e7b8" font-size="24" font-family="sans-serif">例1  f(x)=1/x 在 (0,+∞) 上递减</text>';
    s += '<text x="80" y="330" fill="#dfe7e2" font-size="20" font-family="sans-serif">取值 → 作差 → 定号</text>';
    s += '<text x="60" y="410" fill="#f6e7b8" font-size="24" font-family="sans-serif">例2  f(x)=x² 在 (0,+∞) 上递增</text>';
    s += '<text x="80" y="454" fill="#dfe7e2" font-size="20" font-family="sans-serif">x1²−x2²=(x1+x2)(x1−x2) &lt; 0</text>';
    s += '<path d="M660 500 L660 380 L800 380" fill="none" stroke="#9fb8a9" stroke-width="2"/>';
    s += '<path d="M672 470 Q710 470 730 400 T790 392" fill="none" stroke="#cfe0d4" stroke-width="3"/>';
    return svg(s, 860, 520);
  }

  function shotSvg(kind) {
    var W = 320, H = 200;
    var s = '<rect width="' + W + '" height="' + H + '" fill="#101216"/>';

    if (kind === 'board' || kind === 'both') {
      var bw = kind === 'both' ? 232 : 300;
      s += '<rect x="8" y="10" width="' + bw + '" height="180" rx="4" fill="#eef0ec"/>';
      s += '<rect x="22" y="26" width="' + (bw - 60) + '" height="11" rx="3" fill="#2f3b34" opacity=".9"/>';
      s += '<rect x="22" y="58" width="' + (bw - 86) + '" height="6" rx="3" fill="#5b6b62" opacity=".8"/>';
      s += '<rect x="22" y="74" width="' + (bw - 100) + '" height="6" rx="3" fill="#5b6b62" opacity=".7"/>';
      s += '<rect x="22" y="98" width="' + (bw - 70) + '" height="6" rx="3" fill="#5b6b62" opacity=".8"/>';
      s += '<rect x="22" y="122" width="' + (bw - 120) + '" height="6" rx="3" fill="#5b6b62" opacity=".6"/>';
      s += '<path d="M30 176 q26 -16 52 0 t52 0" fill="none" stroke="#2b6cb0" stroke-width="3"/>';
    }

    if (kind === 'face' || kind === 'both') {
      var cx = kind === 'both' ? 272 : 160;
      s += '<circle cx="' + cx + '" cy="92" r="30" fill="#d3ac82"/>';
      s += '<path d="M' + (cx - 44) + ' 200 q44 -76 88 0 z" fill="#39404e"/>';
    }

    if (kind === 'other') {
      s += '<rect x="60" y="60" width="200" height="80" rx="6" fill="#2a2d34"/>';
    }

    return svg(s, W, H);
  }

  var KINDS = ['face', 'board', 'both', 'board', 'face', 'board', 'both', 'face',
    'board', 'board', 'both', 'face', 'board', 'board', 'both', 'board',
    'face', 'board', 'both', 'board', 'face'];

  function buildShots() {
    var out = [];
    for (var i = 0; i < KINDS.length; i++) {
      var kind = KINDS[i];
      var t = i * 30 + 2;
      if (t > 624) break;
      var hasFace = kind === 'face' || kind === 'both';
      var hasBoard = kind === 'board' || kind === 'both';
      out.push({
        t: t,
        img: shotSvg(kind),
        kind: kind,
        face: hasFace ? 0.07 + (i % 3) * 0.01 : 0,
        cx: 0.5 + ((i % 4) - 1.5) * 0.06,
        cy: 0.46,
        board: hasBoard ? 0.42 : 0.06,
        bright: hasBoard ? 196 : 128,
        ink: hasBoard ? 0.041 : 0.008,
        lum: hasBoard ? 0.74 : 0.42
      });
    }
    return out;
  }

  /* ---------------- 主入口 ---------------- */
  function build() {
    var shots = buildShots();
    var input = {
      ts: Date.now(),
      topic: '函数的单调性（人教 A 版必修一 3.2）',
      duration: AUDIO.duration,
      targetMin: 10,
      audio: AUDIO,
      transcript: SEGMENTS,
      asrAvailable: true,
      visual: VISUAL,
      shots: shots,
      board: { dataUrl: boardSvg(), auto: true, at: 92 },
      boardAuto: { items: BOARD_ITEMS, metrics: { inkRatio: 0.14, lineCV: 0.18, marginCV: 0.12 } },
      hasVideo: false
    };

    var report = App.Scoring.evaluate(input);
    report.board = { dataUrl: boardSvg(), auto: true, at: 92 };
    report.shots = shots;
    report.demo = true;

    /* 示例报告也走新细则：数据是编的，但口径与真实报告完全一致，
       这样点「示例报告」看到的就是新版式，不会和真实报告两套样子 */
    if (App.Rubric2) {
      var speech = null;
      if (App.MetricsSpeech) {
        speech = App.MetricsSpeech.analyze({ segments: SEGMENTS, audio: AUDIO, duration: AUDIO.duration });
        speech.text = SEGMENTS.map(function (s) { return s.text || ''; }).join('');
      }
      report.speech = speech;
      report.posture = {
        available: true, total: 10, withPose: 10, step: 3,
        metrics: [
          { key: 'presence', value: 100 }, { key: 'stance', value: 6.4 },
          { key: 'drift', value: 9.8 }, { key: 'gesture', value: 14.5 },
          { key: 'sideMax', value: 4 }, { key: 'armsMax', value: 0 }, { key: 'block', value: 0 }
        ],
        points: { score: 88, items: [], weightUsed: 11.5 },
        sideRuns: [], downRuns: [], blockedFrames: 0
      };
      report.face = {
        available: true, total: 10, withFace: 10, step: 3,
        metrics: [
          { key: 'smile', value: 27 }, { key: 'gazeCamera', value: 58 },
          { key: 'brow', value: 6 }, { key: 'press', value: 4 }, { key: 'stall', value: 9 }
        ],
        points: { score: 85, items: [], weightUsed: 10 }
      };
      report.board.crop = {
        metrics: {
          available: true, charSource: 'ocr', measurable: true,
          rows: { count: 6, pitchPx: 46, pitchCv: 0.16 },
          chars: { count: 96, sizePx: 22, gapCv: 0.22, sizeCv: 0.18, gapRatio: 0.35 },
          utility: 0.46, blocks: [{}, {}], residue: 0.28, occlusion: 0.02,
          metrics: [
            { key: 'straight', value: 8 }, { key: 'pitch', value: 1.9 },
            { key: 'gap', value: 0.35 }, { key: 'size', value: 4.2 },
            { key: 'utility', value: 46 }, { key: 'residue', value: 28 },
            { key: 'block', value: 2 }, { key: 'occlusion', value: 2 }
          ]
        }
      };
      report.rubric2 = App.Rubric2.compute({
        speech: speech, posture: report.posture, face: report.face,
        board: report.board.crop.metrics, theory: report.theory || null,
        audio: AUDIO, duration: AUDIO.duration
      });
    }
    return report;
  }

  App.demo = { build: build, transcript: SEGMENTS, audio: AUDIO, boardSvg: boardSvg, shotSvg: shotSvg };

})(window);