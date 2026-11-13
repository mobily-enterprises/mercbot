import assert from "node:assert/strict";
import test from "node:test";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { toIds, toNames } from "../../packages/apps/src/shared/definitions.js";
import { isListed, listedAccess, listedStored, narrowed, publicScripts, widening, withoutRemoved } from "../../packages/apps/src/shared/visitorAccess.js";

// App definitions (D-35): the save check, and names ↔ ids so renames never touch an app.
const field = (id, key, type, options = {}) => ({ id, key, label: key, type, options, obsolete: false });
const tables = [
  {
    id: "t_users",
    key: "users",
    label: "Users",
    obsolete: false,
    fields: [
      field("f_name", "name", "text", { required: true }),
      field("f_email", "email", "email"),
      field("f_status", "status", "choice", { choices: ["Active", "On leave", "Left"] }),
      field("f_started", "started", "date"),
      field("f_left", "left_on", "date"),
      { ...field("f_old", "fax", "text"), obsolete: true }
    ]
  },
  { id: "t_deals", key: "deals", label: "Deals", obsolete: false, fields: [field("f_title", "title", "text"), field("f_who", "salesperson", "text"), field("f_amount", "amount", "money"), field("f_stage", "stage", "choice", { choices: ["New", "Won"] })] }
];

const app = () => ({
  home: "list",
  navigation: { style: "rail", items: [{ screen: "list", label: "People", icon: "person" }, { screen: "sales", label: "Sales", icon: "chart" }] },
  screens: {
    list: {
      state: { search: { type: "string", default: "" } },
      data: { people: { from: "users", where: '=state.search == "" || name.lowerAscii().contains(state.search.lowerAscii())', sort: "name" } },
      content: [
        { type: "input", bind: "state.search", label: "Search", icon: "search" },
        {
          type: "table",
          rows: "=data.people",
          columns: [{ label: "Name", value: "=row.name" }, { label: "Status", value: "=row.status", display: "chip" }],
          onRowClick: [{ go: { screen: "edit", params: { id: "=row.id" } } }]
        }
      ]
    },
    edit: {
      params: { id: { type: "string" } },
      data: { person: { record: "users", id: "=params.id" } },
      content: [
        { type: "text", value: '=data.person.name + " · " + data.person.email', size: "headline" },
        {
          type: "form",
          record: "=data.person",
          fields: ["name", "email", "status", { field: "left_on", showIf: '=form.status == "Left"', required: '=form.status == "Left"' }],
          buttons: [{ type: "button", label: "Save", emphasis: "primary", disabled: "=!form.valid || !form.changed", do: [{ update: { record: "=data.person", set: "=form.values" } }, { notify: '="Saved " + form.name' }, { go: { screen: "list" } }] }]
        }
      ]
    },
    sales: {
      data: { won: { from: "deals", where: '=stage == "Won"', groupBy: "salesperson", sum: "amount" } },
      content: [{ type: "grid", columns: 2, content: [{ type: "totals", label: "Won by person", rows: "=data.won" }, { type: "chart", kind: "bar", label: "Won by person", rows: "=data.won", measure: "total" }] }]
    }
  }
});

test("a correct app passes the save check", () => {
  assert.deepEqual(checkApp(app(), tables), []);
});

