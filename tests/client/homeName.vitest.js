import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_NAME_MAX, homeNameProblem, useHomes } from "../../src/components/mercbot/homesApi.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";

// Renaming a home (D-103) as the page does it: Settings → General's Home name sends it on JSKIT's own route for the
// home's profile, and the list of homes the sidebar and the home switcher show holds the name the server kept at once;
// a name the server would refuse can't be saved. The route is a stand-in that records each call and answers as the
// server would.
const calls = vi.hoisted(() => []);
const answers = vi.hoisted(() => ({ fail: false }));
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url, options = {}) {
      calls.push([options.method || "GET", url, options.body ?? null]);
      if (answers.fail) throw Object.assign(new Error("Forbidden."), { status: 403 });
      if (url === "/api/workspaces") {
        return { data: [
          { id: "1", attributes: { slug: "casa", name: "Sam's home", roleSid: "owner" } },
          { id: "2", attributes: { slug: "shop", name: "Shop", roleSid: "member" } }
        ] };
      }
      const name = options.body.data.attributes.name;
      return { data: { id: "1", type: "workspaces", attributes: { slug: "casa", name } } };
    }
  })
}));

beforeEach(() => {
  calls.length = 0;
  answers.fail = false;
  setCurrentHome("casa");
});

describe("a home's name", () => {
  it("can't be empty, spaces only, or longer than JSKIT keeps", () => {
    expect(HOME_NAME_MAX).toBe(160);
    expect(homeNameProblem("")).toBe("A home needs a name.");
    expect(homeNameProblem("   ")).toBe("A home needs a name.");
    expect(homeNameProblem("x".repeat(161))).toBe("A home's name has at most 160 characters.");
    expect(homeNameProblem(` ${"x".repeat(160)} `)).toBe("");
    expect(homeNameProblem("The Smiths")).toBe("");
  });
});

describe("renaming", () => {
  it("sends the trimmed name on the home's own route, and the list shows it at once", async () => {
    const { current, homes, load, rename } = useHomes();
    await load({ fresh: true });
    expect(current.value.name).toBe("Sam's home");
    calls.length = 0;

    expect(await rename("casa", "  Sam and family  ")).toMatchObject({ slug: "casa", name: "Sam and family" });
    expect(calls).toEqual([["PATCH", "/api/w/casa", { data: { type: "workspaces", attributes: { name: "Sam and family" } } }]]);
    expect(current.value.name, "the sidebar's home, without another read").toBe("Sam and family");
    expect(homes.value.map((home) => [home.slug, home.name, home.role]))
      .toEqual([["casa", "Sam and family", "owner"], ["shop", "Shop", "member"]]);
  });

  it("keeps the name it had when the server refuses", async () => {
    const { current, load, rename } = useHomes();
    await load({ fresh: true });
    answers.fail = true;
    await expect(rename("casa", "Not mine")).rejects.toMatchObject({ status: 403 });
    expect(current.value.name).toBe("Sam's home");
  });
});
