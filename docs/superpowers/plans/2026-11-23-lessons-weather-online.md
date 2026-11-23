# Lessons and Weather Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Mac dashboard's finished Lessons and Weather pieces into the online dashboard as synced tabs, cards, "Your day" phrases and Settings cards, with Met Office warnings written by a GitHub job, then point the Mac tabs at the online ones.

**Architecture:** Pure ports of the Mac's Python sums and checks (`js/lessons/*`, `js/weather/*`) sit under thin views that read and write only through `data()` and redraw from `watch`. The forecast is fetched by the browser from Open-Meteo and cached per device in `home-weather-forecast`; warnings come from `weather/warnings`, written hourly by `tools/warnings.mjs` (Firebase Admin SDK, tools only). Two small shell hooks are added: Settings cards in the registry, and an optional `watch` on Overview cards.

**Tech Stack:** Plain ES modules, no build step; Firestore compat SDK (already vendored); the repo's own test harness (`js/tests/harness.js`); Node 20; `firebase-admin` (devDependency, tools only); GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-23-lessons-weather-online-design.md`. It binds the Mac designs `ml-trading-strategy/docs/superpowers/specs/2026-11-22-lessons-design.md` and `2026-11-21-weather-design.md`, and the Mac code is the reference for every figure and every word.

## Global Constraints

- £0; plain ES modules with no build step; iOS Safari and desktop browsers; reduced motion respected; test-first.
- Dates are London dates (`Europe/London`) whatever the device's zone; "today" is the London date.
- Money is integer pence everywhere, in Firestore and in the sums.
- Storage keys only under `home-` via `js/core/store.js` (the origin is shared with another app; never read, move or remove any other key). The forecast copy is `home-weather-forecast` (`store.get/set("weather-forecast", …)`).
- Firestore layout exactly as spec §2, under `users/{uid}/`: `lessonDays/{YYYY-MM-DD}` `{lessons, note, confirmedAt}`; `lessonPayments/{id}` `{received, pence, month, note, addedAt}` (id from `crypto.randomUUID()`); `lessonRates/{YYYY-MM-DD}` `{pence}`; `settings/lessons` `{timetable, trackingSince}`; `settings/weather` `{place: {name, county, nation, lat, lon, region}}`; `weather/warnings` `{region, fetchedAt, ok, items}` (written by the job only). The forecast is never stored in Firestore.
- Every write goes through `data()`; views redraw from `data().watch`. Checks run before any write.
- A write is reported as done as soon as it is issued (Firestore resolves only when the server answers; offline it never does) — follow `saveName` in `js/views/settings.js`. Only a rejected write shows an error.
- Free text (notes, place names, warning titles) is placed with `textContent` only. No `innerHTML` except the SVG icon tables.
- Tests never go online: fetch is injected everywhere; fixtures live in `js/tests/fixtures/weather/` (copied from `ml-trading-strategy/tests/fixtures/weather/`).
- Every new file under `js/`, `css/` or `icons/` is added to `FILES` in `sw.js` (`js/tests/sw.test.js` fails otherwise).
- Phone: sections stack in one column, number boxes use `inputmode="numeric"`, tap targets ≥ 44 px, field text ≥ 16 px (the browser check enforces the last two).
- Ported tests keep the Python test's name: each JS test name starts with the Python function name (for example `test("test_status_edges", …)`), and its inputs and expected values are the Python ones, converted only as below.

**Python → JS conversions for every ported test:** `date(2026, 11, 22)` → `"2026-11-22"`; months stay `"YYYY-MM"`; `None` → `null`; dicts keep their snake_case keys (`missing_rate`, `changed_days`, `owed_total`, …) so the ported wording module works unchanged; `datetime(2026, 11, 23, 8, 0, tzinfo=LONDON)` → `new Date("2026-11-23T08:00:00Z")` (GMT in November); an HTTP 400 `{"error": msg}` → the check returns `msg`; `pytest.mark.parametrize` → a loop over the same cases inside one test.

## Review Focus

1. **Another device edits while a tab is open** — a day saved on the phone appears on the open Mac Lessons tab without a reload, and an entry form the Mac user has open stays open. Pinned in Task 2 (`watchLessons fires again when another writer saves a day`).
2. **London midnight and summer time** — at 23:30 UTC on 30 June it is already 1 July in London; "today", "to confirm" and the hourly strip must use the London date and hour. Pinned in Task 1 (`londonDay and londonHourStart follow London summer time`).
3. **Saving with no signal** — a Firestore write that never resolves must not leave the page waiting; "Saved" shows at once. Pinned in Task 2 (`saveDay reports saved without waiting for the server`).
4. **A broken forecast copy** — blocked storage, garbage JSON, or a copy in an older shape is treated as no copy and the forecast is fetched. Pinned in Task 5 (`a broken or foreign forecast copy counts as none`).
5. **Odd documents in Firestore** — a hand-edited or half-synced doc (id not a real date, `lessons` a string, `pence` missing) is skipped, never summed as NaN. Pinned in Task 2 (`recordsFrom skips documents that are not valid records`).

---

### Task 1: Lessons sums and London dates

**Files:**
- Create: `js/lessons/sums.js`
- Modify: `js/core/dom.js` (add two exports beside `localDate`)
- Modify: `sw.js` (FILES), `js/tests/run-node.mjs`, `tests.html`
- Test: `js/tests/lessons-sums.test.js`

**Interfaces:**
- Produces (all pure; dates `"YYYY-MM-DD"`, months `"YYYY-MM"`, money pence):
  - `londonDay(date: Date) -> "YYYY-MM-DD"` and `londonHourStart(date: Date) -> "YYYY-MM-DDTHH:00"` in `js/core/dom.js`
  - Records shape used by every lessons module: `{ days: { [date]: { lessons, note } }, payments: [{ id, received, pence, month, note, addedAt }], rates: { [date]: pence }, settings: { timetable, trackingSince } | null }`
  - In `js/lessons/sums.js`: `LATE_AFTER_DAYS = 14`, `rateOn(rates, day) -> pence|null`, `dayAmount(lessons, rate) -> pence|null`, `monthSummary(month, days, payments, rates, today) -> {month, lessons, earned, paid, owed, status, missing_rate, days: [{date, lessons, rate, amount, note}]}`, `allMonths(days, payments, rates, today) -> summary[]` (newest first), `owedTotal(months) -> pence`, `taxYearOf(day) -> year`, `taxYearSummary(year, days, payments, rates) -> {year, start, end, lessons, earned, paid, received, missing_rate, unrated_days, unrated_lessons}`, `toConfirm(timetable, trackingSince, days, today) -> [{date, usual}]`, `defaultPaymentMonth(months, today) -> "YYYY-MM"`, `rateChangePreview(rates, newPence, effectiveFrom, days) -> {changed_days, old_total, new_total, old_unknown_days}`, `addDays(day, n) -> "YYYY-MM-DD"`, `weekdayIndex(day) -> 0..6` (Monday 0).

