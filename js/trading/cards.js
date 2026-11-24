// Trading's contribution to the Overview online: its "Your day" phrases and its cards, carried from the Mac's
// trading-cards.js. The engine runs on GitHub and publishes read-only documents, so every card reads them through
// readTrading() and redraws only when a watched document really changed. Text that came from the data is placed with
// textContent (el text nodes) only. There are no "Open in simulator" buttons: the simulator stays on the Mac.
import { el, money, pct } from "../core/dom.js";
import { onVisible } from "../core/visible.js";
import { chips } from "./chips.js";
import { forwardFrom, readTrading, watchTrading } from "./load.js";
import { marketStatus, nyDay } from "./market.js";
import { mountTradingSettings } from "./settings-card.js";
import {
  chartText, excessVsSpy, growthSeries, holdText, localTime, madeText, marketPhrase, outlookText, picksPhrase, picksSummary,
  rankText, relativeDay, runNotice,
} from "./text.js";

export const PRACTICE_NOTE = "Practice sessions are on your Mac";

// ------------------------------------------------------------------ pure pieces (tested in Node)

/** { rose, total } from trading/record (0 and 0 when it is missing or malformed). */
export function winRateOf(record) {
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { rose: n(record && record.rose), total: n(record && record.total) };
}

/** The Money card's lines, from trading/account; the last one is always the note about practice sessions. */
export function moneyLines(account) {
  const a = account || {};
  const rows = Array.isArray(a.equityRows) ? a.equityRows : [];
  const batches = Number.isFinite(a.openBatches) ? a.openBatches : 0;
  return [
    "Model's paper account",
    money(Number.isFinite(a.equity) ? a.equity : (Number.isFinite(a.capital) ? a.capital : 100000)),
    rows.length ? `since ${rows[0].d}` : "starts with the first graded day",
    `${batches} batch${batches === 1 ? "" : "es"} open`,
    PRACTICE_NOTE,
  ];
}

/** "As of this morning's run" needs to know which run made a document: the morning's, or the evening's. */
export function runKind(madeAt) {
  if (!madeAt) return undefined;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(new Date(madeAt)));
  return hour < 12 ? "morning" : "evening";
}

/** Colour by the value as shown (two decimals of a percent), so a change that rounds to 0.00% is neutral. */
export const tone = (x) => { const r = Math.round(Number(x) * 10000); return r > 0 ? "up" : r < 0 ? "down" : ""; };

const text = (doc) => JSON.stringify(doc ?? null);

// ------------------------------------------------------------------ reading and watching

/** One reader per card: it remembers what each document looked like when last read or reported, so the card's
 * watch calls refresh only for a real change (the first report after a read is the same data). */
function reader(names) {
  const seen = new Map();
  return {
    async read() {
      const docs = {};
      for (const name of names) { docs[name] = await readTrading(name); seen.set(name, text(docs[name])); }
      return docs;
    },
    watch(refresh) {
      const stopWatch = watchTrading(names, (name, doc) => {
        const t = text(doc);
        if (seen.get(name) === t) return;
        seen.set(name, t);
        refresh();
      });
      const stopVisible = typeof document === "undefined" ? () => {} : onVisible(refresh);              // an app left open overnight moves on to the new day
      return () => { stopWatch(); stopVisible(); seen.clear(); };
    },
  };
}

/** True when `body` already shows exactly this (the key covers the data and the day). */
function unchanged(body, key) {
  if (body.dataset.rendered && body._tradingKey === key && !body.querySelector(".card-empty, .card-error")) return true;
  body._tradingKey = key;
  return false;
}

// ------------------------------------------------------------------ small pieces

/** replaceChildren that skips empty slots (a null would otherwise be drawn as the word "null"). */
const put = (body, ...nodes) => body.replaceChildren(...nodes.filter(Boolean));
const label = (t, extra = null) => el("div", { class: "label" }, el("span", {}, t), extra);
const big = (t, cls = "") => el("div", { class: `big ${cls}` }, t);
const sub = (t, cls = "") => el("p", { class: `sub ${cls}`, style: { margin: "6px 0 0" } }, t);
const made = (doc) => (doc && doc.madeAt ? sub(madeText(doc.madeAt, runKind(doc.madeAt)), "made") : null);

