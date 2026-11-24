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
const stripped = rulesText.replace(/\/\/.*$/gm, '');
await check('rules: trading paths are read-only for the owner', () => {
  assert.match(stripped, /\[\s*'trading'\s*,\s*'tradingTickers'\s*,\s*'tradingPicks'\s*\]/);
  assert.match(stripped, /allow read:\s*if owner\(uid\)\s*;/);
  assert.match(stripped, /allow write:\s*if owner\(uid\)\s*&&\s*!\(coll in \[/);
});
await check('rules: the user document itself stays read/write for the owner', () => {
  assert.match(stripped, /match \/users\/\{uid\}\s*\{\s*allow read, write:\s*if owner\(uid\)\s*;/);
});
await check('rules: no blanket owner write remains on users/{uid}/{document=**}', () => {
  assert.doesNotMatch(stripped, /users\/\{uid\}\/\{document=\*\*\}/);
});
await check('rules: owner() still checks the signed-in uid and ownerUid()', () => {
  assert.match(stripped, /function owner\(uid\)\s*\{\s*return request\.auth != null\s*&&\s*request\.auth\.uid == uid\s*&&\s*uid == ownerUid\(\);\s*\}/);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
