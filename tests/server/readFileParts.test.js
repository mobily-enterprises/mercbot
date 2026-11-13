import assert from "node:assert/strict";
import test from "node:test";
import { statSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { turnDoubles } from "../support/botDoubles.mjs";

// A long text is read in parts, whole lines at a time, and each cut-off part says where to carry on
// (D-48, as Claude Code's reader does); one over-long line still moves reading on.
test("read_file reads a long text in parts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-read-"));
  const lines = Array.from({ length: 30000 }, (_, index) => `line ${index + 1} ${"x".repeat(20)}`);
  await writeFile(path.join(dir, "big.txt"), lines.join("\n"));
  await writeFile(path.join(dir, "min.json"), `${"{\"a\":1}".repeat(30000)}\n{"b":2}`);
  const files = { store: { existingFile: async (_place, wanted) => ({ real: path.join(dir, path.basename(wanted)), stat: statSync(path.join(dir, path.basename(wanted))) }), list: async () => ({ mine: [], shared: [] }), settle: async () => {} }, apps: { session: () => ({ close() {} }), textOf: async () => null } };
  const { tools } = buildTools(turnDoubles({ approvals: { decide: async () => "allow" }, computer: null, files, homeId: 1, userId: 1, botId: 1, conversationId: 1 }));
  const first = await tools.readFile.execute({ path: "/files/mine/big.txt" });
  assert.equal(first.lines, 30000);
  const next = Number(first.text.match(/from_line: (\d+)/u)[1]);
  assert.ok(first.text.includes("line 1 ") && first.text.includes(`line ${next - 1} `) && !first.text.includes(`line ${next} `));
  const second = await tools.readFile.execute({ path: "/files/mine/big.txt", from_line: next });
  assert.ok(second.text.includes(`line ${next} `), "the next part starts where the first stopped");
  const last = await tools.readFile.execute({ path: "/files/mine/big.txt", from_line: 29999 });
  assert.ok(last.text.includes("line 30000 ") && !last.text.includes("from_line"), "the end says nothing more");
  // Source code and other text files are read too, whatever their type; binary ones aren't.
  await writeFile(path.join(dir, "app.vue"), "<template>\n  <p>{{ hello }}</p>\n</template>\n");
  await writeFile(path.join(dir, "tool.bin"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]));
  assert.match((await tools.readFile.execute({ path: "/files/mine/app.vue" })).text, /<p>\{\{ hello \}\}<\/p>/u);
  assert.match((await tools.readFile.execute({ path: "/files/mine/tool.bin" })).error, /can't read this kind of file/u);
  const minified = await tools.readFile.execute({ path: "/files/mine/min.json" });
  assert.match(minified.text, /from_line: 2/u, "an over-long line is split and reading moves on");
  assert.ok(minified.text.length < 130000);
});
