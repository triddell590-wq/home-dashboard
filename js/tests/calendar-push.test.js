import { test, eq, ok } from "./harness.js";
import { createMemoryData } from "../core/data-memory.js";
import { ON_TEXT, STATUS_TEXT, deviceId, deviceLabel, messagingFor, pushState, refreshToken, removeDevice, turnOn } from "../calendar/push.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
const base = { vapidKey: "BKey", ua: MAC, maxTouchPoints: 0, standalone: false, hasNotification: true, hasPush: true, permission: "default" };
const NOW = "2026-11-23T09:00:00.000Z";
const REG = { scope: "/home-dashboard/" };
const onFail = () => {};

function fakeMessaging(token = "tok1") {
  const calls = { getToken: [], deleteToken: 0 };
  return { calls, getToken: async (opts) => { calls.getToken.push(opts); return token; }, deleteToken: async () => { calls.deleteToken++; return true; } };
}

test("pushState: not set up first, then the iPhone home-screen rule", () => {
  eq(pushState({ ...base, vapidKey: "" }), "not-set-up");
  eq(pushState({ ...base, ua: IPHONE }), "ios-install");
  eq(pushState({ ...base, ua: MAC, maxTouchPoints: 5 }), "ios-install");          // iPad says Macintosh
  eq(pushState({ ...base, ua: IPHONE, standalone: true }), "ready");
  eq(pushState({ ...base, hasPush: false }), "unsupported");
  eq(pushState({ ...base, hasNotification: false }), "unsupported");
  eq(pushState({ ...base, permission: "denied" }), "denied");
  eq(pushState(base), "ready");
});

test("the status words are the spec's", () => {
  eq(STATUS_TEXT["not-set-up"], "Reminders aren't set up yet");
  eq(STATUS_TEXT["ios-install"], "On iPhone, add the app to your Home Screen first, then turn reminders on there");
  eq(STATUS_TEXT.unsupported, "This browser can't show reminders");
  eq(STATUS_TEXT.denied, "Notifications are blocked for this app — allow them in your settings, then try again");
  eq(ON_TEXT, "Reminders are on for this device");
});

