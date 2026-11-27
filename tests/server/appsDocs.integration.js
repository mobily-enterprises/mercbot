import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createScripts } from "../../packages/apps/src/server/scripts.js";

// A record's document (D-140): a button's script fills a template from an invoice and its lines and makes it a PDF in the
// invoice's file field, as a record's file goes on; a picture field takes none; where the office apps aren't, it says so.
// The PDF maker is a stand-in for the office apps (their sandbox isn't on a test machine).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MAKE = `async function main(input) {
  return docs.pdf({
    template: "<h1>Invoice {{number}}</h1><p>{{total}}</p>{{lines:invoice_lines:invoice:item,price}}",
    record: { table: "invoices", id: input.id },
    into: input.into || "document",
    name: "Invoice " + input.number
  });
}`;

test("a button's script makes an invoice's PDF from it and its lines, into its file field", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-docs" });
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-docs-"));
  cleanup.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const pages = [];
  let installed = true;
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext, roleOf } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args),
    recordFiles: {
      write: store.writeRecordFile,
      remove: store.removeRecordFile,
      real: async (homeId, virtualPath) => (await store.existingFile(store.homePlace(homeId), virtualPath)).real,
      pdf: async (_homeId, html, target) => {
        if (!installed) throw new Error("Documents can't be made on this server: its office apps aren't installed.");
        pages.push(html);
        await writeFile(target, `%PDF-1.4 ${html.length}`);
      }
    }
  });
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => [] });
  cleanup.after(() => scripts.close());
  const owner = { type: "person", id: String(home.userId), name: "Pat" };
  const ctx = home.ctx(owner);
  await registry.createTable(owner, { key: "invoices", fields: [{ key: "number", type: "text" }, { key: "total", type: "money" }, { key: "document", type: "file" }, { key: "logo", type: "image" }] }, home.options);
  await registry.createTable(owner, { key: "invoice_lines", fields: [{ key: "item", type: "text" }, { key: "price", type: "money" }, { key: "invoice", type: "link", target: "invoices" }] }, home.options);
  const invoice = await gate.create(ctx, "invoices", { number: "INV-1", total: 125050 });
  const other = await gate.create(ctx, "invoices", { number: "INV-2", total: 100 });
  await gate.create(ctx, "invoice_lines", { item: "Desk", price: 120000, invoice: invoice.id });
  await gate.create(ctx, "invoice_lines", { item: "Lamp <LED>", price: 5050, invoice: invoice.id });
  await gate.create(ctx, "invoice_lines", { item: "Chair", price: 100, invoice: other.id });
  await apps.createApp(owner, { name: "Invoices" }, home.options);
  const saved = await scripts.save(owner, "invoices", {
    key: "make_pdf", kind: "action", summary: "Makes the invoice's PDF", code: MAKE,
    tests: [{ name: "makes", input: { id: "1", number: "INV-1" }, docs: { pdf: { file: { name: "Invoice INV-1.pdf", size: 9 } } }, expect: { file: { name: "Invoice INV-1.pdf", size: 9 } } }]
  }, home.options);
  assert.deepEqual(saved.errors, []);
  // A saved script is the draft's until it's published (D-139).
  await apps.publish(owner, "invoices", {}, home.options);
  const appId = (await apps.find("invoices", home.options)).id;
  const press = (input) => scripts.runNamed("action", appId, "make_pdf", input, { kind: "button" }, null, home.options);

  const made = await press({ id: invoice.id, number: "INV-1" });
  assert.equal(made.file.name, "Invoice INV-1.pdf");
  const tables = await registry.loadTables(home.options);
  const documentId = tables.find((table) => table.key === "invoices").fields.find((field) => field.key === "document").id;
  const stored = (await gate.get(ctx, "invoices", invoice.id))[documentId];
  assert.deepEqual([stored.name, stored.type], ["Invoice INV-1.pdf", "application/pdf"]);
  assert.match(await readFile((await gate.recordFile(ctx, "invoices", invoice.id, "document")).real, "utf8"), /^%PDF-1\.4/u);
  const [page] = pages;
  assert.match(page, /<h1>Invoice INV-1<\/h1><p>1,250.50<\/p>/u);
  assert.match(page, /<td>Desk<\/td><td>1,200.00<\/td>.*<td>Lamp &#60;LED&#62;<\/td>/u, "its own lines, escaped");
  assert.ok(!page.includes("Chair"), "never another invoice's line");

  await assert.rejects(press({ id: invoice.id, number: "INV-1", into: "logo" }), /must be a picture/u, "a picture field takes no PDF");
  installed = false;
  await assert.rejects(press({ id: invoice.id, number: "INV-1" }), /office apps aren't installed/u, "where documents can't be made, it says so");
});
