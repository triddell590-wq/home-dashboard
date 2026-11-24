// Trading: today's picks in full, carried from the Mac's picks view. The engine runs online and publishes read-only
// documents, so this page only reads them (through trading/load.js): the run notices, the outlook, every pick with its
// reasons and chart check, what the chart turned down, the full ranking and the live record. All text that came from
// the data is placed with textContent (el text nodes) only. There are no run buttons and no simulator links.
import { el, pct, table } from "../core/dom.js";
import { go } from "../core/router.js";
import { runKind } from "../trading/cards.js";
import { chips } from "../trading/chips.js";
import { pctOrDash, signClass } from "../trading/charts.js";
import { forwardFrom } from "../trading/load.js";
import { mountLive } from "../trading/live.js";
import { nyDay } from "../trading/market.js";
import { chartText, dayText, holdText, localTime, madeText, minutesText, outlookText, picksSummary, rankText, relativeDay, runNotice, skippedText } from "../trading/text.js";

export const tab = { id: "trading", label: "Trading", icon: "picks", order: 20, mount };

const SOURCES = { sp500: "S&P 500", ndx: "Nasdaq-100", etf: "ETF", mover: "Movers scan" };
const num = (label) => ({ label, attrs: { class: "num" } });
const arr = (v) => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ pure pieces (tested in Node)

/** The notice lines under the page title, as [class, text]: what went wrong or was missing, then where the picks came from. */
export function noticeLines(today, status) {
  const p = (today && today.payload) || {};
  const lines = [];
  if (today.late) lines.push(["warn", "Published after the market opened, so these are shown for interest only and do not count towards the live record."]);
  if (today.status === "prices stale") lines.push(["warn", p.message || "Prices weren't up to date, so no picks were made."]);
  if (today.status === "market closed") lines.push(["", "The market was closed today."]);
  if (p.message && today.status !== "prices stale") lines.push(["", p.message]);
  for (const problem of arr(p.problems)) lines.push(["warn", String(problem)]);
  if (arr(p.sources_missing).length) lines.push(["", `Not available this morning: ${p.sources_missing.join(", ")}.`]);
  const engine = (status && status.engine) || {};
  for (const sold of arr(engine.sold_early)) {
    lines.push(["", `Sold early: ${sold.ticker} (bought ${dayText(sold.opened)}) was sold at the open on ${dayText(sold.sold_on)}, before its planned sale on ${dayText(sold.sell_on)}, because its chart turned weak.`]);
  }
  const when = today.published_at ? `${relativeDay(today.published_at)} ${localTime(today.published_at)}` : "?";
  lines.push(["", `Published ${when} · model ${p.champion || "research"} · ${p.universe_size || "?"} stocks ranked · prices from ${dayText(p.signal_date)}`]);
  return lines;
}

/** The lines when no picks have been published yet: "No picks yet today" once (the amber notice says it when it can), then why. */
export function emptyLines(today, status, now = new Date()) {
  const notice = runNotice(status, today, now);
  const minutes = minutesText(status && status.minutes);
  const lines = [];
  if (notice) lines.push(["warn", notice]);
  if (!notice || !notice.startsWith("No picks yet today")) lines.push(["", "No picks yet today"]);
  lines.push(["", `The model prepares them after ${localTime(picksSummary(today, now).expected_after)} on trading days.`]);
  if (minutes) lines.push(["warn", minutes]);
  return lines;
}

/** The ranking rows as plain values for the table. */
export function rankingRows(ranking) {
  return arr(ranking).map((r, i) => ({
    n: i + 1, ticker: String(r.ticker), name: r.name || "", sector: r.sector || "", from: SOURCES[r.source] || r.source || "",
    rank: r.top_pct != null ? `Top ${r.top_pct}%` : "—", change: r.change == null ? "—" : pct(r.change),
    tone: r.change > 0 ? "up" : r.change < 0 ? "down" : "",
  }));
}

// ------------------------------------------------------------------ drawing

const tickerLink = (ticker) => el("a", { class: "tlink", href: `#/research/${encodeURIComponent(ticker)}` }, el("span", { class: "ticker" }, ticker));
const line = (cls, text) => el("p", { class: `sub ${cls}`.trim(), style: { margin: "0 0 6px" } }, text);

function pickCard(p, i, payload) {
  return el("div", { class: "card half pick", style: { "--i": i + 1 } },
    el("div", { class: "label" }, el("span", {}, `#${i + 1} · ${SOURCES[p.source] || p.source || ""}`), el("span", {}, rankText(p))),
    el("h3", {}, el("span", { class: "ticker" }, p.ticker), " ", p.name || ""),
    el("div", { class: "sub" }, [p.sector, p.price != null ? `$${Number(p.price).toFixed(2)}` : null].filter(Boolean).join(" · "), " ",
      p.change == null ? null : el("span", { class: p.change > 0 ? "up" : p.change < 0 ? "down" : "" }, pct(p.change))),
    chips(p.reasons),
    chartText(p) ? el("p", { class: "sub", style: { margin: "8px 0 0" } }, chartText(p)) : null,
    el("div", { class: "pick-foot" },
      el("span", { class: "sub" }, `${pct(p.weight, { sign: false, digits: 0 })} of the batch · ${holdText(payload)}`),
      el("div", { class: "actions" }, el("button", { class: "btn small", type: "button", onclick: () => go("research", p.ticker) }, "Research"))));
}

