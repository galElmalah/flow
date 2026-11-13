// Live GitHub stats for galElmalah/flow. Falls back gracefully when the
// repository is private or the API rate-limits (no count, just "Star").
(function () {
  const REPO = "galElmalah/flow";
  const KEY = "flow-gh-stats";
  const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

  function countUp(el, to) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
    const dur = 1400, t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(Math.round(to * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function apply(data) {
    document.querySelectorAll("[data-stars]").forEach((el) => {
      if (data && typeof data.stars === "number") countUp(el, data.stars);
      else el.textContent = el.dataset.fallback || "Star";
    });
    document.querySelectorAll("[data-forks]").forEach((el) => {
      if (data && typeof data.forks === "number") countUp(el, data.forks);
      else el.textContent = el.dataset.fallback || "Fork";
    });
    document.documentElement.classList.toggle("gh-live", !!(data && typeof data.stars === "number"));
  }

  async function load() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return apply(cached);
    } catch {}
    try {
      const r = await fetch("https://api.github.com/repos/" + REPO, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const data = { stars: j.stargazers_count, forks: j.forks_count, at: Date.now() };
      try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch {}
      apply(data);
    } catch {
      apply(null);
    }
  }

  window.FLOW_REPO = "https://github.com/" + REPO;
  // Only opt in once the repository is public. A private-repo API request
  // produces a browser network error even when the rejection is caught.
  if (document.documentElement.dataset.githubStats === "public") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
    else load();
  }

  // Copy-to-clipboard for any [data-copy] button
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const src = document.querySelector(b.dataset.copy);
    const text = src ? src.innerText.replace(/^\$ /gm, "") : b.dataset.copy;
    if (b.disabled) return;
    const old = b.textContent;
    b.disabled = true;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Embedded viewers may deny Clipboard API access. Copy the selected
      // source through the document instead; keep it selected if that fails.
      if (src) {
        const selection = window.getSelection(), range = document.createRange();
        range.selectNodeContents(src); selection.removeAllRanges(); selection.addRange(range);
        try { copied = document.execCommand("copy"); } catch {}
        if (copied) selection.removeAllRanges();
      }
    }
    if (copied) {
      b.classList.add("copied");
      b.textContent = "Copied";
    } else {
      b.textContent = "Select and copy";
    }
    setTimeout(() => { b.textContent = old; b.classList.remove("copied"); b.disabled = false; }, 1600);
  });
})();
