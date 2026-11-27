import assert from "node:assert/strict";
import test from "node:test";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { toIds, toNames } from "../../packages/apps/src/shared/definitions.js";

// What a create form sends on submit (D-137): the save check names what each send needs, an edit form has none, its
// formulas see the record as `record` and are stored by field ids, and on a public screen they read only what visitors
// may read besides the record they added.
const field = (id, key, type) => ({ id, key, label: key, type, options: {}, obsolete: false });
const tables = [
  { id: "t_s", key: "signups", label: "Sign-ups", obsolete: false, titleFieldId: "f_n", fields: [field("f_n", "name", "text"), field("f_e", "email", "email")] },
  { id: "t_v", key: "venues", label: "Venues", obsolete: false, titleFieldId: "f_a", fields: [field("f_a", "address", "text"), field("f_c", "code", "text")] }
];
const thanks = { email: { to: "=record.email", subject: "You're in", text: '="See you, " + record.name' } };
const form = (onSubmit, extra = {}) => ({ type: "form", table: "signups", fields: ["name", "email"], buttons: [], onSubmit, ...extra });
const app = (part, extra = {}) => ({ home: "signup", screens: { signup: { data: { venue: { record: "venues", id: "=\"1\"" } }, content: [part], ...extra.screen } }, ...extra.app });
const errors = (definition) => JSON.stringify(checkApp(definition, tables));

test("a create form's sends: checked, never on an edit form, their record by ids", () => {
  assert.deepEqual(checkApp(app(form([thanks, { notify: { to: "owners", text: '="New: " + record.name' } }])), tables), []);
  assert.match(errors(app(form([{ email: { to: "=record.email", subject: "Hi" } }]))), /email needs text/u);
  assert.match(errors(app(form([{ sms: { to: "x" } }]))), /is \{ \\"email\\"/u);
  assert.match(errors(app(form([{ email: { ...thanks.email, cc: "x" } }]))), /email has only to, subject, text/u);
  assert.match(errors(app(form([{ email: { ...thanks.email, to: "=record.phone" } }]))), /phone/u);
  assert.match(errors(app(form([thanks, thanks, thanks, thanks]))), /up to 3 sends/u);
  assert.match(errors(app({ type: "form", record: "=data.venue", fields: ["address"], buttons: [], onSubmit: [thanks] })), /only a form that adds a record/u);
  const stored = toIds(app(form([thanks])), tables).definition.screens.signup.content[0].onSubmit[0].email;
  assert.deepEqual([stored.to, stored.text], ["=record.f_e", '="See you, " + record.f_n']);
  assert.deepEqual(toNames(toIds(app(form([thanks])), tables).definition, tables).screens.signup.content[0].onSubmit[0], thanks);
});

test("on a public screen, a send reads only what visitors may read, besides the record they added", () => {
  const open = (send) => app(form([send]), {
    screen: { public: true },
    app: { public: { home: "signup", tables: { signups: { can: ["create"], write: ["name", "email"] }, venues: { can: ["get"], rows: "all", read: ["address"] } } } }
  });
  assert.deepEqual(checkApp(open({ email: { ...thanks.email, text: '="Meet at " + data.venue.address' } }), tables), [], "the venue's address is theirs to read");
  assert.match(errors(open({ email: { ...thanks.email, text: '="The door code is " + data.venue.code' } })), /code/u, "the door code isn't");
});
