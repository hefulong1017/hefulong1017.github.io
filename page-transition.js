(function () {
  var seen = Object.create(null);
  var pt = document.getElementById("pt");
  var leaving = false;

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

  if (!pt) return;

  function reveal() {
    requestAnimationFrame(function () {
      setTimeout(function () { pt.classList.remove("pt-boot"); }, 60);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reveal, { once: true });
  else reveal();
  setTimeout(reveal, 800);

  document.addEventListener("click", function (event) {
    if (leaving || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || link.target || link.hasAttribute("download")) return;
    var url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return;
    if (/\.(pdf|zip|rar|7z|exe|part\d*|mp4|webp|png|jpe?g)$/i.test(url.pathname)) return;
    event.preventDefault();
    leaving = true;
    pt.classList.add("pt-out");
    setTimeout(function () { location.href = url.href; }, 500);
  });

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      leaving = false;
      pt.classList.remove("pt-out");
      pt.classList.remove("pt-boot");
    }
  });
})();
