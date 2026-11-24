import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { celSchema, formulaValue, showValue } from "../../packages/apps/src/shared/formulas.js";
import { compileWhere } from "../../packages/apps/src/shared/where.js";
import { applyPlan } from "../../packages/apps/src/server/sqlPlan.js";
import { cleanRecord, TAG_MAX, TAGS_MAX } from "../../packages/apps/src/server/validate.js";

// The field types shared tables need (D-130): a person in the home, tags, a web address, long notes and a date and
// time. Each value is checked by type before anything is written (validate.js); tags are filtered with CEL's own
// `"x" in tags`, which becomes SQL; a member's screens read who they are as `me`.
const table = {
  label: "Tasks",
  fields: [
    { id: "f_owner", key: "owner", label: "Owner", type: "person" },
    { id: "f_site", key: "site", label: "Site", type: "url" },
    { id: "f_notes", key: "notes", label: "Notes", type: "longtext" },
    { id: "f_tags", key: "tags", label: "Tags", type: "tags" },
    { id: "f_kind", key: "kind", label: "Kind", type: "tags", options: { choices: ["Home", "Work"] } },
    { id: "f_due", key: "due", label: "Due", type: "datetime" }
  ]
};
const refused = (input, code) => assert.throws(() => cleanRecord(table, input), (error) => error.code === code, JSON.stringify(input));

test("each new type keeps a good value as it should be stored, and refuses a bad one by its own code", () => {
  assert.deepEqual(cleanRecord(table, {
    owner: { id: "12", label: "Ana" },
    site: " https://example.com/page ",
    notes: "x".repeat(15000),
    tags: " urgent, home ,urgent,, ",
    kind: ["Work"],
    due: "2026-11-24T09:30:00+01:00"
  }), {
    f_owner: "12",
    f_site: "https://example.com/page",
    f_notes: "x".repeat(15000),
    f_tags: ["urgent", "home"],
    f_kind: ["Work"],
    f_due: "2026-11-24T08:30:00.000Z"
  });
  assert.deepEqual(cleanRecord(table, { tags: [], due: "" }), { f_tags: null, f_due: null }, "empty is nothing");
  refused({ owner: "Ana" }, "apps_value_person_invalid");
  refused({ site: "example.com" }, "apps_value_url_invalid");
  refused({ site: "javascript:alert(1)" }, "apps_value_url_invalid");
  refused({ notes: "x".repeat(20001) }, "apps_value_too_long");
  refused({ tags: Array.from({ length: TAGS_MAX + 1 }, (_, at) => `t${at}`) }, "apps_value_tags_too_many");
  refused({ tags: ["x".repeat(TAG_MAX + 1)] }, "apps_value_tag_too_long");
  refused({ kind: ["Play"] }, "apps_value_tag_unknown");
  refused({ due: "2026-11-24 09:30" }, "apps_value_datetime_invalid");
  refused({ due: "2026-02-30T09:30:00Z" }, "apps_value_datetime_invalid");
});

test("tags are filtered with CEL's own list test, which becomes one jsonb_exists per tag", () => {
  const knex = knexLib({ client: "pg" });
  const variables = { tags: "list<string>", state: { tag: "string" }, params: {} };
  const sql = (where, state) => {
    const plan = compileWhere(variables, where);
    const query = knex("records").where((builder) => applyPlan(builder, plan, { variables: { state: variables.state, params: {} }, values: { state, params: {} } }, (field) => `records.${field}`, knex));
    return query.toSQL().toNative();
  };
  const one = sql('="urgent" in tags', {});
  assert.match(one.sql, /jsonb_exists\("records"\."tags"::jsonb, \$1\)/u);
  assert.deepEqual(one.bindings, ["urgent"]);
  const any = sql('="a" in tags || state.tag in tags', { tag: "b" });
  assert.deepEqual(any.bindings, ["a", "b"]);
  assert.match(any.sql, / or /u);
  assert.match(sql('=state.tag in tags', { tag: "" }).sql, /false/u, "no tag chosen matches nothing");
});

test("an empty field is \"\" in formulas: == \"\" finds no value, != \"\" a value, and a date and time's is only ever null", () => {
  const knex = knexLib({ client: "pg" });
  const variables = { parent: "string", due: "string", state: {}, params: {} };
  // AnyAPI's slots: a link in a string slot, a date and time in a date slot.
  const slots = { parent: "string_3", due: "date_2" };
  const sql = (where) => knex("records")
    .where((builder) => applyPlan(builder, compileWhere(variables, where), { variables: {}, values: {} }, (field) => `records.${slots[field]}`, knex))
    .toSQL().toNative().sql;
  assert.match(sql('=parent == ""'), /\("records"\."string_3" is null or "records"\."string_3" = \$1\)/u);
  assert.match(sql('=parent != ""'), /\("records"\."string_3" is not null and "records"\."string_3" <> \$1\)/u);
  assert.match(sql('=due == ""'), /\("records"\."date_2" is null\)/u);
  assert.match(sql('=due != "" && due < "2026-01-01T00:00:00Z"'), /\("records"\."date_2" is not null\)\) and \("records"\."date_2" < \$1\)/u);
});

