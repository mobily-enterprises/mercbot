import assert from "node:assert/strict";
import test from "node:test";
import { LEAKED_MARKUP, withoutMarkup } from "@jskit-ai/agent/server";

// Raw model markup that leaked into replies in the D-48 evaluations: it's spotted, and people
// only ever see the reply without it.
const leaked = [
  ["I'll look at the CRM app first, then add them.\n\n<parameter name=\"appGet\">{\"slug\":\"crm\"}</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n\nI'll add all three now.", "I'll look at the CRM app first, then add them.\n\nI'll add all three now."],
  ["I'll start by looking at the project files.\n\n<budget:token_budget>200000</budget:token_budget>\n\nI've made the code changes.", "I'll start by looking at the project files.\n\nI've made the code changes."],
  ["Now I'll make the changes.\n\n<｜｜tool▁calls▁begin｜｜><｜｜invoke▁name｜｜>runCommand｜｜invoke｜｜<｜｜parameter▁name｜｜>why｜｜<｜｜parameter｜｜>Rename it｜｜<｜｜/parameter｜｜>\n\nDone.", "Now I'll make the changes.\n\nDone."],
  ["I'll set that up.\n\n<｜begin▁of▁sentence｜>中国福利彩票双色球数字范围\n\nThe draft is saved.", "I'll set that up.\n\nThe draft is saved."],
  ["Checking.\n\n<ds_safety>[分类]其他</ds_safety>### Adding the leads\n\nAll three are in.", "Checking.\n\n### Adding the leads\n\nAll three are in."],
  ["I'll look at the files first.\n\n<parameter name=\"runCommand\">ls -la /files/mine</parameter>\n\nBoth commands work now.", "I'll look at the files first.\n\nBoth commands work now."],
  ["I'll take a look.\n\n<｜place▁holder▁no▁558｜> I've read it.", "I'll take a look.\n\nI've read it."]
];

test("leaked markup is spotted and taken out of what people see", () => {
  for (const [text, shown] of leaked) {
    assert.ok(LEAKED_MARKUP.test(text), text);
    assert.equal(withoutMarkup(text), shown);
    assert.ok(!LEAKED_MARKUP.test(withoutMarkup(text)));
  }
  for (const text of ["Use a <table> in HTML.", "Totals | 12 | 13", "你好！今天怎么样？", "a < b and c > d", "The <param> tag is old."]) {
    assert.ok(!LEAKED_MARKUP.test(text), text);
    assert.equal(withoutMarkup(text), text, "ordinary text is left alone");
  }
});
