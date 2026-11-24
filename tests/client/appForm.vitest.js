import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";
import { APP_SCREEN_KEY } from "../../src/components/apps/screenKeys.js";

// A live app's form with a file or picture field (D-130): a file chosen goes onto the record at once, and Remove takes it
// away, each by the field's name, since an app's tables (the server's screenTables) come without field ids.
const calls = vi.hoisted(() => ({ api: [], fileFields: {}, uploading: null }));
vi.mock("../../src/components/apps/appsApi.js", () => ({
  appsApi: {
    attachFile: async (...args) => {
      calls.api.push(["attachFile", ...args]);
      await calls.uploading;
    },
    updateRecord: async (...args) => calls.api.push(["updateRecord", ...args])
  },
  errorText: (error, fallback) => error?.message || fallback
}));
// The file field as the form gives it: what it's told, and what it hears back.
vi.mock("../../src/components/apps/RecordFileField.vue", async () => {
  const { defineComponent } = await import("vue");
  return {
    default: defineComponent({
      name: "RecordFileField",
      inheritAttrs: false,
      props: { field: { type: Object, required: true } },
      setup(props, { attrs }) {
        calls.fileFields[props.field.key] = attrs;
        return () => null;
      }
    })
  };
});
vi.mock("../../src/components/apps/AppNode.vue", async () => {
  const { defineComponent } = await import("vue");
  return { default: defineComponent({ name: "AppNode", setup: () => () => null }) };
});

const { default: AppForm } = await import("../../src/components/apps/AppForm.vue");

// An app's table as its screens get it: fields by name, no ids.
const graphics = {
  id: "t1",
  key: "graphics",
  label: "Graphics",
  fields: [
    { key: "title", label: "Title", type: "text", options: {} },
    { key: "picture", label: "Picture", type: "image", options: {} }
  ]
};
const runtime = {
  data: { poster: { id: "5", title: "Poster", picture: { path: "/files/db/tables/graphics/5/picture/p.png", name: "p.png", size: 9 } } },
  loading: new Set(),
  attachesFiles: true,
  people: [],
  referenced: () => "poster",
  queryTable: () => graphics,
  tableNamed: () => graphics,
  evaluate: () => undefined,
  reloadChanged: async () => {}
};

async function render() {
  const app = createSSRApp({ render: () => h(AppForm, { node: { type: "form", record: "=data.poster", fields: ["title", "picture"] }, path: "content/0" }) });
  app.provide(APP_SCREEN_KEY, runtime);
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return renderToString(app);
}

describe("a live app's form with a picture field", () => {
  it("uploads a chosen file, and takes one away, by the field's name", async () => {
    await render();
    const picture = calls.fileFields.picture;
    expect(picture).toBeTruthy();
    const file = { name: "new.png" };
    await picture["onUpdate:chosen"](file);
    await picture["onUpdate:current"](null);
    expect(calls.api).toEqual([
      ["attachFile", "graphics", "5", "picture", file],
      ["updateRecord", "graphics", "5", { picture: null }]
    ]);
  });

  it("sends one upload at a time: a file chosen while one goes up isn't sent too", async () => {
    calls.api = [];
    let finish;
    calls.uploading = new Promise((resolve) => { finish = resolve; });
    await render();
    const picture = calls.fileFields.picture;
    const first = picture["onUpdate:chosen"]({ name: "one.png" });
    const second = picture["onUpdate:chosen"]({ name: "two.png" });
    finish();
    await Promise.all([first, second]);
    calls.uploading = null;
    expect(calls.api).toEqual([["attachFile", "graphics", "5", "picture", { name: "one.png" }]]);
  });
});
