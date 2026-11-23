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

export const DEAD = /registration-token-not-registered|invalid-registration-token|invalid-argument|not-found|unregistered/i;

export const fcmMessage = (token, { title, body, url = "#/calendar" }) => ({
  token,
  data: { title, body, url, tag: "home-day" },
  webpush: { headers: { Urgency: "high", TTL: "43200" } },
});

const asDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export async function runNotify({ firestore, send, uid, now, dryRun = false, argv = [], log = console.log, refresh }) {
  try {
    await (refresh ?? (() => refreshWarnings({ firestore, uid, fetchImpl: fetch, now, log })))();
  } catch {
    log("::warning::Met Office warnings couldn't be refreshed");
  }
  const base = { sent: 0, removed: [], errors: [] };
  const D = londonDay(now);
  const anyTime = dryRun && argv.includes("--any-time");
  const hour = Number(londonHourStart(now).slice(11, 13));
  const reminderRef = firestore.doc(`users/${uid}/reminders/${D}`);
  if (!anyTime) {
    if (hour < 7) return { ...base, status: "early", exitCode: 0 };
    if (hour >= 21) return { ...base, status: "late", exitCode: 0 };
    if ((await reminderRef.get()).exists) return { ...base, status: "done-already", exitCode: 0 };
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

  const payload = digestPayload(digest);
  const removed = [], errors = [];
  let sent = 0;
  for (const dev of devices) {
    const res = await send(fcmMessage(dev.token, payload));
    if (res && res.ok) sent++;
    else if (res && res.dead) { await firestore.doc(`users/${uid}/devices/${dev.id}`).delete(); removed.push(dev.id); }
    else errors.push({ device: dev.id, error: String((res && res.error) || "unknown").slice(0, 80) });
  }
  if (sent === 0 && errors.length) {
    log("::error::No reminder could be sent; the next hourly run will try again");
    return { status: "failed", digest, sent, removed, errors, exitCode: 1 };
  }
  await reminderRef.set({ sentAt: now.toISOString(), items: digest.items, count: digest.count, devices: sent, errors });
  return { status: "sent", digest, sent, removed, errors, exitCode: 0 };
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
