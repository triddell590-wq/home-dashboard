// Calendar: the tab (Add, Coming up, Month, item sheet), the Overview card and the "Your day" phrase.
// Events and lesson days are read through data() (watchEvents + watchLessons) and every change redraws from the
// watch. Titles are free text, so everything is placed with textContent (el text nodes), never as markup.
// The Add box and the open item form sit outside the redrawn lists, so a change from another device never
// closes the iPhone keyboard or wipes what is being typed.
import { data } from "../core/data.js";
import { el, londonDay, toast } from "../core/dom.js";
import { go } from "../core/router.js";
import { addDays } from "../lessons/sums.js";
import { recordsFrom, watchLessons } from "../lessons/records.js";
import { parse } from "../calendar/parse.js";
import { deleteEvent, saveEvent, setDone, skipOccurrence, watchEvents } from "../calendar/events.js";
import { lessonItems, occurrences } from "../calendar/occurrences.js";
import { comingUp, dayHeading, dayPhrase, formatTime, monthCells, overdueText, shortDate, summaryLine } from "../calendar/text.js";
import { FIREBASE_CONFIG, VAPID_KEY } from "../config.js";
import { chooseBackend } from "../core/data.js";
import { STATUS_TEXT, addedText, browserEnv, onStatus, deviceId, deviceLabel, messagingFor, pushState, removeDevice, turnOn, whenActive } from "../calendar/push.js";
import { onVisible } from "../core/visible.js";
import { watchToday } from "./lessons.js";

export const tab = { id: "calendar", label: "Calendar", icon: "calendar", order: 20, mount };

const WAIT_MS = 10000;
const LESSONS_GRACE_MS = 3000;
const LOAD_FAILED = "Couldn't load your calendar. Check your connection and try again.";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HEADS = [["Mon", "M"], ["Tue", "T"], ["Wed", "W"], ["Thu", "T"], ["Fri", "F"], ["Sat", "S"], ["Sun", "S"]];
const KIND_LABELS = { appointment: "Appointment", job: "Job", deadline: "Deadline" };
const REPEATS = [["none", "Doesn't repeat"], ["day", "Every day"], ["week", "Every week"], ["month-date", "Every month on this date"],
  ["month-weekday", "Every month on this weekday"], ["year", "Every year"]];

const today = () => londonDay(new Date());
const stamp = () => new Date().toISOString();

// ------------------------------------------------------------------ pure helpers (tested in Node)

/** What the Add box understood: the parsed fields, the one-line summary, and whether Save can be pressed. */
export function previewState(text, day) {
  const fields = parse(text, day);
  return { fields, line: summaryLine(fields, day), canSave: !!fields.date && !!fields.title };
}

/** Plain-words notes for everything the parser guessed (its `unsure` list). */
export function unsureNotes(fields) {
  const notes = [];
  for (const key of fields.unsure || []) {
    if (key === "time" && fields.time) notes.push(`Is ${formatTime(fields.time)} right?`);
    else if (key === "date") notes.push("Check the date");
    else if (key === "title") notes.push("Add a title");
  }
  return notes;
}

/** Why Save is off, in plain words ("" when it is on). */
export function saveNote(fields) {
  if (!fields.date) return "Pick a date to save";
  if (!String(fields.title || "").trim()) return "Add a title to save";
  return "";
}

/** What the Overview card shows: today's items, deadlines due in the next 3 days, and overdue deadlines. */
export function cardModel(events, records, day) {
  const open = (o) => o.kind === "deadline" && !o.done;
  const todays = occurrences(events, day, day).filter((o) => !(o.kind === "deadline" && o.done));
  const soon = occurrences(events, addDays(day, 1), addDays(day, 3)).filter(open);
  const overdue = occurrences(events, addDays(day, -365), addDays(day, -1)).filter(open);
  return { today: todays, soon, overdue, empty: !todays.length && !soon.length && !overdue.length, today_date: day };
}

const repeatKey = (r) => (!r ? "none" : r.unit === "month" ? (r.monthly === "weekday" ? "month-weekday" : "month-date") : r.unit);

// ------------------------------------------------------------------ data: events and lesson days together

