// Lessons: the tab (today, to confirm, this month, payments, months, totals), the Overview card, the
// "Your day" phrase and the Settings card. Figures come from the records in Firestore (watchLessons ->
// buildLessons) and every change redraws from the watch; wording lives in lessons/text.js. Everything shown is
// placed with textContent (notes are free text), never as markup.
import { data } from "../core/data.js";
import { SHORT_DAYS, el, londonDay, table, toast } from "../core/dom.js";
import { go } from "../core/router.js";
import { onVisible } from "../core/visible.js";
import { saveDay, removeDay, addPayment, removePayment, previewRate, saveRate, saveLessonSettings } from "../lessons/actions.js";
import { monthCsv, taxYearCsv } from "../lessons/csv.js";
import { buildLessons, readLessons, recordsFrom, watchLessons } from "../lessons/records.js";
import {
  compact, createRateFlow, dateText, dayPhrase, longDate, monthName, owedLine, parsePounds, paymentMonths, pounds, previewText, statusText,
} from "../lessons/text.js";

export const tab = { id: "lessons", label: "Lessons", icon: "lessons", order: 75, mount };

const NEEDS_SETUP = "Set your rate and weekly timetable in Settings to start";
const MISSING_RATE = "Set your rate in Settings — some days have no rate";
const BAD_AMOUNT = "Enter an amount like 108 or 108.50";
const BAD_LESSONS = "Lessons must be a whole number from 0 to 30";
const LOAD_FAILED = "Couldn't load your lessons. Check your connection and try again.";
const WAIT_MS = 10000;

const needsSetup = (lessons) => !lessons || lessons.rate == null || lessons.timetable == null;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const today = () => londonDay(new Date());
const context = () => ({ today: today(), now: new Date().toISOString(), onFail: toast });

