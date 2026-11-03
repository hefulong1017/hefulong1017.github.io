(function () {
  var pt = document.getElementById("pt");
  if (!pt) return;
  if (pt.parentElement !== document.documentElement) document.documentElement.appendChild(pt);

  var seen = Object.create(null);
  var leaving = false;
  var booted = false;
  var canvas = document.createElement("canvas");
  canvas.className = "pt-canvas";
  pt.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var particles = [];
  var raf = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.25 : 1.5);
  var mode = "";
  var t0 = 0;
  var navUrl = "";
  var pulse = false;

  function resize() {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = "alphabetic";
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < -24 || r.top > innerHeight + 24) return false;
    if (r.right < -24 || r.left > innerWidth + 24) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity || "1") > .02;
  }

  function sampleGlyphs() {
    var list = [];
    var mobile = innerWidth < 640;
    var cap = mobile ? 1200 : 2200;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode()) && list.length < cap) {
      var text = node.nodeValue;
      if (!text || !text.trim()) continue;
      var parent = node.parentElement;
      if (!parent || !visible(parent)) continue;
      if (parent.closest("#pt, script, style, noscript, svg, canvas")) continue;
      var cs = getComputedStyle(parent);
      var font = (cs.fontStyle || "normal") + " " + (cs.fontWeight || "400") + " " + (cs.fontSize || "14px") + " " + (cs.fontFamily || "sans-serif");
      var alpha = parent.closest("h1,h2,h3,h4,.hero-title,.pinn-feature h1") ? 1 : .9;
      for (var i = 0; i < text.length && list.length < cap; i++) {
        var ch = text[i];
        if (/\s/.test(ch)) continue;
        var range = document.createRange();
        try { range.setStart(node, i); range.setEnd(node, i + 1); } catch (e) { continue; }
        var r = range.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        list.push({
          ch: ch,
          font: font,
          x: r.left,
          y: r.top + r.height * .82,
          tx: r.left,
          ty: r.top + r.height * .82,
          vx: (r.left - innerWidth / 2) / innerWidth + (Math.random() - .5) * 1.2,
          vy: (r.top - innerHeight / 2) / innerHeight + (Math.random() - .5) * 1.2,
          a: alpha * (.96 + Math.random() * .04)
        });
      }
    }
    var surfaces = document.querySelectorAll(".feature,.pinn-feature,.product,.app-card,.acc-block,.code-card,.portrait,.panel,.side,.reader,.qa-card,.example,.method,.nav,.hero");
    var fill = mobile ? 9 : 7;
    for (var si = 0; si < surfaces.length && list.length < (mobile ? 5200 : 9000); si++) {
      var el = surfaces[si];
      if (!visible(el)) continue;
      var b = el.getBoundingClientRect();
      var left = Math.max(0, b.left), right = Math.min(innerWidth, b.right);
      var top = Math.max(0, b.top), bottom = Math.min(innerHeight, b.bottom);
      for (var yy = top; yy < bottom; yy += fill) {
        for (var xx = left; xx < right; xx += fill) {
          if (Math.random() > .82) continue;
          list.push({
            dot: true,
            x: xx, y: yy, tx: xx, ty: yy,
            vx: (xx - innerWidth / 2) / innerWidth + (Math.random() - .5) * 1.1,
            vy: (yy - innerHeight / 2) / innerHeight + (Math.random() - .5) * 1.1,
            a: .34 + Math.random() * .3,
            r: 1.1 + Math.random() * 1.8
          });
        }
      }
    }
    return list;
  }

  function startAmbient(count, inward) {
    for (var i = 0; i < count; i++) {
      particles.push({
        ambient: true,
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        sx: innerWidth / 2 + (Math.random() - .5) * innerWidth * .8,
        sy: innerHeight / 2 + (Math.random() - .5) * innerHeight * .8,
        vx: (Math.random() - .5) * .5,
        vy: (Math.random() - .5) * .5,
        a: .08 + Math.random() * .28,
        r: .5 + Math.random() * 1.5,
        inward: !!inward
      });
    }
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function draw(now) {
    if (!t0) t0 = now;
    var elapsed = now - t0;
    var w = innerWidth;
    var h = innerHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "alphabetic";

    if (mode === "out") {
      var t = Math.min(1, elapsed / 700);
      var ease = 1 - Math.pow(1 - t, 3);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.ambient) {
          p.x += p.vx;
          p.y += p.vy;
          ctx.globalAlpha = p.a * (1 - t);
          ctx.fillRect(p.x, p.y, p.r, p.r);
          continue;
        }
        var px = p.tx + p.vx * ease * w * .26;
        var py = p.ty + p.vy * ease * h * .26;
        var life = t < .62 ? 1 : Math.max(0, 1 - (t - .62) / .38);
        ctx.globalAlpha = Math.min(1, p.a * life);
        if (p.dot) { ctx.fillRect(px, py, p.r, p.r); continue; }
        if (ctx.font !== p.font) ctx.font = p.font;
        ctx.fillText(p.ch, px, py);
      }
    } else if (mode === "in") {
      var q = Math.min(1, elapsed / 640);
      var e = 1 - Math.pow(1 - q, 3);
      for (var j = 0; j < particles.length; j++) {
        var g = particles[j];
        if (g.ambient) {
          g.x = g.sx + (g.x - g.sx) * .01 + Math.sin(elapsed * .002 + j) * .2;
          g.y += g.vy;
          ctx.globalAlpha = g.a * (1 - q * .75);
          ctx.fillRect(g.x, g.y, g.r, g.r);
          continue;
        }
        var nx = g.sx + (g.tx - g.sx) * e;
        var ny = g.sy + (g.ty - g.sy) * e;
        ctx.globalAlpha = Math.min(1, .12 + g.a * e);
        if (g.dot) { ctx.fillRect(nx, ny, g.r, g.r); continue; }
        if (ctx.font !== g.font) ctx.font = g.font;
        ctx.fillText(g.ch, nx, ny);
      }
    } else if (mode === "pulse") {
      var u = Math.min(1, elapsed / 520);
      for (var k = 0; k < particles.length; k++) {
        var pk = particles[k];
        if (pk.ambient) continue;
        pk.tx += pk.vx * 1.1;
        pk.ty += pk.vy * 1.1;
        pk.a *= .975;
        ctx.globalAlpha = Math.max(0, pk.a) * (1 - u);
        ctx.fillRect(pk.tx, pk.ty, pk.r, pk.r);
      }
    }

    ctx.globalAlpha = 1;
    if (particles.length || mode) raf = requestAnimationFrame(draw);
    else raf = 0;
  }

  function settle() {
    pt.className = "";
    pt.style.display = "none";
    pt.style.opacity = "0";
    pt.style.background = "";
    document.documentElement.classList.remove("pt-hide", "pt-leave", "pt-enter", "pt-reveal");
    particles = [];
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    t0 = 0;
    mode = "";
    pulse = false;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  function explode(px, py, url) {
    resize();
    navUrl = url;
    try { sessionStorage.setItem("ptGo", "1"); } catch (e) {}
    pt.style.display = "block";
    pt.style.opacity = "1";
    pt.style.background = "transparent";
    pt.className = "pt-out pt-shot";
    particles = sampleGlyphs();
    if (!particles.length) {
      document.documentElement.classList.add("pt-leave");
      setTimeout(function () { location.href = url; }, 300);
      return;
    }
    document.documentElement.classList.add("pt-leave");
    mode = "out";
    t0 = 0;
    startAmbient(150);
    if (!raf) raf = requestAnimationFrame(draw);
    setTimeout(function () { location.href = url; }, 760);
  }

  function assemble() {
    if (booted) return;
    booted = true;
    leaving = true;
    document.documentElement.classList.add("pt-enter");
    resize();
    pt.style.display = "block";
    pt.style.opacity = "1";
    pt.style.background = "transparent";
    pt.className = "pt-boot";
    particles = sampleGlyphs();
    for (var i = 0; i < particles.length; i++) {
      var g = particles[i];
      g.sx = innerWidth / 2 + (Math.random() - .5) * 80;
      g.sy = innerHeight / 2 + (Math.random() - .5) * 80;
    }
    if (!particles.length) { settle(); return; }
    mode = "in";
    t0 = 0;
    startAmbient(90);
    if (!raf) raf = requestAnimationFrame(draw);
    setTimeout(function () { document.documentElement.classList.add("pt-reveal"); }, 180);
    setTimeout(function () {
      pt.style.transition = "opacity .55s cubic-bezier(.22,.61,.36,1)";
      pt.style.opacity = "0";
      setTimeout(function () {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        particles = [];
        ctx.clearRect(0, 0, innerWidth, innerHeight);
      }, 560);
    }, 200);
    setTimeout(settle, 1080);
  }

  function pulseAt(x, y) {
    if (leaving || mode) return;
    resize();
    pt.style.display = "block";
    pt.style.opacity = "1";
    pt.style.background = "transparent";
    pt.className = "pt-pulse";
    particles = [];
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * Math.PI * 2;
      var speed = .5 + Math.random() * 3.4;
      particles.push({
        ambient: true,
        x: x, y: y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        a: .25 + Math.random() * .65,
        r: .7 + Math.random() * 1.8
      });
    }
    mode = "pulse";
    t0 = 0;
    if (!raf) raf = requestAnimationFrame(draw);
    setTimeout(function () {
      pt.style.background = "";
      settle();
    }, 560);
  }

  function boot(animate) {
    if (booted) return;
    if (!animate) { booted = true; settle(); return; }
    setTimeout(assemble, 60);
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
    explode(event.clientX || innerWidth / 2, event.clientY || innerHeight / 2, url.href);
  });

  document.addEventListener("click", function (event) {
    if (leaving || mode) return;
    var hit = event.target && event.target.closest ? event.target.closest(".acc-head,.cat,.sec") : null;
    if (!hit) return;
    pulseAt(event.clientX || innerWidth / 2, event.clientY || innerHeight / 2);
  }, true);

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
