import { test, eq } from "./harness.js";
import { authMessage } from "../core/auth-firebase.js";
import { fullPath } from "../core/data-firebase.js";

const BAD = "That email and password don't match";

test("authMessage: wrong credentials codes", () => {
  for (const code of ["auth/wrong-password", "auth/user-not-found", "auth/invalid-credential"]) eq(authMessage(code), BAD);
});
test("authMessage: offline", () => {
  eq(authMessage("auth/network-request-failed"), "No connection — try again when you're online");
});
test("authMessage: too many tries", () => {
  eq(authMessage("auth/too-many-requests"), "Too many tries — wait a few minutes");
});
test("authMessage: unknown code", () => {
  eq(authMessage("auth/something-else"), "Couldn't sign in — try again");
  eq(authMessage(undefined), "Couldn't sign in — try again");
});

function throwsMsg(fn) {
  try { fn(); } catch (e) { return e.message; }
  throw new Error("expected a throw");
}
test("fullPath: good path", () => {
  eq(fullPath("u1", "settings/profile"), "users/u1/settings/profile");
});
test("fullPath: no uid", () => {
  eq(throwsMsg(() => fullPath("", "a/b")), "Not signed in");
});
test("fullPath: bad paths", () => {
  for (const p of ["", "/x", "a//b", "a/../b", "a/"]) eq(throwsMsg(() => fullPath("u1", p)), "Bad path");
});
