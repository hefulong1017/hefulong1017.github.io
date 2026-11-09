/* 试讲评分官 · 视觉分析引擎
 *
 * 这一层回答四个问题，而且只回答能回答的：
 *   1. 画面里有哪些**可以确认**的行为？（转身、遮挡、指板、书写、走动）
 *   2. 板书有哪些**可以确认**的问题？（拍不清 / 反光 / 挡住 / 排版挤 / 分区乱）
 *   3. 这些事发生在**什么时间、画面哪个位置**？
 *   4. 证据够不够支撑结论？（不够就只写「观察到」，不写「一直」「频繁」）
 *
 * 明确不做的事：
 *   - 不用人是否居中、正脸比例、表情变化来给仪态打分（这些只用于定位与「能否分析」）；
 *   - 不把「检测到骨架」当成「已评价仪态」——骨架只是原料，结论要过时间与遮挡的门槛；
 *   - 不用两三张抽帧写「全程」「频繁」；动态结论必须连续段或多点密度支撑。
 */
(function (window) {
  'use strict';

  var App = window.App || (window.App = {});
  var util = App.util;

  var CFG = {
    maxBaseFrames: 400,
    maxFrames: 480,
    fineMaxFrames: 900,
    ocrTimeoutSec: 45,   /* OCR 超时就放弃，别让识别把整份报告卡住 */
    /* 基础采样间隔（秒）：统一 3 秒一帧，不论素材多长。
       10 分钟一节课 = 200 帧，姿态、板书、表情的判断都按这个节奏对齐。 */
    baseStep: function (dur) {
      return 3;
    },
    /* 动态结论的证据门槛：连续段至少这么长、至少这么多帧 */
    gates: {
      backRun: { minSec: 8, minFrames: 4 },
      occludeRun: { minSec: 5, minFrames: 4 },
      writeRun: { minSec: 3, minFrames: 3 },
      gestureRun: { minSec: 1, minFrames: 2 },
      minSamplesForDynamic: 6,
      minCoveredSec: 30
    },
    dedupeSig: 0.004,
    eventSig: 0.07,
    /* 画面几乎没变（差 < reuseSig）时直接沿用上一帧的关键点，
       不再跑一遍推理——固定机位讲课时能省掉一大半算力。 */
    reuseSig: 0.012,
    /* 面部检测隔帧跑：3 秒采样下等效 6 秒一帧，对「有没有笑、看哪里」够用 */
    faceStride: 2
  };

  /* ------------------------------------------------------------------ 工具 */

  function round1(v) { return Math.round(v * 10) / 10; }
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function signature(data, w, h) {
    /* 8×8 灰度签名，用于去重与「画面有没有变」 */
    var out = new Float32Array(64);
    var bw = w / 8, bh = h / 8;
    for (var by = 0; by < 8; by++) {
      for (var bx = 0; bx < 8; bx++) {
        var sum = 0, n = 0;
        var y0 = Math.floor(by * bh), y1 = Math.floor((by + 1) * bh);
        var x0 = Math.floor(bx * bw), x1 = Math.floor((bx + 1) * bw);
        for (var y = y0; y < y1; y += 2) {
          for (var x = x0; x < x1; x += 2) {
            var i = (y * w + x) * 4;
            sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            n++;
          }
        }
        out[by * 8 + bx] = n ? sum / n : 0;
      }
    }
    return out;
  }

  function sigDiff(a, b) {
    if (!a || !b) return 1;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length / 255;
  }

  /* 清晰度：拉普拉斯方差（只在板书区域里算，别被人物衣服干扰） */
  function sharpness(data, w, h, rect) {
    /* rect 有两种来源：早期传归一化坐标（0–1），板面证据那遍传的是像素框。
       之前一律按归一化乘宽高，遇到像素框就变成 w² 次循环，一张图能卡几分钟。 */
    var pixelRect = !!(rect && (rect.w > 1 || rect.h > 1));
    var x0 = rect ? Math.floor(pixelRect ? rect.x : rect.x * w) : 2;
    var y0 = rect ? Math.floor(pixelRect ? rect.y : rect.y * h) : 2;
    var x1 = rect ? Math.floor(pixelRect ? rect.x + rect.w : (rect.x + rect.w) * w) : w - 2;
    var y1 = rect ? Math.floor(pixelRect ? rect.y + rect.h : (rect.y + rect.h) * h) : h - 2;
    x0 = Math.max(1, Math.min(x0, w - 3));
    y0 = Math.max(1, Math.min(y0, h - 3));
    x1 = Math.max(x0 + 2, Math.min(x1, w - 1));
    y1 = Math.max(y0 + 2, Math.min(y1, h - 1));
    var sum = 0, sum2 = 0, n = 0;
    for (var y = y0 + 1; y < y1 - 1; y += 2) {
      for (var x = x0 + 1; x < x1 - 1; x += 2) {
        var i = (y * w + x) * 4;
        var c = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        var l = (data[(y * w + x - 1) * 4] + data[(y * w + x + 1) * 4]) / 2;
        var u = (data[((y - 1) * w + x) * 4] + data[((y + 1) * w + x) * 4]) / 2;
        var lap = (l + u) / 2 - c;
        sum += lap; sum2 += lap * lap; n++;
      }
    }
    if (!n) return 0;
    var mean = sum / n;
    return Math.max(0, sum2 / n - mean * mean);
  }

  /* 板面区域：先判极性（浅底/深底），再找「大面积平整 + 有笔画」的最大连通块 */
  function legacyBoardRegion(data, w, h, personBox) {
    var cols = 16, rows = 9;
    var cw = w / cols, ch = h / rows;
    var tiles = [];
    var flatB = 0, flatD = 0, total = 0;

    for (var ry = 0; ry < rows; ry++) {
      for (var rx = 0; rx < cols; rx++) {
        var x0 = Math.floor(rx * cw), x1 = Math.floor((rx + 1) * cw);
        var y0 = Math.floor(ry * ch), y1 = Math.floor((ry + 1) * ch);
        var sb = 0, sb2 = 0, sd = 0, sd2 = 0, nb = 0, nd = 0;
        for (var y = y0; y < y1; y += 2) {
          for (var x = x0; x < x1; x += 2) {
            var i = (y * w + x) * 4;
            var l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (l >= 88) { sb += l; sb2 += l * l; nb++; } else { sd += l; sd2 += l * l; nd++; }
          }
        }
        var mb = nb ? sb / nb : 0;
        var vb = nb ? Math.max(0, sb2 / nb - mb * mb) : 0;
        var md = nd ? sd / nd : 0;
        var vd = nd ? Math.max(0, sd2 / nd - md * md) : 0;
        var bright = nb / (nb + nd);
        var flat = bright > 0.55 ? mb > 150 && vb < 900
          : bright < 0.45 ? md < 110 && vd < 900
            : false;
        if (flat && bright > 0.55) flatB++;
        if (flat && bright < 0.45) flatD++;
        total++;
        tiles.push({
          rx: rx, ry: ry, flat: flat, bright: bright,
          mean: bright > 0.5 ? mb : md,
          inPerson: personBox ? overlapsTile(rx, ry, cols, rows, personBox) : false
        });
      }
    }
    var polarity = flatB >= flatD ? 'light' : 'dark';
    var usable = tiles.filter(function (t) {
      return t.flat && !t.inPerson && (polarity === 'light' ? t.bright > 0.55 : t.bright < 0.45);
    });
    if (usable.length < 8) return null;

    var minx = cols, maxx = -1, miny = rows, maxy = -1;
    usable.forEach(function (t) {
      minx = Math.min(minx, t.rx); maxx = Math.max(maxx, t.rx);
      miny = Math.min(miny, t.ry); maxy = Math.max(maxy, t.ry);
    });
    var rect = {
      x: minx / cols, y: miny / rows,
      w: (maxx - minx + 1) / cols, h: (maxy - miny + 1) / rows
    };
    if (rect.w * rect.h < 0.06) return null;

    /* 板面里有没有笔画：比板面中位数深/浅得多的像素比例 */
    var px0 = Math.floor(rect.x * w), px1 = Math.floor((rect.x + rect.w) * w);
    var py0 = Math.floor(rect.y * h), py1 = Math.floor((rect.y + rect.h) * h);
    var vals = [];
    for (var yy = py0; yy < py1; yy += 2) {
      for (var xx = px0; xx < px1; xx += 2) {
        var j = (yy * w + xx) * 4;
        vals.push(data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114);
      }
    }
    vals.sort(function (a, b) { return a - b; });
    var mid = vals[Math.floor(vals.length / 2)] || 0;
    var band = 26;
    var ink = 0, glare = 0;
    vals.forEach(function (v) {
      if (polarity === 'light' ? v < mid - band : v > mid + band) ink++;
      if (polarity === 'light' && v >= 253) glare++;
    });
    var inkRatio = ink / Math.max(1, vals.length);

    /* 两条例外：
       · 整幅画面都「平」且几乎没有笔画 —— 那是白墙/白纸，不是板书；
       · 极细的一条（<25%）—— 多半是墙缝、边框，裁出来没意义。
       这两种情况宁可说「没定位到」，也不要拿墙当板书去评。 */
    var area = rect.w * rect.h;
    if (area > 0.85 && inkRatio < 0.012) return null;
    if (rect.w < 0.25 || rect.h < 0.20) return null;

    return {
      rect: rect,
      polarity: polarity,
      inkRatio: inkRatio,
      glareRatio: glare / Math.max(1, vals.length),
      flatTiles: usable.length,
      coverage: area,
      whole: area > 0.85
    };
  }

  /* ======================================================================
     板面定位 v2
     ----------------------------------------------------------------------
     为什么重写：旧实现把「所有平整格子」的外接矩形当成板面，
     只要画面上下左右有黑边、桌面上有一块暗色，外接矩形就会被撑成整幅画面
     （实测 1280×720 的真实课堂视频，rect 恒为 0,0,1,1），
     于是「板面」= 整幅画面，后面的清晰度、墨迹、遮挡全部失真。

     现在的做法：
       1. 先量出真正的画面内容区（去掉录制黑边）；
       2. 32×18 格逐格统计亮度/标准差，按暗板、亮板两种极性分类；
       3. 同极性做连通域，取最大的一块，并用「填充率 / 长宽比 / 贴边数 / 面积」
          把墙面、桌面、地板这些长得像板但不是板的东西挡掉；
       4. 人物挡住的格子不参与分类，但允许被左右两侧的同一连通域「补」回来；
       5. 在候选矩形里量墨迹与反光：几乎没有墨迹 = 空墙，直接判「没定位到」。
     ====================================================================== */

  function rowStats(data, w, y, x0, x1) {
    var sum = 0, sum2 = 0, n = 0;
    for (var x = x0; x < x1; x += 3) {
      var i = (y * w + x) * 4;
      var l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      sum += l; sum2 += l * l; n++;
    }
    if (!n) return { mean: 0, std: 0 };
    var m = sum / n;
    return { mean: m, std: Math.sqrt(Math.max(0, sum2 / n - m * m)) };
  }

  function colStats(data, w, h, x, y0, y1) {
    var sum = 0, sum2 = 0, n = 0;
    for (var y = y0; y < y1; y += 3) {
      var i = (y * w + x) * 4;
      var l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      sum += l; sum2 += l * l; n++;
    }
    if (!n) return { mean: 0, std: 0 };
    var m = sum / n;
    return { mean: m, std: Math.sqrt(Math.max(0, sum2 / n - m * m)) };
  }

  /* 内容区：去掉"整行/整列都极暗或极亮且几乎无变化"的边（录制黑边、白边） */
  function contentRect(data, w, h) {
    var cappedY = Math.floor(h * 0.18) + 1;
    var cappedX = Math.floor(w * 0.18) + 1;
    function isBar(s) { return s.std < 7 && (s.mean < 32 || s.mean > 244); }

    var top = 0, bottom = h - 1, left = 0, right = w - 1, y, x;
    for (y = 0; y < cappedY; y++) { if (!isBar(rowStats(data, w, y, left, right))) break; top = y + 1; }
    for (y = h - 1; y > h - cappedY; y--) { if (!isBar(rowStats(data, w, y, left, right))) break; bottom = y - 1; }
    for (x = 0; x < cappedX; x++) { if (!isBar(colStats(data, w, h, x, top, bottom))) break; left = x + 1; }
    for (x = w - 1; x > w - cappedX; x--) { if (!isBar(colStats(data, w, h, x, top, bottom))) break; right = x - 1; }

    if (right - left < w * 0.5 || bottom - top < h * 0.5) return { x: 0, y: 0, w: w, h: h };
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }

  var BOARD_GRID = { cols: 32, rows: 18 };

  function tileScan(data, w, h, rect, personBox) {
    var cols = BOARD_GRID.cols, rows = BOARD_GRID.rows;
    var tw = rect.w / cols, th = rect.h / rows;
    var tiles = [];
    for (var ry = 0; ry < rows; ry++) {
      for (var rx = 0; rx < cols; rx++) {
        var x0 = Math.floor(rect.x + rx * tw), x1 = Math.floor(rect.x + (rx + 1) * tw);
        var y0 = Math.floor(rect.y + ry * th), y1 = Math.floor(rect.y + (ry + 1) * th);
        var sum = 0, sum2 = 0, n = 0;
        for (var y = y0; y < y1; y += 2) {
          for (var x = x0; x < x1; x += 2) {
            var i = (y * w + x) * 4;
            var l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            sum += l; sum2 += l * l; n++;
          }
        }
        var mean = n ? sum / n : 0;
        var std = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 999;
        var cx = (rx + 0.5) / cols, cy = (ry + 0.5) / rows;
        var inPerson = !!(personBox && cx > personBox.x && cx < personBox.x + personBox.w &&
          cy > personBox.y && cy < personBox.y + personBox.h);
        tiles.push({ rx: rx, ry: ry, mean: mean, std: std, inPerson: inPerson });
      }
    }
    return { tiles: tiles, cols: cols, rows: rows, tw: tw, th: th };
  }

  /* 同极性连通域（4 邻接），返回按得分排序的候选 */
  function componentsOf(tiles, cols, rows, polarity) {
    var lim = polarity === 'dark' ? { maxMean: 112, maxStd: 34 } : { minMean: 158, maxStd: 30 };
    function isPlane(t) {
      if (polarity === 'dark') return t.mean < lim.maxMean && t.std < lim.maxStd;
      return t.mean > lim.minMean && t.std < lim.maxStd;
    }
    var seen = new Uint8Array(cols * rows);
    var out = [];
    for (var k = 0; k < tiles.length; k++) {
      if (seen[k] || !isPlane(tiles[k])) continue;
      var stack = [k], cells = [];
      seen[k] = 1;
      while (stack.length) {
        var cur = stack.pop();
        cells.push(cur);
        var rx = cur % cols, ry = (cur - rx) / cols;
        var nb = [[rx - 1, ry], [rx + 1, ry], [rx, ry - 1], [rx, ry + 1]];
        for (var j = 0; j < nb.length; j++) {
          var nx = nb[j][0], ny = nb[j][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          var idx = ny * cols + nx;
          if (seen[idx] || !isPlane(tiles[idx])) continue;
          seen[idx] = 1;
          stack.push(idx);
        }
      }
      out.push(cells);
    }
    return out;
  }

  function bboxOf(cells, cols) {
    var minx = cols, maxx = -1, miny = 1e9, maxy = -1;
    cells.forEach(function (c) {
      var rx = c % cols, ry = (c - rx) / cols;
      if (rx < minx) minx = rx; if (rx > maxx) maxx = rx;
      if (ry < miny) miny = ry; if (ry > maxy) maxy = ry;
    });
    return { minx: minx, maxx: maxx, miny: miny, maxy: maxy };
  }

  /* 诊断专用：把 32×18 的分类网格画成字符，报告与 _lab 都能直接看
     d = 暗板候选 · l = 亮板候选 · P = 人物所在格 · . = 都不像 */
  function boardDebug(data, w, h, personBox) {
    var content = contentRect(data, w, h);
    var scan = tileScan(data, w, h, content, personBox);
    var cols = scan.cols, rows = scan.rows;
    var lines = [];
    var counts = { dark: 0, light: 0, person: 0 };
    for (var ry = 0; ry < rows; ry++) {
      var line = '';
      for (var rx = 0; rx < cols; rx++) {
        var t = scan.tiles[ry * cols + rx];
        if (t.inPerson) { line += 'P'; counts.person++; }
        else if (t.mean < 112 && t.std < 34) { line += 'd'; counts.dark++; }
        else if (t.mean > 158 && t.std < 30) { line += 'l'; counts.light++; }
        else line += '.';
      }
      lines.push(line);
    }
    return {
      content: content,
      cols: cols, rows: rows,
      grid: lines,
      counts: counts,
      w: w, h: h
    };
  }

  /* 板面定位入口。返回 null = 没找到（调用方必须显示「未定位到可读板面」）。 */
  function boardRegion(data, w, h, personBox) {
    var content = contentRect(data, w, h);
    var scan = tileScan(data, w, h, content, personBox);
    var tiles = scan.tiles, cols = scan.cols, rows = scan.rows;

    function toRect(bb) {
      return {
        x: (content.x + bb.minx * scan.tw) / w,
        y: (content.y + bb.miny * scan.th) / h,
        w: ((bb.maxx - bb.minx + 1) * scan.tw) / w,
        h: ((bb.maxy - bb.miny + 1) * scan.th) / h
      };
    }

    /* 擦过的黑板会有大片粉笔灰：这些格子方差很高，严格判据会把板面的左半边丢掉。
     所以先找「干净的核心格」，再按「平均亮度接近核心」向外生长，
     让雾状粉笔灰、擦痕这些同色但纹理多的区域回到板面里。 */
  function growComponent(tiles, cols, rows, seed) {
    var set = {};
    seed.forEach(function (c) { set[c] = 1; });
    var means = seed.map(function (c) { return tiles[c].mean; }).sort(function (a, b) { return a - b; });
    var med = means[Math.floor(means.length / 2)];
    var queue = seed.slice();
    while (queue.length) {
      var cur = queue.pop();
      var rx = cur % cols, ry = (cur - rx) / cols;
      var nb = [[rx - 1, ry], [rx + 1, ry], [rx, ry - 1], [rx, ry + 1]];
      for (var i = 0; i < nb.length; i++) {
        var nx = nb[i][0], ny = nb[i][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var idx = ny * cols + nx;
        if (set[idx]) continue;
        var t = tiles[idx];
        if (t.inPerson) continue;
        if (Math.abs(t.mean - med) <= 26 && t.std < 72) { set[idx] = 1; queue.push(idx); }
      }
    }
    return Object.keys(set).map(Number);
  }

  /* 用行/列亮度剖面把矩形贴到板面边界：
     板面是一整片同亮度的区域，天花板、白墙、木桌面、地面都会在剖面上"跳"出去。
     先按中位亮度给每一行/列打上「在板面内」的标记，再取包含中心的一段连续区间
     （允许跨过 1–2 行的字迹/反光空洞，不跨过大段跳变）。 */
  function refineByProfiles(data, w, h, rect, med) {
    var tol = 42;
    var wx0 = Math.max(0, Math.floor((rect.x - 0.14) * w));
    var wx1 = Math.min(w, Math.ceil((rect.x + rect.w + 0.14) * w));
    var wy0 = Math.max(0, Math.floor((rect.y - 0.14) * h));
    var wy1 = Math.min(h, Math.ceil((rect.y + rect.h + 0.14) * h));

    function meanRow(y) {
      var s = 0, n = 0;
      for (var x = wx0; x < wx1; x += 3) {
        var i = (y * w + x) * 4;
        s += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114; n++;
      }
      return n ? s / n : 0;
    }
    function meanCol(x) {
      var s = 0, n = 0;
      for (var y = wy0; y < wy1; y += 3) {
        var i = (y * w + x) * 4;
        s += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114; n++;
      }
      return n ? s / n : 0;
    }

    function runAround(flags, center, from, to) {
      if (!flags[center]) {
        /* 中心行本身不合格时，就近找一条合格的行当锚点 */
        var bestD = 1e9, bestI = -1;
        for (var k = from; k <= to; k++) {
          if (flags[k] && Math.abs(k - center) < bestD) { bestD = Math.abs(k - center); bestI = k; }
        }
        if (bestI < 0) return null;
        center = bestI;
      }
      var lo = center, hi = center, gaps = 0;
      while (lo - 1 >= from) {
        if (flags[lo - 1]) { lo--; gaps = 0; }
        else if (gaps < 2 && flags[lo - 2]) { lo -= 2; gaps++; }
        else break;
      }
      gaps = 0;
      while (hi + 1 <= to) {
        if (flags[hi + 1]) { hi++; gaps = 0; }
        else if (gaps < 2 && flags[hi + 2]) { hi += 2; gaps++; }
        else break;
      }
      return { lo: lo, hi: hi };
    }

    var rowFlags = {};
    for (var y = wy0; y <= wy1; y++) rowFlags[y] = Math.abs(meanRow(y) - med) <= tol;
    var colFlags = {};
    for (var x = wx0; x <= wx1; x++) colFlags[x] = Math.abs(meanCol(x) - med) <= tol;

    var cy = Math.round((rect.y + rect.h / 2) * h);
    var cx = Math.round((rect.x + rect.w / 2) * w);
    var rw = runAround(rowFlags, cy, wy0, wy1);
    var rh = runAround(colFlags, cx, wx0, wx1);
    if (!rw || !rh) return rect;

    var out = {
      x: rh.lo / w, y: rw.lo / h,
      w: (rh.hi - rh.lo + 1) / w, h: (rw.hi - rw.lo + 1) / h
    };
    if (out.w < 0.1 || out.h < 0.08 || out.w * out.h < 0.04) return rect;
    return out;
  }

  /* 板面里的像素统计：中位数 + 墨迹 + 反光 + 色温 */
    function regionStats(x0, y0, x1, y1) {
      var vals = [];
      var warm = 0;
      for (var yy = y0; yy < y1; yy += 2) {
        for (var xx = x0; xx < x1; xx += 2) {
          var j = (yy * w + xx) * 4;
          vals.push(data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114);
          warm += data[j] - data[j + 2];
        }
      }
      if (vals.length < 64) return null;
      vals.sort(function (a, b) { return a - b; });
      var mid = vals[Math.floor(vals.length / 2)] || 0;
      var ink = 0, glare = 0;
      vals.forEach(function (v) {
        if (Math.abs(v - mid) > 30) ink++;
        if (v >= 250) glare++;
      });
      return {
        mid: mid, inkRatio: ink / vals.length, glareRatio: glare / vals.length,
        warm: warm / vals.length, n: vals.length
      };
    }

    function tileRect(bb) {
      return {
        x0: Math.max(0, Math.floor(content.x + bb.minx * scan.tw)),
        y0: Math.max(0, Math.floor(content.y + bb.miny * scan.th)),
        x1: Math.min(w, Math.ceil(content.x + (bb.maxx + 1) * scan.tw)),
        y1: Math.min(h, Math.ceil(content.y + (bb.maxy + 1) * scan.th))
      };
    }

    /* 只用「有足够支撑」的行/列：一条两格宽的过道会把地板和黑板连成一块，
       这一步把这种细长的外延剪掉，矩形才会贴住真正的板面。 */
    function trimToSupport(cells, cols) {
      var rowCnt = {}, colCnt = {}, maxRow = 0, maxCol = 0;
      cells.forEach(function (c) {
        var rx = c % cols, ry = (c - rx) / cols;
        rowCnt[ry] = (rowCnt[ry] || 0) + 1;
        colCnt[rx] = (colCnt[rx] || 0) + 1;
        if (rowCnt[ry] > maxRow) maxRow = rowCnt[ry];
        if (colCnt[rx] > maxCol) maxCol = colCnt[rx];
      });
      var rows = Object.keys(rowCnt).filter(function (k) { return rowCnt[k] >= Math.max(2, maxRow * 0.5); }).map(Number);
      var colsk = Object.keys(colCnt).filter(function (k) { return colCnt[k] >= Math.max(2, maxCol * 0.5); }).map(Number);
      if (!rows.length || !colsk.length) return bboxOf(cells, cols);
      return {
        minx: Math.min.apply(null, colsk), maxx: Math.max.apply(null, colsk),
        miny: Math.min.apply(null, rows), maxy: Math.max.apply(null, rows)
      };
    }

    /* 候选扫描：同一套逻辑跑两遍。
       严格的一遍用来挡桌面/墙面；严格的一遍全军覆没时，放宽再找一次
       （真实课堂里黑板被讲台挡一截、被镜头切边、比例特别宽都很常见），
       放宽找到的结果会标 relaxed，置信度也会更低，报告里照实写。 */
    function scanCandidates(g) {
      var found = null;
      ['dark', 'light'].forEach(function (polarity) {
        componentsOf(tiles, cols, rows, polarity).forEach(function (seed) {
          if (seed.length < cols * rows * 0.03) return;
          var cells = growComponent(tiles, cols, rows, seed);
          if (cells.length < cols * rows * 0.04) return;
          var bb = trimToSupport(cells, cols);
          var bw = bb.maxx - bb.minx + 1, bh = bb.maxy - bb.miny + 1;
          if (bw < 2 || bh < 2) return;
          var fill = Math.min(1, cells.length / (bw * bh));
          var area = (bw * bh) / (cols * rows);
          var aspect = (bw * scan.tw) / (bh * scan.th);
          var touch = 0;
          if (bb.minx <= 0) touch++;
          if (bb.maxx >= cols - 1) touch++;
          if (bb.miny <= 0) touch++;
          if (bb.maxy >= rows - 1) touch++;

          if (area > g.maxArea || area < g.minArea) return;
          if (aspect < g.minAspect || aspect > g.maxAspect) return;
          if (fill < g.minFill) return;
          if (touch >= g.maxTouch) return;

          var tr = tileRect(bb);
          var st = regionStats(tr.x0, tr.y0, tr.x1, tr.y1);
          if (!st || st.inkRatio < g.minInk) return;
          if (st.warm > g.maxWarm) return;

          var sharpCand = sharpness(data, w, h, {
            x: tr.x0 / w, y: tr.y0 / h, w: (tr.x1 - tr.x0) / w, h: (tr.y1 - tr.y0) / h
          });
          if (!(st.inkRatio >= g.inkOr || sharpCand >= g.sharpOr)) return;

          var cyN = (bb.miny + bb.maxy) / 2 / rows;
          if (cyN > 0.78 && bb.maxy >= rows - 1) return;

          var inkW = Math.min(st.inkRatio / 0.08, 1);
          var score = area * fill * (0.55 + 0.45 * inkW) * (aspect > 1.15 && aspect < 3.2 ? 1.1 : 1);
          if (!found || score > found.score) {
            found = {
              score: score, polarity: polarity, bb: bb, area: area, fill: fill,
              aspect: aspect, touch: touch, tiles: cells.length, stats: st,
              relaxed: !!g.relaxed
            };
          }
        });
      });
      return found;
    }

    var STRICT = {
      maxArea: 0.78, minArea: 0.05, minAspect: 1.05, maxAspect: 3.6,
      minFill: 0.55, maxTouch: 3, minInk: 0.02, maxWarm: 30, inkOr: 0.05, sharpOr: 55
    };
    var LOOSE = {
      maxArea: 0.92, minArea: 0.03, minAspect: 0.8, maxAspect: 5.2,
      minFill: 0.42, maxTouch: 5, minInk: 0.012, maxWarm: 48, inkOr: 0.03, sharpOr: 34,
      relaxed: true
    };

    var best = scanCandidates(STRICT);
    if (!best) best = scanCandidates(LOOSE);

    if (!best) return null;

    var px0 = Math.floor(content.x + best.bb.minx * scan.tw);
    var py0 = Math.floor(content.y + best.bb.miny * scan.th);
    var px1 = Math.ceil(content.x + (best.bb.maxx + 1) * scan.tw);
    var py1 = Math.ceil(content.y + (best.bb.maxy + 1) * scan.th);
    px0 = Math.max(0, px0); py0 = Math.max(0, py0);
    px1 = Math.min(w, px1); py1 = Math.min(h, py1);

    var st2 = regionStats(px0, py0, px1, py1) || best.stats;

    /* 把矩形贴到真正的板面边界（剖面法），避免把桌面、字幕条、墙面算进板面 */
    var rough = { x: px0 / w, y: py0 / h, w: (px1 - px0) / w, h: (py1 - py0) / h };
    var refined = refineByProfiles(data, w, h, rough, st2.mid);
    px0 = Math.max(0, Math.floor(refined.x * w));
    py0 = Math.max(0, Math.floor(refined.y * h));
    px1 = Math.min(w, Math.ceil((refined.x + refined.w) * w));
    py1 = Math.min(h, Math.ceil((refined.y + refined.h) * h));
    st2 = regionStats(px0, py0, px1, py1) || st2;

    var inkRatio = st2.inkRatio;
    var glareRatio = st2.glareRatio;
    var refinedArea = ((px1 - px0) / w) * ((py1 - py0) / h);
    var conf = Math.min(1, best.fill * 0.40 + Math.min(refinedArea / 0.35, 1) * 0.35 + Math.min(inkRatio / 0.06, 1) * 0.25);
    if (best.relaxed) conf = conf * 0.85;

    /* 空墙判据：几乎没有墨迹就不是板书，宁可说没找到 */
    if (inkRatio < 0.008) return null;

    var outRect = { x: px0 / w, y: py0 / h, w: (px1 - px0) / w, h: (py1 - py0) / h };

    var quality = [];
    if (outRect.w * outRect.h < 0.05) quality.push({ key: 'small', text: '板面面积过小' });
    if (inkRatio < 0.008) quality.push({ key: 'empty', text: '板面上没有可见笔画' });

    return {
      rect: outRect,
      polarity: best.polarity,
      coverage: util.round1(refinedArea * 100) / 100,
      inkRatio: Math.round(inkRatio * 1000) / 1000,
      glareRatio: Math.round(glareRatio * 1000) / 1000,
      flatTiles: best.tiles,
      relaxed: !!best.relaxed,
      confidence: Math.round(conf * 100) / 100,
      fill: Math.round(best.fill * 100) / 100,
      aspect: Math.round(((px1 - px0) / (py1 - py0)) * 100) / 100,
      content: content,
      quality: quality,
      whole: false
    };
  }

  function overlapsTile(rx, ry, cols, rows, box) {
    var cx = (rx + 0.5) / cols, cy = (ry + 0.5) / rows;
    return cx > box.x && cx < box.x + box.w && cy > box.y && cy < box.y + box.h;
  }

  /* 只对板面区域取签名：用来回答「板书有没有在变」，不受人物走动干扰 */
  function regionSignature(data, w, h, rect) {
    var out = new Float32Array(64);
    var x0 = Math.floor(rect.x * w), y0 = Math.floor(rect.y * h);
    var rw = Math.max(8, Math.floor(rect.w * w)), rh = Math.max(8, Math.floor(rect.h * h));
    for (var by = 0; by < 8; by++) {
      for (var bx = 0; bx < 8; bx++) {
        var sum = 0, n = 0;
        var sx0 = x0 + Math.floor(bx * rw / 8), sx1 = x0 + Math.floor((bx + 1) * rw / 8);
        var sy0 = y0 + Math.floor(by * rh / 8), sy1 = y0 + Math.floor((by + 1) * rh / 8);
        for (var y = sy0; y < sy1; y += 2) {
          for (var x = sx0; x < sx1; x += 2) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            var i = (y * w + x) * 4;
            sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            n++;
          }
        }
        out[by * 8 + bx] = n ? sum / n : 0;
      }
    }
    return out;
  }

  /* 人物包围盒：只用肩、髋、手腕，够判断「身体占在哪」，不判断姿态好坏 */
  function personBox(lm) {
    if (!lm) return null;
    var idx = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
    var xs = [], ys = [];
    idx.forEach(function (i) {
      var p = lm[i];
      if (p && (p.visibility == null || p.visibility > 0.35)) { xs.push(p.x); ys.push(p.y); }
    });
    if (xs.length < 2) return null;
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var padX = (maxx - minx) * 0.12, padY = (maxy - miny) * 0.10;
    return {
      x: Math.max(0, minx - padX), y: Math.max(0, miny - padY),
      w: Math.min(1, maxx - minx + padX * 2), h: Math.min(1, maxy - miny + padY * 2),
      cx: (minx + maxx) / 2, cy: (miny + maxy) / 2,
      shoulders: [lm[11], lm[12]], hips: [lm[23], lm[24]],
      wrists: [lm[15], lm[16]]
    };
  }

  function vis(p) { return p ? (p.visibility == null ? 1 : p.visibility) : 0; }

  /* 朝向：只分「正面 / 侧面 / 背向 / 看不出」。
     依据是「脸的关键点还看不看得见」+「肩宽有没有被压缩」，
     不说「面向学生」——镜头方向不等于学生方向，这一点在报告里写明。 */
  function facingOf(lm) {
    if (!lm) return { facing: 'unknown', conf: 0 };
    var nose = vis(lm[0]), le = vis(lm[2]), re = vis(lm[5]);
    var ls = vis(lm[11]), rs = vis(lm[12]);
    var shoulderVis = (ls + rs) / 2;
    if (shoulderVis < 0.4) return { facing: 'unknown', conf: shoulderVis };
    var faceVis = (nose * 0.5 + le * 0.25 + re * 0.25);
    if (faceVis > 0.55) return { facing: 'front', conf: faceVis };
    if (nose > 0.45 && (le < 0.35 || re < 0.35)) return { facing: 'profile', conf: nose };
    if (faceVis < 0.30) return { facing: 'back', conf: 1 - faceVis };
    return { facing: 'unknown', conf: faceVis };
  }

  /* ------------------------------------------------------------------ 主流程 */

  function loadVideo(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = 'anonymous';

      /* MediaRecorder 录出来的 webm 常常 duration = Infinity，
         不处理的话后面所有时间都算成 NaN（会写出「1710 秒」这种值）。
         办法：先跳到极大时间点，再跳回来，浏览器就会把真实时长补上。 */
      var fixDuration = function () {
        if (isFinite(v.duration) && v.duration > 0) return Promise.resolve(v.duration);
        return new Promise(function (res) {
          var settled = false;
          var finish = function () {
            if (settled) return;
            settled = true;
            v.removeEventListener('durationchange', finish);
            v.removeEventListener('seeked', finish);
            res(isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
          };
          v.addEventListener('durationchange', finish);
          v.addEventListener('seeked', finish);
          try { v.currentTime = 1e6; } catch (e) { finish(); }
          setTimeout(finish, 1200);
        });
      };

      v.onloadedmetadata = function () {
        fixDuration().then(function (d) {
          var done = function () { resolve({ video: v, url: url, duration: d || v.duration }); };
          if (v.readyState >= 2) return done();
          v.onloadeddata = done;
          try { v.currentTime = Math.min(0.1, (d || 1) / 10); } catch (e) { done(); }
        });
      };
      v.onerror = function () { URL.revokeObjectURL(url); reject(new Error('这个视频解不开（编码不支持或文件损坏）')); };
      v.src = url;
    });
  }

  function seek(video, t) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', finish);
        resolve();
      };
      video.addEventListener('seeked', finish);
      try { video.currentTime = Math.max(0, Math.min(t, (video.duration || 0) - 0.05)); } catch (e) { finish(); }
      setTimeout(finish, 900);
    });
  }

  /* 同一个 <video> 不能并发 seek：多个 Promise.all 一起改 currentTime，
     最后全部落到同一个位置（实测 10/30/90 秒三次都读到 90 秒）。
     所有「取证截图」都排这一条队，按顺序来。 */
  var captureQueue = Promise.resolve();
  function queueCapture(fn) {
    var next = captureQueue.then(fn, fn);
    captureQueue = next.catch(function () {});
    return next;
  }

  /* 精确 seek：等 seeked + 真画出一帧，再回报「实际时间」。
     实际时间跟请求时间差太多（> tol）就重试一次，仍不行标记失败——
     宁可这张图不出，也不给不同时间贴同一个时间码。 */
  function seekExact(video, t, tol) {
    tol = tol || 0.35;
    var target = Math.max(0, Math.min(t, Math.max(0, (video.duration || 0) - 0.08)));
    var attempt = function (left) {
      return new Promise(function (resolve) {
        var done = false;
        var fin = function () {
          if (done) return;
          done = true;
          video.removeEventListener('seeked', fin);
          /* seeked 之后还要等一帧真的解码出来 */
          waitPaint(video).then(function () {
            var actual = video.currentTime;
            var ok = isFinite(actual) && Math.abs(actual - target) <= tol;
            if (!ok && left > 0) { resolve(attempt(left - 1)); return; }
            resolve({ ok: ok, requested: round1(t), actual: round1(actual), mediaTime: round1(actual) });
          });
        };
        video.addEventListener('seeked', fin);
        try { video.currentTime = target; } catch (e) { fin(); }
        setTimeout(fin, 1600);
      });
    };
    return attempt(1);
  }

  /* 串行截图：请求时间 → 实际时间一起返回，调用方必须用 actual 当标签 */
  function captureAt(video, t, w, h, tol) {
    return queueCapture(function () {
      return seekExact(video, t, tol).then(function (info) {
        if (!info.ok) return { ok: false, requested: info.requested, actual: info.actual };
        var c = mkCanvas(w, h);
        return { ok: true, requested: info.requested, actual: info.actual, canvas: c, img: grab(video, c, w, h) };
      });
    });
  }

  function grab(video, canvas, w, h) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  /* seek 之后浏览器解析到「可以画」还有一小段延迟：不等这一下，
     截出来就是上一帧或者一张白图。有 requestVideoFrameCallback 就用它。 */
  function waitPaint(video) {
    return new Promise(function (resolve) {
      var done = false;
      var fin = function () { if (done) return; done = true; resolve(); };
      try {
        if (video.requestVideoFrameCallback) {
          video.requestVideoFrameCallback(function () { setTimeout(fin, 30); });
        }
      } catch (e) { /* noop */ }
      setTimeout(fin, 220);
    });
  }

  function analyze(file, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var signal = opts.signal || { aborted: false };
    var t0 = performance.now();

    var small = mkCanvas(160, 90);
    var poseCanvas = mkCanvas(320, 180);
    var faceCanvas = mkCanvas(256, 256);
    var bigCanvas = mkCanvas(640, 360);

    /* 人脸只占全画面的很小一块，直接拿缩到 320×180 的整帧去检测基本检不到。
       这里按姿态关键点里的鼻尖位置，从原尺寸视频里裁一块头肩区域，再放大到 256×256。 */
    function headCrop(video, lm) {
      if (!lm || !lm[0]) return null;
      var vw = video.videoWidth || 0;
      var vh = video.videoHeight || 0;
      if (!vw || !vh) return null;
      var nose = lm[0];
      var lx = lm[7], rx = lm[8];
      var span = (lx && rx) ? Math.abs(lx.x - rx.x) : 0.08;
      var sizeN = Math.max(span * 2.6, 0.18);         /* 头肩框：约两倍半肩宽（归一化） */
      var size = sizeN * vh;                          /* 归一化 → 像素，按高度换算 */
      var cx = nose.x * vw;
      var cy = (nose.y - 0.02) * vh;
      var wN = size, hN = size * 1.25;
      var x0 = Math.max(0, Math.min(vw - wN, cx - wN / 2));
      var y0 = Math.max(0, Math.min(vh - hN, cy - hN * 0.5));
      var w = Math.min(vw - x0, wN);
      var h = Math.min(vh - y0, hN);
      if (w < 24 || h < 24) return null;
      var ctx = faceCanvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(video, x0, y0, w, h, 0, 0, 256, 256);
      return faceCanvas;
    }

    var result = null;
    var videoUrl = null;

    return loadVideo(file).then(function (pack) {
      var video = pack.video;
      var dur = pack.duration || 0;
      videoUrl = pack.url;

      /* 时长读不出来就别往下算了：后面所有时间点（截图、跳转、行为区间）
         都以它为基础，NaN 会写成「1710 秒」这种一眼假的东西。 */
      if (!isFinite(dur) || dur <= 0) {
        throw new Error('读不出这段视频的时长（编码不受支持或文件损坏），换一个再试。');
      }

      /* 姿态与表情两个模型并行下载；表情装不上不影响其余分析 */
      var faceTask = (App.Face && CFG.face !== false)
        ? App.Face.load(function (p) {
            onProgress({
              phase: 'face-model', ratio: p.ratio,
              text: '表情模型 ' + Math.round(p.ratio * 100) + '%（' + util.bytes(p.loaded) + ' / ' + util.bytes(p.total) + '）'
            });
          }).catch(function () { return false; })
        : Promise.resolve(false);

      return Promise.all([
        App.Pose.load(function (p) {
          onProgress({
            phase: 'model', ratio: p.ratio,
            text: '姿态模型 ' + Math.round(p.ratio * 100) + '%（' + util.bytes(p.loaded) + ' / ' + util.bytes(p.total) + '）'
          });
        }).catch(function () { return false; }),
        faceTask
      ]).then(function (loaded) {
        var poseOk = loaded[0];
        /* 两档采样：标准档按素材长度自适应（长视频稀、短视频密）；
           精细档固定 1 秒 1 帧，手势、快速转身这类瞬时动作才看得见，代价是慢。 */
        var fine = !!(opts && opts.fine);
        var step = fine ? 1 : CFG.baseStep(dur);
        /* 板书区域每多少帧重扫一次：摄像机不动的话，6 秒一次足够 */
        var boardEvery = Math.max(1, Math.round(6 / Math.max(1, step)));
        var boardCanvas = mkCanvas(640, 360);
        var lastReg = null;
        var capBase = fine ? Math.min(CFG.fineMaxFrames, Math.ceil(dur)) : CFG.maxBaseFrames;
        var capFrames = fine ? Math.min(CFG.fineMaxFrames, Math.ceil(dur) + 40) : CFG.maxFrames;
        var baseTimes = [];
        for (var t = 1; t < dur - 1 && baseTimes.length < capBase; t += step) baseTimes.push(t);

        /* 第一遍：低成本采样，只为找出「画面变了」的时刻。
           只有采样很稀（精细档之外的长视频）才值得这么干；3 秒一帧已经很密，
           再补帧的收益抵不上多扫一遍解码的开销，直接跳过。 */
        var prescan = [];
        var chain = Promise.resolve();
        if (step <= 3) {
          onProgress({ phase: 'prescan', ratio: 1, text: '扫描画面（3 秒一帧，跳过预扫描）' });
        } else {
          baseTimes.forEach(function (tt, i) {
            chain = chain.then(function () {
              if (signal.aborted) throw new Error('aborted');
              return seek(video, tt).then(function () {
                var data = grab(video, small, 160, 90).data;
                prescan.push({ t: tt, sig: signature(data, 160, 90) });
                onProgress({ phase: 'prescan', ratio: (i + 1) / baseTimes.length, text: '扫描画面 ' + (i + 1) + '/' + baseTimes.length });
              });
            });
          });
        }

        return chain.then(function () {
          /* 视频模式再建一个 landmarker：帧间靠跟踪，比逐帧重检快得多。
             建失败就保持 null，detectAt 会自己退回逐帧检测。 */
          if (!poseOk || !App.Pose.ensureVideoLandmarker) return null;
          return App.Pose.ensureVideoLandmarker();
        }).then(function () {
          /* 事件加密：画面变化大的前后补采，最多补到 maxFrames。
             没有预扫描（3 秒一帧）时直接用基础时刻表。 */
          var times = prescan.length ? prescan.map(function (f) { return f.t; }) : baseTimes.slice();
          var added = [];
          for (var i = 1; i < prescan.length && times.length < capFrames; i++) {
            if (sigDiff(prescan[i - 1].sig, prescan[i].sig) > CFG.eventSig) {
              var a = prescan[i - 1].t, b = prescan[i].t;
              added.push(util.round1(a + (b - a) / 3), util.round1(a + (b - a) * 2 / 3));
            }
          }
          times = times.concat(added).sort(function (x, y) { return x - y; });
          times = times.filter(function (v, i, arr) { return i === 0 || v - arr[i - 1] > 0.4; })
            .slice(0, capFrames);

          var frames = [];
          /* 逐帧小图池：主循环里顺手存几张（已经画好了，不用再 seek），
             后面挑「仪态有问题那几秒」的截图直接从这里取。 */
          var thumbPool = [];
          var prevSig = null;
          var lastDet = null;
          var lastFaceDet = null;
          /* 双视频轮流预取：一块解码下一帧时，主线程先算完当前帧的姿态/表情。
             同一块 <video> 不能并发 seek，所以用两个元素交替。 */
          var chain2 = (function () {
            var v2 = null;
            var prep = Promise.resolve(false);
            try {
              v2 = document.createElement('video');
              v2.muted = true;
              v2.playsInline = true;
              v2.preload = 'auto';
              v2.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
              document.body.appendChild(v2);
              v2.src = video.src;
              prep = new Promise(function (resolve) {
                var done = false;
                var fin = function (ok) { if (done) return; done = true; resolve(ok); };
                v2.addEventListener('loadedmetadata', function () { fin(true); });
                v2.addEventListener('error', function () { fin(false); });
                setTimeout(function () { fin(v2.readyState >= 1); }, 4000);
                try { v2.load(); } catch (e) { fin(false); }
              });
            } catch (e) {
              v2 = null;
              prep = Promise.resolve(false);
            }

            function cleanupSecond() {
              if (!v2) return;
              try { v2.remove(); } catch (e) { /* noop */ }
              try { v2.src = ''; } catch (e2) { /* noop */ }
              v2 = null;
            }

            /* 只做「seek + 把这一帧画进 canvas」，重活留给 processFrame */
            function capture(v, tt) {
              return seek(v, tt).then(function () {
                var sg = grab(v, small, 160, 90);
                grab(v, poseCanvas, 320, 180);
                var bd = grab(v, boardCanvas, 640, 360).data;
                return { tt: tt, sg: sg, bd: bd, v: v };
              });
            }

            function processFrame(cap, i) {
              var tt = cap.tt;
              var v = cap.v;
              var sig = signature(cap.sg.data, 160, 90);
              var prev2 = prevSig;
              var duplicate = prev2 && sigDiff(prev2, sig) < CFG.dedupeSig;
              var stillScene = !!(prev2 && lastDet && sigDiff(prev2, sig) < CFG.reuseSig);
              prevSig = sig;

              if (i % 2 === 0 && thumbPool.length < 140) {
                var tu = '';
                try { tu = poseCanvas.toDataURL('image/jpeg', 0.62); } catch (e) { tu = ''; }
                if (tu) thumbPool.push({ t: util.round1(tt), img: tu });
              }
              var det;
              if (!poseOk) det = null;
              else if (stillScene) det = lastDet;
              else {
                det = App.Pose.detectAt ? App.Pose.detectAt(poseCanvas, tt * 1000) : App.Pose.detect(poseCanvas);
                lastDet = det;
              }
              var lm = det && det.landmarks ? det.landmarks : null;
              /* 面部动作：从原始尺寸里裁出头部区域再跑 face landmarker。
                 没有关键点时退回整帧缩小图，宁可漏检也不硬凑。 */
              var faceDet = null;
              if (App.Face && App.Face.state === 'ready') {
                var faceDue = (i % CFG.faceStride === 0) || !lastFaceDet;
                if (!faceDue && lastFaceDet) faceDet = lastFaceDet;
                else {
                  var crop = lm ? headCrop(v, lm) : null;
                  faceDet = App.Face.detect(crop || poseCanvas);
                  lastFaceDet = faceDet;
                }
              }
              var f = {
                frameId: 'f' + (frames.length + 1),
                t: util.round1(tt),
                sig: sig,
                width: v.videoWidth,
                height: v.videoHeight,
                source: 'video',
                poseOk: !!(det && det.landmarks),
                facing: 'unknown',
                facingConf: 0,
                box: null,
                sharp: 0,
                duplicate: !!duplicate,
                faceOk: !!(faceDet && faceDet.present),
                blends: (faceDet && faceDet.blends) ? faceDet.blends : null
              };
              if (lm) {
                var fc = facingOf(lm);
                f.facing = fc.facing;
                f.facingConf = util.round1(fc.conf * 100) / 100;
                f.box = personBox(lm);
                f.landmarks = lm;
              }
              /* 板书区域就地算：这一遍已经 seek 到这一帧了，再单独跑一遍只会重复解码。
                 区域每 N 帧扫一次、中间沿用，清晰度与板面签名每帧都算（便宜且要用于排序）。 */
              var bd = cap.bd;
              if (i % boardEvery === 0 || !lastReg) {
                lastReg = boardRegion(bd, 640, 360, f.box ? { x: f.box.x, y: f.box.y, w: f.box.w, h: f.box.h } : null) || lastReg;
              }
              if (lastReg) {
                f.boardRegion = lastReg.rect;
                f.boardPolarity = lastReg.polarity;
                f.boardCoverage = lastReg.coverage;
                f.boardInk = lastReg.inkRatio;
                f.boardGlare = lastReg.glareRatio;
                f.boardConfidence = lastReg.confidence;
                f.boardQuality = lastReg.quality;
                f.boardOcclusion = f.box ? Math.round(overlapArea(f.box, lastReg.rect) * 100) / 100 : 0;
                f.boardSig = regionSignature(bd, 640, 360, lastReg.rect);
                f.sharp = sharpness(bd, 640, 360, lastReg.rect);
              }
              frames.push(f);
              onProgress({ phase: 'frames', ratio: (i + 1) / times.length, text: '分析第 ' + (i + 1) + '/' + times.length + ' 帧' });
            }

            return prep.then(function (ok) {
              if (!ok) cleanupSecond();
              /* 没有第二块视频时只能串行：千万别对同一块视频提前 seek，
                 否则 processFrame 里的头肩裁剪会读到下一帧。 */
              if (!v2) {
                return (async function () {
                  for (var i = 0; i < times.length; i++) {
                    var cap = await capture(video, times[i]);
                    if (signal.aborted) throw new Error('aborted');
                    processFrame(cap, i);
                    await new Promise(function (res) { setTimeout(res, 0); });
                  }
                })();
              }

              var vids = [video, v2];
              var pending = capture(vids[0], times[0]);

              return (async function () {
                for (var i = 0; i < times.length; i++) {
                  var cap = await pending;
                  if (signal.aborted) throw new Error('aborted');
                  var nextP = null;
                  if (i + 1 < times.length) {
                    nextP = capture(vids[(i + 1) % vids.length], times[i + 1]);
                  }
                  processFrame(cap, i);
                  /* 每帧让出一次事件循环：否则连续推理会把主线程占满，进度条和遮罩都不动 */
                  await new Promise(function (res) { setTimeout(res, 0); });
                  pending = nextP;
                }
              })().then(function () {
                cleanupSecond();
              }, function (e) {
                cleanupSecond();
                throw e;
              });
            });
          })();
          return chain2.then(function () {
            /* 表情单独一遍：只有精细档（1 秒 1 帧）或采样比 3 秒更稀的时候才需要。
               标准档已经统一 3 秒一帧，主采样里每帧都跑过 face landmarker，再跑一遍纯属浪费。 */
            if (!(App.Face && App.Face.state === 'ready')) return null;
            if (!fine) return null;
            var faceStep = Math.max(2, Math.min(15, dur / 200));
            var faceTimes = [];
            for (var ft = 0; ft < dur; ft += faceStep) faceTimes.push(util.round1(ft));
            if (faceTimes.length > 240) {
              var keep = 240 / faceTimes.length;
              faceTimes = faceTimes.filter(function (v, i) { return i === 0 || Math.floor(i * keep) !== Math.floor((i - 1) * keep); });
            }
            var faceFrames = [];
            var chain3 = Promise.resolve();
            faceTimes.forEach(function (tt, i) {
              chain3 = chain3.then(function () {
                if (signal.aborted) throw new Error('aborted');
                return seek(video, tt).then(function () {
                  grab(video, poseCanvas, 320, 180);
                  var det = poseOk ? App.Pose.detect(poseCanvas) : null;
                  var lm = det && det.landmarks ? det.landmarks : null;
                  var crop = lm ? headCrop(video, lm) : null;
                  var fd = App.Face.detect(crop || poseCanvas);
                  faceFrames.push({
                    t: util.round1(tt),
                    present: !!(fd && fd.present),
                    blends: (fd && fd.blends) || null
                  });
                  onProgress({ phase: 'face', ratio: (i + 1) / faceTimes.length, text: '看表情 ' + (i + 1) + '/' + faceTimes.length });
                });
              });
            });
            return chain3.then(function () {
              return { frames: faceFrames, step: faceStep };
            });
          }).then(function (facePack) {
            /* 仪态出问题的那几个时刻，各截一张小图放进报告：
               用户要的是「看见那几秒到底是什么样」，不是只看一个百分比。 */
            var probe = (App.MetricsPose && frames.length)
              ? App.MetricsPose.analyze(frames, { step: step }) : null;
            /* 表情那一路单独算一遍，用来挑「表情几乎不变」「视线长时间朝下」的时刻。
               标准档不再单独跑表情采样，就退回主采样帧里的面部结果。 */
            var fFrames = (facePack && facePack.frames && facePack.frames.length) ? facePack.frames : frames.map(function (fr) {
              return { t: fr.t, present: !!fr.faceOk, blends: fr.blends || null };
            });
            var faceMeta = (App.MetricsFace && fFrames.length)
              ? App.MetricsFace.analyze(fFrames, { step: (facePack && facePack.step) || step }) : null;
            var marks = [];
            if (probe) {
              /* 只截「整段背对」：写板书时转身、侧身写字是正常教态，不当作问题 */
              (probe.sideRuns || []).forEach(function (r) {
                if (r.dur >= 10) marks.push({ at: r.from + Math.min(1, r.dur / 2), dur: r.dur, domain: 'posture', reason: '整段背对 ' + Math.round(r.dur) + ' 秒' });
              });
              (probe.downRuns || []).forEach(function (r) {
                if (r.dur >= 1) marks.push({ at: r.from + Math.min(1, r.dur / 2), dur: r.dur, domain: 'posture', reason: '低头看稿 ' + Math.round(r.dur) + ' 秒' });
              });
              (probe.armsRuns || []).forEach(function (r) {
                if (r.dur >= 3) marks.push({ at: r.from + Math.min(1, r.dur / 2), dur: r.dur, domain: 'posture', reason: '抱臂／插手 ' + Math.round(r.dur) + ' 秒' });
              });
            }
            var faceRuns = (faceMeta && faceMeta.longRuns) || [];
            faceRuns.forEach(function (r) {
              if (r.dur >= 6) marks.push({ at: r.from + Math.min(1, r.dur / 2), dur: r.dur, domain: 'face', reason: '表情几乎不变 ' + Math.round(r.dur) + ' 秒' });
            });
            ((faceMeta && faceMeta.downRuns) || []).forEach(function (r) {
              if (r.dur >= 6) marks.push({ at: r.from + Math.min(1, r.dur / 2), dur: r.dur, domain: 'face', reason: '视线朝下 ' + Math.round(r.dur) + ' 秒' });
            });
            marks.sort(function (a, b) { return a.at - b.at; });
            marks = marks.slice(0, 12);

            var nearThumb = function (sec) {
              var best = null, bestD = Infinity;
              for (var k = 0; k < thumbPool.length; k++) {
                var dd2 = Math.abs(thumbPool[k].t - sec);
                if (dd2 < bestD) { bestD = dd2; best = thumbPool[k]; }
              }
              return (best && bestD <= Math.max(4, step * 1.5)) ? best : null;
            };
            /* 一张一张来：同一时刻的 video 同时 seek 会互相覆盖，
               这里既用缩略图（不 seek），也走串行截图队列 */
            var seq = Promise.resolve([]);
            marks.forEach(function (mk) {
              seq = seq.then(function (acc) {
                var hit = nearThumb(mk.at);
                if (hit) {
                  /* 缩略图是附近帧，标签必须用图片自己的时间，事件时间另存 */
                  acc.push({
                    at: hit.t != null ? hit.t : util.round1(mk.at),
                    requested: util.round1(mk.at),
                    eventAt: util.round1(mk.at),
                    timeSource: 'thumb',
                    dur: mk.dur, domain: mk.domain, reason: mk.reason, img: hit.img
                  });
                  return acc;
                }
                return captureAt(video, mk.at, 320, 180).then(function (cap) {
                  if (!cap.ok) return acc;   /* 取不到就宁可不出图，也不贴错时间 */
                  var url = '';
                  try { url = cap.canvas.toDataURL('image/jpeg', 0.72); } catch (e) { url = ''; }
                  acc.push({
                    at: cap.actual, requested: cap.requested, eventAt: util.round1(mk.at),
                    timeSource: 'seek', dur: mk.dur, domain: mk.domain, reason: mk.reason, img: url
                  });
                  return acc;
                });
              });
            });
            return seq.then(function (shots) {
              return finish(video, frames, dur, {
          poseOk: poseOk, signal: signal, onProgress: onProgress, t0: t0,
          sampleMode: fine ? 'fine' : 'standard', sampleStep: step,
          faceFrames: facePack && facePack.frames, faceStep: facePack && facePack.step,
          problemShots: shots.filter(function (s) { return !!s.img && s.domain !== 'face'; }),
          faceShots: shots.filter(function (s) { return !!s.img && s.domain === 'face'; })
        });
            });
          });
        });
      });
    }).then(function (r) {
      result = r;
      try { URL.revokeObjectURL(videoUrl); } catch (e) { /* noop */ }
      return r;
    }).catch(function (e) {
      try { URL.revokeObjectURL(videoUrl); } catch (e2) { /* noop */ }
      if (result) return result;
      throw e;
    });
  }

  /* 第二段：板书区域、遮挡、阶段、行为证据、覆盖率 */
  function finish(video, frames, dur, opt) {
    var withPose = frames.filter(function (f) { return f.poseOk; });
    var poseRate = frames.length ? withPose.length / frames.length : 0;

    /* 板书：逐帧数据在采样那一遍就算好了（那里本来就 seek 到了每一帧），
       这里只负责「挑出最合适的一帧」并报进度，不再重复解码第二遍。 */
    var best = null;
    var chain = Promise.resolve();
    frames.forEach(function (f, i) {
      chain = chain.then(function () {
        if (opt.signal.aborted) throw new Error('aborted');
        if (f.boardRegion) {
          /* 候选帧排序：置信度高、没被挡住、画面够锐。
             只看置信度会挑到「框得很大但正好糊掉」的那一帧（实测 t=46 清晰度只有 35，
             而 t=33 有 98），审阅时板面看着更差，所以把锐度也算进去。 */
          var candScore = f.boardConfidence - (f.boardOcclusion || 0) * 0.45 + Math.min(f.sharp || 0, 200) / 400;
          if (!best || candScore > best.candScore) {
            best = {
              candScore: candScore,
              coverage: f.boardCoverage, confidence: f.boardConfidence, t: f.t, frameId: f.frameId,
              rect: f.boardRegion, polarity: f.boardPolarity, ink: f.boardInk, glare: f.boardGlare,
              quality: f.boardQuality, fill: f.boardFill, aspect: f.boardAspect, occlusion: f.boardOcclusion
            };
          }
        }
        opt.onProgress({ phase: 'board', ratio: (i + 1) / frames.length, text: '定位板书 ' + (i + 1) + '/' + frames.length });
        return null;
      });
    });

    return chain.then(function () {
      /* 板面裁剪图：给报告与 AI 看的那张，按原始分辨率截，不缩放成不可读。
         注意：必须先把视频 seek 到 best.t —— 上一轮循环停在最后一帧，
         直接 drawImage 会把「A 帧的框」套在「B 帧的画面上」，裁出来的板面是错的。 */
      var crop = null;
      var boardUrl = null;
      var overlayUrl = null;
      var prep = Promise.resolve();
      if (best) {
        prep = seek(video, best.t).then(function () {
          var vw = video.videoWidth, vh = video.videoHeight;
          var sx = Math.round(best.rect.x * vw), sy = Math.round(best.rect.y * vh);
          var bw = Math.max(1, Math.round(best.rect.w * vw));
          var bh = Math.max(1, Math.round(best.rect.h * vh));

          /* 原始帧 + 检测框：报告里必须能看到「框在哪」，否则无法判断定位对不对 */
          var ow = 720;
          var oscale = Math.min(1, ow / Math.max(1, vw));
          var oc = mkCanvas(Math.round(vw * oscale), Math.round(vh * oscale));
          var octx = oc.getContext('2d');
          octx.drawImage(video, 0, 0, oc.width, oc.height);
          octx.strokeStyle = 'rgba(10,132,255,.95)';
          octx.lineWidth = Math.max(2, Math.round(oc.width / 360));
          octx.strokeRect(
            best.rect.x * oc.width, best.rect.y * oc.height,
            best.rect.w * oc.width, best.rect.h * oc.height
          );
          overlayUrl = oc.toDataURL('image/jpeg', 0.82);

          var scale = Math.min(1, 1280 / bw);
          var c = mkCanvas(Math.max(1, Math.round(bw * scale)), Math.max(1, Math.round(bh * scale)));
          var ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, sx, sy, bw, bh, 0, 0, c.width, c.height);
          boardUrl = c.toDataURL('image/jpeg', 0.86);
          /* 标准化后再算一次清晰度：这一张才是真正拿去辨认的 */
          var d2 = ctx.getImageData(0, 0, c.width, c.height);
          var sp = sharpness(d2.data, c.width, c.height, null);
          crop = {
            width: c.width, height: c.height,
            sourceWidth: bw, sourceHeight: bh,
            sharpness: util.round1(sp),
            src: { x: best.rect.x, y: best.rect.y, w: best.rect.w, h: best.rect.h },
            t: best.t, frameId: best.frameId, polarity: best.polarity,
            inkRatio: util.round1(best.ink * 1000) / 1000,
            glareRatio: util.round1(best.glare * 1000) / 1000,
            confidence: best.confidence
          };
          /* 板书几何八项：直接从这张裁剪图算，不经过模型。
             配了 OCR 就先拿真字符框——字距/字号只认框，不认连通域猜。 */
          if (App.MetricsBoard) {
            try {
              crop.metrics = App.MetricsBoard.analyze(d2, { occlusion: best.occlusion || 0 });
              crop.metrics.points = App.MetricsBoard.points(crop.metrics);
            } catch (e) {
              crop.metrics = { available: false, reason: '板书几何算不出来：' + (e && e.message), metrics: [] };
            }
          }
          var wantText = !!(App.settings && App.settings.data && String(App.settings.data.boardPoints || '').trim());
          if (App.Ocr && App.Ocr.enabled() && wantText && crop.metrics && crop.metrics.available) {
            /* OCR 超时必须放行：识别引擎冷启动要下 14MB，慢的时候能把整个分析卡住好几分钟 */
            var ocrTimeout = new Promise(function (res) {
              setTimeout(function () { res({ ok: false, boxes: [], text: '', error: 'timeout' }); }, (CFG.ocrTimeoutSec || 45) * 1000);
            });
            return Promise.race([App.Ocr.boxes(c), ocrTimeout]).then(function (ocr) {
              crop.ocr = { ok: !!ocr.ok, source: ocr.source, count: (ocr.boxes || []).length, ms: ocr.ms || 0, error: ocr.error || '', text: ocr.text || '' };
              if (ocr.ok && ocr.boxes.length >= 3) {
                try {
                  var withBoxes = App.MetricsBoard.analyze(d2, { occlusion: best.occlusion || 0, boxes: ocr.boxes });
                  withBoxes.ocr = crop.ocr;
                  withBoxes.points = App.MetricsBoard.points(withBoxes);
                  crop.metrics = withBoxes;
                } catch (e2) { /* 字符框有问题就保留估算结果 */ }
              }
            }).catch(function () { /* OCR 失败不影响几何估算 */ });
          }
        });
      }

      /* 板书那一组画面：按时间均匀挑最多 6 个「系统确实定位到板面」的时刻，
         每张都带时间码和当时的可读性判断，用来对照「哪一帧看不清」。 */
      /* 板书证据：既给「板面各阶段」的样张，也给「这一帧哪里有问题」的局部证据。
         每个问题都带整帧、板面裁剪、红框（挡板处）和一句原因，时间码可跳。 */
﻿      function boardEvidence() {
        var pool = frames.filter(function (f) { return f.boardRegion && f.boardRegion.w > 0.05; });
        if (!pool.length) return Promise.resolve({ shots: [], issues: [] });
        var want = Math.min(8, pool.length);
        var picks = [];
        for (var k = 0; k < want; k++) picks.push(pool[Math.round(k * (pool.length - 1) / Math.max(1, want - 1))]);
        var vw = video.videoWidth, vh = video.videoHeight;
        var out = [];

        /* 串行取证：一张一张 seek，拿到「实际时间」再画，画完再取下一张。
           同一个 video 并发 seek 会互相覆盖，最后几张全是同一帧。 */
        var chain = picks.reduce(function (prev, f) {
          return prev.then(function () {
            return captureAt(video, f.t, vw, vh).then(function (cap) {
              if (!cap.ok) return;                 /* 取不到就宁可不出图，也不贴错时间 */
              var r = f.boardRegion;
              var w = 360, h = Math.max(120, Math.round(360 * (r.h * vh) / Math.max(1, r.w * vw)));
              var c = mkCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
              var cropUrl = '', fullUrl = '', issue = null, box = null, boxFull = null;
              var sharp = 0, glare = 0;
              try {
                /* 从「已验证时间的那一帧」裁板面，而不是从 live video 再画一次 */
                ctx.drawImage(cap.canvas, r.x * vw, r.y * vh, r.w * vw, r.h * vh, 0, 0, w, h);
                var img = ctx.getImageData(0, 0, w, h);
                var n = 0;
                for (var i = 0; i < img.data.length; i += 4) {
                  var lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
                  if (lum > 240) glare++;
                  n++;
                }
                try { sharp = sharpness(img.data, w, h, { x: 0, y: 0, w: w, h: h }); } catch (e) { sharp = 0; }
                glare = n ? glare / n : 0;

                /* 遮挡：人体框 ∩ 板面框（都是归一化坐标）→ 板面局部像素框 */
                if (f.occludesBoard && f.box) {
                  var ix = Math.max(r.x, f.box.x), iy = Math.max(r.y, f.box.y);
                  var ix2 = Math.min(r.x + r.w, f.box.x + f.box.w), iy2 = Math.min(r.y + r.h, f.box.y + f.box.h);
                  if (ix2 > ix && iy2 > iy) {
                    box = {
                      x: Math.round((ix - r.x) / r.w * w), y: Math.round((iy - r.y) / r.h * h),
                      w: Math.max(6, Math.round((ix2 - ix) / r.w * w)), h: Math.max(6, Math.round((iy2 - iy) / r.h * h))
                    };
                    /* 整帧红框：先把局部框换回原视频像素，再缩到 320 宽的显示图 */
                    var sx = vw / 320, sy = vh / 180;
                    boxFull = {
                      x: Math.round((r.x * vw + box.x * (r.w * vw) / w) / sx),
                      y: Math.round((r.y * vh + box.y * (r.h * vh) / h) / sy),
                      w: Math.max(4, Math.round((box.w * (r.w * vw) / w) / sx)),
                      h: Math.max(4, Math.round((box.h * (r.h * vh) / h) / sy))
                    };
                    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 3;
                    ctx.strokeRect(box.x, box.y, box.w, box.h);
                    issue = {
                      kind: 'occlusion',
                      reason: '人挡在板面前（挡住了 ' + Math.round(Math.min(1, (box.w * box.h) / (w * h)) * 100) + '% 的板面）'
                    };
                  }
                }
                /* 反光只对深色板有意义：白板/投影本来就亮，不能凭「像素白」判反光 */
                var darkBoard = !(f.boardPolarity === 'light' || f.boardPolarity === 'white');
                if (!issue && darkBoard && glare > 0.35) {
                  issue = { kind: 'glare', reason: '板面反光（' + Math.round(glare * 100) + '% 的像素接近纯白，这里字看不清）' };
                }
                if (!issue && sharp < 45) {
                  issue = { kind: 'blur', reason: '这一帧板面发虚（清晰度 ' + Math.round(sharp) + '，字迹边缘糊）' };
                }

                cropUrl = c.toDataURL('image/jpeg', 0.7);
                var fc = mkCanvas(320, 180), fctx = fc.getContext('2d');
                fctx.drawImage(cap.canvas, 0, 0, 320, 180);
                if (boxFull) {
                  fctx.strokeStyle = '#ff3b30'; fctx.lineWidth = 2;
                  fctx.strokeRect(boxFull.x, boxFull.y, boxFull.w, boxFull.h);
                }
                fullUrl = fc.toDataURL('image/jpeg', 0.7);
              } catch (e) { cropUrl = ''; }

              out.push({
                at: cap.actual, requested: cap.requested, eventAt: util.round1(f.t),
                timeSource: 'seek', frameId: f.frameId, img: cropUrl, full: fullUrl,
                box: box, boxFull: boxFull, issue: issue, sharp: Math.round(sharp)
              });
            });
          });
        }, Promise.resolve());

        return chain.then(function () {
          var ok = out.filter(function (s) { return !!s.img; });
          var shots = ok.slice(0, 6).map(function (s) { return { at: s.at, requested: s.requested, timeSource: s.timeSource, img: s.img }; });
          var issues = ok.filter(function (s) { return !!s.issue; }).slice(0, 6).map(function (s) {
            return {
              at: s.at, frameId: s.frameId, kind: s.issue.kind, reason: s.issue.reason,
              img: s.img, full: s.full, box: s.box, boxFull: s.boxFull, hasLocalBox: !!s.box
            };
          });
          /* 画面本身没问题、但排版有毛病时也要有证据：拿离「最佳板面」最近的那一帧当底图 */
          var m = crop && crop.metrics;
          if (m && m.available && issues.length < 4 && ok.length) {
            var base = ok[0];
            if (best && best.t != null) {
              var near = ok.slice().sort(function (a, b) { return Math.abs(a.at - best.t) - Math.abs(b.at - best.t); })[0];
              if (near) base = near;
            }
            var lay = [], utilPct = (m.utility && m.utility.pct != null) ? m.utility.pct : (typeof m.utility === 'number' ? m.utility : null);
            var resPct = (m.residue && m.residue.pct != null) ? m.residue.pct : (typeof m.residue === 'number' ? m.residue : null);
            if (m.chars && m.chars.sizePx && m.chars.sizePx < 10) lay.push({ reason: '字太小：字高只有 ' + Math.round(m.chars.sizePx) + ' 像素（建议 ≥10 像素）' });
            if (utilPct != null && utilPct < 8) lay.push({ reason: '板面用得太少：只占 ' + utilPct + '%（建议 ≥8%）' });
            if (resPct != null && resPct > 45) lay.push({ reason: '擦除残留多：' + resPct + '% 的板面是没擦干净的粉笔灰' });
            var cv = (m.rows && m.rows.pitchCv) || 0;
            if (cv > 0.32) lay.push({ reason: '行距不匀：相邻行间距的变异系数 ' + cv.toFixed(2) + '（建议 ≤0.32）' });
            var gcv = (m.chars && m.chars.gapCv) || 0;
            if (gcv > 0.32) lay.push({ reason: '字距不匀：字符间隙的变异系数 ' + gcv.toFixed(2) + '（建议 ≤0.32）' });
            lay.slice(0, Math.max(0, 4 - issues.length)).forEach(function (x) {
              issues.push({
                at: base.at, frameId: base.frameId, kind: 'layout', reason: x.reason,
                img: base.img, full: base.full, box: null, boxFull: null, hasLocalBox: false
              });
            });
          }
          return { shots: shots, issues: issues.slice(0, 6) };
        });
      }

      return prep.then(function () {

      /* 可读性判定：每一类失败都要分开说，不能笼统写成「未评估」。
         顺序按用户的验收要求：分辨率 → 模糊 → 反光 → 空板 → 遮挡。 */
      var readability = { ok: null, reasons: [], metrics: null };
      if (crop) {
        var rsn = [];
        var occ = best.occlusion || 0;
        if (crop.sourceWidth < 480) {
          rsn.push({ key: 'lowres', text: '视频分辨率不足（板面只有 ' + crop.sourceWidth + ' 像素宽）' });
        }
        if (crop.sharpness < 30) {
          rsn.push({ key: 'blur', text: '板面模糊（清晰度 ' + crop.sharpness + '，字迹边缘发虚）' });
        }
        if (crop.glareRatio > 0.20) {
          rsn.push({ key: 'glare', text: '反光遮挡（' + Math.round(crop.glareRatio * 100) + '% 的板面像素过曝）' });
        }
        if (crop.inkRatio < 0.008) {
          rsn.push({ key: 'empty', text: '板面上几乎没有笔画（墨迹 ' + (crop.inkRatio * 100).toFixed(2) + '%）' });
        }
        if (occ > 0.35) {
          rsn.push({ key: 'occluded', text: '人物遮挡了 ' + Math.round(occ * 100) + '% 的板面' });
        }
        readability = {
          ok: rsn.length === 0,
          reasons: rsn,
          sharpness: crop.sharpness,
          occlusion: occ,
          metrics: {
            width: crop.sourceWidth, height: crop.sourceHeight,
            sharpness: crop.sharpness, inkRatio: crop.inkRatio,
            glareRatio: crop.glareRatio, occlusion: occ,
            confidence: best.confidence, polarity: best.polarity
          }
        };
      }

      /* 先算遮挡，再定阶段：写板书时人挡着板是正常的，讲解时挡着才是问题 */
      frames.forEach(function (f) {
        f.occludesBoard = !!(f.box && f.boardRegion && overlapArea(f.box, f.boardRegion) > 0.35);
      });

      /* 阶段：写板书（板面在变 + 人转向板面）/ 讲解（板面没变）/ 过渡 */
      for (var i = 0; i < frames.length; i++) {
        var f = frames[i];
        var prev = frames[i - 1];
        var boardChanged = false;
        if (prev && f.boardSig && prev.boardSig) {
          boardChanged = sigDiff(prev.boardSig, f.boardSig) > 0.012;
        }
        var back = f.facing === 'back';
        if (boardChanged && back) f.phase = 'write';
        else if (boardChanged) f.phase = 'transition';
        else if (back) f.phase = 'back';
        else f.phase = 'talk';
        f.boardChanged = boardChanged;
      }

      /* 连续段：同阶段、相邻帧间隔不超过「典型间隔 × 1.8」就并成一段 */
      var gaps = [];
      for (var gi = 1; gi < frames.length; gi++) gaps.push(frames[gi].t - frames[gi - 1].t);
      gaps.sort(function (a, b) { return a - b; });
      var step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
      var tol = Math.max(2.5, step * 1.8);

      var runs = [];
      frames.forEach(function (fr, fi) {
        var last = runs[runs.length - 1];
        if (last && last.kind === fr.phase && (fr.t - last.end) <= tol) {
          last.end = fr.t;
          last.frames++;
          last.occluding = last.occluding || fr.occludesBoard;
        } else {
          runs.push({ kind: fr.phase, start: fr.t, end: fr.t, frames: 1, occluding: !!fr.occludesBoard });
        }
      });

      var behaviors = buildBehaviors(frames, runs, dur, step);

      var covered = frames.length ? (frames[frames.length - 1].t - frames[0].t) : 0;
      var coverage = {
        samples: frames.length,
        poseSamples: withPose.length,
        poseRate: util.round1(poseRate * 100) / 100,
        sampleCoverage: dur ? util.round1(covered / dur * 100) / 100 : 0,
        from: frames.length ? frames[0].t : 0,
        to: frames.length ? frames[frames.length - 1].t : 0,
        step: Math.round(step * 10) / 10,
        maxGap: frames.length > 1 ? Math.round(Math.max.apply(null, gaps) * 10) / 10 : null
      };

      /* 缩略图：整场大约每 30 秒一张，外加每个行为证据的首帧，最多 24 张。
         320 宽 JPEG：够看清人在做什么、板面上有没有字，又不至于把内存吃满。 */
      var every = opt.shotEvery || 30;
      var picked = [];
      frames.forEach(function (f) {
        if (f.duplicate) return;
        if (!picked.length || f.t - picked[picked.length - 1].t >= every) picked.push(f);
      });
      behaviors.forEach(function (b) {
        var f = null;
        for (var k = 0; k < frames.length; k++) { if (frames[k].t >= b.from) { f = frames[k]; break; } }
        if (!f) return;
        var clash = picked.some(function (p) { return p === f || Math.abs(p.t - f.t) < 8; });
        if (!clash) picked.push(f);
      });
      picked.sort(function (a, b) { return a.t - b.t; });
      picked = picked.slice(0, 24);

      var thumbChain = Promise.resolve();
      picked.forEach(function (f) {
        thumbChain = thumbChain.then(function () {
          if (opt.signal.aborted) throw new Error('aborted');
          return seek(video, f.t).then(function () {
            var sw = video.videoWidth, sh = video.videoHeight;
            var scale = Math.min(1, 320 / Math.max(1, sw));
            var c = mkCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
            c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
            f.thumb = c.toDataURL('image/jpeg', 0.62);
            opt.onProgress({ phase: 'thumbs', ratio: (picked.indexOf(f) + 1) / picked.length, text: '截图 ' + (picked.indexOf(f) + 1) + '/' + picked.length });
          });
        });
      });

      return thumbChain.then(function () {
        return boardEvidence().then(function (bd) {
          var bShots = bd.shots;
        return {
          duration: dur,
          video: {
            width: video.videoWidth,
            height: video.videoHeight,
            duration: Math.round(dur * 10) / 10,
            decoded: true
          },
          frames: frames.map(function (fr) {
            /* 关键点太占地方，报告用不到原始 33 点，只留判据 */
            return {
              frameId: fr.frameId, t: fr.t, facing: fr.facing, facingConf: fr.facingConf,
              phase: fr.phase, occludesBoard: !!fr.occludesBoard, duplicate: !!fr.duplicate,
              boardCoverage: fr.boardCoverage || 0, boardRegion: fr.boardRegion || null,
              polarity: fr.boardPolarity || null, boardChanged: !!fr.boardChanged,
              hasPose: !!fr.poseOk, thumb: fr.thumb || null
            };
          }),
          shots: picked.map(function (fr) {
            return {
              frameId: fr.frameId, t: fr.t, img: fr.thumb || null,
              face: !!fr.poseOk, facing: fr.facing, phase: fr.phase,
              board: util.round1((fr.boardCoverage || 0) * 100) / 100,
              polarity: fr.boardPolarity || null,
              kind: fr.phase === 'write' ? 'board'
                : (fr.facing === 'front' ? 'face' : fr.facing === 'back' ? 'other' : 'both')
            };
          }),
          runs: runs,
          phases: runs,
          behaviors: behaviors,
          board: {
            shots: bShots,
            issues: bd.issues || [],
            found: !!best,
            crop: crop,
            dataUrl: boardUrl,
            overlay: overlayUrl,
            at: best ? Math.round(best.t) : null,
            frameId: best ? best.frameId : null,
            coverage: best ? util.round1(best.coverage * 100) / 100 : null,
            confidence: best ? best.confidence : null,
            polarity: best ? best.polarity : null,
            quality: best && best.quality ? best.quality : [],
            readability: readability,
            reason: !best
              ? '未定位到可读板面（画面里没有同时满足「平整、成片、有笔画」的区域）'
              : (readability.ok === false ? readability.reasons.map(function (r) { return r.text; }).join('；') : '')
          },
          coverage: coverage,
          pose: {
            available: !!opt.poseOk,
            model: App.Pose.META,
            reason: opt.poseOk ? '' : (App.Pose.failReason || '姿态模型没加载成功'),
            rate: coverage.poseRate
          },
          /* 仪态八项：用抽帧时的完整关键点序列算完就地瘦身，报告只拿指标与曲线 */
          sampling: {
            mode: opt.sampleMode || 'standard',
            step: util.round1(opt.sampleStep || step),
            frames: frames.length,
            /* pts_ms：每帧相对视频起点的毫秒数，报告与外部工具都按这个对时间 */
            ptsMs: frames.map(function (f) { return Math.round(f.t * 1000); })
          },
          posture: (function () {
            if (!(App.MetricsPose && frames.length)) return null;
            var po = withPosePoints(App.MetricsPose.analyze(frames, { step: opt.sampleStep || step }));
            /* 出问题的那几秒各自的截图：报告里整排铺出来 */
            if (po && opt.problemShots && opt.problemShots.length) po.problemShots = opt.problemShots;
            return po;
          })(),
          /* 表情：只用可观测的面部动作分值，不推断情绪。
             优先用专门那遍表情采样（密度高），没有再退回主采样帧。 */
          face: (function () {
            if (!(App.MetricsFace && frames.length)) return null;
            var fm = withFacePoints(App.MetricsFace.analyze(
              (opt.faceFrames && opt.faceFrames.length) ? opt.faceFrames : frames.map(function (f) {
                return { t: f.t, present: !!f.faceOk, blends: f.blends || null };
              }),
              { step: (opt.faceFrames && opt.faceFrames.length) ? opt.faceStep : (opt.sampleStep || step) }));
            if (fm && opt.faceShots && opt.faceShots.length) fm.problemShots = opt.faceShots;
            return fm;
          })(),
          elapsedMs: Math.round(performance.now() - opt.t0)
        };
        });
        });
      });
    });
  }

  /* 评分点：仪态/表情各 8 项，报告里逐项列出来 */
  function withPosePoints(p) {
    if (!p) return p;
    try { if (App.MetricsPose && App.MetricsPose.points) p.points = App.MetricsPose.points(p); } catch (e) { /* 不影响主流程 */ }
    return p;
  }
  function withFacePoints(f) {
    if (!f) return f;
    try { if (App.MetricsFace && App.MetricsFace.points) f.points = App.MetricsFace.points(f); } catch (e) { /* 不影响主流程 */ }
    return f;
  }

  function intersect(a, b) {
    var x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    var y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (x * y) / Math.max(0.0001, Math.min(a.w * a.h, b.w * b.h));
  }

  function overlapArea(a, b) {
    var x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    var y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (x * y) / Math.max(0.0001, b.w * b.h);
  }

  /* ---------------------------------------------------------------- 行为证据 */

  function buildBehaviors(frames, runs, dur, step) {
    var g = CFG.gates;
    var out = [];
    var samples = frames.length;
    var dynamicOk = samples >= g.minSamplesForDynamic;

    /* 1) 持续背向镜头（不是「转身写板书」——写板书阶段单独排除） */
    if (dynamicOk) {
      var run = null;
      frames.forEach(function (f) {
        var back = f.facing === 'back' && f.phase !== 'write';
        if (back) {
          if (!run) run = { from: f.t, to: f.t, frames: 1 };
          else { run.to = f.t; run.frames++; }
        } else if (run) {
          pushBackRun(run); run = null;
        }
      });
      if (run) pushBackRun(run);

      function pushBackRun(r) {
        var sec = r.to - r.from;
        if (sec >= g.backRun.minSec && r.frames >= g.backRun.minFrames) {
          out.push({
            key: 'back_turned',
            kind: 'issue',
            severity: 'mid',
            from: r.from, to: r.to, seconds: Math.round(sec),
            title: '背对镜头讲解 ' + Math.round(sec) + ' 秒',
            detail: '这段时间里脸部的关键点基本看不到、肩膀还在画面里，画面上的姿态是背对镜头，并且板面没有在变（不是在写板书）。' +
              '如果镜头方向就是学生方向，这等于学生看不到你的表情与口型；如果镜头只是侧面机位，这条不算问题——报告里只能按拍到的画面说。',
            frames: framesIn(r.from, r.to)
          });
        }
      }
    }

    /* 2) 讲解时身体压住板书（有连续证据才算） */
    if (dynamicOk) {
      var orun = null;
      frames.forEach(function (f) {
        var hit = f.occludesBoard && (f.phase === 'talk' || f.phase === 'transition');
        if (hit) {
          if (!orun) orun = { from: f.t, to: f.t, frames: 1 };
          else { orun.to = f.t; orun.frames++; }
        } else if (orun) { pushOcc(orun); orun = null; }
      });
      if (orun) pushOcc(orun);

      function pushOcc(r) {
        var sec = r.to - r.from;
        if (sec >= g.occludeRun.minSec && r.frames >= g.occludeRun.minFrames) {
          out.push({
            key: 'board_occluded',
            kind: 'issue',
            severity: 'mid',
            from: r.from, to: r.to, seconds: Math.round(sec),
            title: '讲解时身体挡住板书 ' + Math.round(sec) + ' 秒',
            detail: '这段时间板面没有在变化（不是在写），但身体占了板面 35% 以上的区域。' +
              '注意：这里说的是「挡住镜头能看到的那块板面」，不等于必然挡住全班——取决于机位与黑板位置，报告按拍到的画面描述。',
            frames: framesIn(r.from, r.to)
          });
        }
      }
    }

    /* 3) 写板书（正常行为，作为正向证据列出来，不扣分） */
    var writeRuns = runs.filter(function (r) { return r.kind === 'write' && (r.end - r.start) >= g.writeRun.minSec; });
    if (writeRuns.length) {
      out.push({
        key: 'writing',
        kind: 'positive',
        severity: 'none',
        from: writeRuns[0].start, to: writeRuns[writeRuns.length - 1].end,
        seconds: Math.round(writeRuns.reduce(function (s, r) { return s + (r.end - r.start); }, 0)),
        title: '有 ' + writeRuns.length + ' 段板书书写',
        detail: '这些时段板面在变化、人转向板面，属于正常板书行为，不扣分。' +
          '为了方便复习，报告里的时间码可以跳过去看。',
        runs: writeRuns.map(function (r) { return { from: r.start, to: r.end }; }),
        frames: framesIn(writeRuns[0].start, writeRuns[0].end)
      });
    }

    /* 4) 手势指向板面（正向证据：讲解与板书有配合） */
    var pointing = frames.filter(function (f) {
      if (!f.landmarks || !f.boardRegion) return false;
      var w = f.landmarks[15], w2 = f.landmarks[16];
      return [w, w2].some(function (p) {
        return p && vis(p) > 0.4 && p.x > f.boardRegion.x - 0.05 && p.x < f.boardRegion.x + f.boardRegion.w + 0.05 &&
          p.y > f.boardRegion.y - 0.05 && p.y < f.boardRegion.y + f.boardRegion.h + 0.05;
      });
    });
    if (pointing.length >= g.gestureRun.minFrames) {
      out.push({
        key: 'gesture_board',
        kind: 'positive',
        severity: 'none',
        from: pointing[0].t, to: pointing[pointing.length - 1].t,
        seconds: Math.round(pointing[pointing.length - 1].t - pointing[0].t),
        title: pointing.length + ' 帧里手停在板面附近',
        detail: '有手部关键点落在板书区域内，属于「边指边讲」的可见证据。' +
          '它只能说明手在板面附近，说明不了指的就是正在讲的那一行。',
        frames: pointing.slice(0, 3).map(frameRef)
      });
    }

    /* 给每条结论挂上「这条证据有多厚」：帧数、关键点均值、覆盖时长、置信度。
       报告里要能一眼看出这条结论是靠 3 帧还是靠 12 帧得出来的。 */
    out.forEach(function (b) {
      var inRange = frames.filter(function (f) { return f.t >= b.from && f.t <= b.to; });
      var withPose = inRange.filter(function (f) { return f.landmarks && f.landmarks.length; });
      var kpSum = 0;
      withPose.forEach(function (f) {
        f.landmarks.forEach(function (p) {
          if ((p.visibility == null ? 1 : p.visibility) > 0.5) kpSum++;
        });
      });
      var expected = b.seconds > 0 ? Math.max(1, Math.round(b.seconds / Math.max(1, step || 4))) : 1;
      b.evidence = {
        frames: inRange.length,
        poseFrames: withPose.length,
        kpAvg: withPose.length ? Math.round(kpSum / withPose.length) : 0,
        seconds: b.seconds,
        sampleCoverage: Math.min(1, Math.round((inRange.length / expected) * 100) / 100),
        confidence: (withPose.length >= 4 && b.seconds >= 8) ? 'high'
          : (withPose.length >= 3 ? 'medium' : 'low')
      };
    });

    return out;

    function framesIn(from, to) {
      return frames.filter(function (f) { return f.t >= from && f.t <= to; })
        .slice(0, 3).map(frameRef);
    }
  }

  function frameRef(f) {
    return { frameId: f.frameId, t: f.t, facing: f.facing, phase: f.phase, occludes: !!f.occludesBoard };
  }

  /* 给报告用：把某一帧按原始分辨率截出来（可只截某个区域） */
  function snapshot(file, t, rect, width) {
    return loadVideo(file).then(function (pack) {
      var v = pack.video;
      return seek(v, t).then(function () {
        var w = width || 720;
        var sw = v.videoWidth, sh = v.videoHeight;
        var scale = Math.min(1, w / sw);
        var c = mkCanvas(Math.round(sw * scale), Math.round(sh * scale));
        var ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0, c.width, c.height);
        var out = { url: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height, rect: null };
        if (rect) {
          var c2 = mkCanvas(Math.round(rect.w * c.width), Math.round(rect.h * c.height));
          c2.getContext('2d').drawImage(c, rect.x * c.width, rect.y * c.height, c2.width, c2.height, 0, 0, c2.width, c2.height);
          out.crop = c2.toDataURL('image/jpeg', 0.86);
          out.rect = rect;
        }
        URL.revokeObjectURL(pack.url);
        return out;
      });
    });
  }

  /* 兼容旧调用点：直接把 analyze 的结果换算成「画面时间线」的 shots */
  function contact(file, o) {
    o = o || {};
    return analyze(file, { onProgress: o.onProgress, signal: o.signal, shotEvery: o.every || 30 })
      .then(function (r) {
        return { duration: r.duration, every: o.every || 30, shots: r.shots || [], analysis: r };
      });
  }

  App.Frames = {
    CFG: CFG,
    analyze: analyze,
    contact: contact,
    snapshot: snapshot,
    facingOf: facingOf,
    personBox: personBox,
    /* 诊断用：把内部判定函数暴露出来，_lab 与报告诊断面板可以直接复算同一帧 */
    boardRegion: boardRegion,
    boardDebug: boardDebug,
    regionSignature: regionSignature,
    sharpness: sharpness
  };
})(window);