// Flow documentation enhancements: search, navigation drawer, contents
// scrollspy, reading progress and copy buttons. Every page works without it.
// User text is only ever inserted with textContent / text nodes.
(() => {
  "use strict";
  const doc = document.documentElement;
  doc.classList.replace("no-js", "js");
  const root = doc.dataset.root || "./";
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 959px)");
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const el = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes))
      if (name === "class") node.className = value;
      else node.setAttribute(name, value);
    node.append(...children);
    return node;
  };
  const live = el("div", { class: "sr-only", "aria-live": "polite" });
  document.body.append(live);
  const announce = (text) => {
    live.textContent = "";
    requestAnimationFrame(() => (live.textContent = text));
  };

  for (const key of $$("kbd")) if (key.textContent === "⌘K") key.textContent = mac ? "⌘K" : "Ctrl K";
  // Without JavaScript the menu and search triggers are links to the full page
  // list. Enhanced, they become real buttons, so Enter and Space work natively.
  const toButton = (link) => {
    const button = el("button", { type: "button", class: link.className });
    for (const name of ["aria-label", "aria-controls", "aria-keyshortcuts"])
      if (link.hasAttribute(name)) button.setAttribute(name, link.getAttribute(name));
    button.append(...link.childNodes);
    const focused = document.activeElement === link;
    link.replaceWith(button);
    if (focused) button.focus({ preventScroll: true });
    return button;
  };
  document.addEventListener("visibilitychange", () =>
    doc.classList.toggle("paused", document.hidden),
  );

  /* ---------- navigation drawer (phones and tablets) ---------- */
  const sidebar = $("#sidebar");
  const menu = toButton($(".menu-btn"));
  const scrim = $(".scrim");
  const closeButton = $(".drawer-close");
  const scroller = $(".side-scroll");
  let drawerOpener = null;
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-label", "Open navigation");
  closeButton.hidden = false;
  const drawerOpen = () => sidebar.classList.contains("open");
  function setDrawer(open) {
    if (open === drawerOpen()) return;
    sidebar.classList.toggle("open", open);
    scrim.classList.toggle("on", open);
    doc.classList.toggle("drawer-open", open);
    menu.setAttribute("aria-expanded", String(open));
    for (const node of [$(".topbar"), $("#content")]) node.inert = open;
    if (open) {
      drawerOpener = document.activeElement;
      const current = $('[aria-current="page"]', sidebar) || closeButton;
      current.focus({ preventScroll: true });
      revealCurrent();
    } else (drawerOpener || menu).focus({ preventScroll: true });
  }
  menu.addEventListener("click", () => setDrawer(!drawerOpen()));
  closeButton.addEventListener("click", () => setDrawer(false));
  scrim.addEventListener("click", () => setDrawer(false));
  narrow.addEventListener("change", () => setDrawer(false));
  sidebar.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !drawerOpen()) return;
    const focusable = $$("a[href], button:not([hidden]), summary", sidebar).filter(
      (node) => node.offsetParent !== null,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  // Keep the current page visible inside the independently scrolling sidebar.
  function revealCurrent() {
    const current = $('[aria-current="page"]', scroller);
    if (!current) return;
    const top = current.offsetTop - scroller.clientHeight / 2 + current.offsetHeight / 2;
    if (current.offsetTop < scroller.scrollTop || current.offsetTop + current.offsetHeight > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = Math.max(0, top);
  }
  revealCurrent();

  /* ---------- copy buttons ---------- */
  async function copy(text, source, button) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Embedded frames can deny the Clipboard API; try a selection copy instead.
      const buffer = el("textarea", { class: "copy-buffer", readonly: "", tabindex: "-1", "aria-hidden": "true" });
      buffer.value = text;
      document.body.append(buffer);
      buffer.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {}
      buffer.remove();
      button.focus({ preventScroll: true });
      if (copied) return true;
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return false;
    }
  }
  for (const block of $$(".code-block")) {
    const code = $("code", block);
    const label = block.dataset.language ? `Copy ${block.dataset.language} code` : "Copy code";
    const button = el("button", { type: "button", class: "copy", "aria-label": label }, "Copy");
    let timer;
    button.addEventListener("click", async () => {
      const copied = await copy(code.textContent, code, button);
      button.classList.remove("copied", "failed");
      button.classList.add(copied ? "copied" : "failed");
      button.textContent = copied ? "Copied" : mac ? "Press ⌘C" : "Press Ctrl+C";
      announce(copied ? "Copied to clipboard" : "Copying is blocked here. The code is selected; copy it with your keyboard.");
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("copied", "failed");
      }, copied ? 1800 : 4000);
    });
    block.append(button);
  }

  /* ---------- contents scrollspy and reading progress ---------- */
  const tocLinks = $$(".toc-list a");
  const headings = [...new Set(tocLinks.map((link) => decodeURIComponent(link.hash.slice(1))))]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const marker = $(".toc-marker");
  const tocScroll = $(".toc-scroll");
  const bar = $(".progress i");
  const topbar = $(".topbar");
  let active;
  let queued = false;
  function update() {
    queued = false;
    const max = doc.scrollHeight - innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 1})`;
    if (!headings.length) return;
    const line = topbar.offsetHeight + 40;
    let current = null;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= line) current = heading;
      else break;
    }
    // Short final sections can never reach the line; the page end selects the last.
    if (max > 0 && max - scrollY < 4) current = headings[headings.length - 1];
    const id = current ? current.id : null;
    if (id === active) return;
    active = id;
    for (const link of tocLinks) {
      const on = decodeURIComponent(link.hash.slice(1)) === id;
      link.classList.toggle("active", on);
      if (on) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    const link = tocScroll && $(".active", tocScroll);
    if (!marker) return;
    marker.classList.toggle("on", !!link);
    if (!link) return;
    marker.style.transform = `translateY(${link.offsetTop}px)`;
    marker.style.height = `${link.offsetHeight}px`;
    const { scrollTop, clientHeight } = tocScroll;
    if (link.offsetTop < scrollTop + 16 || link.offsetTop + link.offsetHeight > scrollTop + clientHeight - 16)
      tocScroll.scrollTo({ top: link.offsetTop - clientHeight / 2, behavior: reduced.matches ? "auto" : "smooth" });
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  addEventListener("hashchange", schedule);
  addEventListener("load", schedule);
  update();
  for (const link of $$(".toc-inline a"))
    link.addEventListener("click", () => (link.closest("details").open = false));

  /* ---------- pointer light on cards ---------- */
  document.addEventListener(
    "pointermove",
    (event) => {
      const card = event.target.closest?.(".card, .surfaces a, .pager a");
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - box.left}px`);
      card.style.setProperty("--my", `${event.clientY - box.top}px`);
    },
    { passive: true },
  );

  /* ---------- search ---------- */
  let dialog, input, list, status, records, loading, opener, closing;
  let results = [];
  let selected = -1;
  const suggested = ["SETUP.html", "guide/installation.html", "AGENTS.html", "guide/mcp.html", "guide/PROVIDERS.html", "examples/README.html"];

  function loadIndex() {
    if (records) return Promise.resolve(records);
    loading ||= new Promise((resolve, reject) => {
      const script = el("script", { src: `${root}assets/search-index.js` });
      script.onload = () => {
        const pages = window.FLOW_DOCS_INDEX;
        if (!Array.isArray(pages)) return reject(new Error("Invalid index"));
        records = pages.flatMap((page) =>
          page.s.map(([id, heading, text], index) => ({
            url: page.u + (id ? `#${id}` : ""),
            page: page.t,
            group: page.g,
            heading: index ? heading : "",
            text,
            intro: !index,
            pageKey: page.u,
            pageL: page.t.toLowerCase(),
            headingL: (heading || "").toLowerCase(),
            textL: text.toLowerCase(),
          })),
        );
        resolve(records);
      };
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error("Index unavailable"));
      };
      document.head.append(script);
    });
    return loading;
  }

  function find(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const scored = [];
    for (const record of records) {
      let score = 0;
      for (const term of terms) {
        let points = 0;
        if (record.headingL.includes(term))
          points += record.headingL.startsWith(term) || record.headingL.includes(` ${term}`) ? 8 : 5;
        if (record.pageL.includes(term)) points += record.intro ? 9 : 2;
        if (record.textL.includes(term)) points += 1;
        if (!points) {
          score = 0;
          break;
        }
        score += points;
      }
      if (score) scored.push([score + (record.intro ? 0.5 : 0), record]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const perPage = new Map();
    const out = [];
    for (const [, record] of scored) {
      const count = perPage.get(record.pageKey) || 0;
      if (count >= 3) continue;
      perPage.set(record.pageKey, count + 1);
      out.push(record);
      if (out.length === 20) break;
    }
    return { terms, found: out };
  }

  const pattern = (terms) =>
    terms.length ? new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi") : null;
  function marked(text, regex) {
    const fragment = document.createDocumentFragment();
    if (!regex) {
      fragment.append(text);
      return fragment;
    }
    let last = 0;
    for (const match of text.matchAll(regex)) {
      if (!match[0]) continue;
      fragment.append(text.slice(last, match.index), el("mark", {}, match[0]));
      last = match.index + match[0].length;
    }
    fragment.append(text.slice(last));
    return fragment;
  }
  function snippet(record, terms) {
    const lower = record.textL;
    const at = Math.min(...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0), Infinity);
    if (!Number.isFinite(at)) return record.text.slice(0, 150);
    const start = Math.max(0, at - 50);
    return (start ? "…" : "") + record.text.slice(start, start + 170);
  }

  function select(index) {
    const items = $$("[role=option]", list);
    if (!items.length) {
      selected = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    selected = (index + items.length) % items.length;
    items.forEach((item, position) => item.setAttribute("aria-selected", String(position === selected)));
    input.setAttribute("aria-activedescendant", items[selected].id);
    items[selected].scrollIntoView({ block: "nearest" });
  }

  function render() {
    const query = input.value.trim();
    list.replaceChildren();
    selected = -1;
    if (!records) {
      status.textContent = "Loading index…";
      input.setAttribute("aria-expanded", "false");
      return;
    }
    let terms = [];
    if (query) ({ terms, found: results } = find(query));
    else results = suggested.map((url) => records.find((record) => record.intro && record.url === url)).filter(Boolean);
    // The role=status element announces counts; no separate live message needed.
    status.textContent = query
      ? results.length
        ? `${results.length} result${results.length === 1 ? "" : "s"}`
        : "No results"
      : "Suggested";
    input.setAttribute("aria-expanded", String(results.length > 0));
    if (!results.length) {
      const empty = el("li", { class: "search-empty", role: "presentation" }, "No results for “", query, "”. Try a command, provider or file name, or ");
      empty.append(el("a", { href: `${root}index.html#browse` }, "browse all pages"), ".");
      list.append(empty);
      return;
    }
    const regex = pattern(terms);
    results.forEach((record, index) => {
      const title = el("span", { class: "r-title" }, record.page);
      if (record.heading) title.append(el("small", {}, " › ", marked(record.heading, regex)));
      const link = el("a", { href: root + record.url, tabindex: "-1" }, el("span", { class: "r-group" }, record.group), title, el("span", { class: "r-snip" }, marked(snippet(record, terms), regex)));
      link.addEventListener("click", () => closeSearch(true));
      const item = el("li", { id: `search-option-${index}`, role: "option", "aria-selected": "false" }, link);
      item.addEventListener("pointermove", () => selected !== index && select(index));
      list.append(item);
    });
    select(0);
  }

  function build() {
    const icon = $(".search-btn svg").cloneNode(true);
    input = el("input", {
      class: "search-input",
      type: "search",
      role: "combobox",
      placeholder: "Search pages, sections and commands",
      "aria-label": "Search documentation",
      "aria-controls": "search-results",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "go",
    });
    const close = el("button", { type: "button", class: "search-close", "aria-label": "Close search" }, "Esc");
    status = el("p", { class: "search-status", role: "status" });
    list = el("ul", { id: "search-results", class: "search-results", role: "listbox", "aria-label": "Search results" });
    const hint = (keys, text) => el("span", {}, el("kbd", {}, keys), text);
    dialog = el(
      "dialog",
      { class: "search", "aria-label": "Search documentation" },
      el(
        "div",
        { class: "search-panel" },
        el("div", { class: "search-field" }, icon, input, close),
        status,
        list,
        el("div", { class: "search-foot", "aria-hidden": "true" }, hint("↑↓", "to move"), hint("↵", "to open"), hint("Esc", "to close")),
      ),
    );
    close.addEventListener("click", () => closeSearch());
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeSearch();
    });
    dialog.addEventListener("click", (event) => event.target === dialog && closeSearch());
    input.addEventListener("input", render);
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        select(selected + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter" && selected >= 0) {
        event.preventDefault();
        $("a", $$("[role=option]", list)[selected]).click();
      }
    });
    document.body.append(dialog);
  }

  function openSearch() {
    if (!dialog) build();
    if (dialog.open) {
      // Reopened mid-close: cancel the pending close and keep the dialog.
      clearTimeout(closing);
      closing = null;
      dialog.classList.add("on");
      return input.focus();
    }
    if (drawerOpen()) setDrawer(false);
    opener = document.activeElement;
    dialog.showModal();
    void dialog.offsetWidth; // commit the hidden state so the entrance transitions
    dialog.classList.add("on");
    input.focus();
    input.select();
    render();
    loadIndex().then(render, () => {
      status.textContent = "";
      list.replaceChildren(el("li", { class: "search-empty", role: "presentation" }, "The search index could not load. ", el("a", { href: `${root}index.html#browse` }, "Browse all pages"), " instead."));
    });
  }
  function closeSearch(navigating = false) {
    if (!dialog?.open || closing) return;
    dialog.classList.remove("on");
    const done = () => {
      closing = null;
      dialog.close();
      if (!navigating) opener?.focus?.({ preventScroll: true });
    };
    if (reduced.matches) done();
    else closing = setTimeout(done, 180);
  }
  for (const trigger of $$(".search-trigger").map(toButton)) {
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.addEventListener("click", () => openSearch());
    trigger.addEventListener("pointerenter", () => loadIndex().catch(() => {}), { once: true });
  }
  const typing = (target) => target.closest?.("input, textarea, select, [contenteditable='true']");
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialog?.open) closeSearch();
      else openSearch();
    } else if (event.key === "/" && !dialog?.open && !typing(event.target)) {
      event.preventDefault();
      openSearch();
    } else if (event.key === "Escape" && drawerOpen()) setDrawer(false);
  });
})();
