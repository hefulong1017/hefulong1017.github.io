(function (w) {
  "use strict";
  var memory = Object.create(null);
  function probe(store) {
    try {
      var k = "__dsh_probe__";
      store.setItem(k, "1");
      store.removeItem(k);
      return store;
    } catch (e) { return null; }
  }
  var local = null, session = null;
  try { local = probe(w.localStorage); } catch (e) {}
  try { session = probe(w.sessionStorage); } catch (e) {}
  function get(store, key, fallback) {
    if (!store) return key in memory ? memory[key] : fallback;
    try {
      var v = store.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function set(store, key, value) {
    memory[key] = String(value);
    if (!store) return false;
    try { store.setItem(key, String(value)); return true; }
    catch (e) { return false; }
  }
  function remove(store, key) {
    delete memory[key];
    if (!store) return;
    try { store.removeItem(key); } catch (e) {}
  }
  w.SafeStore = {
    get: function (key, fallback) { return get(local, key, fallback); },
    set: function (key, value) { return set(local, key, value); },
    remove: function (key) { remove(local, key); },
    sessionGet: function (key, fallback) { return get(session, key, fallback); },
    sessionSet: function (key, value) { return set(session, key, value); },
    sessionRemove: function (key) { remove(session, key); },
    getTheme: function () {
      var saved = get(local, "theme", "");
      if (saved === "dark" || saved === "light") return saved;
      return w.matchMedia && w.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },
    setTheme: function (theme) { return set(local, "theme", theme); }
  };
})(window);


(function () {
  "use strict";
  try {
    var forced = document.documentElement.getAttribute("data-force-theme");
    var theme = (forced === "dark" || forced === "light") ? forced : window.SafeStore.getTheme();
    document.documentElement.setAttribute("data-theme", theme);
    function syncMeta() {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta && !meta.getAttribute("data-managed")) {
        meta.setAttribute("content", theme === "dark" ? "#0b0b0d" : "#f5f5f7");
      }
    }
    syncMeta();
    document.addEventListener("DOMContentLoaded", syncMeta, { once: true });
    var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", function (e) {
        var lock = document.documentElement.getAttribute("data-force-theme");
        if (lock === "dark" || lock === "light") return;
        if (window.SafeStore.get("theme", "")) return;
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      });
    }
  } catch (e) {
    document.documentElement.setAttribute("data-theme",
      document.documentElement.getAttribute("data-force-theme") === "dark" ? "dark" : "light");
  }
})();
