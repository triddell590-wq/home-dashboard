// Firebase Auth backend. Takes the global `firebase` (compat SDK) as a parameter so it imports in Node.
const BAD = "That email and password don't match";
const OFFLINE = "No connection — try again when you're online";
const LOCKED = "Too many tries — wait a few minutes";
const GENERIC = "Couldn't sign in — try again";
const RESET_FAILED = "Couldn't send the reset email — try again";

export function authMessage(code) {
  switch (code) {
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-credential":
    case "auth/invalid-email":
    case "auth/missing-password":
      return BAD;
    case "auth/network-request-failed":
      return OFFLINE;
    case "auth/too-many-requests":
      return LOCKED;
    default:
      return GENERIC;
  }
}

export function resetMessage(code) {
  const message = authMessage(code);
  return message === OFFLINE || message === LOCKED ? message : RESET_FAILED;
}

// On phones the SDK loads https://apis.google.com/js/api.js before it reports who is signed in, for popup and
// redirect sign-in. This app never uses those, nothing may load from another site, and when that host hangs the
// first screen waits over a minute. With a gapi already present the SDK skips the download; answering "timed
// out" makes it give up on the popup helper at once and carry on.
function skipGoogleScript(scope) {
  if (!scope.gapi) scope.gapi = { load: (_, options) => options.ontimeout() };
}

const shape = (u) => (u ? { uid: u.uid, email: u.email } : null);

export function createFirebaseAuth(firebase, config, scope = globalThis) {
  skipGoogleScript(scope); // must come before the first firebase.auth()
  // The data backend shares the app; initialise only once.
  if (!firebase.apps.length) firebase.initializeApp(config);
  const fa = firebase.auth();
  const persistence = fa.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

  return {
    // Unlike the memory backend this waits for Firebase to restore a saved session before first calling.
    onChange(cb) {
      return fa.onAuthStateChanged((u) => cb(shape(u)));
    },
    async signIn(email, password) {
      await persistence;
      try {
        const cred = await fa.signInWithEmailAndPassword(String(email).trim(), password);
        return shape(cred.user);
      } catch (e) {
        throw new Error(authMessage(e && e.code));
      }
    },
    async signOut() {
      await fa.signOut();
    },
    async sendReset(email) {
      try {
        await fa.sendPasswordResetEmail(String(email).trim());
      } catch (e) {
        // Don't reveal whether an address has an account.
        if (e && e.code === "auth/user-not-found") return;
        throw new Error(resetMessage(e && e.code));
      }
    },
    current() {
      return shape(fa.currentUser);
    },
  };
}
