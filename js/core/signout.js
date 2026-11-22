// Ending a session: sign out, or clean up after the session was lost elsewhere. Every dependency is injected
// so the order of steps is testable. The steps always run in this order: take the app off screen (so no view
// can touch the data layer), clear the local copy with a time limit, sign out, then reload.
const LIMIT_MS = 5000;
const FAILED = "Couldn't sign out — try again";

export function signOutConfirmText(pending) {
  return pending ? "Sign out of this device? Changes that haven't synced yet will be lost." : "Sign out of this device?";
}

async function resetWithin(reset, limitMs, report) {
  let timer;
  try {
    await Promise.race([Promise.resolve().then(reset), new Promise((r) => { timer = setTimeout(r, limitMs); })]);
  } catch (err) {
    report(err); // a failed clean-up must not stop the sign-out
  } finally {
    clearTimeout(timer);
  }
}

function takeOffScreen(d) {
  d.hideChrome();
  d.stopSync();
  d.unmountView();
}

/** Session lost elsewhere: same clean-up, but nothing to sign out. */
export async function endSession(d) {
  takeOffScreen(d);
  await resetWithin(d.reset, d.limitMs ?? LIMIT_MS, d.report ?? console.error);
  d.reload();
}

export async function signOutFlow(d) {
  if (!d.confirm(signOutConfirmText(d.pending()))) return;
  takeOffScreen(d);
  await resetWithin(d.reset, d.limitMs ?? LIMIT_MS, d.report ?? console.error);
  try {
    await d.signOut();
  } catch (err) {
    (d.report ?? console.error)(err);
    d.showMessage(FAILED);
    return;
  }
  d.reload();
}

// main.js says how to take the app off screen; the Settings view only calls signOutNow().
let screen = { hideChrome() {}, stopSync() {}, unmountView() {}, showMessage() {} };
export function configureScreen(hooks) {
  screen = { ...screen, ...hooks };
}

export function depsFor({ data, auth }) {
  return {
    ...screen,
    confirm: (m) => window.confirm(m),
    pending: () => { try { return !!data().pending(); } catch { return false; } },
    reset: () => data().reset(),
    signOut: () => auth().signOut(),
    reload: () => location.reload(),
  };
}
