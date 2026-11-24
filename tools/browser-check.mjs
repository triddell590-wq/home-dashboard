// Browser check: drives headless Chrome over the DevTools protocol (no npm packages).
// Usage: node tools/browser-check.mjs <base-url> <screenshot-folder>
// Opens ?backend=memory, signs in with the test user, seeds a little Lessons, Weather and Calendar data, and for
// Overview, Calendar, Lessons, Weather and Settings at 375x812 and 1280x800 in both themes records console errors and horizontal scroll,
// and saves a screenshot.
// Never goes online: Open-Meteo answers come from js/tests/fixtures/weather/ through the DevTools Fetch domain, and any
// request to another origin is failed and reported as "went online".
// On the Calendar it also types "dentist tuesday 2pm" into the Add box and waits for the preview and an enabled Save,
// and (phone) checks the month headings are single letters; the seeded 80-character title is covered by the sideways
// scroll check. Settings must say "Reminders aren't set up yet".
// Also checks, at phone width, that every tap target (sign-in form, each page) is at least 44x44 and that a toast
// never covers the More sheet; and at both widths that a 40-character unbroken name does not widen the Overview.
// The trading tabs (Trading, Research, Strategy lab) are seeded from js/tests/fixtures/trading/ with today's New York date:
// Research is driven by typing AAPL and tapping the suggestion (the six-month chart must draw), a ticker the model does not
// follow must say so, and the fixture's 80-character unbroken ranking row must not widen Trading.
// Set PAGES=trading,lab to check only some pages. Exits 1 on any console error, horizontal scroll or failed check. Set CHROME to use another browser binary.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
let online = [];
const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../js/tests/fixtures/weather", name)).toString("base64");
const fixtures = { "api.open-meteo.com": fixture("forecast.json"), "geocoding-api.open-meteo.com": fixture("places_hexham.json") };
const baseOrigin = new URL(base).origin;
cdp.on((msg) => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === "Fetch.requestPaused") {
    const { requestId, request } = msg.params;
    const url = new URL(request.url);
    const answer = (method, params) => send(method, { requestId, ...params }).catch(() => {});
    if (!/^https?:$/.test(url.protocol) || url.origin === baseOrigin) answer("Fetch.continueRequest");
    else if (fixtures[url.hostname]) answer("Fetch.fulfillRequest", { responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }], body: fixtures[url.hostname] });
    else { online.push("went online: " + request.url); answer("Fetch.failRequest", { errorReason: "BlockedByClient" }); }
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push("log: " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
});
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, what) => {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 100)); }
  const seen = await evaluate(`document.querySelector("#page") ? document.querySelector("#page").innerText.slice(0, 300) : "(no page)"`).catch(() => "?");
  throw new Error(`Timed out waiting for ${what}. Page says: ${seen}. Errors: ${errors.join(" | ")}`);
};

// Visible controls smaller than 44x44. A radio or checkbox counts as its label, which is what gets tapped.
// Rounded, because a card still settling into place can measure 43.99.
const smallTargets = () => evaluate(`[...document.querySelectorAll("a[href], button, input, select, textarea")].map((node) => {
  const target = node.matches('input[type="radio"], input[type="checkbox"]') && node.closest("label") || node;
  const r = target.getBoundingClientRect();
  if (!r.width || !r.height || getComputedStyle(node).visibility === "hidden") return null;
  return Math.round(r.width) < 44 || Math.round(r.height) < 44 ? (node.textContent.trim() || node.name || node.type) + " " + Math.round(r.width) + "x" + Math.round(r.height) : null;
}).filter(Boolean)`);
// Zooming in on focus (iOS) starts below 16px text.
const smallText = () => evaluate(`[...document.querySelectorAll(".btn, input, select, textarea")].filter((n) => n.offsetParent && !n.matches('[type="radio"], [type="checkbox"]') && parseFloat(getComputedStyle(n).fontSize) < 16).map((n) => (n.textContent.trim() || n.name || n.type) + " " + getComputedStyle(n).fontSize)`);
const phoneProblems = async (where) => [
  ...(await smallTargets()).map((t) => `${where}: tap target ${t}`),
  ...(await smallText()).map((t) => `${where}: text ${t}`),
];
const scrollWidth = () => evaluate("document.documentElement.scrollWidth");

// Saves a 40-character unbroken name in Settings and measures the Overview with it.
async function longNameWidth() {
  await evaluate(`location.hash = "#/settings"`);
  await waitFor(`!!document.querySelector("#page input[maxlength]")`, "name field");
  await evaluate(`(() => { const i = document.querySelector("#page input[maxlength]"); i.value = "${"W".repeat(40)}"; i.form.requestSubmit(); })()`);
  await evaluate(`location.hash = "#/overview"`);
  await waitFor(`(document.querySelector(".hero h1") || {}).textContent?.includes("${"W".repeat(40)}")`, "greeting with the long name");
  await new Promise((r) => setTimeout(r, 400));
  return scrollWidth();
}

