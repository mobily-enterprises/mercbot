import assert from "node:assert/strict";
import test from "node:test";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { runFunction } from "../../packages/apps/src/shared/sandbox.js";
import { createScriptPool } from "../../packages/apps/src/server/scriptPool.js";
import { __testables as webAccessTestables, createWebAccess } from "../../packages/apps/src/server/webAccess.js";
import { __testables as scriptsTestables } from "../../packages/apps/src/server/scripts.js";

const { isPrivateAddress, originOf } = webAccessTestables;
const { nextSlot } = scriptsTestables;

// The script sandbox (D-35): runaway scripts are stopped without affecting the server, only JSON
// crosses, host calls are answered one at a time, and the pool keeps working afterwards.
test("scripts run sealed off, and runaway ones are stopped", async (context) => {
  const pool = createScriptPool({ warm: 1, size: 2 });
  context.after(() => pool.close());
  const calls = [];
  const run = (code, extra = {}) => pool.run({ code, input: { n: 3 }, cpuMs: 300, memory: 16 * 1024 * 1024, wallMs: 3000, host: { records: { list: true } }, call: async (group, name, args) => {
    calls.push([group, name, args]);
    return [{ id: "1", name: args[0] }];
  }, ...extra });
  const failure = async (code, pattern, extra) => assert.match((await run(code, extra).catch((error) => error)).message, pattern);

  const ok = await run("async function main(input) { console.log('n is', input.n); const rows = await records.list('people'); return { double: input.n * 2, first: rows[0].name } }");
  assert.deepEqual(ok.value, { double: 6, first: "people" });
  assert.deepEqual(ok.logs, ["n is 3"]);
  assert.equal(ok.calls, 1);
  assert.deepEqual(calls, [["records", "list", ["people"]]]);
  assert.equal((await run("function main(input) { return input.n + 1 }")).value, 4, "a plain main works too");

  await failure("function main() { for (;;) {} }", /ran too long/u);
  await failure("function main() { const deeper = (n) => deeper(n + 1) + 1; return deeper(0) }", /too deep/u);
  await failure("function main() { return 'x'.repeat(64 * 1024 * 1024) }", /memory|too long/u);
  await failure("async function main() { await new Promise(() => {}) }", /never happens/u);
  await failure("function main() { return /(a+)+$/.test('a'.repeat(40) + 'b') }", /ran too long/u);
  await failure("const x = 1", /function called main/u);
  await failure("function main( {", /SyntaxError/u);
  await failure("async function main() { return await records.missing() }", /not a function/u);
  // The server's own objects aren't there: no require, process or network.
  assert.deepEqual((await run("function main() { return [typeof require, typeof process, typeof fetch, typeof setTimeout] }")).value, ["undefined", "undefined", "undefined", "undefined"]);
  assert.deepEqual((await run("function main() { return { when: new Date(0), fn: () => 1, list: [1, undefined] } }")).value, { when: "1970-01-01T00:00:00.000Z", list: [1, null] }, "only JSON comes back");
  // Running out of time while answers keep coming is "ran too long", not "never happens".
  await failure("async function main() { let n = 0; for (;;) { n += (await records.list('x')).length; for (let i = 0; i < 2000; i += 1) n += i } }", /ran too long/u);
  // A worker stuck past its wall time is replaced; the next run still works.
  await failure("async function main() { await records.list('slow') }", /longer than 1 seconds/u, { wallMs: 1000, call: () => new Promise(() => {}) });
  assert.equal((await run("function main() { return 'fine' }")).value, "fine");
});

test("formula functions are pure, quick and synchronous", async () => {
  const quickjs = await newQuickJSWASMModuleFromVariant(variant);
  assert.equal(runFunction(quickjs, "function main(amount) { return Math.round(amount * 0.22) }", [1000]), 220);
  assert.throws(() => runFunction(quickjs, "function main() { for (;;) {} }", []), /ran too long/u);
  assert.throws(() => runFunction(quickjs, "async function main() { return 1 }", []), /can't be async/u);
  assert.throws(() => runFunction(quickjs, "function main() { return records.list() }", []), /'records' is not defined/u);
});

test("a script's call to a listed IPv6 address of the private network is refused before connecting", async () => {
  // Each origin is on the home's list, so only the private address check stands in the way.
  const resources = { appWebAccess: { queryAll: async () => [{ headers: null }] }, auditEvents: {} };
  const web = createWebAccess({ resources, env: {} });
  for (const [address, host] of [["https://[::1]/x", "::1"], ["https://[::ffff:127.0.0.1]/x", "::ffff:7f00:1"], ["https://[fe80::1]/x", "fe80::1"]]) {
    await assert.rejects(web.fetch(address, {}, {}), { message: `${host} is a private network address` }, address);
  }
});

test("web addresses and timetables", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "0.0.0.0"]) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:808:808"]) assert.equal(isPrivateAddress(address), false, address);
  assert.equal(originOf("https://api.example.com/v1/x?y=1"), "https://api.example.com");
  assert.equal(originOf("ftp://example.com"), null);
  const from = new Date("2026-10-29T10:15:00Z");
  assert.equal(nextSlot({ every: "hour", at: "00:30" }, from).toISOString(), "2026-10-29T10:30:00.000Z");
  assert.equal(nextSlot({ every: "hour", at: "00:00" }, from).toISOString(), "2026-10-29T11:00:00.000Z");
  assert.equal(nextSlot({ every: "day", at: "08:00", timeZone: "Europe/Rome" }, from).toISOString(), "2026-10-30T07:00:00.000Z", "08:00 in Rome is 07:00 UTC in winter");
  assert.equal(nextSlot({ every: "day", at: "12:00", timeZone: "Europe/Rome" }, from).toISOString(), "2026-10-29T11:00:00.000Z");
  assert.equal(nextSlot({ every: "week", day: 1, at: "09:00", timeZone: "UTC" }, from).toISOString(), "2026-11-02T09:00:00.000Z", "the next Monday");
});

