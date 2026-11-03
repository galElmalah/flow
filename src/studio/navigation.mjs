import { viewerPath, viewerParams } from '../../shared/viewer-routes.mjs';
export { viewerParams };
export function navigateViewer(target, { replace = false } = {}) {
  const path = viewerPath(target);
  if (window.location.pathname + window.location.search + window.location.hash === path) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}
export function updateViewerTarget(change, options) {
  const target = Object.fromEntries(viewerParams(window.location));
  for (const [key, value] of Object.entries(change)) {
    if (value === null || value === undefined || value === false) delete target[key];
    else target[key] = value;
  }
  navigateViewer(target, options);
}
