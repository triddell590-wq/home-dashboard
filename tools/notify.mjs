// Morning reminder sender. cron-job.org starts .github/workflows/notify.yml every hour; this sends at most one
// notification per device per London day, between 07:00 and 21:00, and records the day in reminders/{date}.
// Pushes are DATA-ONLY (no `notification` key): the app's service worker shows them, so there is no duplicate.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { londonDay, londonHourStart } from "../js/core/dom.js";
import { eventsFrom } from "../js/calendar/events.js";
import { buildDigest, digestPayload } from "../js/calendar/digest.js";
import { recordsFrom } from "../js/lessons/records.js";
import { ownerUidFromRules } from "../tests/rules/owner.mjs";
import { refreshWarnings } from "./warnings.mjs";

export const STALE_CLAIM_MS = 30 * 60 * 1000;

export const DEAD = /registration-token-not-registered|invalid-registration-token/i;

export const fcmMessage = (token, { title, body, url = "#/calendar" }) => ({
  token,
  data: { title, body, url, tag: "home-day" },
  webpush: { headers: { Urgency: "high", TTL: "43200" } },
});

const isStaleClaim = (data, now) => !!data && data.status === "sending" && Date.parse(data.claimedAt) <= now.getTime() - STALE_CLAIM_MS;

const asDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export async function runNotify({ firestore, send, uid, now, dryRun = false, argv = [], log = console.log, refresh }) {
  if (!dryRun) {
    try {
      await (refresh ?? (() => refreshWarnings({ firestore, uid, fetchImpl: fetch, now, log })))();
    } catch {
      log("::warning::Met Office warnings couldn't be refreshed");
    }
  }
  const base = { sent: 0, removed: [], errors: [] };
  const D = londonDay(now);
  let stale = false;
  const anyTime = dryRun && argv.includes("--any-time");
  const hour = Number(londonHourStart(now).slice(11, 13));
  const reminderRef = firestore.doc(`users/${uid}/reminders/${D}`);
  if (!anyTime) {
    if (hour < 7) return { ...base, status: "early", exitCode: 0 };
    if (hour >= 21) return { ...base, status: "late", exitCode: 0 };
    const existing = await reminderRef.get();
    if (existing.exists) {
      if (!isStaleClaim(existing.data(), now)) return { ...base, status: "done-already", exitCode: 0 };
      stale = true;
    }
  }

  const [eventSnap, daySnap, settingsSnap, deviceSnap] = await Promise.all([
    firestore.collection(`users/${uid}/events`).get(),
    firestore.collection(`users/${uid}/lessonDays`).get(),
    firestore.doc(`users/${uid}/settings/lessons`).get(),
    firestore.collection(`users/${uid}/devices`).get(),
  ]);
  const records = recordsFrom({ dayDocs: asDocs(daySnap), settingsDoc: settingsSnap.exists ? settingsSnap.data() : null });
  const digest = buildDigest({ events: eventsFrom(asDocs(eventSnap)), records, today: D });
  const devices = asDocs(deviceSnap).filter((d) => typeof d.token === "string" && d.token);

  if (dryRun) {
    log(digest.count ? `${digest.title}\n${digest.lines.join("\n")}` : "Nothing on today — no reminder would be sent");
    return { ...base, status: "dry-run", digest, exitCode: 0 };
  }
  if (digest.count === 0) {
    await reminderRef.set({ sentAt: now.toISOString(), items: [], count: 0, devices: 0, errors: [] });
    return { ...base, status: "nothing", digest, exitCode: 0 };
  }

  if (devices.length === 0) {
    log("::notice::There is something on today, but there are no devices with reminders turned on");
    await reminderRef.set({ sentAt: now.toISOString(), items: digest.items, count: digest.count, devices: 0, errors: [] });
    return { ...base, status: "sent", digest, exitCode: 0 };
  }

  // Claim the day first, so a crash or an overlapping run after the sends can never send twice.
  if (stale) {
    // A run died after claiming. Take the claim over atomically, so two runs can't both do it.
    const won = await firestore.runTransaction(async (tx) => {
      const cur = await tx.get(reminderRef);
      if (!cur.exists || !isStaleClaim(cur.data(), now)) return false;
      tx.set(reminderRef, { status: "sending", claimedAt: now.toISOString() });
      return true;
    });
    if (!won) return { ...base, status: "done-already", exitCode: 0 };
  } else {
    try {
      await reminderRef.create({ status: "sending", claimedAt: now.toISOString() });
    } catch (e) {
      if (e && (e.code === 6 || /already.?exists/i.test(String(e.code)))) return { ...base, status: "done-already", exitCode: 0 };
      throw e;
    }
  }
  const payload = digestPayload(digest);
  const dead = [], errors = [];
  let sent = 0;
  try {
    for (const dev of devices) {
      const res = await send(fcmMessage(dev.token, payload));
      if (res && res.ok) sent++;
      else if (res && res.dead) dead.push(dev.id);
      else errors.push({ device: dev.id, error: String((res && res.error) || "unknown").slice(0, 80) });
    }
  } catch (e) {
    await reminderRef.delete();
    throw e;
  }
  if (sent === 0) {
    await reminderRef.delete();
    log("::error::No reminder could be sent; the next hourly run will try again");
    return { status: "failed", digest, sent, removed: [], errors, exitCode: 1 };
  }
  for (const id of dead) await firestore.doc(`users/${uid}/devices/${id}`).delete();
  await reminderRef.set({ sentAt: now.toISOString(), items: digest.items, count: digest.count, devices: sent, errors });
  return { status: "sent", digest, sent, removed: dead, errors, exitCode: 0 };
}

async function connectAdmin(json) {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getMessaging } = await import("firebase-admin/messaging");
  let cred = JSON.parse(json);
  initializeApp({ credential: cert(cred), projectId: cred.project_id });
  cred = null;
  const messaging = getMessaging();
  const send = async (message) => {
    try {
      await messaging.send(message);
      return { ok: true };
    } catch (e) {
      const code = typeof e?.code === "string" ? e.code : "unknown";
      return { ok: false, error: code, dead: DEAD.test(code) };
    }
  };
  return { firestore: getFirestore(), send };
}

export async function main({ env = process.env, argv = process.argv.slice(2), rulesText, log = console.log, connect = connectAdmin, now = new Date() } = {}) {
  try {
    const secret = env.FIREBASE_SERVICE_ACCOUNT;
    if (!secret || !secret.trim()) {
      log("::notice::FIREBASE_SERVICE_ACCOUNT is not set — reminders were not sent");
      return 0;
    }
    const uid = ownerUidFromRules(rulesText ?? readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"));
    if (uid === "REPLACE_WITH_YOUR_UID") {
      log("::notice::firestore.rules still has the placeholder owner ID");
      return 0;
    }
    try { JSON.parse(secret); } catch {
      log("::error::FIREBASE_SERVICE_ACCOUNT is not valid JSON (contents not shown)");
      return 1;
    }
    let conn;
    try { conn = await connect(secret); } catch {
      log("::error::FIREBASE_SERVICE_ACCOUNT could not be used. Check it holds the whole key file.");
      return 1;
    }
    const res = await runNotify({ firestore: conn.firestore, send: conn.send, uid, now, dryRun: argv.includes("--dry-run"), argv, log });
    log(`Reminder status: ${res.status} (sent ${res.sent}, removed ${res.removed.length}, errors ${res.errors.length})`);
    return res.exitCode;
  } catch {
    log("::error::The reminder job failed unexpectedly (details not shown)");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
