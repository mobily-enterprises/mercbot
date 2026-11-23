import { describe, expect, it } from "vitest";
import { linksOf } from "../../src/components/apps/tableLinks.js";

// How a table is linked (D-130), from the tables the page already has: links to, linked from, and extended by.
describe("table links", () => {
  const link = (id, target, extra = {}) => ({ id, key: id, type: "link", options: { target, ...extra } });
  const tables = [
    { id: "t1", key: "contacts", fields: [link("organisation", "t2")] },
    { id: "t2", key: "organisations", fields: [] },
    { id: "t3", key: "todos", fields: [link("contact", "t1"), link("parent", "t3"), link("helper", "t1")] },
    { id: "t4", key: "crm_contacts", fields: [link("contact", "t1", { unique: true })] },
    { id: "t5", key: "old", obsolete: true, fields: [link("contact", "t1")] },
    { id: "t6", key: "deals", fields: [{ ...link("contact", "t1"), obsolete: true }] }
  ];
  it("lists each linked table once, leaves out links to itself, and obsolete tables and fields", () => {
    const keys = (list) => list.map((table) => table.key);
    const contacts = linksOf(tables[0], tables);
    expect([keys(contacts.linksTo), keys(contacts.linkedFrom), keys(contacts.extendedBy)]).toEqual([["organisations"], ["todos"], ["crm_contacts"]]);
    expect(keys(linksOf(tables[1], tables).linkedFrom)).toEqual(["contacts"]);
    expect(linksOf(tables[2], tables)).toEqual({ linksTo: [tables[0]], linkedFrom: [], extendedBy: [] });
    expect(linksOf(undefined, tables)).toEqual({ linksTo: [], linkedFrom: [], extendedBy: [] });
  });
});
