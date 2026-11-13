/* CSS paints the background with the first HTML frame. WebGL is optional. */
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let liquidWorker;
const surfaces = new Map();
function startLiquid(canvas) {
  if (!canvas.transferControlToOffscreen || !window.Worker || reducedMotion.matches) {
    canvas.dataset.renderer = "static";
    return;
  }
  try {
    if (!liquidWorker) {
      liquidWorker = new Worker("shared/liquid-worker.js");
      liquidWorker.onmessage = ({ data }) => {
        const entry = surfaces.get(data.id);
        if (!entry) return;
        if (data.type === "ready") {
          requestAnimationFrame(() => { entry.canvas.classList.toggle("ready", !reducedMotion.matches); entry.canvas.dataset.renderer = "worker-webgl"; performance.mark(`flow:${data.id}:first-frame`); });
        } else { entry.canvas.dataset.renderer = "static"; }
      };
      liquidWorker.onerror = () => {
        for (const { canvas } of surfaces.values()) { canvas.classList.remove("ready"); canvas.dataset.renderer = "static"; }
        liquidWorker.terminate();
      };
    }
    performance.mark(`flow:${canvas.id}:worker-start`);
    const offscreen = canvas.transferControlToOffscreen();
    surfaces.get(canvas.id).started = true;
    liquidWorker.postMessage({ type: "init", id: canvas.id, canvas: offscreen, width: canvas.clientWidth, height: canvas.clientHeight, dpr: devicePixelRatio, opts: canvas.id === "gl" ? { zoom: 1.6 } : { zoom: 2.4, speed: 1.4 } }, [offscreen]);
  } catch { canvas.dataset.renderer = "static"; }
}
const backgrounds = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    let surface = surfaces.get(entry.target.id);
    if (!surface) {
      if (!entry.isIntersecting) continue;
      surface = { canvas: entry.target, visible: true }; surfaces.set(entry.target.id, surface);
      requestAnimationFrame(() => setTimeout(() => startLiquid(entry.target), 0));
    } else surface.visible = entry.isIntersecting;
    liquidWorker?.postMessage({ type: "visible", id: entry.target.id, visible: surface.visible && !document.hidden && !reducedMotion.matches });
  }
});
document.querySelectorAll(".hero canvas, .end canvas").forEach((canvas) => backgrounds.observe(canvas));
document.addEventListener("visibilitychange", () => { for (const [id, surface] of surfaces) liquidWorker?.postMessage({ type: "visible", id, visible: surface.visible && !document.hidden && !reducedMotion.matches }); });
reducedMotion.addEventListener("change", () => {
  for (const [id, surface] of surfaces) {
    surface.canvas.classList.toggle("ready", !reducedMotion.matches && surface.canvas.dataset.renderer === "worker-webgl");
    if (!reducedMotion.matches && !surface.started && surface.visible) startLiquid(surface.canvas);
    liquidWorker?.postMessage({ type: "visible", id, visible: surface.visible && !document.hidden && !reducedMotion.matches });
  }
});
addEventListener("resize", () => { for (const [id, { canvas }] of surfaces) liquidWorker?.postMessage({ type: "resize", id, width: canvas.clientWidth, height: canvas.clientHeight, dpr: devicePixelRatio }); }, { passive: true });
addEventListener("pointermove", (event) => {
  for (const [id, { canvas, visible }] of surfaces) {
    if (!visible) continue;
    const rect = canvas.getBoundingClientRect();
    liquidWorker?.postMessage({ type: "pointer", id, x: event.clientX - rect.left, y: rect.bottom - event.clientY });
  }
}, { passive: true });

/* Cursor + preview */
(() => {
  const c = document.getElementById("cursor"), pv = document.getElementById("preview");
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches || reducedMotion.matches) return;
  let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, px = x, py = y, frame = 0;
  function animate() {
    frame = 0;
    if (document.hidden) return;
    cx += (x - cx) * .35; cy += (y - cy) * .35; px += (x - px) * .18; py += (y - py) * .18;
    c.style.transform = `translate3d(${cx}px,${cy}px,0)`;
    pv.style.translate = `${px + 24}px ${py - 120}px`; pv.style.rotate = ((x - px) * .04) + "deg";
    if (Math.abs(x - px) + Math.abs(y - py) + Math.abs(x - cx) + Math.abs(y - cy) > .5) frame = requestAnimationFrame(animate);
  }
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    x = e.clientX; y = e.clientY; document.documentElement.classList.add("mouse");
    if (!frame) frame = requestAnimationFrame(animate);
  }, { passive: true });
  addEventListener("touchstart", () => document.documentElement.classList.remove("mouse"), { passive: true });
  const kind = (el) => el?.closest?.("[data-zoom]") ? "big" : el?.closest?.("a, button, .tour li, [role=button]") ? "ring" : "";
  const setC = (k) => { c.classList.toggle("big", k === "big"); c.classList.toggle("ring", k === "ring"); };
  addEventListener("pointerover", (e) => setC(kind(e.target)));
  addEventListener("scroll", () => setC(kind(document.elementFromPoint(x, y))), { passive: true });
  const imgs = {};
  document.querySelectorAll(".row").forEach((r) => {
    const k = r.dataset.img;
    r.addEventListener("pointerenter", () => {
      if (!imgs[k]) {
        const im = new Image(); im.src = `assets/${k}.jpg`; im.alt = ""; im.decoding = "async";
        pv.appendChild(im); imgs[k] = im;
      }
      pv.classList.add("on"); Object.values(imgs).forEach((im) => im.classList.toggle("on", im === imgs[k]));
    });
    r.addEventListener("pointerleave", () => pv.classList.remove("on"));
  });
})();

