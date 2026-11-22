import { moreIsActive, splitTabs } from "../core/tabbar.js";
import { eq, ok, test } from "./harness.js";

const make = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}` }));

test("splitTabs keeps up to five tabs in the bar", () => {
  const two = splitTabs(make(2));
  eq([two.bar.length, two.more.length], [2, 0]);
  const five = splitTabs(make(5));
  eq([five.bar.length, five.more.length], [5, 0]);
});

test("splitTabs moves the overflow into More, leaving room for the More button", () => {
  const six = splitTabs(make(6));
  eq([six.bar.length, six.more.length], [4, 2]);
  eq(six.more.map((t) => t.id), ["t5", "t6"]);
});

test("moreIsActive is true only for an id inside More", () => {
  const { more } = splitTabs(make(6));
  ok(moreIsActive(more, "t5"));
  ok(!moreIsActive(more, "t1"));
  ok(!moreIsActive([], "t1"));
});
