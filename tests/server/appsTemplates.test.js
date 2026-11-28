import assert from "node:assert/strict";
import test from "node:test";
import { checkApp } from "../../packages/apps/src/shared/check.js";
import { __testables, templateSummaries } from "../../packages/apps/src/server/templates.js";
import { CATALOG, needsOf } from "../../packages/apps/src/server/tableCatalog.js";
import { readdirSync } from "node:fs";
import { APP_ICON_NAMES } from "../../packages/apps/src/shared/appIcons.js";

const { TEMPLATES } = __testables;

// Every ready-made app passes the same save check as the Builder's apps, against its own tables and the shared tables
// it uses (D-130) with those they link to, and its sample records only use those tables' fields, each link to another of
// the sample's records naming one.
test("each template is a valid app on its own tables", () => {
  const files = readdirSync(new URL("../../packages/apps/templates/", import.meta.url)).filter((name) => name.endsWith(".json"));
  assert.deepEqual(TEMPLATES.map((template) => template.key).sort(), files.map((name) => name.replace(/\.json$/u, "")).sort(), "one template per file");
  assert.ok(TEMPLATES.length >= 58, `${TEMPLATES.length} templates`);
  const AUDIENCES = ["corporate", "business", "family", "personal"];
  for (const template of TEMPLATES) {
    // Each wears a picture that fits it and says which kinds of use it serves, in the filter's order.
    assert.ok(APP_ICON_NAMES.includes(template.glyph), `${template.key}: glyph ${template.glyph}`);
    assert.ok(template.audiences?.length && template.audiences.every((key) => AUDIENCES.includes(key)), `${template.key}: audiences`);
    assert.deepEqual(template.audiences, AUDIENCES.filter((key) => template.audiences.includes(key)), `${template.key}: audiences in order`);
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
          // A tags field's list is a value; only `{ sample, ... }` is a link, as installing reads it (sampleLinks).
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
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

// The Templates tab learns each template's picture, kinds of use and what its screens do (D-141).
test("each template's summary carries its picture, kinds of use and what its screens do", () => {
  const byKey = Object.fromEntries(templateSummaries().map((entry) => [entry.key, entry]));
  assert.deepEqual([byKey.invoices.icon, byKey.invoices.audiences], ["receipt", ["business"]]);
  assert.ok(byKey.invoices.abilities.includes("lines"), "invoices add up their lines");
  assert.ok(byKey.event_signups.abilities.includes("public") && byKey.event_signups.abilities.includes("sends"), "a public page that sends");
  assert.ok(templateSummaries().every((entry) => entry.icon !== "star" || TEMPLATES.find((template) => template.key === entry.key).glyph === "star"), "no template falls back to the star");
});
