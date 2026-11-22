# Home dashboard

A personal home dashboard for phone and Mac: a small web app made of plain ES modules with no build step, where each tab and card registers itself with the shell. It is meant to be served as static files (GitHub Pages) and backed by Firebase.

## Tests

- Node (no browser needed): `node js/tests/run-node.mjs`
- Browser (includes the DOM tests): serve the folder, e.g. `python3 -m http.server`, then open `http://localhost:8000/tests.html`
