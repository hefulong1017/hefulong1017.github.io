/* Warm internal page HTML on intent so clicks feel instant. */
(function () {
  if (!document.createElement) return;
  var seen = Object.create(null);
  var count = 0;
  var MAX = 12;

  function eligible(a) {
    if (!a || !a.href) return false;
    if (a.target === '_blank' || a.hasAttribute('download')) return false;
    if (/\.(zip|pdf|exe|msi|7z|rar|mp4|png|jpe?g|webp|gif)$/i.test(a.pathname)) return false;
    var u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return false;
    if (u.pathname === location.pathname && u.hash) return false;
    if (u.pathname.indexOf('/software/') === 0) return false;
    return /\.(html?|\/)$/.test(u.pathname) || u.pathname.slice(-1) === '/';
  }

  function prefetch(a) {
    if (count >= MAX || !eligible(a)) return;
    var u = new URL(a.href, location.href);
    u.hash = '';
    var key = u.href;
    if (seen[key]) return;
    seen[key] = 1;
    count++;
    var l = document.createElement('link');
    l.rel = 'prefetch';
    l.as = 'document';
    l.href = key;
    document.head.appendChild(l);
  }

  function onIntent(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    setTimeout(function () { prefetch(a); }, 60);
  }

  document.addEventListener('pointerover', onIntent, { passive: true });
  document.addEventListener('touchstart', onIntent, { passive: true });
})();
