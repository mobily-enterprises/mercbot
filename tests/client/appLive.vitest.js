import { createSSRApp, h, nextTick } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Live screens (D-144): an app's running screen, like a view's (D-55), is what the home's change stream keeps current, so
// records a job, a bot or someone else changes show on an open screen without reloading. The frame's collaborators are
// stand-ins; useLiveData is caught to see what the frame hands it.
// The page the frame runs on: its history entry and storage, as a browser has them.
vi.stubGlobal("window", { history: { state: null }, localStorage: { getItem: () => null, setItem: () => {} } });
const caught = vi.hoisted(() => ({ live: null, kind: "app" }));
vi.mock("../../src/components/apps/useLiveData.js", () => ({ useLiveData: (screen) => { caught.live = screen; return { catchUp: () => {} }; } }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { workspaceSlug: "home", slug: "study", path: [] }, query: {}, fullPath: "/w/home/apps/study", path: "/w/home/apps/study" }),
  useRouter: () => ({ replace: () => {}, push: () => {} })
}));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("@jskit-ai/shell-web/client/components/ShellUpButton", () => ({ default: { render: () => null } }));
vi.mock("../../src/components/apps/useAppExit.js", () => ({ useAppExit: () => {} }));
vi.mock("../../src/components/apps/useAppStyle.js", () => ({ useAppStyle: () => {} }));
vi.mock("../../src/components/apps/scriptFunctions.js", () => ({ browserFunctions: async () => null }));
vi.mock("../../src/components/apps/askInChat.js", () => ({ askBuilder: async () => {} }));
for (const part of ["AppDetailsPanel", "AppTile", "AppNode", "AppTheme", "ViewActions"]) {
  vi.doMock(`../../src/components/apps/${part}.vue`, () => ({ default: { render: () => null } }));
}
vi.mock("../../src/components/apps/appsApi.js", () => ({
  errorText: (error, fallback) => error?.message || fallback,
  appsApi: {
    get: async () => ({
      app: { id: "1", slug: "study", name: "Study", kind: caught.kind },
      definition: { home: "learn", screens: { learn: { data: {}, content: [{ type: "text", value: "Hello" }] } } },
      tables: [],
      version: { draft: false }
    }),
    query: async () => ({ records: [] }),
    builder: async () => ({ builder: null })
  }
}));

async function framed(kind) {
  caught.kind = kind;
  caught.live = null;
  const { default: AppFrame } = await import("../../src/components/apps/AppFrame.vue");
  const app = createSSRApp({ render: () => h(AppFrame) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  await renderToString(app);
  for (let tick = 0; tick < 5; tick += 1) await nextTick();
  return caught.live?.value ?? null;
}

describe("a running screen kept current by the home's changes", () => {
  it("is an app's screen as much as a view's", async () => {
    expect((await framed("app"))?.screen?.content?.[0]?.value).toBe("Hello");
    expect((await framed("view"))?.screen?.content?.[0]?.value).toBe("Hello");
  });
});
