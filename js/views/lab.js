// Strategy lab: the picks model's weekly self-test with the real-money unlock checklist, carried from the engine half of
// the Mac's lab view. It reads trading/lab (weekly versions, chart trader, lessons learned, intraday collection) and
// trading/unlock through trading/load.js. There are no run buttons and no simulator lab: the engine runs online and the
// practice simulator stays on the Mac. Error text and ticker names are free text and are placed with textContent only.
import { el, table } from "../core/dom.js";
import { pctOrDash, signClass } from "../trading/charts.js";
import { mountLive } from "../trading/live.js";
import { causeSplitText, lessonText, madeText } from "../trading/text.js";
import { runKind } from "../trading/cards.js";

export const tab = { id: "lab", label: "Strategy lab", order: 40, mount };

const num = (label) => ({ label, attrs: { class: "num" } });
const td = (text, cls = "") => el("td", { class: `num ${cls}`.trim() }, text);
const fixed = (v, d) => (v == null || !isFinite(v) ? "—" : Number(v).toFixed(d));
const arr = (v) => (Array.isArray(v) ? v : []);
const sub = (t, cls = "") => el("p", { class: `sub ${cls}`.trim(), style: { margin: "6px 0 0" } }, t);
const label = (t, extra = null) => el("div", { class: "label" }, el("span", {}, t), extra);
const made = (doc) => (doc && doc.madeAt ? sub(madeText(doc.madeAt, runKind(doc.madeAt)), "made") : null);

// ------------------------------------------------------------------ pure pieces (tested in Node)

/** The newest weekly test day and its rows for the picks versions (the chart trader has its own card). */
export function latestRows(evaluations) {
  const list = arr(evaluations);
  const latest = list.length ? list.reduce((a, e) => (e.as_of > a ? e.as_of : a), "") : null;
  return { latest, rows: list.filter((e) => e.as_of === latest && e.name !== "trader") };
}

/** "2 of 3": in how many of the year's blocks a version beat the market. */
export const blocksText = (e) => (Array.isArray(e && e.blocks) ? `${e.blocks.filter((b) => b > 0).length} of ${e.blocks.length}` : "—");

/** How a version's weekly test ended: error, champion, passed, failed or nothing to say. */
export function outcomeKind(e) {
  if (e.error) return "error";
  if (e.is_champion) return "champion";
  if (Array.isArray(e.failed_rules)) return e.failed_rules.length ? "failed" : "passed";
  return "none";
}

// ------------------------------------------------------------------ cards

function versionsCard(lab, status) {
  const { latest, rows } = latestRows(lab.evaluations);
  const threshold = lab.threshold == null ? "not yet calibrated — the first weekly test sets it"
    : !isFinite(lab.threshold) ? "sitting out: no level beat the market" : Number(lab.threshold).toFixed(3);
  const engine = (status && status.engine) || {};
  const championRow = rows.find((e) => e.is_champion);
  const hold = engine.champion_hold || (championRow && championRow.hold) || 1;
  const missing = engine.missing_prices;
  const outcome = (e) => {
    const kind = outcomeKind(e);
    if (kind === "error") return el("span", { class: "down" }, `couldn't be tested: ${e.error}`);
    if (kind === "champion") return el("span", { class: "badge buy" }, "champion");
    if (kind === "failed") return `failed rule${e.failed_rules.length > 1 ? "s" : ""} ${e.failed_rules.join(", ")}`;
    if (kind === "passed") return el("span", { class: "up" }, "passed");
    return "—";
  };
  return el("section", { class: "card wide static", "data-card": "lab_versions" },
    label("The picks model's weekly test", latest ? el("span", {}, `Latest ${latest}`) : null),
    el("div", { class: "big" }, `Champion: ${lab.champion ?? "—"}`),
    sub(`${lab.champion_since ? `Champion since ${lab.champion_since}. ` : ""}Holds picks ${hold} trading day${hold > 1 ? "s" : ""}. Confidence level it waits for: ${threshold}.`),
    rows.length
      ? el("div", { class: "scroll", style: { marginTop: "12px" } }, table(
        ["Version", num("Hold"), num("Score"), num("t-stat"), num("Avg daily excess"), num("Worst drop (SPY)"), num("Beat SPY in blocks"), "Result"],
        rows.map((e) => [e.name, td(e.hold ? `${e.hold}d` : "—"), td(fixed(e.score, 2)), td(fixed(e.t_stat, 2), e.t_stat > 2.5 ? "up" : ""),
          td(pctOrDash(e.excess_mean), signClass(e.excess_mean)),
          td(e.max_drawdown == null ? "—" : `${pctOrDash(e.max_drawdown)} (${pctOrDash(e.spy_drawdown)})`), td(blocksText(e)), outcome(e)])))
      : sub("The weekly test hasn't run yet. It runs each weekend, or on a weekday evening once the last run is over a week old."),
    sub("Each version chooses its confidence level on one year, then trades the following year, which it never trained on. " +
      "Score = return above SPY for the risk taken. A challenger replaces the champion only if all four rules hold: " +
      "1) its score beats the champion's by at least 0.20; 2) its t-stat is above 2.5 (luck rarely gets that far); " +
      "3) its worst drop is no more than 5 points deeper than SPY's; 4) it beat SPY in at least 2 of the year's 3 four-month blocks."),
    ...(missing && missing.count ? [sub(`${missing.count} past index members have no free price history, so they are missing from the tests (e.g. ${arr(missing.examples).slice(0, 5).join(", ")}).`, "warn")] : []),
    made(lab));
}

