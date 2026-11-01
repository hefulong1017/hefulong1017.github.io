(function () {
  "use strict";

  const DATA = window.GAOKAO;
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const state = { cat: null, year: "", region: "", query: "", visible: 20 };
  const PAGE = 20;

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
    return DATA.categories.find((c) => c.id === id) || null;
  }

  function yearLabel(years) {
    if (!years || !years.length) return "";
    return years.length === 1 ? String(years[0]) : years[0] + "–" + years[years.length - 1];
  }

  function renderCats() {
    $("stat-total").textContent = DATA.total.toLocaleString("zh-CN");
    $("stat-cats").textContent = String(DATA.categories.length);
    catsEl.innerHTML = DATA.categories.map((cat, i) => `
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

  function openCategory(id, opts) {
    const cat = catById(id);
    if (!cat) return;
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
    renderBrowser();
    setHash();
    if (!opts || opts.scroll !== false) {
      browserEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
        q.figure ? `<span class="fig-badge">含图</span>` : "",
      ].join("");
      const figure = q.figure ? `
        <button class="fig-toggle" type="button" aria-expanded="false" data-fig="${esc(q.figure.id)}" data-src="${esc(q.figure.path || "")}">查看原题配图 <span aria-hidden="true">↓</span></button>
        <div class="q-figure" hidden><img alt="原题配图" loading="lazy"></div>` : "";
      return `<article class="q-card">
        <div class="q-meta">${meta}<span class="num">${q.number ? "第 " + q.number + " 题" : ""}</span></div>
        <div class="q-text">${q.html}</div>
        ${figure}
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
    if (!cat) return;
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

  qList.addEventListener("click", async (e) => {
    const btn = e.target.closest(".fig-toggle");
    if (!btn) return;
    const box = btn.nextElementSibling;
    if (!box) return;
    const img = box.querySelector("img");
    if (img && !img.getAttribute("src")) {
      let src = btn.dataset.src;
      if (!src) {
        await loadFigureData();
        src = (window.GAOKAO_FIGURES || {})[btn.dataset.fig] || "";
      }
      if (src) img.src = src;
    }
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.innerHTML = open ? '收起原题配图 <span aria-hidden="true">↑</span>' : '查看原题配图 <span aria-hidden="true">↓</span>';
  });

  let figurePromise = null;
  function loadFigureData() {
    if (window.GAOKAO_FIGURES) return Promise.resolve();
    if (figurePromise) return figurePromise;
    figurePromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "gaokao-figures.js";
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
    return figurePromise;
  }

  window.addEventListener("hashchange", () => {
    const h = readHash();
    if (h.cat && h.cat !== state.cat) {
      state.year = h.year; state.region = h.region; state.query = h.query;
      openCategory(h.cat, { keepFilters: true, scroll: false });
    }
  });

  renderCats();
  const initial = readHash();
  if (initial.cat) {
    state.year = initial.year;
    state.region = initial.region;
    state.query = initial.query;
    openCategory(initial.cat, { keepFilters: true, scroll: false });
  }
})();