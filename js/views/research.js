// Research: search any stock the model follows and see everything it knows about it, carried from the Mac's research
// view. The search runs over trading/universe (matchStocks) and each ticker's page reads its own document
// (tradingTickers/{TICKER}) through trading/load.js: a six-month chart, today's rank, earnings, analyst changes and
// headlines. Headlines and firms are free text and are placed with textContent only; a link is used only when its
// address starts with http or https.
import { el, pct } from "../core/dom.js";
import { go } from "../core/router.js";
import { runKind } from "../trading/cards.js";
import { areaChart, cleanSeries, chartsReady } from "../trading/charts.js";
import { chips } from "../trading/chips.js";
import { mountLive } from "../trading/live.js";
import { dayText, londonDate, madeText, matchStocks, rankText, relativeDay, localTime } from "../trading/text.js";

export const tab = { id: "research", label: "Research", order: 30, mount };

export const NOT_FOLLOWED = "The model doesn't follow this stock";
const SOURCES = { sp500: "S&P 500", ndx: "Nasdaq-100", etf: "ETF", mover: "Movers scan" };
const ACTIONS = { up: "Upgrade", down: "Downgrade", init: "New coverage", main: "Kept", reit: "Reiterated" };
const arr = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (v == null ? "" : String(v));

// ------------------------------------------------------------------ pure pieces (tested in Node)

/** The first n rows of a list (the documents hold the newest first); never throws on a missing list. */
export const newest = (rows, n) => arr(rows).slice(0, n);

/** Whether the model follows `ticker`: it does when its document has been published. */
export function tickerState(ticker, universe, doc) {
  if (!doc) return { followed: false, message: NOT_FOLLOWED };
  const stock = arr(universe).find((s) => s.ticker === ticker) || { ticker, name: "", sector: "", source: "" };
  return { followed: true, stock };
}

// Earnings times are published without a zone; they are read as UTC so every device agrees.
const reportTime = (e) => new Date(`${text(e.report_at).replace(" ", "T")}Z`);
const reportDate = (e) => (Number.isNaN(reportTime(e).getTime()) ? "—" : londonDate(reportTime(e).toISOString()));

/** The last reported quarter and the next one still to come, from the earnings rows. */
export function earningsSummary(rows, now = new Date()) {
  const at = (e) => text(e.report_at);
  const reported = arr(rows).filter((e) => e.eps_actual != null).sort((a, b) => at(b).localeCompare(at(a)));
  const upcoming = arr(rows).filter((e) => e.eps_actual == null && reportTime(e) > now).sort((a, b) => at(a).localeCompare(at(b)));
  return { last: reported[0] || null, next: upcoming[0] || null };
}

const safeUrl = (url) => (typeof url === "string" && /^https?:\/\//i.test(url) ? url : null);

// ------------------------------------------------------------------ search box

function searchBox(onPick, getStocks) {
  const input = el("input", { type: "search", placeholder: "Search a stock or fund, e.g. NVIDIA or XLE", "aria-label": "Search stocks",
    autocomplete: "off", spellcheck: "false" });
  const list = el("div", { class: "suggestions", role: "listbox", hidden: true });
  let items = [];
  let active = 0;
  const show = () => {
    items = matchStocks(getStocks(), input.value);
    active = 0;
    list.hidden = !items.length;
    list.replaceChildren(...items.map((s, i) => el("button", { type: "button", role: "option", class: i === active ? "on" : "",
      onmousedown: (e) => { e.preventDefault(); onPick(s.ticker); }, onclick: () => onPick(s.ticker) },
    el("span", { class: "ticker" }, s.ticker), el("span", {}, s.name || ""), el("span", { class: "sub" }, SOURCES[s.source] || ""))));
  };
  input.addEventListener("input", show);
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      [...list.children].forEach((b, i) => b.classList.toggle("on", i === active));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const typed = input.value.trim().toUpperCase();
      if (items[active]) onPick(items[active].ticker);
      else if (typed) onPick(typed);
    } else if (e.key === "Escape") {
      list.hidden = true;
    }
  });
  return { node: el("div", { class: "search" }, input, list), input };
}

// ------------------------------------------------------------------ the ticker's cards

