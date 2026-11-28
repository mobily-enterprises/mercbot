import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG, catalogMatch, catalogProblems, needsOf } from "../../packages/apps/src/server/tableCatalog.js";

// The shared tables' catalog (D-130) is checked as the server starts: every file here passes, and each kind of broken
// file is named. Names people use find their table, singular or plural.
test("the catalog is sound: thirteen shared tables, links that resolve, one extension with its one-to-one link", () => {
  assert.deepEqual(catalogProblems([...CATALOG.values()]), []);
  assert.deepEqual([...CATALOG.keys()].sort(), [
    "contacts", "crm_contacts", "deals", "departments", "event_attendees", "events", "graphics", "list_items", "organisations", "place_categories", "places", "todo_lists", "todos"
  ]);
  assert.deepEqual(needsOf(CATALOG.get("todos")), ["todo_lists", "contacts"], "its own parent link aside");
  assert.equal(CATALOG.get("crm_contacts").extends, "contacts");
  assert.deepEqual(CATALOG.get("todo_lists").seed, [{ name: "General" }]);
});

test("each kind of broken catalog file is named, table by table", () => {
  const base = { key: "things", label: "Things", description: "Things.", fields: [{ key: "name", type: "text" }] };
  const problems = (...entries) => catalogProblems(entries).join("\n");
  assert.match(problems({ ...base, fields: [{ key: "name", type: "texty" }] }), /"things": field "name" has an unknown type "texty"/u);
  assert.match(problems({ ...base, fields: [...base.fields, { key: "owner", type: "link", target: "nobody" }] }), /links to "nobody", which isn't in the catalog/u);
  assert.match(problems(base, { ...base, key: "thing_details", label: "Thing details", extends: "things", fields: [{ key: "thing", type: "link", target: "things" }] }), /extends "things", so it needs a required, one-to-one link/u);
  assert.match(problems(
    { ...base, key: "eggs", label: "Eggs", fields: [{ key: "hen", type: "link", target: "hens" }] },
    { ...base, key: "hens", label: "Hens", fields: [{ key: "egg", type: "link", target: "eggs" }] }
  ), /in a circle: eggs → hens → eggs/u);
  assert.match(problems(base, { ...base, key: "items", label: "Items", aliases: ["things"] }), /"items": the name "things" is also "things"'s/u);
  assert.match(problems({ ...base, seed: [{ colour: "red" }] }), /a seed row names field "colour"/u);
  assert.match(problems({ ...base, fields: [{ key: "name", type: "text" }, { key: "name", type: "text" }] }), /field "name" appears twice/u);
});

test("a name finds its shared table by key, label or alias, singular or plural, and nothing else", () => {
  const cases = {
    contacts: "contacts", Contact: "contacts", customers: "contacts", "Address book": "contacts",
    Tasks: "todos", "to-do list": "todos", "To-dos": "todos", "To-do lists": "todo_lists",
    venue: "places", Companies: "organisations", Organization: "organisations", "event attendee": "event_attendees",
    opportunity: "deals", "place category": "place_categories"
  };
  for (const [name, key] of Object.entries(cases)) assert.equal(catalogMatch(name), key, name);
  for (const name of ["plants", "bills", "", "s"]) assert.equal(catalogMatch(name), null, name);
});
