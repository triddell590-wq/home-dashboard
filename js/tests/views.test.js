import { greetingText, overviewEmpty } from "../views/overview.js";
import { cleanName } from "../views/settings.js";
import { eq, ok, test } from "./harness.js";

test("cleanName trims, cuts to 40 characters and keeps markup as plain text", () => {
  eq(cleanName("  Tom  "), "Tom");
  eq(cleanName("   "), "");
  eq(cleanName("a".repeat(45)), "a".repeat(40));
  eq(cleanName("<b>x</b>"), "<b>x</b>");
  eq(cleanName(undefined), "");
});

test("overviewEmpty gives the two lines only when no cards are registered", () => {
  eq(overviewEmpty(0), [
    "Your calendar comes next. Lessons, weather and trading follow, one at a time.",
    "Until then, they're in the dashboard on your Mac.",
  ]);
  eq(overviewEmpty(1), null);
});

test("greetingText returns a plain string, with or without a name", () => {
  const morning = new Date(Date.UTC(2026, 10, 22, 8, 0));
  eq(greetingText("Tom", morning), "Good morning, Tom");
  eq(greetingText("", morning), "Good morning");
  eq(typeof greetingText("<b>x</b>", morning), "string");
  eq(greetingText("<b>x</b>", morning), "Good morning, <b>x</b>");
});

test("the Overview and Settings views never assign innerHTML", async () => {
  for (const file of ["overview.js", "settings.js", "signin.js"]) {
    const url = new URL(`../views/${file}`, import.meta.url);
    const source = typeof document === "undefined" ? await (await import("node:fs/promises")).readFile(url, "utf8")
      : await (await fetch(url)).text();
    ok(!/innerHTML/.test(source), `${file} uses innerHTML`);
    ok(!/html\s*:/.test(source), `${file} uses the el html option`);
  }
});

test("saveName shows Saved at once without waiting for the server, and reports a rejected write plainly", async () => {
  const { saveName } = await import("../views/settings.js");
  const events = [];
  const never = () => new Promise(() => {});
  saveName(never, { other: 1 }, "  Tom ", { saved: (n) => events.push(["saved", n]), failed: (m) => events.push(["failed", m]) });
  eq(events, [["saved", "Tom"]]);
  const got = [];
  saveName(() => Promise.reject(new Error("FirebaseError: raw")), {}, "Tom", { saved() {}, failed: (m) => got.push(m) });
  await new Promise((r) => setTimeout(r, 0));
  eq(got, ["Couldn't save — try again"]);
});

test("summaryText joins the phrases and is null when there are none", async () => {
  const { summaryText } = await import("../views/overview.js");
  eq(summaryText(["a", null, "b"]), "a · b");
  eq(summaryText([]), null);
  eq(summaryText([null, ""]), null);
});