/* Scroll: statement word light-up */
(() => {
  const st = document.getElementById("statement");
  st.innerHTML = st.innerHTML.replace(/(<em>.*?<\/em>|[^\s<]+)/g, '<span class="w">$1</span>');
  const words = [...st.querySelectorAll(".w")];
  function on() {
    const r = st.getBoundingClientRect(); const p = Math.max(0, Math.min(1, (innerHeight * .9 - r.top) / (innerHeight * .55)));
    words.forEach((w, i) => w.classList.toggle("on", i / words.length < p));
  }
  addEventListener("scroll", on, { passive: true }); on();
})();

/* Lightbox: anything with data-zoom expands to its full-size screenshot */
(() => {
  const lb = document.getElementById("lb"), im = lb.querySelector("img"), x = lb.querySelector(".x");
  let back = null;
  const open = (z) => {
    back = z; im.src = z.dataset.zoom; im.alt = z.getAttribute("alt") || z.querySelector("img")?.alt || "Flow screenshot";
    lb.classList.add("on"); lb.setAttribute("aria-hidden", "false"); document.documentElement.classList.add("lb-open"); x.focus({ preventScroll: true });
  };
  const close = () => {
    if (!lb.classList.contains("on")) return;
    lb.classList.remove("on"); lb.setAttribute("aria-hidden", "true"); document.documentElement.classList.remove("lb-open"); back?.focus({ preventScroll: true });
  };
  document.addEventListener("click", (e) => { if (lb.contains(e.target)) return close(); const z = e.target.closest("[data-zoom]"); if (z) open(z); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return close();
    if (e.key === "Tab" && lb.classList.contains("on")) { e.preventDefault(); x.focus(); return; }
    const z = e.target.closest?.("[data-zoom][role=button], .tour li");
    if (z && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); z.click(); }
  });
})();

/* Workflow steps: one gentle reveal */
(() => {
  const cards = [...document.querySelectorAll("#flow4 > li")];
  if (!("IntersectionObserver" in window)) return cards.forEach((c) => c.classList.add("in"));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  cards.forEach((c) => io.observe(c));
})();

/* Region editing tour over the real editor screenshots (1778×1235) */
(() => {
  const ed = document.getElementById("editor"), cam = document.getElementById("cam"), hl = document.getElementById("hl"), tour = document.getElementById("tour"), items = [...tour.children];
  const W = 1778, H = 1235;
  // view = camera rectangle, box = highlight, after = show recolored version
  const steps = [
    { view: [900, 0, 878, 610], box: [1338, 16, 142, 42] },
    { view: [1000, 60, 778, 541], box: [1276, 128, 306, 570] },
    { view: [560, 190, 900, 625], box: [772, 302, 410, 216] },
    { view: [470, 190, 860, 597], box: [770, 328, 210, 112], after: true },
    { view: [0, 690, 780, 542], box: [14, 980, 850, 120], after: true },
  ];
  let cur = 0, timer = null, paused = reducedMotion.matches;
  function show(i) {
    cur = i; const s = steps[i], [vx, vy, vw] = s.view, k = W / vw;
    cam.style.transform = `scale(${k}) translate(${-vx / W * 100}%, ${-vy / H * 100}%)`;
    const [bx, by, bw, bh] = s.box;
    Object.assign(hl.style, { left: (bx - vx) * k / W * 100 + "%", top: (by - vy) * k / H * 100 + "%", width: bw * k / W * 100 + "%", height: bh * k / H * 100 + "%" });
    hl.classList.add("on"); ed.classList.toggle("after", !!s.after);
    ed.dataset.zoom = s.after ? "assets/pink-jersey-result.jpg" : "assets/region-comment.jpg";
    items.forEach((li, j) => { li.classList.toggle("on", j === i); if (j === i) { const bar = li.querySelector("i"); bar.style.animation = "none"; bar.offsetWidth; bar.style.animation = ""; } });
    clearTimeout(timer); if (!paused) timer = setTimeout(() => show((cur + 1) % steps.length), 4200);
  }
  items.forEach((li, i) => li.addEventListener("click", () => { paused = true; tour.classList.add("paused"); show(i); }));
  new IntersectionObserver((es) => { if (es[0].isIntersecting) { if (!timer) show(0); } else { clearTimeout(timer); timer = null; } }, { threshold: .35 }).observe(ed);
})();

/* Define it as code: tabbed source */
(() => {
  const src = window.FLOW_EXAMPLES;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const hi = (line, t) => {
    if (t === "cli") {
      if (/^\s*#/.test(line)) return `<span class="c">${esc(line)}</span>`;
      if (/^→/.test(line)) return `<span class="c">${esc(line)}</span>`;
      return esc(line).replace(/^\$/, '<span class="k">$</span>').replace(/(\sflow|\sgit)\b/, '<span class="p">$1</span>').replace(/(--[a-z-]+)/g, '<span class="n">$1</span>');
    }
    return esc(line).replace(/(\/\/.*$)|("(?:[^"\\]|\\.)*")(\s*:)?|\b(\d+)\b|\b(import|from|const|await|new|with|true|false)\b/g,
      (m, c, s, colon, n, k) => c ? `<span class="c">${c}</span>` : s ? (colon ? `<span class="p">${s}</span>${colon}` : `<span class="s">${s}</span>`) : n ? `<span class="n">${n}</span>` : `<span class="k">${k}</span>`);
  };
  const pre = document.getElementById("src"), tabs = [...document.querySelectorAll("#tabs button")];
  function show(t) {
    tabs.forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    pre.innerHTML = src[t].split("\n").map((l, i) => `<span class="ln" >${hi(l, t) || " "}</span>`).join("");
  }
  tabs.forEach((b) => b.addEventListener("click", () => show(b.dataset.t))); show("file");
})();
