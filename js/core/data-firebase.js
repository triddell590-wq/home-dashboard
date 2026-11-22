// Firestore Data backend. Takes the global `firebase` (compat SDK) as a parameter so it imports in Node.
// Receives full paths (startData() has already added users/{uid}/); each one is re-validated with fullPath().

export function fullPath(uid, path) {
  if (!uid) throw new Error("Not signed in");
  const p = String(path || "");
  if (!p || p.startsWith("/") || p.split("/").some((s) => s === "" || s === "..")) throw new Error("Bad path");
  return `users/${uid}/${p}`;
}

// Accepts users/{uid}/<rest>, validates <rest> through fullPath, and returns the same full path.
function checked(path) {
  const [root, uid, ...rest] = String(path).split("/");
  if (root !== "users") throw new Error("Bad path");
  return fullPath(uid, rest.join("/"));
}
const isDoc = (path) => path.split("/").length % 2 === 0;

export function createFirebaseData(firebase, config) {
  if (!firebase.apps.length) firebase.initializeApp(config);
  const db = firebase.firestore();
  const ready = db.enablePersistence({ synchronizeTabs: true }).catch((e) => {
    // failed-precondition (another tab without sync) or unimplemented (no IndexedDB): run online-only.
    console.warn(`Offline storage unavailable (${(e && e.code) || "unknown"}); changes won't be kept offline.`);
  });

  const watches = new Map(); // id -> { unsubscribe, hasPending }
  const listeners = new Set();
  let nextId = 0;
  let lastPending = false;

  const computePending = () => [...watches.values()].some((w) => w.hasPending);
  function refreshPending() {
    const now = computePending();
    if (now === lastPending) return;
    lastPending = now;
    listeners.forEach((cb) => cb(now));
  }
  let stopInSync = db.onSnapshotsInSync(refreshPending);

  const docRef = (path) => db.doc(path);
  const toList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    async get(path) {
      const p = checked(path);
      await ready;
      if (isDoc(p)) {
        const snap = await docRef(p).get();
        return snap.exists ? snap.data() : null;
      }
      return toList(await db.collection(p).get());
    },
    async set(path, value) {
      const p = checked(path);
      await ready;
      await docRef(p).set(value);
    },
    async update(path, fields) {
      const p = checked(path);
      await ready;
      try {
        await docRef(p).update(fields);
      } catch (e) {
        if (e && e.code === "not-found") throw new Error("Nothing to update");
        throw e;
      }
    },
    async remove(path) {
      const p = checked(path);
      await ready;
      await docRef(p).delete();
    },
    async list(collection) {
      const p = checked(collection);
      await ready;
      return toList(await db.collection(p).get());
    },
    watch(path, cb) {
      const p = checked(path);
      const id = nextId++;
      const entry = { unsubscribe: () => {}, hasPending: false };
      watches.set(id, entry);
      let stopped = false;
      ready.then(() => {
        if (stopped) return;
        const target = isDoc(p) ? docRef(p) : db.collection(p);
        entry.unsubscribe = target.onSnapshot({ includeMetadataChanges: true }, (snap) => {
          entry.hasPending = snap.metadata.hasPendingWrites;
          cb(isDoc(p) ? (snap.exists ? snap.data() : null) : toList(snap));
          refreshPending();
        }, (e) => {
          // The listener is dead (e.g. permission-denied): stop counting its writes as pending.
          entry.hasPending = false;
          refreshPending();
          console.warn(`Live updates stopped for ${p} (${(e && e.code) || "unknown"}).`);
        });
      });
      return () => {
        stopped = true;
        entry.unsubscribe();
        watches.delete(id);
        refreshPending();
      };
    },
    pending: () => computePending(),
    onPending(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    // Sign-out cleanup: stop everything, close Firestore, then wipe the on-device copy of the data.
    // The Firestore instance is unusable afterwards, so the page must reload before signing in again.
    async reset() {
      watches.forEach((w) => w.unsubscribe());
      watches.clear();
      listeners.clear();
      stopInSync();
      await db.terminate();
      await db.clearPersistence();
    },
  };
}