const label = (t, extra = null) => el("div", { class: "label" }, el("span", {}, t), extra);
const sub = (t, cls = "") => el("p", { class: `sub ${cls}`.trim() }, t);

function headerCard(state, doc, ticker, dispose) {
  const { stock } = state;
  const points = cleanSeries(arr(doc.prices).map((p) => ({ time: p && p.date, value: p && p.close })));
  const prices = points.map((p) => ({ date: p.time, close: p.value }));
  const last = prices.at(-1);
  const prev = prices.at(-2);
  const change = last && prev ? last.close / prev.close - 1 : null;
  const sixMonths = prices.length > 1 ? last.close / prices[0].close - 1 : null;
  const box = el("div", { class: "chart-box" });
  const card = el("section", { class: "card wide", "data-card": "r_header" },
    label([SOURCES[stock.source], stock.sector].filter(Boolean).join(" · ") || "Stock", last ? el("span", {}, `Last close ${dayText(last.date)}`) : null),
    el("div", { class: "big" }, el("span", { class: "ticker" }, stock.ticker), " ", stock.name),
    last ? el("p", { class: "sub" }, `$${last.close.toFixed(2)} `,
      change == null ? null : el("span", { class: change >= 0 ? "up" : "down" }, `${pct(change)} on the day`),
      sixMonths == null ? null : el("span", {}, ` · ${pct(sixMonths)} over six months`)) : null,
    prices.length ? (chartsReady() ? box : sub("The chart couldn't load.")) : sub("No chart data"),
    doc.madeAt ? sub(madeText(doc.madeAt, runKind(doc.madeAt)), "made") : null);
  if (prices.length && chartsReady()) {
    queueMicrotask(() => {
      if (!box.isConnected) return;
      try {
        dispose.push(areaChart(box, points).dispose);
      } catch (err) {
        console.warn("chart:", err);
        box.replaceWith(sub("No chart data"));
      }
    });
  }
  return card;
}

function viewCard(ticker, doc, today) {
  const ranking = arr(today && today.payload && today.payload.ranking);
  const pick = arr(today && today.payload && today.payload.picks).find((p) => p.ticker === ticker);
  const r = doc.rank;
  if (!r) {
    return el("section", { class: "card half", "data-card": "r_model" }, label("The model's view"),
      el("div", { class: "big" }, ranking.length ? `Not in today's top ${ranking.length}` : "No ranking yet today"),
      sub(ranking.length ? "The model ranks every stock each morning; only the top ones are kept." : "The model ranks every stock each morning after 6am New York time."));
  }
  const index = ranking.findIndex((x) => x.ticker === ticker);
  const place = r.rank ?? (index >= 0 ? index + 1 : null);
  return el("section", { class: "card half", "data-card": "r_model" }, label("The model's view"),
    el("div", { class: "big" }, place == null ? "Ranked today" : `#${place} of ${r.of || ranking.length || "?"}`),
    rankText({ ...r, rank: place, of: r.of || ranking.length }) ? sub(rankText({ ...r, rank: place, of: r.of || ranking.length })) : null,
    sub(pick ? "One of today's picks" : `In this morning's top ${ranking.length || "list"}, not picked`),
    pick ? chips(pick.reasons) : null);
}

function earningsCard(doc) {
  const rows = arr(doc.earnings);
  const card = el("section", { class: "card half", "data-card": "r_earnings" }, label("Earnings"));
  if (!rows.length) { card.append(sub("No earnings data collected for this stock yet.")); return card; }
  const { last, next } = earningsSummary(rows);
  card.append(
    last ? el("div", { class: "big" }, last.surprise_pct == null ? `EPS ${last.eps_actual}` : `${last.surprise_pct >= 0 ? "Beat" : "Missed"} by ${Math.abs(last.surprise_pct).toFixed(0)}%`) : el("div", { class: "big" }, "—"),
    last ? sub(`Last report ${reportDate(last)}: ${last.eps_actual} vs ${last.eps_estimate ?? "?"} expected`) : null,
    next ? sub(`Next report ${relativeDay(reportTime(next).toISOString())} ${reportDate(next)}`) : sub("Next report date not known yet"));
  return card;
}

