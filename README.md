# Home dashboard

A personal home dashboard for phone and Mac: a small web app made of plain ES modules with no build step, where each tab and card registers itself with the shell. It is published to GitHub Pages and backed by Firebase.

To put it online, follow [SETUP.md](SETUP.md).

## Run it locally

Serve the folder and open it with the test backend, which saves nothing:

```
python3 -m http.server 8790 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8790/?backend=memory` and sign in as `test@example.com` with `test-only-password`.

## Tests

- Page tests (Node, no browser): `npm test`
- Page tests in the browser, including the DOM tests: serve the folder as above and open `/tests.html`
- Rules tests (Firestore emulator, needs Java): `npm run test:rules`. Without Java it says so and passes; GitHub runs them for real. First run `npm ci`.
- Rules helper tests: `npm run test:helpers`
- Met Office warnings job: `npm run warnings` runs `tools/warnings.mjs` (GitHub runs it hourly via `.github/workflows/warnings.yml`; it needs the `FIREBASE_SERVICE_ACCOUNT` secret and otherwise skips with a notice). `npm test` covers it offline with fakes.
- Morning reminders: `npm run notify` runs `tools/notify.mjs` (needs the secret; `npm run notify -- --dry-run --any-time` prints today's digest and sends nothing). `.github/workflows/notify.yml` runs it hourly, started by cron-job.org. `npm test` covers it offline with fakes.
- Browser check, with a local server running: `node tools/browser-check.mjs http://127.0.0.1:8790 <screenshot-folder>`. It drives headless Chrome (Playwright's `chromium_headless_shell` if installed, otherwise Google Chrome; or set `CHROME`), checks Overview, Lessons, Weather and Settings at 375x812 and 1280x800 in both themes (seeding test data on the memory backend; Open-Meteo answers come from the repo's fixtures and any other outside request fails the check), saves 16 screenshots, and exits 1 on a console error, sideways scrolling (also with a 40-character name), a tap target under 44x44 at phone width, or a toast over the More sheet.

## Publishing

Every push to `main` runs the tests in `.github/workflows/publish.yml`, then publishes to GitHub Pages only if they all pass.