function draw({ today, status, record }, body) {
  const now = new Date();
  const grid = el("div", { class: "grid" });
  const made = today && today.madeAt ? madeText(today.madeAt, runKind(today.madeAt)) : "";
  const minutes = minutesText(status && status.minutes);
  const notice = runNotice(status, today, now);

  if (!today || !today.day) {
    grid.append(el("section", { class: "card wide bare" }, ...emptyLines(today, status, now).map(([cls, t]) => line(cls, t))));
    body.append(grid);
    return;
  }

  const payload = today.payload || {};
  const picks = arr(payload.picks);
  const old = today.day !== nyDay(now);
  const lines = [
    ...(notice ? [["warn", notice]] : []),
    ...(minutes ? [["warn", minutes]] : []),
    ...(made ? [["made", made]] : []),
    ...(old ? [["", `These are the picks from ${dayText(today.day)}.`]] : []),
    ...noticeLines(today, status),
  ];
  grid.append(el("section", { class: "card wide bare", "data-card": "trading_notices" }, ...lines.map(([cls, t]) => line(cls, t))));

  // The outlook, then the picks (or the line saying the model sat out).
  const words = payload.outlook ? outlookText(payload.outlook) : null;
  if (words) {
    grid.append(el("section", { class: "card wide" }, el("div", { class: "label" }, "Outlook"), el("div", { class: "big" }, words.label),
      el("p", { class: "sub" }, words.sentence), el("p", { class: "sub" }, `Picks are ${holdText(payload)}.`)));
  }
  if (picks.length) for (const [i, p] of picks.entries()) grid.append(pickCard(p, i, payload));
  else grid.append(el("section", { class: "card wide bare" }, line("", "The model sits out today: no stock scored above its confidence level.")));

  const skipped = arr(payload.skipped);
  const level = payload.trader && payload.trader.entry_level;
  if (skipped.length) {
    grid.append(el("section", { class: "card wide", "data-card": "trading_skipped" },
      el("div", { class: "label" }, el("span", {}, "Skipped by the chart"), level != null ? el("span", {}, `Needs a ${Math.round(level * 100)}% chart check to buy`) : null),
      ...skipped.map((s) => el("p", { class: "sub", style: { margin: "8px 0 0" } }, tickerLink(String(s.ticker)), " ",
        s.p_up != null && isFinite(s.p_up) ? `(${Math.round(s.p_up * 100)}%) ` : "", skippedText(s)))));
  } else if (payload.trader && payload.trader.on) {
    grid.append(el("section", { class: "card wide bare" }, line("", "The chart turned none of the shortlist down today.")));
  }

  const rows = rankingRows(payload.ranking);
  grid.append(el("section", { class: "card wide", "data-card": "trading_ranking" },
    el("div", { class: "label" }, rows.length ? `Full ranking · ${rows.length} stocks` : "Full ranking"),
    rows.length
      ? el("div", { class: "scroll", style: { maxHeight: "520px", marginTop: "10px" } }, table(
        ["#", "Ticker", "Name", "Sector", "From", num("Rank"), num("Last day")],
        rows.map((r) => [String(r.n), tickerLink(r.ticker), r.name, r.sector, r.from, el("td", { class: "num" }, r.rank), el("td", { class: `num ${r.tone}` }, r.change)])))
      : el("p", { class: "sub" }, "The full ranking appears with the morning's picks.")));

  const days = forwardFrom(record).days.slice().reverse().slice(0, 20);
  const td = (v) => el("td", { class: `num ${signClass(v)}` }, pctOrDash(v));
  grid.append(el("section", { class: "card wide", "data-card": "trading_record" },
    el("div", { class: "label" }, "Live record · picks published before the open · latest 20 days"),
    days.length
      ? el("div", { class: "scroll", style: { marginTop: "10px" } }, table(["Day", num("Picks"), num("S&P 500")], days.map((d) => [dayText(d.day), td(d.pick_return), td(d.spy_return)])))
      : el("p", { class: "sub" }, "The live record starts with the first picks published before an open.")));
  body.append(grid);
}

function mount(container) {
  container.append(el("h1", { class: "page-title" }, "Trading"),
    el("p", { class: "lead" }, "Each morning's picks are bought at the open and held for the champion's hold (one or five trading days). The model sits out when nothing clears its confidence level."));
  const body = el("div", {});
  container.append(body);
  const stop = mountLive(body, {
    names: ["today"], optional: ["status", "record"],
    extraKey: ({ today, status }) => runNotice(status, today, new Date()) || "",
    render: (docs, into) => { draw(docs, into); },
  });
  return () => stop();
}