/**
 * Watches events and lessons and calls onData({ events, records }) on every change. If nothing arrives in time
 * onError() runs; if only the lesson days are missing the calendar still shows, with no lesson rows.
 * Returns stop().
 */
export function watchCalendar(d, { onData, onError, waitMs = WAIT_MS, graceMs = LESSONS_GRACE_MS }) {
  let events = null;
  let records = null;
  let stopped = false;
  let timer = null;
  let grace = null;
  const stops = [];
  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } if (grace !== null) { clearTimeout(grace); grace = null; } };
  const emit = () => {
    if (stopped || !events || !records) return;
    clear();
    onData({ events, records });
  };
  try {
    timer = setTimeout(() => { timer = null; if (!stopped && !events) onError(); }, waitMs);
    stops.push(watchEvents(d, (list) => {
      events = list;
      if (!records && grace === null) grace = setTimeout(() => { grace = null; if (!records) { records = recordsFrom({}); emit(); } }, graceMs);
      emit();
    }));
    stops.push(watchLessons(d, (r) => { records = r; emit(); }));
  } catch {
    clear();
    onError();
  }
  return () => { stopped = true; clear(); for (const stop of stops) if (typeof stop === "function") stop(); };
}

/** One read of the calendar data that gives up rather than waiting for ever. */
function readOnce() {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; Promise.resolve().then(() => stop()); fn(value); };
    stop = watchCalendar(data(), { onData: (v) => finish(resolve, v), onError: () => finish(reject, new Error("Timed out")) });
    if (done) stop();
  });
}

// ------------------------------------------------------------------ the shared form (preview and item sheet)

/**
 * The edit form. `fields` is changed in place as the person types; only the summary line, the notes and the Save
 * button are updated, so the form itself is never rebuilt under their fingers.
 * Returns { node, error(text) }.
 */
