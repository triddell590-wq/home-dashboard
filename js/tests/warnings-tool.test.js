// Node only. Ported from tests/test_weather.py (warnings), plus the job's own behaviour.
// Nothing goes online: fetch is injected and Firestore is a fake that records writes.
import { readFileSync } from "node:fs";
import { test, eq, ok } from "./harness.js";
import { parseWarnings, londonStamp } from "../../tools/warnings-rss.mjs";
import { refreshWarnings, main } from "../../tools/warnings.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/weather/${name}`, import.meta.url), "utf8");
const KEYS = ["ends", "headline", "kind", "level", "link", "starts", "title"];

test("test_warnings_none", () => {
  eq(parseWarnings(fixture("warnings_none.xml")), []);
});

test("test_warnings_two", () => {
  const out = parseWarnings(fixture("warnings_two.xml"));
  eq(out.map((w) => w.level), ["yellow", "amber"]);
  eq(out.map((w) => w.kind), ["wind", "rain"]);
  eq(out[0].starts, "2026-11-22T06:00:00+00:00");
  eq(out[0].ends, "2026-11-22T21:00:00+00:00");
  eq([out[1].starts, out[1].ends], [null, null]);
  ok(out[0].title.startsWith("Yellow warning of wind"));
  ok(out[0].link.startsWith("https://www.metoffice.gov.uk/"));
  ok(out[0].link.includes("date=2026-11-22&id=aaa111"), "entities are decoded");
  eq(Object.keys(out[0]).sort(), KEYS);
});

test("test_warning_valid_from_is_case_insensitive", () => {
  const out = parseWarnings(fixture("warnings_two.xml").replace("valid from", "Valid From"));
  eq(out[0].starts, "2026-11-22T06:00:00+00:00");
  eq(out[0].ends, "2026-11-22T21:00:00+00:00");
});

test("test_unmatched_title_is_kept_with_level_found_in_title", () => {
  const xml = fixture("warnings_two.xml");
  const out = parseWarnings(xml.replace("Yellow warning of wind affecting North East England",
    "Met Office: Strong winds affecting North East England - Amber"));
  eq(out.length, 2);
  eq([out[0].level, out[0].kind], ["amber", "weather"]);
  eq(out[0].title, "Met Office: Strong winds affecting North East England - Amber");
  const out2 = parseWarnings(xml.replace("Yellow warning of wind affecting North East England", "Something odd happened"));
  eq([out2[0].level, out2[0].kind], [null, "weather"]);
});

test("test_fetch_failure_raises_weather_error (the XML half)", () => {
  let err = null;
  try { parseWarnings("not xml"); } catch (e) { err = e; }
  ok(err instanceof Error, "expected a throw");
});

test("parseWarnings reads CDATA and rolls the year over in December", () => {
  const xml = `<rss><channel><pubDate>Tue, 30 Dec 2026 10:00:00 GMT</pubDate><item>
    <title><![CDATA[Red warning of snow & ice]]></title><link>https://x/</link>
    <description><![CDATA[Bad. valid from 1800 Wed 30 Dec to 0900 Fri 01 Jan]]></description></item></channel></rss>`;
  const [w] = parseWarnings(xml);
  eq([w.level, w.kind, w.title], ["red", "snow", "Red warning of snow & ice"]);
  eq([w.starts, w.ends], ["2026-12-30T18:00:00+00:00", "2027-01-01T09:00:00+00:00"]);
});

test("londonStamp gives Python's isoformat in both seasons", () => {
  eq(londonStamp(2026, 11, 22, 6, 0), "2026-11-22T06:00:00+00:00");
  eq(londonStamp(2026, 7, 1, 6, 0), "2026-07-01T06:00:00+01:00");
  eq(londonStamp(2026, 11, 31, 6, 0), null);
});

// ---- the job ----
const OWNER = "OWNER";
const NOW = new Date("2026-11-23T08:00:00Z");
function fakeFirestore(docs = {}) {
  const writes = [];
  return {
    writes,
    doc: (path) => ({
      get: async () => ({ exists: path in docs, data: () => docs[path] }),
      set: async (v) => { writes.push([path, v]); docs[path] = v; },
    }),
  };
}
function fakeFetch(text) {
  const f = async (url, opts) => { f.calls.push([url, opts]); return { ok: true, status: 200, text: async () => text }; };
  f.calls = [];
  return f;
}
const placeDoc = (region) => ({ [`users/${OWNER}/settings/weather`]: { place: { name: "Hexham", county: "Northumberland", nation: "England", lat: 54.97, lon: -2.1, region } } });

