/* 板书内容核对：把「本课该写的要点」和 OCR 认出来的板书文字对照。
   只做能复现的字面比对——认出来的字里有没有这几样，绝不猜「老师心里想写什么」。
   没认出来的项写成「没找到」，不写成「没写」，因为可能是字迹/反光/距离导致的漏认。

   公式和普通文字分开处理：
   - 普通文字：可以按字重合度判断「大概写了」；
   - 公式：必须保持顺序、运算符、不等号方向、括号和上下标，「a>b」和「b>a」不能算同一个。
     顺序对不上时只标「待核验」，不写「写了」，也不进内容完整性得分。 */
(function (window) {
  'use strict';
  var App = window.App = window.App || {};

  var CFG = {
    minItemLen: 2,
    minTextLen: 8,      /* 认出的字太少（黑板远/字小）就整项不评，免得把「认不出」说成「没写」 */
    hitRatio: 0.8,      /* 普通文字：字的重合度到 80% 才算「写了」 */
    partialRatio: 0.5,  /* 普通文字：至少一半的字在板书里，才算「只写了一半」 */
    formulaMinRatio: 0.9 /* 公式：字重合度够高但仍不连续时，标「待核验」 */
  };

  /* 归一化：全角转半角，去掉标点空白和虚词噪声。
     数学符号（等号、不等号、四则、括号、幂）必须保留，否则方向就丢了。 */
  function norm(s) {
    /* 只去「中文标点 + 空白 + 全角」，数学符号和字母数字原样留着 */
    return String(s == null ? '' : s)
      .replace(/[\uff01-\uff5e]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); })
      .replace(/[，。、；：！？【】《》“”‘’·—…\s]/g, '')
      .toLowerCase();
  }

  function isFormula(s) {
    return /[=<>≤≥≠+\-*/^]/.test(String(s || ''));
  }

  function chars(s) {
    return norm(s).split('');
  }

  /* 普通文字：字的重合度（去重，避免「定义域值域」被重复的「域」撑高） */
  function coverage(item, boardSet) {
    var seen = {}, cs = chars(item).filter(function (c) { if (seen[c]) return false; seen[c] = 1; return true; });
    if (!cs.length) return 0;
    var hit = 0;
    for (var i = 0; i < cs.length; i++) if (boardSet[cs[i]]) hit++;
    return hit / cs.length;
  }

  /* 公式：是否按顺序连续出现（允许中间没有空格，因为我们先归一化了） */
  function containsInOrder(itemNorm, boardNorm) {
    if (!itemNorm) return false;
    return boardNorm.indexOf(itemNorm) >= 0;
  }

  /* 公式：是否按顺序（不要求连续）出现 */
  function subsequence(itemNorm, boardNorm) {
    var i = 0;
    for (var k = 0; k < boardNorm.length && i < itemNorm.length; k++) {
      if (boardNorm[k] === itemNorm[i]) i++;
    }
    return i === itemNorm.length;
  }

  /* 找一段上下文当证据 */
  function snippet(item, boardText) {
    var cs = chars(item).filter(function (c) { return c.length; });
    if (!cs.length) return '';
    var best = -1, bestScore = 0;
    var bt = String(boardText || '');
    for (var i = 0; i < bt.length; i++) {
      var win = bt.slice(i, i + cs.length * 2);
      var s = 0;
      for (var k = 0; k < cs.length; k++) if (win.indexOf(cs[k]) >= 0) s++;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best < 0) return '';
    return bt.slice(Math.max(0, best - 6), Math.min(bt.length, best + cs.length * 2 + 6));
  }

  function check(input) {
    var items = (input && input.items) || [];
    var boardText = (input && input.text) || '';
    if (!items.length) return { available: false, reason: '没有填写「本课必写要点」，这一项不评', items: [] };
    if (!norm(boardText)) return { available: false, reason: '板书文字没认出来（可能是反光、距离太远或字迹太淡）', items: [] };
    if (norm(boardText).length < CFG.minTextLen) {
      return {
        available: false,
        reason: '板书文字只认出 ' + norm(boardText).length + ' 个字，太少，这一项不评——想评的话，手机横过来、站近一点，让板面占画面三分之一以上再录',
        items: [], ratio: null, note: ''
      };
    }

    var bn = norm(boardText);
    var set = {};
    for (var i = 0; i < bn.length; i++) set[bn[i]] = 1;

    var rows = items.map(function (it) {
      var item = String(it == null ? '' : it).trim();
      var inorm = norm(item);
      if (inorm.length < CFG.minItemLen) {
        return { item: item, state: 'skip', kind: 'text', ratio: 0, note: '太短，没法可靠匹配' };
      }
      var formula = isFormula(item);

      if (formula) {
        if (containsInOrder(inorm, bn)) {
          return { item: item, state: 'hit', kind: 'formula', ratio: 1, evidence: snippet(item, boardText), note: '板书里按这个顺序出现了' };
        }
        if (subsequence(inorm, bn)) {
          return { item: item, state: 'partial', kind: 'formula', ratio: 0.6, evidence: snippet(item, boardText), note: '符号都在，但顺序或相邻关系不一致（可能写反/分行写）' };
        }
        var fcov = coverage(item, set);
        if (fcov >= CFG.formulaMinRatio) {
          return {
            item: item, state: 'verify', kind: 'formula', ratio: 0,
            evidence: snippet(item, boardText),
            note: '认到了这些符号，但顺序对不上，判不了对不对，待核验'
          };
        }
        return { item: item, state: 'miss', kind: 'formula', ratio: 0, evidence: '', note: '没在板书文字里找到这个式子（不代表没写，也可能是没认出来）' };
      }

      var r = coverage(item, set);
      if (containsInOrder(inorm, bn)) {
        return { item: item, state: 'hit', kind: 'text', ratio: 1, evidence: snippet(item, boardText), note: '板上有这个词组' };
      }
      if (r >= CFG.hitRatio) {
        /* 字都在，但不是连续出现：只能说明「检索到相关字符」，不能写「写了」 */
        return {
          item: item, state: 'found', kind: 'text', ratio: 0,
          evidence: snippet(item, boardText),
          note: '检索到相关字符，但没连成这个词组，待核验'
        };
      }
      if (r >= CFG.partialRatio) {
        return { item: item, state: 'partial', kind: 'text', ratio: 0.5, evidence: snippet(item, boardText), note: '只认出一部分（可能写漏，也可能是没认准）' };
      }
      return { item: item, state: 'miss', kind: 'text', ratio: 0, evidence: '', note: '没在板书文字里找到（不代表没写，可能是没认出来）' };
    });

    var cnt = function (st) { return rows.filter(function (r) { return r.state === st; }).length; };
    var scored = rows.filter(function (r) { return r.state !== 'skip'; }).length;
    var hit = cnt('hit'), partial = cnt('partial'), verify = cnt('verify') + cnt('found'), miss = cnt('miss');

    return {
      available: true,
      text: boardText,
      items: rows,
      counts: { total: rows.length, scored: scored, hit: hit, partial: partial, verify: verify, miss: miss },
      ratio: scored ? Math.round((hit + partial * 0.5) / scored * 100) : null,
      note: '比对只看字面：写了什么、按什么顺序写。没找到不等于没写——反光、距离、字迹都可能让 OCR 漏认；公式方向对不上时只标「待核验」，不直接算错。'
    };
  }

  App.BoardCheck = {
    check: check, CFG: CFG, norm: norm, coverage: coverage,
    snippet: snippet, isFormula: isFormula
  };
})(window);
