import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { earlierTransactionsEnded } from "../support/testDatabase.mjs";
import { createRuntime } from "../../packages/apps/src/server/runtime.js";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";
import { createWatches } from "../../packages/apps/src/server/watches.js";
import { createWebAccess } from "../../packages/apps/src/server/webAccess.js";
import { cleanupStack } from "../support/cleanupStack.mjs";

// Scripts (D-35, owner 2026-10-29: "make it powerful"): saved only with passing tests; buttons,
// screen data, rules on saving, formula functions, jobs on a timetable or a watch, and outside web
// calls to allowed addresses. Everything they write goes through the data gate, audited as them.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("scripts: saving, buttons, data, rules, functions, jobs and the web", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-scripts" });
  const { knex, userId, workspaceId, options } = home;
  // A fake outside service: it echoes what it got, including headers the script never saw.
  const served = [];
  const service = http.createServer((request, response) => {
    served.push(`${request.method} ${request.url}`);
    if (request.url === "/big") return response.end("x".repeat(2 * 1024 * 1024));
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ path: request.url, method: request.method, key: request.headers["x-api-key"] || null, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${service.address().port}`;

  // The parts wired by hand on the home's handles, as the server wires them (appsRuntime.js), except that the registry
  // trusts its cached tables for good and scripts' outside web calls may reach this test's local service.
  // A cycle: the gate runs scripts' rules inside its writes, so it asks for them late.
  let scripts = null;
  // Only the work's own queries are counted here: no refresh of the cached tables after their 5 s (appsRegistry checks that).
  const { resources, repository, registry, gate, apps, practices, systemContext } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args)
  });
  // The live copy's web calls (SIDE_EFFECTS=live, D-69); a test copy's are checked further down.
  const vaultKey = randomBytes(32).toString("base64");
  const web = createWebAccess({ resources, env: { MERCBOT_VAULT_KEY: vaultKey, SIDE_EFFECTS: "live" }, insecure: true });
  scripts = createScripts({ resources, repository, systemContext, notices: home.notices, registry, gate, apps, env: process.env, web });
  const runtime = createRuntime({ apps, gate, scripts, practices });
  const watches = createWatches({ resources, repository, systemContext, notices: home.notices, registry, gate, apps });
  // Before the home's own cleanup (newest first).
  cleanup.after(async () => {
    await scripts.close();
    service.close();
  });

  const actor = { type: "person", id: userId, name: "Pat" };
  const ctx = { options, userId, canManage: true, actor, via: { kind: "data" } };
  await registry.createTable(actor, { key: "deals", fields: [{ key: "title", type: "text", required: true }, { key: "amount", type: "money" }, { key: "stage", type: "choice", choices: ["Open", "Won", "Lost"] }, { key: "ref", type: "text" }] }, options);
  await registry.createTable(actor, { key: "notes", fields: [{ key: "text", type: "text", required: true }] }, options);
  await apps.createApp(actor, { name: "Sales" }, options);
  const save = (input) => scripts.save(actor, "sales", input, options);

  // ---- Saving: only with passing tests ----
  const bonus = {
    key: "close_deal",
    kind: "action",
    summary: "Marks a deal won and logs a note",
    code: `async function main(input) {
      const deal = await records.get("deals", input.id);
      if (!deal) return { notify: "No such deal" };
      await records.update("deals", deal.id, { stage: "Won" });
      await records.create("notes", { text: "Won " + deal.title });
      return { notify: "Closed " + deal.title };
    }`,
    tests: [{ name: "closes", input: { id: "1" }, records: { deals: [{ id: "1", title: "Acme", stage: "Open" }] }, expect: { notify: "Closed Acme" } }]
  };
  const failing = await save({ ...bonus, tests: [{ name: "wrong", input: { id: "1" }, records: { deals: [{ id: "1", title: "Acme" }] }, expect: { notify: "Nope" } }] });
  assert.match(failing.errors[0].message, /1 of 1 tests failed; nothing was saved/u);
  assert.deepEqual(failing.results[0].got, { notify: "Closed Acme" });
  assert.equal(await knex("app_scripts").where({ workspace_id: workspaceId }).count("* as n").first().then((row) => Number(row.n)), 0);
  assert.match(JSON.stringify((await save({ ...bonus, key: "Bad Key", tests: [] })).errors), /key.*tests/su);
  const saved = await save(bonus);
  assert.deepEqual(saved.errors, []);
  assert.equal(saved.script.version, 1);
  assert.equal((await save(bonus)).script.version, 2, "saving again is a new version");

  // ---- A button runs it: its writes go through the gate, audited as the script ----
  const deal = await gate.create(ctx, "deals", { title: "Acme", amount: 120000, stage: "Open" });
  const screens = {
    home: "deals",
    screens: {
      deals: {
        params: { id: { type: "string" } },
        data: { deal: { record: "deals", id: "=params.id" }, ranking: { script: "ranking", input: { stage: "Open" } }, stats: { script: "stats" } },
        content: [
          { type: "button", label: "Close", do: [{ runScript: { script: "close_deal", input: { id: "=data.deal.id" } } }] },
          { type: "button", label: "VAT", do: [{ notify: '="VAT " + string(vat(data.deal.amount))' }] },
          { type: "table", rows: "=data.ranking", columns: [{ label: "Deal", value: "=row.title" }, { label: "Place", value: "=string(row.place)" }] },
          { type: "chart", label: "By stage", kind: "bar", rows: "=data.stats", measure: "count" },
          { type: "text", value: '="Total " + string(data.stats.size())' }
        ]
      },
      board: {
        public: true,
        data: { mine: { script: "ranking", input: { stage: "Open", who: "=visitor.email" } } },
        content: [{ type: "table", rows: "=data.mine", columns: [{ label: "Deal", value: "=row.title" }] }]
      }
    },
    public: { home: "board", tables: { deals: { can: ["list"], rows: "all", read: ["title", "amount", "stage"] } } }
  };
  // The draft check knows the app's scripts: unknown ones are refused, by kind.
  const early = await apps.saveDraft(actor, "sales", screens, "", options);
  const earlyText = early.errors.map((error) => error.message).join("\n");
  assert.match(earlyText, /no source script "ranking"/u);
  assert.match(earlyText, /there is no formula or function "vat"\. This app's: none\./u, "an unknown function is refused, by name");

  assert.deepEqual((await save({
    key: "ranking", kind: "source", summary: "Open deals by size, numbered",
    code: `async function main(input) {
      const rows = await records.list("deals", { where: "=stage == params.stage", params: { stage: input.stage }, sort: "-amount" });
      return rows.map((row, index) => ({ title: row.title, place: index + 1 }));
    }`,
    tests: [{ name: "numbers", input: { stage: "Open" }, records: { deals: [{ title: "A", amount: 5, stage: "Open" }, { title: "B", amount: 9, stage: "Open" }, { title: "C", amount: 7, stage: "Won" }] }, expect: [{ title: "B", place: 1 }, { title: "A", place: 2 }] }]
  })).errors, []);
  // The test stand-in pages like the real thing: a script counting page by page gets it right.
  const many = Array.from({ length: 150 }, (_, index) => ({ title: `D${index}` }));
  const paging = await scripts.test({ key: "count_all", kind: "action", summary: "Counts deals page by page", code: "async function main() { let count = 0; for (let page = 1; ; page += 1) { const rows = await records.list('deals', { limit: 100, page }); count += rows.length; if (rows.length < 100) break } return count }", tests: [{ name: "150", input: {}, records: { deals: many }, expect: 150 }, { name: "100", input: {}, records: { deals: many.slice(0, 100) }, expect: 100 }] }, options);
  assert.deepEqual(paging.results.map((result) => result.passed), [true, true]);
  assert.deepEqual((await save({
    key: "stats", kind: "source", summary: "Deals per stage",
    code: `async function main() {
      const groups = await records.totals("deals", { groupBy: "stage" });
      return groups.map((group) => ({ label: group.key, value: group.count }));
    }`,
    tests: [{ name: "groups", input: null, records: { deals: [{ title: "A", stage: "Open" }, { title: "B", stage: "Open" }] }, expect: [{ label: "Open", value: 2 }] }]
  })).errors, []);
  assert.deepEqual((await save({
    key: "vat", kind: "function", summary: "VAT on an amount in cents", settings: { params: ["amount"] },
    code: "function main(amount) { return Math.round(amount * 0.22) / 100 }",
    tests: [{ name: "22%", input: [10000], expect: 22 }]
  })).errors, []);
  assert.deepEqual((await apps.saveDraft(actor, "sales", screens, "", options)).errors, []);
  await apps.publish(actor, "sales", {}, options);

  const page = { slug: "sales", version: "live", screen: "deals", params: { id: deal.id } };
  assert.deepEqual(await runtime.query(ctx, { ...page, query: "ranking" }), { records: [{ title: "Acme", place: 1 }] });
  // A public screen's script data reaches only what the app's visitor access lists (D-66).
  const visitor = { signedIn: false, email: "" };
  // A visitor's calls run in the home's system context, as the public routes of a copy that serves public apps make them.
  const visitorCtx = { options: home.job, actor: { type: "visitor", id: null, name: "Sales (public form)" }, visitor, access: compile(screens, await registry.loadTables(options), visitor) };
  assert.deepEqual(await runtime.query(visitorCtx, { slug: "sales", screen: "board", query: "mine" }), { records: [{ title: "Acme", place: 1 }] });
  const titlesOnly = compile({ public: { tables: { deals: { can: ["list"], rows: "all", read: ["title"] } } } }, await registry.loadTables(options), visitor);
  await assert.rejects(runtime.query({ ...visitorCtx, access: titlesOnly }, { slug: "sales", screen: "board", query: "mine" }), /Something went wrong.*Visitors can't read/su, "filtering by stage needs stage to be readable");
  await assert.rejects(runtime.query(visitorCtx, { ...page, query: "ranking" }), /That screen doesn't exist/u, "internal screens stay closed to visitors");
  assert.deepEqual((await runtime.query(ctx, { ...page, query: "stats" })).records, [{ label: "Open", value: 1, key: "Open", count: 1, total: 1 }]);
  assert.deepEqual(await runtime.action(ctx, { ...page, path: "content/1/do" }), { effects: [{ notify: "VAT 264" }] }, "a formula calls the script function");
  assert.deepEqual(await runtime.action(ctx, { ...page, path: "content/0/do" }), { effects: [{ notify: "Closed Acme" }] });
  assert.equal((await gate.get(ctx, "deals", deal.id))[(await gate.tableFor("deals", options)).table.fields.find((field) => field.key === "stage").id], "Won");
  const audit = await knex("audit_events").where({ workspace_id: workspaceId, action: "create" }).whereRaw("via->>'kind' = 'script'").first();
  assert.equal(audit.actor.type, "script");
  assert.equal(audit.via.script, "close_deal");
  assert.deepEqual((await runtime.action(ctx, { ...page, version: "draft", path: "content/0/do" })).wouldRun, [{ script: "close_deal", input: { id: deal.id } }], "with no draft to preview, a button runs nothing");
  const runs = await scripts.list("sales", {}, options);
  assert.equal(runs.scripts.find((script) => script.key === "close_deal").runs[0].ok, true);
  // The Scripts tab: every script of the home, with its app and its last run.
  const closeDeal = (await scripts.overview(options)).find((script) => script.key === "close_deal");
  assert.deepEqual([closeDeal.app.slug, closeDeal.lastRun.ok], ["sales", true]);

  // A script past its call budget fails in place, with a friendly message.
  const budget = { ...bonus, key: "greedy", code: "async function main() { for (let i = 0; i < 60; i += 1) await records.list('deals'); return {} }", tests: [{ name: "runs", input: {}, records: {}, expect: {} }] };
  assert.deepEqual((await save(budget)).errors, []);
  await assert.rejects(scripts.runNamed("action", (await apps.find("sales", options)).id, "greedy", {}, { kind: "button" }, null, options), /Something went wrong in “Marks a deal won and logs a note”: Error: at most 50 record calls per run/u);

  // ---- Rules on saving: refuse, or fill in fields, wherever the change comes from ----
  assert.deepEqual((await save({
    key: "deal_rules", kind: "rule", summary: "Big deals need a title of 3+ letters; every deal gets a reference",
    settings: { table: "deals" },
    code: `async function main({ action, record, previous }) {
      if (record.title.length < 3) return { refuse: "A deal's title needs at least 3 letters." };
      if (!record.ref) {
        const all = await records.list("deals", { limit: 100 });
        return { set: { ref: "D-" + (all.length + 1) } };
      }
      return {};
    }`,
    tests: [
      { name: "short", input: { action: "create", record: { title: "AB" }, previous: null }, expect: { refuse: "A deal's title needs at least 3 letters." } },
      { name: "reference", input: { action: "create", record: { title: "Big", ref: null }, previous: null }, records: { deals: [{ title: "Acme" }] }, expect: { set: { ref: "D-2" } } }
    ]
  })).errors, []);
  await assert.rejects(gate.create(ctx, "deals", { title: "AB" }), /at least 3 letters/u);
  const refField = (await gate.tableFor("deals", options)).table.fields.find((field) => field.key === "ref").id;
  const made = await gate.create({ ...ctx, actor: { type: "bot", id: "7", name: "Otto" } }, "deals", { title: "Globex" });
  assert.equal(made[refField], "D-2", "a bot's write gets the rule too");
  await assert.rejects(gate.update(ctx, "deals", made.id, { title: "Gx" }), /at least 3 letters/u);
  const imported = await gate.importRecords(ctx, "deals", [{ [(await gate.tableFor("deals", options)).table.fields[0].id]: "No" }]);
  assert.match(imported.errors[0].message, /at least 3 letters/u, "imports too");
  // A rule on create alone (settings.on) leaves updates be.
  assert.deepEqual((await save({
    key: "no_forbidden", kind: "rule", summary: "New deals can't be called Forbidden",
    settings: { table: "deals", on: ["create"] },
    code: `async function main({ record }) { return record.title === "Forbidden" ? { refuse: "Not that title." } : {} }`,
    tests: [{ name: "refuses", input: { action: "create", record: { title: "Forbidden" }, previous: null }, expect: { refuse: "Not that title." } }]
  })).errors, []);
  await assert.rejects(gate.create(ctx, "deals", { title: "Forbidden" }), /Not that title/u);
  await gate.update(ctx, "deals", made.id, { title: "Forbidden" });
  await gate.update(ctx, "deals", made.id, { title: "Globex" });
  // A broken rule refuses saves rather than letting data past it.
  await knex("app_scripts").where({ workspace_id: workspaceId, key: "deal_rules" }).update({ code: "function main() { return null.x }" });
  await assert.rejects(gate.create(ctx, "deals", { title: "Initech" }), /A rule \(Big deals.*\) failed/u);
  // An owner switches it off: saves go through again; a switched-off button script says so.
  await scripts.setEnabled(actor, "sales", "deal_rules", false, options);
  assert.ok(await gate.create(ctx, "deals", { title: "Initech" }));
  await scripts.setEnabled(actor, "sales", "close_deal", false, options);
  await assert.rejects(runtime.action(ctx, { ...page, path: "content/0/do" }), /switched off/u);
  await scripts.setEnabled(actor, "sales", "close_deal", true, options);

  // ---- Jobs: on a timetable and on a watch, run once ----
  assert.deepEqual((await save({
    key: "nightly", kind: "job", summary: "Counts deals into a note", settings: { every: "day", at: "02:00", timeZone: "Europe/Rome" },
    code: `async function main(input) { const all = await records.list("deals"); await records.create("notes", { text: "Nightly: " + all.length }); return all.length }`,
    tests: [{ name: "counts", input: {}, records: { deals: [{ title: "A" }] }, expect: 1 }]
  })).errors, []);
  const nightly = await knex("app_scripts").where({ workspace_id: workspaceId, key: "nightly" }).first();
  assert.ok(new Date(nightly.next_run_at) > new Date(), "scheduled ahead");
  await knex("app_scripts").where({ id: nightly.id }).update({ next_run_at: new Date(Date.now() - 1000) });
  await scripts.runDue({ matchChanges: watches.matchChanges });
  const afterRun = await knex("app_scripts").where({ id: nightly.id }).first();
  assert.ok(new Date(afterRun.next_run_at) > new Date(), "moved to the next slot");
  assert.equal((await knex("app_script_runs").where({ script_id: nightly.id })).length, 1);
  await scripts.runDue({ matchChanges: watches.matchChanges });
  assert.equal((await knex("app_script_runs").where({ script_id: nightly.id })).length, 1, "not twice");

  // The watch's cursor starts at the database server's transaction horizon, which a transaction
  // open in another test file's database holds back: once every change so far is past it, the
  // watch sees only what follows, and each runDue below sees the change made just before it.
  await earlierTransactionsEnded(knex);
  assert.deepEqual((await save({
    key: "on_won", kind: "job", summary: "Notes every won deal", settings: { watch: { table: "deals", on: "update", condition: '=row.stage == "Won"' } },
    code: `async function main(input) { for (const change of input.changes) await records.create("notes", { text: "Won: " + change.record.title }); return input.changes.length }`,
    tests: [{ name: "notes", input: { changes: [{ record: { title: "A" } }] }, expect: 1 }]
  })).errors, []);
  await gate.update(ctx, "deals", made.id, { amount: 500 }); // not won yet: no match (a condition reads the record as it is now)
  await earlierTransactionsEnded(knex);
  await scripts.runDue({ matchChanges: watches.matchChanges });
  await gate.update(ctx, "deals", made.id, { stage: "Won" });
  await earlierTransactionsEnded(knex);
  for (let round = 0; round < 3; round += 1) await scripts.runDue({ matchChanges: watches.matchChanges });
  const notes = (await gate.read(ctx, "notes")).records.map((record) => Object.values(record).find((value) => typeof value === "string" && /:/u.test(value)));
  assert.ok(notes.includes("Won: Globex"), `the watch ran once for the won change: ${notes}`);
  assert.equal(notes.filter((text) => text === "Won: Globex").length, 1);

  // More changes than one page (1,000): the job hears of every one, the first 100 in full.
  await scripts.setEnabled(actor, "sales", "on_won", false, options);
  await earlierTransactionsEnded(knex);
  assert.deepEqual((await save({
    key: "count_changes", kind: "job", summary: "Notes how many deals changed", settings: { watch: { table: "deals", on: "update" } },
    code: `async function main(input) { const count = input.changes.length + input.more; await records.create("notes", { text: "Changed: " + count }); return count }`,
    tests: [{ name: "counts", input: { changes: [{ record: { title: "A" } }], more: 2 }, expect: 3 }]
  })).errors, []);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const sample = await knex("audit_events").where({ workspace_id: workspaceId, action: "update", record_id: String(made.id) }).first();
  const copy = { workspace_id: workspaceId, actor: sample.actor, via: { kind: "data" }, table_id: sample.table_id, record_id: sample.record_id, action: "update", changes: {} };
  await knex("audit_events").insert(Array.from({ length: 1199 }, () => copy));
  await gate.update(ctx, "deals", made.id, { amount: 600 });
  await earlierTransactionsEnded(knex);
  for (let round = 0; round < 3; round += 1) await scripts.runDue({ matchChanges: watches.matchChanges });
  const counted = (await gate.read(ctx, "notes")).records.flatMap((record) => Object.values(record)).filter((value) => typeof value === "string" && value.startsWith("Changed: "));
  assert.deepEqual(counted, ["Changed: 1200"]);

  // ---- Outside web: allowed addresses only, secret headers added by the server ----
  await assert.rejects(web.set(actor, [{ origin: "not a url" }], options), /isn't an https address/u);
  assert.deepEqual(await web.set(actor, [{ origin, headers: { "X-Api-Key": "s3cret" } }], options), [{ origin, secretHeaders: ["X-Api-Key"] }]);
  assert.deepEqual(await web.set(actor, [{ origin, headers: { "X-Api-Key": null } }], options), [{ origin, secretHeaders: ["X-Api-Key"] }], "null keeps the stored value");
  assert.deepEqual((await save({
    key: "ping", kind: "action", summary: "Asks the outside service",
    code: `async function main() { const answer = await web.fetch("${origin}/hello?x=1", { method: "POST", body: { hi: 1 } }); return { notify: answer.json.key + " " + answer.json.path + " " + answer.json.body.hi } }`,
    tests: [{ name: "answer", input: {}, web: { [`${origin}/hello?x=1`]: { key: "k", path: "/p", body: { hi: 1 } } }, expect: { notify: "k /p 1" } }]
  })).errors, []);
  const appId = (await apps.find("sales", options)).id;
  assert.deepEqual(await scripts.runNamed("action", appId, "ping", {}, { kind: "button" }, null, options), { notify: "s3cret /hello?x=1 1" });
  // A test copy (SIDE_EFFECTS not live, D-69) sends nothing but reads: its POST is logged and answered as done,
  // and the outside service never hears of it, while a GET still reaches it.
  const testCopy = createWebAccess({ resources, env: { MERCBOT_VAULT_KEY: vaultKey }, insecure: true });
  const logged = context.mock.method(console, "info", () => {});
  served.length = 0;
  assert.deepEqual(await testCopy.fetch(`${origin}/hello?x=1`, { method: "POST", body: { hi: 1 } }, options), { status: 200, ok: true, headers: { "content-type": "" }, text: "", json: null, simulated: true });
  assert.deepEqual(served, []);
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments).filter(([fields]) => fields?.sideEffects), [[
    { sideEffects: "simulate", kind: "webhook", method: "POST", origin },
    `Test copy: the script's POST to ${origin}/hello was simulated, not sent (SIDE_EFFECTS is not live).`
  ]]);
  assert.equal((await testCopy.fetch(`${origin}/hello`, {}, options)).json.key, "s3cret");
  assert.deepEqual(served, ["GET /hello"]);
  logged.mock.restore();
  // At most 5 web calls per run, and answers over 1 MB are cut off.
  assert.deepEqual((await save({ key: "chatty", kind: "action", summary: "Calls too often", code: `async function main() { for (let i = 0; i < 6; i += 1) await web.fetch("${origin}/x"); return {} }`, tests: [{ name: "fake", input: {}, web: { [`${origin}/x`]: { ok: 1 } }, expect: {} }] })).errors, []);
  await assert.rejects(scripts.runNamed("action", appId, "chatty", {}, { kind: "button" }, null, options), /at most 5 web calls per run/u);
  assert.deepEqual((await save({ key: "greedy_web", kind: "action", summary: "Reads a big answer", code: `async function main() { await web.fetch("${origin}/big"); return {} }`, tests: [{ name: "fake", input: {}, web: { [`${origin}/big`]: "small" }, expect: {} }] })).errors, []);
  await assert.rejects(scripts.runNamed("action", appId, "greedy_web", {}, { kind: "button" }, null, options), /larger than 1 MB/u);
  await web.set(actor, [], options);
  await assert.rejects(scripts.runNamed("action", appId, "ping", {}, { kind: "button" }, null, options), /isn't on this home's list/u);
  // Without the test switch, http and private addresses are refused even when listed.
  const strict = createWebAccess({ resources, env: {} });
  await knex("app_web_access").insert({ workspace_id: workspaceId, origin: "https://127.0.0.1", created_by: actor });
  await assert.rejects(strict.fetch("https://127.0.0.1/x", {}, options), /private network address/u);
  await assert.rejects(strict.fetch(`${origin}/x`, {}, options), /isn't an https address/u);

  // ---- The Logic tab's list reads every script's latest runs at once, however many scripts there are ----
  const listed = async () => {
    let answer = null;
    const queries = await queriesDuring(knex, async () => { answer = await scripts.list("sales", { runs: 2 }, options); });
    return { answer, queries };
  };
  const before = await listed();
  const extra = Array.from({ length: 10 }, (_, index) => ({
    id: `s_listcost${String(index).padStart(6, "0")}`, workspace_id: workspaceId, app_id: appId, key: `extra_${index}`,
    summary: `Extra ${index}`, code: "async function main() { return {} }", created_by: actor
  }));
  await knex("app_scripts").insert(extra);
  await knex("app_script_runs").insert(extra.flatMap((script) => [1, 2, 3].map((ms) => ({ workspace_id: workspaceId, script_id: script.id, ok: ms !== 3, ms }))));
  const after = await listed();
  assert.equal(after.answer.scripts.length, before.answer.scripts.length + 10);
  assert.deepEqual(after.answer.scripts.find((script) => script.key === "extra_0").runs.map((run) => [run.ms, run.ok]), [[3, false], [2, true]], "the latest runs, newest first");
  assert.ok(after.answer.scripts.every((script) => script.runs.length <= 2));
  assert.equal(after.queries, before.queries, `${after.answer.scripts.length} scripts took ${after.queries} queries, ${before.answer.scripts.length} took ${before.queries}`);
});