function buildForm({ fields, day, saveLabel = "Save", onSave, onCancel, extra = [] }) {
  fields.unsure = [...(fields.unsure || [])];
  const line = el("p", { class: "cal-line" });
  const notes = el("div", { class: "cal-unsure", role: "status" });
  const errorLine = el("p", { class: "sub cal-error", role: "alert" });
  const saveWhy = el("p", { class: "sub cal-save-note", role: "status" });
  const save = el("button", { class: "btn primary", type: "button", onclick: () => onSave(fields) }, saveLabel);

  const titleBox = el("input", { type: "text", "aria-label": "Title", maxlength: "80", autocomplete: "off", autocapitalize: "sentences", enterkeyhint: "done", value: fields.title });
  const kindBox = el("select", { "aria-label": "Kind" }, Object.entries(KIND_LABELS).map(([v, t]) => el("option", { value: v }, t)));
  const dateBox = el("input", { type: "date", "aria-label": "Date", value: fields.date || "" });
  const timeBox = el("input", { type: "time", "aria-label": "Time", value: fields.time || "09:00" });
  const allDay = el("input", { type: "checkbox", "aria-label": "All day" });
  const repeatBox = el("select", { "aria-label": "Repeat" }, REPEATS.map(([v, t]) => el("option", { value: v }, t)));
  const everyBox = el("input", { type: "number", inputmode: "numeric", min: "1", max: "52", step: "1", "aria-label": "Repeat every" });
  const untilBox = el("input", { type: "date", "aria-label": "Until", value: fields.until || "" });
  kindBox.value = fields.kind;
  allDay.checked = !fields.time;
  repeatBox.value = repeatKey(fields.repeat);
  everyBox.value = String(fields.repeat ? fields.repeat.every : 1);
  const everyRow = el("label", { class: "cal-every" }, "Every", everyBox, el("span", { class: "cal-unit" }));
  const untilRow = el("label", {}, "Until (optional)", untilBox);

  const unitWord = () => {
    const key = repeatBox.value;
    const n = Number(everyBox.value) || 1;
    return { day: "day", week: "week", "month-date": "month", "month-weekday": "month", year: "year" }[key] + (n === 1 ? "" : "s");
  };
  const touch = (key) => { fields.unsure = fields.unsure.filter((k) => k !== key); };
  const refresh = () => {
    line.textContent = summaryLine(fields, day);
    notes.replaceChildren(...unsureNotes(fields).map((n) => el("p", { class: "cal-note" }, n)));
    save.disabled = !(fields.date && fields.title.trim());
    saveWhy.textContent = saveNote(fields);
    timeBox.disabled = allDay.checked;
    const repeating = repeatBox.value !== "none";
    everyRow.hidden = !repeating;
    untilRow.hidden = !repeating;
    everyRow.querySelector(".cal-unit").textContent = unitWord();
  };
  const setRepeat = () => {
    const key = repeatBox.value;
    const n = Math.min(52, Math.max(1, Math.round(Number(everyBox.value)) || 1));
    if (key === "none") { fields.repeat = null; fields.until = null; untilBox.value = ""; return; }
    const keep = fields.repeat && fields.repeat.monthly === "weekday" ? fields.repeat.nth : null;
    const dayOfMonth = fields.date ? Number(fields.date.slice(8, 10)) : 1;
    fields.repeat = key.startsWith("month")
      ? (key === "month-weekday" ? { unit: "month", every: n, monthly: "weekday", nth: keep ?? Math.min(4, Math.ceil(dayOfMonth / 7)) } : { unit: "month", every: n, monthly: "date" })
      : { unit: key, every: n, monthly: null };
  };

  titleBox.addEventListener("input", () => { fields.title = titleBox.value; if (titleBox.value.trim()) touch("title"); refresh(); });
  titleBox.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); titleBox.blur(); } });
  kindBox.addEventListener("change", () => { fields.kind = kindBox.value; refresh(); });
  dateBox.addEventListener("input", () => { fields.date = dateBox.value || null; touch("date"); refresh(); });
  timeBox.addEventListener("input", () => { fields.time = allDay.checked ? null : (timeBox.value || null); touch("time"); refresh(); });
  allDay.addEventListener("change", () => { fields.time = allDay.checked ? null : (timeBox.value || "09:00"); touch("time"); refresh(); });
  repeatBox.addEventListener("change", () => { setRepeat(); refresh(); });
  everyBox.addEventListener("input", () => { if (fields.repeat) setRepeat(); refresh(); });
  untilBox.addEventListener("input", () => { fields.until = untilBox.value || null; refresh(); });

  const node = el("div", { class: "cal-form" }, line, notes,
    el("div", { class: "cal-fields" },
      el("label", { class: "cal-wide" }, "Title", titleBox),
      el("label", {}, "Kind", kindBox),
      el("label", {}, "Date", dateBox),
      el("div", { class: "cal-time" }, el("label", {}, "Time", timeBox), el("label", { class: "cal-check" }, allDay, "All day")),
      el("label", {}, "Repeat", repeatBox),
      everyRow, untilRow),
    errorLine, saveWhy,
    el("div", { class: "actions cal-actions" }, save, ...extra, onCancel ? el("button", { class: "btn ghost", type: "button", onclick: onCancel }, "Cancel") : null));
  refresh();
  return { node, error: (text) => { errorLine.textContent = text || ""; } };
}

// ------------------------------------------------------------------ rows

function itemRow(o, { events, onOpen, overdue = false }) {
  if (o.kind === "lessons") {
    return el("a", { class: "cal-row cal-lessons", href: o.link }, el("span", { class: "cal-time-text" }, "Lessons"), el("span", { class: "cal-title" }, o.title));
  }
  const event = events.find((e) => e.id === o.eventId);
  const parts = [];
  if (o.kind === "deadline") {
    const tick = el("input", { type: "checkbox", "aria-label": `Done: ${o.title}` });
    tick.checked = !!o.done;
    tick.addEventListener("change", () => { if (event) setDone(data(), event, o.date, tick.checked, { now: stamp(), onFail: toast }); });
    parts.push(el("label", { class: "cal-tick" }, tick));
  }
  parts.push(el("button", { class: "cal-open", type: "button", onclick: () => { if (event) onOpen(event, o.date); } },
    overdue ? el("span", { class: "cal-title" }, o.text) : [
      el("span", { class: "cal-time-text" }, o.kind === "deadline" ? "Due" : o.time ? formatTime(o.time) : "All day"),
      el("span", { class: "cal-title" }, o.title),
      o.kind === "deadline" && o.time ? el("span", { class: "sub" }, formatTime(o.time)) : null,
    ]));
  return el("div", { class: `cal-row${overdue ? " overdue" : ""}${o.done ? " done" : ""}` }, parts);
}

