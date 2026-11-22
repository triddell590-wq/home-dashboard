// Firestore rules tests. Run inside the emulator by tests/rules/run.mjs.
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { ownerUidFromRules } from './owner.mjs';

const rulesText = readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8');
const OWNER = ownerUidFromRules(rulesText);
const INTRUDER = 'intruder';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-home-dashboard',
    firestore: { rules: rulesText, host: '127.0.0.1', port: 8080 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${INTRUDER}/settings/profile`), { name: 'seeded' });
  });
});

after(async () => { await env?.cleanup(); });

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asIntruder = () => env.authenticatedContext(INTRUDER).firestore();
const signedOut = () => env.unauthenticatedContext().firestore();

test('owner can write and read their own settings/profile', async () => {
  const ref = doc(asOwner(), `users/${OWNER}/settings/profile`);
  await assertSucceeds(setDoc(ref, { name: 'Tom' }));
  await assertSucceeds(getDoc(ref));
});

test('signed-out visitor cannot read the owner profile', async () => {
  await assertFails(getDoc(doc(signedOut(), `users/${OWNER}/settings/profile`)));
});

test('another user cannot read the owner profile', async () => {
  await assertFails(getDoc(doc(asIntruder(), `users/${OWNER}/settings/profile`)));
});

test('another user cannot write their own path (not the owner)', async () => {
  await assertFails(setDoc(doc(asIntruder(), `users/${INTRUDER}/settings/profile`), { name: 'x' }));
});

test('owner cannot read another user\'s profile', async () => {
  await assertFails(getDoc(doc(asOwner(), `users/${INTRUDER}/settings/profile`)));
});

test('owner cannot write another user\'s path', async () => {
  await assertFails(setDoc(doc(asOwner(), `users/${INTRUDER}/settings/profile`), { name: 'x' }));
});

test('owner can list and delete on their own path', async () => {
  const db = asOwner();
  const ref = doc(db, `users/${OWNER}/settings/scratch`);
  await assertSucceeds(setDoc(ref, { a: 1 }));
  await assertSucceeds(getDocs(collection(db, `users/${OWNER}/settings`)));
  await assertSucceeds(deleteDoc(ref));
});

test('signed-out visitor cannot write the owner profile', async () => {
  await assertFails(setDoc(doc(signedOut(), `users/${OWNER}/settings/profile`), { name: 'x' }));
});

test('another user cannot write the owner profile', async () => {
  await assertFails(setDoc(doc(asIntruder(), `users/${OWNER}/settings/profile`), { name: 'x' }));
});

test('owner cannot write a top-level path', async () => {
  await assertFails(setDoc(doc(asOwner(), 'public/x'), { a: 1 }));
});
