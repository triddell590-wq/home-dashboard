// localStorage that never throws: blocked storage simply forgets.
// Every key is kept as home-<key>, because other apps on the same site (Farm Ledger) share this storage;
// an unprefixed key is theirs and is never touched.
// Outside a browser (Node test runs) there is no document and storage is skipped, because merely
// reading globalThis.localStorage makes recent Node versions print an ExperimentalWarning.
const PREFIX = "home-";

function deviceStorage() {
  try {
    return typeof document === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function get(key, fallback = null, storage = deviceStorage()) {
  try {
    const raw = storage ? storage.getItem(PREFIX + key) : null;
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value, storage = deviceStorage()) {
  try {
    if (storage) storage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: nothing to do */
  }
}
