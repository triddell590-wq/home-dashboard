// Hourly job: fetches the Met Office warnings for the weather place and writes them to Firestore.
// Runs from .github/workflows/warnings.yml; refreshWarnings is also exported for the calendar sender.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { REGIONS } from "../js/weather/text.js";
import { ownerUidFromRules } from "../tests/rules/owner.mjs";
import { WARNINGS_URL, parseWarnings } from "./warnings-rss.mjs";

const FETCH_FAILED = "::warning::Met Office warnings couldn't be fetched";

export async function refreshWarnings({ firestore, uid, fetchImpl = fetch, now = new Date(), log = console.log }) {
  const settings = await firestore.doc(`users/${uid}/settings/weather`).get();
  const region = settings.exists ? settings.data()?.place?.region : null;
  if (typeof region !== "string" || !Object.hasOwn(REGIONS, region)) return { written: false, message: "No warning region set" };

  const ref = firestore.doc(`users/${uid}/weather/warnings`);
  const fetchedAt = now.toISOString();
  try {
    const res = await fetchImpl(WARNINGS_URL + region, {
      headers: { "User-Agent": "home-dashboard" }, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseWarnings(await res.text());
    await ref.set({ region, fetchedAt, ok: true, items });
    return { written: true, message: `Wrote ${items.length} warning(s) for ${region}` };
  } catch {
    const prev = await ref.get();
    const old = prev.exists ? prev.data() : null;
    const same = old && old.region === region;
    await ref.set({ region, ok: false, fetchedAt: same ? old.fetchedAt ?? null : null, items: same && Array.isArray(old.items) ? old.items : [] });
    log(FETCH_FAILED);
    return { written: true, message: "Met Office warnings couldn't be fetched" };
  }
}

async function connectAdmin(serviceAccountJson) {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
  return getFirestore();
}

export async function main({ env = process.env, rulesText, log = console.log, connect = connectAdmin, fetchImpl, now } = {}) {
  const secret = env.FIREBASE_SERVICE_ACCOUNT;
  if (!secret || !secret.trim()) {
    log("::notice::FIREBASE_SERVICE_ACCOUNT is not set — Met Office warnings were not fetched");
    return 0;
  }
  const uid = ownerUidFromRules(rulesText ?? readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"));
  if (uid === "REPLACE_WITH_YOUR_UID") {
    log("::notice::firestore.rules still has the placeholder owner ID");
    return 0;
  }
  let firestore;
  try {
    firestore = await connect(secret);
  } catch {
    log("::error::FIREBASE_SERVICE_ACCOUNT could not be used. Check it holds the whole key file.");
    return 1;
  }
  const { message } = await refreshWarnings({ firestore, uid, fetchImpl, now, log });
  log(message);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