function meter(fraction) {
  const bar = el("i");
  requestAnimationFrame(() => bar.style.setProperty("--w", `${Math.max(0, Math.min(1, fraction)) * 100}%`));
  return el("div", { class: "meter" }, bar);
}

function previousWeekday(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

const SVG = "http://www.w3.org/2000/svg";

/** Two lines on one scale as an inline SVG that follows the theme through CSS variables. */
function lineSvg(series) {
  const W = 600, H = 240, PAD = 8;
  const all = series.flatMap((s) => s.points.map((p) => p.value));
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const count = Math.max(...series.map((s) => s.points.length));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "tr-line");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", series.map((s) => `${s.name} ends at ${money(s.points.at(-1).value)}`).join(", "));
  for (const s of series) {
    const line = document.createElementNS(SVG, "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", s.color);
    line.setAttribute("stroke-width", "2");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    line.setAttribute("points", s.points.map((p, i) =>
      `${(PAD + (i / Math.max(count - 1, 1)) * (W - 2 * PAD)).toFixed(1)},${(H - PAD - ((p.value - lo) / span) * (H - 2 * PAD)).toFixed(1)}`).join(" "));
    svg.append(line);
  }
  return svg;
}

// ------------------------------------------------------------------ the cards

const outlookReader = reader(["today"]);
const outlookCard = {
  id: "outlook", order: 5, size: "large", title: "Model outlook",
  async load() { const { today } = await outlookReader.read(); return { today, now: new Date() }; },
  empty: ({ today, now }) => (today && today.day === nyDay(now) && today.payload && today.payload.outlook ? null
    : `No outlook yet — the model publishes one each morning after ${localTime(picksSummary(today, now).expected_after)}`),
  render({ today, now }, body) {
    if (unchanged(body, `${text(today)}|${nyDay(now)}`)) return;
    const words = outlookText(today.payload.outlook);
    put(body,
      label("Model outlook", today.payload.champion ? el("span", { class: "ticker" }, `${today.payload.champion} · champion`) : null),
      big(words.label), sub(words.sentence), sub(`Picks are ${holdText(today.payload)}.`), made(today));
  },
  watch: (refresh) => outlookReader.watch(refresh),
};

const moneyReader = reader(["account"]);
const moneyCard = {
  id: "money", order: 10, size: "small", title: "Money",
  async load() { const { account } = await moneyReader.read(); return { doc: account }; },
  empty: ({ doc }) => (doc ? null : "The model's paper account appears after the first evening run."),
  render({ doc }, body) {
    if (unchanged(body, `${text(doc)}|${nyDay(new Date())}`)) return;
    const [title, amount, since, batches, note] = moneyLines(doc);
    put(body, label("Money"),
      el("div", { class: "sub" }, title), big(amount), el("div", { class: "sub" }, since), el("div", { class: "sub" }, batches),
      sub(note), made(doc));
  },
  watch: (refresh) => moneyReader.watch(refresh),
};

const spyReader = reader(["record"]);
const vsSpyCard = {
  id: "vs_spy", order: 20, size: "small", title: "Model vs S&P 500",
  async load() { const { record } = await spyReader.read(); return { doc: record, forward: forwardFrom(record) }; },
  empty: ({ forward }) => (excessVsSpy(forward).days ? null : "No live days yet: the record starts with the first picks published before an open."),
  render({ doc, forward }, body) {
    if (unchanged(body, `${text(doc)}|${nyDay(new Date())}`)) return;
    const { excess, days } = excessVsSpy(forward);
    put(body, label("Model vs S&P 500"), big(pct(excess), tone(excess)),
      sub(`over ${days} trading day${days === 1 ? "" : "s"} of live picks`), made(doc));
  },
  watch: (refresh) => spyReader.watch(refresh),
};

