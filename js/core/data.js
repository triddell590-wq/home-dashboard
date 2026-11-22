// The storage interface every view uses. Backends (memory, Firebase) plug in through useData().
// Paths are relative to the signed-in user: an even number of segments is a document
// (settings/profile), an odd number is a collection (settings).
let impl = null;
let active = null;

export function chooseBackend(search, config) {
  if (String(search || "").includes("backend=memory")) return "memory";
  if (!config || !config.apiKey) return "memory";
  return "firebase";
}

export function useData(backend) {
  impl = backend;
  active = null;
}

// Wraps a backend so every path lives under users/{uid}/.
function scoped(backend, uid) {
  const p = (path) => `users/${uid}/${path}`;
  return {
    get: (path) => backend.get(p(path)),
    set: (path, value) => backend.set(p(path), value),
    update: (path, fields) => backend.update(p(path), fields),
    remove: (path) => backend.remove(p(path)),
    list: (collection) => backend.list(p(collection)),
    watch: (path, cb) => backend.watch(p(path), cb),
    pending: () => backend.pending(),
    onPending: (cb) => backend.onPending(cb),
    reset: () => backend.reset(),
  };
}

export function startData(uid) {
  if (!impl) throw new Error("No data backend");
  active = scoped(impl, uid);
}

export function data() {
  if (!active) throw new Error("Not signed in");
  return active;
}