// ------------------------------------------------------------------ tab

function mount(container) {
  container.append(el("h1", { class: "page-title" }, "Calendar"));
  const grid = el("div", { class: "grid cal-grid-page" });
  container.append(grid);
  let alive = true;
  let model = null;                  // { events, records } from the watch
  let monthStr = today().slice(0, 7);
  let pickedDay = null;
  let last = null;                   // fingerprint of what is drawn
  let openRef = null;                // { id, date } of the item in the sheet

  // ---- Add
  const box = el("input", { type: "text", class: "cal-box", placeholder: "e.g. dentist tuesday 2pm", "aria-label": "New calendar item",
    autocomplete: "off", autocapitalize: "sentences", enterkeyhint: "done" });
  const preview = el("div", { class: "cal-preview" });
  const addCard = el("section", { class: "card wide static cal-add" }, el("div", { class: "label" }, "Add"), box, preview);
  const clearAdd = () => { box.value = ""; preview.replaceChildren(); };
  const showPreview = () => {
    const text = box.value.trim();
    if (!text) { preview.replaceChildren(); return; }
    const state = previewState(text, today());
    const form = buildForm({
      fields: { ...state.fields }, day: today(),
      onSave(fields) {
        const result = saveEvent(data(), fields, { now: stamp(), onFail: toast });
        if (result.error) { form.error(result.error); return; }
        clearAdd();
        toast("Saved");
      },
      onCancel: clearAdd,
    });
    preview.replaceChildren(form.node);
  };
  box.addEventListener("input", showPreview);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); box.blur(); } });

  // ---- item sheet (own container: a change from another device never rebuilds it under the person)
  const sheet = el("section", { class: "card wide static cal-sheet", hidden: true });
  const closeSheet = () => { openRef = null; sheet.hidden = true; sheet.replaceChildren(); };
  function openSheet(event, date) {
    openRef = { id: event.id, date };
    const form = buildForm({
      fields: { title: event.title, kind: event.kind, date: event.date, time: event.time, repeat: event.repeat, until: event.until, unsure: [] },
      day: today(), saveLabel: "Save",
      onSave(fields) {
        const result = saveEvent(data(), fields, { current: event, id: event.id, now: stamp(), onFail: toast });
        if (result.error) { form.error(result.error); return; }
        closeSheet();
        toast("Saved");
      },
      onCancel: closeSheet,
      extra: [
        event.repeat ? el("button", { class: "btn ghost", type: "button", onclick: () => { skipOccurrence(data(), event, date, { now: stamp(), onFail: toast }); closeSheet(); } }, "Skip this one") : null,
        el("button", { class: "btn danger", type: "button", onclick: () => askDelete(event, date, deleteArea) }, "Delete"),
      ],
    });
    const deleteArea = el("div", { class: "actions cal-actions" });
    sheet.replaceChildren(el("div", { class: "label" }, "Edit"), form.node, deleteArea);
    sheet.hidden = false;
    sheet.scrollIntoView?.({ block: "nearest" });
  }
  const confirmText = (event) => `Delete ${event.title}? This can't be undone.`;
  const removeAll = (event) => {
    if (!window.confirm(confirmText(event))) return;
    deleteEvent(data(), event, { onFail: toast });
    closeSheet();
  };
  function askDelete(event, date, area) {
    if (!event.repeat) { removeAll(event); return; }
    area.replaceChildren(
      el("button", { class: "btn ghost", type: "button", onclick: () => { skipOccurrence(data(), event, date, { now: stamp(), onFail: toast }); closeSheet(); } }, "Just this one"),
      el("button", { class: "btn danger", type: "button", onclick: () => removeAll(event) }, "All"));
  }

  // ---- Coming up and Month (redrawn from the watch)
  const dataBody = el("div", { class: "grid cal-data" }, el("p", { class: "sub", role: "status" }, "Loading…"));

  function comingSection(day) {
    const { overdue, groups } = comingUp(model.events, model.records, day);
    const rows = [];
    for (const o of overdue) rows.push(itemRow(o, { events: model.events, onOpen: openSheet, overdue: true }));
    for (const g of groups) {
      rows.push(el("h3", { class: "cal-day" }, g.heading));
      for (const o of g.items) rows.push(itemRow(o, { events: model.events, onOpen: openSheet }));
    }
    return el("section", { class: "card half static cal-section", "data-section": "coming-up" }, el("div", { class: "label" }, "Coming up"),
      rows.length ? el("div", { class: "cal-list" }, rows) : el("p", { class: "sub" }, "Nothing coming up"));
  }

  function monthSection(day) {
    const [y, m] = monthStr.split("-").map(Number);
    const weeks = monthCells(monthStr);
    const flat = weeks.flat().filter(Boolean);
    const occs = occurrences(model.events, flat[0], flat[flat.length - 1]);
    const dotted = new Set(occs.map((o) => o.date));
    const shift = (delta) => { const t = y * 12 + (m - 1) + delta; monthStr = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; pickedDay = null; draw(true); };
    const head = el("div", { class: "cal-month-head" },
      el("button", { class: "btn ghost", type: "button", "aria-label": "Previous month", onclick: () => shift(-1) }, "‹"),
      el("strong", {}, `${MONTH_NAMES[m - 1]} ${y}`),
      el("button", { class: "btn ghost", type: "button", "aria-label": "Next month", onclick: () => shift(1) }, "›"));
    const cells = [
      ...DAY_HEADS.map(([long, short]) => el("div", { class: "cal-dow", "aria-hidden": "true" }, el("span", { class: "long" }, long), el("span", { class: "short" }, short))),
      ...weeks.flat().map((d) => (d === null ? el("div", { class: "cal-cell empty" }) : el("button", {
        class: `cal-cell${d === day ? " today" : ""}${d === pickedDay ? " picked" : ""}`, type: "button", "aria-pressed": String(d === pickedDay),
        "aria-label": `${shortDate(d)}${dotted.has(d) ? ", has items" : ""}`,
        onclick: () => { pickedDay = d === pickedDay ? null : d; draw(true); },
      }, el("span", {}, Number(d.slice(8))), dotted.has(d) ? el("i", { class: "cal-dot" }) : null))),
    ];
    let list = null;
    if (pickedDay && pickedDay.startsWith(monthStr)) {
      const items = [...occs.filter((o) => o.date === pickedDay), ...lessonItems(model.records, pickedDay, pickedDay, day)];
      list = el("div", { class: "cal-picked" }, el("h3", { class: "cal-day" }, dayHeading(pickedDay, day)),
        items.length ? el("div", { class: "cal-list" }, items.map((o) => itemRow(o, { events: model.events, onOpen: openSheet }))) : el("p", { class: "sub" }, "Nothing on this day"));
    }
    return el("section", { class: "card half static cal-section", "data-section": "month" }, el("div", { class: "label" }, "Month"), head,
      el("div", { class: "cal-grid" }, cells), list);
  }

  function paint(day) {
    dataBody.replaceChildren(comingSection(day), monthSection(day));
    // the item being edited was deleted or moved on elsewhere: close it rather than edit a ghost
    if (openRef && !model.events.some((e) => e.id === openRef.id)) closeSheet();
  }

  /** Redraws only when what is shown changed (a metadata-only report, or the same data again, draws nothing). */
  function draw(force = false) {
    if (!alive || !model) return;
    const day = today();
    const print = JSON.stringify([day, model, monthStr, pickedDay]);
    if (!force && print === last) return;
    last = print;
    paint(day);
  }

  const errorView = () => {
    dataBody.replaceChildren(el("section", { class: "card wide static card-error", role: "alert" },
      el("p", { class: "sub" }, LOAD_FAILED), el("button", { class: "btn ghost small", type: "button", onclick: start }, "Retry")));
  };
  let stopWatch = () => {};
  function start() {
    stopWatch();
    model = null;
    last = null;
    dataBody.replaceChildren(el("p", { class: "sub", role: "status" }, "Loading…"));
    stopWatch = watchCalendar(data(), {
      onData(next) { if (!alive) return; model = next; draw(); },
      onError() { if (alive && !model) errorView(); },
    });
  }

  grid.append(addCard, sheet, dataBody);
  start();
  const stopToday = watchToday({ onTick: () => draw() });
  return () => { alive = false; stopWatch(); stopToday(); };
}

