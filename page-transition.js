(function () {
  var pt = document.getElementById("pt");
  if (!pt) return;

  var seen = Object.create(null);
  var leaving = false;
  var booted = false;
  var canvas = document.createElement("canvas");
  canvas.className = "pt-canvas";
  pt.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var particles = [];
  var raf = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function start(x, y, count, power) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var speed = (0.7 + Math.random() * 2.2) * power;
      particles.push({
        x: x + (Math.random() - .5) * 16,
        y: y + (Math.random() - .5) * 16,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: .7 + Math.random() * 2.3,
        life: 1,
        decay: .012 + Math.random() * .018,
        hue: Math.random() < .72 ? 205 : 32
      });
    }
    for (var j = 0; j < 120; j++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - .5) * .35,
        vy: (Math.random() - .5) * .35,
        r: .5 + Math.random() * 1.8,
        life: .45 + Math.random() * .45,
        decay: .004 + Math.random() * .008,
        hue: Math.random() < .8 ? 205 : 32
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= .986;
      p.vy *= .986;
      p.life -= p.decay;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      var alpha = Math.max(0, p.life) * .9;
      ctx.beginPath();
      ctx.fillStyle = "hsla(" + p.hue + ",100%,72%," + alpha + ")";
      ctx.shadowColor = "hsla(" + p.hue + ",100%,62%," + alpha + ")";
      ctx.shadowBlur = 12;
      ctx.arc(p.x, p.y, p.r * (0.6 + p.life * .7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    raf = particles.length ? requestAnimationFrame(tick) : 0;
  }

  function finish() {
    pt.classList.remove("pt-boot");
    pt.classList.remove("pt-out");
    pt.style.opacity = "0";
    particles = [];
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function boot(animate) {
    if (booted) return;
    booted = true;
    resize();
    if (!animate) {
      finish();
      return;
    }
    pt.classList.remove("pt-out");
    pt.style.setProperty("--pt-x", "50%");
    pt.style.setProperty("--pt-y", "50%");
    pt.classList.add("pt-boot");
    pt.style.opacity = "1";
    start(window.innerWidth / 2, window.innerHeight / 2, 130, 3.2);
    setTimeout(function () {
      pt.classList.remove("pt-boot");
      pt.style.opacity = "0";
    }, 360);
    setTimeout(finish, 840);
  }

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
    var px = event.clientX || window.innerWidth / 2;
    var py = event.clientY || window.innerHeight / 2;
    resize();
    pt.style.setProperty("--pt-x", px + "px");
    pt.style.setProperty("--pt-y", py + "px");
    pt.classList.add("pt-out");
    pt.style.opacity = "1";
    start(px, py, 240, 5.4);
    try { sessionStorage.setItem("ptGo", "1"); } catch (e) {}
    setTimeout(function () { location.href = url.href; }, 580);
  });

  function initial() {
    var animate = false;
    try { animate = sessionStorage.getItem("ptGo") === "1"; sessionStorage.removeItem("ptGo"); } catch (e) {}
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav && nav.type === "back_forward") animate = true;
    } catch (e) {}
    boot(animate);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initial, { once: true });
  else initial();

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      leaving = false;
      booted = false;
      boot(true);
    }
  });
})();