const winReader = reader(["record"]);
const winRateCard = {
  id: "win_rate", order: 30, size: "small", title: "Pick win rate",
  async load() { const { record } = await winReader.read(); return { doc: record, ...winRateOf(record) }; },
  empty: ({ total }) => (total ? null : "No graded picks yet: each pick is graded the evening after it is traded."),
  render({ doc, rose, total }, body) {
    if (unchanged(body, `${text(doc)}|${nyDay(new Date())}`)) return;
    put(body, label("Pick win rate"), big(`${Math.round((rose / total) * 100)}%`), sub(`${rose} of ${total} picks rose`), made(doc));
  },
  watch: (refresh) => winReader.watch(refresh),
};

const unlockReader = reader(["unlock"]);
const unlockCard = {
  id: "unlock", order: 40, size: "small", title: "Real-money unlock",
  async load() { const { unlock } = await unlockReader.read(); return { doc: unlock }; },
  empty: ({ doc }) => (doc && Array.isArray(doc.conditions) ? null : "The unlock check appears after the first evening run."),
  render({ doc: unlock }, body) {
    if (unchanged(body, `${text(unlock)}|${nyDay(new Date())}`)) return;
    const daysRule = unlock.conditions.find((c) => c.name === "days");
    const needed = daysRule && /of (\d+)/.exec(daysRule.value_text || "") ? Number(/of (\d+)/.exec(daysRule.value_text)[1]) : 126;
    const days = Number(unlock.days ?? (daysRule && daysRule.value) ?? 0);
    const met = unlock.conditions.filter((c) => c.met).length;
    put(body, label("Real-money unlock"),
      big(unlock.unlocked ? "Unlocked" : `${days} / ${needed} days`), meter(days / needed),
      sub(unlock.unlocked ? "All seven rules are met on live picks." : `${met} of ${unlock.conditions.length} rules met · must beat buying and holding on unseen days`),
      made(unlock));
  },
  watch: (refresh) => unlockReader.watch(refresh),
};

const RANGES = { "1M": 21, "3M": 63, All: Infinity };
const growthReader = reader(["record"]);
const growthCard = {
  id: "growth", order: 100, size: "wide", title: "Growth of $100,000",
  async load() { const { record } = await growthReader.read(); return { doc: record, forward: forwardFrom(record) }; },
  empty: ({ forward }) => (forward.days.length >= 2 ? null : "The chart starts once the first picks have been graded."),
  render(data, body) {
    if (unchanged(body, `${text(data.doc)}|${nyDay(new Date())}`)) return;
    draw(data, body);
  },
  watch: (refresh) => growthReader.watch(refresh),
};

function draw({ doc, forward }, body) {
  const { model, spy } = growthSeries(forward);
  const range = body._range || "All";
  const seg = el("div", { class: "seg" }, Object.keys(RANGES).map((name) => el("button", {
    type: "button", class: name === range ? "on" : "", "aria-pressed": name === range ? "true" : "false",
    onclick: () => { body._range = name; draw({ doc, forward }, body); } }, name)));
  const n = RANGES[range];
  const cut = (points) => (Number.isFinite(n) ? points.slice(-n) : points);
  const box = el("div", { class: "chart-box" }, lineSvg([
    { name: "Model", points: cut(model), color: "var(--accent)" },
    { name: "S&P 500", points: cut(spy), color: "var(--faint)" }]));
  put(body, el("div", { class: "chart-head" }, label("Growth of $100,000 · live picks"),
    el("div", { class: "legend" }, el("span", {}, el("i", { style: { background: "var(--accent)" } }), "Model"),
      el("span", {}, el("i", { style: { background: "var(--faint)" } }), "S&P 500")), seg), box, made(doc));
}

