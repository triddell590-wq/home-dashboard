# Calendar and morning reminders (design)

Piece 2 of the online order, built after lessons and weather move online
(`2026-11-23-lessons-weather-online-design.md`). Tom asked Claude to design and build it without further
questions; every choice not quoted from Tom is Claude's call and is marked **(call)**.

## 1. What Tom asked for (his answers, 2026-11-22 and 23)

- Today his events live on "paper or my head".
- Uses: **appointments, repeating jobs, deadlines, and seeing lesson days**.
- Entry in **plain words**.
- A **notification to his phone**, sent by GitHub "just like Farm Ledger", working **with his Mac off**,
  **free**, and **only when needed**: "i dont want to be inondated with needless notifications".
- Timing: "it should remind me that morning **it cant be late**".
- Deadlines: "**a few days before and then again in the morning**".
- Repeats: "a mix of all of those" — every Tuesday; every other week / every 3 weeks; the last Friday or
  second Monday of the month, or the 1st; yearly ("every spring").
- Everything is synced between his phone and his Mac.

**Success:** Tom types "dentist tuesday 2pm" or "bins every other tuesday" on either device, sees what the app
understood and saves it; both devices show it at once; on any day with something on, one notification arrives
at 7am London time listing that day's items and deadlines due in three days; on a day with nothing on, nothing
arrives.

### Out of scope

Shared calendars or other people; Google/Apple calendar import or sync; reminders at other times or several a
day; travel times; attachments; editing a single occurrence of a repeat beyond skipping it.

## 2. Data (Firestore, `users/{uid}/`, covered by the existing owner-only rules)

`events/{id}` (random id):

| Field | Meaning |
|---|---|
| `title` | text, 1–80 characters |
| `kind` | `appointment`, `job` or `deadline` |
| `date` | first (or only) date, `YYYY-MM-DD`, London |
| `time` | `HH:MM` or `null` (all day) |
| `repeat` | `null` or `{unit: "day"|"week"|"month"|"year", every: 1–52, monthly: "date"|"weekday"|null}` |
| `until` | last date of a repeat, or `null` |
| `skipped` | dates of single occurrences removed |
| `done` | for deadlines: dates of occurrences ticked off |
| `note` | optional text |
| `createdAt`, `updatedAt` | ISO times |

Repeat rules **(call)**:
- `week`: every N weeks on the start date's weekday.
- `month` + `date`: every N months on the start date's day number; in a shorter month, the month's last day.
- `month` + `weekday`: every N months on the same nth weekday as the start date (1st–4th), or `last` when the
  start date is in the month's last seven days and was entered as "last".  Stored as
  `{…, monthly: "weekday", nth: 1–4 | -1}`.
- `year`: every N years on the same day and month (29 Feb → 28 Feb in other years).
- `day`: every N days.

Other documents: `devices/{id}` `{token, label, addedAt}` (one per device that turned reminders on) and
`reminders/{YYYY-MM-DD}` `{sentAt, items, count, devices, errors}` written by the sender.

## 3. Plain words (`js/calendar/parse.js`, pure, no outside service)

