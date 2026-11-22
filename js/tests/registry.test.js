import { createRegistry } from "../core/registry.js";
import { eq, ok, test } from "./harness.js";

test("cards, tabs and day parts come back in order", () => {
  const r = createRegistry();
  r.registerCard({ id: "c", order: 30 });
  r.registerCard({ id: "a", order: 10 });
  r.registerCard({ id: "b", order: 20 });
  eq(r.cards().map((c) => c.id), ["a", "b", "c"]);
  r.registerTab({ id: "lab", order: 50 });
  r.registerTab({ id: "overview", order: 10 });
  eq(r.tabs().map((t) => t.id), ["overview", "lab"]);
  r.registerDayPart({ id: "picks", order: 20 });
  r.registerDayPart({ id: "market", order: 10 });
  eq(r.dayParts().map((p) => p.id), ["market", "picks"]);
});

test("a duplicate id is refused", () => {
  const r = createRegistry();
  r.registerCard({ id: "money", order: 10 });
  let message = "";
  try {
    r.registerCard({ id: "money", order: 20 });
  } catch (err) {
    message = err.message;
  }
  ok(message === "duplicate id: money", `got "${message}"`);
});
