// Runs the tests that need no browser DOM: `node js/tests/run-node.mjs`.
// card.test.js and theme.test.js need a DOM, so only tests.html runs them.
import { run } from "./harness.js";
import "./dom.test.js";
import "./router.test.js";
import "./registry.test.js";
import "./data.test.js";
import "./auth.test.js";
import "./firebase-map.test.js";
import "./tabbar.test.js";
import "./sync.test.js";
import "./views.test.js";
import "./signout.test.js";
import "./startup.test.js";
import "./store.test.js";
import "./sw.test.js";
import "./page.test.js";
import "./lessons-sums.test.js";
import "./lessons-data.test.js";
import "./lessons-text.test.js";
import "./weather-summary.test.js";
import "./weather-fetch.test.js";
import "./weather-forecast.test.js";
import "./weather-text.test.js";
import "./warnings-tool.test.js";

const result = await run();
for (const f of result.failures) console.log(`FAIL ${f.name}\n      ${f.error}`);
console.log(`${result.passed} of ${result.total} passed`);
process.exit(result.failures.length ? 1 : 0);