test("deviceLabel", () => {
  eq([deviceLabel(IPHONE), deviceLabel(MAC), deviceLabel("x")], ["iPhone", "Mac", "This device"]);
  eq([deviceLabel("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)"), deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")], ["iPad", "Android", "Windows PC"]);
});

test("turnOn saves the device with its token and nothing else", async () => {
  const d = createMemoryData();
  const m = fakeMessaging();
  const asked = [];
  const r = await turnOn({ d, messaging: m, registration: REG, vapidKey: "BKey", id: "dev1", label: "Mac", now: NOW, onFail, requestPermission: async () => { asked.push(1); return "granted"; } });
  eq(r, { ok: true });
  eq(asked.length, 1);
  eq(m.calls.getToken, [{ vapidKey: "BKey", serviceWorkerRegistration: REG }]);
  eq(await d.get("devices/dev1"), { token: "tok1", label: "Mac", addedAt: NOW });
});

test("turnOn refused or without a token writes nothing", async () => {
  const d = createMemoryData();
  const m = fakeMessaging();
  const refused = await turnOn({ d, messaging: m, registration: REG, vapidKey: "BKey", id: "dev1", label: "Mac", now: NOW, onFail, requestPermission: async () => "denied" });
  eq(refused, { error: STATUS_TEXT.denied });
  eq(m.calls.getToken.length, 0);
  const dismissed = await turnOn({ d, messaging: m, registration: REG, vapidKey: "BKey", id: "dev1", label: "Mac", now: NOW, onFail, requestPermission: async () => "default" });
  eq(dismissed, { error: STATUS_TEXT.denied });
  const none = await turnOn({ d, messaging: fakeMessaging(null), registration: REG, vapidKey: "BKey", id: "dev1", label: "Mac", now: NOW, onFail, requestPermission: async () => "granted" });
  eq(none, { error: "Couldn't turn on reminders — try again" });
  const broke = await turnOn({ d, messaging: { getToken: async () => { throw new Error("x"); } }, registration: REG, vapidKey: "BKey", id: "dev1", label: "Mac", now: NOW, onFail, requestPermission: async () => "granted" });
  eq(broke, { error: "Couldn't turn on reminders — try again" });
  eq(await d.list("devices"), []);
});

test("turnOn reports a rejected write through onFail", async () => {
  const failed = [];
  const d = { set: async () => { throw new Error("no"); } };
  const r = await turnOn({ d, messaging: fakeMessaging(), registration: REG, vapidKey: "BKey", id: "dev1", label: "Mac", now: NOW, onFail: (t) => failed.push(t), requestPermission: async () => "granted" });
  eq(r, { ok: true });
  await new Promise((res) => setTimeout(res, 0));
  eq(failed, ["Couldn't save — try again"]);
});

test("removeDevice drops the doc, and this device's token too", async () => {
  const d = createMemoryData();
  await d.set("devices/a", { token: "t", label: "Mac", addedAt: NOW });
  await d.set("devices/b", { token: "u", label: "iPhone", addedAt: NOW });
  const m = fakeMessaging();
  removeDevice(d, "a", { thisId: "b", messaging: m, onFail });
  await new Promise((r) => setTimeout(r, 0));
  eq(m.calls.deleteToken, 0);
  eq((await d.list("devices")).map((x) => x.id), ["b"]);
  removeDevice(d, "b", { thisId: "b", messaging: m, onFail });
  await new Promise((r) => setTimeout(r, 0));
  eq(m.calls.deleteToken, 1);
  eq(await d.list("devices"), []);
  removeDevice(d, "b", { thisId: "b", messaging: { deleteToken: async () => { throw new Error("x"); } }, onFail }); // errors ignored
  removeDevice(d, "b", { thisId: "b", messaging: null, onFail });
});

test("refreshToken rewrites only a changed token on a device that is on", async () => {
  const d = createMemoryData();
  const args = (m, permission = "granted") => ({ d, messaging: m, registration: REG, vapidKey: "BKey", id: "dev1", permission });
  const none = fakeMessaging();
  await refreshToken(args(none));
  eq(none.calls.getToken.length, 0);                                   // no doc, no getToken
  await d.set("devices/dev1", { token: "tok1", label: "Mac", addedAt: NOW });
  const denied = fakeMessaging();
  await refreshToken(args(denied, "denied"));
  eq(denied.calls.getToken.length, 0);                                 // permission not granted
  await refreshToken(args(fakeMessaging("tok1")));
  eq(await d.get("devices/dev1"), { token: "tok1", label: "Mac", addedAt: NOW });
  const m = fakeMessaging("tok2");
  await refreshToken(args(m));
  eq(m.calls.getToken, [{ vapidKey: "BKey", serviceWorkerRegistration: REG }]);
  await new Promise((r) => setTimeout(r, 0));
  eq(await d.get("devices/dev1"), { token: "tok2", label: "Mac", addedAt: NOW });
});

test("deviceId is made once and kept under home-device-id", () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); } };
  const a = deviceId(storage);
  ok(typeof a === "string" && a.length > 10);
  eq(deviceId(storage), a);
  eq([...m.keys()], ["home-device-id"]);
});

test("messagingFor is only used for Firebase, with a key, in a browser that supports it", async () => {
  const msg = { token: 1 };
  const fb = (supported) => ({ messaging: Object.assign(() => msg, { isSupported: async () => supported }) });
  eq(await messagingFor({ firebase: fb(true), mode: "memory", vapidKey: "BKey" }), null);
  eq(await messagingFor({ firebase: fb(true), mode: "firebase", vapidKey: "" }), null);
  eq(await messagingFor({ firebase: fb(false), mode: "firebase", vapidKey: "BKey" }), null);
  eq(await messagingFor({ firebase: {}, mode: "firebase", vapidKey: "BKey" }), null);
  eq(await messagingFor({ firebase: fb(true), mode: "firebase", vapidKey: "BKey" }), msg);
});
