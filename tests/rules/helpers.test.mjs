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
await check('reads the placeholder from the committed rules file', () => {
  assert.equal(owner.ownerUidFromRules(rulesText), 'REPLACE_WITH_YOUR_UID');
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
await check('no java -> skip with the exact message, exit 0', () => {
  assert.deepEqual(run.decideJavaAction({ status: 1 }), { run: false, message: 'Java not found — rules tests run on GitHub', exitCode: 0 });
  assert.deepEqual(run.decideJavaAction({ error: new Error('ENOENT') }), { run: false, message: 'Java not found — rules tests run on GitHub', exitCode: 0 });
});
await check('java present -> run the emulator', () => {
  assert.equal(run.decideJavaAction({ status: 0 }).run, true);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
