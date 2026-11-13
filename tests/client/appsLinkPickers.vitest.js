import { describe, expect, it, vi } from "vitest";

// A record form's link pickers (D-35): they offer the target table's first records, search the server
// as the person types, so a record past the first page can be picked, and always offer the record a
// field links to now, under its label. Against a stand-in for the records route that pages and
// searches as the server does (text fields, any case).
const server = vi.hoisted(() => ({ tables: {}, calls: [], hold: null }));
vi.mock("../../src/components/apps/appsApi.js", () => ({
  appsApi: {
    records: async (table, params = {}) => {
      server.calls.push({ table, ...params });
      if (server.hold) await server.hold;
      const text = String(params.search || "").toLowerCase();
      const found = server.tables[table].filter((record) => !text || String(record.f_name).toLowerCase().includes(text));
      return { records: found.slice(0, Number(params.size) || 50) };
    }
  }
}));
const { LINK_CHOICES, useLinkPickers } = await import("../../src/components/apps/linkPickers.js");

const people = { id: "t_people", key: "people", titleFieldId: "f_name" };
const companies = { id: "t_companies", key: "companies", titleFieldId: "f_name" };
const fields = [
  { id: "f_owner", type: "link", options: { target: "t_people" } },
  { id: "f_company", type: "link", options: { target: "t_companies" } },
  { id: "f_note", type: "text" }
];
const range = (count, name) => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), f_name: `${name} ${index + 1}` }));
const values = (items) => items.map((item) => item.value);

function serverWith(peopleCount) {
  server.tables = { people: range(peopleCount, "Person"), companies: range(3, "Company") };
  server.calls = [];
  server.hold = null;
}

describe("a record form's link pickers", () => {
  it("offer the record a field links to now, past the first page, under its label", async () => {
    serverWith(LINK_CHOICES + 150);
    const links = useLinkPickers({ delayMs: 0 });
    await links.open(fields, [people, companies], { id: "9", f_owner: { id: "240", label: "Person 240" }, f_company: null });
    expect(links.choices.f_owner[0]).toEqual({ title: "Person 240", value: "240" });
    expect(links.choices.f_owner.length).toBe(LINK_CHOICES + 1);
    expect(values(links.choices.f_company)).toEqual(["1", "2", "3"]);
  });

  it("search the server as the person types, and keep the record chosen now", async () => {
    serverWith(LINK_CHOICES + 150);
    const links = useLinkPickers({ delayMs: 0 });
    await links.open(fields, [people, companies], null);
    expect(values(links.choices.f_owner)).not.toContain("245");
    await links.search("f_owner", "person 24", "3");
    expect(server.calls.at(-1)).toEqual({ table: "people", size: LINK_CHOICES, search: "person 24" });
    expect(values(links.choices.f_owner)).toEqual(["3", "24", ...Array.from({ length: 10 }, (_, index) => String(240 + index))]);
    // The chosen record's title in the box is no search: the first page comes back.
    await links.search("f_owner", "Person 240", "240");
    expect(server.calls.at(-1).search).toBeUndefined();
    expect(values(links.choices.f_owner)).toEqual(["240", ...range(LINK_CHOICES, "Person").map((record) => record.id)]);
  });

  it("read every link field's records at once, each loading until its page arrives", async () => {
    serverWith(5);
    let release = () => {};
    server.hold = new Promise((resolve) => (release = resolve));
    const links = useLinkPickers({ delayMs: 0 });
    const opening = links.open(fields, [people, companies], null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.calls.map((call) => call.table).sort(), "both fields asked before either answered").toEqual(["companies", "people"]);
    expect({ ...links.loading }).toEqual({ f_owner: true, f_company: true });
    release();
    await opening;
    expect(values(links.choices.f_owner)).toEqual(["1", "2", "3", "4", "5"]);
    expect({ ...links.loading }).toEqual({ f_owner: false, f_company: false });
  });
});
