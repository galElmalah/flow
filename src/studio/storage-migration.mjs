export function migrateBrowserStorage(storage) {
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  );
  for (const key of keys) {
    if (!key?.startsWith("weft:")) continue;
    const target = "flow:" + key.slice("weft:".length);
    if (storage.getItem(target) !== null) continue;
    storage.setItem(target, storage.getItem(key));
    storage.removeItem(key);
  }
}
