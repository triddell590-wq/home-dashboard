// localStorage that never throws: blocked storage simply forgets.
// Every key is kept as home-<key>, because other apps on the same site (Farm Ledger) share this storage.
// Outside a browser (Node test runs) there is no document and storage is skipped, because merely
// reading globalThis.localStorage makes recent Node versions print an ExperimentalWarning.
const PREFIX = "home-";

// Keys this app once saved without the prefix, and how to tell its own value from another app's.
const UNPREFIXED = {
  theme: (value) => value === "midnight" || value === "daylight",
  route: (value) => typeof value === "string" && value.startsWith("#/"),
};

function deviceStorage() {
  try {
    return typeof document === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The old unprefixed value, moved to its new key on the way. Undefined when there is none of ours. */
function moveOld(key, storage) {
  const raw = UNPREFIXED[key] ? storage.getItem(key) : null;
  if (raw === null) return undefined;
  const value = JSON.parse(raw);
  if (!UNPREFIXED[key](value)) return undefined;
  try {
    storage.setItem(PREFIX + key, raw);
    storage.removeItem(key);
  } catch {
    /* storage full: keep the old value for next time */
  }
  return value;
}

export function get(key, fallback = null, storage = deviceStorage()) {
  try {
    const raw = storage ? storage.getItem(PREFIX + key) : null;
    if (raw !== null) return JSON.parse(raw);
    return (storage ? moveOld(key, storage) : undefined) ?? fallback;
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
