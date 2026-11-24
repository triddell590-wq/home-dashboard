// Plain Node unit tests for the helper modules (no emulator, no Java).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rulesText = readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8');
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

const owner = await import('./owner.mjs').catch(e => ({ importError: e }));
const run = await import('./run.mjs').catch(e => ({ importError: e }));

await check('owner.mjs exports ownerUidFromRules', () => {
  assert.equal(typeof owner.ownerUidFromRules, 'function', 'ownerUidFromRules is missing from tests/rules/owner.mjs');
});
// SETUP.md has Tom put his own ID in firestore.rules, so the committed file may hold either.
await check('the committed rules file yields an owner ID', () => {
  assert.match(owner.ownerUidFromRules(rulesText), /^\w+$/);
});
await check('reads the placeholder', () => {
  assert.equal(owner.ownerUidFromRules('function ownerUid() { return "REPLACE_WITH_YOUR_UID"; }'), 'REPLACE_WITH_YOUR_UID');
});
await check('reads a real-looking uid', () => {
  assert.equal(owner.ownerUidFromRules('function ownerUid() {\n  return "abc123";\n}'), 'abc123');
});
await check('throws a clear error when ownerUid is absent', () => {
  assert.throws(() => owner.ownerUidFromRules('rules_version = "2";'), /Could not find function ownerUid\(\) in firestore\.rules/);
});
await check('run.mjs exports decideJavaAction', () => {
  assert.equal(typeof run.decideJavaAction, 'function', 'decideJavaAction is missing from tests/rules/run.mjs');
});
const MSG = 'Java not found — rules tests run on GitHub';
await check('no java, not CI -> message, exit 0', () => {
  assert.deepEqual(run.decideJavaAction(false, false), { run: false, message: MSG, exitCode: 0 });
});
await check('no java, CI -> message, exit 1', () => {
  assert.deepEqual(run.decideJavaAction(false, true), { run: false, message: MSG, exitCode: 1 });
});
await check('java present -> run the emulator (CI or not)', () => {
  assert.equal(run.decideJavaAction(true, false).run, true);
  assert.equal(run.decideJavaAction(true, true).run, true);
});

// The trading paths are written only by the Admin SDK: read-only for the owner, everything else unchanged.
// Comments are dropped and whitespace is optional everywhere, so reformatting the rules cannot break these checks.
const flat = rulesText.replace(/\/\/.*$/gm, '');
const matchPaths = (text) => [...text.matchAll(/match\s+(\/(?:[^\s{]|\{[^}]*\})*)\s*\{/g)].map((m) => m[1]);
const blanketPaths = (text) => matchPaths(text).filter((p) => /=\*\*\}/.test(p) && !/^\/users\/\{uid\}\/\{coll\}\/\{\w+=\*\*\}$/.test(p));
await check('rules: the trading collections are locked against writes', () => {
  assert.match(flat, /allow\s+write\s*:\s*if\s+owner\(uid\)\s*&&\s*!\s*\(\s*coll\s+in\s*\[\s*'trading'\s*,\s*'tradingTickers'\s*,\s*'tradingPicks'\s*\]\s*\)\s*;/);
  assert.match(flat, /allow\s+read\s*:\s*if\s+owner\(uid\)\s*;/);
});
await check('rules: the user document itself stays read/write for the owner', () => {
  assert.match(flat, /match\s+\/users\/\{uid\}\s*\{\s*allow\s+read\s*,\s*write\s*:\s*if\s+owner\(uid\)\s*;\s*\}/);
});
await check('rules: no blanket recursive match remains (users/{uid}/{document=**}, {path=**}, top-level)', () => {
  assert.deepEqual(blanketPaths(flat), []);
  assert.ok(matchPaths(flat).includes('/users/{uid}/{coll}/{document=**}'));
});
await check('rules: every write allow outside the user document carries the trading guard', () => {
  for (const m of flat.matchAll(/allow\s+([^:]*?)\s*:\s*if\s+([^;]*);/g)) {
    const kinds = m[1].split(/\s*,\s*/);
    if (kinds.includes('write') && kinds.includes('read')) continue;   // the users/{uid} document rule
    if (kinds.includes('write')) assert.match(m[2], /!\s*\(\s*coll\s+in\s*\[/, 'unguarded write: ' + m[0]);
  }
});
await check('rules: the blanket detector catches {path=**} and a top-level /{document=**}', () => {
  assert.deepEqual(blanketPaths('match /{document=**} { allow write: if true; }'), ['/{document=**}']);
  assert.deepEqual(blanketPaths('match /users/{uid}/{path=**} { allow write: if owner(uid); }'), ['/users/{uid}/{path=**}']);
  assert.deepEqual(blanketPaths('match /users/{uid}/{coll}/{document=**} { }'), []);
});
await check('rules: owner() still checks the signed-in uid and ownerUid()', () => {
  assert.match(flat, /function\s+owner\(uid\)\s*\{\s*return\s+request\.auth\s*!=\s*null\s*&&\s*request\.auth\.uid\s*==\s*uid\s*&&\s*uid\s*==\s*ownerUid\(\)\s*;\s*\}/);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