test("refreshWarnings writes the region's warnings under the owner", async () => {
  const firestore = fakeFirestore(placeDoc("ne"));
  const fetchImpl = fakeFetch(fixture("warnings_two.xml"));
  const res = await refreshWarnings({ firestore, uid: OWNER, fetchImpl, now: NOW });
  eq(res.written, true);
  ok(fetchImpl.calls[0][0].endsWith("/WarningsRSS/Region/ne"));
  eq(fetchImpl.calls[0][1].headers["User-Agent"], "home-dashboard");
  eq(firestore.writes.length, 1);
  const [path, v] = firestore.writes[0];
  eq(path, "users/OWNER/weather/warnings");
  eq([v.region, v.fetchedAt, v.ok, v.items.length], ["ne", NOW.toISOString(), true, 2]);
});

test("refreshWarnings does nothing without a valid region", async () => {
  for (const docs of [{}, placeDoc(null), placeDoc("../x"), { [`users/${OWNER}/settings/weather`]: {} }]) {
    const firestore = fakeFirestore(docs);
    const fetchImpl = fakeFetch("");
    const res = await refreshWarnings({ firestore, uid: OWNER, fetchImpl, now: NOW });
    eq(res, { written: false, message: "No warning region set" });
    eq([fetchImpl.calls.length, firestore.writes.length], [0, 0]);
  }
});

test("a failed fetch keeps the last items for the same region and says so", async () => {
  const prev = { region: "ne", fetchedAt: "2026-11-23T05:00:00.000Z", ok: true, items: [{ level: "red" }] };
  const rejecting = async () => { throw new Error("offline"); };
  let firestore = fakeFirestore({ ...placeDoc("ne"), [`users/${OWNER}/weather/warnings`]: prev });
  const logs = [];
  let res = await refreshWarnings({ firestore, uid: OWNER, fetchImpl: rejecting, now: NOW, log: (m) => logs.push(m) });
  eq(res.written, true);
  eq(firestore.writes[0][1], { region: "ne", ok: false, fetchedAt: prev.fetchedAt, items: prev.items });
  ok(logs.includes("::warning::Met Office warnings couldn't be fetched"));
  firestore = fakeFirestore({ ...placeDoc("sw"), [`users/${OWNER}/weather/warnings`]: prev });
  await refreshWarnings({ firestore, uid: OWNER, fetchImpl: rejecting, now: NOW, log: () => {} });
  eq(firestore.writes[0][1], { region: "sw", ok: false, fetchedAt: null, items: [] });
  firestore = fakeFirestore(placeDoc("ne"));
  await refreshWarnings({ firestore, uid: OWNER, fetchImpl: fakeFetch("not xml"), now: NOW, log: () => {} });
  eq(firestore.writes[0][1].ok, false);
});

test("main exits 0 with a notice when the secret or the owner ID is missing", async () => {
  const rules = (uid) => `function ownerUid() { return "${uid}"; }`;
  let connected = 0;
  const connect = () => { connected++; throw new Error("must not connect"); };
  for (const env of [{}, { FIREBASE_SERVICE_ACCOUNT: " " }]) {
    const logs = [];
    eq(await main({ env, rulesText: rules("abc"), log: (m) => logs.push(m), connect }), 0);
    eq(logs, ["::notice::FIREBASE_SERVICE_ACCOUNT is not set — Met Office warnings were not fetched"]);
  }
  const logs = [];
  eq(await main({ env: { FIREBASE_SERVICE_ACCOUNT: "{}" }, rulesText: rules("REPLACE_WITH_YOUR_UID"), log: (m) => logs.push(m), connect }), 0);
  eq(logs, ["::notice::firestore.rules still has the placeholder owner ID"]);
  eq(connected, 0);
});

test("main connects with the secret, refreshes, and never prints the secret", async () => {
  const secret = '{"private_key":"TOPSECRET"}';
  const firestore = fakeFirestore(placeDoc("ne"));
  const logs = [];
  let got = null;
  const code = await main({
    env: { FIREBASE_SERVICE_ACCOUNT: secret }, rulesText: `function ownerUid() { return "${OWNER}"; }`,
    log: (m) => logs.push(m), connect: async (json) => { got = json; return firestore; },
    fetchImpl: fakeFetch(fixture("warnings_two.xml")), now: NOW,
  });
  eq(code, 0);
  eq(got, secret);
  eq(firestore.writes.length, 1);
  ok(!logs.join("\n").includes("TOPSECRET"));
});