/** Milliseconds from `now` to the next London midnight (found by search, so summer time and the clock change are right). */
export function msToLondonMidnight(now) {
  const day = londonDay(now);
  let lo = 0;
  let hi = 26 * 3600000;       // a London day is never longer than 25 hours
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (londonDay(new Date(now.getTime() + mid)) === day) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * Calls onTick() when the page comes back into view and at each London midnight while it stays open, so "Today"
 * never shows yesterday. Everything is injectable for tests. Returns stop() (clears the timer and the listener).
 */
export function watchToday({ onTick, clock = () => new Date(), doc = document, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    timer = setTimer(() => { timer = null; if (stopped) return; onTick(); arm(); }, msToLondonMidnight(clock()) + 50);
  };
  const stopVisible = onVisible(onTick, doc);
  arm();
  return () => {
    stopped = true;
    if (timer !== null) { clearTimer(timer); timer = null; }
    stopVisible();
  };
}

/**
 * Wraps the Lessons drawing so a report that carries the same records on the same day (a metadata-only snapshot:
 * a write acknowledged, cache then server, back online) draws nothing, and a typed-in box keeps its focus.
 * `force` redraws anyway (the user's own action closing a form).
 */
export function makeDrawGate(paint) {
  let last = null;
  return {
    draw(records, today, force = false) {
      const print = JSON.stringify([today, records]);
      if (!force && print === last) return false;
      last = print;
      paint(records, today);
      return true;
    },
  };
}

/** A count box's text -> whole number 0 to 30, or null. */
function parseLessons(text) {
  const t = String(text).trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n <= 30 ? n : null;
}

/** Saves a CSV the way a download link would: a Blob and a temporary <a download>. */
export function downloadCsv({ name, text }) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = el("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Watches the lessons records and calls onData(records) on every change. The data layer does not report a dead
 * listener, so if nothing arrives within `waitMs` (or the watch throws at once) onError() is called instead, and
 * the page shows a plain error with Retry rather than staying on "Loading…". Returns stop().
 */
export function watchLive(d, { onData, onError, waitMs = WAIT_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let stopWatch = () => {};
  let stopped = false;
  try {
    timer = setTimer(() => { timer = null; if (!stopped) onError(); }, waitMs);
    stopWatch = watchLessons(d, (records) => {
      if (stopped) return;
      if (timer !== null) { clearTimer(timer); timer = null; }
      onData(records);
    });
  } catch {
    if (timer !== null) { clearTimer(timer); timer = null; }
    onError();
  }
  return () => {
    stopped = true;
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (typeof stopWatch === "function") stopWatch();
  };
}

/**
 * The rate change gate over live records: the preview and the save both read the records at that moment, so a day
 * another device added in between is never slipped past the Confirm. Problems are thrown as their message.
 */
export function makeRateFlow(d, getRecords, onFail) {
  return createRateFlow({
    async preview(pence, effectiveFrom) {
      const result = previewRate(getRecords(), { pence, effectiveFrom });
      if (result.error) throw new Error(result.error);
      return result;
    },
    async save({ pence, effective_from: effectiveFrom, confirm }) {
      const result = saveRate(d, getRecords(), { pence, effectiveFrom, confirm }, { onFail });
      if (result.error) throw new Error(result.error);
      return result;
    },
  });
}

const status = (month) => el("span", { class: `lz-status ${month.status}` }, statusText(month.status));
const csvButton = (label, make) => el("button", { class: "btn ghost small", type: "button", onclick: () => downloadCsv(make()) }, label);

const errorSection = (message, retry) => el("section", { class: "card lz-section wide static card-error", role: "alert" },
  el("p", { class: "sub" }, message),
  el("button", { class: "btn ghost small", type: "button", onclick: retry }, "Retry"));

// ------------------------------------------------------------------ tab

function mount(container) {
  container.append(el("h1", { class: "page-title" }, "Lessons"));
  const body = el("div", { class: "grid" }, el("p", { class: "sub", role: "status" }, "Loading…"));
  container.append(body);
  let alive = true;
  let records = null;
  let lessons = null;
  let stopWatch = () => {};
  const editing = new Set();       // days whose entry form is open
  const drafts = new Map();        // what is typed in an open form, so a change from another device doesn't wipe it

  /** Gives an input its unsaved text back after a redraw, and remembers what is typed. */
  function draft(key, input) {
    if (drafts.has(key)) input.value = drafts.get(key);
    const remember = () => drafts.set(key, input.value);
    input.addEventListener("input", remember);
    input.addEventListener("change", remember);
    return input;
  }
  const dropDrafts = (prefix) => { for (const key of [...drafts.keys()]) if (key.startsWith(prefix)) drafts.delete(key); };

  const done = (result, message) => {
    if (result && result.error) { toast(result.error); return false; }
    if (message) toast(message);
    return true;
  };

  const save = (date, count, note) => {
    if (!done(saveDay(data(), date, count, note, context()), "Saved")) return;
    editing.delete(date);
    dropDrafts(`day:${date}:`);
    draw();
  };

  const remove = (date) => {
    if (!window.confirm(`Remove the lessons recorded for ${dateText(date)}? This can't be undone.`)) return;
    if (!done(removeDay(data(), date, { onFail: toast }), "Removed")) return;
    editing.delete(date);
    dropDrafts(`day:${date}:`);
    draw();
  };

  /** Number box, note and buttons for one day. `usual` adds a Confirm button for the timetable count. */
  function dayForm(date, { count = "", note = "", usual = null, cancel = null }) {
    const box = draft(`day:${date}:count`, el("input", { type: "number", inputmode: "numeric", min: "0", max: "30", step: "1", value: count,
      placeholder: usual === null ? "Lessons" : String(usual), "aria-label": `Lessons on ${dateText(date)}`, class: "lz-count" }));
    const noteBox = draft(`day:${date}:note`, el("input", { type: "text", maxlength: "200", value: note, placeholder: "Note (optional)", "aria-label": "Note", class: "lz-note" }));
    const submit = () => {
      const n = parseLessons(box.value);
      if (n === null) { toast(BAD_LESSONS); return; }
      save(date, n, noteBox.value.trim());
    };
    for (const input of [box, noteBox]) input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    return el("div", { class: "lz-form" },
      usual !== null ? el("button", { class: "btn primary", type: "button", onclick: () => save(date, usual, noteBox.value.trim()) }, `Confirm ${usual}`) : null,
      usual !== null ? el("span", { class: "sub" }, "or") : null,
      box, noteBox,
      el("button", { class: "btn", type: "button", onclick: submit }, "Save"),
      cancel ? el("button", { class: "btn ghost", type: "button", onclick: cancel }, "Cancel") : null);
  }

  const openEditor = (date) => { editing.add(date); draw(); };
  const closeEditor = (date) => { editing.delete(date); dropDrafts(`day:${date}:`); draw(); };

  function todaySection() {
    const t = lessons.today;
    const entry = lessons.this_month.days.find((d) => d.date === t);
    const heading = el("div", { class: "label" }, el("span", {}, "Today"), el("span", {}, dateText(t)));
    if (entry && !editing.has(t)) {
      return el("section", { class: "card lz-section wide static" }, heading,
        el("p", { class: "big" }, `Today: ${plural(entry.lessons, "lesson")}${entry.amount == null ? "" : ` · ${pounds(entry.amount)}`}`),
        entry.note ? el("p", { class: "sub" }, entry.note) : null,
        el("div", { class: "actions" },
          el("button", { class: "btn", type: "button", onclick: () => openEditor(t) }, "Change"),
          el("button", { class: "btn ghost danger", type: "button", onclick: () => remove(t) }, "Remove")));
    }
    const usual = !entry && lessons.expected_today ? lessons.expected_today : null;
    return el("section", { class: "card lz-section wide static" }, heading,
      el("p", { class: "big" }, usual !== null ? `${dateText(t).split(" ")[0]} — usually ${usual}` : entry ? "Change today" : "Nothing expected today"),
      dayForm(t, { count: entry ? entry.lessons : "", note: entry ? entry.note || "" : "", usual, cancel: entry ? () => closeEditor(t) : null }));
  }

  function confirmSection() {
    if (!lessons.to_confirm.length) return null;
    return el("section", { class: "card lz-section wide static" },
      el("div", { class: "label" }, el("span", {}, "To confirm"), el("span", {}, plural(lessons.to_confirm.length, "day"))),
      lessons.to_confirm.map((p) => el("div", { class: "lz-pending" },
        el("div", {}, el("strong", {}, dateText(p.date)), el("span", { class: "sub" }, ` usually ${p.usual}`)),
        dayForm(p.date, { usual: p.usual }))));
  }

  function monthSection() {
    const m = lessons.this_month;
    const rows = m.days.map((d) => {
      if (editing.has(d.date) && d.date !== lessons.today) {
        return el("tr", {}, el("td", {}, dateText(d.date)),
          el("td", { colspan: "4" }, dayForm(d.date, { count: d.lessons, note: d.note || "", cancel: () => closeEditor(d.date) })));
      }
      return el("tr", {}, el("td", {}, dateText(d.date)), el("td", { class: "num" }, d.lessons),
        el("td", { class: "num" }, d.amount == null ? "No rate" : pounds(d.amount)), el("td", {}, d.note || ""),
        el("td", { class: "lz-actions" },
          el("button", { class: "btn ghost small", type: "button", onclick: () => openEditor(d.date) }, "Change"),
          el("button", { class: "btn ghost small danger", type: "button", onclick: () => remove(d.date) }, "Remove")));
    });
    return el("section", { class: "card lz-section wide static" },
      el("div", { class: "label" }, el("span", {}, "This month"), el("span", {}, monthName(m.month))),
      m.days.length
        ? table(["Day", { label: "Lessons", attrs: { class: "num" } }, { label: "Amount", attrs: { class: "num" } }, "Note", ""], rows)
        : el("p", { class: "sub" }, "No lessons recorded this month yet"),
      m.missing_rate ? el("p", { class: "sub lz-warn" }, MISSING_RATE) : null,
      totals(m));
  }

  function totals(m) {
    const cell = (label, value, cls) => el("div", {}, el("dt", {}, label), el("dd", { class: cls || "" }, value));
    return el("dl", { class: "lz-totals" }, cell("Lessons", m.lessons), cell("Earned", pounds(m.earned)),
      cell("Paid", pounds(m.paid)), cell("Owed", pounds(m.owed), m.owed > 0 ? "owed" : ""));
  }

  function paymentsSection() {
    const amount = draft("pay:amount", el("input", { type: "text", inputmode: "decimal", placeholder: "Amount, e.g. 108.50", "aria-label": "Amount", autocomplete: "off" }));
    const received = draft("pay:received", el("input", { type: "date", value: lessons.today, max: lessons.today, "aria-label": "Date received" }));
    const months = paymentMonths(lessons);
    const monthBox = el("select", { "aria-label": "Month the payment is for" },
      months.map((mk) => el("option", { value: mk, selected: mk === lessons.default_payment_month }, monthName(mk))));
    draft("pay:month", monthBox);
    const note = draft("pay:note", el("input", { type: "text", maxlength: "200", placeholder: "Note (optional)", "aria-label": "Payment note" }));
    const add = () => {
      const pence = parsePounds(amount.value);
      if (pence === null) { toast(BAD_AMOUNT); return; }
      const result = addPayment(data(), { received: received.value, pence, month: monthBox.value, note: note.value.trim() }, context());
      if (!done(result, "Payment added")) return;
      dropDrafts("pay:");
      draw();
    };
    amount.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    const removeOne = (p) => {
      if (!window.confirm(`Remove the ${pounds(p.pence)} payment received ${dateText(p.received)}? This can't be undone.`)) return;
      if (done(removePayment(data(), p.id, { onFail: toast }), "Removed")) draw();
    };
    const list = lessons.payments.length
      ? table(["Received", "For", { label: "Amount", attrs: { class: "num" } }, "Note", ""], lessons.payments.map((p) => [
        `${dateText(p.received)} ${p.received.slice(0, 4)}`, monthName(p.month), el("span", { class: "num" }, pounds(p.pence)), p.note || "",
        el("button", { class: "btn ghost small danger", type: "button", onclick: () => removeOne(p) }, "Remove")]))
      : el("p", { class: "sub" }, "No payments recorded yet");
    return el("section", { class: "card lz-section wide static" }, el("div", { class: "label" }, "Payments"),
      el("div", { class: "lz-form" }, el("label", {}, "Received", received), el("label", {}, "Amount", amount),
        el("label", {}, "For month", monthBox), el("label", {}, "Note", note),
        el("button", { class: "btn", type: "button", onclick: add }, "Add payment")),
      list);
  }

  function monthsSection() {
    const earlier = lessons.months.filter((m) => m.month !== lessons.this_month.month).sort((a, b) => (a.month < b.month ? 1 : -1));
    if (!earlier.length) return null;
    return el("section", { class: "card lz-section wide static" }, el("div", { class: "label" }, "Months"),
      table(["Month", { label: "Lessons", attrs: { class: "num" } }, { label: "Earned", attrs: { class: "num" } },
        { label: "Paid", attrs: { class: "num" } }, { label: "Owed", attrs: { class: "num" } }, "Status", ""],
      earlier.map((m) => [monthName(m.month), el("span", { class: "num" }, m.lessons), el("span", { class: "num" }, pounds(m.earned)),
        el("span", { class: "num" }, pounds(m.paid)), el("span", { class: "num" }, pounds(m.owed)),
        el("span", {}, status(m), m.missing_rate ? el("span", { class: "sub lz-warn" }, ` ${MISSING_RATE}`) : null),
        csvButton("Download CSV", () => monthCsv(records, m.month, lessons.today))])));
  }

  function totalsSection() {
    const ty = lessons.tax_year;
    const label = `${ty.year}–${String(ty.year + 1).slice(2)}`;
    return el("section", { class: "card lz-section wide static" }, el("div", { class: "label" }, "Totals"),
      el("p", { class: "big" }, owedLine(lessons)),
      lessons.owed_incomplete || ty.missing_rate ? el("p", { class: "sub lz-warn" }, MISSING_RATE) : null,
      el("p", { class: "sub" }, `Tax year ${label} (6 April ${ty.year} to 5 April ${ty.year + 1})`),
      el("dl", { class: "lz-totals" },
        el("div", {}, el("dt", {}, "Lessons"), el("dd", {}, ty.lessons)),
        el("div", {}, el("dt", {}, ty.missing_rate ? "Earned (at least)" : "Earned"), el("dd", {}, pounds(ty.earned))),
        el("div", {}, el("dt", {}, "Paid for this tax year's months"), el("dd", {}, pounds(ty.paid))),
        el("div", {}, el("dt", {}, "Received in this tax year"), el("dd", {}, pounds(ty.received)))),
      el("div", { class: "actions" },
        csvButton(`Download CSV: ${monthName(lessons.this_month.month)}`, () => monthCsv(records, lessons.this_month.month, lessons.today)),
        csvButton(`Download CSV: tax year ${label}`, () => taxYearCsv(records, ty.year))));
  }

  const gate = makeDrawGate((_, day) => paintAll(day));
  const draw = (force = true) => { if (alive && records) gate.draw(records, today(), force); };

  function paintAll(day) {
    lessons = buildLessons(records, day);
    body.replaceChildren(...compact([
      needsSetup(lessons) ? el("section", { class: "card lz-section wide static" }, el("p", { class: "sub" }, NEEDS_SETUP)) : null,
      todaySection(), confirmSection(), monthSection(), paymentsSection(), monthsSection(), totalsSection()]));
  }

  function start() {
    stopWatch();
    body.replaceChildren(el("p", { class: "sub", role: "status" }, "Loading…"));
    stopWatch = watchLive(data(), {
      onData(next) { records = next; draw(false); },
      onError() {
        if (!alive || records) return;
        body.replaceChildren(errorSection(LOAD_FAILED, start));
      },
    });
  }

  start();
  const stopDay = typeof document === "undefined" ? () => {} : watchToday({ onTick: () => draw(false) });
  return () => { alive = false; stopWatch(); stopDay(); };
}

// ------------------------------------------------------------------ Overview card and "Your day"

function renderCard(lessons, body) {
  const card = body.closest(".card");
  if (card) {
    card.classList.add("lessons-card");
    card.classList.toggle("level-amber", lessons.months.some((m) => m.status === "late"));
  }
  const m = lessons.this_month;
  body.replaceChildren(el("div", { class: "lz-card", role: "link", tabindex: "0", onclick: () => go("lessons"),
    onkeydown: (e) => { if (e.key === "Enter") go("lessons"); } },
    el("div", { class: "label" }, el("span", {}, "Lessons"), el("span", {}, monthName(m.month))),
    el("div", { class: "big" }, pounds(m.earned)),
    el("p", { class: "sub" }, `${plural(m.lessons, "lesson")} this month`),
    m.missing_rate || lessons.owed_incomplete ? el("p", { class: "sub lz-warn" }, MISSING_RATE) : null,
    el("p", { class: "sub" }, owedLine(lessons))));
}

/** One read of the records that gives up (rejects) rather than waiting for ever when the server and the cache both stay silent. */
function readWithin(ms) {
  return Promise.race([readLessons(data()),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms))]);
}

export function registerLessons({ registerCard, registerDayPart, registerSettingsCard }) {
  let latest = null;     // the newest records the card's watch has seen
  let failed = false;
  registerCard({ id: "lessons", order: 60, size: "small", title: "Lessons",
    async load() {
      if (latest) return buildLessons(latest, today());
      if (failed) { failed = false; throw new Error("The lessons watch failed"); }
      return buildLessons(await readWithin(WAIT_MS), today());
    },
    empty: (lessons) => (needsSetup(lessons) ? NEEDS_SETUP : null),
    render: renderCard,
    watch(refresh) {
      const stop = watchLive(data(), {
        onData(records) { latest = records; failed = false; refresh(); },
        onError() { if (!latest) { failed = true; refresh(); } },
      });
      return () => { stop(); latest = null; failed = false; };
    } });
  registerDayPart({ id: "lessons", order: 40, async load(now = new Date()) {
    try {
      return dayPhrase(buildLessons(await readWithin(WAIT_MS), londonDay(now)));
    } catch {
      return null;
    }
  } });
  registerSettingsCard({ id: "lessons", order: 30, mount: mountSettingsCard });
}

// ------------------------------------------------------------------ Settings card

export function mountSettingsCard(grid, isAlive = () => true) {
  let records = null;
  let first = true;
  let dirtyWeek = false;
  const rateBox = el("input", { type: "text", inputmode: "decimal", placeholder: "e.g. 18", "aria-label": "Rate per lesson", autocomplete: "off" });
  const fromBox = el("input", { type: "date", "aria-label": "Rate applies from" });
  const rateStatus = el("p", { class: "sub", role: "status" }, "Loading…");
  const confirmArea = el("div", { class: "actions" });
  const days = [1, 2, 3, 4, 5, 6, 0];       // Monday first
  const dayBoxes = days.map((d) => el("input", { type: "number", inputmode: "numeric", min: "0", max: "30", step: "1", value: "0", "aria-label": `Usual lessons on ${SHORT_DAYS[d]}` }));
  const sinceBox = el("input", { type: "date", "aria-label": "Tracking since" });
  const tableStatus = el("p", { class: "sub", role: "status" });
  const markDirty = () => { dirtyWeek = true; };
  for (const box of [...dayBoxes, sinceBox]) box.addEventListener("input", markDirty);

  const showRate = (lessons) => {
    rateStatus.textContent = lessons.rate ? `Current rate: ${pounds(lessons.rate.pence)} per lesson since ${longDate(lessons.rate.effective_from)}` : "No rate set yet.";
    // First rate should cover back-filled days: default to the earliest day without a rate.
    if (!fromBox.value) fromBox.value = lessons.rate_default_from || lessons.today;
  };
  const flow = makeRateFlow(data(), () => records || recordsFrom({}), toast);
  const clearPreview = () => { flow.reset(); confirmArea.replaceChildren(); };
  const notReady = () => {
    if (records) return false;
    rateStatus.textContent = "Still loading — try again in a moment.";
    return true;
  };
  const savedRate = () => { confirmArea.replaceChildren(); rateStatus.textContent = ""; toast("Rate saved"); };
  const confirmRate = async () => {
    try {
      await flow.confirm();
      savedRate();
    } catch (err) {
      confirmArea.replaceChildren();
      rateStatus.textContent = err.message;
    }
  };
  const submitRate = async () => {
    clearPreview();
    if (notReady()) return;
    const pence = parsePounds(rateBox.value);
    if (pence === null) { rateStatus.textContent = BAD_AMOUNT; return; }
    if (!fromBox.value) { rateStatus.textContent = "Choose the date the rate applies from"; return; }
    try {
      const result = await flow.submit(pence, fromBox.value);
      if (result.state === "confirm") {
        rateStatus.textContent = previewText(result.preview);
        confirmArea.replaceChildren(
          el("button", { class: "btn primary", type: "button", onclick: confirmRate }, "Confirm change"),
          el("button", { class: "btn ghost", type: "button", onclick: () => { clearPreview(); rateStatus.textContent = "Not changed."; } }, "Cancel"));
        return;
      }
      savedRate();
    } catch (err) {
      rateStatus.textContent = err.message;
    }
  };
  const saveTimetable = () => {
    if (notReady()) { tableStatus.textContent = "Still loading — try again in a moment."; return; }
    const timetable = dayBoxes.map((b) => parseLessons(b.value));
    if (timetable.includes(null)) { tableStatus.textContent = BAD_LESSONS; return; }
    const result = saveLessonSettings(data(), records.settings, { timetable, trackingSince: sinceBox.value }, context());
    if (result.error) { tableStatus.textContent = result.error; return; }
    sinceBox.value = result.trackingSince || "";
    dirtyWeek = false;
    tableStatus.textContent = "";
    toast("Timetable saved");
  };
  for (const box of [rateBox, fromBox]) for (const type of ["input", "change"]) box.addEventListener(type, clearPreview);
  rateBox.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitRate(); } });

  const stopWatch = watchLive(data(), {
    onData(next) {
      if (!isAlive()) return;
      records = next;
      const lessons = buildLessons(records, today());
      if (first || !confirmArea.firstChild) showRate(lessons);
      if (lessons.rate) rateBox.placeholder = pounds(lessons.rate.pence).slice(1);
      if (first || !dirtyWeek) {
        if (lessons.timetable) lessons.timetable.forEach((n, i) => { dayBoxes[i].value = String(n); });
        sinceBox.value = lessons.tracking_since || "";
      }
      sinceBox.max = lessons.today;
      first = false;
    },
    onError() {
      if (isAlive() && !records) rateStatus.textContent = "Couldn't read your lessons settings. Check your connection and reload.";
    },
  });

  grid.append(el("section", { class: "card half static", "data-card": "lessons-settings" }, el("div", { class: "label" }, "Lessons"),
    el("p", { class: "sub" }, "The school's rate per lesson and your usual week."),
    el("div", { class: "form-grid", style: { marginTop: "12px" } }, el("label", {}, "Rate per lesson (£)", rateBox), el("label", {}, "Applies from", fromBox),
      el("button", { class: "btn", type: "button", onclick: submitRate }, "Save rate")),
    rateStatus, confirmArea,
    el("div", { class: "lz-week" }, days.map((d, i) => el("label", {}, SHORT_DAYS[d], dayBoxes[i]))),
    el("div", { class: "form-grid", style: { marginTop: "12px" } }, el("label", {}, "Tracking since", sinceBox),
      el("button", { class: "btn", type: "button", onclick: saveTimetable }, "Save timetable")),
    tableStatus));
  return stopWatch;
}