// Today's two tabs never need the More sheet, so a stand-in with the app's own classes is put on the page.
const toastOverSheet = () => evaluate(`(() => {
  const add = (parent, cls) => { const n = document.createElement("div"); n.className = cls; n.textContent = "x"; parent.append(n); return n; };
  const toast = add(document.getElementById("toasts"), "toast");
  const made = [add(document.body, "sheet-backdrop"), add(document.body, "sheet"), toast];
  const r = toast.getBoundingClientRect();
  const over = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === toast;
  made.forEach((n) => n.remove());
  return over;
})()`);

// London calendar dates, whatever zone this machine is in.
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysAgo = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const tradingDir = join(dirname(fileURLToPath(import.meta.url)), "../js/tests/fixtures/trading");
const tradingFixture = (name) => JSON.parse(readFileSync(join(tradingDir, name + ".json"), "utf8"));

/** The fixture documents with their dates moved to today, as [path, document] pairs. */
function tradingDocs() {
  const day = nyToday();
  const ago = new Date(Date.now() - 5 * 60000).toISOString();
  const docs = {};
  for (const name of ["status", "today", "account", "record", "unlock", "lab", "universe"]) docs[`trading/${name}`] = tradingFixture(name);
  docs["tradingTickers/AAPL"] = tradingFixture("tradingTickers/AAPL");
  const today = docs["trading/today"];
  today.day = day; today.payload.day = day; today.published_at = ago;
  for (const run of Object.values(docs["trading/status"].runs)) { run.day = day; run.started = ago; run.finished = ago; }
  for (const doc of Object.values(docs)) doc.madeAt = ago;
  docs["tradingPicks/" + day] = { ...today };
  return docs;
}

// Seeds through the page's own data module (the same instance the app uses).
async function seed() {
  const today = londonToday();
  await evaluate(`import("./js/core/data.js").then(async ({ data }) => {
    const d = data();
    await d.set("lessonRates/2026-01-01", { pence: 1800 });
    await d.set("settings/lessons", { timetable: [6, 0, 0, 4, 0, 0, 0], trackingSince: "${daysAgo(today, 14)}" });
    await d.set("lessonDays/${daysAgo(today, 1)}", { lessons: 6, note: "${"W".repeat(40)}", confirmedAt: new Date().toISOString() });
    await d.set("lessonPayments/p1", { received: "${today}", pence: 5000, month: "${today.slice(0, 7)}", note: "bacs", addedAt: new Date().toISOString() });
    const now = new Date().toISOString();
    const ev = (title, kind, date, time, extra) => ({ title, kind, date, time, repeat: null, until: null, skipped: [], done: [], note: "", createdAt: now, updatedAt: now, ...extra });
    await d.set("events/c1", ev("Dentist", "appointment", "${today}", "14:00"));
    await d.set("events/c2", ev("Bins", "appointment", "${today}", null, { repeat: { unit: "week", every: 1, monthly: null } }));
    await d.set("events/c3", ev("Car tax", "deadline", "${daysAgo(today, 2)}", null));
    await d.set("events/c4", ev("${"W".repeat(80)}", "appointment", "${daysAgo(today, -1)}", null));
    for (const [path, doc] of Object.entries(${JSON.stringify(tradingDocs())})) await d.set(path, doc);
    await d.set("settings/weather", { place: { name: "Hexham", county: "Northumberland", nation: "England", lat: 54.97, lon: -2.1, region: "ne" } });
    return true;
  })`);
}
const ready = {
  calendar: [`(document.querySelector("#page h1") || {}).textContent === "Calendar" && document.querySelector("#page").textContent.includes("Coming up") && document.querySelector("#page").textContent.includes("${"W".repeat(80)}")`, "Calendar content"],
  settings: [`document.querySelector("#page").textContent.includes("Reminders aren't set up yet")`, "the Reminders card"],
  lessons: [`(document.querySelector("#page h1") || {}).textContent === "Lessons" && !!document.querySelector(".lz-section")`, "Lessons content"],
  trading: [`(document.querySelector("#page h1") || {}).textContent === "Trading" && !!document.querySelector('[data-card="trading_ranking"] tbody tr') && document.querySelector("#page").textContent.includes("${"Q".repeat(80)}") && !!document.querySelector(".card.pick")`, "Trading content"],
  research: [`(document.querySelector("#page h1") || {}).textContent === "Research" && location.hash === "#/research/AAPL" && !!document.querySelector('[data-card="r_news"]') && !!document.querySelector(".chart-box canvas")`, "the AAPL research page and its chart"],
  lab: [`(document.querySelector("#page h1") || {}).textContent === "Strategy lab" && !!document.querySelector('[data-card="lab_unlock"] .checklist') && !!document.querySelector('[data-card="lab_trader"] table')`, "Strategy lab content"],
  weather: [`(document.querySelector("#page h1") || {}).textContent === "Weather" && (!!document.querySelector(".wx-strip") || document.querySelector("#page").textContent.includes("No forecast available"))`, "Weather content"],
};