function traderCard(lab) {
  const t = arr(lab.evaluations).filter((e) => e.name === "trader").reduce((a, e) => (!a || e.as_of > a.as_of ? e : a), null);
  if (!t) {
    return el("section", { class: "card wide static", "data-card": "lab_trader" }, label("Chart trader"),
      sub("The chart trader is tested with the picks model each week. Its first result appears after the next weekly test."));
  }
  const row = (name, sc) => (sc && typeof sc === "object"
    ? [name, td(fixed(sc.score, 2)), td(fixed(sc.t_stat, 2), sc.t_stat > 2.5 ? "up" : ""), td(pctOrDash(sc.excess_mean), signClass(sc.excess_mean)),
      td(sc.max_drawdown == null ? "—" : pctOrDash(sc.max_drawdown))]
    : [name, td("—"), td("—"), td("—"), td("—")]);
  const used = t.trader_on ? el("span", { class: "badge buy" }, "in use") : el("span", {}, "not in use");
  const exits = t.exits_on ? `Early sales are on: a held stock is sold at the next open once its chart check falls below ${Math.round(t.exit_level * 100)}%.`
    : "Early sales are off: stocks are held to the end of their hold.";
  return el("section", { class: "card wide static", "data-card": "lab_trader" },
    label("Chart trader", el("span", {}, `Latest ${t.as_of}`)),
    el("div", { class: "big" }, used),
    ...(t.error ? [sub(`Couldn't be tested: ${t.error}`, "down")] : []),
    sub(t.trader_on
      ? `It buys a shortlisted stock only when its chart check is at least ${Math.round(t.entry_level * 100)}%. ${exits}`
      : `${t.reason ? `${t.reason}, so it wasn't traded on the test year. ` : ""}The picks model's picks are bought as they are, without the chart check.`),
    el("div", { class: "scroll", style: { marginTop: "12px" } }, table(
      ["Way of trading", num("Score"), num("t-stat"), num("Avg daily excess"), num("Worst drop")],
      [row(`Picks model alone (${t.for_version || lab.champion})`, t.alone), row("With the chart trader", t.trader), row("With the trader and early sales", t.exits)])),
    sub("Each week the trader learns from every stock's chart before the choosing year, picks its buy level there, " +
      "then all three ways are traded on the following year, which neither model trained on. The trader is used only if it clearly beats " +
      "the picks model alone by the same four rules a challenger must pass; early sales only if they then clearly beat the trader without them."));
}

const tickerLink = (ticker) => el("a", { class: "tlink", href: `#/research/${encodeURIComponent(ticker)}` }, String(ticker));
const NAMES = { shock: "Shocks", research: "Research misses", chart: "Chart misses", unforeseeable: "Unforeseeable" };
const ORDER = { adopted: 0, candidate: 1, waiting: 2, "waiting: trader off": 3, retired: 4, rejected: 5 };

function lessonsCard(lab) {
  const d = lab.lessons || {};
  const lessons = arr(d.lessons).slice().sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
  if (!d.month && !lessons.length) {
    return el("section", { class: "card wide static", "data-card": "lab_lessons" }, label("Lessons learned"),
      sub("No trades logged yet — lessons start once the first trades have been graded."));
  }
  const share = (part) => Object.fromEntries(Object.entries(part || {}).map(([k, v]) => [k, v.share]));
  const wins = d.wins || {};
  const winLine = wins.lift || wins.stock
    ? `Wins: ${Math.round(((wins.lift || {}).share || 0) * 100)}% market or sector lift, ${Math.round(((wins.stock || {}).share || 0) * 100)}% the stock's own move` : "";
  const examples = Object.entries(d.examples || {}).filter(([, list]) => arr(list).length).map(([cause, list]) =>
    el("p", { class: "sub", style: { margin: "6px 0 0" } }, `${NAMES[cause] || cause}: `,
      ...list.map((t, i) => el("span", {}, i ? " · " : "", tickerLink(t.ticker), ` ${t.signal_date} `,
        el("span", { class: signClass(t.net_ret) }, pctOrDash(t.net_ret)),
        arr(t.warnings).length ? ` (${t.warnings.join("; ").toLowerCase()})` : ""))));
  return el("section", { class: "card wide static", "data-card": "lab_lessons" },
    label("Lessons learned", d.month ? el("span", {}, `${d.month} · ${d.source === "live" ? "live trades" : "replayed history"}`) : null),
    ...(d.month ? [el("div", { class: "big" }, causeSplitText(share(d.losses)) || "No losses this month")] : []),
    ...(winLine ? [sub(winLine)] : []),
    ...examples,
    ...(lessons.length
      ? [el("div", { class: "label", style: { marginTop: "14px" } }, "Lessons"),
        ...lessons.map((l) => sub(`${lessonText(l)}${l.evidence && l.evidence.trades ? ` — from ${l.evidence.trades} trades over ${l.evidence.years} years` : ""}`, l.status === "adopted" ? "up" : ""))]
      : [sub("No lessons yet: none of the losses has clustered strongly enough, in two or more years, to suggest a change.")]),
    ...(d.learning_error ? [sub(`The last attempt to log trades failed: ${d.learning_error}`, "warn")] : []),
    sub("Each trade's result is split into the market's part, its sector's part and the stock's own part. " +
      "A loss is a shock when the market and sector explain it, a research miss when the picks model had a public warning in front of it, " +
      "a chart miss when the trader approved it despite its own warning signs, and otherwise unforeseeable. " +
      "A lesson is kept only if the whole system with it beats the system without it, by the same four rules, on a later year it never saw."));
}

function intradayCard(lab) {
  const i = lab.intraday || {};
  const last = i.last_collection;
  const lastText = !last ? "" : last.error ? ` Last evening (${last.day}) the collection failed: ${last.error}.`
    : ` Last evening (${last.day}): ${last.tickers - last.failed} of ${last.tickers} stocks saved${last.failed ? `, ${last.failed} failed` : ""}.`;
  return el("section", { class: "card wide bare static", "data-card": "lab_intraday" },
    el("p", { class: `sub ${last && (last.error || last.failed) ? "warn" : ""}`.trim(), style: { margin: "0" } }, i.stocks
      ? `Intraday candles saved: ${i.stocks} stocks over ${i.days} trading day${i.days === 1 ? "" : "s"} (${i.first} to ${i.last}), kept for a later intraday trading layer.${lastText}`
      : `Intraday candles: none saved yet — collection starts with the next evening run.${lastText}`));
}

function unlockCard(u) {
  if (!u || !Array.isArray(u.conditions)) {
    return el("section", { class: "card wide static", "data-card": "lab_unlock" }, label("Real-money unlock"), sub("The unlock check appears after the first evening run."));
  }
  return el("section", { class: "card wide static", "data-card": "lab_unlock" },
    label("Real-money unlock", el("span", {}, u.unlocked ? "Unlocked" : `Locked · ${u.days} live days`)),
    sub("Judged only on picks published before each day's open — never on backtests. All seven rules must hold."),
    el("div", { class: "checklist" }, u.conditions.map((c) => el("div", {},
      el("span", { class: c.met ? "up" : "muted", "aria-label": c.met ? "met" : "not met" }, c.met ? "✓" : "○"),
      el("span", {}, c.rule), el("span", { class: "sub" }, c.value_text || "")))),
    made(u));
}

function mount(container) {
  container.append(el("h1", { class: "page-title" }, "Strategy lab"),
    el("p", { class: "lead" }, "Every week each version of the picks model is tested on the latest year, which none of them were trained on. A challenger replaces the champion only if it is clearly better."));
  const body = el("div", {});
  container.append(body);
  const stop = mountLive(body, {
    names: ["lab"], optional: ["unlock", "status"],
    render: ({ lab, unlock, status }, into) => {
      const grid = el("div", { class: "grid" });
      if (!lab) {
        grid.append(el("section", { class: "card wide static" }, label("The picks model's weekly test"),
          sub("The weekly test hasn't been published yet. It runs each weekend, or on a weekday evening once the last run is over a week old.")), unlockCard(unlock));
      } else {
        grid.append(versionsCard(lab, status), traderCard(lab), lessonsCard(lab), intradayCard(lab), unlockCard(unlock));
      }
      into.append(grid);
    },
  });
  return () => stop();
}
