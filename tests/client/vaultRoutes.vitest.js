import { describe, expect, it, vi } from "vitest";

// The home's vault is read and changed through the home's routes (D-110, G's 74e461c): /api/w/<home>/vault…, never the
// old /api/vault, which had no home. The HTTP client is a stand-in recording each request.
const calls = vi.hoisted(() => []);
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({ request: async (url, options = {}) => { calls.push([options.method || "GET", url]); return {}; } })
}));

const { setCurrentHome } = await import("../../src/components/mercbot/homeApi.js");
const { accountApi } = await import("../../src/components/mercbot/accountApi.js");

describe("the vault's routes", () => {
  it("are the home's", async () => {
    setCurrentHome("rossi-family");
    await accountApi.vault();
    await accountApi.addVaultItem({ kind: "login" });
    await accountApi.importVaultItems("login", []);
    await accountApi.deleteVaultItem("12");
    expect(calls).toEqual([
      ["GET", "/api/w/rossi-family/vault"],
      ["POST", "/api/w/rossi-family/vault"],
      ["POST", "/api/w/rossi-family/vault/import"],
      ["DELETE", "/api/w/rossi-family/vault/12"]
    ]);
  });
});
