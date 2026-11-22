// Browser check: drives headless Chrome over the DevTools protocol (no npm packages).
// Usage: node tools/browser-check.mjs <base-url> <screenshot-folder>
// Opens ?backend=memory, signs in with the test user, and for Overview and Settings at 375x812 and
// 1280x800 in both themes records console errors and horizontal scroll, and saves a screenshot.
// Exits 1 on any console error or horizontal scroll. Set CHROME to use another browser binary.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) { console.error("Usage: node tools/browser-check.mjs <base-url> <screenshot-folder>"); process.exit(2); }
mkdirSync(outDir, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell")).sort().reverse()) {
      for (const sub of readdirSync(join(cache, d))) {
        const p = join(cache, d, sub, "chrome-headless-shell");
        if (existsSync(p)) return p;
      }
    }
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

const chrome = spawn(findChrome(), ["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on("exit", () => reject(new Error("Chrome exited early")));
  setTimeout(() => reject(new Error("Chrome did not start")), 15000);
});

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else listeners.forEach((l) => l(msg));
  };
  const opened = new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error("WebSocket failed")); });
  return {
    opened,
    on: (l) => listeners.push(l),
    send: (method, params = {}, sessionId) => new Promise((ok, fail) => {
      const n = ++id;
      pending.set(n, { ok, fail });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    }),
    close: () => ws.close(),
  };
}

const cdp = connect(wsUrl);
await cdp.opened;
const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p) => cdp.send(m, p, sessionId);
let errors = [];
cdp.on((msg) => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push("log: " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
});
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, what) => {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Timed out waiting for " + what);
};

const sizes = [["phone", 375, 812, true], ["desktop", 1280, 800, false]];
const themes = ["midnight", "daylight"];
const pages = ["overview", "settings"];
const root = base.replace(/\/+$/, "");
const results = [];
let scriptId = null;

for (const theme of themes) {
  if (scriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  ({ identifier: scriptId } = await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("home-theme", JSON.stringify("${theme}")); } catch (e) {}` }));
  for (const [sizeName, width, height, mobile] of sizes) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    for (const name of pages) {
      errors = [];
      await send("Page.navigate", { url: "about:blank" }); // a hash-only change would not reload the page
      await send("Page.navigate", { url: `${root}/?backend=memory#/${name}` });
      await waitFor(`document.readyState === "complete" && !!document.querySelector('input[name="email"], #page [data-view], #page > *')`, "page load");
      await waitFor(`!!document.querySelector('input[name="email"]') || !!document.querySelector('#tabbar a, .rail a')`, "sign-in or app");
      if (await evaluate(`!!document.querySelector('input[name="email"]')`)) {
        await evaluate(`(() => {
          const set = (n, v) => { const i = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); };
          set("email", "test@example.com"); set("password", "test-only-password");
          document.querySelector("form.signin").requestSubmit();
        })()`);
        await waitFor(`!document.querySelector('input[name="email"]')`, "sign-in");
      }
      await evaluate(`location.hash = "#/${name}"`);
      await waitFor(`location.hash === "#/${name}" && document.querySelector("#page").children.length > 0`, name + " content");
      await evaluate(`document.fonts ? document.fonts.ready.then(() => true) : true`);
      await new Promise((r) => setTimeout(r, 400));
      const m = await evaluate(`({ theme: document.documentElement.dataset.theme, sw: document.documentElement.scrollWidth, iw: innerWidth, title: (document.querySelector("#page h1") || {}).textContent || "" })`);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = `${name}-${sizeName}-${theme}.png`;
      writeFileSync(join(outDir, file), Buffer.from(shot.data, "base64"));
      const hscroll = m.sw > m.iw;
      results.push({ page: name, size: `${width}x${height}`, theme, appliedTheme: m.theme, heading: m.title, scrollWidth: m.sw, innerWidth: m.iw, hscroll, errors: [...errors], file });
    }
  }
}

cdp.close();
chrome.kill();

let failed = false;
for (const r of results) {
  const bad = r.errors.length > 0 || r.hscroll || r.appliedTheme !== r.theme;
  if (bad) failed = true;
  console.log(`${bad ? "FAIL" : "ok  "} ${r.page.padEnd(8)} ${r.size.padEnd(9)} ${r.theme.padEnd(8)} applied=${r.appliedTheme} heading="${r.heading}" scrollWidth=${r.scrollWidth} innerWidth=${r.innerWidth} hscroll=${r.hscroll} consoleErrors=${r.errors.length} -> ${r.file}`);
  r.errors.forEach((e) => console.log("     " + e));
}
console.log(`${results.length} screenshots in ${outDir}; ${failed ? "FAILED" : "all clear"}`);
process.exit(failed ? 1 : 0);
