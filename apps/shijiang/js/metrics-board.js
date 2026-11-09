/* 板书几何口径：全部从板面裁剪图的像素算出来，不经过模型。
   输入是 canvas 的 ImageData（{data, width, height}），输出 8 项可复现指标：
   行平直度 / 行距 / 字距 / 字号 / 版面利用率 / 分块 / 遮挡 / 擦除残留。

   口径约定（写死在这里，报告里原样展示）：
   - 墨迹 = 与板面底色亮度差 ≥ inkDelta 的像素；底色取全图亮度直方图的峰值
   - 一行 = 行投影里连续 ≥2 行有墨迹、且高度 ≥ minRowPx 的带
   - 行平直度 = 每行按 8 列切片算墨迹重心，拟合直线后的残差 RMS ÷ 该行字高
   - 字距 = 同一行内相邻字符块横向间隙中位数 ÷ 字符宽中位数
   - 字号 = 字符块高度中位数（像素），同时给占板面高度的比例
   - 利用率 = 各行/块外接框的并集面积 ÷ 板面面积
   - 擦除残留 = 「介于底色与墨迹之间」的中间调像素占比（没擦干净的粉笔灰）
*/
(function (window) {
  'use strict';

  var CFG = {
    inkDelta: 34,        /* 与底色差多少算墨迹 */
    residueDelta: 14,    /* 介于 14 与 inkDelta 之间算残留 */
    minRowPx: 4,         /* 行高下限（像素） */
    minRowInk: 0.004,    /* 一行至少占宽度多少比例的墨迹才算一行 */
    bandGap: 2,          /* 行投影允许断几行 */
    minCharPx: 3,        /* 字符块最小边长 */
    minCharArea: 6,      /* 字符块最小面积 */
    maxComponents: 4000, /* 连通域上限，防止整屏噪点把内存吃满 */
    blockGapRatio: 1.8,  /* 行距的多少倍算「换一块」 */
    straightBad: 0.35,   /* 行平直度 > 35% 字高算歪 */
    pitchMin: 1.05,      /* 行距 ÷ 字高 的合理区间 */
    pitchMax: 2.6,
    gapTight: 0.12,      /* 字距 ÷ 字宽 */
    gapLoose: 0.9,
    sizeMinRatio: 0.025, /* 字高 ÷ 板面高（400 像素高的板面 ≈ 10 像素字） */
    utilityLow: 0.08,
  minMeasureCharH: 8,   /* 字高低于这个像素数，字距/行平直度都不可信 */
    residueBad: 0.45,    /* 真实黑板被擦得到处是灰，阈值太紧会人人报警 */
    occludeBad: 0.10
  };

  function luma(data) {
    var n = data.length / 4;
    var out = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      out[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000;
    }
    return out;
  }

  /* 底色 = 直方图峰值；板面大部分是干净的底色，这个估计很稳 */
  function background(lum) {
    var hist = new Uint32Array(256);
    for (var i = 0; i < lum.length; i++) hist[lum[i]]++;
    var best = 0, bestN = 0, sum = 0, cnt = 0;
    for (var v = 0; v < 256; v++) {
      if (hist[v] > hist[best]) best = v;
    }
    /* 峰值附近 ±3 一起平均，避免 JPEG 噪点让底色跳 */
    for (var u = Math.max(0, best - 3); u <= Math.min(255, best + 3); u++) {
      sum += u * hist[u]; cnt += hist[u];
    }
    return { bg: cnt ? sum / cnt : best, hist: hist };
  }

  function maskOf(lum, bg, delta) {
    var m = new Uint8Array(lum.length);
    for (var i = 0; i < lum.length; i++) {
      if (Math.abs(lum[i] - bg) >= delta) m[i] = 1;
    }
    return m;
  }

  function rowProfile(mask, w, h) {
    var rows = new Uint16Array(h);
    for (var y = 0; y < h; y++) {
      var c = 0, base = y * w;
      for (var x = 0; x < w; x++) if (mask[base + x]) c++;
      rows[y] = c;
    }
    return rows;
  }

  function findBands(rows, w, h) {
    var thr = Math.max(2, Math.round(w * CFG.minRowInk));
    var bands = [];
    var cur = null, gap = 0;
    for (var y = 0; y < h; y++) {
      var on = rows[y] >= thr;
      if (on) {
        if (!cur) cur = { y0: y, y1: y };
        else cur.y1 = y;
        gap = 0;
      } else if (cur) {
        gap++;
        if (gap > CFG.bandGap) {
          cur.y1 = y - gap;
          bands.push(cur);
          cur = null;
          gap = 0;
        }
      }
    }
    if (cur) { cur.y1 = h - 1; bands.push(cur); }

    /* 太薄的行不算（比如边框、反光条） */
    return bands.filter(function (b) { return b.y1 - b.y0 + 1 >= CFG.minRowPx; }).map(function (b) {
      var ink = 0;
      for (var y = b.y0; y <= b.y1; y++) ink += rows[y];
      return { y0: b.y0, y1: b.y1, h: b.y1 - b.y0 + 1, ink: ink };
    });
  }

  function bandExtent(mask, w, b) {
    var x0 = w, x1 = -1;
    for (var y = b.y0; y <= b.y1; y++) {
      var base = y * w;
      for (var x = 0; x < w; x++) {
        if (mask[base + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    if (x1 < 0) return null;
    return { x0: x0, x1: x1, w: x1 - x0 + 1 };
  }

  /* 行平直度：每行切 8 列，算每列墨迹重心的 y，再对 y 拟合直线，取残差 RMS */
  function straightness(mask, w, b) {
    var slices = 8, pts = [];
    var sliceW = Math.max(1, Math.floor(w / slices));
    for (var s = 0; s < slices; s++) {
      var xs = s * sliceW, xe = Math.min(w - 1, xs + sliceW - 1);
      var sumY = 0, sumN = 0;
      for (var y = b.y0; y <= b.y1; y++) {
        var base = y * w;
        for (var x = xs; x <= xe; x++) {
          if (mask[base + x]) { sumY += y; sumN++; }
        }
      }
      if (sumN >= 4) pts.push({ x: (xs + xe) / 2, y: sumY / sumN, n: sumN });
    }
    if (pts.length < 3) return null;
    var sx = 0, sy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; });
    var mx = sx / pts.length, my = sy / pts.length;
    var num = 0, den = 0;
    pts.forEach(function (p) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) * (p.x - mx); });
    var slope = den ? num / den : 0;
    var sq = 0;
    pts.forEach(function (p) {
      var ey = p.y - (my + slope * (p.x - mx));
      sq += ey * ey;
    });
    return { slope: slope, rms: Math.sqrt(sq / pts.length), pts: pts.length };
  }

  /* 连通域：只在行带内做，减少一半以上的像素 */
  function components(mask, w, b) {
    var out = [];
    if (out.length >= CFG.maxComponents) return out;
    var H = b.y1 - b.y0 + 1;
    var seen = new Uint8Array(w * H);
    var stack = [];
    for (var yy = 0; yy < H; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var idx = yy * w + xx;
        if (seen[idx] || !mask[(b.y0 + yy) * w + xx]) continue;
        var minX = xx, maxX = xx, minY = yy, maxY = yy, area = 0;
        stack.length = 0;
        stack.push(idx);
        seen[idx] = 1;
        while (stack.length) {
          var p = stack.pop();
          var py = (p / w) | 0, px = p % w;
          area++;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          /* 4 邻域 */
          if (px > 0) { var l = p - 1; if (!seen[l] && mask[(b.y0 + py) * w + (px - 1)]) { seen[l] = 1; stack.push(l); } }
          if (px < w - 1) { var r = p + 1; if (!seen[r] && mask[(b.y0 + py) * w + (px + 1)]) { seen[r] = 1; stack.push(r); } }
          if (py > 0) { var u = p - w; if (!seen[u] && mask[(b.y0 + py - 1) * w + px]) { seen[u] = 1; stack.push(u); } }
          if (py < H - 1) { var d = p + w; if (!seen[d] && mask[(b.y0 + py + 1) * w + px]) { seen[d] = 1; stack.push(d); } }
        }
        var cw = maxX - minX + 1, ch = maxY - minY + 1;
        if (cw >= CFG.minCharPx && ch >= CFG.minCharPx && area >= CFG.minCharArea) {
          out.push({ x: minX, y: minY + b.y0, w: cw, h: ch, area: area });
          if (out.length >= CFG.maxComponents) return out;
        }
      }
    }
    return out;
  }

  function median(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function unionArea(rects) {
    /* 行数不多（<60），直接按 y 扫描线求并集，够用且不会算错 */
    if (!rects.length) return 0;
    var ys = [];
    rects.forEach(function (r) { ys.push(r.y0, r.y1); });
    ys.sort(function (a, b) { return a - b; });
    var area = 0;
    for (var i = 0; i < ys.length - 1; i++) {
      var y0 = ys[i], y1 = ys[i + 1];
      if (y1 <= y0) continue;
      var spans = [];
      rects.forEach(function (r) {
        if (r.y0 <= y0 && r.y1 >= y1) spans.push([r.x0, r.x1]);
      });
      if (!spans.length) continue;
      spans.sort(function (a, b) { return a[0] - b[0]; });
      var curS = spans[0][0], curE = spans[0][1], wsum = 0;
      for (var k = 1; k < spans.length; k++) {
        if (spans[k][0] <= curE + 1) { curE = Math.max(curE, spans[k][1]); }
        else { wsum += curE - curS + 1; curS = spans[k][0]; curE = spans[k][1]; }
      }
      wsum += curE - curS + 1;
      area += wsum * (y1 - y0);
    }
    return area;
  }

  /* 把 OCR 的字符框按行聚起来，换算成和连通域同一套字段 */
  function normalizeBoxes(list) {
    return (list || []).map(function (b) {
      if (!b) return null;
      var x = b.x != null ? b.x : b.left;
      var y = b.y != null ? b.y : b.top;
      var w2 = b.w != null ? b.w : b.width;
      var h2 = b.h != null ? b.h : b.height;
      if (!(w2 > 0 && h2 > 0)) return null;
      return { x: +x, y: +y, w: +w2, h: +h2, text: b.text || '' };
    }).filter(Boolean);
  }

  function boxesToRows(boxes, w, h) {
    var bs = normalizeBoxes(boxes).filter(function (b) { return b.h >= 3 && b.h <= h * 0.4; });
    if (bs.length < 3) return [];
    var medH = median(bs.map(function (b) { return b.h; }));
    var tol = Math.max(3, medH * 0.6);
    var sorted = bs.slice().sort(function (a, b) { return (a.y + a.h / 2) - (b.y + b.h / 2); });
    var rows = [];
    sorted.forEach(function (b) {
      var cy = b.y + b.h / 2;
      var row = rows[rows.length - 1];
      if (row && Math.abs(cy - row.cy) <= tol) {
        row.items.push(b);
        row.sum += cy;
        row.cy = row.sum / row.items.length;
      } else {
        rows.push({ cy: cy, sum: cy, items: [b] });
      }
    });
    return rows.map(function (row) {
      var items = row.items.slice().sort(function (a, b2) { return a.x - b2.x; });
      var hs = items.map(function (b) { return b.h; });
      var ws = items.map(function (b) { return b.w; });
      var gaps = [];
      for (var i = 1; i < items.length; i++) {
        var g = items[i].x - (items[i - 1].x + items[i - 1].w);
        if (g >= 0 && g < w * 0.5) gaps.push(g);
      }
      var y0 = Math.min.apply(null, items.map(function (b) { return b.y; }));
      var y1 = Math.max.apply(null, items.map(function (b) { return b.y + b.h; }));
      var x0 = Math.min.apply(null, items.map(function (b) { return b.x; }));
      var x1 = Math.max.apply(null, items.map(function (b) { return b.x + b.w; }));
      var n = items.length, sx = 0, sy = 0;
      items.forEach(function (b) { sx += b.x + b.w / 2; sy += b.y + b.h / 2; });
      var mx = sx / n, my = sy / n, num = 0, den = 0;
      items.forEach(function (b) {
        var dx = (b.x + b.w / 2) - mx;
        num += dx * ((b.y + b.h / 2) - my);
        den += dx * dx;
      });
      var slope = den ? num / den : 0;
      var sq = 0;
      items.forEach(function (b) {
        var pred = my + slope * ((b.x + b.w / 2) - mx);
        var e = (b.y + b.h / 2) - pred;
        sq += e * e;
      });
      var rms = n ? Math.sqrt(sq / n) : null;
      return {
        y0: y0, y1: y1, h: y1 - y0 + 1, ink: items.length,
        x0: x0, x1: x1, w: x1 - x0 + 1,
        comps: items.length,
        charH: median(hs), charW: median(ws), gap: median(gaps),
        straight: n >= 3 ? rms : null, slope: n >= 3 ? slope : null
      };
    });
  }
  function analyze(img, opts) {
    opts = opts || {};
    if (!img || !img.data || !img.width || !img.height) {
      return { available: false, reason: '没有板面图像', metrics: [] };
    }
    var w = img.width, h = img.height;
    var lum = luma(img.data);
    var bgInfo = background(lum);
    var mask = maskOf(lum, bgInfo.bg, CFG.inkDelta);

    var inkCount = 0;
    for (var i = 0; i < mask.length; i++) inkCount += mask[i];
    var inkRatio = inkCount / (w * h);

    var residue = 0;
    for (var q = 0; q < lum.length; q++) {
      var dev = Math.abs(lum[q] - bgInfo.bg);
      if (dev >= CFG.residueDelta && dev < CFG.inkDelta) residue++;
    }
    var residueRatio = residue / (w * h);

    var rows = rowProfile(mask, w, h);
    var bands = findBands(rows, w, h);

    /* 每行的外接框、平直度、字符块 */
    var rowInfo = [];
    bands.forEach(function (b) {
      var ext = bandExtent(mask, w, b);
      if (!ext) return;
      var st = straightness(mask, w, b);
      var comps = components(mask, w, b);
      var heights = comps.map(function (c) { return c.h; });
      var widths = comps.map(function (c) { return c.w; });
      var gaps = [];
      var sorted = comps.slice().sort(function (a, b2) { return a.x - b2.x; });
      for (var k = 1; k < sorted.length; k++) {
        var g = sorted[k].x - (sorted[k - 1].x + sorted[k - 1].w);
        if (g >= 0) gaps.push(g);
      }
      rowInfo.push({
        y0: b.y0, y1: b.y1, h: b.h, ink: b.ink,
        x0: ext.x0, x1: ext.x1, w: ext.w,
        comps: comps.length,
        charH: median(heights),
        charW: median(widths),
        gap: median(gaps),
        straight: st ? st.rms : null,
        slope: st ? st.slope : null
      });
    });

    /* 行距：相邻行「上沿到上沿」的中位数 */
    var pitches = [];
    for (var r = 1; r < rowInfo.length; r++) {
      var d = rowInfo[r].y0 - rowInfo[r - 1].y0;
      if (d > 0) pitches.push(d);
    }
    var pitch = median(pitches);
    var charHs = rowInfo.map(function (rw) { return rw.charH; }).filter(function (v) { return v; });
    var charH = median(charHs);
    var charWs = rowInfo.map(function (rw) { return rw.charW; }).filter(function (v) { return v; });
    var charW = median(charWs);
    var gapVals = rowInfo.map(function (rw) { return rw.gap; }).filter(function (v) { return v != null; });
    var gap = median(gapVals);

    /* 行平直度：按「行墨迹量」加权，短行别拖累整体 */
    var straights = rowInfo.filter(function (rw) { return rw.straight != null && rw.charH; });
    var sw = 0, swv = 0;
    straights.forEach(function (rw) {
      var wt = Math.max(1, rw.ink);
      sw += wt;
      swv += wt * (rw.straight / rw.charH);
    });
    var straightRatio = sw ? swv / sw : null;

    /* ---- 有 OCR 字符框就用真框，没有才用连通域估算 ----
       字符框带「这个字在哪、多大」，字距/字号才算得准；
       连通域会把「口」「日」这类闭合的字拆成好几个块，估出来的字高偏小。 */
    var charSource = 'cc';
    var ocrRows = boxesToRows(opts.boxes, w, h);
    if (ocrRows.length >= 2) {
      var oCharH = median(ocrRows.map(function (r2) { return r2.charH; }).filter(function (v) { return v; }));
      var oCharW = median(ocrRows.map(function (r2) { return r2.charW; }).filter(function (v) { return v; }));
      var oGap = median(ocrRows.map(function (r2) { return r2.gap; }).filter(function (v) { return v != null; }));
      var oPitch = median((function () {
        var arr = [];
        for (var i2 = 1; i2 < ocrRows.length; i2++) {
          var d2 = ocrRows[i2].y0 - ocrRows[i2 - 1].y0;
          if (d2 > 0) arr.push(d2);
        }
        return arr;
      })());
      var oStraights = ocrRows.filter(function (r2) { return r2.straight != null && r2.charH; });
      var osw = 0, osv = 0;
      oStraights.forEach(function (r2) {
        var wt2 = Math.max(1, r2.ink || 1);
        osw += wt2;
        osv += wt2 * (r2.straight / r2.charH);
      });
      if (oCharH) {
        rowInfo = ocrRows;
        charH = oCharH;
        if (oCharW) charW = oCharW;
        if (oGap != null) gap = oGap;
        if (oPitch) pitch = oPitch;
        if (osw) straightRatio = osv / osw;
        charSource = 'ocr';
      }
    }

    /* 分块：行距明显变大的地方切一刀 */
    var blocks = [];
    if (rowInfo.length) {
      var curB = { rows: [rowInfo[0]] };
      for (var b2 = 1; b2 < rowInfo.length; b2++) {
        var gapPx = rowInfo[b2].y0 - rowInfo[b2 - 1].y1;
        var big = pitch ? gapPx > pitch * CFG.blockGapRatio : false;
        if (big) { blocks.push(curB); curB = { rows: [rowInfo[b2]] }; }
        else curB.rows.push(rowInfo[b2]);
      }
      blocks.push(curB);
    }
    var blockInfo = blocks.map(function (bl) {
      var y0 = bl.rows[0].y0, y1 = bl.rows[bl.rows.length - 1].y1;
      var x0 = Math.min.apply(null, bl.rows.map(function (x) { return x.x0; }));
      var x1 = Math.max.apply(null, bl.rows.map(function (x) { return x.x1; }));
      return { y0: y0, y1: y1, x0: x0, x1: x1, rows: bl.rows.length, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    });

    var used = unionArea(blockInfo.map(function (b) { return { y0: b.y0, y1: b.y1, x0: b.x0, x1: b.x1 }; }));
    var utility = used / (w * h);

    /* ---- 行首对齐：各行左端点的离散度，用「几个字宽」当单位 ----
       字写得再好看，行首忽左忽右，看起来也是乱的。 */
    var lefts = rowInfo.map(function (rw) { return rw.x0; });
    var alignCV = null;
    if (lefts.length >= 2 && charW) {
      var lMean = lefts.reduce(function (a, b) { return a + b; }, 0) / lefts.length;
      var lVar = lefts.reduce(function (a, b) { return a + (b - lMean) * (b - lMean); }, 0) / lefts.length;
      alignCV = Math.sqrt(lVar) / charW;
    }
    var alignValue = alignCV == null ? null : Math.round(alignCV * 100) / 100;

    /* ---- 留白：内容外接框离板面四条边还剩多少 ----
       贴边写（几乎顶到边）说明版面没规划，也容易拍不全。 */
    var boxX0 = w, boxY0 = h, boxX1 = 0, boxY1 = 0;
    rowInfo.forEach(function (rw) {
      if (rw.x0 < boxX0) boxX0 = rw.x0;
      if (rw.y0 < boxY0) boxY0 = rw.y0;
      if (rw.x1 > boxX1) boxX1 = rw.x1;
      if (rw.y1 > boxY1) boxY1 = rw.y1;
    });
    var marginPct = rowInfo.length
      ? Math.round(Math.min(boxX0 / w, (w - boxX1) / w, boxY0 / h, (h - boxY1) / h) * 1000) / 10
      : null;

    /* ---- 对比度：墨迹像素与底色的亮度差 ----
       差得少＝浅粉笔写浅色板 / 反光，拍出来读着费劲。 */
    var inkSum = 0, inkN = 0;
    for (var c2 = 0; c2 < lum.length; c2++) { if (mask[c2]) { inkSum += lum[c2]; inkN++; } }
    var contrast = inkN ? Math.round(Math.abs(inkSum / inkN - bgInfo.bg)) : null;

    var occlusion = typeof opts.occlusion === 'number' ? opts.occlusion : null;
    var r1 = function (v) { return (v == null) ? null : Math.round(v * 100) / 100; };
    var pct = function (v) { return (v == null) ? null : Math.round(v * 1000) / 10; };

    /* 行挤到一起时根本分不出行：一整条里塞了多行字。
       这时「行距」不能编一个数出来，要如实说「分不出行」。 */
    var merged = !!(rowInfo.length === 1 && charH && rowInfo[0].h >= charH * 1.6);
    var measurable = !!(charH && charH >= CFG.minMeasureCharH);
    if (merged) pitch = null;

    var metrics = [
      {
        key: 'straight', name: '行平直度', value: measurable ? pct(straightRatio) : null, unit: '% 字高',
        threshold: '≤ ' + pct(CFG.straightBad) + '% 字高',
        abnormal: measurable && straightRatio != null && straightRatio > CFG.straightBad,
        formula: '每行切 8 列算墨迹重心，拟合直线后取残差 RMS÷该行字高，按墨迹量加权（' + straights.length + ' 行）'
      },
      {
        key: 'pitch', name: '行距', value: (pitch == null || !measurable) ? null : Math.round(pitch * 10) / 10, unit: ' 像素',
        threshold: '字高的 ' + CFG.pitchMin + '–' + CFG.pitchMax + ' 倍',
        abnormal: merged || (measurable && !!pitch && !!charH && (pitch / charH < CFG.pitchMin || pitch / charH > CFG.pitchMax)),
        formula: !measurable
          ? '字块只有 ' + Math.round(charH || 0) + ' 像素高，行距量不准（要拍近一点或换高分辨率视频）'
          : merged
          ? '一整片里塞了多行字，行与行之间没有空白，量不出行距（字高 ' + Math.round(charH) + ' 像素）'
          : '相邻行上沿间距的中位数（' + (pitches.length + 1) + ' 行）；字高 ' + (charH ? Math.round(charH) : '—') + ' 像素，比值 ' +
            (pitch && charH ? Math.round(pitch / charH * 100) / 100 : '—')
      },
      {
        key: 'gap', name: '字距', value: (measurable && gap && charW) ? Math.round(gap / charW * 100) / 100 : null, unit: ' 倍字宽',
        threshold: '字宽的 ' + CFG.gapTight + '–' + CFG.gapLoose + ' 倍',
        abnormal: measurable && !!gap && !!charW && (gap / charW < CFG.gapTight || gap / charW > CFG.gapLoose),
        formula: !measurable
          ? '字块只有 ' + Math.round(charH || 0) + ' 像素高，字距量不准（要拍近一点或换高分辨率视频）'
          : '同行相邻字符块横向间隙中位数 ÷ 字符宽中位数（间隙 ' + (gap == null ? '—' : Math.round(gap)) + ' 像素 / 字宽 ' +
          (charW ? Math.round(charW) : '—') + ' 像素）'
      },
      {
        key: 'size', name: '字号', value: pct(charH ? charH / h : null), unit: '% 板高',
        threshold: '≥ ' + pct(CFG.sizeMinRatio) + '% 板高',
        abnormal: charH ? (charH / h < CFG.sizeMinRatio) : true,
        formula: charH
          ? '字符块高度中位数 ' + Math.round(charH) + ' 像素 ÷ 板面高 ' + h + ' 像素'
          : '字块太小（不到 ' + CFG.minCharPx + ' 像素），已经数不出单个字——离得太远或者写得太小'
      },
      {
        key: 'utility', name: '版面利用率', value: pct(inkRatio), unit: '%',
        threshold: '≥ ' + pct(CFG.utilityLow) + '%',
        abnormal: inkRatio < CFG.utilityLow,
        formula: '墨迹像素 ÷ 板面像素（板书实际占了多少板面；分块外接框' + pct(utility) + '% 是它的另一面）'
      },
      {
        key: 'blocks', name: '分块', value: blockInfo.length, unit: ' 块',
        threshold: '1–4 块更清楚',
        abnormal: blockInfo.length > 4,
        formula: '行距超过 ' + CFG.blockGapRatio + ' 倍行距处断开，共 ' + blockInfo.length + ' 块（' +
          blockInfo.map(function (b) { return b.rows + '行'; }).join(' / ') + '）'
      },
      {
        key: 'occlude', name: '遮挡', value: pct(occlusion), unit: '%',
        threshold: '≤ ' + pct(CFG.occludeBad) + '%',
        abnormal: occlusion != null && occlusion > CFG.occludeBad,
        formula: '人体框与板书框的重叠面积 ÷ 板书面积' + (occlusion == null ? '（这一帧没测到人）' : '')
      },
      {
        key: 'align', name: '行首对齐', value: measurable ? alignValue : null, unit: ' 字宽',
        threshold: '≤ 1 字宽',
        abnormal: measurable && alignValue != null && alignValue > 1,
        formula: alignValue == null
          ? '行太少，看不出行首齐不齐'
          : '各行左端点的标准差 ÷ 字宽（' + lefts.length + ' 行，字宽 ' + Math.round(charW || 0) + ' 像素）'
      },
      {
        key: 'margin', name: '四周留白', value: marginPct, unit: '% 板面',
        threshold: '≥ 3% 边距',
        abnormal: marginPct != null && marginPct < 3,
        formula: marginPct == null
          ? '没有成行的字，量不出留白'
          : '内容外接框离最近一条板边的距离 ÷ 板面尺寸（太贴边说明版面没规划）'
      },
      {
        key: 'contrast', name: '墨迹对比度', value: measurable ? contrast : null, unit: '',
        threshold: '≥ 45',
        abnormal: measurable && contrast != null && contrast < 45,
        formula: contrast == null
          ? '板面上没有墨迹'
          : '墨迹像素平均亮度与底色亮度之差（差得少＝反光或粉笔太淡，读着费劲）'
      },
      {
        key: 'residue', name: '擦除残留', value: pct(residueRatio), unit: '%',
        threshold: '≤ ' + pct(CFG.residueBad) + '%',
        abnormal: residueRatio > CFG.residueBad,
        formula: '与底色差 ' + CFG.residueDelta + '–' + CFG.inkDelta + ' 的中间调像素占比（没擦干净的粉笔灰）'
      }
    ];

    return {
      available: rowInfo.length >= 1,
      charSource: charSource,
      measurable: measurable,
      charHeight: charH ? Math.round(charH) : null,
      width: w, height: h,
      bg: Math.round(bgInfo.bg),
      inkRatio: r1(inkRatio),
      rows: {
        count: rowInfo.length,
        pitchPx: pitch == null ? null : Math.round(pitch * 10) / 10,
        /* 行距的一致性：相邻行间距的变异系数（标准差 ÷ 均值），细则 C1 要这个 */
        pitchCv: (function () {
          var gaps = [];
          for (var i = 1; i < rowInfo.length; i++) {
            var g = rowInfo[i].y0 - rowInfo[i - 1].y0;
            if (g > 0) gaps.push(g);
          }
          if (gaps.length < 2) return null;
          var mean = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
          if (!mean) return null;
          var sd = Math.sqrt(gaps.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / gaps.length);
          return Math.round(sd / mean * 100) / 100;
        })(),
        charHPx: charH == null ? null : Math.round(charH * 10) / 10,
        straightPct: pct(straightRatio),
        list: rowInfo.map(function (rw, idx) {
          return {
            i: idx + 1, y0: rw.y0, y1: rw.y1, x0: rw.x0, x1: rw.x1,
            charH: rw.charH == null ? null : Math.round(rw.charH * 10) / 10,
            gap: rw.gap == null ? null : Math.round(rw.gap * 10) / 10,
            straightPct: (rw.straight != null && rw.charH) ? pct(rw.straight / rw.charH) : null,
            comps: rw.comps
          };
        })
      },
      chars: {
        count: rowInfo.reduce(function (a, rw) { return a + rw.comps; }, 0),
        sizePx: charH == null ? null : Math.round(charH * 10) / 10,
        widthPx: charW == null ? null : Math.round(charW * 10) / 10,
        /* 字距、字号的一致性：逐行间隙与字高的变异系数（细则 C1） */
        gapCv: (function () {
          var gs = rowInfo.map(function (rw) { return rw.gap; }).filter(function (g) { return g != null && g > 0; });
          if (gs.length < 2) return null;
          var mean = gs.reduce(function (a, b) { return a + b; }, 0) / gs.length;
          if (!mean) return null;
          var sd = Math.sqrt(gs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / gs.length);
          return Math.round(sd / mean * 100) / 100;
        })(),
        sizeCv: (function () {
          var hs = rowInfo.map(function (rw) { return rw.charH; }).filter(function (v) { return v != null && v > 0; });
          if (hs.length < 2) return null;
          var mean = hs.reduce(function (a, b) { return a + b; }, 0) / hs.length;
          if (!mean) return null;
          var sd = Math.sqrt(hs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / hs.length);
          return Math.round(sd / mean * 100) / 100;
        })(),
        gapRatio: (gap && charW) ? Math.round(gap / charW * 100) / 100 : null
      },
      blocks: blockInfo.map(function (b) {
        return { y0: b.y0, y1: b.y1, x0: b.x0, x1: b.x1, rows: b.rows, w: b.w, h: b.h };
      }),
      utility: r1(utility),
      occlusion: occlusion,
      residue: r1(residueRatio),
      metrics: metrics,
      cfg: CFG,
      note: rowInfo.length
        ? '这些数只从裁剪出来的板面像素算，不看内容对不对；内容完整性另算。'
        : '板面上没找到成行的字迹（可能还没写、或者糊成一片）。'
    };
  }


  /* ======================================================================
     评分点：把几何指标换成 0–100 的分，报告里一项一项列出来。
     只给「能从像素量出来」的点打分；量不出来的点 weight=0，不参与平均。
     ====================================================================== */
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

  function points(m) {
    if (!m || !m.available) return { items: [], score: null, weight: 0 };
    var by = {};
    (m.metrics || []).forEach(function (x) { by[x.key] = x; });
    var c = m.chars || {};
    var sizeR = c.sizePx != null && m.height ? c.sizePx / m.height : null;
    var pitchR = (m.rows && m.rows.pitchPx && c.sizePx) ? m.rows.pitchPx / c.sizePx : null;

    var items = [
      {
        key: 'size', name: '字号可读', weight: 2,
        score: sizeR == null ? null : bandRev(sizeR, 0.012, 0.025),
        detail: sizeR == null ? '量不出字高' : '字高占板面 ' + Math.round(sizeR * 1000) / 10 + '%（门槛 2.5%）'
      },
      {
        key: 'straight', name: '行写得平', weight: 2,
        score: m.measurable && by.straight && by.straight.value != null ? band(by.straight.value / 100, 0.15, 0.35) : null,
        detail: by.straight && by.straight.value != null ? '偏差 ' + by.straight.value + '% 字高（门槛 35%）' : '量不出行平直度'
      },
      {
        key: 'pitch', name: '行距匀', weight: 1.5,
        score: !m.measurable || pitchR == null ? null : (pitchR < 1.05 ? bandRev(pitchR, 0.7, 1.05) : pitchR > 2.6 ? band(pitchR, 2.6, 4) : 100),
        detail: pitchR == null ? '分不出行或字块太小' : '行距 ' + Math.round(pitchR * 100) / 100 + ' 倍字高（理想 1.05–2.6）'
      },
      {
        key: 'gap', name: '字距匀', weight: 1.5,
        score: !m.measurable || c.gapRatio == null ? null : (c.gapRatio < 0.12 ? bandRev(c.gapRatio, -0.1, 0.12) : c.gapRatio > 0.9 ? band(c.gapRatio, 0.9, 2) : 100),
        detail: c.gapRatio == null ? '量不出字距' : '字距 ' + c.gapRatio + ' 倍字宽（理想 0.12–0.9）'
      },
      {
        key: 'align', name: '行首对齐', weight: 1.5,
        score: m.measurable && by.align && by.align.value != null ? band(by.align.value, 0.35, 1.2) : null,
        detail: by.align && by.align.value != null ? '各行左端离散 ' + by.align.value + ' 字宽（门槛 1 字宽）' : '行太少，看不出'
      },
      {
        key: 'utility', name: '版面用足', weight: 1.5,
        score: m.inkRatio == null ? null : (m.inkRatio < 0.08 ? bandRev(m.inkRatio, 0.02, 0.08) : m.inkRatio > 0.35 ? band(m.inkRatio, 0.35, 0.6) : 100),
        detail: m.inkRatio == null ? '量不出墨迹占比' : '墨迹占板面 ' + Math.round(m.inkRatio * 1000) / 10 + '%（门槛 8%，超过 35% 算挤）'
      },
      {
        key: 'blocks', name: '分区分块', weight: 1,
        score: (m.blocks || []).length === 0 ? null : (m.blocks.length <= 4 ? 100 : clamp100(100 - (m.blocks.length - 4) * 20)),
        detail: '共 ' + ((m.blocks || []).length) + ' 块（1–4 块更清楚）'
      },
      {
        key: 'clean', name: '板面干净', weight: 1.5,
        score: m.residue == null ? null : band(m.residue, 0.15, 0.6),
        detail: m.residue == null ? '量不出残留' : '中间调残留 ' + Math.round(m.residue * 1000) / 10 + '%（门槛 60%）'
      },
      {
        key: 'occlude', name: '不挡板书', weight: 1,
        score: m.occlusion == null ? null : band(m.occlusion, 0.05, 0.3),
        detail: m.occlusion == null ? '这一帧没测到人' : '人体挡住板面 ' + Math.round(m.occlusion * 1000) / 10 + '%（门槛 10%）'
      },
      {
        key: 'contrast', name: '看得清', weight: 1,
        score: m.measurable && by.contrast && by.contrast.value != null ? bandRev(by.contrast.value, 30, 60) : null,
        detail: by.contrast && by.contrast.value != null ? '墨迹与底色差 ' + by.contrast.value + ' 级（门槛 45）' : '量不出对比度'
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
  window.App = window.App || {};
  window.App.MetricsBoard = {
    analyze: analyze,
    points: points,
    CFG: CFG,
    _luma: luma,
    _background: background,
    _maskOf: maskOf,
    _findBands: findBands,
    _components: components,
    _median: median,
    _unionArea: unionArea
  };
})(window);