test("a filter asks only what its field's slot can answer: a number's or a yes/no's empty is null, and only a list holds a tag", () => {
  const knex = knexLib({ client: "pg" });
  const variables = { hours: "double", done: "bool", title: "string", tags: "list<string>", state: {}, params: {} };
  // A number's slot is a double and a yes/no's a boolean: neither can be compared with "", which PostgreSQL refuses.
  const slots = { hours: "number_2", done: "boolean_1", title: "string_1", tags: "json_1" };
  const sql = (where) => knex("records")
    .where((builder) => applyPlan(builder, compileWhere(variables, where), { variables: {}, values: {} }, (field) => `records.${slots[field]}`, knex))
    .toSQL().toNative();
  assert.deepEqual(sql('=hours == ""'), { sql: 'select * from "records" where (("records"."number_2" is null))', bindings: [] });
  assert.deepEqual(sql('=done != ""'), { sql: 'select * from "records" where (("records"."boolean_1" is not null))', bindings: [] });
  // `"x" in title` would cast a text to JSON in the database; a text field holds no tags, so it's no database query.
  assert.throws(() => compileWhere(variables, '="urgent" in title'), /can't be turned into a database query/u);
  assert.match(sql('="urgent" in tags').sql, /jsonb_exists/u);
});

test("only a \"\" written in the formula finds empty fields: an empty value it reads (a visitor not signed in) finds none", () => {
  const knex = knexLib({ client: "pg" });
  const variables = { owner: "string", visitor: { signedIn: "bool", email: "string" }, me: { id: "string", name: "string" }, params: { id: "string" } };
  const values = { visitor: { signedIn: false, email: "" }, me: { id: "", name: "" }, params: { id: "" } };
  const sql = (where) => knex("records")
    .where((builder) => applyPlan(builder, compileWhere(variables, where), { variables, values }, () => "records.string_3", knex))
    .toSQL().toNative();
  // A visitor rule "their own rows" must never give someone signed out every row nobody owns.
  for (const where of ["=owner == visitor.email", "=visitor.email == owner", "=owner == me.id", "=owner == params.id"]) {
    const query = sql(where);
    assert.doesNotMatch(query.sql, /is null/u, `${where}: ${query.sql}`);
    assert.deepEqual(query.bindings, [""], where);
  }
  assert.match(sql("=owner == ''").sql, /is null/u, "a \"\" in single quotes is written in the formula too");
});

test("a member's screens read who they are as me; a public screen reads its visitor instead", () => {
  const field = (id, key, type) => ({ id, key, label: key, type, options: {} });
  const tables = [{ id: "t_tasks", key: "tasks", label: "Tasks", obsolete: false, fields: [field("f_title", "title", "text"), field("f_owner", "owner", "person")] }];
  const definition = (open) => ({
    home: "list",
    screens: {
      list: {
        ...(open ? { public: true } : {}),
        data: { mine: { from: "tasks", where: "=owner == me.id" } },
        content: [{ type: "text", value: "=me.name" }]
      }
    }
  });
  assert.deepEqual(checkApp(definition(false), tables), [], "a member's screen may read me");
  assert.ok(checkApp(definition(true), tables).some((error) => /me/u.test(error.message)), "a public screen has no me");
});

test("formulas see a person as their id and tags as a list; screens show names, tags and times", () => {
  const owner = table.fields[0];
  const tags = table.fields[3];
  const due = table.fields[5];
  assert.deepEqual(celSchema({ fields: table.fields }), { id: "string", owner: "string", site: "string", notes: "string", tags: "list<string>", kind: "list<string>", due: "string" });
  assert.equal(formulaValue(owner, { id: "12", label: "Ana" }), "12");
  assert.deepEqual(formulaValue(tags, null), []);
  assert.deepEqual(formulaValue(tags, ["a"]), ["a"]);
  assert.equal(showValue(owner, { id: "12", label: "Ana" }), "Ana");
  assert.equal(showValue(tags, ["a", "b"]), "a, b");
  assert.match(showValue(due, "2026-11-24T08:30:00.000Z"), /2[45] Nov 2026, \d{2}:\d{2}/u, "in the reader's zone");
});

test("an import skips a file or picture column, which holds a file's name: files go onto records by upload only", async () => {
  const { fromSheet } = await import("../../packages/apps/src/server/sheetInput.js");
  const table = { fields: [{ id: "f1", key: "title", label: "Title", type: "text" }, { id: "f2", key: "picture", label: "Picture", type: "image" }, { id: "f3", key: "source", label: "Source", type: "file" }] };
  assert.deepEqual(fromSheet(table, { f1: "Poster", f2: "poster.png", f3: "poster.psd" }, new Map()), { f1: "Poster" });
});
