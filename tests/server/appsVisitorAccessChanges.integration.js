import assert from "node:assert/strict";
import test from "node:test";
import { startApps } from "../support/appsFeatures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { __testables as anyapiTestables } from "../../packages/apps/src/server/anyapi.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";
import { toIds, toNames } from "../../packages/apps/src/shared/definitions.js";
import { isListed, listedStored } from "../../packages/apps/src/shared/visitorAccess.js";

const { tenantOf } = anyapiTestables;

// Changing visitor access (D-66, design 3.4): apps on the earlier visitor rules, listed as the server lists them
// (what their public screens use, reaching exactly what they reached), and a public screen's data script asking a
// person to check the list. Then restoring, narrowing, and publishing wider access on a public app. The apps features
// run as the server starts them (tests/support/appsFeatures.mjs).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("apps on the earlier visitor rules are listed, then narrowed, restored and widened", async (context) => {
  const knex = await connectTestDatabase();
  const userId = String((await knex("users").first()).id);
  const slug = `apps-upgrade-${Date.now()}`;
  const [home] = await knex("workspaces").insert({ slug, name: "Upgrade test", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = home.id ?? home;
  const started = await startApps({ knex });
  const { registry, apps } = started.apps;
  const member = started.memberOptions(userId, { id: workspaceId, slug });
  context.after(async () => {
    await started.stop();
    await knex("any_records").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("any_resource_configs").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("workspaces").where({ id: workspaceId }).del();
    await knex.destroy();
  });

  const person = { type: "person", id: userId, name: "Pat" };
  await registry.createTable(person, { key: "teams", fields: [{ key: "title", type: "text", required: true }] }, member);
  const teamsId = (await registry.loadTables(member)).find((table) => table.key === "teams").id;
  await registry.createTable(person, {
    key: "people",
    fields: [{ key: "name", type: "text", required: true }, { key: "email", type: "email" }, { key: "salary", type: "money" }, { key: "team", type: "link", target: teamsId }, { key: "note", type: "text" }]
  }, member);
  const tables = await registry.loadTables(member);
  const stored = (definition) => toIds(definition, tables).definition;
  // Stored definitions are jsonb, which orders an object's keys its own way: lists are compared sorted.
  const sorted = (listed) => Object.fromEntries(Object.entries(listed).map(([key, rule]) => [key, { ...rule, read: [...rule.read].sort(), write: [...rule.write].sort() }]));

  /** An app with a live version (and a draft) stored as they are, past the save check: earlier rules can't be saved any more. */
  const install = async (name, live, draft = null) => {
    const app = await apps.createApp(person, { name }, member);
    const [{ id: liveId }] = await knex("app_versions")
      .insert({ app_id: app.id, workspace_id: workspaceId, number: 1, definition: JSON.stringify(stored(live)), summary: "v1", kind: "builder", created_by: person, published_at: knex.fn.now() })
      .returning("id");
    const update = { live_version_id: liveId };
    if (draft) {
      [{ id: update.draft_version_id }] = await knex("app_versions")
        .insert({ app_id: app.id, workspace_id: workspaceId, definition: JSON.stringify(stored(draft)), summary: "draft", kind: "builder", created_by: person })
        .returning("id");
    }
    await knex("apps").where({ id: app.id }).update(update);
    return { ...app, liveId: String(liveId) };
  };
  const live = async (slugOrId) => {
    const app = await knex("apps").where({ workspace_id: workspaceId }).where((query) => query.where({ slug: slugOrId }).orWhere({ id: slugOrId })).first();
    return knex("app_versions").where({ id: app.live_version_id }).first();
  };
  const draftOf = async (slugOrId) => {
    const app = await knex("apps").where({ workspace_id: workspaceId, slug: slugOrId }).first();
    return knex("app_versions").where({ id: app.draft_version_id }).first();
  };

  const legacy = (extra = []) => ({
    home: "inside",
    public: { home: "mine", signIn: "required", tables: { people: { read: "own", owner: "email", create: true, update: "own" } } },
    screens: {
      inside: { data: { all: { from: "people" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Salary", value: "=row.salary" }] }] },
      mine: {
        public: true,
        data: { mine: { from: "people", sort: "name" } },
        content: [
          { type: "table", rows: "=data.mine", columns: [{ label: "Name", value: "=row.name" }, { label: "Team", value: "=row.team" }, ...extra], onRowClick: [{ go: { screen: "edit", params: { id: "=row.id" } } }] },
          { type: "form", table: "people", fields: ["name"], buttons: [{ type: "button", label: "Join", do: [{ create: { table: "people", values: "=form.values", preset: { note: "Joined online" } } }] }] }
        ]
      },
      edit: {
        public: true,
        params: { id: { type: "string" } },
        data: { me: { record: "people", id: "=params.id" } },
        content: [{ type: "form", record: "=data.me", fields: ["name", "note"], buttons: [{ type: "button", label: "Save", do: [{ update: { record: "=data.me", set: "=form.values" } }] }] }]
      }
    }
  });
  const stays = await install("Stays", legacy(), legacy([{ label: "Email", value: "=row.email" }]));
  await apps.setPublic(person, "stays", true, member);
  const board = await install("Board", {
    home: "board",
    public: { home: "board", tables: { people: { read: '=note == "public"' } } },
    screens: {
      board: {
        public: true,
        data: { list: { from: "people" }, names: { script: "names" } },
        content: [{ type: "table", rows: "=data.list", columns: [{ label: "Name", value: "=row.name" }] }, { type: "table", rows: "=data.names", columns: [{ label: "Name", value: "=row.name" }] }]
      }
    }
  });
  const listedApp = {
    home: "all",
    public: { home: "all", tables: { people: { can: ["list"], rows: "all", read: ["name"] } } },
    screens: { all: { public: true, data: { all: { from: "people" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }] }] } }
  };
  const directory = await install("Directory", listedApp);
  const internal = await install("Internal", { home: "list", screens: { list: { data: { all: { from: "people" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }] }] } } });

  const before = await live("stays");
  const visitor = { signedIn: true, email: "ann@example.test" };
  const reach = (definition) => compile(toNames(definition, tables), tables, visitor);
  const reachBefore = reach(before.definition);

  // The earlier rules listed as the server lists them (listedStored), stored as the visitor-access upgrade stored them:
  // a second live version of kind "upgrade" for each app on them, by Mercbot, and its draft listed in place.
  const relist = async (app) => {
    const current = await live(app.id);
    const [{ id }] = await knex("app_versions")
      .insert({ app_id: app.id, workspace_id: workspaceId, number: 2, definition: JSON.stringify(listedStored(current.definition, tables)), summary: "Visitor access listed from the earlier visitor rules", kind: "upgrade", created_by: { type: "system", name: "Mercbot" }, published_at: knex.fn.now() })
      .returning("id");
    await knex("apps").where({ id: app.id }).update({ live_version_id: id });
  };
  await relist(stays);
  await relist(board);
  const draft = await draftOf("stays");
  await knex("app_versions").where({ id: draft.id }).update({ definition: JSON.stringify(listedStored(draft.definition, tables)) });
  const after = await live("stays");
  const listedPublic = toNames(after.definition, tables).public;
  assert.deepEqual([listedPublic.home, listedPublic.signIn], ["mine", "required"]);
  assert.deepEqual(sorted(listedPublic.tables), {
    people: { can: ["list", "get", "create", "update"], rows: "own", owner: "email", read: ["email", "name", "note", "team"], write: ["name", "note"] },
    teams: { can: [], rows: "all", read: ["title"], write: [] }
  });
  assert.deepEqual(after.definition.screens, before.definition.screens, "only the visitor access changes");
  assert.deepEqual(reach(after.definition), reachBefore, "visitors reach exactly what they reached");
  assert.ok(toNames((await draftOf("stays")).definition, tables).public.tables.people.read.includes("email"), "the draft lists what its own screens use");
  assert.deepEqual(toNames((await live("board")).definition, tables).public.tables, { people: { can: ["list", "get"], rows: '=note == "public"', read: ["name"], write: [] } }, "rows come from the read rule");
  // Listing what is listed already, or an app without visitors, changes nothing.
  for (const app of [stays, directory, internal]) {
    const { definition } = await live(app.id);
    assert.deepEqual(listedStored(definition, tables), definition, `${app.name} stays as it is`);
  }

  // A public screen's data script reads what its code says: the Overview asks a person to check.
  assert.deepEqual((await apps.visitorAccess("board", member)).attention, [{ screen: "board", query: "names", script: "names" }]);
  const shown = await apps.visitorAccess("stays", member);
  assert.deepEqual(shown.attention, []);
  assert.deepEqual(shown.tables.map((table) => [table.key, table.can, table.rows, table.read.map((field) => field.label).sort()]).sort(), [
    ["people", ["list", "get", "create", "update"], "own", ["Email", "Name", "Note", "Team"]],
    ["teams", [], "all", ["Title"]]
  ]);

  // Restoring a version from before visitor access brings it back listed, which is no wider.
  const restored = await apps.restore(person, "stays", stays.liveId, {}, member);
  const back = await live("stays");
  assert.deepEqual([back.number, back.kind], [restored.number, "restore"]);
  assert.ok(isListed(back.definition.public));
  assert.deepEqual(back.definition.public, after.definition.public);

  // Narrowing: saved at once as a new live version; nothing can be added through it.
  const narrow = await apps.narrowVisitorAccess(person, "stays", {
    people: { can: ["list", "get", "create", "delete"], read: ["name", "team", "email", "salary"], write: ["name"] }
  }, member);
  assert.equal(narrow.changed, true);
  const narrowed = await live("stays");
  assert.deepEqual([narrowed.number, narrowed.kind], [narrow.number, "narrowing"]);
  assert.deepEqual(sorted(toNames(narrowed.definition, tables).public.tables), {
    people: { can: ["list", "get", "create"], rows: "own", owner: "email", read: ["email", "name", "team"], write: ["name"] }
  });
  const narrowedDraft = toNames((await draftOf("stays")).definition, tables).public.tables;
  assert.deepEqual(narrowedDraft.people.can, ["list", "get", "create"], "the draft loses the same");
  assert.deepEqual(narrowedDraft.people.write, ["name"]);
  assert.equal(narrowedDraft.teams, undefined);
  assert.equal((await apps.narrowVisitorAccess(person, "stays", { people: { can: ["list", "get", "create"], read: ["name", "team", "email"], write: ["name"] } }, member)).changed, false);
  await assert.rejects(apps.narrowVisitorAccess(person, "stays", { people: { read: ["wage"] } }, member), (error) => error.statusCode === 400);

  // Widening a public app's visitor access: only an owner or admin publishes or restores it.
  assert.deepEqual((await apps.saveDraft(person, "directory", listedApp, "v2", member)).errors, []);
  await apps.publish(person, "directory", {}, member);
  await apps.setPublic(person, "directory", true, member);
  const wider = structuredClone(listedApp);
  wider.public.tables.people.read.push("salary");
  assert.deepEqual((await apps.saveDraft(person, "directory", wider, "Salaries too", member)).errors, []);
  await assert.rejects(
    apps.publish(person, "directory", {}, member),
    (error) => error.statusCode === 403 && error.code === "apps_visitor_access_widening" && /People: read Salary/u.test(error.message)
  );
  const widened = await apps.publish(person, "directory", { canManage: true }, member);
  const narrower = structuredClone(listedApp);
  narrower.public.tables.people.rows = '=name != "Bob"';
  assert.deepEqual((await apps.saveDraft(person, "directory", narrower, "Not Bob", member)).errors, []);
  await apps.publish(person, "directory", {}, member);
  await assert.rejects(apps.restore(person, "directory", widened.versionId, {}, member), (error) => error.code === "apps_visitor_access_widening");
  await apps.restore(person, "directory", widened.versionId, { canManage: true }, member);

  // An app that isn't public: anyone publishes whatever the Builder listed.
  await apps.setPublic(person, "directory", false, member);
  const more = structuredClone(wider);
  more.public.tables.people.read.push("email");
  assert.deepEqual((await apps.saveDraft(person, "directory", more, "Emails too", member)).errors, []);
  await apps.publish(person, "directory", {}, member);
});
