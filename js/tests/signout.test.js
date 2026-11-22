import { endSession, signOutConfirmText, signOutFlow } from "../core/signout.js";
import { eq, test } from "./harness.js";

function fake(over = {}) {
  const log = [];
  const deps = {
    confirm: (m) => { log.push(["confirm", m]); return true; },
    pending: () => false,
    hideChrome: () => log.push("hide"),
    stopSync: () => log.push("stopSync"),
    unmountView: () => log.push("unmount"),
    reset: async () => { log.push("reset"); },
    signOut: async () => { log.push("signOut"); },
    reload: () => log.push("reload"),
    showMessage: (m) => log.push(["message", m]),
    limitMs: 20,
    report: () => {},
    ...over,
  };
  return { deps, log };
}

test("signOutConfirmText adds the warning only when writes are waiting", () => {
  eq(signOutConfirmText(false), "Sign out of this device?");
  eq(signOutConfirmText(true), "Sign out of this device? Changes that haven't synced yet will be lost.");
});

test("sign out asks with the right text, then runs the steps in order", async () => {
  const a = fake();
  await signOutFlow(a.deps);
  eq(a.log, [["confirm", "Sign out of this device?"], "hide", "stopSync", "unmount", "reset", "signOut", "reload"]);
  const b = fake({ pending: () => true });
  await signOutFlow(b.deps);
  eq(b.log[0], ["confirm", "Sign out of this device? Changes that haven't synced yet will be lost."]);
});

test("declining the confirmation changes nothing", async () => {
  const a = fake({ confirm: () => false });
  await signOutFlow(a.deps);
  eq(a.log.length, 0);
});

test("a rejected reset still signs out and reloads", async () => {
  const a = fake({ reset: async () => { throw new Error("clearPersistence failed"); } });
  await signOutFlow(a.deps);
  eq(a.log.slice(-2), ["signOut", "reload"]);
});

test("a hung reset is abandoned after the limit", async () => {
  const a = fake({ reset: () => new Promise(() => {}) });
  await signOutFlow(a.deps);
  eq(a.log.slice(-2), ["signOut", "reload"]);
});

test("a failed signOut shows a message and does not reload", async () => {
  const a = fake({ signOut: async () => { throw new Error("raw sdk text"); } });
  await signOutFlow(a.deps);
  eq(a.log.slice(-1), [["message", "Couldn't sign out — try again"]]);
  eq(a.log.includes("reload"), false);
});

test("endSession (session lost elsewhere) cleans up and reloads without signing out", async () => {
  const a = fake();
  a.deps.reset = () => { a.log.push("reset"); return new Promise(() => {}); };
  await endSession(a.deps);
  eq(a.log, ["hide", "stopSync", "unmount", "reset", "reload"]);
});
