import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// The Data tab's record dialog (D-130): the records linked to the one open (Related), read as it opens, with what it says
// when that read fails; and a file chosen for a new record, which goes up once the record is saved, with what it says when
// that upload is refused. The routes are stand-ins; the dialog renders its content in place, as it does once it's open in
// a browser (on the server Vuetify's overlays render nothing).
const api = vi.hoisted(() => ({ calls: [], related: null, attach: null }));
vi.mock("../../src/components/apps/appsApi.js", () => ({
  appsApi: {
    relatedRecords: (...args) => api.related(...args),
    createRecord: async (table, values) => {
      api.calls.push(["createRecord", table, values]);
      return { id: "9", ...values };
    },
    updateRecord: async (table, id, values) => {
      api.calls.push(["updateRecord", table, id, values]);
      return { id, ...values };
    },
    attachFile: (...args) => {
      api.calls.push(["attachFile", ...args.slice(0, 3)]);
      return api.attach(...args);
    },
    records: async () => ({ records: [] })
  },
  errorText: (error, fallback) => error?.data?.error || error?.message || fallback
}));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("vuetify/components/VDialog", async () => {
  const { defineComponent, h: render } = await import("vue");
  return { VDialog: defineComponent({ name: "VDialog", setup: (_props, { slots }) => () => render("div", { class: "v-dialog" }, slots.default?.()) }) };
});
// The file field as the dialog gives it: what it's told.
const fileFields = vi.hoisted(() => ({}));
vi.mock("../../src/components/apps/RecordFileField.vue", async () => {
  const { defineComponent } = await import("vue");
  return {
    default: defineComponent({
      name: "RecordFileField",
      inheritAttrs: false,
      props: { field: { type: Object, required: true } },
      setup(props, { attrs }) {
        return () => {
          fileFields[props.field.key] = { ...attrs };
          return null;
        };
      }
    })
  };
});

const { default: RecordDialog } = await import("../../src/components/apps/RecordDialog.vue");

const contacts = {
  id: "t1",
  key: "contacts",
  label: "Contacts",
  titleFieldId: "f1",
  fields: [
    { id: "f1", key: "name", label: "Name", type: "text", options: {} },
    { id: "f2", key: "photo", label: "Photo", type: "image", options: {} }
  ]
};
const todos = { id: "t2", key: "todos", label: "To-dos", titleFieldId: "g1" };
const relatedOf = (id) => [{ table: todos, field: { id: "g2", key: "contact", label: "Contact" }, total: 1, records: [{ id: `${id}0`, g1: `Call ${id}` }] }];

/**
 * The dialog's HTML once `act(setup)` has run on it: `setup` is the dialog's own state and functions, as its controls
 * reach them (Save is `save`, a file chosen is `chosen`).
 */
async function rendered(props, act = async () => {}) {
  const emitted = [];
  const app = createSSRApp({
    render: () => h(RecordDialog, { open: true, table: contacts, tables: [contacts], ...props, "onUpdate:open": (open) => emitted.push(["update:open", open]), onSaved: () => emitted.push(["saved"]), onChanged: () => emitted.push(["changed"]) })
  });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  app.mixin({ async serverPrefetch() { if (this.$.type === RecordDialog) await act(this.$.setupState); } });
  const html = (await renderToString(app)).replaceAll("&#39;", "'").replace(/ data-v-[0-9a-f]+/gu, "");
  return { html, emitted, text: html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim() };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  api.calls = [];
  api.related = async (_table, id) => ({ groups: relatedOf(id) });
  api.attach = async (_table, id, field) => ({ id, f1: "Ann", [field]: { path: "/files/db/x.png", name: "x.png", size: 9 } });
});

describe("a record's Related", () => {
  it("lists the records linking to it, by table", async () => {
    const { text } = await rendered({ record: { id: "5", f1: "Ann" } }, settle);
    expect(text).toContain("Related");
    expect(text).toContain("To-dos · 1");
    expect(text).toContain("Call 5");
  });

  it("says when they couldn't be read, with Try again, rather than leaving them out", async () => {
    api.related = async () => {
      throw new Error("offline");
    };
    const { html, text } = await rendered({ record: { id: "5", f1: "Ann" } }, settle);
    expect(html).toContain("data-testid=\"record-related\"");
    expect(text).toContain("The records linked to this one didn't load. Try again");
  });

  it("shows the records of the record open now, never an earlier read that answered late", async () => {
    let answerFirst;
    api.related = (_table, id) => (id === "5" ? new Promise((resolve) => { answerFirst = () => resolve({ groups: relatedOf("5") }); }) : Promise.resolve({ groups: relatedOf(id) }));
    const { text } = await rendered({ record: { id: "5", f1: "Ann" } }, async (dialog) => {
      const later = dialog.loadRelated({ id: "6", f1: "Bea" });
      await later;
      answerFirst();
      await settle();
    });
    expect(text).toContain("Call 6");
    expect(text).not.toContain("Call 5");
  });
});

describe("a file chosen for a new record", () => {
  it("goes up once the record is saved, and the dialog closes", async () => {
    const { emitted } = await rendered({ record: null }, async (dialog) => {
      dialog.draft.f1 = "Ann";
      dialog.chosen.f2 = { name: "ann.png" };
      await dialog.save();
    });
    expect(api.calls).toEqual([["createRecord", "contacts", { f1: "Ann" }], ["attachFile", "contacts", "9", "f2"]]);
    expect(emitted).toEqual([["saved"], ["update:open", false]]);
  });

  it("refused, says why under its field and that the record is saved, and keeps the dialog open", async () => {
    api.attach = async () => {
      throw Object.assign(new Error("Request failed"), { status: 413, data: { error: "That file is too big to add; the limit is 25 MB." } });
    };
    const { emitted, text } = await rendered({ record: null }, async (dialog) => {
      dialog.draft.f1 = "Ann";
      dialog.chosen.f2 = { name: "huge.png" };
      await dialog.save();
    });
    expect(fileFields.photo["error-messages"]).toBe("That file is too big to add; the limit is 25 MB.");
    expect(text).toContain("The record is saved; the file marked above didn't go on.");
    expect(emitted).toEqual([["changed"]]);
  });
});
