const keys = [
  "project",
  "workflow",
  "node",
  "run",
  "gallery",
  "view",
  "editor",
  "section",
];
export const settingsSections = [
  "workspace",
  "providers",
  "image-tools",
  "local-models",
];
const settingsAlias = (section) =>
  ["harnesses", "connections"].includes(section) ? "providers" : section;
const resources = ["project", "workflow", "run", "node", "editor"];
const rank = {
  project: 0,
  workflow: 1,
  run: 2,
  styles: 3,
  gallery: 3,
  node: 4,
  editor: 5,
};
const value = (target, key) =>
  target instanceof URLSearchParams ? target.get(key) : target[key];

function targetValues(target) {
  if (target instanceof URLSearchParams)
    for (const key of keys)
      if (target.getAll(key).length > 1)
        throw new Error(`Repeated viewer ${key}.`);
  const result = {};
  for (const key of resources) {
    const id = value(target, key);
    if (id === undefined || id === null) continue;
    if (typeof id !== "string" || !id.trim() || [".", ".."].includes(id))
      throw new Error(`Viewer ${key} must be a nonempty resource ID.`);
    result[key] = id;
  }
  const view = value(target, "view");
  if (
    view !== undefined &&
    view !== null &&
    !["canvas", "styles", "gallery", "projects", "settings"].includes(view)
  )
    throw new Error("Unknown viewer view.");
  const gallery = value(target, "gallery");
  if (
    gallery !== undefined &&
    gallery !== null &&
    ![true, false, "1", "0", "true", "false"].includes(gallery)
  )
    throw new Error("Viewer gallery must be 1 or 0.");
  const showGallery =
    view === "gallery" || [true, "1", "true"].includes(gallery);
  const section = settingsAlias(value(target, "section"));
  if (view === "settings") {
    if (Object.keys(result).length || showGallery)
      throw new Error("Settings cannot target a project, workflow or image.");
    if (section != null && !settingsSections.includes(section))
      throw new Error("Unknown settings section.");
  } else if (section != null)
    throw new Error("Settings section requires settings view.");
  if (view === "styles" && showGallery)
    throw new Error("Choose the image gallery or style library.");
  if (
    view === "projects" &&
    (result.workflow || result.run || result.node || showGallery)
  )
    throw new Error(
      "Projects view cannot also target a workflow, run, node or gallery.",
    );
  if (result.node && !result.project && !result.workflow && !result.run)
    throw new Error("Choose a project or workflow before opening a node.");
  return { ...result, view, gallery: showGallery, section };
}

/** Canonical human and agent viewer links always use resource paths. */
export function viewerPath(target = {}) {
  const read = targetValues(target);
  if (read.view === "settings")
    return `/settings/${read.section || "workspace"}`;
  const segments = [];
  for (const key of ["project", "workflow", "run"])
    if (read[key]) segments.push(key, read[key]);
  if (read.view === "styles") segments.push("styles");
  else if (read.gallery) segments.push("gallery");
  for (const key of ["node", "editor"])
    if (read[key]) segments.push(key, read[key]);
  if (!segments.length) segments.push("projects");
  return "/" + segments.map(encodeURIComponent).join("/");
}

/** Decode legacy root queries or ordered resource paths into the viewer contract. */
export function viewerParams(location) {
  try {
    const url =
      typeof location === "string"
        ? new URL(location, "http://localhost")
        : location;
    const query = new URLSearchParams(url.search);
    if (url.pathname === "/" || !url.pathname) {
      const params = new URLSearchParams();
      for (const key of keys) {
        if (query.getAll(key).length > 1)
          throw new Error(`Repeated viewer ${key}.`);
        if (query.has(key))
          params.set(
            key,
            key === "section" ? settingsAlias(query.get(key)) : query.get(key),
          );
      }
      return params;
    }
    if (keys.some((key) => query.has(key)))
      throw new Error(
        "Viewer resource paths cannot also contain viewer query targets.",
      );
    if (url.hash)
      throw new Error("Viewer targets belong in the resource path.");
    const raw = url.pathname.replace(/\/$/, "").slice(1).split("/");
    if (raw.some((part) => !part))
      throw new Error("Empty resource in viewer path.");
    const parts = raw.map(decodeURIComponent);
    if (parts[0] === "settings") {
      if (
        parts.length > 2 ||
        (parts[1] && !settingsSections.includes(settingsAlias(parts[1])))
      )
        throw new Error("Unknown settings section.");
      return new URLSearchParams({
        view: "settings",
        section: settingsAlias(parts[1]) || "workspace",
      });
    }
    if (parts.length === 1 && parts[0] === "projects")
      return new URLSearchParams({ view: "projects" });
    const params = new URLSearchParams();
    let previous = -1;
    while (parts.length) {
      const kind = parts.shift();
      if (!Object.hasOwn(rank, kind)) throw new Error("Unknown viewer path.");
      if (rank[kind] <= previous)
        throw new Error("Invalid order or repeated resource in viewer path.");
      previous = rank[kind];
      if (resources.includes(kind)) {
        const id = parts.shift();
        if (!id?.trim() || [".", ".."].includes(id))
          throw new Error(`Viewer ${kind} must have a resource ID.`);
        params.set(kind, id);
      } else if (kind === "styles") params.set("view", "styles");
      else params.set("gallery", "1");
    }
    targetValues(params);
    if (
      !params.has("workflow") &&
      !params.has("run") &&
      !params.has("gallery") &&
      !params.has("view") &&
      !params.has("node")
    )
      params.set("view", "projects");
    return params;
  } catch (error) {
    return new URLSearchParams({ __routeError: error.message });
  }
}
