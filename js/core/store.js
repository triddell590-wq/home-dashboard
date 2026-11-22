// localStorage that never throws: blocked storage simply forgets.
// Outside a browser (Node test runs) there is no document and storage is skipped, because merely
// reading globalThis.localStorage makes recent Node versions print an ExperimentalWarning.
const hasStorage = () => typeof document !== "undefined" && !!globalThis.localStorage;

export function get(key, fallback = null) {
  try {
    const raw = hasStorage() ? localStorage.getItem(key) : null;
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    if (hasStorage()) localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: nothing to do */
  }
}