// ------------------------------------------------------------------ Overview card and "Your day"

function renderCard(m, body) {
  const card = body.closest(".card");
  if (card) {
    card.classList.add("calendar-card");
    card.classList.toggle("level-amber", m.overdue.length > 0);
  }
  const line = (o) => el("li", {}, o.time ? el("span", { class: "cal-time-text" }, formatTime(o.time)) : null,
    el("span", { class: "cal-title" }, o.kind === "deadline" ? `Due: ${o.title}` : o.title));
  body.replaceChildren(el("div", { class: "cal-card", role: "link", tabindex: "0", onclick: () => go("calendar"),
    onkeydown: (e) => { if (e.key === "Enter") go("calendar"); } },
    el("div", { class: "label" }, el("span", {}, "Calendar"), el("span", {}, shortDate(m.today_date))),
    m.overdue.length ? el("ul", { class: "cal-card-list overdue" }, m.overdue.map((o) => el("li", {}, el("span", { class: "cal-title" }, overdueText(o.title, o.date, m.today_date))))) : null,
    m.today.length ? el("ul", { class: "cal-card-list" }, m.today.map(line)) : el("p", { class: "sub" }, "Nothing on today"),
    m.soon.length ? el("div", { class: "label cal-soon" }, el("span", {}, "Due soon")) : null,
    m.soon.length ? el("ul", { class: "cal-card-list" }, m.soon.map((o) => el("li", {}, el("span", { class: "cal-time-text" }, dayHeading(o.date, m.today_date)), el("span", { class: "cal-title" }, o.title)))) : null));
}

