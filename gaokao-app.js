(function () {
  "use strict";

  const FULL = window.GAOKAO || null;
  const INDEX = FULL || window.GAOKAO_INDEX;
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const state = { cat: null, year: "", region: "", query: "", visible: 20 };
  let katexReady = false;
  const PAGE = window.matchMedia("(max-width: 640px)").matches ? 8 : 20;
  const KATEX_BASE = document.documentElement.hasAttribute("data-katex-base")
    ? document.documentElement.dataset.katexBase
    : "vendor/katex/";
  const KATEX_AUTO = KATEX_BASE ? KATEX_BASE + "contrib/auto-render.min.js" : "auto-render.min.js";
  const catPromises = {};
  let katexPromise = null;

  function loadKatex() {
    if (typeof renderMathInElement === "function") { katexReady = true; return Promise.resolve(); }
    if (katexPromise) return katexPromise;
    katexPromise = new Promise((resolve) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = KATEX_BASE + "katex.min.css?v=2";
      document.head.appendChild(css);
      const core = document.createElement("script");
      core.src = KATEX_BASE + "katex.min.js?v=2";
      core.onload = () => {
        const render = document.createElement("script");
        render.src = KATEX_AUTO + "?v=2";
        render.onload = () => { katexReady = true; resolve(); };
        render.onerror = resolve;
        document.head.appendChild(render);
      };
      core.onerror = resolve;
      document.head.appendChild(core);
    });
    return katexPromise;
  }

  const themeToggle = $("theme-toggle");
  const themeLabel = $("theme-label");
  const catsEl = $("cats");
  const browserEl = $("browser");
  const catTitle = $("cat-title");
  const catSub = $("cat-sub");
  const catTotal = $("cat-total");
  const crumbName = $("crumb-name");
  const yearRow = $("year-row");
  const regionSel = $("region");
  const searchEl = $("search");
  const qList = $("q-list");
  const emptyEl = $("empty");
  const moreWrap = $("more-wrap");
  const moreBtn = $("more");
  const filterNote = $("filter-note");

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    themeLabel.textContent = theme === "dark" ? "DARK" : "LIGHT";
    themeToggle.setAttribute("aria-label", theme === "dark" ? "切换到浅色主题" : "切换到深色主题");
  }
  const savedTheme = localStorage.getItem("theme");
  applyTheme(savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  themeToggle.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("theme", next);
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function catById(id) {
    if (FULL) return FULL.categories.find((c) => c.id === id) || null;
    return (window.GAOKAO_CATEGORIES || {})[id] || null;
  }

  function loadCategory(id) {
    if (FULL || catById(id)) return Promise.resolve();
    if (catPromises[id]) return catPromises[id];
    catPromises[id] = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "gaokao-data-" + encodeURIComponent(id) + ".js?v=8";
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
    return catPromises[id];
  }

  function yearLabel(years) {
    if (!years || !years.length) return "";
    return years.length === 1 ? String(years[0]) : years[0] + "–" + years[years.length - 1];
  }

  function renderCats() {
    $("stat-total").textContent = INDEX.total.toLocaleString("zh-CN");
    $("stat-cats").textContent = String(INDEX.categories.length);
    catsEl.innerHTML = INDEX.categories.map((cat, i) => `
      <button class="cat" type="button" data-cat="${esc(cat.id)}" aria-label="打开${esc(cat.name)}">
        <span class="arrow" aria-hidden="true">↗</span>
        <span class="idx">${String(i + 1).padStart(2, "0")}</span>
        <h3>${esc(cat.name)}</h3>
        <span class="meta"><span class="count">${cat.count}</span><span class="years">${yearLabel(cat.years)}</span></span>
      </button>`).join("");
  }

  function setHash() {
    const params = new URLSearchParams();
    if (state.cat) params.set("cat", state.cat);
    if (state.year) params.set("year", state.year);
    if (state.region) params.set("region", state.region);
    if (state.query) params.set("q", state.query);
    const hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readHash() {
    const raw = location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    return {
      cat: params.get("cat") || "",
      year: params.get("year") || "",
      region: params.get("region") || "",
      query: params.get("q") || "",
    };
  }

  async function openCategory(id, opts) {
    const meta = INDEX.categories.find((c) => c.id === id);
    if (!meta) return;
    state.cat = id;
    if (!opts || !opts.keepFilters) {
      state.year = "";
      state.region = "";
      state.query = "";
    }
    state.visible = PAGE;
    searchEl.value = state.query;
    $("categories").hidden = true;
    browserEl.classList.add("open");
    crumbName.textContent = meta.name;
    catTitle.textContent = meta.name;
    catSub.textContent = `${yearLabel(meta.years)} · 共 ${meta.count} 道题`;
    catTotal.textContent = "加载中…";
    qList.innerHTML = Array.from({ length: 4 }, () =>
      '<div class="sk-card"><div class="sk-line w40"></div><div class="sk-line"></div><div class="sk-line w90"></div><div class="sk-line w70"></div></div>'
    ).join("");
    emptyEl.hidden = true;
    moreWrap.hidden = true;
    setHash();
    if (!opts || opts.scroll !== false) {
      browserEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const katexPromise = loadKatex();
    await loadCategory(id);
    if (state.cat !== id) return;
    renderBrowser();
    katexPromise.then(() => {
      katexReady = true;
      if (state.cat === id) renderQuestions(true);
    });
  }

  function closeCategory() {
    state.cat = null;
    browserEl.classList.remove("open");
    $("categories").hidden = false;
    setHash();
    $("categories").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderYearChips(cat) {
    const years = cat.years || [];
    yearRow.innerHTML = [`<button class="chip ${state.year === "" ? "active" : ""}" type="button" data-year="">全部</button>`]
      .concat(years.map((y) => `<button class="chip ${String(y) === state.year ? "active" : ""}" type="button" data-year="${y}">${y}</button>`))
      .join("");
  }

  function renderRegions(cat) {
    const regions = Array.from(new Set(cat.questions.map((q) => q.region))).sort((a, b) => a.localeCompare(b, "zh-CN"));
    regionSel.innerHTML = `<option value="">全部地区</option>` + regions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    regionSel.value = state.region;
  }

  function filteredQuestions(cat) {
    const query = state.query.trim().toLowerCase();
    return cat.questions.filter((q) => {
      if (state.year && String(q.year) !== state.year) return false;
      if (state.region && q.region !== state.region) return false;
      if (query) {
        const hay = (q.text + " " + q.region + " " + q.year + " " + q.subject).toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }

  function renderQuestions(reset) {
    const cat = catById(state.cat);
    if (!cat) return;
    if (reset) state.visible = PAGE;
    const list = filteredQuestions(cat);
    const shown = list.slice(0, state.visible);
    filterNote.textContent = `${list.length} 道题${state.query ? " · 已筛选" : ""}`;
    catTotal.textContent = `${list.length} 题`;
    if (!list.length) {
      qList.innerHTML = "";
      emptyEl.hidden = false;
      moreWrap.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    qList.innerHTML = shown.map((q) => {
      const meta = [
        `<span class="year">${q.year}</span>`,
        `<span class="sep">·</span><span>${esc(q.region)}</span>`,
        q.subject && q.subject !== "不分" ? `<span class="sep">·</span><span>${esc(q.subject)}</span>` : "",
        q.score ? `<span class="sep">·</span><span>${q.score} 分</span>` : "",
      ].join("");
      const answer = q.answer ? `
        <button class="ans-toggle" type="button" aria-expanded="false" data-ans="${esc(q.id)}" data-cat="${esc(cat.id)}">显示答案 <span aria-hidden="true">↓</span></button>
        <div class="answer" hidden></div>` : "";
      const figures = Array.isArray(q.figures) && q.figures.length
        ? `<div class="q-figure">${q.figures.map((f) =>
            `<img src="${esc(typeof f === "string" ? f : f.path)}" alt="题目示意图" loading="lazy" onerror="this.parentElement.style.display='none'">`
          ).join("")}</div>`
        : "";
      const options = Array.isArray(q.optionImages) && q.optionImages.length
        ? `<div class="q-option-grid">${q.optionImages.map((src, i) =>
            `<figure><img src="${esc(src)}" alt="选项 ${"ABCD"[i] || i + 1}" loading="lazy"></figure>`
          ).join("")}</div>`
        : "";
      return `<article class="q-card${q.figureOnly ? " figure-only" : ""}">
        <div class="q-meta">${meta}<span class="num"${q.paperNo ? ' title="按原卷题目顺序匹配"' : ''}>${q.paperNo ? "卷面第 " + q.paperNo + " 题" : ""}</span></div>
        <div class="q-text">${katexReady ? q.html : q.html.replace(/\\\((.*?)\\\)/gs, '<span class="math-ph" aria-label="公式加载中"></span>')}</div>
        ${figures}
        ${options}
        ${answer}
        <div class="source"><span>2016–2026 高考真题汇编</span><span>P.${q.page || "—"}</span></div>
      </article>`;
    }).join("");
    moreWrap.hidden = list.length <= state.visible;
    moreBtn.disabled = list.length <= state.visible;
    moreBtn.textContent = `加载更多（还有 ${Math.max(0, list.length - state.visible)} 题）`;
    renderMath(qList);
  }

  function renderMath(el) {
    if (typeof renderMathInElement !== "function") return;
    try {
      renderMathInElement(el, {
        delimiters: [{ left: "\\(", right: "\\)", display: false }],
        throwOnError: false,
        output: "html",
        errorColor: "#b64a32",
        strict: "ignore",
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      });
    } catch (err) {
      console.warn("KaTeX render failed", err);
    }
  }

  function renderBrowser() {
    const cat = catById(state.cat);
    if (!cat) {
      catTotal.textContent = "加载失败";
      return;
    }
    crumbName.textContent = cat.name;
    catTitle.textContent = cat.name;
    catSub.textContent = `${yearLabel(cat.years)} · 共 ${cat.count} 道题`;
    renderYearChips(cat);
    renderRegions(cat);
    renderQuestions(true);
  }

  catsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".cat");
    if (btn) openCategory(btn.dataset.cat);
  });
  $("back-cats").addEventListener("click", closeCategory);

  yearRow.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.year = chip.dataset.year || "";
    state.visible = PAGE;
    renderYearChips(catById(state.cat));
    renderQuestions(true);
    setHash();
  });

  regionSel.addEventListener("change", () => {
    state.region = regionSel.value;
    state.visible = PAGE;
    renderQuestions(true);
    setHash();
  });

  let searchTimer = 0;
  searchEl.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = searchEl.value;
      state.visible = PAGE;
      renderQuestions(true);
      setHash();
    }, 140);
  });

  moreBtn.addEventListener("click", () => {
    state.visible += PAGE;
    renderQuestions(false);
  });

  const answerPromises = {};
  function loadAnswerData(catId) {
    if (window.GAOKAO_ANSWERS && window.GAOKAO_ANSWERS.__cats && window.GAOKAO_ANSWERS.__cats[catId]) {
      return Promise.resolve();
    }
    if (answerPromises[catId]) return answerPromises[catId];
    answerPromises[catId] = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "gaokao-answers-" + encodeURIComponent(catId) + ".js?v=4";
      s.onload = () => {
        window.GAOKAO_ANSWERS = window.GAOKAO_ANSWERS || {};
        window.GAOKAO_ANSWERS.__cats = window.GAOKAO_ANSWERS.__cats || {};
        window.GAOKAO_ANSWERS.__cats[catId] = true;
        resolve();
      };
      s.onerror = resolve;
      document.head.appendChild(s);
    });
    return answerPromises[catId];
  }

  function formatSolution(s) {
    s = String(s || "").replace(/第[一二三四五六七八九十]+步\s*[:：]?\s*/g, "").trim();
    let parts = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 1 && s.length > 160) {
      const sentences = s.split(/(?<=。)/).map((x) => x.trim()).filter(Boolean);
      parts = [];
      for (let i = 0; i < sentences.length; i += 2) {
        parts.push(sentences.slice(i, i + 2).join(""));
      }
    }
    return parts.map((p) => `<p>${esc(p)}</p>`).join("");
  }

  function answerHtml(a) {
    if (!a) return '<div class="ans-empty">这道题的答案还在整理中。</div>';
    let html = "";
    if (a.final) html += `<div class="ans-final">答案：${esc(a.final)}</div>`;
    if (a.solution) html += `<div class="ans-solution">${formatSolution(a.solution)}</div>`;
    if (Array.isArray(a.scoring) && a.scoring.length) {
      const total = a.scoring.reduce((s, x) => s + (Number(x.points) || 0), 0);
      html += `<div class="scoring"><div class="scoring-title">给分点 <span>共 ${total} 分</span></div>`;
      html += '<div class="score-row score-head"><span>步骤</span><span>分值</span></div>';
      for (const row of a.scoring) {
        html += `<div class="score-row"><span>${esc(row.text || "")}</span><span>${row.points != null ? row.points + " 分" : ""}</span></div>`;
      }
      html += "</div>";
    }
    return html;
  }

  qList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".ans-toggle");
    if (!btn) return;
    const box = btn.nextElementSibling;
    if (!box) return;
    if (box.hidden && !box.dataset.loaded) {
      await loadAnswerData(btn.dataset.cat);
      const a = (window.GAOKAO_ANSWERS || {})[btn.dataset.ans];
      box.innerHTML = answerHtml(a);
      box.dataset.loaded = "1";
      renderMath(box);
    }
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.innerHTML = open ? '收起答案 <span aria-hidden="true">↑</span>' : '显示答案 <span aria-hidden="true">↓</span>';
  });

  window.addEventListener("hashchange", () => {
    const h = readHash();
    if (h.cat && h.cat !== state.cat) {
      state.year = h.year; state.region = h.region; state.query = h.query;
      openCategory(h.cat, { keepFilters: true, scroll: false });
    }
  });

  catsEl.addEventListener("pointerdown", (e) => {
    loadKatex();
    const card = e.target.closest(".cat");
    if (card && card.dataset.cat) loadCategory(card.dataset.cat);
  }, { passive: true });
  if ("requestIdleCallback" in window) {
    setTimeout(() => loadKatex(), 400);
  } else {
    setTimeout(() => loadKatex(), 400);
  }
  renderCats();
  const initial = readHash();
  if (initial.cat) {
    state.year = initial.year;
    state.region = initial.region;
    state.query = initial.query;
    openCategory(initial.cat, { keepFilters: true, scroll: false });
  }
})();














