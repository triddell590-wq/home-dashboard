// A tiny test harness shared by the browser page (tests.html) and the Node runner (run-node.mjs).
const cases = [];

export function test(name, fn) {
  cases.push({ name, fn });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

export function eq(actual, expected) {
  const a = JSON.stringify(canonical(actual));
  const b = JSON.stringify(canonical(expected));
  if (a !== b) throw new Error(`expected ${b}\n      got ${a}`);
}

export function ok(value, message = "expected a true value") {
  if (!value) throw new Error(message);
}

export async function run() {
  const failures = [];
  for (const { name, fn } of cases) {
    try {
      await fn();
    } catch (err) {
      failures.push({ name, error: String(err && err.message ? err.message : err) });
    }
  }
  return { total: cases.length, passed: cases.length - failures.length, failures };
}
