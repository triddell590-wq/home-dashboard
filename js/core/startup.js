// What to do when Firebase (or the memory backend) says who is signed in. Pure or injected, so it runs in Node.

/** The next step for an onChange callback: "app", "reload", "signin", "end" or "stay".
 *  Someone signing in while the form is showing reloads first: another tab that is still clearing the old
 *  session can delete the offline copy under this page, and only a fresh page reopens it. */
export function nextStep({ user, started, signinShown, claimReload }) {
  if (!user) return started ? "end" : signinShown ? "stay" : "signin";
  if (started) return "stay";
  return signinShown && claimReload() ? "reload" : "app";
}

const KEY = "home-fresh-start";

/** One reload per sign-in. If the session does not survive it (storage blocked), the next sign-in carries on
 *  without reloading instead of asking again for ever. `storage` is a function because reading sessionStorage can throw. */
export function reloadOnce(storage) {
  return {
    claim() {
      try {
        if (storage().getItem(KEY)) return false;
        storage().setItem(KEY, "1");
        return storage().getItem(KEY) === "1";
      } catch {
        return false;
      }
    },
    clear() {
      try { storage().removeItem(KEY); } catch { /* storage blocked: nothing was recorded */ }
    },
  };
}

/** Wraps a callback so anything it throws, now or later, reaches fail(err). */
export function guarded(handler, fail) {
  return (value) => {
    try {
      Promise.resolve(handler(value)).catch(fail);
    } catch (err) {
      fail(err);
    }
  };
}