function pickCard(p, rank, large, payload) {
  const change = p.change == null ? null : Number(p.change);
  const weight = p.weight == null ? "" : `${pct(p.weight, { sign: false, digits: 0 })} `;
  if (!large) {
    return el("div", { class: "card mini-pick", style: { "--i": rank } },
      el("div", { class: "row" }, el("span", { class: "ticker" }, p.ticker), el("span", { class: "label" }, rankText(p))),
      el("h4", {}, p.name || p.ticker),
      el("div", { class: "sub" }, (p.reasons || []).slice(0, 2).join(" · ") || p.sector || ""),
      el("div", { class: "pick-foot" }, el("span", { class: "sub" }, `${weight}of the money`)));
  }
  return el("div", { class: "card large pick", style: { "--i": 1 } },
    el("div", { class: "pick-top" },
      el("div", {}, el("div", {}, el("span", { class: "ticker" }, p.ticker), " ",
        el("span", { class: "label", style: { display: "inline" } }, `#${rank} pick`)),
        el("h3", {}, p.name || p.ticker),
        el("div", { class: "sub" }, [p.sector, p.price != null ? `$${Number(p.price).toFixed(2)}` : null].filter(Boolean).join(" · "), " ",
          change == null ? null : el("span", { class: tone(change) }, pct(change))),
        chips(p.reasons),
        chartText(p) ? el("p", { class: "sub", style: { margin: "8px 0 0" } }, chartText(p)) : null),
      el("div", { class: "rank-badge" }, el("div", { class: "big" }, `#${p.rank ?? rank}`), el("div", { class: "label" }, rankText(p)))),
    el("div", { class: "pick-foot" },
      el("span", { class: "sub" }, `${weight}of the batch · bought at the open, ${holdText(payload)}`)));
}

const picksReader = reader(["today", "status"]);
const picksCard = {
  id: "todays_picks", order: 110, size: "wide", className: "bare", title: "Today's picks",
  async load(now = new Date()) {
    const { today, status } = await picksReader.read();
    return { today, status, now, notice: runNotice(status, today, now) };
  },
  empty({ today, now, notice }) {
    if (!today || !today.day) return notice || `Today's picks appear here after ${localTime(picksSummary(today, now).expected_after)} on trading days.`;
    const payload = today.payload || {};
    if (today.day === nyDay(now)) {
      if (today.status === "prices stale") return payload.message || "No picks today: prices weren't up to date.";
      if (today.status === "market closed") return "The market was closed today.";
      if (!(payload.picks || []).length) return "The model sits out today: no stock scored above its confidence level.";
      return null;
    }
    return (payload.picks || []).length ? null : notice || "No picks yet today";    // the last good picks stay visible, dated
  },
  render({ today, now, notice }, body) {
    if (unchanged(body, `${text(today)}|${notice}|${nyDay(now)}`)) return;
    const payload = today.payload;
    const picks = payload.picks;
    const notes = [];
    if (notice) notes.push(el("span", { class: "warn" }, notice), " ");
    if (today.late) notes.push(el("span", { class: "warn" }, "Published after the open, so these don't count towards the live record."), " ");
    if (payload.signal_date && payload.signal_date < previousWeekday(payload.day)) notes.push(`Based on prices from ${payload.signal_date}.`);
    put(body,
      el("div", { class: "section-title", style: { margin: "0 0 14px" } },
        el("h2", {}, "Today's picks ", el("span", { class: "muted" }, "ranked by the model")),
        el("span", { class: "label" }, today.published_at ? `Published ${relativeDay(today.published_at, now)} ${localTime(today.published_at)}` : "")),
      notes.length ? el("p", { class: "sub" }, notes) : null,
      el("div", { class: "tr-picks" }, pickCard(picks[0], 1, true, payload),
        picks.length > 1 ? el("div", { class: "stack" }, picks.slice(1).map((p, i) => pickCard(p, i + 2, false, payload))) : null),
      made(today));
  },
  watch: (refresh) => picksReader.watch(refresh),
};

export function registerTrading({ registerCard, registerDayPart, registerSettingsCard }) {
  registerDayPart({ id: "market", order: 10, load: async (now = new Date()) => marketPhrase(marketStatus(now), now) });
  registerDayPart({ id: "picks", order: 20, async load(now = new Date()) {
    try {
      return picksPhrase(picksSummary(await readTrading("today"), now), marketStatus(now), now);
    } catch {
      return null;
    }
  } });
  for (const card of [outlookCard, moneyCard, vsSpyCard, winRateCard, unlockCard, growthCard, picksCard]) registerCard(card);
  registerSettingsCard({ id: "trading", order: 30, mount: mountTradingSettings });
}