- [ ] **Step 1: Write the failing tests** in `js/tests/lessons-sums.test.js`, porting every test in `ml-trading-strategy/tests/test_lessons_sums.py` case for case (same inputs, same expected values, conversions as in Global Constraints): `test_rate_on_picks_latest_effective`, `test_day_amount`, `test_month_with_mid_month_rate_change`, `test_missing_rate_is_unknown_not_zero`, `test_zero_lesson_day_without_rate_is_not_missing`, `test_status_edges`, `test_payment_for_month_with_nothing_earned`, `test_all_months_newest_first_and_gap_months`, `test_tax_year_edges`, `test_to_confirm`, `test_default_payment_month`, `test_rate_change_preview`, `test_unrated_month_is_owed_never_paid_never_late_on_unknown`, `test_tax_year_earned_with_rate_in_force`, `test_tax_year_summary_reports_unrated_days`, `test_tax_year_received_is_by_received_date`, `test_owed_total_counts_unrated_month_as_at_least_zero`, `test_unrated_month_late_only_when_known_owed_positive`, `test_preview_counts_days_with_unknown_old_amount`. Example of the conversion:

```js
test("test_status_edges", () => {
  const days = { "2026-10-05": { lessons: 5, note: "" } };            // 9000 earned at RATES
  let m = monthSummary("2026-10", days, [pay(9000, "2026-10")], RATES, TODAY);
  eq([m.status, m.owed], ["paid", 0]);
  // … every remaining assertion of the Python test, same values
});
```

Add the London-date tests:

```js
test("londonDay and londonHourStart follow London summer time", () => {
  eq(londonDay(new Date("2026-06-30T23:30:00Z")), "2026-07-01");
  eq(londonDay(new Date("2026-11-24T23:30:00Z")), "2026-11-24");
  eq(londonDay(new Date("2026-11-25T01:30:00Z")), "2026-11-25");   // 20:30 New York on the 24th
  eq(londonHourStart(new Date("2026-06-30T23:30:00Z")), "2026-07-01T00:00");
  eq(londonHourStart(new Date("2026-11-21T18:30:00Z")), "2026-11-21T18:00");
});
test("weekdayIndex is Monday-first and addDays crosses month ends", () => {
  eq(weekdayIndex("2026-11-23"), 0); eq(weekdayIndex("2026-11-22"), 6);
  eq(addDays("2026-11-30", 1), "2026-12-01"); eq(addDays("2027-01-01", -1), "2026-12-31");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — the import of `../lessons/sums.js` fails (module not found).

- [ ] **Step 3: Implement** `londonDay`/`londonHourStart` with an `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23", year, month, day, hour })` like the existing `LONDON` formatter, and `js/lessons/sums.js` as a line-for-line port of `ml-trading-strategy/mltrader/lessons.py` (same branch order in `monthSummary`'s status; dates compared as strings; day arithmetic through `Date.UTC`, never local time). Add `./js/lessons/sums.js` to `FILES`; import the test file in `run-node.mjs` and `tests.html`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, `N of N passed` with no FAIL lines.

- [ ] **Step 5: Commit**

```bash
git add js/lessons/sums.js js/core/dom.js js/tests/lessons-sums.test.js js/tests/run-node.mjs tests.html sw.js
git commit -m "feat: lessons sums ported from the Mac, with London dates"
```

---

### Task 2: Lessons checks, records, writes and CSV

**Files:**
- Create: `js/lessons/checks.js`, `js/lessons/records.js`, `js/lessons/actions.js`, `js/lessons/csv.js`
- Modify: `sw.js`, `js/tests/run-node.mjs`, `tests.html`
- Test: `js/tests/lessons-data.test.js`

