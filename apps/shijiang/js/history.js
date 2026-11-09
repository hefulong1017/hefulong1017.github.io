/* ==========================================================================
   history.js — 历史记录列表
   · 全部读 IndexedDB，按时间倒序
   · 卡片颜色跟等级走，一眼能看出哪次最好
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;

  var GRADE_BG = {
    'A+': 'linear-gradient(135deg,#00a862,#007a4d)',
    'A': 'linear-gradient(135deg,#34c759,#00a862)',
    'B': 'linear-gradient(135deg,#0071e3,#0051a8)',
    'C': 'linear-gradient(135deg,#ff9f0a,#c96f00)',
    'D': 'linear-gradient(135deg,#ff3b30,#b3241c)'
  };

  function esc(s) { return util.escape(s); }

  var SHORT = {
    content: '内容', fluency: '流畅', pause: '停顿',
    filler: '口头禅', board: '板书', speed: '语速', posture: '仪态'
  };

  function cardHTML(s) {
    var g = s.grade || { key: '—', label: '' };
    var bg = GRADE_BG[g.key] || 'linear-gradient(135deg,#6e6e73,#48484a)';
    var topic = s.topic || '未填写课题';
    var total = s.total != null ? s.total.toFixed(1) : '—';

    var media = s.poster
      ? 'style="background-image:url(' + s.poster + ')"'
      : 'style="background:' + bg + '"';

    var dims = (s.dims || []).filter(function (d) { return d && d.score != null; }).map(function (d) {
      var cls = d.score < 60 ? ' bad' : (d.score < 72 ? ' low' : '');
      var pct = Math.max(4, Math.min(100, d.score));
      return '<div class="hdim' + cls + '" title="' + esc(d.name) + ' ' + d.score + ' 分">' +
        '<b><i style="width:' + pct + '%"></i></b>' +
        '<span>' + esc(SHORT[d.key] || d.name) + '</span>' +
      '</div>';
    }).join('');

    var audioOnly = !!(s.report && s.report.audioOnly) || /^audio\//.test(s.mime || '');
    var meta = [
      esc(util.fmtDay(s.ts)),
      util.fmtTime(s.duration || 0),
      audioOnly ? '纯语音' : (s.hasVideo ? '有录像' : '无录像')
    ];
    if (s.chars) meta.push(s.chars + ' 字逐字稿');

    return '' +
      '<article class="hcard" data-id="' + esc(s.id) + '">' +
        '<div class="hcard-media" ' + media + '>' +
          '<span class="hcard-chip ' + (s.hasVideo ? 'play' : '') + '">' +
            esc(g.key) + (audioOnly ? ' · 纯语音' : (s.hasVideo ? ' · 点开回放' : '')) +
          '</span>' +
        '</div>' +
        '<div class="hcard-main">' +
          '<div class="hcard-line">' +
            '<h3 class="hcard-topic">' + esc(topic) + '</h3>' +
            '<span class="hcard-points">' + total + '<i>分</i></span>' +
          '</div>' +
          '<div class="hcard-meta">' + meta.join(' · ') + '</div>' +
          (dims ? '<div class="hcard-dims">' + dims + '</div>' : '') +
          (s.snippet ? '<p class="hcard-snip">' + esc(s.snippet) + '</p>' : '') +
          '<div class="hcard-actions">' +
            '<button class="btn btn-primary btn-xs" type="button" data-act="open">查看报告</button>' +
            (s.hasVideo ? '<button class="btn btn-ghost btn-xs" type="button" data-act="play">' + (audioOnly ? '回放录音' : '回放录像') + '</button>' : '') +
            '<button class="btn btn-ghost btn-xs" type="button" data-act="del" aria-label="删除这条记录">删除</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  var history = App.history = {

    render: function (list) {
      var box = document.getElementById('historyList');
      var empty = document.getElementById('historyEmpty');
      if (!box) return;

      list = (list || []).slice().sort(function (a, b) { return b.ts - a.ts; });

      if (!list.length) {
        box.innerHTML = '';
        if (empty) empty.hidden = false;
        return;
      }
      if (empty) empty.hidden = true;
      box.innerHTML = list.map(cardHTML).join('');
    },

    load: function () {
      return App.db.listSessions().then(function (list) {
        history.cache = list || [];
        history.render(history.cache);
        return list;
      }).catch(function (e) {
        console.warn('[history] load failed', e);
        history.render([]);
        return [];
      });
    },

    cache: [],

    find: function (id) {
      return history.cache.filter(function (s) { return s.id === id; })[0] || null;
    },

    remove: function (id) {
      return App.db.deleteSession(id).then(function () {
        return App.db.deleteVideo(id).catch(function () {});
      }).then(function () {
        history.cache = history.cache.filter(function (s) { return s.id !== id; });
        history.render(history.cache);
      });
    },

    bind: function () {
      var box = document.getElementById('historyList');
      if (!box || box._bound) return;
      box._bound = true;

      box.addEventListener('click', function (ev) {
        var card = ev.target.closest('.hcard');
        if (!card) return;
        var id = card.getAttribute('data-id');
        var act = ev.target.getAttribute('data-act');
        var item = history.find(id);

        if (!act) {
          if (App.app && App.app.openSession) App.app.openSession(id);
          return;
        }

        if (act === 'open') {
          if (App.app && App.app.openSession) App.app.openSession(id);
        } else if (act === 'play') {
          if (App.app && App.app.playSession) App.app.playSession(id);
        } else if (act === 'del') {
          var topic = item && item.topic ? item.topic : '这条记录';
          App.ui.confirm({
            title: '删除这条记录？',
            text: '「' + topic + '」的报告、逐字稿和录像都会从本机删除，不可恢复。',
            okText: '删除',
            danger: true
          }).then(function (ok) {
            if (!ok) return;
            history.remove(id).then(function () {
              App.ui.toast('已删除', 'ok');
            });
          });
        }
      });
    }
  };

})(window);