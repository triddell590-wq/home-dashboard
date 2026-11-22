// In-memory Auth backend for tests and ?backend=memory. Test helpers: addUser, setOffline.
const BAD = "That email and password don't match";
const OFFLINE = "No connection — try again when you're online";
const LOCKED = "Too many tries — wait a few minutes";
const MAX_WRONG = 5;

export function createMemoryAuth() {
  const users = new Map();
  const wrong = new Map();
  const listeners = new Set();
  let offline = false;
  let user = null;

  const key = (email) => String(email).trim().toLowerCase();
  const emit = () => listeners.forEach((cb) => cb(user ? { ...user } : null));

  return {
    addUser(email, password, uid) {
      users.set(key(email), { password, uid, email });
    },
    setOffline(value) {
      offline = !!value;
    },
    onChange(cb) {
      listeners.add(cb);
      cb(user ? { ...user } : null);
      return () => listeners.delete(cb);
    },
    async signIn(email, password) {
      if (offline) throw new Error(OFFLINE);
      const k = key(email);
      if ((wrong.get(k) || 0) >= MAX_WRONG) throw new Error(LOCKED);
      const known = users.get(k);
      if (!known || known.password !== password) {
        wrong.set(k, (wrong.get(k) || 0) + 1);
        throw new Error(BAD);
      }
      wrong.delete(k);
      user = { uid: known.uid, email: known.email };
      emit();
      return { ...user };
    },
    async signOut() {
      user = null;
      emit();
    },
    async sendReset() {
      if (offline) throw new Error(OFFLINE);
    },
    current() {
      return user ? { ...user } : null;
    },
  };
}