export function registerCalendar({ registerCard, registerDayPart, registerSettingsCard }) {
  let latest = null;       // the newest data the card's watch has seen
  let failed = false;
  let shown = null;        // fingerprint of what the card last drew
  registerCard({ id: "calendar", order: 20, size: "small", title: "Calendar",
    async load() {
      if (latest) return cardModel(latest.events, latest.records, today());
      if (failed) { failed = false; throw new Error("The calendar watch failed"); }
      const read = await readOnce();
      return cardModel(read.events, read.records, today());
    },
    empty: (m) => (m && m.empty ? "Nothing on today" : null),
    render: renderCard,
    watch(refresh) {
      const stop = watchCalendar(data(), {
        onData(next) {
          const print = JSON.stringify(next);
          failed = false;
          latest = next;
          if (print !== shown) { shown = print; refresh(); }
        },
        onError() { if (!latest) { failed = true; refresh(); } },
      });
      const stopVisible = onVisible(refresh);     // an app left open overnight moves on to the new day
      return () => { stop(); stopVisible(); latest = null; failed = false; shown = null; };
    } });
  registerDayPart({ id: "calendar", order: 10, async load(now = new Date()) {
    try {
      const day = londonDay(now);
      const { events } = latest ? latest : await readOnce();
      return dayPhrase(occurrences(events, addDays(day, -365), day), day);
    } catch {
      return null;
    }
  } });
  if (registerSettingsCard) registerSettingsCard({ id: "reminders", order: 40, mount: mountRemindersCard });
}

// ------------------------------------------------------------------ Settings card: Reminders on this device

const DEVICES_FAILED = "Couldn't load your devices. Check your connection and try again.";

/** The Firebase messaging object for this page, or null (memory backend, no key, unsupported browser). */
const pageMessaging = () => messagingFor({ firebase: globalThis.firebase, mode: chooseBackend(location.search, FIREBASE_CONFIG), vapidKey: VAPID_KEY });

