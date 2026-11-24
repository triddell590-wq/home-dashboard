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
    // One Firestore instance per context: calling ctx.firestore() again re-applies emulator settings and throws.
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${INTRUDER}/settings/profile`), { name: 'seeded' });
    await setDoc(doc(db, `users/${OWNER}/trading/today`), { day: '2026-11-20' });
    await setDoc(doc(db, `users/${OWNER}/tradingTickers/AAPL`), { ticker: 'AAPL' });
    await setDoc(doc(db, `users/${OWNER}/tradingPicks/2026-11-20`), { day: '2026-11-20' });
    await setDoc(doc(db, `users/${OWNER}/trading/today/x/y`), { a: 1 });
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

test('owner can read trading/today', async () => {
  await assertSucceeds(getDoc(doc(asOwner(), `users/${OWNER}/trading/today`)));
});

test('owner cannot write trading/today', async () => {
  await assertFails(setDoc(doc(asOwner(), `users/${OWNER}/trading/today`), { day: 'x' }));
});

test('owner cannot write tradingTickers/AAPL', async () => {
  await assertFails(setDoc(doc(asOwner(), `users/${OWNER}/tradingTickers/AAPL`), { ticker: 'x' }));
});

test('owner cannot delete tradingPicks/2026-11-20', async () => {
  await assertFails(deleteDoc(doc(asOwner(), `users/${OWNER}/tradingPicks/2026-11-20`)));
});

test('owner can still write settings/trading', async () => {
  await assertSucceeds(setDoc(doc(asOwner(), `users/${OWNER}/settings/trading`), { topN: 3, watchlist: [], secContact: null }));
});

test('another user cannot read trading/today', async () => {
  await assertFails(getDoc(doc(asIntruder(), `users/${OWNER}/trading/today`)));
});

test('owner cannot write a nested path under trading (trading/today/x/y)', async () => {
  await assertFails(setDoc(doc(asOwner(), `users/${OWNER}/trading/today/x/y`), { a: 2 }));
  await assertSucceeds(getDoc(doc(asOwner(), `users/${OWNER}/trading/today/x/y`)));
});

test('a tradingX collection is an ordinary owner collection (read and write)', async () => {
  const ref = doc(asOwner(), `users/${OWNER}/tradingX/a`);
  await assertSucceeds(setDoc(ref, { a: 1 }));
  await assertSucceeds(getDoc(ref));
});

test('owner can read and write the users/{OWNER} document itself', async () => {
  const ref = doc(asOwner(), `users/${OWNER}`);
  await assertSucceeds(setDoc(ref, { seen: true }));
  await assertSucceeds(getDoc(ref));
});

test('owner can read and write non-settings collections (lessonDays, events)', async () => {
  for (const path of [`users/${OWNER}/lessonDays/2026-11-20`, `users/${OWNER}/events/e1`]) {
    const ref = doc(asOwner(), path);
    await assertSucceeds(setDoc(ref, { a: 1 }));
    await assertSucceeds(getDoc(ref));
  }
});
