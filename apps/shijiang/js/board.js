/* ==========================================================================
   board.js — 板书采集
   · 用 <input type="file" accept="image/*" capture="environment"> 拍照，
     不占用第二路摄像头，避免和前置摄像头打架
   · 图片压到最长边 1600、jpeg 0.86，够看清小字又不会撑爆存储
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var util = App.util;

  var input = null;

  function ensureInput() {
    if (input) return input;
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';
    document.body.appendChild(input);
    return input;
  }

  var Board = App.Board = {

    /** 已采集的板书 */
    data: null,

    /**
     * 打开相机/相册选一张板书
     * @returns {Promise<{dataUrl:string,width:number,height:number}|null>} 取消返回 null
     */
    pick: function () {
      return new Promise(function (resolve) {
        var el = ensureInput();
        var settled = false;

        function finish(v) {
          if (settled) return;
          settled = true;
          el.removeEventListener('change', onChange);
          window.removeEventListener('focus', onFocus, true);
          el.value = '';
          resolve(v);
        }

        function onChange() {
          var file = el.files && el.files[0];
          if (!file) { finish(null); return; }
          if (!/^image\//.test(file.type)) {
            App.ui.toast('请选择图片文件', 'warn');
            finish(null);
            return;
          }
          util.compressImage(file, 1600, 0.86).then(function (dataUrl) {
            var img = new Image();
            img.onload = function () {
              Board.set({ dataUrl: dataUrl, width: img.width, height: img.height });
              finish(Board.data);
            };
            img.onerror = function () { finish(null); };
            img.src = dataUrl;
          }).catch(function (e) {
            App.ui.toast('图片处理失败：' + (e.message || e), 'err');
            finish(null);
          });
        }

        // iOS 取消选择时不会触发 change，靠窗口重新聚焦兜底
        var hadFocus = false;
        function onFocus() {
          if (hadFocus) return;
          hadFocus = true;
          setTimeout(function () {
            if (!el.files || !el.files.length) finish(null);
          }, 400);
        }

        el.addEventListener('change', onChange);
        window.addEventListener('focus', onFocus, true);
        el.click();

        // 兜底：60 秒后仍未选择则放弃
        setTimeout(function () { finish(Board.data || null); }, 60000);
      });
    },

    set: function (data) {
      Board.data = data;
      App.state.board = data;
      App.bus.emit('board', data);
      return data;
    },

    clear: function () {
      Board.data = null;
      App.state.board = null;
      App.bus.emit('board', null);
    },

    has: function () {
      return !!(Board.data && Board.data.dataUrl);
    },

    url: function () {
      return Board.data ? Board.data.dataUrl : '';
    },

    /** 把板书渲染进一个容器（带删除按钮），返回清理函数 */
    mountInto: function (el, opts) {
      opts = opts || {};
      if (!el) return function () {};
      if (!Board.has()) { el.innerHTML = ''; el.hidden = true; return function () {}; }
      el.hidden = false;
      el.innerHTML =
        '<div class="board-preview">' +
          '<img src="' + Board.url() + '" alt="板书照片">' +
          (opts.removable === false ? '' :
          '<button class="board-del" type="button" aria-label="移除板书">' +
            '<svg aria-hidden="true"><use href="#i-close"></use></svg>' +
          '</button>') +
        '</div>';
      var btn = el.querySelector('.board-del');
      function onDel() {
        Board.clear();
        el.innerHTML = '';
        el.hidden = true;
      }
      if (btn) btn.addEventListener('click', onDel);
      return function () { if (btn) btn.removeEventListener('click', onDel); };
    }
  };

})(window);