test("more timetables: every 15 minutes, chosen weekdays, monthly on a day or the last day (D-140)", async () => {
  const { jobSchedule } = await import("../../packages/apps/src/shared/schedules.js");
  const { createScriptChecks } = await import("../../packages/apps/src/server/scriptChecks.js");
  const at = (iso) => new Date(iso);
  assert.equal(nextSlot({ every: "15min" }, at("2026-11-27T10:07:12Z")).toISOString(), "2026-11-27T10:15:00.000Z");
  assert.equal(nextSlot({ every: "15min" }, at("2026-11-27T10:45:00Z")).toISOString(), "2026-11-27T11:00:00.000Z", "never the moment it is");
  // Friday 27 November 2026, 10:00 UTC: weekdays at 08:00 next run Monday; Friday and Saturday's next is Saturday.
  assert.equal(nextSlot({ every: "day", days: [1, 2, 3, 4, 5], at: "08:00" }, at("2026-11-27T10:00:00Z")).toISOString(), "2026-11-30T08:00:00.000Z");
  assert.equal(nextSlot({ every: "day", days: [5, 6], at: "08:00" }, at("2026-11-27T10:00:00Z")).toISOString(), "2026-11-28T08:00:00.000Z");
  assert.equal(nextSlot({ every: "month", dayOfMonth: 1, at: "09:00" }, at("2026-11-27T10:00:00Z")).toISOString(), "2026-12-01T09:00:00.000Z");
  assert.equal(nextSlot({ every: "month", dayOfMonth: "last", at: "17:00" }, at("2026-01-31T18:00:00Z")).toISOString(), "2026-02-28T17:00:00.000Z", "February's last day");
  assert.equal(nextSlot({ every: "month", dayOfMonth: "last", at: "17:00", timeZone: "Australia/Perth" }, at("2026-11-27T10:00:00Z")).toISOString(), "2026-11-30T09:00:00.000Z", "17:00 in Perth");

  assert.equal(jobSchedule({ every: "15min" }), "Every 15 minutes");
  assert.equal(jobSchedule({ every: "day", days: [1, 2, 3, 4, 5], at: "08:00" }), "Every weekday at 08:00 (UTC)");
  assert.equal(jobSchedule({ every: "day", days: [0, 6], at: "10:00", timeZone: "Europe/Rome" }), "Every Sunday, Saturday at 10:00 (Europe/Rome)");
  assert.equal(jobSchedule({ every: "month", dayOfMonth: "last", at: "17:00" }), "Every month on the last day at 17:00 (UTC)");

  const { checkScript } = createScriptChecks({ pool: null, ready: null });
  const job = (settings) => checkScript({ key: "tidy", kind: "job", summary: "Tidies", code: "async function main() {}", tests: [{}], settings }, []);
  assert.deepEqual(job({ every: "day", days: [5, 1, 1], at: "08:00" }).settings.days, [1, 5]);
  assert.equal(job({ every: "month", dayOfMonth: "last", at: "08:00" }).settings.dayOfMonth, "last");
  assert.match(JSON.stringify(job({ every: "week", days: [1] }).errors), /with every day, the weekdays/u);
  assert.match(JSON.stringify(job({ every: "month", dayOfMonth: 31 }).errors), /1 to 28, or \\"last\\"/u);
  assert.match(JSON.stringify(job({ every: "minute" }).errors), /every 15min, hour, day, week or month/u);
});

test("a script's saved tests sort a list as a live run does, a sort given as a list too", async (context) => {
  const pool = createScriptPool({ warm: 1, size: 1 });
  context.after(() => pool.close());
  const { createScriptChecks } = await import("../../packages/apps/src/server/scriptChecks.js");
  const { runTests } = createScriptChecks({ pool, ready: null });
  const tables = [{ key: "deals", label: "Deals", obsolete: false, fields: [{ key: "amount", label: "Amount", type: "number", options: {}, obsolete: false }] }];
  const code = "async function main(input) { return (await records.list('deals', { sort: input.sort })).map((deal) => deal.amount) }";
  const records = { deals: [{ amount: 1 }, { amount: 3 }, { amount: 2 }] };
  const results = await runTests({ kind: "action", code, tests: [
    { name: "text", input: { sort: "-amount" }, records, expect: [3, 2, 1] },
    { name: "list", input: { sort: ["-amount"] }, records, expect: [3, 2, 1] }
  ] }, tables);
  assert.deepEqual(results, [{ name: "text", passed: true }, { name: "list", passed: true }]);
});

// A program on the computer (D-146) keeps its own time limit: while a script waits for one, its wall clock stands still,
// and it runs on once the answer comes; any other call's wait counts.
test("a script's wall clock stops while the computer runs its program", async (context) => {
  const pool = createScriptPool({ warm: 1, size: 1 });
  context.after(() => pool.close());
  const slow = () => new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0 }), 600));
  const run = (group) => pool.run({
    code: `async function main() { const answer = await ${group}.run(); return answer.exitCode; }`,
    input: null, cpuMs: 300, memory: 16 * 1024 * 1024, wallMs: 300, untimed: ["computer"],
    host: { [group]: { run: true } }, call: slow
  });
  assert.equal((await run("computer")).value, 0);
  await assert.rejects(run("web"), /longer than 0 seconds/u);
});
