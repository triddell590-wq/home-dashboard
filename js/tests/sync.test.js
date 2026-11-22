import { syncText } from "../core/sync-status.js";
import { eq, test } from "./harness.js";

test("syncText says so when offline or when writes are waiting", () => {
  eq(syncText({ online: false, pending: false }), "Offline — changes will sync");
  eq(syncText({ online: true, pending: true }), "Offline — changes will sync");
  eq(syncText({ online: false, pending: true }), "Offline — changes will sync");
});

test("syncText is null when online with nothing waiting", () => {
  eq(syncText({ online: true, pending: false }), null);
});
