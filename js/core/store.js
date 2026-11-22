// localStorage that never throws: blocked storage simply forgets.

export function get(key, fallback = null) {
  try {
    const raw = globalThis.localStorage && localStorage.getItem(key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    if (globalThis.localStorage) localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: nothing to do */
  }
}
