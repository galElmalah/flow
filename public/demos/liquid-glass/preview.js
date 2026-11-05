const studio = document.getElementById("studio");
const world = document.getElementById("world");
const canvas = document.getElementById("canvas");
const library = document.getElementById("library");
const inspector = document.getElementById("inspector");
const status = document.getElementById("live-status");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const notes = {
  solid: [
    "Current · solid black",
    "The current treatment: opaque black surfaces. No artwork passes through.",
  ],
  frosted: [
    "Frosted · soft and quiet",
    "More diffusion and a darker veil. A quieter material for dense settings and long forms.",
  ],
  liquid: [
    "Liquid · readable, smoked glass",
    "Smoked glass, soft depth and a light-catching edge. Artwork stays behind the controls.",
  ],
};
for (const button of document.querySelectorAll("[data-material]")) {
  if (button === studio) continue;
  button.addEventListener("click", () => {
    const material = button.dataset.material;
    studio.dataset.material = material;
    document
      .querySelectorAll(".materials button")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    status.textContent = notes[material][0];
    document.getElementById("material-note").textContent = notes[material][1];
  });
}
function setPanel(panel, open) {
  panel.classList.toggle("is-closed", !open);
  panel.inert = !open;
  panel.setAttribute("aria-hidden", String(!open));
  document
    .getElementById(panel === library ? "toggle-library" : "toggle-inspector")
    .setAttribute("aria-pressed", String(open));
  if (open && innerWidth <= 760) {
    const other = panel === library ? inspector : library;
    other.classList.add("is-closed");
    other.inert = true;
    other.setAttribute("aria-hidden", "true");
    document
      .getElementById(other === library ? "toggle-library" : "toggle-inspector")
      .setAttribute("aria-pressed", "false");
  }
}
document
  .getElementById("toggle-library")
  .addEventListener("click", () =>
    setPanel(library, library.classList.contains("is-closed")),
  );
document
  .getElementById("toggle-inspector")
  .addEventListener("click", () =>
    setPanel(inspector, inspector.classList.contains("is-closed")),
  );
document
  .getElementById("close-library")
  .addEventListener("click", () => setPanel(library, false));
document
  .getElementById("close-inspector")
  .addEventListener("click", () => setPanel(inspector, false));
if (innerWidth <= 760) setPanel(inspector, true);
document
  .getElementById("reduce-transparency")
  .addEventListener("change", (event) => {
    studio.classList.toggle("reduce-transparency", event.target.checked);
    status.textContent = event.target.checked
      ? "Reduced transparency · opaque surfaces"
      : notes[studio.dataset.material][0];
  });
document.getElementById("search").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLocaleLowerCase();
  for (const item of document.querySelectorAll("#library-items button"))
    item.hidden = !item.textContent.toLocaleLowerCase().includes(query);
});
const images = {
  full: {
    title: "Full texture",
    prompt:
      "Compare blue, violet, and peach across the full paper texture. This is illustrative preview copy, with no saved generation or run.",
  },
  cool: {
    title: "Cool color study",
    prompt:
      "Shift the paper colors toward blue and violet. This sample uses a browser color filter on the bundled texture.",
  },
  warm: {
    title: "Warm color study",
    prompt:
      "Shift the paper colors toward peach and rose. This sample uses a browser color filter on the bundled texture.",
  },
  soft: {
    title: "Soft color study",
    prompt:
      "Lower the color intensity to compare glass over a quieter background. This sample uses a browser color filter on the bundled texture.",
  },
};
function inspect(name) {
  const image = images[name];
  document.getElementById("image-title").textContent = image.title;
  document.getElementById("scene-copy").textContent = image.prompt;
  const preview = document.getElementById("inspector-image");
  preview.src = "/assets/paper-seed.png";
  preview.dataset.tone = name;
  document.getElementById("sample-view").textContent = image.title;
  preview.alt = image.title;
  setPanel(inspector, true);
}
document
  .querySelectorAll("[data-image]")
  .forEach((button) =>
    button.addEventListener("click", () => inspect(button.dataset.image)),
  );
document.querySelectorAll("#library-items button").forEach((button) =>
  button.addEventListener("click", () => {
    document.getElementById("search").value = "";
    document
      .querySelectorAll("#library-items button")
      .forEach((item) => (item.hidden = false));
    const kind = button.dataset.kind;
    status.textContent = `${button.querySelector("strong").textContent} · preview selected`;
    if (kind === "image" || kind === "collection" || kind === "generate")
      inspect("full");
    else {
      setPanel(inspector, true);
      document.getElementById("image-title").textContent =
        kind === "set" ? "Prompt Set · 4 sample views" : "Shared art direction";
      document.getElementById("scene-copy").textContent =
        "Explore the bundled paper texture through four sample views. Compare warm and cool colors behind the same glass controls. This preview does not save a workflow or start inference.";
    }
  }),
);
const initialPosition = () => ({
  x: innerWidth <= 760 ? -340 : innerWidth <= 1100 ? -110 : -24,
  y: 0,
});
let origin = initialPosition();
let pan = { ...origin },
  drag = null,
  moved = false;
function renderPan() {
  world.style.setProperty("--pan-x", `${pan.x}px`);
  world.style.setProperty("--pan-y", `${pan.y}px`);
}
window.addEventListener("resize", () => {
  origin = initialPosition();
  pan = { ...origin };
  moved = false;
  renderPan();
  if (innerWidth <= 760) setPanel(inspector, true);
  else {
    setPanel(library, true);
    setPanel(inspector, true);
  }
});
canvas.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  drag = { x: event.clientX, y: event.clientY, start: { ...pan } };
  world.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  pan = {
    x: drag.start.x + event.clientX - drag.x,
    y: drag.start.y + event.clientY - drag.y,
  };
  renderPan();
});
function endDrag() {
  drag = null;
  world.classList.remove("is-dragging");
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
document.getElementById("move-canvas").addEventListener("click", () => {
  moved = !moved;
  pan = { x: origin.x + (moved ? -190 : 0), y: moved ? -105 : 0 };
  renderPan();
  status.textContent = `${notes[studio.dataset.material][0]} · canvas ${moved ? "shifted" : "centered"}`;
});
document.getElementById("reset-canvas").addEventListener("click", () => {
  pan = { ...origin };
  moved = false;
  renderPan();
  status.textContent = notes[studio.dataset.material][0];
});
for (const panel of document.querySelectorAll(".glass")) {
  let frame;
  panel.addEventListener(
    "pointermove",
    (event) => {
      if (reducedMotion.matches || studio.dataset.material !== "liquid") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = panel.getBoundingClientRect();
        panel.style.setProperty(
          "--light-x",
          `${((event.clientX - bounds.left) / bounds.width) * 100}%`,
        );
        panel.style.setProperty(
          "--light-y",
          `${((event.clientY - bounds.top) / bounds.height) * 100}%`,
        );
      });
    },
    { passive: true },
  );
  panel.addEventListener("pointerleave", () => {
    cancelAnimationFrame(frame);
    panel.style.removeProperty("--light-x");
    panel.style.removeProperty("--light-y");
  });
}
