import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Scripts belong to an app's draft (D-139): a script saved runs in the draft's preview only, until publishing makes it
// live; changing or taking one away in the draft leaves the live one running until then; a draft's rule holds only in its
// preview; restoring a version brings back the scripts it went live with.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const greeting = (text) => ({
  key: "greet", kind: "action", summary: "Greets", code: `async function main() { return { notify: "${text}" } }`,
  tests: [{ name: "says it", input: {}, expect: { notify: text } }]
});
const NO_GOLD = {
  key: "no_gold", kind: "rule", summary: "No gold", settings: { table: "notes", on: ["create"] },
  code: `async function main(input) { return input.record.text === "gold" ? { refuse: "No gold here." } : {} }`,
  tests: [{ name: "gold", input: { action: "create", record: { text: "gold" } }, expect: { refuse: "No gold here." } }]
};

test("scripts are the draft's until it's published; a version's scripts come back with it", async (context) => {
  const home = await appsHome(context, { slug: "apps-script-drafts" });
  const { options } = home;
  const { registry, gate, apps, scripts, practices } = home.apps;
  const owner = { type: "person", id: String(home.userId), name: "Pat" };
  const ctx = home.ctx(owner);
  await registry.createTable(owner, { key: "notes", fields: [{ key: "text", type: "text" }] }, options);
  const app = await apps.createApp(owner, { name: "Notes" }, options);
  const saved = async (input) => assert.deepEqual((await scripts.save(owner, "notes", input, options)).errors, []);
  const live = () => scripts.runNamed("action", app.id, "greet", {}, { kind: "button" }, null, options).then((result) => result.notify);
  const preview = async () => {
    const draftId = (await apps.find("notes", options)).draftVersionId;
    const practice = await practices.of(app, draftId, options);
    return (await scripts.runNamed("action", app.id, "greet", {}, { kind: "button" }, { practice }, options)).notify;
  };
  const shown = async () => (await scripts.list("notes", {}, options)).scripts.map((script) => [script.key, script.draft ?? "live", script.live]);

  await saved(greeting("v1"));
  assert.ok((await apps.find("notes", options)).draftVersionId, "saving a script starts a draft");
  await assert.rejects(live(), { code: "apps_script_kind_missing" }, "not live yet");
  assert.equal(await preview(), "v1", "the draft's preview runs it");
  assert.deepEqual(await shown(), [["greet", "changed", false]]);

  const first = await apps.publish(owner, "notes", {}, options);
  assert.equal(await live(), "v1", "published, it's live");
  assert.deepEqual(await shown(), [["greet", "live", true]]);

  await saved(greeting("v2"));
  assert.equal(await live(), "v1", "the live app keeps the published script");
  assert.equal(await preview(), "v2");
  assert.deepEqual(await shown(), [["greet", "changed", true]]);
  await apps.publish(owner, "notes", {}, options);
  assert.equal(await live(), "v2");

  await scripts.remove(owner, "notes", "greet", options);
  assert.equal(await live(), "v2", "taken away in the draft, it runs on live");
  assert.deepEqual(await shown(), [["greet", "removed", true]]);
  await apps.publish(owner, "notes", {}, options);
  await assert.rejects(live(), { code: "apps_script_kind_missing" }, "gone once published");

  await apps.restore(owner, "notes", first.versionId, {}, options);
  assert.equal(await live(), "v1", "restoring version 1 brings its script back");

  // A draft's rule holds in its preview only, until it's published.
  await saved(NO_GOLD);
  await gate.create(ctx, "notes", { text: "gold" });
  const draftId = (await apps.find("notes", options)).draftVersionId;
  const practice = await practices.of(app, draftId, options);
  const previewCtx = { ...ctx, via: { kind: "screen", appId: app.id }, practice };
  await assert.rejects(gate.create(previewCtx, "notes", { text: "gold" }), /No gold here/u, "the preview keeps the draft's rule");
  await apps.publish(owner, "notes", {}, options);
  await assert.rejects(gate.create(ctx, "notes", { text: "gold" }), /No gold here/u, "published, every save keeps it");
});