function analystCard(doc) {
  const rows = newest(arr(doc.analyst).slice().sort((a, b) => text(b.public_at).localeCompare(text(a.public_at))), 10);
  const card = el("section", { class: "card half", "data-card": "r_analysts" }, label("Analyst changes · latest 10"));
  if (!rows.length) { card.append(sub("No analyst rating changes collected yet.")); return card; }
  card.append(el("div", { class: "news" }, rows.map((a) => el("div", { class: "news-item" },
    el("span", { class: `marker ${a.action === "up" ? "up" : a.action === "down" ? "down" : "muted"}` }, a.action === "up" ? "▲" : a.action === "down" ? "▼" : "•"),
    el("div", {}, `${text(a.firm)}: ${ACTIONS[a.action] || text(a.action)}${a.to_grade ? ` · ${a.to_grade}` : ""}`,
      el("br"), el("small", {}, `${londonDate(a.public_at)} ${a.public_at ? localTime(a.public_at) : ""}`))))));
  return card;
}

function newsCard(doc) {
  const rows = newest(arr(doc.news).slice().sort((a, b) => text(b.public_at).localeCompare(text(a.public_at))), 10);
  const card = el("section", { class: "card half", "data-card": "r_news" }, label("Headlines · latest 10"));
  if (!rows.length) { card.append(sub("No headlines collected yet: news is gathered each morning for the stocks most likely to be picked.")); return card; }
  card.append(el("div", { class: "news" }, rows.map((n) => {
    const s = Number(n.sentiment || 0);
    const href = safeUrl(n.url);
    return el(href ? "a" : "div", { class: "news-item", href, target: href ? "_blank" : null, rel: href ? "noopener noreferrer" : null },
      el("span", { class: `marker ${s > 0.05 ? "up" : s < -0.05 ? "down" : "muted"}` }, s > 0.05 ? "▲" : s < -0.05 ? "▼" : "•"),
      el("div", {}, text(n.title), el("br"), el("small", {}, `${text(n.publisher)} · ${londonDate(n.public_at)}`)));
  })));
  return card;
}

// ------------------------------------------------------------------ the tab

function mount(container, { arg } = {}) {
  const ticker = arg ? String(arg).trim().toUpperCase() : null;
  let stocks = [];
  const { node, input } = searchBox((t) => go("research", t), () => stocks);
  const quick = el("div", { class: "chips", style: { marginTop: "14px" } });
  const body = el("div", { style: { marginTop: "22px" } });
  container.append(el("h1", { class: "page-title" }, "Research"),
    el("p", { class: "lead" }, "Everything the model knows about a stock: its price, how the model rates it today, earnings, analyst changes and the latest headlines."),
    node, quick, body);
  if (ticker) input.value = ticker;
  else if (typeof matchMedia === "function" && matchMedia("(min-width: 700px)").matches) setTimeout(() => input.focus(), 50);

  const stop = mountLive(body, {
    names: [], optional: ["universe", "today"], ticker,
    render: (docs, into) => {
      const dispose = [];
      stocks = arr(docs.universe && docs.universe.rows);
      const picks = arr(docs.today && docs.today.payload && docs.today.payload.picks);
      quick.replaceChildren(...(picks.length ? [el("span", { class: "sub" }, "Today's picks:"),
        ...picks.map((p) => el("button", { class: "btn small", type: "button", onclick: () => go("research", p.ticker) }, p.ticker))] : []));
      if (!ticker) { into.replaceChildren(); return null; }
      const state = tickerState(ticker, stocks, docs.ticker);
      const grid = el("div", { class: "grid" });
      if (!state.followed) {
        grid.append(el("section", { class: "card wide", "data-card": "r_header" }, label(ticker),
          sub(state.message), sub("It follows the S&P 500, the Nasdaq-100, a list of ETFs and each morning's movers.")));
        into.append(grid);
        return null;
      }
      grid.append(headerCard(state, docs.ticker, ticker, dispose), viewCard(ticker, docs.ticker, docs.today), earningsCard(docs.ticker),
        analystCard(docs.ticker), newsCard(docs.ticker));
      into.append(grid);
      return () => { for (const d of dispose) d(); };
    },
  });
  return () => stop();
}