`parse(text, today)` returns `{title, kind, date, time, repeat, until, unsure: [...]}` or the fields it found.
It understands **(call)**, case-insensitive, UK order:
- dates: today, tomorrow, weekday names (the next one, today excluded), "next tuesday" (the one after this
  coming one only when this week's has passed — same as the next one otherwise), "25 nov", "25th november",
  "25/11", "25/11/2027", "the 30th" (this month, or next if past), "in 3 days", "in 2 weeks";
- times: "2pm", "2.30pm", "14:00", "at 9" (9:00), "noon", "midday";
- repeats: "every day", "every tuesday", "every other tuesday", "every 3 weeks", "every month",
  "every month on the 1st", "on the 1st of every month", "the last friday of every month", "every second
  monday" (of the month), "every year", "every 14 march", "yearly", "weekly", "monthly", "fortnightly",
  "until 30 june";
- deadlines: "due", "deadline", "by" before a date make `kind: deadline`; a repeat without those makes
  `kind: job`; anything else is an `appointment`;
- "every spring/summer/autumn/winter" → yearly from 1 Mar / 1 Jun / 1 Sep / 1 Dec, flagged in `unsure` so the
  preview asks Tom to check the date.

What is left after removing the recognised words, tidied, is the title (first letter capitalised). Past dates
without a year roll to next year. The preview always shows the result in words ("Bins — every other Tuesday,
from Tue 25 Nov") with each field editable (kind, date, time, repeat, until) before saving. If no date is
found, the date field is empty and Save stays disabled until one is picked.

## 4. Occurrences and lesson days (`js/calendar/occurrences.js`, pure)

- `occurrences(events, from, to)` — every dated occurrence in the range, skipped dates removed, each with
  `{eventId, date, time, title, kind, done}`; sorted by date, then time (all-day first), then title.
- Lesson days come from the lessons data: past and today's `lessonDays` with lessons > 0 ("6 lessons"), and
  future dates from the timetable ("Lessons — usually 6") from today onwards. They are read-only on the
  calendar and link to the Lessons tab. **(call)** They are not counted as "something on" for reminders —
  they're routine — but are listed in a reminder that is being sent anyway.

## 5. Screens

- **Calendar tab** (calendar icon, after Overview):
  1. **Add** — one text box ("e.g. dentist tuesday 2pm") and the preview card under it with Save / Cancel.
  2. **Coming up** — the next 60 days grouped by day ("Today", "Tomorrow", "Thu 27 Nov"); deadlines show
     "Due" and a tick box; overdue undone deadlines stay at the top in amber ("Overdue: car tax — 2 days").
  3. **Month** — a month grid with dots for days that have items, previous/next month; tapping a day shows
     that day's list. On phones the grid is compact (single-letter weekdays).
  - Tapping an item opens it: edit fields (same form as the preview), "Skip this one" for a repeat,
    "Delete" (asks "Delete … ? This can't be undone."; for a repeat it offers "Just this one" or "All").
- **Overview card (small):** today's items, then "Due soon" deadlines (within 3 days). Empty: "Nothing on
  today". Amber edge when a deadline is overdue.
- **"Your day" phrase**, first match wins: an overdue deadline ("car tax overdue"), today's first timed item
  ("dentist at 2pm"), a deadline today ("car tax due today"), a count ("3 things today").
- **Settings → Reminders:** "Turn on reminders on this device" (asks the browser's permission, then saves the
  device), the list of devices with Remove, and plain status text: on an iPhone that isn't using the
  home-screen app, "On iPhone, add the app to your Home Screen first, then turn reminders on there"; before the
  push key is configured, "Reminders aren't set up yet".

## 6. Morning reminders

**Why not GitHub's own timer alone:** Farm Ledger's "hourly" schedule actually ran 4–8 hours apart
(2026-11-20 to 23), so it can't promise 7am. **Approach (call, explained to Tom 2026-11-23):** a free outside
timer, cron-job.org, starts the GitHub workflow every hour on the hour (Europe/London); GitHub's own schedule
stays on as a backup; the sender records each day it has handled, so nothing is ever sent twice.

`.github/workflows/notify.yml` runs on `workflow_dispatch` and `schedule` (hourly backup). It runs
`tools/notify.mjs`, which uses the Firebase Admin SDK with the `FIREBASE_SERVICE_ACCOUNT` secret:
1. Refreshes the Met Office warnings (the lessons-and-weather piece's `tools/warnings.mjs`).
2. Works out London date D and time. Before 07:00 or from 21:00, it stops. If `reminders/D` exists, it stops.
3. Builds the digest with the shared `occurrences` code: D's appointments and jobs, deadlines due D and not
   done, deadlines due D+3 and not done, and overdue undone deadlines (only once, on the first day overdue
   **(call)**).
4. If the digest is empty, writes `reminders/D` with `count: 0` and sends nothing.
5. Otherwise sends one notification per device through FCM: title "Today" (or "Today and coming up"), body
   lines like "Dentist 2pm", "Bins out", "Due today: car tax", "Due Sat: council tax", at most 4 lines then
   "+2 more"; tapping it opens the Calendar tab. Device tokens FCM reports as dead are removed. Then writes
   `reminders/D`.
- Without the secret, the workflow exits cleanly with a notice. A `dry_run` input prints the digest without
  sending.
- **Push in the app:** the Firebase Messaging compat library 10.7.0 is vendored like the others (checked
  against npm). `sw.js` shows incoming pushes and opens `#/calendar` on tap. The Web Push public key lives in
  `js/config.js` as `VAPID_KEY` (public by design).

**Tom's one-time steps** (in `SETUP.md`, done by Tom, never by Claude): generate the Web Push key in the
Firebase console; create a Firebase service-account key and save it as the GitHub secret
`FIREBASE_SERVICE_ACCOUNT`; create a GitHub fine-grained token allowed only to start this repository's workflows
and a free cron-job.org job that calls the workflow every hour; on the iPhone, open the home-screen app and turn
reminders on.

## 7. Testing

- Node tests: the parser with every phrase in §3 (and dates across month and year ends, past dates rolling,
  times, titles left over); occurrences for each repeat rule (31st in short months, 29 Feb, nth and last
  weekday, every 3 weeks, until, skipped, done) and DST changes; the digest builder (empty day sends nothing,
  three-day warning, deadline on the day, done deadlines dropped, overdue once, lesson days never trigger, the
  4-line cut); the sender's time window and once-per-day rule with a fake clock and fake Firestore and FCM.
- Memory-backend tests for the Calendar view's add, edit, skip, delete and tick.
- Browser check of the Calendar tab and Settings → Reminders at phone and Mac sizes in both themes.