**Interfaces:**
- Consumes: Task 1's sums, `londonDay`, records shape; `createMemoryData()` for tests.
- Produces:
  - `js/lessons/checks.js`: message constants `MSG_LESSONS = "Lessons must be a whole number from 0 to 30"`, `MSG_FUTURE = "That date is in the future"`, `MSG_DATE = "That is not a date"`, `MSG_PAYMENT = "A payment must be between £0.01 and £10,000"`, `MSG_MONTH = "That month hasn't started yet"`, `MSG_RATE = "A rate must be between £0.01 and £1,000"`, `MSG_TIMETABLE = "The timetable needs seven numbers from 0 to 30"`, `MSG_CONFIRM = "This changes days already recorded"`; `isRealDate(text) -> bool`; `checkDay(date, lessons, today) -> msg|null`; `checkPayment({received, pence, month}, today) -> msg|null`; `checkRate({pence, effectiveFrom}) -> msg|null`; `checkLessonSettings({timetable, trackingSince}, today) -> msg|null`. Each check tests in the Python order (day: date, then future, then count; payment: pence, received, month form, month started; rate: pence, then date — a future rate date is allowed; settings: timetable, then date). Whole numbers only: `Number.isInteger(v) && typeof v === "number"` (so `true`, `"3"` and `2.5` fail).
  - `js/lessons/records.js`: `recordsFrom({ dayDocs, paymentDocs, rateDocs, settingsDoc }) -> records` (docs as `data().list` returns them, `{id, ...fields}`); `readLessons(d) -> Promise<records>`; `watchLessons(d, cb) -> stop` (watches `lessonDays`, `lessonPayments`, `lessonRates`, `settings/lessons`; calls `cb(records)` once all four have reported, then on every change); `buildLessons(records, today) -> overview` with exactly the keys of the Mac's `GET /api/lessons`: `today, this_month, months, owed_total, owed_incomplete, tax_year, to_confirm, expected_today, rate ({pence, effective_from}|null), timetable, tracking_since, rate_default_from, default_payment_month, payments` (newest first by `received`, then `addedAt`).
  - `js/lessons/actions.js` — each returns `{ ok: true }` or `{ error: msg }` (and `{ error, preview }` for an unconfirmed rate), without awaiting the server; a rejected write calls `onFail("Couldn't save — try again")`: `saveDay(d, date, lessons, note, { today, now, onFail })`, `removeDay(d, date, { onFail })`, `addPayment(d, { received, pence, month, note }, { today, now, onFail, id })` (`id` defaults to `crypto.randomUUID()`), `removePayment(d, id, { onFail })`, `previewRate(records, { pence, effectiveFrom }) -> preview|{error}`, `saveRate(d, records, { pence, effectiveFrom, confirm }, { onFail })`, `saveLessonSettings(d, current, { timetable, trackingSince }, { today, onFail }) -> { ok, timetable, trackingSince } | { error }` (first timetable save with no date sets `trackingSince` to `today`; a later save without a date keeps the stored one).
  - `js/lessons/csv.js`: `monthCsv(records, month, today) -> { name: "lessons-YYYY-MM.csv", text }`, `taxYearCsv(records, year) -> { name: "lessons-tax-year-YYYY.csv", text }` — rows, columns, order and totals exactly as `export()` in `ml-trading-strategy/mltrader/web/lessons_api.py`; fields written like Python's `csv.writer` (quote a field only if it holds `,` `"` `\r` or `\n`, doubling `"`; lines end `\r\n`); notes starting `= + - @ \t \r` get a leading `'`; pounds as `(pence / 100).toFixed(2)`, blank for null; payments ordered by `received`, then `addedAt`.

- [ ] **Step 1: Write the failing tests** in `js/tests/lessons-data.test.js`. Port `ml-trading-strategy/tests/test_lessons_api.py` with TODAY `"2026-11-22"` and the same calls, replacing each HTTP call by the matching action on a fresh `createMemoryData()` and each `GET /api/lessons` by `buildLessons(await readLessons(d), today)`:
  `test_empty_state`, `test_today_is_london_date` (today = `londonDay(new Date("2026-11-25T01:30:00Z"))`), `test_save_day_and_month_totals`, `test_day_checks` (all 7 cases, on `checkDay`, and nothing written), `test_delete_day` (after `removeDay` the months list is `[]`; a second remove returns `{ ok: true }`), `test_payment_flow`, `test_payment_checks` (all 7), `test_rate_change_needs_confirm` (the unconfirmed save returns `{ error: "This changes days already recorded", preview: {changed_days: 1, old_total: 10800, new_total: 12000, old_unknown_days: 0} }` and writes nothing), `test_rate_checks`, `test_rate_preview_endpoint` (on `previewRate`; nothing written), `test_settings_and_to_confirm`, `test_expected_today_zero_is_none`, `test_settings_checks` (all 7), `test_csv_month_and_tax_year`, `test_csv_unrated_day_is_blank`, `test_to_confirm_uses_london_date` (today `"2026-11-25"`), `test_csv_notes_are_not_formulas` (all 6 notes), `test_csv_plain_note_unchanged`, `test_payments_listed_newest_first` (ids `"a"`, `"b"`, `"c"`, `addedAt` in that order; expected order c, b, a; each listed payment has exactly `{id, received, month, pence, note}`), `test_reviewer_scenario_backfilled_days_before_rate`, `test_owed_incomplete_false_when_every_day_has_a_rate`, `test_tax_year_received_and_paid_for_months`, `test_rate_default_from`, `test_future_rate_date_is_accepted`, `test_preview_reports_days_with_no_old_rate`, `test_csv_unrated_days_row_and_blank_total`, `test_tax_year_csv_has_payment_rows_and_both_payment_totals`. CSV tests parse `text` with a small quote-aware `rows(text)` helper in the test file and use the Python's `in table` assertions. Not ported (no URL input in the browser): `test_csv_params`, `test_tax_year_non_ascii_digits_are_a_400`; `test_mobile_table_rule_is_scoped_to_lessons_cards` is ported in Task 3.

  Plus these new tests:

```js
test("written documents have the spec's shape", async () => {
  // after saveDay("2026-11-18", 6, "cover"), addPayment(…, id "p1"), saveRate(1800 from "2026-01-01"), saveLessonSettings
  eq(await mem.get("lessonDays/2026-11-18"), { lessons: 6, note: "cover", confirmedAt: NOW });
  eq(await mem.get("lessonPayments/p1"), { received: "2026-11-20", pence: 9000, month: "2026-11", note: "bacs", addedAt: NOW });
  eq(await mem.get("lessonRates/2026-01-01"), { pence: 1800 });
  eq(await mem.get("settings/lessons"), { timetable: [0, 6, 0, 4, 0, 0, 0], trackingSince: "2026-11-09" });
});
test("saveDay reports saved without waiting for the server", () => {
  const d = { ...createMemoryData(), set: () => new Promise(() => {}) };
  eq(saveDay(d, "2026-11-18", 6, "", { today: TODAY, now: NOW, onFail() {} }), { ok: true });   // synchronous return
});
test("a rejected write is reported plainly", async () => { /* set rejects → onFail called with "Couldn't save — try again" */ });
test("recordsFrom skips documents that are not valid records", () => {
  const r = recordsFrom({ dayDocs: [{ id: "2026-02-30", lessons: 3 }, { id: "2026-11-18", lessons: "6" }, { id: "2026-11-19", lessons: 4 }],
    paymentDocs: [{ id: "x", received: "2026-11-20", month: "2026-11" }], rateDocs: [{ id: "nope", pence: 1800 }], settingsDoc: null });
  eq(r, { days: { "2026-11-19": { lessons: 4, note: "" } }, payments: [], rates: {}, settings: null });
});
test("watchLessons fires again when another writer saves a day", async () => {
  // watchLessons(scoped memory data, cb); then a second handle on the same backend sets lessonDays/2026-11-18;
  // after a microtask the last records seen include "2026-11-18"; stop() ends the four watches (no further calls)
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `../lessons/checks.js` (and the others) not found.

- [ ] **Step 3: Implement** the four modules with the signatures above. `buildLessons` ports the body of `overview()` in `lessons_api.py` (`expected_today` only when the timetable exists, today has no row and today's usual count > 0; `rate_default_from` = earliest unrated recorded day, else `trackingSince`, else today). `saveRate` writes when `changed_days === 0` or `confirm === true`. Add the four files to `FILES` and the test to both runners.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, no FAIL lines.

- [ ] **Step 5: Commit**

```bash
git add js/lessons js/tests/lessons-data.test.js js/tests/run-node.mjs tests.html sw.js
git commit -m "feat: lessons checks, Firestore records, writes and CSV"
```

---

### Task 3: Lessons page, card, "Your day" and Settings card

**Files:**
- Create: `js/lessons/text.js` (port of `mltrader/web/static/js/views/lessons-text.js`), `js/views/lessons.js`
- Modify: `js/core/registry.js` (Settings cards), `js/views/settings.js` (mount them), `js/views/overview.js` (card `watch`), `js/main.js` (register; `lessons` icon), `css/views.css` (phone rules), `sw.js`, `js/tests/run-node.mjs`, `tests.html`
- Test: `js/tests/lessons-text.test.js`, `js/tests/registry.test.js`, `js/tests/views.test.js`

**Interfaces:**
- Consumes: Tasks 1–2. `js/lessons/text.js` imports `dayName` from `../weather/text.js`, which Task 6 creates — so in this task create `js/weather/text.js` as the straight port of the Mac's `weather-text.js` (Task 6 adds its tests).
- Produces:
  - Registry: `registerSettingsCard({ id, order, mount(grid, isAlive) -> stop? })` and `settingsCards()`; `js/views/settings.js` mounts each after its "You" card, in order, and calls each `stop` on unmount.
  - Overview card spec may have `watch(refresh) -> stop`; `js/views/overview.js` exports `watchCards(specs, refreshers) -> stop` (calls `spec.watch(refreshers[i])` where present; the stop ends them all) and uses it in `mount`.
  - `js/lessons/text.js`: everything the Mac module exports, unchanged, except `createRateFlow({ preview(pence, effectiveFrom) -> Promise<preview>, save({ pence, effective_from, confirm }) -> Promise })`.
  - `js/views/lessons.js`: `tab = { id: "lessons", label: "Lessons", icon: "lessons", order: 75, mount }`, `registerLessons({ registerCard, registerDayPart, registerSettingsCard })` — card `{ id: "lessons", order: 60, size: "small", title: "Lessons", load, empty, render, watch }`, day part `{ id: "lessons", order: 40 }`, Settings card `{ id: "lessons", order: 30 }`; `downloadCsv({ name, text })`.

- [ ] **Step 1: Write the failing tests.** `js/tests/lessons-text.test.js`: port every test of `mltrader/web/static/js/tests/lessons.test.js` by name and values; the three rate-flow tests use fakes `preview` (returns `{changed_days: n, old_total: 1000, new_total: 2000}`) and `save` (records bodies), with the same expected bodies (`{ pence: 1800, effective_from: "2026-11-01", confirm: true }` etc.). In `registry.test.js`:

```js
test("settings cards come back in order", () => {
  const r = createRegistry();
  r.registerSettingsCard({ id: "weather", order: 20 }); r.registerSettingsCard({ id: "lessons", order: 30 });
  eq(r.settingsCards().map((c) => c.id), ["weather", "lessons"]);
});
```

In `views.test.js`:

```js
test("watchCards watches only cards that ask, and stops them all", () => { /* two specs, one with watch; its callback triggers refreshers[i]; stop() calls the returned stop once */ });
test("test_mobile_table_rule_is_scoped_to_lessons_cards", async () => {
  // css/views.css has ".card.lz-section .table" and no ".card .table {"; js/views/lessons.js has no 'class: "card wide static'
});
test("the Lessons view places text only with textContent", async () => { /* js/views/lessons.js: no innerHTML, no html: option */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `../lessons/text.js` not found; `registerSettingsCard` is not a function.

- [ ] **Step 3: Implement.** `js/views/lessons.js` follows the Mac `views/lessons.js` section for section (Today, To confirm, This month, Payments, Months, Totals; Overview card with amber edge on a late month; day phrase; Settings card with rate, applies-from, preview/confirm, week of seven boxes, tracking since) and the same words, with these differences: data comes from `watchLessons(data(), …)` and `buildLessons(records, londonDay(new Date()))` (redraw on every change, keeping the open `editing` set); writes call Task 2's actions with `{ today, now: new Date().toISOString(), onFail: toast }`, showing `{ error }` as the Mac showed server errors; Remove still asks the Mac's `window.confirm` text first; CSV buttons call `downloadCsv(monthCsv(…))` / `downloadCsv(taxYearCsv(…))` (Blob + `<a download>`); count boxes get `inputmode="numeric"`; Confirm buttons are `.btn` (≥ 44 px on phones by `components.css`). In `css/views.css` add, under `@media (max-width: 699px)`: `.lz-week { grid-template-columns: repeat(4, minmax(0, 1fr)); }` and `.lz-form > * { flex: 1 1 100%; }`. Register in `main.js` (`registerTab(lessons.tab)`, `lessons.registerLessons({ registerCard, registerDayPart, registerSettingsCard })`, `ICONS.lessons` = the Mac's music-note path). Add `js/lessons/text.js`, `js/weather/text.js`, `js/views/lessons.js` to `FILES`.

- [ ] **Step 4: Run to verify they pass, and look at it**

Run: `npm test` → PASS. Then serve (`python3 -m http.server 8790 --bind 127.0.0.1`), open `http://127.0.0.1:8790/?backend=memory`, sign in with the test user, set a rate and timetable in Settings, confirm a day, add a payment: the Overview card, "Your day" and the tab update without reloads, and Download CSV saves `lessons-2026-11.csv`.

- [ ] **Step 5: Commit**

```bash
git add js/lessons/text.js js/weather/text.js js/views/lessons.js js/core/registry.js js/views/settings.js js/views/overview.js js/main.js css/views.css sw.js js/tests tests.html
git commit -m "feat: Lessons tab, Overview card, Your day and Settings card online"
```

---

### Task 4: Weather summary, Open-Meteo calls and the saved place

**Files:**
- Create: `js/weather/summary.js`, `js/weather/open-meteo.js`, `js/weather/place.js`, `js/tests/fixtures/weather/{forecast.json,places_hexham.json,warnings_none.xml,warnings_two.xml}` (copied unchanged)
- Modify: `sw.js`, `js/tests/run-node.mjs`, `tests.html`
- Test: `js/tests/weather-summary.test.js` (both runners), `js/tests/weather-fetch.test.js` (Node only: reads fixtures with `node:fs`)

**Interfaces:**
- Consumes: `londonDay`, `REGIONS` from `js/weather/text.js`.
- Produces:
  - `js/weather/summary.js`: `COUNTY_REGION`, `guessRegion(nation, county) -> code|null`, `describeCode(code) -> [words, icon]`, `activeWarnings(warnings, now: Date) -> warning[]`, `summarise(forecast, warnings, now: Date) -> { days, dry_spells, next_dry_day, dry_until, gusty_days, flagged_days, rough_guide_from, card, day_phrase }`, `pyRound(x) -> int` (half to even, as Python's `round`).
  - `js/weather/open-meteo.js`: `GEOCODE_URL`, `FORECAST_URL`, `class WeatherError extends Error`, `searchPlaces(text, fetchImpl) -> Promise<[{name, county, nation, country, lat, lon, region}]>`, `fetchForecast(lat, lon, fetchImpl) -> Promise<{current, daily, hourly}>`. `fetchImpl(url)` resolves to a fetch `Response` (`ok`, `text()`); a rejection, a non-OK reply, bad JSON or a missing field → `WeatherError`. Query strings via `URLSearchParams` with the Mac's parameters and field lists; real calls pass `{ signal: AbortSignal.timeout(10000) }`.
  - `js/weather/place.js`: `checkPlace(place) -> msg|null` (messages: `"Choose a place"`, `"That place has no usable latitude"`, `"That place has no usable longitude"`, `"Unknown weather region"`, `"Unknown county"`), `savePlace(d, place, { onFail }) -> { ok, place } | { error }` writing `settings/weather` as `{ place: { name (trimmed), county, nation, lat, lon, region } }` (missing county/nation/region stored as `null`).

- [ ] **Step 1: Write the failing tests.** `weather-summary.test.js`: port every test in `ml-trading-strategy/tests/test_weather_summary.py` by name with its `days()`/`warning()`/`S()` helpers rebuilt in JS — `test_dry_rule_edges`, `test_missing_values_are_unknown`, `test_spells_start_middle_end`, `test_dry_until_and_next_dry_day`, `test_rain_every_day`, `test_dry_every_day`, `test_gust_thresholds`, `test_rough_guide_from_day_8`, `test_old_copy_drops_past_days`, `test_now_is_read_in_london_time` (`new Date("2026-11-24T04:30:00+05:00")`), `test_days_gain_words_and_icon`, `test_card`, `test_card_level_order`, `test_phrase_warning_timing`, `test_phrase_warning_beats_gust_and_red_beats_amber`, `test_phrase_yellow_never_leads`, `test_phrase_gusts`, `test_phrase_dry_and_wet`, `test_unknown_level_counts_like_yellow`, `test_expired_warnings_are_dropped_from_summary`, `test_no_days_left_says_no_forecast`; plus `test_guess_region` and `test_describe_code` from `tests/test_weather.py`, and:

```js
test("pyRound rounds halves to even, like Python", () => { eq([pyRound(54.5), pyRound(55.5), pyRound(54.6)], [54, 56, 55]); });
```

`weather-fetch.test.js` (fake fetch serving a fixture and recording URLs): `test_search_places_returns_matches_with_region`, `test_search_text_is_url_encoded` (`"name=Bishop%27s+Castle"`, no space in the URL), `test_short_search_text_returns_nothing_and_does_not_fetch`, `test_fetch_forecast_reduces_reply` (16 days, 72 hours, the same key sets and values, the three URL parts), `test_fetch_failure_raises_weather_error` (rejecting fetch; `"not json"` for places and forecast), and:

```js
test("a non-OK reply is a WeatherError", async () => { /* { ok: false, status: 429 } → rejects with WeatherError */ });
test("test_save_place_validates", () => {
  for (const change of [{ lat: 91 }, { lon: -181 }, { region: "xx" }, { name: "" }]) ok(checkPlace({ ...HEXHAM, ...change }));
});
test("test_save_place_ok_and_region_may_be_none", async () => {
  // savePlace on memory data → settings/weather = { place: { ...HEXHAM, nation: null } }; region null is accepted
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `../weather/summary.js` not found.

- [ ] **Step 3: Implement** the three modules as line-for-line ports of `mltrader/weather.py` (`summarise`, `_dry`, `_spells`, `_warning_phrase`, `active_warnings`, `guess_region`, the code table, `search_places`, `fetch_forecast`) and the place checks of `put_place` in `weather_api.py`. Day names come from the written date (`dayName` in `js/weather/text.js`); a warning's start is compared in London time (`londonDay`). Use `pyRound` for the gust phrase. Add the three modules to `FILES` (not the fixtures: `js/tests` is outside it).

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS, no FAIL lines.

- [ ] **Step 5: Commit**

```bash
git add js/weather js/tests/weather-summary.test.js js/tests/weather-fetch.test.js js/tests/fixtures js/tests/run-node.mjs tests.html sw.js
git commit -m "feat: weather summary, Open-Meteo calls and the saved place"
```

---

### Task 5: The forecast copy on each device

**Files:**
- Create: `js/weather/forecast.js`
- Modify: `sw.js`, `js/tests/run-node.mjs`
- Test: `js/tests/weather-forecast.test.js` (Node only)

**Interfaces:**
- Consumes: Task 4; `store.get/set` with an injected `storage`.
- Produces: `COPY_LIFE_MS = 3600000`, `REFRESH_GAP_MS = 60000`, `WARNINGS_LIFE_MS = 21600000`, `HOURS_SHOWN = 48`, `FORECAST_ERROR = "Couldn't get the forecast right now"`, `REFRESH_ERROR = "Couldn't refresh the forecast, showing the last copy"`, and
  `getWeather({ place, warnings, force = false, now = new Date(), fetchImpl = fetch, storage }) -> Promise<{ place: null } | { place, summary, current, hourly, warnings, fetched_at, stale, warnings_ok, refresh_error }>` — the same result as the Mac's `GET /api/weather`. `warnings` is the `weather/warnings` document (or null). Throws `Error(FORECAST_ERROR)` when there is no copy and the fetch fails.

Rules (ported from `_weather` in `weather_api.py`, per device): the copy is `store` key `weather-forecast` = `{ lat, lon, fetchedAt, lastAttempt, data }`, counted only when `lat`/`lon` equal the place's; fetch when there is no copy, or when (`force` or the copy is ≥ 1 hour old) and the last attempt for this place was ≥ 60 s ago; every attempt updates `lastAttempt`; a failed fetch with a copy keeps it with `refresh_error`; an old copy is `stale` and always carries `refresh_error`; `hourly` = the rows from `londonHourStart(now)`, first 48, each with `words` and `icon`; `current` gains `words` and `icon`. Warnings: none and `warnings_ok: false` when the place has no region, or the doc is missing, for another region, or its `fetchedAt` is ≥ 6 hours old; otherwise `activeWarnings(doc.items, now)` and `warnings_ok: doc.ok === true`.

- [ ] **Step 1: Write the failing tests**, with `T0 = new Date("2026-11-21T12:00:00Z")`, `HEXHAM`/`PLYMOUTH` as in the Python file, a counting fake fetch serving `forecast.json` that can be switched to fail, a fake storage, and a warnings doc `{ region: "ne", fetchedAt: T0.toISOString(), ok: true, items: <the two warnings parsed from warnings_two.xml, written out in the test> }`. Port from `ml-trading-strategy/tests/test_weather_api.py`, keeping names and values: `test_no_place` (no fetch), `test_save_place_ok_and_region_may_be_none` (region null → `warnings_ok` false, `warnings` `[]`), `test_first_get_fetches_and_stores` (one forecast fetch; `stale` false, `refresh_error` null, `warnings_ok` true, `fetched_at` = `T0.toISOString()`, 2 warnings, words/icons present), `test_second_get_within_hour_uses_copy` (59 min → 1 fetch), `test_get_after_hour_refetches` (61 min → 2 fetches, new `fetched_at`), `test_hourly_starts_at_current_london_hour` (18:30Z → first `"…T18:00"`, 48 rows), `test_forecast_failure_with_copy_is_stale`, `test_forecast_failure_without_copy_is_error` (rejects with `"Couldn't get the forecast right now"`), `test_warnings_failure_keeps_forecast` (doc `ok: false` → forecast shown, `warnings_ok` false, `stale` false), `test_place_change_clears_copy` and `test_copy_for_another_place_is_ignored` (Plymouth with a Hexham copy and fetch failing → error), `test_refresh_rate_limit` (force at 0 s, 30 s, 61 s → 1, 1, 2 fetches), `test_failed_refresh_backs_off`, `test_failed_forced_refresh_keeps_copy`, `test_no_copy_recovers_despite_backoff`, `test_expired_warnings_are_not_returned` (only amber kept; `day_phrase` `"amber rain warning in force"`), `test_copy_with_no_days_left_still_answers` (30 days later, fetch failing → `stale` true, `card` null, `"no forecast available"`). Not ported, being server races or now the job's work: `test_gated_get_without_warnings_copy_is_not_a_500`, `test_place_changed_during_fetch_never_shows_old_data`, `test_failed_warnings_keep_old_copy_and_retry`, `test_failed_forecast_refresh_makes_no_warnings_call`, `test_failed_forecast_with_no_copy_makes_no_warnings_call`, `test_places_search` (Task 4 covers search). New:

```js
test("warnings older than 6 hours, or for another region, count as unavailable", async () => { /* fetchedAt T0−6h → [] & false; region "sw" → [] & false */ });
test("a broken or foreign forecast copy counts as none", async () => {
  for (const raw of ["not json", '"a string"', '{"lat":54.97}', JSON.stringify({ lat: 54.97, lon: -2.1, fetchedAt: "x", data: {} })]) {
    // storage holds home-weather-forecast = raw → getWeather fetches once and answers normally
  }
  // storage whose getItem/setItem throw → still answers, fetching each time
});
test("the copy is kept under home-weather-forecast and nothing else is touched", async () => { /* storage keys after a get: only the pre-existing foreign keys plus "home-weather-forecast" */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `../weather/forecast.js` not found.

- [ ] **Step 3: Implement `getWeather`** following the rules above; a copy is usable only if `data.daily`, `data.hourly` and `data.current` are present and `fetchedAt` parses. Add the file to `FILES`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/weather/forecast.js js/tests/weather-forecast.test.js js/tests/run-node.mjs sw.js
git commit -m "feat: forecast copy per device with the 1-hour and once-a-minute rules"
```

---

### Task 6: Weather page, card, "Your day" and Farm location

**Files:**
- Create: `js/views/weather.js`
- Modify: `js/main.js` (register; `weather` icon = `WEATHER_ICONS.cloud`), `sw.js`, `js/tests/run-node.mjs`, `tests.html`
- Test: `js/tests/weather-text.test.js`, `js/tests/views.test.js`

**Interfaces:**
- Consumes: `js/weather/text.js` (created in Task 3), Tasks 4–5, `registerSettingsCard` (Task 3), `data()`.
- Produces: `tab = { id: "weather", label: "Weather", icon: "weather", order: 70, mount }`; `registerWeather({ registerCard, registerDayPart, registerSettingsCard })` — card `{ id: "weather", order: 50, size: "small", title: "Weather", load, empty, render, watch }`, day part `{ id: "weather", order: 30 }`, Settings card `{ id: "weather", order: 20 }` ("Farm location"); `loadWeather({ force }) -> Promise<result>` (reads `settings/weather` and `weather/warnings` through `data()`, calls `getWeather`; concurrent calls with the same `force` share one promise).

- [ ] **Step 1: Write the failing tests.** `weather-text.test.js`: port every test of `mltrader/web/static/js/tests/weather.test.js` by name and values. In `views.test.js`:

```js
test("the Weather view uses innerHTML only for its fixed icon table", async () => {
  // js/views/weather.js: exactly one "innerHTML", in the form svg.innerHTML = WEATHER_ICONS[…]; no html: option
});
test("loadWeather shares one fetch between the card, the day phrase and the tab", async () => {
  // memory data with settings/weather set; fetchImpl counter; Promise.all of three loadWeather({ force: false }) → 1 fetch
});
```

(`loadWeather` takes an optional `{ fetchImpl, storage, now }` for this test.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `../views/weather.js` not found.

- [ ] **Step 3: Implement** `js/views/weather.js` from the Mac `views/weather.js` (sections Now and today, Rain and dry spells, Wind, Next 48 hours; the Refresh button, disabled while loading; card with amber/red edge; day phrase) and the Mac Settings "Farm location" section (search box, Search, results list, region select, "Saved: …" status), with: `getWeather` instead of `/api/weather`; the tab, card and Settings card also `watch` `settings/weather` and `weather/warnings` and reload on change, dropping a result whose place no longer matches the latest watched place; search errors show `"Couldn't search for places right now"`; choosing a result or a region calls `savePlace` (a region change keeps the place). The warning note stays the Mac's `"Met Office warnings unavailable"`. Add `./js/views/weather.js` to `FILES`.

- [ ] **Step 4: Run to verify they pass, and look at it**

Run: `npm test` → PASS. In the local memory-backend app, set Hexham in Settings: the Weather tab, Overview card and "Your day" show the live forecast (a real call — this manual look is the only online step), and the warnings note reads "Met Office warnings unavailable".

- [ ] **Step 5: Commit**

```bash
git add js/views/weather.js js/main.js sw.js js/tests tests.html
git commit -m "feat: Weather tab, Overview card, Your day and Farm location online"
```

---

### Task 7: Met Office warnings job

**Files:**
- Create: `tools/warnings-rss.mjs`, `tools/warnings.mjs`, `.github/workflows/warnings.yml`
- Modify: `package.json` + `package-lock.json` (devDependency, `"warnings"` script), `SETUP.md`, `README.md`, `js/tests/run-node.mjs`
- Test: `js/tests/warnings-tool.test.js` (Node only)

**Interfaces:**
- Consumes: `REGIONS` from `js/weather/text.js`; `ownerUidFromRules` from `tests/rules/owner.mjs`.
- Produces:
  - `tools/warnings-rss.mjs`: `WARNINGS_URL = "https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/"`, `parseWarnings(xmlText) -> [{ level, kind, title, headline, starts, ends, link }]` (throws `Error` when there is no `<channel>`), `londonStamp(y, mo, d, hh, mm) -> "YYYY-MM-DDTHH:MM:00+00:00"|"+01:00"`.
  - `tools/warnings.mjs`: `refreshWarnings({ firestore, uid, fetchImpl, now }) -> Promise<{ written: bool, message }>` (exported for the calendar piece's trigger) and `main({ env, rulesText, log, connect }) -> exitCode` (run when executed directly).

Behaviour: read `users/{uid}/settings/weather`; no place, or a region not in `REGIONS` → nothing fetched or written (`written: false`, message `"No warning region set"`). Otherwise fetch `WARNINGS_URL + region` (header `User-Agent: home-dashboard`, 10 s timeout) and write `users/{uid}/weather/warnings` = `{ region, fetchedAt: now.toISOString(), ok: true, items }`. On a failed fetch or parse write `{ region, ok: false, fetchedAt, items }` keeping the previous doc's `fetchedAt` and `items` when it was for the same region (else `null` and `[]`), and log `::warning::Met Office warnings couldn't be fetched`. `main` exits 0 with `::notice::FIREBASE_SERVICE_ACCOUNT is not set — Met Office warnings were not fetched` when the secret is missing or blank, and with `::notice::firestore.rules still has the placeholder owner ID` when the owner ID is `REPLACE_WITH_YOUR_UID`; `connect(serviceAccountJson)` defaults to `firebase-admin/app` `initializeApp({ credential: cert(JSON.parse(json)) })` + `firebase-admin/firestore` `getFirestore()`, imported lazily so tests never load the Admin SDK.

`londonStamp` — the one non-obvious piece (Python's `datetime(..., tzinfo=LONDON).isoformat()`):

```js
// Minutes London is ahead of UTC at instant ms (0 or 60).
const offsetAt = (ms) => { const p = londonParts(ms); return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms) / 60000; };
export function londonStamp(y, mo, d, hh, mm) {
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  const off = offsetAt(wall - offsetAt(wall) * 60000);
  // format `${yyyy}-${MM}-${DD}T${HH}:${mm}:00+0${off / 60}:00`; return null for an impossible date (Date.UTC round trip differs)
}
```

The parser is regex-based (Node has no DOMParser): channel `pubDate`; each `<item>`'s `title`, `description`, `link`, with CDATA and the five XML entities decoded; level, kind and "valid from … to …" exactly as `fetch_warnings`/`_times` in `mltrader/weather.py` (case-insensitive; year from the pubDate's London year, +1 when the month is earlier than the pubDate's).

- [ ] **Step 1: Write the failing tests.** Port from `ml-trading-strategy/tests/test_weather.py`: `test_warnings_none` (`[]`), `test_warnings_two` (levels `["yellow", "amber"]`, kinds `["wind", "rain"]`, `starts` `"2026-11-22T06:00:00+00:00"`, `ends` `"2026-11-22T21:00:00+00:00"`, second item `null`/`null`, title prefix, link prefix, key set), `test_warning_valid_from_is_case_insensitive`, `test_unmatched_title_is_kept_with_level_found_in_title`, and the XML half of `test_fetch_failure_raises_weather_error` (`"not xml"` throws). New, with a fake Firestore (`doc(path)` → `{ get() → { exists, data() }, set(v) }`, recording writes) and a fake fetch:

```js
test("londonStamp gives Python's isoformat in both seasons", () => {
  eq(londonStamp(2026, 11, 22, 6, 0), "2026-11-22T06:00:00+00:00");
  eq(londonStamp(2026, 7, 1, 6, 0), "2026-07-01T06:00:00+01:00");
  eq(londonStamp(2026, 11, 31, 6, 0), null);
});
test("refreshWarnings writes the region's warnings under the owner", async () => {
  // settings/weather place region "ne"; fetch serves warnings_two.xml
  // → fetched URL ends "/WarningsRSS/Region/ne"; one write to "users/OWNER/weather/warnings":
  //   { region: "ne", fetchedAt: NOW.toISOString(), ok: true, items: <2 items> }
});
test("refreshWarnings does nothing without a valid region", async () => { /* no doc; region null; region "../x" → no fetch, no write */ });
test("a failed fetch keeps the last items for the same region and says so", async () => { /* previous ok doc for "ne"; fetch rejects → write { region: "ne", ok: false, fetchedAt: previous, items: previous }; previous doc for "sw" → fetchedAt null, items [] */ });
test("main exits 0 with a notice when the secret or the owner ID is missing", async () => {
  // env {} and env { FIREBASE_SERVICE_ACCOUNT: " " } → 0 and the secret notice; connect never called
  // rules with REPLACE_WITH_YOUR_UID → 0 and the placeholder notice
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `../../tools/warnings-rss.mjs` not found.

- [ ] **Step 3: Implement** both tool modules; `npm install --save-dev --save-exact firebase-admin@13`; add `"warnings": "node tools/warnings.mjs"` to `scripts`. Create `.github/workflows/warnings.yml`: name `Met Office warnings`; `on: schedule: - cron: "17 * * * *"` and `workflow_dispatch`; `permissions: contents: read`; `concurrency: { group: warnings, cancel-in-progress: false }`; one job on `ubuntu-latest`: `actions/checkout@v7`, `actions/setup-node@v7` (node 20), `npm ci`, `npm run warnings` with `env: FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}`. Add SETUP.md step 10, "Turn on Met Office warnings": Firebase console → Project settings → Service accounts → Generate new private key; GitHub repo → Settings → Secrets and variables → Actions → New repository secret `FIREBASE_SERVICE_ACCOUNT`, paste the whole file's contents; delete the downloaded file; Actions → Met Office warnings → Run workflow; until then the Weather tab says "Met Office warnings unavailable". README: one line under Tests for `npm run warnings` and the hourly job.

- [ ] **Step 4: Verify**

Run: `npm test` → PASS. Run: `env -u FIREBASE_SERVICE_ACCOUNT npm run warnings; echo "exit $?"` → the secret notice and `exit 0`. Run: `grep -n "exclude=tools\|exclude='package\*.json'" .github/workflows/publish.yml` → both present (the Admin SDK and tools never reach the site).

- [ ] **Step 5: Commit**

```bash
git add tools/warnings-rss.mjs tools/warnings.mjs .github/workflows/warnings.yml package.json package-lock.json SETUP.md README.md js/tests/warnings-tool.test.js js/tests/run-node.mjs
git commit -m "feat: hourly GitHub job writes Met Office warnings to Firestore"
```

---

### Task 8: Browser check covers Lessons and Weather

**Files:**
- Modify: `tools/browser-check.mjs`, `README.md` (screenshot count)

**Interfaces:**
- Consumes: the running app on the memory backend; fixtures from `js/tests/fixtures/weather/`.

- [ ] **Step 1: Extend the check.** `pages` becomes `["overview", "lessons", "weather", "settings"]` (16 screenshots). Before the first navigation, `Fetch.enable` with pattern `*`: requests to the base URL's origin continue; `api.open-meteo.com` → `Fetch.fulfillRequest` with `forecast.json`; `geocoding-api.open-meteo.com` → `places_hexham.json` (both with `access-control-allow-origin: *`); anything else → `Fetch.failRequest` (`BlockedByClient`), and the URL is recorded as a problem "went online: <url>". After sign-in on each load, seed through the page's own module (same instance as the app):

```js
await evaluate(`import("./js/core/data.js").then(async ({ data }) => {
  const d = data();
  await d.set("lessonRates/2026-01-01", { pence: 1800 });
  await d.set("settings/lessons", { timetable: [6, 0, 0, 4, 0, 0, 0], trackingSince: <today − 14 days> });
  await d.set("lessonDays/<yesterday>", { lessons: 6, note: "${"W".repeat(40)}", confirmedAt: new Date().toISOString() });
  await d.set("lessonPayments/p1", { received: <today>, pence: 5000, month: <this month>, note: "bacs", addedAt: new Date().toISOString() });
  await d.set("settings/weather", { place: { name: "Hexham", county: "Northumberland", nation: "England", lat: 54.97, lon: -2.1, region: "ne" } });
  return true;
})`);
```

(dates computed in the check from today's London date). Then wait for `#page` to show `"Lessons"` / `"Weather"` headings and the seeded content (`.lz-section`, `.wx-strip` or the "No forecast available" line once the fixture's dates have passed) before measuring. All existing checks (console errors, sideways scroll, tap targets, 16 px text, toast over sheet) apply to the new pages. Update the header comment and README line ("checks Overview, Lessons, Weather and Settings … saves 16 screenshots").

- [ ] **Step 2: Run it**

Run: `python3 -m http.server 8790 --bind 127.0.0.1 &` then `node tools/browser-check.mjs http://127.0.0.1:8790 /tmp/home-check`
Expected: 16 `ok` lines and `all clear`. Fix any failing tap target, text size or sideways scroll in `css/views.css` (phone rules only) and re-run until it passes. Look at the 16 screenshots.

- [ ] **Step 3: Run every suite**

Run: `npm test && npm run test:helpers && npm run test:rules`
Expected: all pass (rules tests say "Java not found" and pass locally without Java).

- [ ] **Step 4: Commit**

```bash
git add tools/browser-check.mjs README.md css/views.css
git commit -m "test: browser check covers the Lessons and Weather tabs, offline"
```

---

### Task 9: The Mac dashboard points to the online tabs (ml-trading-strategy repo)

Run in `/Users/tomriddell/Desktop/Websites /ml-trading-strategy`, on a new branch `lessons-weather-moved` from `main`. Do not merge.

**Files:**
- Create: `mltrader/web/static/js/views/moved.js`, `mltrader/web/static/js/tests/moved.test.js`
- Modify: `mltrader/web/static/js/main.js`, `mltrader/web/static/js/views/settings.js`, `mltrader/web/static/js/tests/run-node.mjs`, `mltrader/web/static/tests.html` (import the new test), `README.md` (one line)
- Keep untouched: all Python (`mltrader/lessons.py`, `weather.py`, `web/lessons_api.py`, `web/weather_api.py`), their tests, and `views/lessons.js`, `views/lessons-text.js`, `views/weather.js`, `views/weather-text.js` (pytest and the JS tests still read them).

**Interfaces:**
- Produces: `MOVED = [{ id: "weather-moved", order: 50, text: "Weather has moved to your online dashboard", href: "https://triddell590-wq.github.io/home-dashboard/#/weather" }, { id: "lessons-moved", order: 60, text: "Lessons have moved to your online dashboard", href: "https://triddell590-wq.github.io/home-dashboard/#/lessons" }]` and `registerMoved({ registerCard })` (small cards, no `load`; `render` draws one `<a target="_blank" rel="noopener noreferrer">` with the text, via `textContent`).

- [ ] **Step 1: Create the branch and write the failing test**

```bash
git switch -c lessons-weather-moved
```

`moved.test.js`:

```js
test("the moved cards link to the online Lessons and Weather tabs", () => {
  eq(MOVED.map((m) => [m.id, m.text, m.href]), [
    ["weather-moved", "Weather has moved to your online dashboard", "https://triddell590-wq.github.io/home-dashboard/#/weather"],
    ["lessons-moved", "Lessons have moved to your online dashboard", "https://triddell590-wq.github.io/home-dashboard/#/lessons"]]);
});
test("the Mac no longer registers the Lessons and Weather tabs, cards or settings", async () => {
  // main.js text: no "registerLessons(", no "registerWeather(", and the registerTab list has no `weather` or `lessons`
  // settings.js text: no "/api/weather/place", no "settingsCard as lessonsCard"
});
```

Import it in `run-node.mjs` and `mltrader/web/static/tests.html`.

- [ ] **Step 2: Run to verify it fails**

Run: `node mltrader/web/static/js/tests/run-node.mjs`
Expected: FAIL — `../views/moved.js` not found.

- [ ] **Step 3: Implement.** `moved.js` as above. In `main.js`: drop `weather` and `lessons` from the `registerTab` list, remove the `registerWeather` and `registerLessons` calls and the now-unused `lessons`/`weather` imports (keep `WEATHER_ICONS`, still used for `sun`), and call `registerMoved({ registerCard })`. In `views/settings.js`: remove the "Farm location" section, the Lessons settings card and their imports (they would write to the copy that is no longer used). README: one line saying Lessons and Weather now live in the online dashboard.

- [ ] **Step 4: Run the whole Mac suite**

Run: `node mltrader/web/static/js/tests/run-node.mjs && .venv/bin/python -m pytest -q`
Expected: JS `N of N passed`; pytest all passed (including `test_lessons_api.py`, `test_weather_api.py`, `test_web.py`'s module-import check and `test_page_logic_in_node`).

- [ ] **Step 5: Commit on the branch**

```bash
git add mltrader/web/static/js/views/moved.js mltrader/web/static/js/tests/moved.test.js mltrader/web/static/js/main.js mltrader/web/static/js/views/settings.js mltrader/web/static/js/tests/run-node.mjs mltrader/web/static/tests.html README.md
git commit -m "feat: Lessons and Weather tabs now point to the online dashboard"
```
