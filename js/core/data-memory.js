// In-memory Data backend: stores full paths, clones values, notifies watchers in a microtask.
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const segments = (path) => path.split("/").filter(Boolean);
const isDoc = (path) => segments(path).length % 2 === 0;
const parentOf = (path) => segments(path).slice(0, -1).join("/");

export function createMemoryData() {
  const store = new Map();
  let watchers = new Set();

  function listOf(collection) {
    const out = [];
    for (const [path, value] of store) {
      if (parentOf(path) === collection) out.push({ id: segments(path).pop(), ...clone(value) });
    }
    return out;
  }
  function snapshot(path) {
    return isDoc(path) ? clone(store.has(path) ? store.get(path) : null) : listOf(path);
  }
  function notify(path) {
    const parent = parentOf(path);
    queueMicrotask(() => {
      for (const w of [...watchers]) {
        if (!watchers.has(w)) continue;
        if (w.path === path || w.path === parent) w.cb(snapshot(w.path));
      }
    });
  }

  return {
    async get(path) {
      return store.has(path) ? clone(store.get(path)) : null;
    },
    async set(path, value) {
      store.set(path, clone(value));
      notify(path);
    },
    async update(path, fields) {
      if (!store.has(path)) throw new Error("Nothing to update");
      store.set(path, { ...store.get(path), ...clone(fields) });
      notify(path);
    },
    async remove(path) {
      store.delete(path);
      notify(path);
    },
    async list(collection) {
      return listOf(collection);
    },
    watch(path, cb) {
      const w = { path, cb };
      watchers.add(w);
      cb(snapshot(path));
      return () => watchers.delete(w);
    },
    pending: () => false,
    onPending: () => () => {},
    reset() {
      store.clear();
      watchers = new Set();
    },
  };
}