const sizes = [["phone", 375, 812, true], ["desktop", 1280, 800, false]];
const themes = ["midnight", "daylight"];
const pages = (process.env.PAGES ? process.env.PAGES.split(",") : ["overview", "calendar", "trading", "research", "lab", "lessons", "weather", "settings"]);
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
      online = [];
      const problems = [];
      await send("Page.navigate", { url: "about:blank" }); // a hash-only change would not reload the page
      await send("Page.navigate", { url: `${root}/?backend=memory#/${name}` });
      await waitFor(`document.readyState === "complete" && !!document.querySelector('input[name="email"], #page [data-view], #page > *')`, "page load");
      await waitFor(`!!document.querySelector('input[name="email"]') || !!document.querySelector('#tabbar a, .rail a')`, "sign-in or app");
      if (await evaluate(`!!document.querySelector('input[name="email"]')`)) {
        if (mobile) problems.push(...await phoneProblems("sign-in"));
        await evaluate(`(() => {
          const set = (n, v) => { const i = document.querySelector('input[name="' + n + '"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, v); i.dispatchEvent(new Event("input", { bubbles: true })); };
          set("email", "test@example.com"); set("password", "test-only-password");
          document.querySelector("form.signin").requestSubmit();
        })()`);
        await waitFor(`!document.querySelector('input[name="email"]')`, "sign-in");
      }
      await seed();
      await evaluate(`location.hash = "#/${name}"`);
      await waitFor(`location.hash === "#/${name}" && document.querySelector("#page").children.length > 0`, name + " content");
      if (name === "research") {
        // Type AAPL into the search box and tap the suggestion, as a person would.
        await waitFor(`!!document.querySelector(".search input")`, "the search box");
        await evaluate(`(() => { const i = document.querySelector(".search input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "AAPL"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await waitFor(`!!document.querySelector(".suggestions button") && !document.querySelector(".suggestions").hidden`, "the search suggestions");
        if (mobile) problems.push(...await phoneProblems("research suggestions"));
        await evaluate(`document.querySelector(".suggestions button").click()`);
      }
      if (ready[name]) await waitFor(...ready[name]);
      await evaluate(`document.fonts ? document.fonts.ready.then(() => true) : true`);
      await new Promise((r) => setTimeout(r, 400));
      const m = await evaluate(`({ theme: document.documentElement.dataset.theme, sw: document.documentElement.scrollWidth, iw: innerWidth, title: (document.querySelector("#page h1") || {}).textContent || "" })`);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = `${name}-${sizeName}-${theme}.png`;
      writeFileSync(join(outDir, file), Buffer.from(shot.data, "base64"));
      const hscroll = m.sw > width; // not innerWidth, which grows with the content on a phone
      problems.push(...online);
      if (mobile) {
        problems.push(...await phoneProblems(name));
        if (await toastOverSheet()) problems.push("a toast covers the More sheet");
      }
      if (name === "calendar") {
        await evaluate(`(() => { const i = document.querySelector(".cal-box"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "dentist tuesday 2pm"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await waitFor(`(document.querySelector(".cal-preview .cal-line") || {}).textContent?.startsWith("Dentist — ") && !!document.querySelector(".cal-preview .btn.primary") && !document.querySelector(".cal-preview .btn.primary").disabled`, "the Add preview and an enabled Save");
        if (mobile) {
          const heads = await evaluate(`[...document.querySelectorAll(".cal-dow")].map((n) => [...n.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.textContent).join("")).join("")`);
          if (!/^[A-Za-z]{7}$/.test(heads)) problems.push(`month headings are not single letters: "${heads}"`);
        }
        problems.push(...(mobile ? await phoneProblems("calendar with preview") : []));
        if (await scrollWidth() > width) problems.push("the Add preview widens the page");
      }
      if (name === "research") {
        await evaluate(`location.hash = "#/research/ZZZZ"`);
        await waitFor(`document.querySelector("#page").textContent.includes("The model doesn't follow this stock")`, "the not-followed message");
        if (await scrollWidth() > width) problems.push("the not-followed page widens the page");
      }
      if (name === "overview") {
        const sw = await longNameWidth();
        if (sw > width) problems.push(`a 40-character name widens the page to ${sw}`);
      }
      results.push({ page: name, size: `${width}x${height}`, theme, appliedTheme: m.theme, heading: m.title, scrollWidth: m.sw, innerWidth: m.iw, hscroll, problems, errors: [...errors], file });
    }
  }
}

cdp.close();
chrome.kill();

let failed = false;
for (const r of results) {
  const bad = r.errors.length > 0 || r.problems.length > 0 || r.hscroll || r.appliedTheme !== r.theme;
  if (bad) failed = true;
  console.log(`${bad ? "FAIL" : "ok  "} ${r.page.padEnd(8)} ${r.size.padEnd(9)} ${r.theme.padEnd(8)} applied=${r.appliedTheme} heading="${r.heading}" scrollWidth=${r.scrollWidth} innerWidth=${r.innerWidth} hscroll=${r.hscroll} consoleErrors=${r.errors.length} -> ${r.file}`);
  [...r.problems, ...r.errors].forEach((e) => console.log("     " + e));
}
console.log(`${results.length} screenshots in ${outDir}; ${failed ? "FAILED" : "all clear"}`);
process.exit(failed ? 1 : 0);
