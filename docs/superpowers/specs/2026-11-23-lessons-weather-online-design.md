# Lessons and weather move online (design)

Piece 3 of the online order (base → **lessons and weather** → calendar → trading), brought forward by Tom on
2026-11-23 because he wants lesson days on the calendar and "the entire dashboard to be synced": whatever he
does on his phone must show on his Mac and the other way round, like Farm Ledger.

Tom asked Claude to design and build this without further questions ("go ahead work on it yourself and report
when fully completed"). Every choice below not quoted from Tom is Claude's call and is marked **(call)**.

## 1. What it is

The two finished Mac-dashboard pieces, Lessons and Weather, become tabs of the online dashboard
(`triddell590-wq/home-dashboard`), with the same behaviour and the same figures. They follow the Mac pieces'
approved designs exactly, except where this document says otherwise:

- `ml-trading-strategy/docs/superpowers/specs/2026-11-22-lessons-design.md` (lessons)
- `ml-trading-strategy/docs/superpowers/specs/2026-11-21-weather-design.md` (weather)

The online base's constraints hold (`docs/superpowers/specs/` in ml-trading-strategy,
`2026-11-22-online-base-design.md` §2): £0, plain ES modules with no build step, iOS Safari and desktop
browsers, London dates, reduced motion, test-first, phone layout (bottom tab bar), `home-` storage keys only.

**Success:** Tom enters a day's lessons on his phone and sees it on his Mac at once; every lessons figure
matches what the Mac piece's sums give for the same records; the Weather tab shows the 16-day forecast for his
farm on any device after he sets the place once.

### Findings that shaped this (checked 2026-11-23)

- Tom has **no lessons records yet** (no `lessons.db` in the Mac's data folder) and **no farm location set**.
  Nothing needs importing. **(call)** No import tool is built.
- Open-Meteo's forecast and place search allow browser calls (`access-control-allow-origin: *`), so the
  browser calls them directly.
- The Met Office warnings feed does **not** allow browser calls (no CORS header). Warnings are fetched by a
  GitHub Actions job instead (§4).

### Out of scope

The calendar (next piece), phone notifications, trading, Farm Ledger, Obsidian, the Agents tracker.

## 2. Data (Firestore, under `users/{uid}/`, so the existing owner-only rules cover it)

**(call)** One document per record, so two devices editing different days never overwrite each other:

| Path | Fields |
|---|---|
| `lessonDays/{YYYY-MM-DD}` | `lessons` (int 0–30), `note` (string, may be empty), `confirmedAt` (ISO time) |
| `lessonPayments/{id}` | `received` (date), `pence` (int), `month` (`YYYY-MM`), `note`, `addedAt` |
| `lessonRates/{YYYY-MM-DD}` | `pence` (int) — the id is `effective_from` |
| `settings/lessons` | `timetable` (seven counts, Monday first, 0–30), `trackingSince` (date) |
| `settings/weather` | `place`: `{name, county, nation, lat, lon, region}` |
| `weather/warnings` | written by the GitHub job only: `{region, fetchedAt, ok, items: [...]}` |

- Money stays **integer pence**. Payment ids are random (`crypto.randomUUID()`).
- The forecast itself is **not** stored in Firestore **(call)**: it is public data, so each device keeps its
  own copy in localStorage (`home-weather-forecast`) with the 1-hour refresh rule. Only the place is synced.

## 3. Lessons

- **Sums:** `js/lessons/sums.js` is a line-for-line JavaScript port of `mltrader/lessons.py` (rate by date,
  month summary and status, overall owed, UK tax year, days to confirm, default payment month, rate-change
  preview), all in pence. Its tests port every case of the Python tests, with the same inputs and expected
  outputs, so the two cannot drift.
- **Checks:** the Mac server's input checks (lessons 0–30, real past dates, payment 1p–£10,000, month already
  started, rate 1p–£1,000, timetable counts 0–30, tracking date not in the future) move to
  `js/lessons/checks.js`, with the same plain messages, and run before any write.
- **Rate changes:** as on the Mac, a rate change that alters recorded days shows the preview and needs a
  confirm. Saving the rate writes one `lessonRates` document.
- **CSV export:** built in the browser with the same rows, columns and totals as the Mac's export, and saved
  as a file (`lessons-2026-11.csv`, `lessons-tax-year-2026.csv`).
- **Page:** the Mac's Lessons tab sections (Today, To confirm, This month, Payments, Months, Totals), its
  Overview card, its "Your day" phrase and its Settings card, reading and writing through `data()` and
  updating live through `watch`. The Mac's wording module (`lessons-text.js`) is carried over with its tests.
- **Phone:** sections stack in one column; number boxes use `inputmode="numeric"`; Confirm buttons are at
  least 44 px.

## 4. Weather

- **Sums:** `js/weather/summary.js` ports `summarise` and the weather-code table from `mltrader/weather.py`
  (dry rule, dry spells, gusts 40/50 mph, rough guide from day 8, card level, day phrase), with the Python
  tests ported case for case. `guess_region` and its county table are ported too.
- **Fetching (browser):** place search and the forecast use the same Open-Meteo URLs and fields as the Mac.
  The 1-hour rule, the refresh button limit (once a minute) and the stale fallback ("Forecast from 07:10 —
  couldn't refresh (no internet?)") work as on the Mac, per device. Only the typed place text and the chosen
  coordinates go to Open-Meteo, as before.
- **Warnings (GitHub):** a workflow `warnings.yml` runs `tools/warnings.mjs` hourly (and on demand). It reads
  Tom's `settings/weather` region with the Firebase Admin SDK, fetches that region's Met Office RSS, parses it
  with the ported parser and writes `weather/warnings`. It needs the `FIREBASE_SERVICE_ACCOUNT` secret; until
  Tom adds it the job exits cleanly with a notice, and the page shows the Mac's existing "Met Office warnings
  unavailable" note. The job also runs from the calendar piece's on-time trigger, so warnings are never more
  than about an hour old once that is set up. A warnings copy older than 6 hours is treated as unavailable
  **(call)**.
- **Page:** the Mac's Weather tab sections, Overview card, "Your day" phrase and Settings "Farm location"
  section, with the Mac's wording module and tests carried over.

## 5. The Mac dashboard

Once both tabs are live online, the Mac dashboard's Lessons and Weather tabs and Overview cards are replaced
by one line each: "Lessons have moved to your online dashboard" with a link to
`https://triddell590-wq.github.io/home-dashboard/#/lessons` (and the same for weather). **(call)** This keeps
one copy of each, which is what "synced" needs. The Mac's Python code and tests stay in place, untouched, so
nothing else breaks; trading stays on the Mac until it moves.

## 6. Testing

- Node page tests: the ported sums, checks and wording with every Python case; the CSV text; the warnings
  RSS parser; the forecast cache's 1-hour and stale rules with a fake clock and fake fetch (never online).
- Memory-backend tests for the Lessons and Weather views' writes (replace-on-save, removal, confirm-needed
  rate change).
- The browser check covers the two new tabs at phone and Mac sizes in both themes, on the memory backend.
- The Mac repo's test suite still passes after its tabs become links.
