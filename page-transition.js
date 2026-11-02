(function () {
  var seen = Object.create(null);

  function prefetch(link) {
    if (!link || link.target || link.hasAttribute("download")) return;
    var url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return;
    if (/\.(pdf|zip|rar|7z|exe|part\d*|mp4|webp|png|jpe?g)$/i.test(url.pathname)) return;
    if (seen[url.href]) return;
    seen[url.href] = 1;
    var hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.href = url.href;
    document.head.appendChild(hint);
  }

  function fromEvent(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    prefetch(target.closest("a[href]"));
  }

  document.addEventListener("pointerover", fromEvent, { passive: true });
  document.addEventListener("touchstart", fromEvent, { passive: true });
})();
