import assert from "node:assert/strict";
import test from "node:test";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { __testables } from "../../packages/apps/src/server/templates.js";

const { TEMPLATES } = __testables;

// Every ready-made app passes the same save check as the Builder's apps, against its own tables,
// and its sample records only use those tables' fields.
test("each template is a valid app on its own tables", () => {
  assert.deepEqual(TEMPLATES.map((template) => template.key).sort(), ["bookings", "contact_form", "crm", "hiring", "leave", "stock"]);
  for (const template of TEMPLATES) {
    const tables = template.tables.map((table) => ({
      id: `t_${table.key}`,
      key: table.key,
      label: table.key,
      obsolete: false,
      fields: table.fields.map((field) => ({ id: `f_${table.key}_${field.key}`, key: field.key, label: field.key, type: field.type, options: { required: field.required, choices: field.choices, target: field.target && `t_${field.target}` }, obsolete: false }))
    }));
    assert.deepEqual(checkApp(template.definition, tables), [], `${template.key}: ${JSON.stringify(checkApp(template.definition, tables).slice(0, 3))}`);
    for (const [key, rows] of Object.entries(template.sample || {})) {
      const table = template.tables.find((entry) => entry.key === key);
      assert.ok(table, `${template.key}: sample for unknown table ${key}`);
      for (const row of rows) for (const field of Object.keys(row)) assert.ok(table.fields.some((entry) => entry.key === field), `${template.key}: ${key}.${field} isn't a field`);
    }
    assert.ok(template.name && template.description && template.icon && /^#[0-9A-F]{6}$/iu.test(template.color), `${template.key}: name, description, icon and colour`);
  }
});
