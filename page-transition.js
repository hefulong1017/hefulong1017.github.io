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
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var mode = "";
  var t0 = 0;
  var navUrl = "";
  var pulse = false;

  function resize() {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function inside(el) {
    return el && !el.closest("#pt, script, style, noscript, svg, canvas");
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < -20 || r.top > innerHeight + 20) return false;
    if (r.right < -20 || r.left > innerWidth + 20) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity || "1") > .02;
  }

  function push(list, x, y, a, r) {
    list.push({
      tx: x,
      ty: y,
      sx: innerWidth / 2 + (Math.random() - .5) * 60,
      sy: innerHeight / 2 + (Math.random() - .5) * 60,
      vx: (x - innerWidth / 2) / innerWidth + (Math.random() - .5) * .9,
      vy: (y - innerHeight / 2) / innerHeight + (Math.random() - .5) * .9,
      a: a,
      r: r
    });
  }

  function sampleDOM() {
    var list = [];
    var w = innerWidth;
    var h = innerHeight;
    var mobile = w < 640;
    var step = mobile ? 5 : 3.5;
    var cap = mobile ? 6500 : 16000;

    // Text becomes the bright particle skeleton.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    var nodes = 0;
    while ((node = walker.nextNode()) && nodes < 1500) {
      var text = node.nodeValue;
      if (!text || !text.trim()) continue;
      var parent = node.parentElement;
      if (!inside(parent) || !visible(parent)) continue;
      nodes++;
      var range = document.createRange();
      range.selectNodeContents(node);
      var rects = range.getClientRects();
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (r.width < 2 || r.height < 2) continue;
        if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
        var ink = parent.closest("h1,h2,h3,h4,.hero-title,.pinn-feature h1") ? .82 : .55;
        for (var yy = Math.max(0, r.top); yy < Math.min(h, r.bottom); yy += step) {
          for (var xx = Math.max(0, r.left); xx < Math.min(w, r.right); xx += step) {
            push(list, xx + (Math.random() - .5) * 2, yy + (Math.random() - .5) * 2, ink * (.72 + Math.random() * .28), 1.8 + Math.random() * 1.9);
          }
        }
      }
    }

    // Glass surfaces and images become the faint structural outline.
    var surfaces = document.querySelectorAll(".feature,.pinn-feature,.q-card,.acc-block,.code-card,.product,.app-card,.portrait,.panel,.side,.reader,.toolbox,.nav,.qa-card,.example,.method");
    for (var s = 0; s < surfaces.length; s++) {
      var el = surfaces[s];
      if (!inside(el) || !visible(el)) continue;
      var b = el.getBoundingClientRect();
      var top = Math.max(0, b.top);
      var bottom = Math.min(h, b.bottom);
      var left = Math.max(0, b.left);
      var right = Math.min(w, b.right);
      for (var x = left; x < right; x += 13) {
        push(list, x, top, .24, 1.2);
        push(list, x, bottom, .24, 1.2);
      }
      for (var y = top; y < bottom; y += 13) {
        push(list, left, y, .24, 1.2);
        push(list, right, y, .24, 1.2);
      }
      var fstep = mobile ? 12 : 10;
      for (var fy = top; fy < bottom; fy += fstep) {
        for (var fx = left; fx < right; fx += fstep) {
          if (Math.random() < .42) push(list, fx, fy, .10 + Math.random() * .08, .7 + Math.random() * .9);
        }
      }
    }

    if (list.length > cap) {
      var keep = [];
      var stride = list.length / cap;
      for (var k = 0; k < cap; k++) keep.push(list[Math.floor(k * stride)]);
      return keep;
    }
    return list;
  }

  function startAmbient(count) {
    for (var i = 0; i < count; i++) {
      particles.push({
        tx: Math.random() * innerWidth,
        ty: Math.random() * innerHeight,
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        sx: Math.random() * innerWidth,
        sy: Math.random() * innerHeight,
        vx: (Math.random() - .5) * .45,
        vy: (Math.random() - .5) * .45,
        a: .12 + Math.random() * .35,
        r: .5 + Math.random() * 1.4,
        ambient: true
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

    if (mode === "out") {
      var t = Math.min(1, elapsed / 620);
      var ease = 1 - Math.pow(1 - t, 3);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.ambient) {
          p.x += p.vx;
          p.y += p.vy;
          ctx.globalAlpha = p.a * (1 - t);
          ctx.fillStyle = "#fff";
          ctx.fillRect(p.x, p.y, p.r, p.r);
          continue;
        }
        var px = p.tx + p.vx * (ease * w * .55);
        var py = p.ty + p.vy * (ease * h * .55);
        ctx.globalAlpha = Math.max(0, p.a * (1 - t * 1.12));
        ctx.fillStyle = "#fff";
        var size = p.r * (1 - t * .55);
        ctx.fillRect(px, py, size, size);
      }
    } else if (mode === "in") {
      var q = Math.min(1, elapsed / 620);
      var e = 1 - Math.pow(1 - q, 3);
      for (var j = 0; j < particles.length; j++) {
        var q2 = particles[j];
        if (q2.ambient) {
          q2.x += q2.vx;
          q2.y += q2.vy;
          ctx.globalAlpha = q2.a * (1 - q * .7);
          ctx.fillStyle = "#fff";
          ctx.fillRect(q2.x, q2.y, q2.r, q2.r);
          continue;
        }
        var nx = q2.sx + (q2.tx - q2.sx) * e;
        var ny = q2.sy + (q2.ty - q2.sy) * e;
        ctx.globalAlpha = Math.min(q2.a, .08 + q2.a * e);
        ctx.fillStyle = "#fff";
        ctx.fillRect(nx, ny, q2.r, q2.r);
      }
    } else if (mode === "pulse") {
      var u = Math.min(1, elapsed / 520);
      for (var k = 0; k < particles.length; k++) {
        var pk = particles[k];
        if (pk.ambient) continue;
        pk.tx += pk.vx * .9;
        pk.ty += pk.vy * .9;
        pk.a *= .978;
        ctx.globalAlpha = Math.max(0, pk.a) * (1 - u);
        ctx.fillStyle = "#fff";
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

  function fallbackBurst() {
    particles = [];
    mode = "out";
    t0 = 0;
    startAmbient(100);
    if (!raf) raf = requestAnimationFrame(draw);
    setTimeout(function () { location.href = navUrl; }, 460);
  }

  function explode(px, py, url) {
    resize();
    navUrl = url;
    try { sessionStorage.setItem("ptGo", "1"); } catch (e) {}
    pt.style.display = "block";
    pt.style.opacity = "1";
    pt.style.background = "transparent";
    pt.className = "pt-out pt-shot";
    particles = sampleDOM();
    window.__ptCount = particles.length;
    if (!particles.length) {
      fallbackBurst();
      return;
    }
    document.documentElement.classList.add("pt-leave");
    mode = "out";
    window.__ptMode = mode;
    t0 = 0;
    startAmbient(320);
    if (!raf) raf = requestAnimationFrame(draw);
    setTimeout(function () { location.href = url; }, 660);
  }

  function assemble() {
    if (booted) return;
    booted = true;
    leaving = true;
    resize();
    pt.style.display = "block";
    pt.style.opacity = "1";
    pt.style.background = "transparent";
    pt.className = "pt-boot pt-shot";
    particles = sampleDOM();
    if (!particles.length) {
      settle();
      return;
    }
    document.documentElement.classList.add("pt-enter");
    mode = "in";
    t0 = 0;
    startAmbient(180);
    if (!raf) raf = requestAnimationFrame(draw);
    setTimeout(function () { document.documentElement.classList.add("pt-reveal"); }, 430);
    setTimeout(function () {
      pt.style.opacity = "0";
      setTimeout(settle, 260);
    }, 620);
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
        tx: x + (Math.random() - .5) * 10,
        ty: y + (Math.random() - .5) * 10,
        x: x,
        y: y,
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
    if (!animate) {
      booted = true;
      settle();
      return;
    }
    setTimeout(assemble, 80);
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
    var px = event.clientX || innerWidth / 2;
    var py = event.clientY || innerHeight / 2;
    explode(px, py, url.href);
  });

  // Nested menus, categories and accordions get a short white particle burst.
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