test("mistakes are reported where they are, with suggestions", () => {
  const broken = app();
  broken.home = "start";
  broken.screens.list.data.people.where = '=stauts == "Active"';
  broken.screens.list.data.people.sort = "nmae";
  broken.screens.list.content[1].columns[0].value = "=row.name + 1";
  broken.screens.list.content[1].onRowClick = [{ go: { screen: "edit" } }];
  broken.screens.edit.content.push({ type: "marquee" }, { type: "text", value: "Hi", style: "color: red" });
  broken.screens.edit.content[1].fields.push("phone");
  broken.screens.sales.data.won.from = "deal";
  broken.screens.list.data.long = { from: "users", where: "=name.size() > 3" };
  const errors = checkApp(broken, tables);
  const find = (path) => errors.filter((error) => error.path === path).map((error) => error.message).join(" | ");
  assert.match(find("home"), /must name one of the screens: list, edit, sales/u);
  assert.match(find("screens.list.data.people.where"), /users has no field "stauts"\. Did you mean "status"\?/u);
  assert.match(find("screens.list.data.people.sort"), /no field "nmae"\. Did you mean "name"\?/u);
  assert.match(find("screens.list.content[1].columns[0].value"), /no such overload/u);
  assert.match(find("screens.list.content[1].onRowClick[0].go.params"), /needs "id"/u);
  assert.match(find("screens.edit.content[2]"), /"marquee" isn't a known part/u);
  assert.match(find("screens.edit.content[3].style"), /"style" isn't a setting of text/u);
  assert.match(find("screens.edit.content[1].fields[4]"), /no field "phone"/u);
  assert.match(find("screens.sales.data.won.from"), /no table "deal"\. Did you mean "deals"\?/u);
  assert.match(find("screens.list.data.long.where"), /can't be turned into a database query/u);
});

test("removed fields can't be used", () => {
  const broken = app();
  broken.screens.list.content[1].columns.push({ label: "Fax", value: "=row.fax" });
  assert.match(checkApp(broken, tables).map((error) => error.message).join(), /no field "fax"/u);
});

test("names become ids everywhere, inside formulas too, and come back", () => {
  const { definition, errors } = toIds(app(), tables);
  assert.deepEqual(errors, []);
  const people = definition.screens.list.data.people;
  assert.equal(people.from, "t_users");
  assert.equal(people.sort, "f_name");
  assert.equal(people.where, '=state.search == "" || f_name.lowerAscii().contains(state.search.lowerAscii())');
  assert.equal(definition.screens.list.content[1].columns[0].value, "=row.f_name");
  assert.equal(definition.screens.list.content[1].onRowClick[0].go.params.id, "=row.id");
  const form = definition.screens.edit.content[1];
  assert.deepEqual(form.fields.slice(0, 3), ["f_name", "f_email", "f_status"]);
  assert.equal(form.fields[3].field, "f_left");
  assert.equal(form.fields[3].showIf, '=form.f_status == "Left"');
  assert.equal(form.buttons[0].disabled, "=!form.valid || !form.changed");
  assert.equal(definition.screens.edit.content[0].value, '=data.person.f_name + " · " + data.person.f_email');
  assert.deepEqual([definition.screens.sales.data.won.groupBy, definition.screens.sales.data.won.sum], ["f_who", "f_amount"]);
  assert.equal(definition.screens.sales.content[0].columns, 2, "a grid's column count is left alone");
  assert.deepEqual(toNames(definition, tables), app());
});

test("a renamed field shows its new name; a removed one stays an id the screen skips", () => {
  const { definition } = toIds(app(), tables);
  const renamed = structuredClone(tables);
  renamed[0].fields[0].key = "full_name";
  renamed[0].fields[1].obsolete = true;
  const shown = toNames(definition, renamed);
  assert.equal(shown.screens.list.content[1].columns[0].value, "=row.full_name");
  assert.equal(shown.screens.edit.content[1].fields[1], "f_email");
});

test("charts draw only totals, and a total needs a summed or averaged query", () => {
  const broken = app();
  broken.screens.sales.data.byStage = { from: "deals", groupBy: "stage" };
  broken.screens.sales.content.push(
    { type: "chart", kind: "pie", rows: "=data.byStage", measure: "total" },
    { type: "chart", kind: "donut", rows: "=data.byStage" },
    { type: "chart", rows: "=data.won", colour: "red" }
  );
  broken.screens.list.content.push({ type: "chart", rows: "=data.people" });
  const messages = checkApp(broken, tables).map((error) => `${error.path}: ${error.message}`);
  assert.ok(messages.some((message) => /content\[1\]\.measure: total needs a query with sum or avg/u.test(message)), messages.join("\n"));
  assert.ok(messages.some((message) => /kind: must be one of: bar, line, pie/u.test(message)));
  assert.ok(messages.some((message) => /colour" isn't a setting of chart/u.test(message)));
  assert.ok(messages.some((message) => /screens\.list\.content\[2\]\.rows: must name a query with groupBy/u.test(message)));
});

test("public screens stay public, never wake a bot, and save exactly what their forms show", () => {
  const publicApp = () => ({
    public: {
      home: "contact",
      signIn: "required",
      tables: {
        users: { can: ["list", "get", "create", "update"], rows: "own", owner: "email", read: ["name"], write: ["name"] },
        deals: { can: ["list"], rows: '=stage == "Won"', read: ["stage"] }
      }
    },
    home: "list",
    screens: {
      ...app().screens,
      contact: {
        public: true,
        content: [
          { type: "text", value: '="Hello " + visitor.email', size: "title" },
          { type: "form", table: "users", fields: ["name", "email"], buttons: [{ type: "button", label: "Send", do: [{ create: { table: "users", values: "=form.values" } }, { go: { screen: "mine" } }] }] }
        ]
      },
      mine: {
        public: true,
        data: { me: { from: "users" }, won: { from: "deals", groupBy: "stage" } },
        content: [
          { type: "table", rows: "=data.me", columns: [{ label: "Name", value: "=row.name" }], onRowClick: [{ go: { screen: "edit_me", params: { id: "=row.id" } } }] },
          { type: "chart", rows: "=data.won" }
        ]
      },
      edit_me: {
        public: true,
        params: { id: { type: "string" } },
        data: { me: { record: "users", id: "=params.id" } },
        content: [{ type: "form", record: "=data.me", fields: ["name"], buttons: [{ type: "button", label: "Save", do: [{ update: { record: "=data.me", set: "=form.values" } }] }] }]
      }
    }
  });
  assert.deepEqual(checkApp(publicApp(), tables), []);
  const { definition } = toIds(publicApp(), tables);
  assert.deepEqual(definition.public.tables, {
    t_users: { can: ["list", "get", "create", "update"], rows: "own", owner: "f_email", read: ["f_name"], write: ["f_name"] },
    t_deals: { can: ["list"], rows: '=f_stage == "Won"', read: ["f_stage"] }
  });
  assert.equal(definition.screens.contact.content[1].table, "t_users");
  assert.deepEqual(toNames(definition, tables).public, publicApp().public);

  const broken = publicApp();
  broken.public.home = "list";
  broken.public.signIn = "none";
  broken.public.tables.deals = { read: "=stagee", create: "yes", delete: true };
  broken.public.tables.users.owner = "name";
  broken.public.tables.users.can = ["get", "create", "update"];
  const mine = broken.screens.mine;
  mine.content[0].rowActions = [{ type: "button", label: "x", do: [{ askBot: { bot: "Otto", task: '="x"' } }, { markObsolete: { record: "=data.me" } }, { go: { screen: "list" } }] }];
  broken.screens.contact.content[1].buttons[0].do[0].create.values = { name: '="x"' };
  broken.screens.edit_me.content.push({ type: "button", label: "Sneak", do: [{ update: { record: "=data.me", set: { name: '="x"' } } }] });
  const messages = checkApp(broken, tables).map((error) => `${error.path}: ${error.message}`).join("\n");
  for (const expected of [
    /public\.home: must name a public screen/u,
    /public\.signIn: "own" records need visitors to sign in/u,
    /public\.tables\.users\.owner: must name an email field/u,
    /public\.tables\.deals: uses the earlier visitor rules \(read, owner, create, update\)\. List what visitors may reach instead/u,
    /screens\.mine\.data\.me: visitors can't list users: add "list" to public\.tables\.users\.can/u,
    /rowActions\[0\]\.do\[0\]: .*never ask a bot or mark records obsolete/u,
    /rowActions\[0\]\.do\[1\]: .*never ask a bot/u,
    /rowActions\[0\]\.do\[2\]\.go\.screen: a public screen can only go to another public screen/u,
    /create\.values: on a public screen, a form adds exactly what it shows/u,
    /screens\.edit_me\.content\[1\]\.do\[0\]: on a public screen, only an edit form's button can change its record/u
  ]) assert.match(messages, expected);
  const both = app();
  both.screens.edit.content[1].table = "users";
  assert.match(checkApp(both, tables).map((error) => error.message).join("\n"), /exactly one of record \(to edit\) or table/u);
});

test("visitor access lists what visitors may reach, and every public screen must fit in it", () => {
  const access = () => ({
    home: "mine",
    public: {
      home: "mine",
      signIn: "required",
      tables: {
        users: { can: ["list", "get", "create", "update"], rows: "own", owner: "email", read: ["name", "status"], write: ["name", "status"] },
        deals: { can: ["list"], rows: '=stage == "Won"', read: ["salesperson", "amount"] }
      }
    },
    screens: {
      inside: { data: { all: { from: "users" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Left", value: "=row.left_on" }] }] },
      mine: {
        public: true,
        data: { me: { from: "users", sort: "name" }, won: { from: "deals", groupBy: "salesperson", sum: "amount" } },
        content: [
          { type: "table", rows: "=data.me", columns: [{ label: "Name", value: "=row.name" }], onRowClick: [{ go: { screen: "edit", params: { id: "=row.id" } } }] },
          { type: "chart", rows: "=data.won", measure: "total" },
          { type: "form", table: "users", fields: ["name", "email"], buttons: [{ type: "button", label: "Join", do: [{ create: { table: "users", values: "=form.values", preset: { status: "Active" } } }] }] }
        ]
      },
      edit: {
        public: true,
        params: { id: { type: "string" } },
        data: { me: { record: "users", id: "=params.id" } },
        content: [{ type: "form", record: "=data.me", fields: ["name", { field: "status", showIf: '=form.name != ""' }], buttons: [{ type: "button", label: "Save", do: [{ update: { record: "=data.me", set: "=form.values" } }] }] }]
      }
    }
  });
  assert.deepEqual(checkApp(access(), tables), [], "a form may show the owner: the server fills it in");
  const { definition } = toIds(access(), tables);
  assert.deepEqual(definition.public.tables, {
    t_users: { can: ["list", "get", "create", "update"], rows: "own", owner: "f_email", read: ["f_name", "f_status"], write: ["f_name", "f_status"] },
    t_deals: { can: ["list"], rows: '=f_stage == "Won"', read: ["f_who", "f_amount"] }
  });
  assert.deepEqual(toNames(definition, tables).public, access().public);

  const broken = access();
  broken.public.signIn = "none";
  Object.assign(broken.public.tables.users, { can: ["list", "create", "update", "remove"], read: ["name"], write: ["name", "email"] });
  broken.public.tables.deals = { can: ["list", "update"], rows: "=stagee", read: "salesperson", create: true };
  const messages = checkApp(broken, tables).map((error) => `${error.path}: ${error.message}`).join("\n");
  for (const expected of [
    /public\.signIn: "own" records need visitors to sign in/u,
    /public\.tables\.users\.can: lists what visitors may do: any of list, get, create, update, delete/u,
    /public\.tables\.users\.write: email is the owner, which the server fills in/u,
    /screens\.mine\.content\[0\]: visitors can't open records of users: add "get" to public\.tables\.users\.can/u,
    /screens\.mine\.content\[2\]\.buttons\[0\]\.do\[0\]\.create\.preset\.status: visitors can't write users\.status: add "status" to public\.tables\.users\.write/u,
    /screens\.edit\.content\[0\]\.fields\[1\]: visitors can't read users\.status: add "status" to public\.tables\.users\.read/u,
    /public\.tables\.deals\.rows: .*stagee/u,
    /public\.tables\.deals\.can: visitors may only change their own records: update needs rows: own/u,
    /public\.tables\.deals\.read: lists field names/u,
    /public\.tables\.deals\.create: isn't a visitor setting/u,
    /screens\.mine\.data\.won\.groupBy: visitors can't read deals\.salesperson/u
  ]) assert.match(messages, expected);
  assert.doesNotMatch(messages, /left_on/u, "screens visitors never see aren't held to it");

  const linked = [...tables, { id: "t_notes", key: "notes", label: "Notes", obsolete: false, fields: [field("f_note", "note", "text"), field("f_deal", "deal", "link", { target: "t_deals" })] }];
  const notes = { home: "add", public: { home: "add", tables: { notes: { can: ["create"], write: ["note", "deal"] } } }, screens: { add: { public: true, content: [{ type: "text", value: "Hi" }] } } };
  assert.match(checkApp(notes, linked).map((error) => `${error.path}: ${error.message}`).join("\n"), /public\.tables\.notes\.write: deal links to deals: list deals in public\.tables too/u);
  notes.public.tables.deals = { can: [] };
  assert.deepEqual(checkApp(notes, linked), [], "a create-only table needs no rows, and a listed table no operations");
  // A table listed for its link labels alone says whose records: a link reaches only the rows.
  notes.public.tables.deals = { can: [], read: ["title"] };
  assert.match(checkApp(notes, linked).map((error) => `${error.path}: ${error.message}`).join("\n"), /public\.tables\.deals\.rows: says which records visitors reach/u);
  notes.public.tables.deals.rows = "all";
  assert.deepEqual(checkApp(notes, linked), []);
  notes.public.tables.deals = { can: ["create"], read: ["title"] };
  assert.deepEqual(checkApp(notes, linked), [], "a create-only table, as an earlier contact form derives, needs no rows for what it gives back");
});

test("an app on the earlier visitor rules can't be saved any more, and reaches what its public screens use", () => {
  const legacy = {
    home: "mine",
    public: { home: "mine", signIn: "required", tables: { users: { read: "own", owner: "email", create: true, update: "own" }, deals: { read: '=stage == "Won"' } } },
    screens: {
      inside: { data: { all: { from: "users" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Left", value: "=row.left_on" }] }] },
      mine: {
        public: true,
        data: { me: { from: "users", where: '=status != "Left"' }, won: { from: "deals", groupBy: "stage" } },
        content: [
          { type: "table", rows: "=data.me", columns: [{ label: "Name", value: "=row.name" }] },
          { type: "chart", rows: "=data.won" },
          { type: "form", table: "users", fields: ["name", "email"], buttons: [{ type: "button", label: "Join", do: [{ create: { table: "users", values: "=form.values", preset: { started: "=today()" } } }] }] }
        ]
      }
    }
  };
  assert.equal(isListed(legacy.public), false);
  const refused = checkApp(legacy, tables).map((error) => `${error.path}: ${error.message}`).join("\n");
  assert.match(refused, /public\.tables\.users: uses the earlier visitor rules/u);
  assert.match(refused, /public\.tables\.deals: uses the earlier visitor rules/u);
  assert.deepEqual(listedAccess(legacy, tables), {
    users: { can: ["list", "get", "create", "update"], rows: "own", owner: "email", read: ["status", "name", "email"], write: ["name", "started"] },
    deals: { can: ["list", "get"], rows: '=stage == "Won"', read: ["stage"], write: [] }
  });
  // A linked table that isn't listed is, for its records' titles alone, so link labels keep showing.
  const linked = [...tables.map((table) => ({ ...table, titleFieldId: table.fields[0].id })), { id: "t_notes", key: "notes", label: "Notes", obsolete: false, titleFieldId: "f_note", fields: [field("f_note", "note", "text"), field("f_deal", "deal", "link", { target: "t_deals" })] }];
  const notes = { home: "all", public: { home: "all", tables: { notes: { read: "all" } } }, screens: { all: { public: true, data: { all: { from: "notes" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Deal", value: "=row.deal" }] }] } } };
  assert.deepEqual(listedAccess(notes, linked), {
    notes: { can: ["list", "get"], rows: "all", read: ["deal", "note"], write: [] },
    deals: { can: [], rows: "all", read: ["title"], write: [] }
  });
  const form = { home: "add", public: { home: "add", tables: { notes: { create: true } } }, screens: { add: { public: true, content: [{ type: "form", table: "notes", fields: ["note", "deal"], buttons: [{ type: "button", label: "Add", do: [{ create: { table: "notes", values: "=form.values" } }] }] }] } } };
  assert.deepEqual(listedAccess(form, linked), {
    notes: { can: ["create"], read: ["note"], write: ["note", "deal"] },
    deals: { can: [], rows: "all", read: ["title"], write: [] }
  }, "a form can still link to a table it doesn't list");
  const listed = { ...notes, public: { home: "all", tables: { notes: { can: ["list"], rows: "all", read: ["deal"] } } } };
  assert.equal(listedAccess(listed, linked), listed.public.tables, "an app already listed is taken as it is");

  // The same derivation on a stored definition (by ids), as restoring and the upgrade use it.
  const stored = toIds(legacy, tables).definition;
  assert.deepEqual(listedStored(stored, tables).public.tables, toIds({ public: { tables: listedAccess(legacy, tables) } }, tables).definition.public.tables);
  assert.deepEqual(listedStored(stored, tables).screens, stored.screens);
  const storedListed = toIds(listed, linked).definition;
  assert.equal(listedStored(storedListed, linked), storedListed);
});

test("visitor access compared: what widens it, narrowing it, and a draft losing what was taken away", () => {
  const before = {
    users: { can: ["list", "get"], rows: "own", owner: "email", read: ["name", "status"], write: ["name"] },
    deals: { can: ["list"], rows: "all", read: ["amount"] }
  };
  assert.deepEqual(widening(before, before), []);
  assert.deepEqual(widening(before, { users: { ...before.users, can: ["list"], read: ["name"] } }), [], "less is never wider");
  const after = {
    users: { can: ["list", "get", "update"], rows: "all", owner: "email", read: ["name", "status", "started"], write: ["name"] },
    deals: { can: ["list"], rows: '=stage == "Won"', read: ["amount"] },
    notes: { can: [] }
  };
  assert.deepEqual(widening(before, after), [
    { table: "users", what: "can", name: "update" },
    { table: "users", what: "read", name: "started" },
    { table: "users", what: "rows" },
    { table: "notes", what: "table" }
  ]);
  assert.deepEqual(widening(before, { users: { ...before.users, owner: "work_email" } }), [{ table: "users", what: "owner" }]);

  const narrower = narrowed(before, { users: { can: ["list", "delete"], read: ["name", "salary"], write: [] } });
  assert.deepEqual(narrower, { users: { can: ["list"], rows: "own", owner: "email", read: ["name"], write: [] } }, "only takes away; rows and owner stay");
  const draft = {
    users: { can: ["list", "get", "create"], rows: "own", owner: "email", read: ["name", "status", "left_on"], write: ["name", "status"] },
    deals: { can: ["list"], rows: "all", read: ["amount", "stage"] },
    notes: { can: [] }
  };
  assert.deepEqual(withoutRemoved(draft, before, narrower), {
    users: { can: ["list", "create"], rows: "own", owner: "email", read: ["name", "left_on"], write: ["status"] },
    notes: { can: [] }
  });

  const scripted = { screens: { inside: { data: { a: { script: "a" } } }, board: { public: true, data: { list: { from: "users" }, best: { script: "top" } } } } };
  assert.deepEqual(publicScripts(scripted), [{ screen: "board", query: "best", script: "top" }]);
});

test("a public create form fills every required field, by showing it or with a fixed preset", () => {
  const form = (preset) => ({
    public: { home: "join", tables: { deals: { can: ["create"], write: ["title", "stage"] } } },
    home: "join",
    screens: { join: { public: true, content: [{ type: "form", table: "deals", fields: ["title"], buttons: [{ type: "button", label: "Send", do: [{ create: { table: "deals", values: "=form.values", ...(preset ? { preset } : {}) } }] }] }] } }
  });
  const required = structuredClone(tables);
  required[1].fields.find((field) => field.key === "stage").options.required = true;
  assert.match(checkApp(form(), required).map((error) => error.message).join("\n"), /stage is required: show it in the form, or give it a fixed value in preset, e\.g\. "preset": \{ "stage": "New" \}/u);
  assert.deepEqual(checkApp(form({ stage: "New" }), required), []);
  assert.deepEqual(toIds(form({ stage: "New" }), required).definition.screens.join.content[0].buttons[0].do[0].create.preset, { f_stage: "New" });
  assert.deepEqual(checkApp(form({ stage: "New", title: "=today()" }), required), [], "today() and now() work in a preset");
  assert.match(checkApp(form({ stage: "=form.title" }), required).map((error) => error.message).join("\n"), /it can't read the form or the visitor/u);
});