export function mountRemindersCard(grid, isAlive = () => true) {
  const thisId = deviceId();
  const statusLine = el("p", { class: "sub", role: "status" }, "Loading…");
  const actionBox = el("div", { class: "actions" });
  const list = el("ul", { class: "cal-devices" });
  let devices = null;           // null until the first read
  let failed = false;
  let message = "";             // an error from the last tap
  let busy = false;
  const mode = chooseBackend(location.search, FIREBASE_CONFIG);
  const vapidKey = mode === "firebase" ? VAPID_KEY : "";   // the memory backend never offers reminders
  let prep;                     // undefined while checking; null when this browser can't; else { messaging, registration }

  const prepare = async () => {
    try {
      const messaging = await pageMessaging();
      const registration = messaging && navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
      prep = messaging && registration ? { messaging, registration } : null;
    } catch { prep = null; }
    if (isAlive()) draw();
  };

  const draw = () => {
    if (!isAlive()) return;
    const mine = devices && devices.some((x) => x.id === thisId);
    const state = pushState({ vapidKey, ...browserEnv() });
    actionBox.replaceChildren();
    if (failed) statusLine.textContent = DEVICES_FAILED;
    else if (devices === null) statusLine.textContent = "Loading…";
    else if (message) statusLine.textContent = message;
    else if (mine) statusLine.textContent = onStatus(browserEnv().permission);
    else if (state !== "ready") statusLine.textContent = STATUS_TEXT[state];
    else if (prep === undefined) statusLine.textContent = "Checking this browser…";
    else if (prep === null) statusLine.textContent = STATUS_TEXT.unsupported;
    else {
      statusLine.textContent = "Get a morning reminder at 7am on days with something on.";
      const button = el("button", { class: "btn primary", type: "button", onclick: tap }, "Turn on reminders on this device");
      button.disabled = busy;
      actionBox.append(button);
    }
    list.replaceChildren(...(devices || []).map((x) => el("li", { class: "cal-device" },
      el("span", { class: "cal-title" }, x.id === thisId ? `${x.label} (this device)` : x.label),
      el("span", { class: "sub" }, addedText(x.addedAt)),
      el("button", { class: "btn ghost", type: "button", "aria-label": `Remove ${x.label}`, onclick: () => remove(x.id) }, "Remove"))));
    if (devices && !devices.length && !failed) list.append(el("li", { class: "sub" }, "No devices yet"));
  };

  // Called straight from the click: the permission prompt needs the tap that started it. Everything else it needs
  // (messaging, the service-worker registration) was checked before the button was shown.
  function tap() {
    if (busy || !prep) return;
    busy = true;
    message = "";
    let permissionPromise;
    try { permissionPromise = Promise.resolve(Notification.requestPermission()); }   // in the tap, never on load
    catch { permissionPromise = Promise.resolve("denied"); }
    draw();
    const { messaging, registration } = prep;
    (async () => {
      try {
        const r = await turnOn({ d: data(), messaging, registration, ready: () => whenActive(navigator.serviceWorker), vapidKey, id: thisId, label: deviceLabel(browserEnv().ua), now: stamp(), onFail: toast,
          requestPermission: () => permissionPromise });
        if (r.error) message = r.error;
        else toast("Reminders turned on");
      } catch (err) {
        console.warn("turn on reminders:", err);
        message = "Couldn't turn on reminders — try again";
      } finally {
        busy = false;
        draw();
      }
    })();
  }

  async function remove(id) {
    removeDevice(data(), id, { thisId, messaging: id === thisId ? await pageMessaging() : null, onFail: toast });
  }

  grid.append(el("section", { class: "card half static", "data-card": "reminders" }, el("div", { class: "label" }, "Reminders"),
    el("p", { class: "sub" }, "One notification at 7am (London) on days with something on."),
    statusLine, actionBox, list));
  draw();
  if (pushState({ vapidKey, ...browserEnv() }) === "ready") prepare(); else prep = null;

  let timer = setTimeout(() => { timer = null; if (isAlive() && devices === null) { failed = true; draw(); } }, WAIT_MS);
  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  let stopWatch = () => {};
  try {
    stopWatch = data().watch("devices", (docs) => {
      if (!isAlive()) return;
      clear();
      failed = false;
      devices = (Array.isArray(docs) ? docs : []).filter((x) => x && typeof x.label === "string").sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
      draw();
    });
  } catch {
    clear();
    failed = true;
    draw();
  }
  return () => { clear(); if (typeof stopWatch === "function") stopWatch(); };
}
