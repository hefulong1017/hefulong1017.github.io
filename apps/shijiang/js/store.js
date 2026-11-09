/* ==========================================================================
   store.js — IndexedDB 持久层
   库：tsj-db
     sessions  { id, topic, createdAt, durationSec, score, grade, report, ... }
     videos    { id, blob, mime, size }
     chunks    { key, sessionId, index, blob, t }   每 10 秒落盘的分段，崩溃可恢复
     texts     { id, transcript, raw }
     assets    { id, kind, dataUrl, createdAt }     板书照片
   所有读写都返回 Promise；IndexedDB 不可用时退化为内存表，功能降级但不白屏。
   ========================================================================== */
(function (window) {
  'use strict';

  var App = window.App;
  var DB_NAME = 'tsj-db';
  var DB_VERSION = 2;
  var STORES = ['sessions', 'videos', 'chunks', 'texts', 'assets', 'shots'];

  var memory = {
    sessions: {}, videos: {}, chunks: {}, texts: {}, assets: {}, shots: {},
    mode: 'memory'
  };

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
    });
  }

  var dbReady = null;

  function open() {
    if (dbReady) return dbReady;
    dbReady = new Promise(function (resolve) {
      if (!window.indexedDB) { memory.mode = 'memory'; return resolve(null); }

      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { memory.mode = 'memory'; return resolve(null); }

      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('videos')) {
          db.createObjectStore('videos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('chunks')) {
          var cs = db.createObjectStore('chunks', { keyPath: 'key' });
          cs.createIndex('bySession', 'sessionId', { unique: false });
        }
        if (!db.objectStoreNames.contains('texts')) {
          db.createObjectStore('texts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('shots')) {
          db.createObjectStore('shots', { keyPath: 'id' });
        }
      };

      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { try { db.close(); } catch (e) {} };
        memory.mode = 'indexeddb';
        resolve(db);
      };
      req.onerror = function () {
        console.warn('[db] open failed, fallback to memory', req.error);
        memory.mode = 'memory';
        resolve(null);
      };
      req.onblocked = function () {
        console.warn('[db] open blocked by another tab');
      };
    });
    return dbReady;
  }

  function getStore(db, name, mode) {
    var tx = db.transaction(name, mode || 'readonly');
    return { tx: tx, store: tx.objectStore(name) };
  }

  /* ------------------------------------------------------------------ API */
  var db = App.db = {
    get mode() { return memory.mode; },

    init: open,

    /* ---------- 会话 ---------- */
    putSession: function (session) {
      return open().then(function (d) {
        if (!d) { memory.sessions[session.id] = session; return session.id; }
        var s = getStore(d, 'sessions', 'readwrite');
        s.store.put(session);
        return txDone(s.tx).then(function () { return session.id; });
      });
    },

    getSession: function (id) {
      return open().then(function (d) {
        if (!d) return memory.sessions[id] || null;
        return reqToPromise(getStore(d, 'sessions').store.get(id)).then(function (r) { return r || null; });
      });
    },

    listSessions: function () {
      return open().then(function (d) {
        if (!d) {
          return Object.keys(memory.sessions).map(function (k) { return memory.sessions[k]; })
            .sort(function (a, b) { return b.createdAt - a.createdAt; });
        }
        return reqToPromise(getStore(d, 'sessions').store.getAll()).then(function (list) {
          return (list || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
        });
      });
    },

    deleteSession: function (id) {
      return open().then(function (d) {
        if (!d) {
          delete memory.sessions[id]; delete memory.videos[id]; delete memory.texts[id]; delete memory.shots[id];
          Object.keys(memory.chunks).forEach(function (k) { if (memory.chunks[k].sessionId === id) delete memory.chunks[k]; });
          Object.keys(memory.assets).forEach(function (k) { if (memory.assets[k].sessionId === id) delete memory.assets[k]; });
          return;
        }
        return Promise.all([
          (function () { var s = getStore(d, 'sessions', 'readwrite'); s.store.delete(id); return txDone(s.tx); })(),
          (function () { var s = getStore(d, 'videos', 'readwrite'); s.store.delete(id); return txDone(s.tx); })(),
          (function () { var s = getStore(d, 'texts', 'readwrite'); s.store.delete(id); return txDone(s.tx); })(),
          (function () { var s = getStore(d, 'shots', 'readwrite'); s.store.delete(id); return txDone(s.tx); })(),
          App.db.clearChunks(id).catch(function () {})
        ]);
      });
    },

    /* ---------- 视频 ---------- */
    putVideo: function (id, blob, mime) {
      return open().then(function (d) {
        var rec = { id: id, blob: blob, mime: mime || (blob && blob.type) || '', size: blob ? blob.size : 0, t: Date.now() };
        if (!d) { memory.videos[id] = rec; return rec; }
        var s = getStore(d, 'videos', 'readwrite');
        s.store.put(rec);
        return txDone(s.tx).then(function () { return rec; })
          .catch(function (err) {
            console.warn('[db] putVideo failed (quota?)', err);
            memory.videos[id] = rec;
            throw err;
          });
      });
    },

    getVideo: function (id) {
      return open().then(function (d) {
        if (!d) return memory.videos[id] || null;
        return reqToPromise(getStore(d, 'videos').store.get(id)).then(function (r) { return r || null; });
      });
    },

    deleteVideo: function (id) {
      return open().then(function (d) {
        if (!d) { delete memory.videos[id]; return; }
        var s = getStore(d, 'videos', 'readwrite');
        s.store.delete(id);
        return txDone(s.tx);
      });
    },

    /* ---------- 分段（崩溃恢复） ---------- */
    putChunk: function (sessionId, index, blob) {
      return open().then(function (d) {
        var rec = { key: sessionId + ':' + index, sessionId: sessionId, index: index, blob: blob, t: Date.now() };
        if (!d) { memory.chunks[rec.key] = rec; return; }
        var s = getStore(d, 'chunks', 'readwrite');
        s.store.put(rec);
        return txDone(s.tx).catch(function (e) { console.warn('[db] putChunk failed', e); });
      });
    },

    listChunks: function (sessionId) {
      return open().then(function (d) {
        if (!d) {
          return Object.keys(memory.chunks).map(function (k) { return memory.chunks[k]; })
            .filter(function (c) { return c.sessionId === sessionId; })
            .sort(function (a, b) { return a.index - b.index; });
        }
        var s = getStore(d, 'chunks');
        var idx = s.store.index('bySession');
        return reqToPromise(idx.getAll(IDBKeyRange.only(sessionId))).then(function (list) {
          return (list || []).sort(function (a, b) { return a.index - b.index; });
        });
      });
    },

    allChunks: function () {
      return open().then(function (d) {
        if (!d) return Object.keys(memory.chunks).map(function (k) { return memory.chunks[k]; });
        return reqToPromise(getStore(d, 'chunks').store.getAll()).then(function (r) { return r || []; });
      });
    },

    clearChunks: function (sessionId) {
      return open().then(function (d) {
        if (!d) {
          Object.keys(memory.chunks).forEach(function (k) { if (memory.chunks[k].sessionId === sessionId) delete memory.chunks[k]; });
          return;
        }
        var s = getStore(d, 'chunks', 'readwrite');
        var idx = s.store.index('bySession');
        var req = idx.openCursor(IDBKeyRange.only(sessionId));
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) return;
          cur.delete();
          cur.continue();
        };
        return txDone(s.tx);
      });
    },

    /* ---------- 逐字稿 ---------- */
    putText: function (id, payload) {
      return open().then(function (d) {
        var rec = { id: id, transcript: payload.transcript || [], raw: payload.raw || '' };
        if (!d) { memory.texts[id] = rec; return; }
        var s = getStore(d, 'texts', 'readwrite');
        s.store.put(rec);
        return txDone(s.tx);
      });
    },

    getText: function (id) {
      return open().then(function (d) {
        if (!d) return memory.texts[id] || null;
        return reqToPromise(getStore(d, 'texts').store.get(id)).then(function (r) { return r || null; });
      });
    },

    /* ---------- 素材（板书照片） ---------- */
    putAsset: function (asset) {
      return open().then(function (d) {
        if (!d) { memory.assets[asset.id] = asset; return asset.id; }
        var s = getStore(d, 'assets', 'readwrite');
        s.store.put(asset);
        return txDone(s.tx).then(function () { return asset.id; });
      });
    },

    getAsset: function (id) {
      return open().then(function (d) {
        if (!d) return memory.assets[id] || null;
        return reqToPromise(getStore(d, 'assets').store.get(id)).then(function (r) { return r || null; });
      });
    },

    /* ---------- 画面时间线（每 30 秒一张截图） ---------- */
    putShots: function (id, shots) {
      return open().then(function (d) {
        if (!d) { memory.shots[id] = shots; return id; }
        var s = getStore(d, 'shots', 'readwrite');
        s.store.put({ id: id, frames: shots, ts: Date.now() });
        return txDone(s.tx).then(function () { return id; });
      });
    },

    getShots: function (id) {
      return open().then(function (d) {
        if (!d) return memory.shots[id] || null;
        return reqToPromise(getStore(d, 'shots').store.get(id)).then(function (r) {
          return (r && r.frames) || null;
        });
      });
    },

    deleteShots: function (id) {
      return open().then(function (d) {
        if (!d) { delete memory.shots[id]; return; }
        var s = getStore(d, 'shots', 'readwrite');
        s.store.delete(id);
        return txDone(s.tx);
      });
    },

    /* ---------- 全清 ---------- */
    wipe: function () {
      return open().then(function (d) {
        memory.sessions = {}; memory.videos = {}; memory.chunks = {}; memory.texts = {}; memory.assets = {}; memory.shots = {};
        if (!d) return;
        var tx = d.transaction(STORES, 'readwrite');
        STORES.forEach(function (n) { try { tx.objectStore(n).clear(); } catch (e) {} });
        return txDone(tx);
      });
    },

    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().catch(function () { return null; });
      }
      return Promise.resolve(null);
    }
  };

  /* --------------------------------------------------- 崩溃恢复用的草稿标记 */
  var DRAFT_KEY = 'tsj.draft.v1';
  App.draft = {
    save: function (d) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {}
    },
    read: function () {
      try {
        var raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    clear: function () { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  };

})(window);