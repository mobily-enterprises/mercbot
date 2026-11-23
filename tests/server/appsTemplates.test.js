import assert from "node:assert/strict";
import test from "node:test";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { __testables } from "../../packages/apps/src/server/templates.js";
import { CATALOG, needsOf } from "../../packages/apps/src/server/tableCatalog.js";

const { TEMPLATES } = __testables;

// Every ready-made app passes the same save check as the Builder's apps, against its own tables and the shared tables
// it uses (D-130) with those they link to, and its sample records only use those tables' fields, each link to another of
// the sample's records naming one.
test("each template is a valid app on its own tables", () => {
  assert.deepEqual(TEMPLATES.map((template) => template.key).sort(), ["bookings", "contact_form", "contacts", "crm", "hiring", "leave", "stock", "todos"]);
  for (const template of TEMPLATES) {
    const shared = new Set();
    const add = (key) => {
      if (shared.has(key)) return;
      shared.add(key);
      needsOf(CATALOG.get(key)).forEach(add);
    };
    (template.uses || []).forEach(add);
    const own = [...[...shared].map((key) => CATALOG.get(key)), ...template.tables];
    const tables = own.map((table) => ({
      id: `t_${table.key}`,
      key: table.key,
      label: table.key,
      obsolete: false,
      fields: table.fields.map((field) => ({ id: `f_${table.key}_${field.key}`, key: field.key, label: field.key, type: field.type, options: { required: field.required, choices: field.choices, target: field.target && `t_${field.target}` }, obsolete: false }))
    }));
    assert.deepEqual(checkApp(template.definition, tables), [], `${template.key}: ${JSON.stringify(checkApp(template.definition, tables).slice(0, 3))}`);
    for (const [key, rows] of Object.entries(template.sample || {})) {
      const table = own.find((entry) => entry.key === key);
      assert.ok(table, `${template.key}: sample for unknown table ${key}`);
      for (const row of rows) {
        for (const [field, value] of Object.entries(row)) {
          const spec = table.fields.find((entry) => entry.key === field);
          assert.ok(spec, `${template.key}: ${key}.${field} isn't a field`);
          if (!value || typeof value !== "object") continue;
          // A link to the sample's own record: the table the field links to, made earlier in the sample, and one row of it.
          const { sample: target, ...match } = value;
          const order = Object.keys(template.sample);
          assert.ok(spec.type === "link" && spec.target === target && order.indexOf(target) >= 0 && order.indexOf(target) < order.indexOf(key), `${template.key}: ${key}.${field} links to ${target}, made before it`);
          const named = template.sample[target].filter((other) => Object.entries(match).every(([name, wanted]) => other[name] === wanted));
          assert.equal(named.length, 1, `${template.key}: ${key}.${field} names one ${target} row`);
        }
      }
    }
    assert.ok(template.name && template.description && template.icon && /^#[0-9A-F]{6}$/iu.test(template.color), `${template.key}: name, description, icon and colour`);
  }
});
