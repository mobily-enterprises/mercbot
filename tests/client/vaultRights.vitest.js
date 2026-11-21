import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// Settings → Vault (D-17, D-110): the home's vault, which everyone in the home shares. An item is deleted by the person
// who added it or the home's owners and admins, as the server allows (accountService.js deleteVaultItem), so only their
// rows have the delete button. The vault's route is a stand-in answering three items; the list is read as the page
// mounts, so here as the server renders (onMounted runs as onServerPrefetch for the vault alone).

vi.mock("vue", async (importOriginal) => {
  const vue = await importOriginal();
  const onMounted = (hook) => (vue.getCurrentInstance()?.type.__name === "MercbotSettingsVault" ? vue.onServerPrefetch(hook) : vue.onMounted(hook));
  return { ...vue, onMounted };
});
vi.mock("../../src/components/mercbot/accountApi.js", async (importOriginal) => ({
  ...(await importOriginal()),
  accountApi: {
    vault: async () => ({
      items: [
        { id: "1", kind: "login", label: "Bank", data: { username: "anna" }, madeBy: "1" },
        { id: "2", kind: "login", label: "Gym", data: { username: "ben" }, madeBy: "2" },
        { id: "3", kind: "login", label: "Old site", data: { username: "x" }, madeBy: null }
      ]
    })
  }
}));
vi.mock("../../src/components/mercbot/MercbotVaultImport.vue", () => ({ default: { name: "MercbotVaultImport", render: () => null } }));
vi.mock("../../src/components/mercbot/MercbotVaultPhoto.vue", () => ({ default: { name: "MercbotVaultPhoto", render: () => null } }));

const { default: MercbotSettingsVault } = await import("../../src/components/mercbot/MercbotSettingsVault.vue");
const { vaultName } = await import("../../src/components/mercbot/accountApi.js");

async function vault(props) {
  const app = createSSRApp({ render: () => h(MercbotSettingsVault, { homeName: "Rossi family", ...props }) });
  app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: true }));
  return renderToString(app);
}
const deletable = (html) => [...html.matchAll(/aria-label="Delete ([^"]*)"/gu)].map(([, label]) => label);

describe("the home's vault", () => {
  it("offers Delete on the items the person added, and on every item to the home's owners and admins", async () => {
    expect(deletable(await vault({ me: "2" }))).toEqual(["Gym"]);
    expect(deletable(await vault({ me: "2", manages: true }))).toEqual(["Bank", "Gym", "Old site"]);
    expect(deletable(await vault({ me: "" })), "no one signed in").toEqual([]);
  });

  it("is named after the home", () => {
    expect(vaultName("Rossi family")).toBe("Rossi family's vault");
    expect(vaultName("")).toBe("the home's vault");
  });
});
